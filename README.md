# Pokedex Serverless

A serverless Pokedex on AWS: a catalog, purchases, a progression that follows
them, and badges validated by a person.

Four services, each its own CloudFormation stack, coupled only by events and by
SSM parameters:

| Stack | Service |
| --- | --- |
| `pokedex-auth-dev` | Cognito, machine-to-machine tokens |
| `pokedex-shared-dev` | the Lambda layer with the shared utils |
| `pokedex-app-dev` | referential: users, Pokemon, purchases |
| `pokedex-levels-dev` | progression: points and levels |
| `pokedex-badges-dev` | badges, with a Step Functions human approval |

A purchase makes a user progress, and a progression opens the right to a badge —
without the referential knowing that either of them exists.

> **Looking for the why rather than the how?**
> [`docs/`](docs/README.md) is a full tutorial, in French, that explains every
> part of the project from scratch: the AWS basics, each service, each rule, and
> the reasoning behind every design decision. Start there if anything below looks
> unfamiliar.

## The API

Three APIs, one Cognito user pool, so one token works everywhere.

| Method and path | What it does |
| --- | --- |
| `GET /users` | Lists the users. |
| `POST /users` | Creates a user from a name. Body: `{ "name": "...", "balance": 1000 }`. |
| `GET /pokemons` | Lists the catalog. |
| `POST /pokemons` | Adds a Pokemon. Body: `{ "name": "...", "type": "...", "price": 10 }`. |
| `POST /users/{userId}/purchases` | Records a purchase. Body: `{ "pokemonId": "..." }`. |
| `GET /users/{userId}/level` | Points and level (Levels API). |
| `GET /users/{userId}/badges` | The user's badges (Badges API). |
| `POST /users/{userId}/badges/{badgeId}/decision` | Grants or refuses a badge. Body: `{ "decision": "GRANTED", "reason": "..." }`. |

Every route needs a Bearer token, and the scope that matches: `pokedex/read` to
read, `pokedex/write` to write.

Status codes: `201` on creation, `202` when a decision is accepted but not yet
applied, `400` on an invalid body, `401` without a valid token, `403` on a missing
scope, `404` when the resource does not exist, `409` on a conflict (duplicate
name, insufficient balance, badge already decided).

A purchase is worth 50 points and a level is 100 points, so one purchase in two
crosses a level. Badges exist for levels 1, 2 and 4.

## Requirements

- Node.js 24 and npm
- AWS CLI
- AWS SAM CLI
- AWS profile `germen-dev-anthonyk`

The default region is `eu-west-1` and the default environment is `dev`. Both are
`Makefile` variables (`REGION`, `ENV`, `PROFILE`).

## Deploy

Log in again if the AWS SSO session has expired:

```bash
aws sso login --profile germen-dev-anthonyk
```

Install the local dev link once, and check which account you are talking to:

```bash
npm install
make aws-check
```

Deploy everything:

```bash
make deploy
```

The stacks go out in dependency order — auth, shared, referential, Levels,
Badges — and share what they need through SSM:

```text
/pokedex/dev/auth/user-pool-arn
/pokedex/dev/auth/resource-server-id
/pokedex/dev/shared/utils-layer-arn
/pokedex/dev/referential/event-bus-name
/pokedex/dev/levels/event-bus-name
```

Then, to see the URLs and IDs:

```bash
make outputs
```

## Test with Postman

`make deploy` generates two files (the environment holds the Cognito client
secret and is ignored by Git):

```
postman/pokedex.generated.postman_collection.json
postman/pokedex.generated.postman_environment.json
```

Import both, select **Pokedex dev**, then **Run collection** — not the requests
one by one, since several of them depend on values captured earlier.

The run gets a token, creates a user and a Pokemon, makes four purchases, and
walks the whole badge lifecycle: pending, granted, a rejected second decision,
then a refusal on the next level. Requests that wait for an event to travel call
themselves back up to fifteen times, so seeing one appear several times in the
report is expected.

To regenerate the files without redeploying:

```bash
make postman
```

### Seeing a badge expire

The expiry branch needs the decision deadline to actually pass, so it is a manual
check. Redeploy with a short deadline, reach a level, and decide nothing:

```bash
make deploy-badges DECISION_TIMEOUT=60
# run the collection up to request 12, then stop and wait ~90 seconds
# GET /users/{userId}/badges  ->  status EXPIRED
```

The Step Functions console shows the execution went through
`RegisterDecision → Catch States.Timeout → ExpireBadge`.

## Unit tests

```bash
make test
```

`node --test` ships with Node 24, so there is nothing to install. The suites
cover the pure logic: name normalisation, the slug, the validation helpers, the
error-to-HTTP mapping, the level thresholds, and the badge catalog and execution
naming.

## Commands

```bash
make compile        # compile the layer and type-check the handlers
make validate       # sam validate --lint on the five templates
make build          # offline build of the five stacks, no AWS call
make test           # run the unit tests
make aws-check      # show the account and identity in use

make deploy         # the five stacks, then Postman, then the outputs
make deploy-auth    # Cognito only
make deploy-shared  # publish a new version of the utils layer
make deploy-app     # the referential only
make deploy-levels  # the Levels service only
make deploy-badges  # the Badges service only

make layer-arn      # print the layer ARN currently in SSM
make outputs        # show every stack's outputs
make postman        # regenerate the collection and environment

make clean-stack    # delete the five stacks and prune retained layer versions
make clean-badges   # delete one service
make clean-dist     # remove the compiled layer output
```

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| `Token has expired and refresh failed` | SSO session over. `aws sso login --profile germen-dev-anthonyk`. |
| `401` on every route | Token expired (one hour). Replay request 1 of the collection. |
| `403` on one route | Valid token, missing scope. |
| `make deploy` succeeds but nothing changed | Edited a layer helper? The consumer stacks need redeploying too — `make deploy` does it in order. |
| A badge stays `PENDING` | Expected: it is waiting for a person. A problem only if `awaitingDecision` stays `false`. |
| A badge stays `PENDING` with `awaitingDecision: false` | Its workflow failed. Fix, redeploy, then `aws stepfunctions redrive-execution` — see the docs. |
| A purchase works but the level never moves | Walk the chain: publisher logs, then the EventBridge rule, then the queue, then the DLQ. |
| `Cannot find esbuild` | You ran `sam build` directly instead of going through `make`. |

[`docs/08-exploitation-et-debug.md`](docs/08-exploitation-et-debug.md) covers all
of these in detail, with the CloudWatch queries and the DLQ replay procedure.

## Repository layout

```
template-auth.yaml       Cognito
template-shared.yaml     the Lambda layer
template-pokedex.yaml    the referential
template-levels.yaml     Levels
template-badges.yaml     Badges
statemachine/            the badge validation workflow, in ASL
functions/               one directory per Lambda, TypeScript
layers/pokedex-utils/    shared helpers and pure domain logic
tests/                   node --test suites over the pure logic
postman/                 the collection, and the generator's output
scripts/                 the Postman environment generator
docs/                    the full tutorial (French)
```

Handlers and helpers are written in TypeScript; JavaScript is what gets deployed.
`tsc` type-checks everything before any build, because the esbuild step inside
`sam build` does not check types at all — see
[`docs/05-iac-sam-et-build.md`](docs/05-iac-sam-et-build.md).
