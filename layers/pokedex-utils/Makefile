# Built by `sam build` through Metadata: BuildMethod: makefile on the
# PokedexUtilsLayer resource of template-shared.yaml.
#
# The target name MUST match the layer's logical id. SAM copies this directory
# to a scratch dir, runs us with that as the working directory, and exports
# ARTIFACTS_DIR as an absolute path. Only files we copy there are shipped,
# which is why no stray cache can leak into the layer.
#
# Lambda searches /opt/nodejs/node_modules for Node layers, so that is where
# the package has to land for require('pokedex-utils') to resolve.

.PHONY: build-PokedexUtilsLayer

build-PokedexUtilsLayer:
	mkdir -p "$(ARTIFACTS_DIR)/nodejs"
	cp package.json package-lock.json "$(ARTIFACTS_DIR)/nodejs/"
	cd "$(ARTIFACTS_DIR)/nodejs" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund
	mkdir -p "$(ARTIFACTS_DIR)/nodejs/node_modules/pokedex-utils"
	cp package.json index.js aws.js dynamo.js events.js http.js logger.js names.js \
		validate.js \
		"$(ARTIFACTS_DIR)/nodejs/node_modules/pokedex-utils/"
	rm -f "$(ARTIFACTS_DIR)/nodejs/package-lock.json"
