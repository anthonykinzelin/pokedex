ENV ?= dev
REGION ?= eu-west-1
PROFILE ?= germen-dev-anthonyk
AUTH_STACK := pokedex-auth-$(ENV)
APP_STACK := pokedex-app-$(ENV)

AWS := aws --region $(REGION) --profile $(PROFILE)
SAM_DEPLOY := sam deploy --resolve-s3 --capabilities CAPABILITY_IAM \
	--no-confirm-changeset --no-fail-on-empty-changeset \
	--region $(REGION) --profile $(PROFILE)

export npm_config_cache := $(CURDIR)/.npm-cache

.DEFAULT_GOAL := help
.NOTPARALLEL:

.PHONY: help validate build aws-check deploy deploy-auth deploy-app \
	postman outputs clean-stack clean-app clean-auth

help:
	@echo "make aws-check    Check the AWS account"
	@echo "make deploy       Deploy both stacks"
	@echo "make outputs      Show the deployed URLs and IDs"
	@echo "make clean-stack  Delete both stacks"

validate:
	sam validate --lint --template-file template-auth.yaml
	sam validate --lint --template-file template-pokedex.yaml

build: validate
	npm --prefix src ci
	sam build --template-file template-pokedex.yaml --build-dir .aws-sam/app

aws-check:
	@echo "Profile: $(PROFILE) | Region: $(REGION) | Environment: $(ENV)"
	@$(AWS) sts get-caller-identity --output table

deploy: aws-check
	$(MAKE) deploy-auth
	$(MAKE) deploy-app
	$(MAKE) postman
	$(MAKE) outputs

deploy-auth:
	sam build --template-file template-auth.yaml --build-dir .aws-sam/auth
	$(SAM_DEPLOY) --template-file .aws-sam/auth/template.yaml \
		--stack-name $(AUTH_STACK) --parameter-overrides Env=$(ENV)

deploy-app: build
	$(SAM_DEPLOY) --template-file .aws-sam/app/template.yaml \
		--stack-name $(APP_STACK) --parameter-overrides Env=$(ENV)

postman:
	AWS_REGION=$(REGION) AWS_PROFILE=$(PROFILE) AUTH_STACK=$(AUTH_STACK) \
		APP_STACK=$(APP_STACK) ENV=$(ENV) node scripts/create-postman-environment.js

outputs:
	@$(AWS) cloudformation describe-stacks --stack-name $(AUTH_STACK) \
		--query "Stacks[0].Outputs[].{Name:OutputKey,Value:OutputValue}" --output table
	@$(AWS) cloudformation describe-stacks --stack-name $(APP_STACK) \
		--query "Stacks[0].Outputs[].{Name:OutputKey,Value:OutputValue}" --output table

clean-app:
	sam delete --stack-name $(APP_STACK) --region $(REGION) --profile $(PROFILE) --no-prompts

clean-auth:
	sam delete --stack-name $(AUTH_STACK) --region $(REGION) --profile $(PROFILE) --no-prompts

clean-stack:
	-$(MAKE) clean-app
	-$(MAKE) clean-auth
