const { documentClient } = require('../../utils/aws');
console.log('documentClient keys:', Object.keys(documentClient));
console.log('typeof put:', typeof documentClient.put);
console.log('typeof get:', typeof documentClient.get);
console.log('typeof query:', typeof documentClient.query);
console.log('typeof transactWrite:', typeof documentClient.transactWrite);
console.log('typeof send:', typeof documentClient.send);
console.log('documentClient.constructor.name:', documentClient.constructor && documentClient.constructor.name);
