# 05 — Infrastructure as Code : CloudFormation, SAM, et le build

## Ce que tu vas comprendre

- Pourquoi on arrête de cliquer dans la console.
- Ce que sont CloudFormation, un template, un stack et un change set.
- Pourquoi le projet a cinq stacks et pas un seul.
- Comment deux stacks se parlent **sans** se verrouiller (SSM plutôt que
  `Fn::ImportValue`).
- Ce qu'est un layer Lambda, et le piège de son ARN versionné.
- Pourquoi il y a **deux** compilateurs TypeScript dans ce projet.

## Les prérequis

[04 — Le référentiel](04-referentiel-api-dynamodb.md).

---

## Le problème avec la console

Le lot 1 de l'exercice demande de tout créer à la main dans la console, et c'est
un bon exercice : on voit chaque réglage. Mais une infrastructure cliquée a quatre
défauts rédhibitoires :

1. **Elle n'est pas reproductible.** Personne ne peut refaire exactement la même
   chose, toi y compris dans trois semaines.
2. **Elle n'est pas relisable.** Aucun moyen de faire une revue de code sur une
   séquence de clics.
3. **Elle n'est pas supprimable proprement.** Il reste toujours un rôle IAM, un
   groupe de logs, une file oubliée — qui continuent parfois de coûter.
4. **Elle ne se versionne pas.** Impossible de savoir ce qui a changé, quand, ni
   pourquoi.

L'**Infrastructure as Code** répond aux quatre : l'infrastructure devient des
fichiers, dans Git, à côté du code.

## CloudFormation : le moteur

**CloudFormation** est le service qui lit un fichier décrivant des ressources et
se charge de les créer, les modifier ou les supprimer pour arriver à l'état
décrit.

Trois mots à fixer :

- Un **template** est le fichier (YAML ou JSON) qui décrit les ressources.
- Un **stack** est l'ensemble des ressources créées depuis un template, gérées
  **comme un tout**. Supprimer le stack supprime tout ce qu'il contient.
- Un **change set** est un aperçu : « voici ce que je vais créer, modifier,
  remplacer ou supprimer ». CloudFormation le calcule avant d'agir.

Le change set est ce qui rend l'opération sûre, pour deux raisons. D'abord tu
peux le lire avant d'exécuter. Ensuite, si l'exécution échoue à mi-parcours,
CloudFormation **fait un rollback** vers l'état précédent — on ne reste pas
coincé à moitié déployé.

> **L'analogie, et sa limite.** Un stack est une commande groupée : tout arrive
> ensemble, et on peut tout renvoyer d'un coup. La limite : un stack sait aussi
> faire des mises à jour *partielles* et différentielles, ce qu'aucune commande ne
> fait. Il compare l'état voulu à l'état réel et ne touche que la différence.

Un détail qui a des conséquences : certaines modifications forcent un
**remplacement** plutôt qu'une mise à jour. Renommer une table DynamoDB, par
exemple, crée une nouvelle table vide et détruit l'ancienne. Le change set le dit
(`Replacement: True`), et c'est une raison de le lire.

## SAM : CloudFormation en moins verbeux

**SAM** (Serverless Application Model) est une extension de CloudFormation pour
le serverless. C'est ce que fait cette ligne, en tête de chaque template :

```yaml
Transform: AWS::Serverless-2016-10-31
```

Un **transform** est un préprocesseur : SAM lit tes ressources `AWS::Serverless::*`
et les développe en ressources CloudFormation classiques. Une seule
`AWS::Serverless::Function` devient une `AWS::Lambda::Function`, un
`AWS::IAM::Role`, une `AWS::Lambda::Permission`, et les ressources API Gateway.
Une trentaine de lignes de template pour deux à trois cents lignes générées.

SAM apporte aussi trois choses très concrètes :

**`Globals`** — les réglages communs, écrits une fois :

```yaml
Globals:
  Function:
    Runtime: nodejs24.x
    Architectures:
      - arm64
    Timeout: 10
    MemorySize: 256
    Layers:
      - !Ref UtilsLayerArn
    Environment:
      Variables:
        TABLE_NAME: !Ref BadgesTable
        NODE_OPTIONS: --enable-source-maps
```

Les `Environment.Variables` sont **fusionnées** avec celles déclarées au niveau
d'une fonction : le consumer de Badges ajoute son `STATE_MACHINE_ARN` et hérite du
`TABLE_NAME`.

`arm64` mérite un mot : les processeurs Graviton sont moins chers que x86 à
performance égale sur ce type de charge. Il n'y a aucune raison de ne pas les
prendre pour du Node.js.

**`Policies`** — des raccourcis IAM. `DynamoDBReadPolicy: { TableName: ... }`
génère la bonne policy. Le projet préfère souvent des `Statement` explicites,
parce que les raccourcis sont volontairement larges : `DynamoDBCrudPolicy` donne
lecture *et* écriture, là où une fonction de lecture ne doit avoir que la lecture.

**`Events`** — les déclencheurs. `Type: Api` crée la route, la méthode,
l'intégration proxy et la permission d'invocation. `Type: SQS` crée l'*event
source mapping* qui fait que Lambda va lire la file.

## Cinq stacks, et pourquoi

```
pokedex-auth-dev      Cognito
pokedex-shared-dev    le layer Lambda (du code, pas un service)
pokedex-app-dev       le référentiel
pokedex-levels-dev    Levels
pokedex-badges-dev    Badges
```

Le découpage suit **la frontière des services**, et ça achète trois choses :

- On peut déployer, mettre à jour ou supprimer un service sans toucher aux
  autres. `make clean-levels` puis un achat qui renvoie toujours 201 est la
  démonstration de cette indépendance.
- Chaque template reste lisible. Un template unique ferait plus de 1000 lignes.
- Le rayon d'action d'une erreur est limité à un service.

Chaque template est **paramétré** par un `Env`, de sorte que le même fichier peut
produire deux environnements indépendants dans le même compte :

```yaml
Parameters:
  Env:
    Type: String
    Default: dev
    AllowedPattern: '^[a-z0-9-]+$'
```

L'`AllowedPattern` n'est pas décoratif : les noms de ressources dérivent de cette
valeur, et CloudFormation refuse une valeur invalide **avant** de commencer à
créer quoi que ce soit. Échouer tôt vaut mieux qu'échouer à la moitié.

## Comment deux stacks se parlent

Le référentiel a besoin de l'ARN du user pool créé par le stack d'auth. Il y a
trois façons de récupérer une valeur produite par un autre stack, et le choix
n'est pas anodin.

### Fn::ImportValue — à éviter

Le stack A exporte une valeur, le stack B l'importe. Ça marche, et ça crée un
**verrou** : tant que B importe la valeur, CloudFormation interdit à A de la
modifier **ou d'être supprimé**. Tu obtiens :

```
Export pokedex-auth-dev-UserPoolArn cannot be updated as it is in use by pokedex-app-dev
```

Le seul remède est de supprimer B d'abord. Sur cinq stacks en chaîne, ça devient
un ordre de suppression obligatoire et fragile.

### Un paramètre passé au déploiement — possible

`--parameter-overrides UserPoolArn=arn:...`. Aucun verrou, mais il faut
transporter la valeur à chaque déploiement, donc quelqu'un ou quelque chose doit
la connaître.

### SSM Parameter Store — recommandé, et ce que fait le projet

**SSM Parameter Store** est un magasin clé-valeur. Le stack qui produit une valeur
l'y écrit à un chemin convenu ; celui qui en a besoin va la lire. Aucun lien
CloudFormation entre les deux, donc aucun verrou.

Le producteur écrit (`template-levels.yaml`) :

```yaml
  LevelsEventBusNameParameter:
    Type: AWS::SSM::Parameter
    Properties:
      Name: !Sub '/pokedex/${Env}/levels/event-bus-name'
      Type: String
      Value: !Ref LevelsEventBus
```

Le consommateur lit (`template-badges.yaml`) :

```yaml
      EventBusName: !Sub '{{resolve:ssm:/pokedex/${Env}/levels/event-bus-name}}'
```

`{{resolve:ssm:...}}` est une **référence dynamique** : CloudFormation va lire la
valeur dans SSM au moment du déploiement.

Les chemins utilisés par le projet :

```
/pokedex/dev/auth/user-pool-arn
/pokedex/dev/auth/resource-server-id
/pokedex/dev/shared/utils-layer-arn
/pokedex/dev/referential/event-bus-name
/pokedex/dev/levels/event-bus-name        # ajouté au lot 4
```

## Le layer Lambda

Avant, les helpers étaient dupliqués dans chaque fonction : les cinq fonctions
déclaraient `CodeUri: src/`, donc `sam build` copiait tout l'arbre plus un
`node_modules` complet dans chaque artefact. **Cinq artefacts de 48 Mo par
build**, et une modification d'un handler invalidait les cinq.

Un **layer** est une archive montée à côté de ta fonction. Maintenant
`layers/pokedex-utils/` est construit une fois, et chaque fonction se contente de
son propre répertoire. Un artefact fait quelques kilo-octets :

```
16K  .aws-sam/badges/BadgesConsumerFunction/
 8K  .aws-sam/badges/GetBadgesFunction/
12K  .aws-sam/badges/RegisterTokenFunction/
16K  .aws-sam/badges/PostDecisionFunction/
```

Et les handlers importent par nom :

```ts
import { getItem, errorResponse } from 'pokedex-utils';
```

Ça résout parce que Lambda met `/opt/nodejs/node_modules` dans le `NODE_PATH`. Le
layer est construit avec `Metadata: BuildMethod: makefile`
(`layers/pokedex-utils/Makefile`), ce qui permet de placer le paquet exactement à
`nodejs/node_modules/pokedex-utils` — la méthode `BuildMethod` du runtime le
mettrait à `/opt/nodejs/` et forcerait un `require` en chemin absolu.

Pour que ça marche aussi **hors** Lambda (`make test`, ou un simple `node`), le
`package.json` racine déclare `pokedex-utils` en dépendance `file:`, ce qui fait
que npm crée un lien symbolique dans `node_modules`. D'où le `npm install` à
faire une fois après le clone.

### Le piège de l'ARN versionné

C'est le point le plus subtil de tout le déploiement, et il vaut d'être compris
parce qu'il a une propriété désagréable : **il échoue en silence**.

L'ARN du user pool et le nom d'un bus voyagent en `{{resolve:ssm:...}}`. L'ARN du
layer, non — il voyage en **paramètre**. Pourquoi cette différence ?

Un ARN de version de layer change à **chaque** modification du contenu du layer
(`...:layer:pokedex-shared-dev-utils:7` devient `:8`). Or, sous un transform,
CloudFormation décide s'il y a quelque chose à déployer en comparant le **texte
du template**, et ne résout une référence dynamique qu'au moment d'exécuter le
change set.

Donc : la chaîne `{{resolve:ssm:...}}` n'a pas changé, le change set est vide, et
avec `--no-fail-on-empty-changeset` le déploiement **annonce un succès** alors que
les fonctions continuent de tourner sur l'ancienne version du layer. Tu as modifié
un helper, le déploiement a dit OK, et rien n'a changé.

D'où le contournement, dans le `Makefile` :

```makefile
deploy-badges: compile
	@set -e ; \
	LAYER_ARN=$$($(AWS) ssm get-parameter --name $(UTILS_LAYER_PARAM) \
		--query Parameter.Value --output text) ; \
	test -n "$$LAYER_ARN" || { echo "... Run 'make deploy-shared' first." >&2 ; exit 1 ; } ; \
	sam build --template-file template-badges.yaml --build-dir .aws-sam/badges \
		--parameter-overrides Env=$(ENV) UtilsLayerArn=$$LAYER_ARN ; \
	$(SAM_DEPLOY) --template-file .aws-sam/badges/template.yaml \
		--stack-name $(BADGES_STACK) \
		--parameter-overrides Env=$(ENV) UtilsLayerArn=$$LAYER_ARN \
			DecisionTimeoutSeconds=$(DECISION_TIMEOUT)
```

Le Makefile lit l'ARN et le passe en paramètre. La **valeur** change vraiment,
donc le change set n'est pas vide, donc les fonctions se mettent vraiment à jour.
Le user pool et les noms de bus sont des valeurs créées une fois pour toutes : le
piège ne les concerne jamais.

**La conséquence à retenir : modifier un helper du layer oblige à redéployer les
trois stacks qui l'utilisent**, pas seulement `shared`. `make deploy` le fait dans
l'ordre.

### Pourquoi le layer est en RetentionPolicy: Retain

```yaml
      RetentionPolicy: Retain
```

SAM change l'identifiant logique du layer à chaque modification de contenu, donc
une mise à jour est un **remplacement**. Et CloudFormation ne peut pas supprimer
une version de layer qu'une fonction déployée référence encore. `Retain` garde
l'ancienne en vie pendant la transition.

Les versions s'accumulent donc, et `make clean-layers` les élague — `make
clean-stack` l'appelle après avoir supprimé les stacks consommateurs.

## TypeScript : deux compilateurs, et une bonne raison

Les handlers et les helpers sont en TypeScript, mais c'est du JavaScript qui est
déployé. Cette étape n'est pas optionnelle : le chargeur de handler de Lambda ne
résout que `.js`, `.mjs` et `.cjs`, donc il ne trouverait jamais `handler` dans
`users.ts`. Node 24 sait *exécuter* du TypeScript en effaçant les types, mais ça
arrive trop tard pour aider le chargeur.

### esbuild transpile les handlers, dans sam build

Chaque fonction porte :

```yaml
    Metadata:
      BuildMethod: esbuild
      BuildProperties:
        EntryPoints:
          - badge.ts
        External:
          - pokedex-utils
        Target: es2023
        Format: cjs
        Minify: false
        Sourcemap: true
```

Deux lignes méritent une explication.

**`External: [pokedex-utils]`** est la plus importante du bloc. Sans elle, esbuild
suit l'import et **inline le layer entier** dans chaque artefact — ce qui annule
silencieusement toute la raison d'être du layer. On peut le vérifier :

```bash
grep -c 'require("pokedex-utils")' .aws-sam/badges/*/*.js   # 1 par fonction
grep -l '@aws-sdk' .aws-sam/badges/*/*.js                   # rien
```

**`Minify: false`** contredit le défaut d'esbuild, exprès : un code minifié rend
illisible le champ `stack` que le logger écrit dans CloudWatch.

### tsc compile le layer, avant sam build

La méthode de build esbuild n'existe que pour `AWS::Serverless::Function`, jamais
pour `AWS::Serverless::LayerVersion` — et `tsc` est de toute façon le bon outil
ici. Bundler écraserait les onze modules en un seul fichier et n'émettrait aucun
`.d.ts`, alors que ce sont précisément ces `.d.ts` qui permettent de vérifier les
types des handlers **à travers** la frontière de paquet.

### Le point à retenir : esbuild ne vérifie pas les types

C'est la partie qui compte. esbuild efface les types et ne les regarde jamais.
Laissé seul, il déploierait sans broncher du code qui ne compile pas.

`make compile` lance donc `tsc` deux fois, et toutes les cibles `build` et
`deploy-*` en dépendent :

```
make compile
  ├─ tsc -p layers/pokedex-utils   -> dist/*.js + dist/*.d.ts
  └─ tsc -p tsconfig.json          -> noEmit, vérifie les neuf handlers
```

C'est la seule chose qui se tient entre une erreur de type et une fonction
déployée.

Le layer est compilé en premier, pour deux raisons : son `dist/` est ce que
`sam build` empaquette, et ses `.d.ts` sont ce contre quoi les handlers sont
vérifiés — via le lien symbolique `node_modules`.

### Ce que les types ont attrapé

Trois changements sont sortis de l'activation de `strict`, et chacun était un vrai
mode de défaillance :

- **`errors.ts`** — sous `strict`, une erreur attrapée est de type `unknown`, donc
  `error.name === '...'` ne compile plus. `isErrorNamed` fait le narrowing
  **structurellement**, et pas avec `instanceof` sur les classes du SDK : aucun
  handler n'importe le SDK, et `instanceof` renvoie silencieusement `false` quand
  deux copies d'un module se retrouvent dans le même process.
- **`requireEnv`** — `process.env.TABLE_NAME` est `string | undefined`, ce qui
  échoue à chaque appel qui le passe à DynamoDB. Dans `purchase.ts`, ça a fermé un
  vrai trou : `EVENT_BUS_NAME` n'était vérifié qu'à l'intérieur de `publishEvent`,
  dont l'exception est délibérément avalée — un bus mal configuré aurait donc
  laissé les achats réussir sans qu'aucun événement soit jamais publié.
- **`SQSHandler`** — typer le consumer vérifie la forme
  `{ batchItemFailures: [{ itemIdentifier }] }` dont dépend
  `FunctionResponseTypes: ReportBatchItemFailures`. Mal orthographier cette clé
  ferait cesser silencieusement le report des échecs partiels ; maintenant ça casse
  le build.

Les source maps sont activées avec le source TypeScript embarqué, donc une stack
trace dans CloudWatch pointe la ligne `.ts` et pas la ligne transpilée.

## Le Makefile

Les commandes passent par un `Makefile` pour que la même séquence soit rejouable
par quelqu'un d'autre sans avoir à retenir les options.

```bash
make build          # build hors-ligne des cinq stacks, sans appel AWS
make deploy         # auth -> shared -> app -> levels -> badges, puis Postman
make deploy-badges  # un seul service
make clean-stack    # tout supprimer, dans l'ordre inverse
```

Deux astuces du fichier qui valent d'être signalées.

`make build` utilise un ARN de layer **volontairement faux mais bien formé**, de
sorte qu'un build ne nécessite aucun appel AWS :

```makefile
PLACEHOLDER_LAYER_ARN := arn:aws:lambda:$(REGION):000000000000:layer:placeholder:1
```

Et le `PATH` est exporté pour qu'esbuild — installé une fois à la racine — soit
trouvé par les neuf fonctions :

```makefile
export PATH := $(CURDIR)/node_modules/.bin:$(PATH)
TSC := $(CURDIR)/node_modules/.bin/tsc
```

La deuxième ligne n'est pas redondante : `make` conserve le `PATH` avec lequel il
a démarré pour ses propres recettes, d'où `tsc` nommé par chemin complet.

## Les pièges

**`No changes to deploy. Stack ... is up to date`**
Soit il n'y a vraiment rien à déployer, soit tu viens de tomber dans le piège du
layer versionné. Si tu as modifié un helper et vu ce message, c'est le second.

**`Export ... cannot be updated as it is in use by ...`**
Quelqu'un a utilisé `Fn::ImportValue`. C'est exactement le verrou que SSM évite.

**`Parameter /pokedex/dev/shared/utils-layer-arn not found`**
`make deploy-shared` n'a jamais tourné. Le Makefile intercepte ce cas et le dit.

**`ROLLBACK_COMPLETE` et un stack qu'on ne peut plus mettre à jour**
Un stack qui a échoué à sa **première** création reste dans cet état et ne peut
qu'être supprimé. `sam delete --stack-name ...` puis on recommence.

**`Metadata` ignoré et layer non construit**
`Metadata` est un *attribut de ressource* : il se place à côté de `Properties`,
pas dedans. Mal indenté, `sam build` ignore le bloc **sans rien dire**.

**Le build échoue avec `Cannot find esbuild`**
Tu as lancé `sam build` directement au lieu de passer par `make`, donc sans le
`PATH` exporté.

## Pour aller plus loin

- [Démarrer avec AWS SAM](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/serverless-getting-started.html)
  — installation du CLI et principes de base.
- [Tutoriel SAM : déployer une première application](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/serverless-getting-started-hello-world.html)
  — un aller-retour complet template → build → deploy sur un exemple minimal.
  À faire une fois avant de lire nos templates.
- [Les stacks CloudFormation](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/stacks.html)
  — le cycle de vie complet.
- [Les change sets](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/using-cfn-updating-stacks-changesets.html)
  — comment prévisualiser une mise à jour. La page qui apprend à ne pas casser la
  prod.
- [Les références dynamiques](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/dynamic-references.html)
  — la syntaxe `{{resolve:ssm:...}}` et ses limites.
- [La section Outputs et les exports](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/outputs-section-structure.html)
  — pour comprendre d'où vient le verrou de `Fn::ImportValue`.
- [SSM Parameter Store](https://docs.aws.amazon.com/systems-manager/latest/userguide/systems-manager-parameter-store.html)
  — types de paramètres, hiérarchies, chiffrement.
- [Les layers Lambda](https://docs.aws.amazon.com/lambda/latest/dg/chapter-layers.html)
  — la structure attendue de l'archive et le versionnement.
- [Construire du Node.js avec SAM et esbuild](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/building-nodejs.html)
  — toutes les `BuildProperties`.
- [esbuild](https://esbuild.github.io/) — le site du bundler. La page « Content
  Types » explique pourquoi il ne vérifie pas les types.

---

Précédent : [04 — Le référentiel](04-referentiel-api-dynamodb.md) ·
Suivant : [06 — L'événementiel](06-evenementiel-eventbridge-sqs.md)
