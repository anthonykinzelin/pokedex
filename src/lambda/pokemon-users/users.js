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
        'ENTITY#USER',
      );

      const users = items.map(({ userId, username, balance, createdAt }) => ({
        userId,
        username,
        balance,
        createdAt,
      }));

      return jsonResponse(200, users);
    }

    if (event.httpMethod === 'POST') {
      const { userId, username, balance = 0 } = parseJsonBody(event);
      if (typeof userId !== 'string' || !userId.trim()) {
        throw new HttpError(400, 'userId must be a non-empty string.');
      }
      if (typeof username !== 'string' || !username.trim()) {
        throw new HttpError(400, 'username must be a non-empty string.');
      }
      if (!Number.isFinite(balance) || balance < 0) {
        throw new HttpError(400, 'balance must be a positive number or zero.');
      }

      const normalizedUserId = userId.trim();
      const createdAt = new Date().toISOString();
      await putItemConditional(
        TABLE_NAME,
        {
          PK: `USER#${normalizedUserId}`,
          SK: 'PROFILE',
          GSI1PK: 'ENTITY#USER',
          GSI1SK: `USER#${normalizedUserId}`,
          entity: 'USER',
          userId: normalizedUserId,
          username: username.trim(),
          balance,
          createdAt,
        },
        'attribute_not_exists(PK) AND attribute_not_exists(SK)',
      );

      return jsonResponse(201, {
        userId: normalizedUserId,
        username: username.trim(),
        balance,
        createdAt,
      });
    }

    return jsonResponse(405, { message: 'Method not allowed.' });
  } catch (error) {
    return errorResponse(error);
  }
};
