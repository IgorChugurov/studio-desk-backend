import { z } from 'zod';
import { endsAfterMidnight } from './schedule-time.js';

const DURATION = 'Enter a duration from 5 to 1440 minutes in steps of 5';
const TIME = 'Enter a time in steps of 5 minutes';
const MIDNIGHT = 'A slot must end by midnight';

const clock = /^([01]\d|2[0-3]):(00|05|10|15|20|25|30|35|40|45|50|55)$/;

const weekdays = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;

const statuses = [
  'planned',
  'confirmed',
  'in_progress',
  'completed',
  'cancelled',
  'no_show',
] as const;

export const startTimeField = z
  .string()
  .trim()
  .superRefine((value, ctx) => {
    if (!clock.test(value)) {
      ctx.addIssue({
        code: 'custom',
        message: TIME,
        params: { fieldCode: 'INVALID_VALUE' },
      });
    }
  });

export const durationField = z
  .number({ error: DURATION })
  .superRefine((value, ctx) => {
    if (
      !Number.isInteger(value) ||
      value < 5 ||
      value > 1440 ||
      value % 5 !== 0
    ) {
      ctx.addIssue({
        code: 'custom',
        message: DURATION,
        params: { fieldCode: 'INVALID_VALUE' },
      });
    }
  });

const resourceIdsField = z.array(z.uuid()).superRefine((value, ctx) => {
  if (new Set(value).size !== value.length) {
    ctx.addIssue({
      code: 'custom',
      message: 'Choose each resource once',
      params: { fieldCode: 'INVALID_VALUE' },
    });
  }
});

const noteField = z.preprocess((value) => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}, z.string().nullable().optional());

const audienceField = z.enum(['group', 'one_person'], {
  error: 'Choose group or one person',
});
const formatField = z.enum(['offline', 'offline_and_online', 'online_only'], {
  error: 'Choose a format',
});
const placesField = z.number().int().nullable().optional();

function midnight(
  value: { startTime?: string; durationMinutes?: number },
  ctx: z.RefinementCtx,
) {
  if (
    value.startTime &&
    clock.test(value.startTime) &&
    typeof value.durationMinutes === 'number' &&
    Number.isInteger(value.durationMinutes) &&
    endsAfterMidnight(value.startTime, value.durationMinutes)
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['startTime'],
      message: MIDNIGHT,
      params: { fieldCode: 'INVALID_VALUE' },
    });
  }
}

const shared = {
  kind: z.enum(['service', 'block'], { error: 'Choose a slot kind' }),
  placeResourceId: z.uuid({ error: 'Select a place' }).optional(),
  resourceIds: resourceIdsField.optional(),
  startTime: startTimeField,
  durationMinutes: durationField,
  audience: audienceField.nullable().optional(),
  format: formatField.nullable().optional(),
  places: placesField,
  note: noteField,
  blocksAll: z.boolean().optional(),
};

export const slotBody = z
  .object({
    ...shared,
    date: z.iso.date({ error: 'Select a date' }),
    confirmOverlap: z.boolean().optional(),
  })
  .superRefine(midnight);

export const slotPatch = z
  .object({
    placeResourceId: shared.placeResourceId,
    resourceIds: resourceIdsField.optional(),
    date: z.iso.date({ error: 'Select a date' }).optional(),
    startTime: startTimeField.optional(),
    durationMinutes: durationField.optional(),
    audience: audienceField.nullable().optional(),
    format: formatField.nullable().optional(),
    places: placesField,
    note: noteField,
    blocksAll: z.boolean().optional(),
    status: z.enum(statuses, { error: 'Choose a status' }).optional(),
    confirmOverlap: z.boolean().optional(),
  })
  .superRefine(midnight);

export const rowBody = z
  .object({
    ...shared,
    weekday: z.enum(weekdays, { error: 'Select a day of week' }),
  })
  .superRefine(midnight);

export const rowPatch = z
  .object({
    kind: shared.kind.optional(),
    placeResourceId: shared.placeResourceId,
    resourceIds: resourceIdsField.optional(),
    startTime: startTimeField.optional(),
    durationMinutes: durationField.optional(),
    audience: audienceField.nullable().optional(),
    format: formatField.nullable().optional(),
    places: placesField,
    note: noteField,
    blocksAll: z.boolean().optional(),
    weekday: z.enum(weekdays, { error: 'Select a day of week' }).optional(),
  })
  .superRefine(midnight);

export const restoreBody = z.object({
  confirmOverlap: z.boolean().optional(),
});
