const { spawnSync } = require('node:child_process');
const { readFileSync, writeFileSync } = require('node:fs');
const { resolve } = require('node:path');

const region = process.env.AWS_REGION || 'eu-west-1';
const profile = process.env.AWS_PROFILE || 'default';
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
  const raw = aws(
    'cloudformation',
    'describe-stacks',
    '--stack-name', stackName,
    '--query', 'Stacks[0].Outputs',
    '--output', 'json',
  );
  return Object.fromEntries(
    JSON.parse(raw).map(({ OutputKey, OutputValue }) => [OutputKey, OutputValue]),
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

const templatePath = resolve('postman/pokedex.postman_environment.json');
const outputPath = resolve('postman/pokedex.generated.postman_environment.json');
const environment = JSON.parse(readFileSync(templatePath, 'utf8'));
const values = {
  api_base_url: app.ApiUrl,
  auth_domain: auth.AuthDomain,
  client_id: auth.UserPoolClientId,
  client_secret: clientSecret,
  scope: 'pokedex/read pokedex/write',
  env: environmentName,
  region,
  access_token: '',
  user_id: 'ash',
  pokemon_id: 'pikachu',
};

environment.name = `Pokedex ${environmentName}`;
for (const variable of environment.values) {
  if (Object.hasOwn(values, variable.key)) {
    variable.value = values[variable.key];
  }
}

writeFileSync(outputPath, `${JSON.stringify(environment, null, 2)}\n`, { mode: 0o600 });
console.log(`Generated ${outputPath}`);
console.log('This ignored file contains the Cognito client secret; do not commit it.');
