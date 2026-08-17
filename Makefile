S3_BUCKET := your-s3-bucket-name
AUTH_STACK := pokedex-auth
APP_STACK := pokedex-app
PROFILE := default
REGION := eu-west-1

.PHONY: build package deploy-auth deploy-app local create-bucket clean-stack

create-bucket:
    aws s3 mb s3://$(S3_BUCKET) --region $(REGION)

build:
    sam build --use-container

package: build
    sam package --s3-bucket $(S3_BUCKET) --output-template-file packaged.yaml --region $(REGION) --profile $(PROFILE)

deploy-auth:
    sam build --template-file template-auth.yaml
    sam package --template-file .aws-sam/build/template-auth.yaml --output-template-file packaged-auth.yaml --s3-bucket $(S3_BUCKET) --region $(REGION) --profile $(PROFILE)
    sam deploy --template-file packaged-auth.yaml --stack-name $(AUTH_STACK) --capabilities CAPABILITY_IAM --region $(REGION) --profile $(PROFILE)

deploy-app: deploy-auth
    @echo "Reading CFN outputs from auth stack..."
    $(eval UPID=$(shell aws cloudformation describe-stacks --stack-name $(AUTH_STACK) --region $(REGION) --query "Stacks[0].Outputs[?OutputKey=='UserPoolId'].OutputValue" --output text))
    $(eval UPCID=$(shell aws cloudformation describe-stacks --stack-name $(AUTH_STACK) --region $(REGION) --query "Stacks[0].Outputs[?OutputKey=='UserPoolClientId'].OutputValue" --output text))
    $(eval UPARN=$(shell aws cloudformation describe-stacks --stack-name $(AUTH_STACK) --region $(REGION) --query "Stacks[0].Outputs[?OutputKey=='UserPoolArn'].OutputValue" --output text))
    sam build --template-file template-pokedex.yaml
    sam package --template-file .aws-sam/build/template-pokedex.yaml --output-template-file packaged.yaml --s3-bucket $(S3_BUCKET) --region $(REGION) --profile $(PROFILE)
    sam deploy --template-file packaged.yaml --stack-name $(APP_STACK) --parameter-overrides UserPoolId=$(UPID) UserPoolClientId=$(UPCID) UserPoolArn=$(UPARN) --capabilities CAPABILITY_IAM --region $(REGION) --profile $(PROFILE)

local:
    sam local start-api --env-vars env.json

clean-stack:
    @echo "Deleting app stack: $(APP_STACK)"
    sam delete --stack-name $(APP_STACK) --region $(REGION) --no-prompts || true
    @echo "Deleting auth stack: $(AUTH_STACK)"
    sam delete --stack-name $(AUTH_STACK) --region $(REGION) --no-prompts || true