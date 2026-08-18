# Pokedex — Lot 2

AWS SAM project with two stacks:

- `pokedex-auth-dev`: Cognito authentication;
- `pokedex-app-dev`: API Gateway, Lambda and DynamoDB.

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

The authentication stack is deployed first. It stores the Cognito user-pool ARN in:

```text
/pokedex/dev/auth/user-pool-arn
```

The application stack reads this SSM parameter when it configures the API Gateway authorizer. SAM creates or reuses its managed S3 bucket to upload the Lambda packages.

## Test with Postman

The deployment generates:

- `postman/pokedex.generated.postman_collection.json`
- `postman/pokedex.generated.postman_environment.json`

Import both files, select **Pokedex dev**, and run the requests in order.

The collection gets a Cognito token, creates a user and a Pokemon, lists the data, creates a purchase, and checks that the Pokemon belongs to the user.

The generated environment contains the Cognito client secret and is ignored by Git.

## Other commands

```bash
make deploy-auth  # deploy Cognito only
make deploy-app   # deploy the API, Lambda and DynamoDB only
make outputs      # show stack outputs
make clean-stack  # delete both stacks
```
