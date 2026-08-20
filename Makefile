ENV ?= dev
REGION ?= eu-west-1
PROFILE ?= germen-dev-anthonyk
AUTH_STACK := pokedex-auth-$(ENV)
SHARED_STACK := pokedex-shared-$(ENV)
APP_STACK := pokedex-app-$(ENV)
LEVELS_STACK := pokedex-levels-$(ENV)

UTILS_LAYER_PARAM := /pokedex/$(ENV)/shared/utils-layer-arn
UTILS_LAYER_NAME := $(SHARED_STACK)-utils
# Valid in shape but deliberately non-existent, so `make build` and
# `make validate` need no AWS call. Never used by a deploy.
PLACEHOLDER_LAYER_ARN := arn:aws:lambda:$(REGION):000000000000:layer:placeholder:1

AWS := aws --region $(REGION) --profile $(PROFILE)
SAM_DEPLOY := sam deploy --resolve-s3 --capabilities CAPABILITY_IAM \
	--no-confirm-changeset --no-fail-on-empty-changeset \
	--region $(REGION) --profile $(PROFILE)

export npm_config_cache := $(CURDIR)/.npm-cache
# SAM's esbuild builder looks for the binary in the function directory, then the
# executable search paths, then PATH. esbuild is a single dev install at the
# repo root, so exporting this is what lets all five functions find it.
#
# It does not help make resolve its own recipe commands: make keeps the PATH it
# started with for that, which is why tsc is named by full path below.
export PATH := $(CURDIR)/node_modules/.bin:$(PATH)
TSC := $(CURDIR)/node_modules/.bin/tsc

.DEFAULT_GOAL := help
.NOTPARALLEL:

.PHONY: help validate compile build test aws-check layer-arn deploy deploy-auth \
	deploy-shared deploy-app deploy-levels postman outputs clean-stack clean-levels \
	clean-app clean-shared clean-layers clean-auth clean-dist

help:
	@echo "make aws-check     Check the AWS account"
	@echo "make compile       Compile the TypeScript and type-check the handlers"
	@echo "make deploy        Deploy the four stacks (auth -> shared -> app -> levels)"
	@echo "make layer-arn     Print the shared utils layer ARN currently in SSM"
	@echo "make test          Run the unit tests"
	@echo "make outputs       Show the deployed URLs and IDs"
	@echo "make clean-stack   Delete the four stacks and prune retained layer versions"

validate:
	sam validate --lint --template-file template-auth.yaml
	sam validate --lint --template-file template-shared.yaml
	sam validate --lint --template-file template-pokedex.yaml
	sam validate --lint --template-file template-levels.yaml

# The handlers are transpiled by esbuild inside sam build, and esbuild does no
# type checking at all - so tsc is the only thing standing between a type error
# and a deployed function.
#
# The layer is compiled first, for two reasons: its dist/ is what sam build
# packages into the layer artifact, and its .d.ts files are what the handler
# project is checked against. The handler project emits nothing.
compile:
	$(TSC) -p layers/pokedex-utils
	$(TSC) -p tsconfig.json

# Offline build of everything, using a placeholder layer ARN that is never deployed.
build: validate compile
	sam build --template-file template-auth.yaml --build-dir .aws-sam/auth
	MAKEFLAGS= sam build --template-file template-shared.yaml --build-dir .aws-sam/shared
	sam build --template-file template-pokedex.yaml --build-dir .aws-sam/app \
		--parameter-overrides Env=$(ENV) UtilsLayerArn=$(PLACEHOLDER_LAYER_ARN)
	sam build --template-file template-levels.yaml --build-dir .aws-sam/levels \
		--parameter-overrides Env=$(ENV) UtilsLayerArn=$(PLACEHOLDER_LAYER_ARN)

# The suites require('pokedex-utils'), which resolves through the node_modules
# symlink to layers/pokedex-utils/dist, so the layer has to be compiled first.
test: compile
	node --test 'tests/*.test.js'

aws-check:
	@echo "Profile: $(PROFILE) | Region: $(REGION) | Environment: $(ENV)"
	@$(AWS) sts get-caller-identity --output table

layer-arn:
	@$(AWS) ssm get-parameter --name $(UTILS_LAYER_PARAM) \
		--query Parameter.Value --output text

deploy: aws-check
	$(MAKE) deploy-auth
	$(MAKE) deploy-shared
	$(MAKE) deploy-app
	$(MAKE) deploy-levels
	$(MAKE) postman
	$(MAKE) outputs

deploy-auth:
	sam build --template-file template-auth.yaml --build-dir .aws-sam/auth
	$(SAM_DEPLOY) --template-file .aws-sam/auth/template.yaml \
		--stack-name $(AUTH_STACK) --parameter-overrides Env=$(ENV)

# MAKEFLAGS= keeps the jobserver of an outer `make -j` out of the nested make
# that sam build runs for the layer.
deploy-shared: compile
	MAKEFLAGS= sam build --template-file template-shared.yaml --build-dir .aws-sam/shared
	$(SAM_DEPLOY) --template-file .aws-sam/shared/template.yaml \
		--stack-name $(SHARED_STACK) --parameter-overrides Env=$(ENV)

# The layer ARN is versioned, so it travels as a template parameter rather than
# a {{resolve:ssm}} reference. Under a transform CloudFormation diffs the
# literal template text, so an unchanged {{resolve:ssm}} string would produce an
# empty changeset and the functions would silently keep the old layer version.
deploy-app: compile
	@set -e ; \
	LAYER_ARN=$$($(AWS) ssm get-parameter --name $(UTILS_LAYER_PARAM) \
		--query Parameter.Value --output text) ; \
	test -n "$$LAYER_ARN" || { echo "$(UTILS_LAYER_PARAM) is missing. Run 'make deploy-shared' first." >&2 ; exit 1 ; } ; \
	echo "Using layer $$LAYER_ARN" ; \
	sam build --template-file template-pokedex.yaml --build-dir .aws-sam/app \
		--parameter-overrides Env=$(ENV) UtilsLayerArn=$$LAYER_ARN ; \
	$(SAM_DEPLOY) --template-file .aws-sam/app/template.yaml \
		--stack-name $(APP_STACK) \
		--parameter-overrides Env=$(ENV) UtilsLayerArn=$$LAYER_ARN

deploy-levels: compile
	@set -e ; \
	LAYER_ARN=$$($(AWS) ssm get-parameter --name $(UTILS_LAYER_PARAM) \
		--query Parameter.Value --output text) ; \
	test -n "$$LAYER_ARN" || { echo "$(UTILS_LAYER_PARAM) is missing. Run 'make deploy-shared' first." >&2 ; exit 1 ; } ; \
	echo "Using layer $$LAYER_ARN" ; \
	sam build --template-file template-levels.yaml --build-dir .aws-sam/levels \
		--parameter-overrides Env=$(ENV) UtilsLayerArn=$$LAYER_ARN ; \
	$(SAM_DEPLOY) --template-file .aws-sam/levels/template.yaml \
		--stack-name $(LEVELS_STACK) \
		--parameter-overrides Env=$(ENV) UtilsLayerArn=$$LAYER_ARN

postman:
	AWS_REGION=$(REGION) AWS_PROFILE=$(PROFILE) AUTH_STACK=$(AUTH_STACK) \
		APP_STACK=$(APP_STACK) LEVELS_STACK=$(LEVELS_STACK) ENV=$(ENV) \
		node scripts/create-postman-environment.js

outputs:
	@$(AWS) cloudformation describe-stacks --stack-name $(AUTH_STACK) \
		--query "Stacks[0].Outputs[].{Name:OutputKey,Value:OutputValue}" --output table
	@$(AWS) cloudformation describe-stacks --stack-name $(SHARED_STACK) \
		--query "Stacks[0].Outputs[].{Name:OutputKey,Value:OutputValue}" --output table
	@$(AWS) cloudformation describe-stacks --stack-name $(APP_STACK) \
		--query "Stacks[0].Outputs[].{Name:OutputKey,Value:OutputValue}" --output table
	@$(AWS) cloudformation describe-stacks --stack-name $(LEVELS_STACK) \
		--query "Stacks[0].Outputs[].{Name:OutputKey,Value:OutputValue}" --output table

clean-levels:
	sam delete --stack-name $(LEVELS_STACK) --region $(REGION) --profile $(PROFILE) --no-prompts

clean-app:
	sam delete --stack-name $(APP_STACK) --region $(REGION) --profile $(PROFILE) --no-prompts

clean-shared:
	sam delete --stack-name $(SHARED_STACK) --region $(REGION) --profile $(PROFILE) --no-prompts

# RetentionPolicy: Retain means CloudFormation leaves published layer versions
# behind, on update and on stack delete alike. Prune them once nothing uses them.
clean-layers:
	@for v in $$($(AWS) lambda list-layer-versions --layer-name $(UTILS_LAYER_NAME) \
		--query 'LayerVersions[].Version' --output text 2>/dev/null) ; do \
		echo "Deleting $(UTILS_LAYER_NAME):$$v" ; \
		$(AWS) lambda delete-layer-version --layer-name $(UTILS_LAYER_NAME) --version-number $$v ; \
	done

clean-dist:
	rm -rf layers/pokedex-utils/dist layers/pokedex-utils/.tsbuildinfo

clean-auth:
	sam delete --stack-name $(AUTH_STACK) --region $(REGION) --profile $(PROFILE) --no-prompts

# Reverse dependency order, so the functions using the layer are gone before it.
clean-stack:
	-$(MAKE) clean-levels
	-$(MAKE) clean-app
	-$(MAKE) clean-shared
	-$(MAKE) clean-layers
	-$(MAKE) clean-auth
