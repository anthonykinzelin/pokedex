# 04 — Le référentiel : API Gateway, Lambda, DynamoDB

## Ce que tu vas comprendre

- Ce qu'est API Gateway, et ce que « intégration Lambda proxy » veut dire.
- Ce qu'est une Lambda, et les contraintes que ça impose au code.
- DynamoDB : clé de partition, clé de tri, et pourquoi ce n'est pas du SQL.
- Le *single-table design* : pourquoi tout est dans une seule table.
- Nos règles : qui choisit un identifiant, comment on garantit l'unicité d'un
  nom sans contrainte `UNIQUE`, et comment on normalise les noms.

## Les prérequis

[03 — Authentification](03-authentification-cognito.md).

---

## API Gateway : la porte d'entrée

**API Gateway** reçoit les requêtes HTTP publiques et les route vers du code. Il
s'occupe du TLS, du nom de domaine, de la limitation de débit, et — comme on l'a
vu au fichier 03 — de l'authentification.

Le projet utilise une **REST API** (v1), déclarée en une seule ressource par
service. Voici celle du référentiel (`template-pokedex.yaml`) :

```yaml
  Api:
    Type: AWS::Serverless::Api
    Properties:
      StageName: !Ref Env
      EndpointConfiguration: REGIONAL
```

Le **stage** est un environnement de déploiement de l'API, et il apparaît dans
l'URL : `https://xxxxx.execute-api.eu-west-1.amazonaws.com/dev`. Comme il vaut
`!Ref Env`, un déploiement en `prod` produirait `/prod` sans toucher au template.

### L'intégration Lambda proxy

C'est le mode d'intégration du projet, et il faut comprendre ce qu'il implique.
API Gateway ne transforme rien : il emballe la requête entière dans un objet JSON
et le passe à la Lambda.

Ce que ta fonction reçoit :

```js
{
  "httpMethod": "POST",
  "path": "/users/3eacd9de-.../purchases",
  "pathParameters": { "userId": "3eacd9de-..." },
  "queryStringParameters": null,
  "headers": { "authorization": "Bearer ...", ... },
  "body": "{\"pokemonId\":\"pikachu\"}",
  "isBase64Encoded": false,
  "requestContext": { "requestId": "...", ... }
}
```

Deux choses à retenir, parce qu'elles se paient en bugs :

- **`body` est une chaîne, pas un objet.** Il faut la parser soi-même. Et elle
  peut être encodée en base64, d'où le drapeau `isBase64Encoded`. Le helper
  `parseJsonBody` du layer gère les deux cas.
- **Ta fonction doit répondre une forme précise** : `{ statusCode, headers,
  body }`, où `body` est là aussi une **chaîne**. Retourner un objet donne un 502
  côté client, sans explication utile.

C'est ce que fait `jsonResponse` (`layers/pokedex-utils/http.ts`) :

```ts
export function jsonResponse(
  statusCode: number,
  body: unknown,
  extraHeaders: Record<string, string> = {},
): APIGatewayProxyResult {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  };
}
```

Passer par un helper unique, plutôt que de construire la réponse à la main dans
chaque handler, garantit que **toutes** les réponses ont la même forme. Même
logique pour les erreurs, avec `errorResponse` : un seul endroit transforme une
exception en réponse HTTP, donc tous les corps d'erreur se ressemblent.

## Lambda : du code sans serveur

Une **fonction Lambda** est un bout de code qu'AWS exécute en réponse à un
événement. Tu fournis un fichier et le nom d'une fonction exportée (le
*handler*) ; AWS s'occupe du reste.

Dans le projet, chaque route a sa fonction, et chaque fonction a son rôle IAM.
C'est plus verbeux qu'une fonction unique avec un routeur interne, mais ça achète
deux choses : chaque fonction n'a **que** les permissions dont elle a besoin, et
une erreur de déploiement sur une route ne touche pas les autres.

Le handler d'une route ressemble toujours à ceci :

```ts
export const handler: APIGatewayProxyHandler = async (event, context) => {
  const log = createLogger({
    route: 'levels-api',
    requestId: context?.awsRequestId,
    apiRequestId: event.requestContext?.requestId,
  });

  try {
    const userId = requireString(event.pathParameters?.userId, 'userId');
    // ... le travail
    return jsonResponse(200, { /* ... */ });
  } catch (error) {
    return errorResponse(error, log);
  }
};
```

Le motif est toujours le même : un logger enrichi, un `try` qui **lance** ses
erreurs au lieu de les retourner, et un seul `catch` qui les transforme en
réponse. Lancer plutôt que retourner permet d'écrire les validations en ligne
droite, sans propager un objet d'erreur à travers cinq niveaux.

`apiRequestId` mérite un mot : API Gateway renvoie cet identifiant au client dans
le header `x-amzn-RequestId`. Le logger l'écrit aussi. Donc un client qui signale
« ma requête a échoué » avec cet identifiant permet de retrouver la ligne de log
exacte. → fichier 08.

## DynamoDB : une base clé-valeur, pas du SQL

**DynamoDB** est une base NoSQL. Le vocabulaire, en une phrase chacun :

- Une **table** contient des **items** (des lignes), chaque item ayant des
  **attributs** (des colonnes) — mais deux items de la même table peuvent avoir
  des attributs complètement différents. Il n'y a pas de schéma.
- La **clé de partition** (`PK`, *partition key*) détermine sur quel serveur
  physique l'item est rangé.
- La **clé de tri** (`SK`, *sort key*) ordonne les items d'une même partition.

La clé primaire de nos tables est le couple `(PK, SK)`.

Ce qui change tout par rapport à SQL : **il n'y a pas de jointure, et pas de
requête arbitraire.** Tu peux faire deux choses efficacement :

1. `GetItem` — récupérer un item par sa clé complète.
2. `Query` — récupérer tous les items d'**une seule** partition, éventuellement
   filtrés sur la clé de tri.

Tout le reste (un `Scan`, qui lit la table entière) est lent et coûteux et ne doit
pas apparaître dans un chemin de requête.

> **La conséquence, et c'est le renversement à accepter :** en SQL on modélise
> les données puis on écrit les requêtes. En DynamoDB on liste les requêtes,
> **puis** on choisit les clés pour qu'elles soient toutes des `GetItem` ou des
> `Query`. Le modèle découle des accès, pas l'inverse.

### Le single-table design

Chaque service du projet a **une** table qui contient tous ses types d'items. Ce
n'est pas de l'économie : c'est ce qui permet de lire plusieurs types d'items
liés en une seule requête, puisque `Query` ne franchit pas la frontière d'une
partition.

Le préfixe dans la clé fait office de « type ». Table du référentiel :

```
PK = USER#<userId>          SK = PROFILE                 -> le profil
PK = USER#<userId>          SK = PURCHASE#<date>#<id>    -> un achat
PK = POKEMON#<pokemonId>    SK = DETAIL                  -> une entrée du catalogue
PK = USERNAME#<nom replié>  SK = RESERVATION             -> une réservation de nom
```

Table de Levels :

```
PK = USER#<userId>          SK = LEVEL                   -> points et watermark
PK = USER#<userId>          SK = PURCHASE#<purchaseId>   -> marqueur d'idempotence
```

Table de Badges :

```
PK = USER#<userId>          SK = BADGE#LEVEL#<n>         -> un badge
```

Tout ce qui concerne un utilisateur partage donc la même `PK`. C'est exactement ce
qui rend `GET /users/{userId}/badges` réalisable en une requête (`dynamo.ts`) :

```ts
export function queryAllByPK<T = Item>(
  tableName: string,
  partitionValue: string,
  skPrefix?: string,
  options: QueryOptions = {},
): Promise<T[]> {
  // ... KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)'
}
```

Un détail qui compte : `#` est **interdit dans les noms** (voir plus bas), et ce
n'est pas un hasard. `#` sépare les parties de chaque clé ; si un nom pouvait en
contenir, on pourrait fabriquer un nom qui ressemble à la clé d'un autre item.

### La pagination, qui n'est pas optionnelle

DynamoDB coupe toute requête à 1 Mo de résultats, même sans `Limit`. Un seul appel
peut donc renvoyer une réponse **partielle, sans erreur** — le bug se manifeste
le jour où les données grossissent. C'est pour ça que le layer boucle
systématiquement (`dynamo.ts`) :

```ts
async function queryAllPages<T>(
  input: Omit<QueryCommandInput, 'ExclusiveStartKey'>,
): Promise<T[]> {
  const items: T[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const result = await documentClient.send(new QueryCommand({
      ...input,
      ExclusiveStartKey: exclusiveStartKey,
    }));
    items.push(...((result.Items || []) as T[]));
    exclusiveStartKey = result.LastEvaluatedKey;
  } while (exclusiveStartKey);

  return items;
}
```

Tant que `LastEvaluatedKey` est présent, il reste des pages.

### Le mode on-demand

```yaml
      BillingMode: PAY_PER_REQUEST
```

On paie à la lecture et à l'écriture, sans capacité à provisionner. C'est le bon
choix par défaut et le seul raisonnable pour un projet dont on ne connaît pas le
trafic.

## Nos règles : qui choisit un identifiant

Le fichier 03 a posé le problème : le jeton identifie l'application, donc
l'utilisateur voyage dans le chemin. Ça n'est sûr que si le client ne peut pas
inventer d'identités.

D'où la règle : **`POST /users` accepte un nom, et le serveur renvoie l'`userId`
qu'il a généré** (un UUID v4). Un `userId` envoyé par le client est **rejeté** :

```ts
export function rejectUnknownFields(
  object: Record<string, unknown>,
  allowed: readonly string[],
): void {
  const unknown = Object.keys(object).filter((key) => !allowed.includes(key));

  if (unknown.length > 0) {
    throw new ValidationError(
      `Unknown field(s): ${unknown.join(', ')}. Allowed field(s): ${allowed.join(', ')}.`,
      unknown[0]!,
    );
  }
}
```

Rejeté, **pas ignoré**, et c'est le point intéressant. Un champ ignoré
silencieusement fait qu'un client obsolète continue de croire qu'il choisit
l'identifiant, et le bug se découvre bien plus tard, ailleurs. Un 400 immédiat
nomme le champ fautif.

`POST /pokemons` suit la même règle avec un mécanisme différent : l'identifiant
d'un Pokémon est un **slug** de son nom (`Pokémon Éclair` → `pokemon-eclair`).
Comme l'identifiant *est* dérivé du champ unique, une seule écriture
conditionnelle suffit à garantir l'unicité. Un `userId` est aléatoire et
l'unicité porte sur un autre attribut : d'où le mécanisme ci-dessous.

## L'unicité d'un nom sans contrainte UNIQUE

DynamoDB n'a **aucun** moyen de garantir l'unicité d'un attribut qui n'est pas
une clé. Pas d'index unique, pas de contrainte.

La mauvaise solution, celle qu'on écrit spontanément : chercher si le nom existe,
et l'insérer sinon. Elle est fausse en concurrence. Deux requêtes simultanées
lisent toutes les deux « pas trouvé », et créent toutes les deux l'utilisateur.
Le problème n'est pas la probabilité, c'est que le code **ne peut pas** être
correct : la lecture et l'écriture sont deux opérations distinctes.

La solution du projet : faire du nom une **clé**, dans un second item.

```
PK = USERNAME#<nom replié>    SK = RESERVATION
```

Les deux items — le profil et la réservation — sont écrits dans **un seul**
`TransactWriteItems`, chacun avec `attribute_not_exists(PK)` :

```ts
await transactWrite(TABLE_NAME, [
  { Put: { Item: profile,     ConditionExpression: 'attribute_not_exists(PK)' } },
  { Put: { Item: reservation, ConditionExpression: 'attribute_not_exists(PK)' } },
]);
```

Une **transaction** DynamoDB est atomique : soit tout passe, soit rien. Deux
requêtes concurrentes sur le même nom ne peuvent donc pas réussir toutes les
deux — la perdante voit sa condition échouer, et comme c'est une transaction, son
item de profil est annulé aussi. Aucun utilisateur orphelin.

Quand une transaction est annulée, DynamoDB lance une
`TransactionCanceledException` avec un tableau `CancellationReasons` **aligné
positionnellement** sur les opérations envoyées. C'est comme ça qu'on sait
laquelle a échoué :

```ts
const PROFILE_OPERATION = 0;
const RESERVATION_OPERATION = 1;
```

Deux détails qui montrent que le mécanisme a été pensé jusqu'au bout :

- Sur conflit, l'API renvoie **409 avec l'`userId` qui possède déjà le nom**. Ça
  permet à un client qui a rejoué après un timeout de retrouver l'utilisateur
  qu'il a réellement créé. C'est acceptable ici parce que `GET /users` expose
  déjà tous les ids au même appelant — sur de vrais noms de personnes ce serait
  un oracle d'énumération, et il faudrait le retirer.
- L'item de réservation ne porte **aucun** `GSI1PK`/`GSI1SK`. Un index secondaire
  global ne contient que les items qui possèdent ses deux attributs de clé, donc
  les omettre suffit à garder les réservations hors de `GET /users`. Élégant :
  pas de filtre, pas d'oubli possible.

## La normalisation des noms

Deux fonctions, deux rôles différents (`layers/pokedex-utils/names.ts`).

**`normalizeDisplayName`** produit le nom qu'on affiche : trimé, espaces
multiples réduits à un seul, et normalisé en **NFC**. Ce dernier point n'est pas
cosmétique : en Unicode, `é` peut s'écrire soit comme un caractère unique, soit
comme `e` suivi d'un accent combinant. Ce sont deux chaînes différentes, qui
s'affichent pareil. Sans NFC, deux « Pokémon » visuellement identiques seraient
deux noms distincts.

**`toNameKey`** produit la valeur qui sert à comparer : **NFKC** et minuscules.
NFKC replie en plus les variantes de compatibilité — le `Ａ` pleine largeur, la
ligature `ﬁ`. Résultat : `Ash`, `ash` et `Ａsh` sont **le même** dresseur.

```ts
export function toNameKey(displayName: string): string {
  return displayName.normalize('NFKC').toLowerCase();
}
```

Un détail qui vaut d'être remarqué : c'est `toLowerCase` et **pas**
`toLocaleLowerCase`. Le second dépend de la locale de la machine — en turc, le
`I` majuscule ne se minuscule pas en `i`. La clé stockée dépendrait donc du
serveur qui l'a écrite. Le genre de bug qu'on ne trouve jamais.

Le nom que tu envoies est **stocké et renvoyé tel quel** ; seule la version
repliée sert à comparer.

Enfin le charset autorisé :

```ts
const NAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} '._-]*$/u;
```

Une lettre ou un chiffre de n'importe quelle écriture (`\p{L}`, `\p{N}` — donc
les accents et les alphabets non latins passent), puis lettres, chiffres, espaces
et `-`, `_`, `.`, `'`. Et pas de `#`, pour la raison de clé vue plus haut.

## Les codes de statut

| Code | Quand |
| --- | --- |
| `200` | Lecture réussie |
| `201` | Création réussie |
| `202` | Décision acceptée mais pas encore appliquée (→ fichier 07) |
| `400` | Corps invalide, champ inconnu, ou identifiant mal formé |
| `401` | Jeton absent ou expiré |
| `403` | Jeton valide, scope insuffisant |
| `404` | Utilisateur, Pokémon ou badge inexistant |
| `409` | Nom déjà pris, solde insuffisant, ou badge déjà décidé |

Le 409 est celui qui demande le plus de discernement : il dit « ta requête est
bien formée, mais l'état actuel du système ne permet pas de la satisfaire ». Ce
n'est ni une erreur de ta part (400) ni une panne de la nôtre (500).

## Les pièges

**Un 502 « Internal server error » sans rien dans les logs applicatifs**
Ta Lambda a retourné autre chose que `{ statusCode, headers, body }` — souvent un
objet au lieu d'une chaîne dans `body`. En intégration proxy, API Gateway est
strict.

**`ValidationException: The provided key element does not match the schema`**
Tu as fourni `PK` sans `SK` (ou l'inverse) à un `GetItem`. La clé primaire est le
couple complet.

**`ValidationException: Invalid UpdateExpression: Attribute name is a reserved keyword`**
Tu as utilisé un mot réservé DynamoDB directement dans une expression. `status`,
`level`, `size`, `name`… il y en a des centaines. La solution est un alias :

```ts
ExpressionAttributeNames: { '#status': 'status' }
```

**`ConditionalCheckFailedException`**
Ta condition d'écriture a échoué. Ce n'est **pas** forcément un bug : dans ce
projet, c'est le plus souvent le signal attendu que quelque chose existe déjà. Le
projet le traite comme une information, pas comme une panne.

**Un `Scan` qui rampe**
Si tu écris un `Scan`, c'est presque toujours que le modèle de clés ne colle pas
à l'accès dont tu as besoin. Change les clés, pas la requête.

## Pour aller plus loin

- [Les composants de DynamoDB](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.CoreComponents.html)
  — le vocabulaire de base en une page. À lire en premier.
- [DynamoDB Guide — notions clés](https://www.dynamodbguide.com/key-concepts/)
  — la même chose expliquée plus simplement, avec les équivalences vers le monde
  relationnel. Plus digeste que la doc AWS.
- [Modéliser un profil de joueur](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/data-modeling-schema-gaming-profile.html)
  — un cas très proche du nôtre.
- 📺 [AWS re:Invent 2019 : Data modeling with Amazon DynamoDB (CMY304)](https://www.youtube.com/watch?v=DIQVJqiSUkE)
  — Alex DeBrie, la référence sur le single-table design. Une heure, et c'est
  l'heure la mieux investie si tu dois modéliser du DynamoDB pour de vrai.
- [Les transactions DynamoDB](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/transaction-apis.html)
  — `TransactWriteItems`, ses limites, et `CancellationReasons`.
- [Les expressions de condition](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Expressions.ConditionExpressions.html)
  — `attribute_not_exists`, `begins_with`, et le reste.
- [La liste des mots réservés](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/ReservedWords.html)
  — à ouvrir le jour où tu vois l'erreur ci-dessus.
- [L'intégration Lambda proxy](https://docs.aws.amazon.com/apigateway/latest/developerguide/set-up-lambda-proxy-integrations.html)
  — la forme exacte de l'événement reçu et de la réponse attendue.
- [Tutoriel : une API CRUD avec API Gateway, Lambda et DynamoDB](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-dynamo-db.html)
  — le montage de bout en bout en une trentaine de minutes. Le meilleur moyen de
  se faire les mains si tout ça est nouveau.

---

Précédent : [03 — Authentification](03-authentification-cognito.md) ·
Suivant : [05 — Infrastructure as Code](05-iac-sam-et-build.md)
