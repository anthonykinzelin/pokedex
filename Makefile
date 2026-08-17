ENV ?= dev
REGION ?= eu-west-1
PROFILE ?= default
AUTH_STACK ?= pokedex-auth-$(ENV)
APP_STACK ?= pokedex-app-$(ENV)
LOCAL_PORT ?= 3000
TEST_PORT ?= 3001
LOCAL_NETWORK ?= pokedex-local

export npm_config_cache := $(CURDIR)/.npm-cache

AWS := aws --region $(REGION) --profile $(PROFILE)
SAM_DEPLOY := sam deploy --resolve-s3 --capabilities CAPABILITY_IAM --no-confirm-changeset --no-fail-on-empty-changeset --region $(REGION) --profile $(PROFILE)

.DEFAULT_GOAL := help
.NOTPARALLEL:

.PHONY: help install validate build check-local-port local-prepare local local-seed local-reset local-api-stop local-stop test-local deploy deploy-auth deploy-app seed-remote postman-env clean-stack clean-app clean-auth

help:
	@echo "Pokedex Lot 2"
	@echo "  make test-local    Run a complete local integration test"
	@echo "  make local         Start DynamoDB Local and the API on port $(LOCAL_PORT)"
	@echo "  make local-seed    Start/seed only the local DynamoDB table"
	@echo "  make local-reset   Clear and recreate the local DynamoDB table"
	@echo "  make local-api-stop Stop a stale SAM API from this project"
	@echo "  make local-stop    Stop the local API and DynamoDB Local"
	@echo "  make validate      Validate both SAM templates"
	@echo "  make build         Build the referential Lambdas"
	@echo "  make deploy        Deploy both stacks, seed data, generate Postman env"
	@echo "  make deploy-auth   Deploy only the authentication stack"
	@echo "  make deploy-app    Deploy only the referential stack"
	@echo "  make clean-stack   Delete both stacks"

install:
	npm --prefix src ci

validate:
	sam validate --lint --template-file template-auth.yaml
	sam validate --lint --template-file template-pokedex.yaml

build: install validate
	sam build --template-file template-pokedex.yaml --build-dir .aws-sam/app

local-seed:
	docker compose up -d dynamodb-local
	AWS_ACCESS_KEY_ID=local AWS_SECRET_ACCESS_KEY=local AWS_DEFAULT_REGION=$(REGION) \
		./scripts/prepare-local-db.sh pokedex-local-data

local-reset:
	docker compose down
	$(MAKE) local-seed

local-prepare: build local-seed

check-local-port:
	@./scripts/check-local-port.sh $(LOCAL_PORT)

local: check-local-port local-prepare
	sam local start-api --template-file .aws-sam/app/template.yaml --env-vars env.json \
		--docker-network $(LOCAL_NETWORK) --port $(LOCAL_PORT)

test-local: local-prepare
	LOCAL_PORT=$(TEST_PORT) LOCAL_NETWORK=$(LOCAL_NETWORK) ./scripts/test-local.sh

local-api-stop:
	@./scripts/stop-local-api.sh $(LOCAL_PORT)

local-stop: local-api-stop
	docker compose down

deploy:
	$(MAKE) deploy-auth
	$(MAKE) deploy-app
	$(MAKE) seed-remote
	$(MAKE) postman-env

deploy-auth:
	sam build --template-file template-auth.yaml --build-dir .aws-sam/auth
	$(SAM_DEPLOY) --template-file .aws-sam/auth/template.yaml --stack-name $(AUTH_STACK) \
		--parameter-overrides Env=$(ENV)

deploy-app: build
	$(SAM_DEPLOY) --template-file .aws-sam/app/template.yaml --stack-name $(APP_STACK) \
		--parameter-overrides Env=$(ENV)

seed-remote:
	@TABLE_NAME=$$($(AWS) cloudformation describe-stacks --stack-name $(APP_STACK) \
		--query "Stacks[0].Outputs[?OutputKey=='TableName'].OutputValue" --output text); \
	if [ -z "$$TABLE_NAME" ]; then echo "TableName output not found"; exit 1; fi; \
	TABLE_NAME="$$TABLE_NAME" AWS_REGION=$(REGION) AWS_PROFILE=$(PROFILE) node scripts/seed.js

postman-env:
	AWS_REGION=$(REGION) AWS_PROFILE=$(PROFILE) AUTH_STACK=$(AUTH_STACK) APP_STACK=$(APP_STACK) ENV=$(ENV) \
		node scripts/create-postman-environment.js

clean-app:
	sam delete --stack-name $(APP_STACK) --region $(REGION) --profile $(PROFILE) --no-prompts

clean-auth:
	sam delete --stack-name $(AUTH_STACK) --region $(REGION) --profile $(PROFILE) --no-prompts

clean-stack:
	-$(MAKE) clean-app
	-$(MAKE) clean-auth
