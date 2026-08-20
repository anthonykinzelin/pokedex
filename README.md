# Pokedex — Lot 3

AWS SAM project with four stacks:

- `pokedex-auth-dev`: Cognito authentication
- `pokedex-shared-dev`: the Lambda layer with the shared utils and a pinned AWS SDK
- `pokedex-app-dev`: users, Pokemon, purchases and the EventBridge bus
- `pokedex-levels-dev`: progression API, SQS, DLQ and DynamoDB

An accepted purchase is saved first, then the referential service publishes this
event on its bus. This is the interface between the two services, so it is fixed
and must not change without updating both sides:

```text
source:      fr.pokemon.referential
detail-type: purchase.completed
detail:      { "eventVersion": "1.0",
               "purchaseId":   "9f1c3e2a-...",
               "userId":       "3eacd9de-...",
               "pokemonId":    "pikachu",
               "occurredAt":   "2026-08-20T09:14:22.000Z" }
```

The Levels stack listens to it through an EventBridge rule and an SQS queue. Each
purchase gives 100 points and one level. A `PURCHASE#<purchaseId>` item prevents a
message delivered more than once from increasing the level twice. After three
failed deliveries, SQS moves the message to the DLQ.

## The API

| Method and path | What it does |
| --- | --- |
| `GET /users` | Lists the users. |
| `POST /users` | Creates a user from a name. Body: `{ "name": "...", "balance": 100 }`. |
| `GET /pokemons` | Lists the catalog. |
| `POST /pokemons` | Adds a Pokemon. Body: `{ "name": "...", "type": "...", "price": 25 }`. |
| `POST /users/{userId}/purchases` | Records a purchase. Body: `{ "pokemonId": "..." }`. |
| `GET /users/{userId}/level` | Returns the user's points and level (Levels API). |

Status codes: `201` on creation, `400` on an invalid body, `404` when the user or
the Pokemon does not exist, `409` on a duplicate name or an insufficient balance.

### Who chooses an id

The Cognito token is issued with `client_credentials`, so it identifies the
calling *application*, not a person. There is no signed-in user whose identity
the service could read from the token. The user therefore has to be addressed as
a resource in the path, which is why the purchase route is
`POST /users/{userId}/purchases`.

That only works if the client cannot invent identities. So `POST /users` accepts
a **name** and the server returns the `userId` it generated (a UUID v4). Sending
a `userId` is rejected with `400`, rather than ignored, so a stale client fails
loudly instead of silently having its value dropped.

`POST /pokemons` follows the same rule but not the same mechanism: a Pokemon is a
catalog entry, so its id is a slug of its name (`Pokémon Éclair` →
`pokemon-eclair`). Because the id *is* derived from the unique field, a single
conditional `PutItem` is enough. A user's id is random and the uniqueness lives
on a different attribute, which is why users need the reservation item below.

### Name rules

A name is trimmed, its whitespace collapsed, and Unicode-normalised to NFC.
It must be 2 to 60 characters, start with a letter or digit, and otherwise
contain only letters, digits, spaces and `-`, `_`, `.`, `'`. `#` is excluded
because it separates the parts of every `PK` and `SK`, so no name can be crafted
to look like another item's key.

Names are compared after NFKC normalisation and lower-casing, so **`Ash` and
`ash` are the same trainer** and only one of them can exist. The name you sent is
stored and returned as you typed it; the folded value is only used for comparison.

### The reservation item

DynamoDB has no unique constraint on a non-key attribute, so uniqueness of the
name is enforced with a second item:

```text
PK = USERNAME#<folded name>    SK = RESERVATION
```

It is written in the **same `TransactWriteItems`** as the user profile, each with
`attribute_not_exists(PK)`. Two concurrent requests for the same name therefore
cannot both succeed: the loser's condition fails and, because it is a
transaction, its profile item is rolled back too, so no orphan user is left
behind. A "query an index, then insert" approach cannot promise that — it reads
before it writes, and both callers can see "not found".

On a conflict the API returns `409` with the `userId` that already owns the name,
which is what lets a client that retried after a timeout discover the user it
actually created. That is safe here because `GET /users` already exposes every
id and name to the same caller. In a system with real people's names it would be
an enumeration oracle and should be dropped.

The reservation item deliberately carries **no `GSI1PK`/`GSI1SK`**. A global
secondary index only contains items that have both of its key attributes, so
omitting them keeps reservations out of `GET /users` entirely.

## The shared layer

The utils used to be duplicated into every function package: all five functions
declared `CodeUri: src/`, so `sam build` copied the whole tree plus a full
`node_modules` into each artifact — five 48 MB artifacts per build, and any
change to one handler invalidated all of them.

Now `layers/pokedex-utils/` is built once into a Lambda layer and each function
builds from its own directory under `functions/`. A function artifact is a few KB
containing one `.js` file and its source map, and the handlers import the helpers
by name:

```ts
import { getItem, errorResponse } from 'pokedex-utils';
```

That resolves because Lambda puts `/opt/nodejs/node_modules` on `NODE_PATH`. The
layer is built with `Metadata: BuildMethod: makefile`
(`layers/pokedex-utils/Makefile`), which is what allows the package to be placed
at `nodejs/node_modules/pokedex-utils` — the runtime `BuildMethod` would put it
at `/opt/nodejs/` and force an absolute `require`.

To work outside Lambda as well — `make test`, or a plain `node` — the root
`package.json` declares `pokedex-utils` as a `file:` dependency, so npm links it
into `node_modules`. Run `npm install` once after cloning.

### Why the layer ARN is a parameter and not `{{resolve:ssm}}`

The auth stack's user-pool ARN and the referential's event-bus name are passed
between stacks with `{{resolve:ssm:...}}`. The layer ARN is not, and the
difference is deliberate.

A layer version ARN changes every time the layer content changes. Under a
transform, CloudFormation decides whether there is anything to deploy by
diffing the *template text*, and resolves a dynamic reference only when the
change set is executed. An unchanged `{{resolve:ssm:...}}` string would produce
an empty change set, and with `--no-fail-on-empty-changeset` the deploy would
report success while the functions silently kept running the previous layer
version. So the Makefile reads the ARN from SSM and passes it as
`--parameter-overrides UtilsLayerArn=...`: the parameter value really changes,
so the functions really update. The user-pool ARN and bus name are create-once
values, so that trap never applies to them.

The consequence to remember: **editing a util requires redeploying the app and
levels stacks**, not just the shared one. `make deploy` does all four in order.

## TypeScript

Handlers and utils are written in TypeScript and JavaScript is what gets
deployed. That step is not optional: Lambda's handler loader only resolves
`.js`, `.mjs` and `.cjs`, so it would never find `handler` inside `users.ts`.
Node 24 can *run* TypeScript by stripping types, but that happens too late to
help the loader.

Two different tools do the compiling, split by resource type.

**The handlers are transpiled by esbuild, inside `sam build`.** Each function
carries `Metadata: BuildMethod: esbuild`, so SAM runs esbuild itself and writes
`users.js` into `.aws-sam/`. `CodeUri` still points at the source directory and
`Handler` is still `users.handler`; no TypeScript file ever reaches an artifact.
The one line that matters most there is:

```yaml
        External:
          - pokedex-utils
```

Without it esbuild follows the import and inlines the whole layer into every
function, which quietly undoes the reason the layer exists. `Minify: false` is
also deliberate: minified output would make the `stack` field the logger writes
to CloudWatch unreadable.

**The layer is compiled by `tsc`, before `sam build` runs.** The esbuild build
method exists only for `AWS::Serverless::Function`, never for
`AWS::Serverless::LayerVersion` — and `tsc` is the right tool here anyway.
Bundling would collapse the eight modules into one file and emit no `.d.ts`,
and those `.d.ts` files are exactly what lets the handlers be type-checked
against the layer across the package boundary. `layers/pokedex-utils/dist` is
what the layer Makefile packages, and `package.json` points `main` and `types`
at it.

### esbuild does not type-check

This is the part worth remembering. esbuild strips types and never looks at
them, so on its own it would happily deploy code that does not type-check.
`make compile` runs `tsc` twice — once to emit the layer, once with `noEmit` to
check the handlers — and every `build` and `deploy-*` target depends on it. That
is the only thing standing between a type error and a deployed function.

```
make compile
  ├─ tsc -p layers/pokedex-utils   -> dist/*.js + dist/*.d.ts
  └─ tsc -p tsconfig.json          -> noEmit, checks the five handlers
```

Because the type-check resolves `pokedex-utils` through the `node_modules`
symlink to the layer's `dist`, the layer always has to be compiled first. The
Makefile sequences that; `npm run compile` does the same thing.

### What the types caught

Three changes came out of turning `strict` on, each of them a real failure mode
rather than a syntax concern:

- **`errors.ts`** — under `strict`, a caught error is `unknown`, so
  `error.name === 'TransactionCanceledException'` and `error.CancellationReasons`
  no longer compile. `isErrorNamed` and `cancellationReasons` narrow structurally
  and keep the runtime behaviour identical. Narrowing with `instanceof` against
  the SDK's exception classes was rejected on purpose: no handler imports the
  SDK, and `instanceof` returns false whenever two copies of a module end up in
  one process.
- **`requireEnv`** — `process.env.TABLE_NAME` is `string | undefined`, which
  fails at every call site that passes it to DynamoDB. Reading it through
  `requireEnv` turns a missing variable into one loud failure at module load,
  instead of an undefined table name reaching DynamoDB and coming back as a
  confusing validation error on the first request. In `purchase.ts` this also
  closed a real hole: `EVENT_BUS_NAME` was only checked inside `publishEvent`,
  whose throw is deliberately swallowed so a Levels outage cannot fail a
  committed purchase — which meant a misconfigured bus would have let purchases
  succeed while no event was ever published.
- **`SQSHandler`** — typing the consumer verifies the
  `{ batchItemFailures: [{ itemIdentifier }] }` shape that
  `FunctionResponseTypes: ReportBatchItemFailures` depends on. Misspell that key
  and partial batch failures silently stop being reported; now it fails the
  build.

Source maps are on (`Sourcemap: true`, plus `NODE_OPTIONS:
--enable-source-maps` in `Globals`) with the TypeScript source embedded, so a
stack trace in CloudWatch points at the `.ts` line rather than the transpiled
one.

## Requirements

- Node.js 24 and npm
- AWS CLI
- AWS SAM CLI
- AWS profile `germen-dev-anthonyk`

The default region is `eu-west-1` and the default environment is `dev`.

## Deploy

Log in again if the AWS SSO session has expired:

```bash
aws sso login --profile germen-dev-anthonyk
```

Install the local dev link once, and check the AWS account:

```bash
npm install
make aws-check
```

Deploy the complete project:

```bash
make deploy
```

The stacks are deployed in this order: authentication, shared, referential, then
Levels. They share the values they need through SSM:

```text
/pokedex/dev/auth/user-pool-arn
/pokedex/dev/auth/resource-server-id
/pokedex/dev/shared/utils-layer-arn
/pokedex/dev/referential/event-bus-name
```

SAM creates or reuses its managed S3 bucket to upload the layer and the Lambda
packages.

## Test with Postman

The deployment generates:

- `postman/pokedex.generated.postman_collection.json`
- `postman/pokedex.generated.postman_environment.json`

Import both files, select **Pokedex dev**, then use **Run collection**.

The collection gets a Cognito token, creates a user from a name and captures the
id the server returned, checks that a duplicate name and a client-supplied
`userId` are both rejected, creates a Pokemon, makes a purchase, then waits for
the asynchronous processing and checks the user's level.

`user_id` and `pokemon_id` are set at run time by the collection and are
deliberately **not** written into the generated environment: an environment
variable takes precedence over a collection variable in Postman, so an empty one
would shadow the captured id. Re-run `make postman` if you still have an older
generated environment.

The generated environment contains the Cognito client secret and is ignored by Git.

## Unit tests

```bash
make test
```

`node --test` ships with Node 24, so there is no test dependency to install. The
tests cover the pure logic: name normalisation and folding, the slug, the
validation helpers, and the mapping from an error to an HTTP response.

The suites are plain JavaScript and load `pokedex-utils` the same way a handler
does, which means they exercise the compiled layer rather than the TypeScript
sources. `make test` depends on `make compile` for that reason.

## Logs

Handlers log one JSON object per line, so CloudWatch Logs Insights can filter on
any field. `LOG_LEVEL` (`debug`, `info`, `warn`, `error`) defaults to `info`.

```text
fields @timestamp, level, message, route, requestId, userId
| filter route = "users"
| sort @timestamp desc
```

Every response carries an API Gateway request id in `x-amzn-RequestId`, and it is
logged as `apiRequestId`, so a failing call can be traced from the client.

## Other commands

```bash
make compile        # compile the layer and type-check the handlers
make deploy-auth    # deploy Cognito only
make deploy-shared  # publish a new version of the utils layer
make deploy-app     # deploy the referential service only
make deploy-levels  # deploy the Levels service only
make layer-arn      # print the layer ARN currently in SSM
make outputs        # show stack outputs
make test           # run the unit tests
make clean-stack    # delete the four stacks and prune retained layer versions
make clean-dist     # remove the compiled layer output
```

The layer is declared `RetentionPolicy: Retain`, because SAM replaces the layer
resource on every content change and CloudFormation cannot delete a layer
version that a deployed function still references. Retained versions therefore
accumulate; `make clean-layers` removes them, and `make clean-stack` runs it
after both consumer stacks are gone.

To check that purchases do not depend on Levels, run `make clean-levels` and send
the Postman requests up to **8 - Purchase Pokemon**. The purchase still returns
`201` because the event bus belongs to the referential stack and does not depend
on its consumers.
