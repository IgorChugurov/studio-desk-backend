import { z } from 'zod';
import { endsAfterMidnight } from './schedule-time.js';

const DURATION = 'Enter a duration from 5 to 240 minutes in steps of 5';
const TIME = 'Enter a time in steps of 5 minutes';

const clock = /^([01]\d|2[0-3]):(00|05|10|15|20|25|30|35|40|45|50|55)$/;

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
      value > 240 ||
      value % 5 !== 0
    ) {
      ctx.addIssue({
        code: 'custom',
        message: DURATION,
        params: { fieldCode: 'INVALID_VALUE' },
      });
    }
  });

const trainerIdsField = z.array(z.uuid()).superRefine((value, ctx) => {
  if (value.length === 0) {
    ctx.addIssue({
      code: 'custom',
      message: 'Select at least one trainer',
      params: { fieldCode: 'REQUIRED' },
    });
  }
  if (new Set(value).size !== value.length) {
    ctx.addIssue({
      code: 'custom',
      message: 'Choose each trainer once',
      params: { fieldCode: 'INVALID_VALUE' },
    });
  }
});

const shared = {
  hallId: z.uuid({ error: 'Select a hall' }),
  startTime: startTimeField,
  durationMinutes: durationField,
  trainerIds: trainerIdsField,
  classTypeId: z.uuid({ error: 'Select a class type' }),
  audience: z.enum(['group', 'one_person'], {
    error: 'Choose group or one person',
  }),
  format: z.enum(['offline', 'offline_and_online', 'online_only'], {
    error: 'Choose a format',
  }),
  places: z.number().int().nullable().optional(),
};

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
      message: 'A class must end by midnight',
      params: { fieldCode: 'INVALID_VALUE' },
    });
  }
}

export const classBody = z
  .object({
    ...shared,
    date: z.iso.date({ error: 'Select a date' }),
  })
  .superRefine(midnight)
  .transform((value) => ({ ...value, places: value.places ?? null }));

export const rowBody = z
  .object({
    ...shared,
    weekday: z.enum(
      [
        'monday',
        'tuesday',
        'wednesday',
        'thursday',
        'friday',
        'saturday',
        'sunday',
      ],
      { error: 'Select a day of week' },
    ),
  })
  .superRefine(midnight)
  .transform((value) => ({ ...value, places: value.places ?? null }));

export const rowPatch = z
  .object({
    hallId: shared.hallId.optional(),
    startTime: startTimeField.optional(),
    durationMinutes: durationField.optional(),
    trainerIds: trainerIdsField.optional(),
    classTypeId: shared.classTypeId.optional(),
    audience: shared.audience.optional(),
    format: shared.format.optional(),
    places: z.number().int().nullable().optional(),
    weekday: z
      .enum(
        [
          'monday',
          'tuesday',
          'wednesday',
          'thursday',
          'friday',
          'saturday',
          'sunday',
        ],
        { error: 'Select a day of week' },
      )
      .optional(),
  })
  .superRefine(midnight);

export const classPatch = z
  .object({
    hallId: shared.hallId.optional(),
    date: z.iso.date({ error: 'Select a date' }).optional(),
    startTime: startTimeField.optional(),
    durationMinutes: durationField.optional(),
    trainerIds: trainerIdsField.optional(),
    classTypeId: z.uuid().optional(),
    audience: shared.audience.optional(),
    format: shared.format.optional(),
    places: z.number().int().nullable().optional(),
  })
  .superRefine(midnight);
