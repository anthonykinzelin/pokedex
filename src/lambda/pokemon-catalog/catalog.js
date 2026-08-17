const { putItemConditional, queryAllByGSI } = require('../../utils/dynamo');
const {
  HttpError,
  errorResponse,
  jsonResponse,
  parseJsonBody,
} = require('../../utils/http');

const TABLE_NAME = process.env.TABLE_NAME;

exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'GET') {
      const items = await queryAllByGSI(
        TABLE_NAME,
        'GSI1',
        'GSI1PK',
        'ENTITY#POKEMON',
      );

      const pokemons = items.map(({ pokemonId, name, type, price, createdAt }) => ({
        pokemonId,
        name,
        type,
        price,
        createdAt,
      }));

      return jsonResponse(200, pokemons);
    }

    if (event.httpMethod === 'POST') {
      const { pokemonId, name, type, price } = parseJsonBody(event);
      if (typeof pokemonId !== 'string' || !pokemonId.trim()) {
        throw new HttpError(400, 'pokemonId must be a non-empty string.');
      }
      if (typeof name !== 'string' || !name.trim()) {
        throw new HttpError(400, 'name must be a non-empty string.');
      }
      if (typeof type !== 'string' || !type.trim()) {
        throw new HttpError(400, 'type must be a non-empty string.');
      }
      if (!Number.isFinite(price) || price < 0) {
        throw new HttpError(400, 'price must be a positive number or zero.');
      }

      const normalizedPokemonId = pokemonId.trim();
      const createdAt = new Date().toISOString();
      await putItemConditional(
        TABLE_NAME,
        {
          PK: `POKEMON#${normalizedPokemonId}`,
          SK: 'DETAIL',
          GSI1PK: 'ENTITY#POKEMON',
          GSI1SK: `POKEMON#${normalizedPokemonId}`,
          entity: 'POKEMON',
          pokemonId: normalizedPokemonId,
          name: name.trim(),
          type: type.trim(),
          price,
          createdAt,
        },
        'attribute_not_exists(PK) AND attribute_not_exists(SK)',
      );

      return jsonResponse(201, {
        pokemonId: normalizedPokemonId,
        name: name.trim(),
        type: type.trim(),
        price,
        createdAt,
      });
    }

    return jsonResponse(405, { message: 'Method not allowed.' });
  } catch (error) {
    return errorResponse(error);
  }
};
