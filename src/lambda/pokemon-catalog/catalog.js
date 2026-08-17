const { getItem, queryByGSI } = require('../../utils/dynamo');

const TABLE = process.env.TABLE_NAME;
const GSI1 = 'GSI1';

exports.handler = async (event) => {
  try {
    const qs = event.queryStringParameters || {};
    if (qs.id) {
      const pk = `POKEMON#${qs.id}`;
      const sk = `META#${qs.id}`;
      const item = await getItem(TABLE, pk, sk);
      return { statusCode: 200, body: JSON.stringify(item || {}) };
    }

    // list all pokemons via GSI1
    const res = await queryByGSI(TABLE, GSI1, 'GSI1PK', 'ENTITY#POKEMON');
    const items = res.Items || [];
    return { statusCode: 200, body: JSON.stringify(items) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ message: err.message }) };
  }
};