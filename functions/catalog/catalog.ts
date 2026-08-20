import type { APIGatewayProxyEvent, APIGatewayProxyHandler } from 'aws-lambda';
import {
  HttpError,
  ValidationError,
  createLogger,
  errorResponse,
  isErrorNamed,
  jsonResponse,
  normalizeDisplayName,
  parseJsonBody,
  putItemConditional,
  queryAllByGSI,
  rejectUnknownFields,
  requireEnv,
  requireInteger,
  requireString,
  toSlug,
  type Logger,
} from 'pokedex-utils';

const TABLE_NAME = requireEnv('TABLE_NAME');

const NAME_MIN_LENGTH = 2;
const NAME_MAX_LENGTH = 60;
const TYPE_MAX_LENGTH = 30;
const MAX_PRICE = 1000000;
const ALLOWED_CREATE_FIELDS = ['name', 'type', 'price'];

// The stored catalog entry, limited to what is read back out.
interface PokemonItem {
  pokemonId: string;
  name: string;
  type: string;
  price: number;
  createdAt: string;
}

// A Pokemon is a catalog entry, so a slug of its name is a perfectly good
// identity. That makes the id itself unique, which is why one conditional
// PutItem is enough here. Contrast users.ts: a user's id is a random UUID and
// the uniqueness lives on a *different* attribute, so it needs a separate
// reservation item written inside a transaction.
function readName(value: unknown): { displayName: string; pokemonId: string } {
  const displayName = normalizeDisplayName(value, 'name', {
    min: NAME_MIN_LENGTH,
    max: NAME_MAX_LENGTH,
  });
  const pokemonId = toSlug(displayName);

  // A name written only in a non-Latin script would slug to nothing.
  if (!pokemonId) {
    throw new ValidationError('name must contain at least one Latin letter or digit.', 'name');
  }

  return { displayName, pokemonId };
}

function toPublicPokemon(item: PokemonItem) {
  return {
    pokemonId: item.pokemonId,
    name: item.name,
    type: item.type,
    price: item.price,
    createdAt: item.createdAt,
  };
}

async function listPokemons() {
  const items = await queryAllByGSI<PokemonItem>(
    TABLE_NAME,
    'GSI1',
    'GSI1PK',
    'ENTITY#POKEMON',
  );

  return jsonResponse(200, items.map(toPublicPokemon));
}

async function createPokemon(event: APIGatewayProxyEvent, log: Logger) {
  const body = parseJsonBody(event);
  // Fails loudly on a client still sending its own pokemonId.
  rejectUnknownFields(body, ALLOWED_CREATE_FIELDS);

  const { displayName, pokemonId } = readName(body.name);
  const type = requireString(body.type, 'type', { max: TYPE_MAX_LENGTH });
  const price = requireInteger(body.price, 'price', { min: 0, max: MAX_PRICE });
  const createdAt = new Date().toISOString();

  try {
    await putItemConditional(
      TABLE_NAME,
      {
        PK: `POKEMON#${pokemonId}`,
        SK: 'DETAIL',
        GSI1PK: 'ENTITY#POKEMON',
        GSI1SK: `POKEMON#${pokemonId}`,
        entity: 'POKEMON',
        pokemonId,
        name: displayName,
        type,
        price,
        createdAt,
      },
      // Only PK is needed: a Put supplies the whole primary key, so the
      // condition is evaluated against the item at that exact key.
      'attribute_not_exists(PK)',
    );
  } catch (error) {
    if (!isErrorNamed(error, 'ConditionalCheckFailedException')) {
      throw error;
    }

    log.warn('Rejected a duplicate Pokemon name.', { pokemonId });

    throw new HttpError(409, `The name "${displayName}" is already in the catalog.`, {
      pokemonId,
    });
  }

  log.info('Pokemon created.', { pokemonId, price });

  return jsonResponse(201, toPublicPokemon({
    pokemonId, name: displayName, type, price, createdAt,
  }));
}

export const handler: APIGatewayProxyHandler = async (event, context) => {
  const log = createLogger({
    route: 'catalog',
    requestId: context?.awsRequestId,
    apiRequestId: event.requestContext?.requestId,
  });

  try {
    if (event.httpMethod === 'GET') {
      return await listPokemons();
    }
    if (event.httpMethod === 'POST') {
      return await createPokemon(event, log);
    }

    return jsonResponse(405, { message: 'Method not allowed.' }, { allow: 'GET, POST' });
  } catch (error) {
    return errorResponse(error, log);
  }
};
