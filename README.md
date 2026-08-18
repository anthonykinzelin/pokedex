# Pokedex — Lot 3

AWS SAM project with three stacks:

- `pokedex-auth-dev`: Cognito authentication
- `pokedex-app-dev`: users, Pokemon, purchases and the EventBridge bus
- `pokedex-levels-dev`: progression API, SQS, DLQ and DynamoDB

An accepted purchase is saved first, then the referential service publishes this
event on its bus:

```text
source:      fr.pokemon.referential
detail-type: purchase.completed
```

The Levels stack listens to it through an EventBridge rule and an SQS queue. Each
purchase gives 100 points and one level. A `PURCHASE#<purchaseId>` item prevents a
message delivered more than once from increasing the level twice. After three
failed deliveries, SQS moves the message to the DLQ.

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

Check the AWS account:

```bash
make aws-check
```

Deploy the complete project:

```bash
make deploy
```

The stacks are deployed in this order: authentication, referential, then Levels.
The first two stacks share the required values through SSM:

```text
/pokedex/dev/auth/user-pool-arn
/pokedex/dev/referential/event-bus-name
```

The Levels template reads these parameters to use the same Cognito user pool and
attach its rule to the referential event bus. SAM creates or reuses its managed S3
bucket to upload the Lambda packages.

## Test with Postman

The deployment generates:

- `postman/pokedex.generated.postman_collection.json`
- `postman/pokedex.generated.postman_environment.json`

Import both files, select **Pokedex dev**, then use **Run collection**.

The collection gets a Cognito token, creates a user and a Pokemon, makes a
purchase, then waits for the asynchronous processing and checks the user's level.

The generated environment contains the Cognito client secret and is ignored by Git.

## Other commands

```bash
make deploy-auth  # deploy Cognito only
make deploy-app    # deploy the referential service only
make deploy-levels  # deploy the Levels service only
make outputs       # show stack outputs
make clean-stack   # delete all three stacks
```

To check that purchases do not depend on Levels, run `make clean-levels` and send
the Postman requests up to **6 - Purchase Pokemon**. The purchase still returns
`201` because the event bus belongs to the referential stack and does not depend on
its consumers.
