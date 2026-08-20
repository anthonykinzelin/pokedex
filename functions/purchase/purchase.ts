import { randomUUID } from 'node:crypto';
import type { APIGatewayProxyHandler } from 'aws-lambda';
import {
  HttpError,
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
// Read at module load rather than left to publishEvent's own guard. That guard
// throws inside the try below, which is deliberately swallowed so a Levels
// outage cannot fail a committed purchase - but it would swallow a missing
// variable too, and purchases would succeed while no event was ever published.
// A misconfigured deploy is not an outage, so it fails here instead, loudly.
const EVENT_BUS_NAME = requireEnv('EVENT_BUS_NAME');

// The balance update is operation 0 and the purchase Put is operation 1, so
// CancellationReasons lines up with these indexes.
const BALANCE_OPERATION = 0;

interface UserItem {
  balance: number;
}

interface PokemonItem {
  name: string;
  type: string;
  price: number;
}

export const handler: APIGatewayProxyHandler = async (event, context) => {
  const log = createLogger({
    route: 'purchase',
    requestId: context?.awsRequestId,
    apiRequestId: event.requestContext?.requestId,
  });

  try {
    // The userId stays an opaque path value. It is deliberately not checked
    // against a UUID shape: the identity scheme is the referential's business,
    // not the transport's, and an unknown id already 404s below.
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
          // A Put supplies the whole primary key, so testing PK alone
          // already means "no item at this exact PK and SK".
          ConditionExpression: 'attribute_not_exists(PK)',
        },
      },
    ]);

    try {
      await publishEvent(
        EVENT_BUS_NAME,
        'fr.pokemon.referential',
        'purchase.completed',
        {
          eventVersion: '1.0',
          purchaseId,
          userId,
          pokemonId: normalizedPokemonId,
          occurredAt: createdAt,
        },
      );
    } catch (eventError) {
      // Deliberately swallowed: the purchase is already committed and the
      // brief requires it to succeed even when the Levels service is gone.
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
    // CancellationReasons lines up with the operations above: index 0 is the
    // balance update, index 1 is the purchase Put. Only the first can fail for
    // a reason the caller can act on.
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
