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
#
# dist/ is the TypeScript output and must already exist: `make compile` in the
# repo root runs tsc before any sam build. Copying the whole directory rather
# than naming each file means a new module needs no edit here.

.PHONY: build-PokedexUtilsLayer

build-PokedexUtilsLayer:
	test -d dist || { echo "layers/pokedex-utils/dist is missing. Run 'make compile' first." >&2 ; exit 1 ; }
	mkdir -p "$(ARTIFACTS_DIR)/nodejs"
	cp package.json package-lock.json "$(ARTIFACTS_DIR)/nodejs/"
	cd "$(ARTIFACTS_DIR)/nodejs" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund
	mkdir -p "$(ARTIFACTS_DIR)/nodejs/node_modules/pokedex-utils"
	cp package.json "$(ARTIFACTS_DIR)/nodejs/node_modules/pokedex-utils/"
	cp -R dist "$(ARTIFACTS_DIR)/nodejs/node_modules/pokedex-utils/"
	rm -f "$(ARTIFACTS_DIR)/nodejs/package-lock.json"
