const { putItem } = require('../src/utils/dynamo');

const tableName = process.env.TABLE_NAME;
if (!tableName) {
  throw new Error('TABLE_NAME is required.');
}

const createdAt = '2026-01-01T00:00:00.000Z';
const items = [
  {
    PK: 'USER#ash',
    SK: 'PROFILE',
    GSI1PK: 'ENTITY#USER',
    GSI1SK: 'USER#ash',
    entity: 'USER',
    userId: 'ash',
    username: 'Ash Ketchum',
    balance: 10000,
    pokemons: [],
    createdAt,
  },
  {
    PK: 'USER#misty',
    SK: 'PROFILE',
    GSI1PK: 'ENTITY#USER',
    GSI1SK: 'USER#misty',
    entity: 'USER',
    userId: 'misty',
    username: 'Misty',
    balance: 10000,
    pokemons: [],
    createdAt,
  },
  {
    PK: 'POKEMON#pikachu',
    SK: 'DETAIL',
    GSI1PK: 'ENTITY#POKEMON',
    GSI1SK: 'POKEMON#pikachu',
    entity: 'POKEMON',
    pokemonId: 'pikachu',
    name: 'Pikachu',
    type: 'electric',
    price: 25,
    createdAt,
  },
  {
    PK: 'POKEMON#bulbasaur',
    SK: 'DETAIL',
    GSI1PK: 'ENTITY#POKEMON',
    GSI1SK: 'POKEMON#bulbasaur',
    entity: 'POKEMON',
    pokemonId: 'bulbasaur',
    name: 'Bulbasaur',
    type: 'grass',
    price: 20,
    createdAt,
  },
];

Promise.all(items.map((item) => putItem(tableName, item)))
  .then(() => {
    console.log(`Seeded ${items.length} items in ${tableName}.`);
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
