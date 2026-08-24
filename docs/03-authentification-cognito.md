# 03 — L'authentification avec Cognito

## Ce que tu vas comprendre

- Ce qu'est un JWT, et pourquoi une API peut le vérifier sans appeler personne.
- Ce que veut dire « machine à machine », et pourquoi il n'y a **aucun**
  utilisateur connecté dans ce projet.
- Les quatre briques Cognito : user pool, resource server, scopes, app client.
- Ce qu'est un authorizer API Gateway, et en quoi il diffère de l'intégration.
- Pourquoi le domaine Cognito n'est pas optionnel.

## Les prérequis

[01 — Les bases d'AWS](01-les-bases-aws.md) et
[02 — Vue d'ensemble](02-vue-densemble.md).

---

## Le problème

Trois API sont exposées sur Internet. Il faut que seules les applications
autorisées puissent les appeler. Deux mauvaises réponses, pour comprendre la
bonne :

- **Une clé d'API dans un header.** Ça marche, mais la clé ne dit rien de ce que
  l'appelant a le droit de faire, ne périme jamais, et il faut la vérifier dans
  chaque Lambda — donc la stocker et la comparer, dans trois services.
- **Un login / mot de passe par requête.** Il faudrait interroger une base à
  chaque appel. C'est lent et ça fait de cette base un point de panne unique.

La bonne réponse : un **jeton signé**, vérifiable localement, qui porte lui-même
la liste de ce qu'on a le droit de faire, et qui expire.

## Le JWT en trois minutes

Un **JWT** (JSON Web Token) est une chaîne en trois morceaux séparés par des
points :

```
eyJraWQiOiJ...   .   eyJzdWIiOiI...   .   fL9wR3nQ...
   header                payload            signature
```

- Le **header** dit avec quel algorithme c'est signé, et quelle clé (`kid`).
- Le **payload** contient les *claims* : qui, jusqu'à quand, avec quels droits.
- La **signature** est produite avec la clé privée de Cognito.

Le point crucial : **les deux premiers morceaux sont juste du base64, pas du
chiffrement.** N'importe qui peut les lire. Colle un de nos jetons dans
[jwt.io](https://jwt.io/introduction) et tu verras tout son contenu. Ce n'est pas
une faille : un JWT ne protège pas le secret de son contenu, il protège son
**intégrité**. Personne ne peut le modifier sans invalider la signature.

Le payload de nos jetons ressemble à ceci :

```json
{
  "sub": "3f5c9a1e-...",
  "token_use": "access",
  "scope": "pokedex/read pokedex/write",
  "client_id": "3f5c9a1e...",
  "exp": 1755765600
}
```

Ce qui rend le procédé rapide : API Gateway télécharge une fois les clés publiques
de Cognito, puis vérifie la signature, l'expiration et les scopes **localement**,
sans appeler Cognito à chaque requête.

> **L'analogie, et sa limite.** Un JWT, c'est un billet de train avec un
> hologramme : le contrôleur vérifie l'hologramme sans téléphoner à la gare de
> départ. La limite : un billet peut être annulé, alors qu'un JWT valide reste
> valide jusqu'à son `exp`. On ne « révoque » pas un jeton déjà émis — d'où des
> durées de vie courtes.

## Machine à machine : personne n'est connecté

C'est le point que le sujet souligne, et qui a une conséquence directe sur le
design de l'API.

Dans le flux OAuth2 habituel — celui du bouton « Se connecter avec Google » — un
humain saisit ses identifiants, et le jeton représente **cette personne**. Le
serveur peut alors lire l'identité dans le jeton.

Ici, on utilise le flux **`client_credentials`**. Il n'y a pas d'écran de
connexion : une application présente son `client_id` et son `client_secret`, et
reçoit un jeton qui représente **l'application**. Il n'existe aucun utilisateur
connecté dont on pourrait lire l'identité.

D'où la question posée par le sujet : *comment passer l'ID de l'utilisateur, en
respectant REST ?* La réponse du projet est dans les chemins :

```
POST /users/{userId}/purchases
GET  /users/{userId}/level
GET  /users/{userId}/badges
POST /users/{userId}/badges/{badgeId}/decision
```

L'utilisateur est une **ressource adressée dans le chemin**, pas une identité
déduite du jeton. C'est cohérent avec REST — `/users/{id}/purchases` se lit « les
achats de cet utilisateur » — et c'est la seule option honnête quand le jeton ne
parle pas de lui.

Ça ne marche que si le client ne peut pas inventer d'identités : c'est pour ça que
`POST /users` accepte un **nom** et renvoie l'`userId` que le serveur a généré. Un
`userId` envoyé par le client est **rejeté en 400**, pas ignoré. → fichier 04.

## Les quatre briques Cognito

Tout le service d'authentification est dans `template-auth.yaml`. Il ne contient
ni API, ni Lambda, ni base : uniquement Cognito.

### 1. Le user pool — l'annuaire

```yaml
  CognitoUserPool:
    Type: AWS::Cognito::UserPool
```

Un **user pool** est un annuaire d'identités et l'autorité qui signe les jetons.
Le nôtre est vide de tout utilisateur humain, et c'est normal : en machine à
machine, ce sont les *app clients* qui s'authentifient, pas des comptes.

Son ARN est ce que les trois API utilisent pour valider les jetons.

### 2. Le resource server — l'API qu'on protège

```yaml
  PokedexResourceServer:
    Type: AWS::Cognito::UserPoolResourceServer
    Properties:
      Identifier: pokedex
      Scopes:
        - ScopeName: read
          ScopeDescription: Read users and the Pokemon catalog
        - ScopeName: write
          ScopeDescription: Create purchases
```

Un **resource server** déclare « voici une API, et voici les permissions qu'on
peut demander dessus ». Son `Identifier` (`pokedex`) devient le préfixe des
scopes.

### 3. Les scopes — les permissions

De la combinaison ci-dessus naissent deux scopes : **`pokedex/read`** et
**`pokedex/write`**. Le nom complet est toujours
`<identifier>/<scope>` — c'est la source d'erreur la plus fréquente : demander
`read` au lieu de `pokedex/read` échoue.

Chaque route du projet exige le scope qui lui correspond. Dans
`template-badges.yaml`, ce sont **deux fonctions distinctes** (on verra au
fichier 07 pourquoi elles ne sont pas fusionnées), chacune avec son scope :

```yaml
  GetBadgesFunction:
    # ...
      Events:
        GetBadges:
          Type: Api
          Properties:
            Path: /users/{userId}/badges
            Method: GET
            Auth:
              Authorizer: CognitoAuthorizer
              AuthorizationScopes:
                - pokedex/read

  PostDecisionFunction:
    # ...
      Events:
        PostDecision:
          Type: Api
          Properties:
            Path: /users/{userId}/badges/{badgeId}/decision
            Method: POST
            Auth:
              Authorizer: CognitoAuthorizer
              AuthorizationScopes:
                - pokedex/write
```

Un jeton obtenu avec le seul scope `pokedex/read` peut donc lister les badges mais
pas en décider un. La vérification est faite par API Gateway, avant toute Lambda.

### 4. L'app client — l'identité de l'application

```yaml
  CognitoUserPoolClient:
    Type: AWS::Cognito::UserPoolClient
    Properties:
      GenerateSecret: true
      AllowedOAuthFlowsUserPoolClient: true
      AllowedOAuthFlows:
        - client_credentials
      AllowedOAuthScopes:
        - pokedex/read
        - pokedex/write
      EnableTokenRevocation: true
```

Ligne par ligne :

- `GenerateSecret: true` — Cognito génère un `client_secret`. Indispensable :
  `client_credentials` n'existe **que** pour des clients confidentiels, capables
  de garder un secret (donc un serveur, jamais un front web).
- `AllowedOAuthFlowsUserPoolClient: true` — active les flux OAuth2 hébergés. Sans
  cette ligne, `AllowedOAuthFlows` est ignoré et l'endpoint refuse la requête.
- `AllowedOAuthFlows: [client_credentials]` — un seul flux autorisé, celui-là.
- `AllowedOAuthScopes` — le plafond : ce client ne peut jamais obtenir plus.
- `EnableTokenRevocation: true` — permet de révoquer un jeton avant son `exp`,
  ce qui compense partiellement la limite de l'analogie du billet de train.

Le `client_secret` n'est **jamais** dans un template ni dans Git. Le script
`scripts/create-postman-environment.js` va le chercher dans Cognito au moment de
générer l'environnement Postman, et écrit le fichier en `mode: 0o600` — lisible
par ton seul utilisateur. Ce fichier est ignoré par Git.

### Le domaine — la brique qu'on oublie

```yaml
  CognitoUserPoolDomain:
    Type: AWS::Cognito::UserPoolDomain
    Properties:
      Domain: !Sub 'pokedex-${AWS::AccountId}-${Env}'
```

C'est le piège que le sujet signale explicitement. **Sans domaine, l'endpoint
`/oauth2/token` n'existe pas** et il est impossible d'obtenir un jeton. Le user
pool, le resource server et l'app client peuvent être parfaits : sans domaine,
rien ne fonctionne.

Le nom de domaine doit être unique dans toute la région, d'où l'ID de compte
dedans. L'URL finale est celle que le stack expose en sortie :

```
https://pokedex-<accountId>-dev.auth.eu-west-1.amazoncognito.com
```

## Obtenir un jeton

C'est la première requête de la collection Postman :

```http
POST {{auth_domain}}/oauth2/token
Content-Type: application/x-www-form-urlencoded
Authorization: Basic base64(client_id:client_secret)

grant_type=client_credentials&scope=pokedex/read pokedex/write
```

Réponse :

```json
{
  "access_token": "eyJraWQiOiJ...",
  "expires_in": 3600,
  "token_type": "Bearer"
}
```

Puis chaque appel porte le jeton :

```http
Authorization: Bearer eyJraWQiOiJ...
```

## Authorizer et intégration : deux réglages distincts

Le sujet insiste sur cette distinction, parce que c'est une confusion classique.

- **L'intégration** décrit *comment* la requête est transmise à la Lambda. En
  mode **Lambda proxy**, API Gateway passe la requête entière — chemin,
  paramètres, headers, corps — dans un seul objet, et attend en retour
  `{ statusCode, headers, body }`. C'est ce que fait le projet.
- **L'authorizer** décrit *qui a le droit* d'appeler la route. Ici un authorizer
  Cognito, qui valide la signature, l'expiration et les scopes.

Les deux sont indépendants. Une route peut avoir une intégration parfaite et
aucun authorizer : elle est alors ouverte à tous.

Dans le projet, l'authorizer est déclaré une fois par API et appliqué par défaut
à toutes ses routes :

```yaml
  BadgesApi:
    Type: AWS::Serverless::Api
    Properties:
      Auth:
        DefaultAuthorizer: CognitoAuthorizer
        Authorizers:
          CognitoAuthorizer:
            UserPoolArn: !Sub '{{resolve:ssm:/pokedex/${Env}/auth/user-pool-arn}}'
```

`DefaultAuthorizer` est le réglage important : il protège les routes **par
défaut**. Il faut une action explicite pour ouvrir une route, jamais l'inverse.
Une route oubliée est une route protégée.

Les trois API utilisent **le même** user pool. Un client obtient donc un seul
jeton et s'en sert partout — et l'ARN voyage par SSM, ce qui garde les stacks
indépendants (→ fichier 05).

## Les pièges

**`{"error":"invalid_client"}` sur `/oauth2/token`**
Mauvais `client_id`/`client_secret`, ou le header `Authorization: Basic` mal
encodé. Vérifie que le base64 porte bien `client_id:client_secret`.

**`{"error":"invalid_scope"}`**
Tu as demandé `read` au lieu de `pokedex/read`, ou un scope absent de
`AllowedOAuthScopes`. Le nom complet inclut toujours l'identifier.

**Le domaine `/oauth2/token` répond 404**
Pas de domaine configuré sur le user pool. C'est le piège du sujet.

**`{"message":"Unauthorized"}` (401) sur une route de l'API**
Header `Authorization` absent ou malformé, ou jeton expiré (une heure). Rejoue la
requête 1 de la collection.

**`{"message":"Forbidden"}` (403)**
Le jeton est valide mais le scope ne suffit pas — typiquement un `pokedex/read`
sur une route en écriture. C'est un message différent de 401, et c'est une
information : l'authentification a marché, c'est l'autorisation qui a refusé.

**`Invalid key=value pair` en obtenant le jeton**
Le corps doit être en `application/x-www-form-urlencoded`, pas en JSON.

## Pour aller plus loin

- [Configurer l'authentification machine à machine avec Cognito et API Gateway](https://aws.amazon.com/blogs/mt/configuring-machine-to-machine-authentication-with-amazon-cognito-and-amazon-api-gateway-part-2/)
  — exactement le chemin de ce projet, pas à pas. Le meilleur point de départ.
- [Définir un resource server](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-define-resource-servers.html)
  — resource server et scopes personnalisés.
- [L'endpoint /oauth2/token](https://docs.aws.amazon.com/cognito/latest/developerguide/token-endpoint.html)
  — les paramètres exacts, les réponses, et les erreurs.
- [Intégrer un authorizer Cognito à API Gateway](https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-integrate-with-cognito.html)
  — le côté API Gateway.
- [Introduction au JWT](https://jwt.io/introduction) — la meilleure explication
  courte, avec un décodeur pour coller un vrai jeton.
- [RFC 6749, la spec OAuth 2.0](https://datatracker.ietf.org/doc/html/rfc6749)
  — la section 4.4 est celle de `client_credentials`. Aride, mais c'est la
  référence quand une implémentation te surprend.

---

Précédent : [02 — Vue d'ensemble](02-vue-densemble.md) ·
Suivant : [04 — Le référentiel](04-referentiel-api-dynamodb.md)
