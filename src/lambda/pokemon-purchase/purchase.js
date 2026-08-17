const { transactWrite } = require('../../utils/dynamo');

const TABLE = process.env.TABLE_NAME;

exports.handler = async (event) => {
  try {
    const body = event.body ? JSON.parse(event.body) : {};
    const { userId, pokemonId, price, purchaseId } = body;
    if (!userId || !pokemonId || typeof price !== 'number') {
      return { statusCode: 400, body: JSON.stringify({ message: 'userId, pokemonId, price required' }) };
    }
    const txId = purchaseId || `tx-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;

    const userPK = `USER#${userId}`;
    const userSK = `META#${userId}`;

    const ownershipPK = userPK;
    const ownershipSK = `POKEMON#${pokemonId}`;

    const purchasePK = `PURCHASE#${txId}`;
    const purchaseSK = `META#${txId}`;

    const TransactItems = [
      {
        Update: {
          TableName: TABLE,
          Key: { PK: userPK, SK: userSK },
          UpdateExpression: 'SET balance = balance - :price',
          ConditionExpression: 'balance >= :price',
          ExpressionAttributeValues: { ':price': price }
        }
      },
      {
        Put: {
          TableName: TABLE,
          Item: {
            PK: ownershipPK,
            SK: ownershipSK,
            entity: 'OWNERSHIP',
            acquiredAt: new Date().toISOString()
          },
          ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)'
        }
      },
      {
        Put: {
          TableName: TABLE,
          Item: {
            PK: purchasePK,
            SK: purchaseSK,
            entity: 'PURCHASE',
            userId,
            pokemonId,
            amount: price,
            createdAt: new Date().toISOString()
          },
          ConditionExpression: 'attribute_not_exists(PK)'
        }
      }
    ];

    await transactWrite(TransactItems);
    return { statusCode: 200, body: JSON.stringify({ purchaseId: txId }) };
  } catch (err) {
    const code = (err.name === 'TransactionCanceledException') ? 409 : 500;
    return { statusCode: code, body: JSON.stringify({ message: err.message }) };
  }
};