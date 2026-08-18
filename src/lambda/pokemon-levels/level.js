const { getItem } = require('../../utils/dynamo');
const { errorResponse, jsonResponse } = require('../../utils/http');

const TABLE_NAME = process.env.TABLE_NAME;

exports.handler = async (event) => {
  try {
    const userId = event.pathParameters?.userId?.trim();
    if (!userId) {
      return jsonResponse(400, { message: 'The userId path parameter is required.' });
    }

    const item = await getItem(TABLE_NAME, `USER#${userId}`, 'LEVEL');

    return jsonResponse(200, {
      userId,
      points: item?.points || 0,
      level: item?.level || 0,
      updatedAt: item?.updatedAt || null,
    });
  } catch (error) {
    return errorResponse(error);
  }
};
