# 01 — Les bases d'AWS

## Ce que tu vas comprendre

- Ce qu'est un compte AWS, une région, et pourquoi tout ce qu'on crée vit dans
  une région précise.
- Ce qu'est IAM, et pourquoi c'est le service le plus important de tous.
- Ce qu'est un ARN, cette longue chaîne qu'on voit partout.
- Ce que « serverless » veut vraiment dire, et ce que ça change pour toi.
- Pourquoi on paie à l'usage, et ce que ça implique quand on oublie de nettoyer.

## Les prérequis

Aucun. C'est le point de départ.

---

## Un compte AWS, c'est une frontière

Un **compte AWS** n'est pas un identifiant de connexion : c'est un conteneur
isolé. Tout ce que tu crées — une base, une fonction, une file — appartient à un
compte, et n'est visible que depuis ce compte. La facture aussi est par compte.

Dans ce projet on travaille avec un seul compte, via un **profil** configuré
localement (`germen-dev-anthonyk`). Un profil est juste un jeu de credentials
enregistré sur ta machine, que l'AWS CLI utilise avec `--profile`.

Ici l'authentification passe par **AWS SSO** (aussi appelé IAM Identity Center),
d'où la commande à rejouer quand la session expire :

```bash
aws sso login --profile germen-dev-anthonyk
```

Une session SSO dure quelques heures. Quand elle est morte, **toutes** les
commandes AWS échouent d'un coup avec :

```
Error when retrieving token from sso: Token has expired and refresh failed
```

C'est le premier réflexe à avoir devant une erreur AWS inexplicable.

## Une région, c'est un endroit physique

AWS découpe le monde en **régions** (`eu-west-1` = Irlande, `us-east-1` = Virginie
du Nord…), chacune étant un groupe de datacenters. Ce projet est tout entier en
`eu-west-1`.

Trois conséquences qui surprennent au début :

- **Les ressources sont régionales.** Une table DynamoDB créée en `eu-west-1`
  n'existe pas en `us-east-1`. Si la console te dit « aucune ressource », vérifie
  d'abord le sélecteur de région en haut à droite. C'est l'erreur numéro un.
- **Certains services sont globaux.** IAM en fait partie : un rôle n'appartient à
  aucune région.
- **La région est dans l'URL de tout.** L'API Gateway du référentiel s'appelle
  `https://xxxxx.execute-api.eu-west-1.amazonaws.com/dev`.

Dans le projet, la région est une variable du `Makefile` :

```makefile
REGION ?= eu-west-1
```

## IAM : par défaut, rien n'est autorisé

**IAM** (Identity and Access Management) décide qui peut faire quoi. C'est le
service à comprendre en premier, parce que la majorité des pannes qu'on rencontre
sur AWS sont des pannes de permissions.

La règle fondatrice : **tout est refusé par défaut**. Une fonction Lambda ne peut
pas lire une table DynamoDB parce qu'elle est « à côté » ; il faut l'autoriser
explicitement. Concrètement :

- Un **rôle** est une identité qu'un service endosse. Chaque Lambda de ce projet
  a son propre rôle, créé automatiquement par SAM.
- Une **policy** est une liste d'autorisations attachée à ce rôle : quelles
  actions, sur quelles ressources.

Voici une policy réelle du projet, celle de la fonction qui lit les badges
(`template-badges.yaml`) :

```yaml
      Policies:
        - Statement:
            - Effect: Allow
              Action: dynamodb:Query
              Resource: !GetAtt BadgesTable.Arn
```

Elle dit exactement une chose : cette fonction peut faire des `Query`, sur cette
table-là, et rien d'autre. Pas de `PutItem`, pas d'autre table. C'est le
**principe du moindre privilège**, et ce n'est pas de la paranoïa décorative :
c'est ce qui fait qu'un bug dans le code de lecture ne peut pas écrire.

> **L'analogie, et sa limite.** On compare souvent IAM à un badge d'immeuble qui
> n'ouvre que certaines portes. C'est juste pour l'idée, mais la limite compte :
> un badge d'immeuble est attaché à une personne, alors qu'un rôle IAM est
> attaché à un *service* et change à chaque appel. Personne ne « porte » le rôle
> de la Lambda ; c'est la Lambda qui l'emprunte le temps d'une invocation.

## Un ARN, c'est l'adresse d'une ressource

**ARN** = *Amazon Resource Name*. C'est l'identifiant unique et complet d'une
ressource. Toujours la même forme :

```
arn:aws:lambda:eu-west-1:123456789012:function:pokedex-badges-dev-consumer
 │   │   │      │          │            │        │
 │   │   │      │          │            │        └─ le nom
 │   │   │      │          │            └─ le type de ressource
 │   │   │      │          └─ le compte (12 chiffres)
 │   │   │      └─ la région
 │   │   └─ le service
 │   └─ la « partition » (aws, ou aws-cn en Chine)
 └─ préfixe fixe
```

Tu croiseras des ARN partout : dans les policies IAM, dans les paramètres SSM,
dans les templates. Le projet en valide même la forme, pour qu'une valeur
bidon ne parte pas jusqu'à AWS (`template-badges.yaml`) :

```yaml
  UtilsLayerArn:
    Type: String
    AllowedPattern: '^arn:aws[a-z-]*:lambda:[a-z0-9-]+:\d{12}:layer:[a-zA-Z0-9._-]+:\d+$'
```

Un détail qui aura son importance au fichier 05 : **l'ARN d'un layer se termine
par un numéro de version** (`:12`). Il change à chaque publication.

## « Serverless » : il y a des serveurs, mais pas les tiens

Serverless ne veut pas dire « sans serveur ». Ça veut dire :

1. **Tu ne provisionnes rien.** Pas de machine à choisir, pas d'OS à patcher.
2. **Ça scale tout seul**, de zéro à beaucoup, sans que tu configures quoi que ce
   soit.
3. **Tu paies à l'usage réel** — à l'invocation, à la requête, au message — et
   zéro quand rien ne tourne.
4. **Le service est éphémère.** C'est le point qui change vraiment la façon
   d'écrire du code.

Ce quatrième point mérite d'être développé, parce que c'est lui qui explique la
moitié des choix du projet. Une fonction Lambda tourne dans un conteneur qu'AWS
crée, garde tiède un moment, puis jette. Donc :

- **Tu ne peux rien garder en mémoire entre deux appels.** Pas de cache local
  fiable, pas de variable qui « se souvient ». C'est exactement pour cette raison
  que le task token du lot 4 doit être écrit dans une base : la fonction qui le
  reçoit et celle qui le relira des jours plus tard n'ont aucune mémoire commune.
- **La première invocation est plus lente** que les suivantes : c'est le **cold
  start**, le temps de créer le conteneur et de charger ton code. C'est pour ça
  que les clients AWS du projet sont construits une seule fois, à l'extérieur du
  handler (`layers/pokedex-utils/aws.ts`) : ce travail se fait pendant le cold
  start, pas à chaque requête.
- **Deux invocations peuvent tourner en même temps**, sur des conteneurs
  différents. Ton code doit donc supporter la concurrence — un thème qui revient
  dans tous les fichiers suivants.

Les six services de ce projet sont tous serverless : Lambda, API Gateway,
DynamoDB (en mode on-demand), EventBridge, SQS et Step Functions.

## Le coût, et pourquoi on nettoie

À l'échelle de cet exercice, le coût est de l'ordre de quelques centimes : le free
tier couvre largement quelques milliers d'invocations. Mais deux ressources
continuent de coûter même quand personne ne s'en sert :

- Une table DynamoDB stocke des données, donc facture du stockage.
- Les logs CloudWatch s'accumulent indéfiniment si aucune rétention n'est fixée.

D'où deux choses dans le projet. Un `make clean-stack` qui supprime tout :

```bash
make clean-stack
```

Et une rétention explicite sur le seul groupe de logs qu'on crée nous-mêmes
(`template-badges.yaml`) :

```yaml
  StateMachineLogGroup:
    Type: AWS::Logs::LogGroup
    Properties:
      RetentionInDays: 14
```

> **À retenir** : les groupes de logs créés automatiquement par Lambda ont une
> rétention « Never expire » par défaut. Sur un vrai projet, c'est une ligne de
> facture qui grossit tout seule pendant des années.

## Console ou ligne de commande ?

La **console** (l'interface web) est parfaite pour *regarder* : voir une exécution
Step Functions se dérouler, lire des logs, inspecter une table. Le lot 1 de
l'exercice demande d'ailleurs de tout créer à la main dans la console, et c'est un
bon exercice — on comprend mieux ce qu'on automatise ensuite.

Elle est mauvaise pour *créer*, pour une raison unique : ce n'est pas
reproductible. Personne ne peut rejouer une séquence de clics, ni la relire dans
une pull request, ni la supprimer proprement. C'est tout l'objet du fichier 05.

Dans ce projet on utilise donc :

- La **CLI** (`aws …`) et **SAM** (`sam …`) pour créer, modifier et supprimer.
- La **console** pour observer et déboguer.

## Les pièges

**« Je ne vois pas ma ressource dans la console. »**
Mauvaise région dans le sélecteur, neuf fois sur dix. Vérifie que tu es bien sur
Irlande / `eu-west-1`.

**`Token has expired and refresh failed`**
Session SSO morte. `aws sso login --profile germen-dev-anthonyk`.

**`AccessDeniedException: User ... is not authorized to perform ...`**
Un rôle qui manque une permission. Le message nomme toujours l'action exacte et
la ressource — c'est ta liste de courses pour la policy à corriger. Ne réponds
jamais à cette erreur par `Resource: '*'` : cherche la ressource précise.

**`The security token included in the request is invalid`**
Credentials absents ou expirés, ou mauvais profil. `make aws-check` te dit avec
quelle identité tu parles :

```bash
make aws-check
```

## Pour aller plus loin

- [Qu'est-ce que IAM ?](https://docs.aws.amazon.com/IAM/latest/UserGuide/introduction.html)
  — la page d'entrée officielle. Lis au moins la partie « Identities » et
  « Policies ».
- [Le format des ARN](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference-arns.html)
  — une page courte, à garder sous la main.
- [Comment IAM décide d'autoriser ou de refuser](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_evaluation-logic.html)
  — la logique d'évaluation. À lire le jour où une permission « qui devrait
  marcher » ne marche pas.
- [Régions et zones de disponibilité](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/using-regions-availability-zones.html)
  — écrit pour EC2, mais le découpage vaut pour tous les services.
- [Le serverless expliqué par AWS](https://aws.amazon.com/what-is/serverless-computing/)
  — la définition marketing, mais elle a le mérite d'être claire et courte.
- [L'environnement d'exécution Lambda](https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtime-environment.html)
  — le cycle de vie d'un conteneur Lambda, cold start inclus. C'est la page qui
  fait comprendre pourquoi on ne garde rien en mémoire.

---

Suivant : [02 — Vue d'ensemble](02-vue-densemble.md)
