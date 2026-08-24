import { createHash } from 'node:crypto';
import { ValidationError } from './validate';

// The badge catalog belongs to the Badges service and to nobody else. Levels
// publishes "this user reached level 2"; it never publishes "give them the
// Collector badge". If Levels named the badge it would own the badge policy,
// and the boundary between the two services would exist only on the diagram.
//
// Level 3 is deliberately missing. It is what exercises the "no badge for this
// level" path in the consumer, which has to acknowledge the message without
// creating anything - not treat it as a failure.
export const BADGE_CATALOG: Readonly<Record<number, BadgeDefinition>> = {
  1: { code: 'rookie', label: 'Rookie Trainer' },
  2: { code: 'collector', label: 'Pokemon Collector' },
  4: { code: 'champion', label: 'League Champion' },
};

export interface BadgeDefinition {
  code: string;
  label: string;
}

// PENDING is written by the consumer. The other three are written by the state
// machine, and only ever from PENDING - which is what the conditional update on
// each terminal state enforces.
export type BadgeStatus = 'PENDING' | 'GRANTED' | 'REFUSED' | 'EXPIRED';

// Every badge item of a user shares this sort-key prefix, so the read route can
// fetch them all with one begins_with query and no secondary index.
export const BADGE_SK_PREFIX = 'BADGE#LEVEL#';

// Step Functions caps an execution name at 80 characters.
const MAX_EXECUTION_NAME_LENGTH = 80;

// Characters Step Functions accepts in an execution name. It rejects
// whitespace and : / ? # % \ ^ | ~ $ & , ; * " < > { } [ ] among others, so
// this allows strictly less than that rather than enumerating the ban list.
const SAFE_NAME = /^[A-Za-z0-9_-]+$/;

const BADGE_ID = /^lvl-(\d{1,4})$/;

export function badgeForLevel(level: number): BadgeDefinition | undefined {
  return BADGE_CATALOG[level];
}

// `lvl-3`, not `BADGE#LEVEL#3`: this one travels in a URL path, and `#` would
// be read as the start of a fragment and never reach API Gateway.
export function badgeIdFor(level: number): string {
  return `lvl-${level}`;
}

export function badgeSortKey(level: number): string {
  return `${BADGE_SK_PREFIX}${level}`;
}

// Thrown as a 400 rather than returned as undefined: the badgeId comes from the
// request path, so a malformed one is a client error, and errorResponse already
// knows how to render a ValidationError.
export function levelFromBadgeId(badgeId: unknown): number {
  const match = typeof badgeId === 'string' ? BADGE_ID.exec(badgeId.trim()) : null;

  if (!match) {
    throw new ValidationError(
      'badgeId must look like lvl-<level>, for example lvl-2.',
      'badgeId',
    );
  }

  return Number(match[1]);
}

// The whole idempotency of the workflow rests on this name. Step Functions
// refuses to start two executions with the same name, so a deterministic name
// means a redelivered level.reached cannot open a second execution - no lock,
// no dedupe table.
//
// It has to stay injective for that to hold. Sanitising or truncating a long id
// is deterministic but not injective: two different users could collapse onto
// one name, and Step Functions would reject the second one as a duplicate, so
// that user's badge would sit PENDING with no workflow behind it, forever.
// Anything not already safe and short is therefore hashed instead of mangled.
export function executionNameFor(userId: string, level: number): string {
  const suffix = `-lvl-${level}`;
  const name = `badge-${userId}${suffix}`;

  if (SAFE_NAME.test(userId) && name.length <= MAX_EXECUTION_NAME_LENGTH) {
    return name;
  }

  const digest = createHash('sha256').update(userId).digest('hex').slice(0, 32);

  return `badge-${digest}${suffix}`;
}
