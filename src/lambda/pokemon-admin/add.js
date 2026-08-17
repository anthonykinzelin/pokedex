const { putItemConditional } = require('../../utils/dynamo');
const {
  HttpError,
  errorResponse,
  jsonResponse,
  parseJsonBody,
} = require('../../utils/http');

const TABLE_NAME = process.env.TABLE_NAME;

// Kept as an optional development handler. It is not exposed by the Lot 2 API.
exports.handler = async (event) => {
  try {
    const { pokemonId, name, type, price = 0 } = parseJsonBody(event);
    if (!pokemonId || !name || !Number.isFinite(price) || price < 0) {
      throw new HttpError(400, 'pokemonId, name and a positive numeric price are required.');
    }

    const item = {
      PK: `POKEMON#${pokemonId}`,
      SK: 'DETAIL',
      GSI1PK: 'ENTITY#POKEMON',
      GSI1SK: `POKEMON#${pokemonId}`,
      entity: 'POKEMON',
      pokemonId,
      name,
      type,
      price,
      createdAt: new Date().toISOString(),
    };

    await putItemConditional(
      TABLE_NAME,
      item,
      'attribute_not_exists(PK) AND attribute_not_exists(SK)',
    );

    return jsonResponse(201, { pokemonId });
  } catch (error) {
    return errorResponse(error);
  }
};
