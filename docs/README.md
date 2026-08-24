# Pokédex Serverless — le tutoriel

Cette documentation explique **tout le projet**, de zéro. Elle ne suppose aucune
connaissance d'AWS : chaque service, chaque terme et chaque règle qu'on a mise en
place y est expliqué avant d'être utilisé.

Le code, lui, est commenté en anglais — c'est un choix volontaire, pour ne pas
mélanger deux langues dans un même fichier source.

## Le parcours de lecture

Les fichiers sont numérotés dans l'ordre où ils se comprennent. Chacun suppose
d'avoir lu le précédent.

| # | Fichier | Ce que tu y apprends |
| --- | --- | --- |
| 01 | [Les bases d'AWS](01-les-bases-aws.md) | Compte, région, IAM, ARN, ce que « serverless » veut dire |
| 02 | [Vue d'ensemble](02-vue-densemble.md) | Les 4 services et le chemin complet d'un achat jusqu'à un badge |
| 03 | [Authentification (Cognito)](03-authentification-cognito.md) | JWT, OAuth2 machine à machine, scopes, authorizer |
| 04 | [Le référentiel (API + DynamoDB)](04-referentiel-api-dynamodb.md) | API Gateway, Lambda, DynamoDB, et nos règles d'unicité |
| 05 | [Infrastructure as Code](05-iac-sam-et-build.md) | CloudFormation, SAM, les stacks, SSM, le layer, TypeScript |
| 06 | [L'événementiel](06-evenementiel-eventbridge-sqs.md) | EventBridge, SQS, DLQ, idempotence, le watermark |
| 07 | [Step Functions et les badges](07-step-functions-badges.md) | Machine à états, task token, validation humaine |
| 08 | [Exploitation et débogage](08-exploitation-et-debug.md) | Logs, console, DLQ, erreurs courantes |

## Par où commencer selon ce que tu cherches

- **Je n'ai jamais fait d'AWS** → commence au 01 et déroule dans l'ordre.
- **Je veux juste faire tourner le projet** → le [README racine](../README.md)
  suffit, c'est le mode d'emploi.
- **Je viens pour comprendre le lot 4 (Step Functions)** → lis le 02 pour le
  contexte, puis le 06 (l'événement qui déclenche tout) et le 07.
- **Quelque chose ne marche pas** → va directement au 08.
- **Je dois expliquer le projet à l'oral** → le 02 est fait pour ça : il déroule
  le chemin complet d'un achat jusqu'au badge en nommant chaque saut.

## Comment lire chaque fichier

Ils suivent tous la même structure :

1. **Ce que tu vas comprendre** — pour savoir en dix secondes si tu es au bon
   endroit.
2. **Les prérequis** — ce qu'il faut avoir lu avant.
3. **Le corps** — d'abord le problème, puis le service AWS qui le résout, puis
   notre code. Jamais l'inverse : un service AWS présenté avant le problème
   qu'il règle ne se retient pas.
4. **Le code** — les extraits réels du projet, avec le fichier où les trouver.
5. **Les pièges** — les erreurs qu'on fait forcément la première fois, avec le
   message d'erreur exact qu'AWS renvoie.
6. **Pour aller plus loin** — des liens vers la doc officielle, des articles ou
   des vidéos. Tous vérifiés.
