const { getItem, putItemConditional, queryByPK } = require('../../utils/dynamo');

const TABLE = process.env.TABLE_NAME;

exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'GET') {
      const qs = event.queryStringParameters || {};
      if (!qs.id) return { statusCode: 400, body: JSON.stringify({ message: 'id required' }) };
      const pk = `USER#${qs.id}`;
      const sk = `META#${qs.id}`;
      const item = await getItem(TABLE, pk, sk);
      return { statusCode: 200, body: JSON.stringify(item || {}) };
    }

    if (event.httpMethod === 'POST') {
      const body = event.body ? JSON.parse(event.body) : {};
      const { userId, username, balance = 0 } = body;
      if (!userId || !username) return { statusCode: 400, body: JSON.stringify({ message: 'userId and username required' }) };

      const item = {
        PK: `USER#${userId}`,
        SK: `META#${userId}`,
        entity: 'USER',
        userId,
        username,
        balance,
        createdAt: new Date().toISOString()
      };

      await putItemConditional(TABLE, item, 'attribute_not_exists(PK)', null);
      return { statusCode: 201, body: JSON.stringify({ userId }) };
    }

    return { statusCode: 405, body: JSON.stringify({ message: 'Method not allowed' }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ message: err.message }) };
  }
};