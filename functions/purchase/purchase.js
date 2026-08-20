const { randomUUID } = require('node:crypto');
const {
  HttpError,
  createLogger,
  errorResponse,
  getItem,
  jsonResponse,
  parseJsonBody,
  publishEvent,
  requireString,
  serializeError,
  transactWrite,
} = require('pokedex-utils');

const TABLE_NAME = process.env.TABLE_NAME;
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME;

exports.handler = async (event, context) => {
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
      getItem(TABLE_NAME, `USER#${userId}`, 'PROFILE'),
      getItem(TABLE_NAME, `POKEMON#${normalizedPokemonId}`, 'DETAIL'),
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
    if (error?.name === 'TransactionCanceledException') {
      const reasons = error.CancellationReasons || [];

      if (reasons[0]?.Code === 'ConditionalCheckFailed') {
        return errorResponse(
          new HttpError(409, 'The user does not have enough balance.'),
          log,
        );
      }
    }

    return errorResponse(error, log);
  }
};
