const { spawnSync } = require('node:child_process');
const { readFileSync, writeFileSync } = require('node:fs');
const { resolve } = require('node:path');

const region = process.env.AWS_REGION || 'eu-west-1';
const profile = process.env.AWS_PROFILE || 'germen-dev-anthonyk';
const authStack = process.env.AUTH_STACK || 'pokedex-auth-dev';
const appStack = process.env.APP_STACK || 'pokedex-app-dev';
const environmentName = process.env.ENV || 'dev';

function aws(...args) {
  const result = spawnSync(
    'aws',
    ['--region', region, '--profile', profile, ...args],
    { encoding: 'utf8' },
  );

  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `AWS CLI failed: ${args.join(' ')}`);
  }
  return result.stdout.trim();
}

function stackOutputs(stackName) {
  const outputs = aws(
    'cloudformation',
    'describe-stacks',
    '--stack-name', stackName,
    '--query', 'Stacks[0].Outputs',
    '--output', 'json',
  );

  return Object.fromEntries(
    JSON.parse(outputs).map(({ OutputKey, OutputValue }) => [OutputKey, OutputValue]),
  );
}

const auth = stackOutputs(authStack);
const app = stackOutputs(appStack);
const clientSecret = aws(
  'cognito-idp',
  'describe-user-pool-client',
  '--user-pool-id', auth.UserPoolId,
  '--client-id', auth.UserPoolClientId,
  '--query', 'UserPoolClient.ClientSecret',
  '--output', 'text',
);

const environment = {
  name: `Pokedex ${environmentName}`,
  values: [
    { key: 'api_base_url', value: app.ApiUrl, enabled: true },
    { key: 'auth_domain', value: auth.AuthDomain, enabled: true },
    { key: 'client_id', value: auth.UserPoolClientId, enabled: true },
    { key: 'client_secret', value: clientSecret, enabled: true, type: 'secret' },
    { key: 'scope', value: 'pokedex/read pokedex/write', enabled: true },
    { key: 'access_token', value: '', enabled: true, type: 'secret' },
    { key: 'user_id', value: '', enabled: true },
    { key: 'pokemon_id', value: '', enabled: true },
  ],
  _postman_variable_scope: 'environment',
};

const collection = JSON.parse(
  readFileSync(resolve('postman/pokedex.postman_collection.json'), 'utf8'),
);
collection.info.name = `Pokedex ${environmentName}`;

writeFileSync(
  resolve('postman/pokedex.generated.postman_collection.json'),
  `${JSON.stringify(collection, null, 2)}\n`,
);
writeFileSync(
  resolve('postman/pokedex.generated.postman_environment.json'),
  `${JSON.stringify(environment, null, 2)}\n`,
  { mode: 0o600 },
);

console.log('Postman collection and environment generated.');
