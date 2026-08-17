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

The shortest automated check is:

```bash
make test-local
```

It installs dependencies, validates and builds the SAM application, starts DynamoDB Local, creates and seeds the table, starts the API, and verifies success and error responses. Stop the database afterward with:

```bash
make local-stop
```

For interactive testing with curl or Postman, keep the local API running:

```bash
make local
```

Import these files in Postman and run the collection in order:

- `postman/pokedex.postman_collection.json`
- `postman/pokedex.postman_environment.json`

The token request is skipped locally because SAM Local does not enforce the Cognito authorizer by default.

The required routes are:

```text
GET  /users
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

Import that ignored generated environment together with the collection. It contains the Cognito client secret, so do not commit or share it. Select the generated environment and run the complete collection; it obtains an access token before calling all three endpoints.

Each service can also be updated independently:

```bash
make deploy-auth ENV=dev
make deploy-app ENV=dev
```

The app stack requires the authentication stack's SSM parameter to exist. To delete everything:

```bash
make clean-stack ENV=dev
```
