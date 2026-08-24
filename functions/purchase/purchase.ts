import { randomUUID } from 'node:crypto';
import type { APIGatewayProxyHandler } from 'aws-lambda';
import {
  HttpError,
  PURCHASE_COMPLETED,
  cancellationReasons,
  createLogger,
  errorResponse,
  getItem,
  isErrorNamed,
  jsonResponse,
  parseJsonBody,
  publishEvent,
  requireEnv,
  requireString,
  serializeError,
  transactWrite,
} from 'pokedex-utils';

const TABLE_NAME = requireEnv('TABLE_NAME');
const EVENT_BUS_NAME = requireEnv('EVENT_BUS_NAME');

const BALANCE_OPERATION = 0;

interface UserItem {
  balance: number;
}

interface PokemonItem {
  name: string;
  type: string;
  price: number;
}

// The bus name is read at module load rather than left to publishEvent's own
// guard, because that guard throws inside the try below, which is deliberately
// swallowed so a Levels outage cannot fail a committed purchase - a misconfigured
// deploy is not an outage and must fail loudly instead. userId stays an opaque
// path value: the identity scheme is the referential's business, and an unknown
// id already 404s. CancellationReasons lines up with the two operations, index 0
// being the balance update - the only one that can fail for a reason the caller
// can act on.
export const handler: APIGatewayProxyHandler = async (event, context) => {
  const log = createLogger({
    route: 'purchase',
    requestId: context?.awsRequestId,
    apiRequestId: event.requestContext?.requestId,
  });

  try {
    const userId = requireString(event.pathParameters?.userId, 'userId');

    const { pokemonId } = parseJsonBody(event);
    const normalizedPokemonId = requireString(pokemonId, 'pokemonId');
    const [user, pokemon] = await Promise.all([
      getItem<UserItem>(TABLE_NAME, `USER#${userId}`, 'PROFILE'),
      getItem<PokemonItem>(TABLE_NAME, `POKEMON#${normalizedPokemonId}`, 'DETAIL'),
    ]);

    if (!user) {
      throw new HttpError(404, `User ${userId} was not found.`);
    }
    if (!pokemon) {
      throw new HttpError(404, `Pokemon ${normalizedPokemonId} was not found.`);
    }

    const price = Number(pokemon.price || 0);
    if (!Number.isFinite(user.balance) || user.balance < price) {
      throw new HttpError(409, 'The user does not have enough balance.');
    }

    const purchaseId = randomUUID();
    const createdAt = new Date().toISOString();
    const ownedPokemon = {
      pokemonId: normalizedPokemonId,
      name: pokemon.name,
      type: pokemon.type,
      price,
      purchaseId,
      acquiredAt: createdAt,
    };

    await transactWrite(TABLE_NAME, [
      {
        Update: {
          Key: { PK: `USER#${userId}`, SK: 'PROFILE' },
          UpdateExpression: [
            'SET balance = balance - :price',
            'pokemons = list_append(if_not_exists(pokemons, :emptyList), :pokemon)',
          ].join(', '),
          ConditionExpression: 'attribute_exists(PK) AND balance >= :price',
          ExpressionAttributeValues: {
            ':price': price,
            ':emptyList': [],
            ':pokemon': [ownedPokemon],
          },
        },
      },
      {
        Put: {
          Item: {
            PK: `USER#${userId}`,
            SK: `PURCHASE#${createdAt}#${purchaseId}`,
            entity: 'PURCHASE',
            purchaseId,
            userId,
            pokemonId: normalizedPokemonId,
            pokemonName: pokemon.name,
            amount: price,
            createdAt,
          },
          ConditionExpression: 'attribute_not_exists(PK)',
        },
      },
    ]);

    try {
      await publishEvent(EVENT_BUS_NAME, PURCHASE_COMPLETED, {
        eventVersion: '1.0',
        purchaseId,
        userId,
        pokemonId: normalizedPokemonId,
        occurredAt: createdAt,
      });
    } catch (eventError) {
      log.error('The purchase was saved but its event could not be published.', {
        purchaseId,
        ...serializeError(eventError),
      });
    }

    return jsonResponse(201, {
      purchaseId,
      userId,
      pokemonId: normalizedPokemonId,
      amount: price,
      createdAt,
    });
  } catch (error) {
    if (isErrorNamed(error, 'TransactionCanceledException')) {
      const reasons = cancellationReasons(error);

      if (reasons[BALANCE_OPERATION]?.Code === 'ConditionalCheckFailed') {
        return errorResponse(
          new HttpError(409, 'The user does not have enough balance.'),
          log,
        );
      }
    }

    return errorResponse(error, log);
  }
};
