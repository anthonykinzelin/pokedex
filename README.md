# Pokedex — Lot 2

This repository deploys two independent SAM stacks:

- authentication: Cognito M2M OAuth2 with `pokedex/read` and `pokedex/write` scopes;
- referential: API Gateway, three Node.js Lambdas, and one on-demand DynamoDB table.

The stacks communicate through `/pokedex/<env>/auth/user-pool-arn` in SSM Parameter Store. There is no CloudFormation export/import dependency.

## Prerequisites

- Node.js 24 and npm
- Docker with Compose
- AWS SAM CLI
- AWS CLI and `jq`
- an AWS CLI profile for deployment

Run `make` to see the available commands.

## Test locally

### Automated test

Run the complete integration test with:

```bash
make test-local
```

It creates a user, adds a Pokemon, lists both collections, creates a purchase, and verifies the validation and `404` responses.

### Manual test with Postman

Start DynamoDB Local and the API. Keep this terminal open:

```bash
make local
```

Do not open Postman until the terminal displays:

```text
You can now browse to the above endpoints to invoke your functions.
```

The API is then available at `http://127.0.0.1:3000`. The `Authorizer ... skipping` messages are normal locally: Cognito is deliberately not enforced by SAM Local.

Then:

1. Import `postman/pokedex.postman_collection.json` into Postman.
2. Import `postman/pokedex.postman_environment.json`.
3. Select the **Pokedex Local** environment.
4. Run the complete **Pokedex Lot 2 API** collection in its numbered order.

The collection also contains a local `http://127.0.0.1:3000` fallback, but selecting **Pokedex Local** makes the active URL explicit.

The collection automatically performs this scenario:

1. skips Cognito authentication locally;
2. generates unique `user_id` and `pokemon_id` values;
3. creates the user with a balance of `100`;
4. adds a Pokemon priced at `25`;
5. verifies that both appear in their lists;
6. purchases the Pokemon for the new user.

You can also open and send each numbered Postman request manually in the same order. The `Authorization` header may remain present and empty locally; SAM Local does not enforce the Cognito authorizer unless explicitly started with authorizer support.

To add the initial Ash/Misty and Pikachu/Bulbasaur records again without rebuilding the API:

```bash
make local-seed
```

To clear every local user, Pokemon and purchase and restore only the initial data:

```bash
make local-reset
```

Stop DynamoDB Local afterward with:

```bash
make local-stop
```

### If port 3000 is already in use

`Address already in use` means the API did not start, even if the SAM build and DynamoDB setup succeeded. Stop a stale SAM process belonging to this project and restart:

```bash
make local-api-stop
make local
```

The Makefile now checks the port before doing the build, so this error is reported immediately. It refuses to stop unrelated applications. Alternatively, use another port:

```bash
make local LOCAL_PORT=3002
```

When using another port, change `api_base_url` in the selected Postman environment to:

```text
http://127.0.0.1:3002
```

You can confirm that the API is reachable before running Postman:

```bash
curl -i http://127.0.0.1:3000/users
```

### Manual test with curl

With `make local` still running, execute these commands in a second terminal:

```bash
curl -i -X POST http://127.0.0.1:3000/users \
  -H 'Content-Type: application/json' \
  -d '{"userId":"brock","username":"Brock","balance":100}'

curl -i -X POST http://127.0.0.1:3000/pokemons \
  -H 'Content-Type: application/json' \
  -d '{"pokemonId":"onix","name":"Onix","type":"rock","price":30}'

curl -i http://127.0.0.1:3000/users

curl -i http://127.0.0.1:3000/pokemons

curl -i -X POST http://127.0.0.1:3000/users/brock/purchases \
  -H 'Content-Type: application/json' \
  -d '{"pokemonId":"onix"}'
```

Expected status codes are `201` for each creation and `200` for each list. Reusing `brock` or `onix` returns `409`; run `make local-reset` or choose different IDs.

Available routes:

```text
POST /users                          create a user
GET  /users
POST /pokemons                       add a Pokemon
GET  /pokemons
POST /users/{userId}/purchases   body: { "pokemonId": "pikachu" }
```

## DynamoDB single-table model

The table uses generic `PK`/`SK` keys plus `GSI1` for entity lists:

| Entity | PK | SK | GSI1PK | GSI1SK |
|---|---|---|---|---|
| User | `USER#<id>` | `PROFILE` | `ENTITY#USER` | `USER#<id>` |
| Pokemon | `POKEMON#<id>` | `DETAIL` | `ENTITY#POKEMON` | `POKEMON#<id>` |
| Purchase | `USER#<id>` | `PURCHASE#<date>#<id>` | — | — |

This supports the API access patterns without table scans: list users and Pokemon through `GSI1`, get a user or Pokemon directly, and keep a user's purchases together. A purchase transaction atomically debits the catalog price and writes the purchase. The client cannot choose the price.

## Deploy and test with Postman

Use a configured AWS profile. All names are derived from `ENV`; `dev` is the default.

```bash
make deploy PROFILE=default REGION=eu-west-1 ENV=dev
```

This deploys authentication, then the referential service, seeds demo data, and generates:

```text
postman/pokedex.generated.postman_environment.json
```

Import that ignored generated environment together with the collection. It contains the Cognito client secret, so do not commit or share it. Select the generated environment and run the complete collection; it obtains an access token before creating the test data and calling all five endpoints.

Each service can also be updated independently:

```bash
make deploy-auth ENV=dev
make deploy-app ENV=dev
```

The app stack requires the authentication stack's SSM parameter to exist. To delete everything:

```bash
make clean-stack ENV=dev
```
