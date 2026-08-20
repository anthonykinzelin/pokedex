import { randomUUID } from 'node:crypto';
import type { APIGatewayProxyEvent, APIGatewayProxyHandler } from 'aws-lambda';
import {
  HttpError,
  cancellationReasons,
  createLogger,
  errorResponse,
  getItem,
  isErrorNamed,
  jsonResponse,
  normalizeDisplayName,
  parseJsonBody,
  queryAllByGSI,
  rejectUnknownFields,
  requireEnv,
  requireInteger,
  toNameKey,
  transactWrite,
  type Logger,
} from 'pokedex-utils';

const TABLE_NAME = requireEnv('TABLE_NAME');

// A new trainer starts with enough pokecoins to buy something. Defaulting to 0
// would push the failure to a later "not enough balance" on the purchase route.
const STARTING_BALANCE = 100;
const MAX_BALANCE = 1000000;
const NAME_MIN_LENGTH = 2;
// Long enough for the "Postman Trainer <guid>" the collection sends.
const NAME_MAX_LENGTH = 60;
const ALLOWED_CREATE_FIELDS = ['name', 'balance'];

// Both writes travel in one TransactWriteItems call, and CancellationReasons
// comes back in the same order, so these indexes say which check failed.
const PROFILE_OPERATION = 0;
const RESERVATION_OPERATION = 1;

// The stored profile. Only what is read back: the writes below build the item
// literally, so the compiler checks those against this on assignment.
interface UserProfileItem {
  userId: string;
  name: string;
  balance: number;
  pokemons?: unknown[];
  createdAt: string;
}

interface ReservationItem {
  userId: string;
  name: string;
}

function reservationPK(nameKey: string): string {
  return `USERNAME#${nameKey}`;
}

// One input, two values: the name shown to people and the name used to compare.
function readName(value: unknown): { displayName: string; nameKey: string } {
  const displayName = normalizeDisplayName(value, 'name', {
    min: NAME_MIN_LENGTH,
    max: NAME_MAX_LENGTH,
  });

  return { displayName, nameKey: toNameKey(displayName) };
}

function readBalance(value: unknown): number {
  if (value === undefined) {
    return STARTING_BALANCE;
  }

  return requireInteger(value, 'balance', { min: 0, max: MAX_BALANCE });
}

// nameKey is storage detail, so it is deliberately not exposed.
function toPublicUser(item: UserProfileItem) {
  return {
    userId: item.userId,
    name: item.name,
    balance: item.balance,
    pokemons: Array.isArray(item.pokemons) ? item.pokemons : [],
    createdAt: item.createdAt,
  };
}

function nameIsAlreadyTaken(error: unknown): boolean {
  if (!isErrorNamed(error, 'TransactionCanceledException')) {
    return false;
  }

  const reasons = cancellationReasons(error);

  if (reasons[PROFILE_OPERATION]?.Code === 'ConditionalCheckFailed') {
    // The profile key is a freshly generated UUID, so this is not a name
    // clash. Let it surface as a 500 rather than blaming the caller's name.
    return false;
  }

  return reasons[RESERVATION_OPERATION]?.Code === 'ConditionalCheckFailed';
}

async function listUsers() {
  // The reservation items carry no GSI1 keys, and a GSI only holds items that
  // have both of its key attributes, so this query returns profiles only.
  const items = await queryAllByGSI<UserProfileItem>(
    TABLE_NAME,
    'GSI1',
    'GSI1PK',
    'ENTITY#USER',
  );

  return jsonResponse(200, items.map(toPublicUser));
}

async function createUser(event: APIGatewayProxyEvent, log: Logger) {
  const body = parseJsonBody(event);
  // Fails loudly on a client still sending the old userId field.
  rejectUnknownFields(body, ALLOWED_CREATE_FIELDS);

  const { displayName, nameKey } = readName(body.name);
  const balance = readBalance(body.balance);

  // The token identifies the calling application, not a person, so the server
  // owns the identity of the user it creates.
  const userId = randomUUID();
  const createdAt = new Date().toISOString();

  const profile = {
    PK: `USER#${userId}`,
    SK: 'PROFILE',
    GSI1PK: 'ENTITY#USER',
    GSI1SK: `USER#${userId}`,
    entity: 'USER',
    userId,
    name: displayName,
    nameKey,
    balance,
    pokemons: [],
    createdAt,
  };

  const reservation = {
    PK: reservationPK(nameKey),
    SK: 'RESERVATION',
    // No GSI1PK/GSI1SK on purpose: without both index keys this item is absent
    // from GSI1, so it can never show up in GET /users.
    entity: 'USERNAME_RESERVATION',
    nameKey,
    name: displayName,
    userId,
    createdAt,
  };

  try {
    // One transaction, so two concurrent requests for the same name cannot
    // both win. The loser's condition fails and its profile is rolled back
    // too, which leaves no orphan USER# item behind.
    await transactWrite(TABLE_NAME, [
      { Put: { Item: profile, ConditionExpression: 'attribute_not_exists(PK)' } },
      { Put: { Item: reservation, ConditionExpression: 'attribute_not_exists(PK)' } },
    ]);
  } catch (error) {
    if (!nameIsAlreadyTaken(error)) {
      throw error;
    }

    // Nothing was written, so read the winner to tell the caller which user
    // already holds the name. getItem is a consistent read, so the winner's
    // reservation is guaranteed to be visible here.
    const existing = await getItem<ReservationItem>(
      TABLE_NAME,
      reservationPK(nameKey),
      'RESERVATION',
    );

    log.warn('Rejected a duplicate user name.', { nameKey, existingUserId: existing?.userId });

    throw new HttpError(409, `The name "${displayName}" is already taken.`, {
      userId: existing?.userId,
      name: existing?.name || displayName,
    });
  }

  log.info('User created.', { userId, nameKey, balance });

  return jsonResponse(201, toPublicUser(profile));
}

export const handler: APIGatewayProxyHandler = async (event, context) => {
  const log = createLogger({
    route: 'users',
    requestId: context?.awsRequestId,
    apiRequestId: event.requestContext?.requestId,
  });

  try {
    if (event.httpMethod === 'GET') {
      // Awaited inside the try, so a rejection becomes a JSON error rather
      // than escaping and turning into a bare 502.
      return await listUsers();
    }
    if (event.httpMethod === 'POST') {
      return await createUser(event, log);
    }

    return jsonResponse(405, { message: 'Method not allowed.' }, { allow: 'GET, POST' });
  } catch (error) {
    return errorResponse(error, log);
  }
};
