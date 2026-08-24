import { createHash } from 'node:crypto';
import { ValidationError } from './validate';

export const BADGE_CATALOG: Readonly<Record<number, BadgeDefinition>> = {
  1: { code: 'rookie', label: 'Rookie Trainer' },
  2: { code: 'collector', label: 'Pokemon Collector' },
  4: { code: 'champion', label: 'League Champion' },
};

export interface BadgeDefinition {
  code: string;
  label: string;
}

export type BadgeStatus = 'PENDING' | 'GRANTED' | 'REFUSED' | 'EXPIRED';

export const BADGE_SK_PREFIX = 'BADGE#LEVEL#';

const MAX_EXECUTION_NAME_LENGTH = 80;

const SAFE_NAME = /^[A-Za-z0-9_-]+$/;

const BADGE_ID = /^lvl-(\d{1,4})$/;

// The catalog belongs to the Badges service and to nobody else: Levels publishes
// "this user reached level 2", never "give them the Collector badge". Level 3 is
// deliberately absent, so the "no badge for this level" path - acknowledge the
// message, create nothing - is exercised for real.
export function badgeForLevel(level: number): BadgeDefinition | undefined {
  return BADGE_CATALOG[level];
}

// `lvl-3`, not `BADGE#LEVEL#3`: this one travels in a URL path, and `#` would be
// read as the start of a fragment and never reach API Gateway.
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

// The whole idempotency of the workflow rests on this name: Step Functions
// refuses two executions with the same name, so a redelivered level.reached
// cannot open a second one - no lock, no dedupe table. It has to stay injective
// for that to hold, which is why anything not already safe and short is hashed
// rather than sanitised: truncating is deterministic but not injective, and two
// users collapsing onto one name would leave a badge PENDING forever. Step
// Functions caps the name at 80 characters and rejects whitespace and
// : / ? # % \ ^ | ~ $ & , ; * " < > { } [ ] among others, so SAFE_NAME allows
// strictly less than that rather than enumerating the ban list.
export function executionNameFor(userId: string, level: number): string {
  const suffix = `-lvl-${level}`;
  const name = `badge-${userId}${suffix}`;

  if (SAFE_NAME.test(userId) && name.length <= MAX_EXECUTION_NAME_LENGTH) {
    return name;
  }

  const digest = createHash('sha256').update(userId).digest('hex').slice(0, 32);

  return `badge-${digest}${suffix}`;
}
