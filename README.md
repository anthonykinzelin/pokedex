# Pokedex — Lot 2

The project deploys two AWS SAM stacks:

- `pokedex-auth-dev`: Cognito authentication;
- `pokedex-app-dev`: API Gateway, three Lambdas and one DynamoDB table.

Default configuration:

```text
AWS profile: germen-dev-anthonyk
Region:      eu-west-1
Environment: dev
```

## Requirements

- Node.js 24 and npm
- Docker
- AWS CLI and SAM CLI
- the `germen-dev-anthonyk` AWS profile

## 1. Test locally

Run the automated test:

```bash
make test-local
```

For a manual Postman test, start the API:

```bash
make local
```

Import and run these files in their numbered order:

- `postman/pokedex.postman_collection.json`
- `postman/pokedex.postman_environment.json`

Stop the local services with:

```bash
make local-stop
```

## 2. Check AWS access

If the AWS SSO session has expired:

```bash
aws sso login --profile germen-dev-anthonyk
```

Check the account that will receive the resources:

```bash
make aws-check
```

## 3. Deploy everything

```bash
make deploy
```

This command deploys Cognito first, then the API, Lambdas and DynamoDB. It also generates the deployed Postman collection and environment, then prints the stack outputs.

## 4. Test AWS with Postman

Import:

- `postman/pokedex.generated.postman_collection.json`
- `postman/pokedex.generated.postman_environment.json`

Select **Pokedex dev** and run the generated collection in order. It contains every available operation:

1. get a Cognito M2M token;
2. create a user;
3. add a Pokemon;
4. list users;
5. list Pokemon;
6. create a purchase;
7. list users again and verify the purchased Pokemon is owned by the user.

The generated environment contains the Cognito client secret. Both generated files are ignored by Git and can be recreated by running `make deploy` again.

## Useful commands

```bash
make deploy-auth  # deploy only Cognito
make deploy-app   # deploy only the API, Lambdas and DynamoDB
make outputs      # display deployed URLs and IDs
make clean-stack  # delete both AWS stacks
```

API routes:

```text
POST /users
GET  /users
POST /pokemons
GET  /pokemons
POST /users/{userId}/purchases
```

`GET /users` returns each user with a `pokemons` array containing the Pokemon acquired through purchases.
