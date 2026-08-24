import { z } from 'zod';

const id = z.string().trim().min(1).max(200);

export interface EventDefinition<D> {
  source: string;
  detailType: string;
  detail: z.ZodType<D, D>;
  envelope: z.ZodType<{ detail: D }>;
}

export type EventDetail<E> = E extends EventDefinition<infer D> ? D : never;

// One definition per event type, read by the publisher and by the consumer, so
// the two cannot drift apart. The envelope is built once here rather than per
// message. z.object and not z.strictObject: an unknown detail field is stripped
// instead of rejected, which is what makes eventVersion worth having - an
// additive 1.1 field must not send every message to the DLQ of a consumer that
// predates it.
function defineEvent<D>(
  source: string,
  detailType: string,
  detail: z.ZodType<D, D>,
): EventDefinition<D> {
  return {
    source,
    detailType,
    detail,
    envelope: z.object({
      source: z.literal(source),
      'detail-type': z.literal(detailType),
      detail,
    }),
  };
}

export const PURCHASE_COMPLETED = defineEvent(
  'fr.pokemon.referential',
  'purchase.completed',
  z.object({
    eventVersion: z.literal('1.0'),
    purchaseId: id,
    userId: id,
    pokemonId: id,
    occurredAt: z.iso.datetime(),
  }),
);

export const LEVEL_REACHED = defineEvent(
  'fr.pokemon.levels',
  'level.reached',
  z.object({
    eventVersion: z.literal('1.0'),
    userId: id,
    level: z.number().int().min(1),
    points: z.number().int().min(0),
    reachedAt: z.iso.datetime(),
  }),
);
