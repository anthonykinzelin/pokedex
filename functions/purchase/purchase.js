const { randomUUID } = require('node:crypto');
const { getItem, transactWrite } = require('../../utils/dynamo');
const { publishEvent } = require('../../utils/events');
const {
  HttpError,
  errorResponse,
  jsonResponse,
  parseJsonBody,
} = require('../../utils/http');

const TABLE_NAME = process.env.TABLE_NAME;
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME;

exports.handler = async (event) => {
  try {
    const userId = event.pathParameters?.userId?.trim();
    if (!userId) {
      throw new HttpError(400, 'The userId path parameter is required.');
    }

    const { pokemonId } = parseJsonBody(event);
    if (typeof pokemonId !== 'string' || !pokemonId.trim()) {
      throw new HttpError(400, 'pokemonId must be a non-empty string.');
    }

    const normalizedPokemonId = pokemonId.trim();
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
          ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
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
      console.error('The purchase was saved but its event could not be published.', {
        purchaseId,
        error: eventError.message,
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
    if (error?.name === 'TransactionCanceledException') {
      return errorResponse(new HttpError(409, 'The purchase could not be completed.'));
    }
    return errorResponse(error);
  }
};
