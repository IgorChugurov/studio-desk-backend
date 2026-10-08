import { z } from 'zod';
import { COUNTRIES } from './countries.js';

export { COUNTRIES };

const LANGUAGES = ['en', 'sk', 'uk'] as const;

/** IANA time zones known to the runtime. */
export const TIME_ZONES = Intl.supportedValuesOf('timeZone').sort();

const countries = new Set(COUNTRIES);
const timeZones = new Set(TIME_ZONES);

function requiredChoice(allowed: ReadonlySet<string>, message: string) {
  return z.any().superRefine((value, ctx) => {
    if (isBlank(value)) {
      ctx.addIssue({
        code: 'custom',
        message: 'This field is required',
        params: { fieldCode: 'REQUIRED' },
      });
      return;
    }
    if (typeof value !== 'string' || !allowed.has(value.trim())) {
      ctx.addIssue({
        code: 'invalid_value',
        values: [],
        input: value,
        message,
      });
    }
  });
}

function requiredText() {
  return z.any().superRefine((value, ctx) => {
    if (isBlank(value)) {
      ctx.addIssue({
        code: 'custom',
        message: 'This field is required',
        params: { fieldCode: 'REQUIRED' },
      });
      return;
    }
    if (typeof value !== 'string') {
      ctx.addIssue({
        code: 'invalid_type',
        expected: 'string',
        input: value,
        message: 'Expected a string',
      });
    }
  });
}

function isBlank(value: unknown) {
  return value === null || (typeof value === 'string' && value.trim() === '');
}

/** A sent field is checked; a missing field is left as it is. */
export const settingsPatch = z
  .object({
    language: requiredChoice(new Set(LANGUAGES), 'Choose a language'),
    country: requiredChoice(countries, 'Choose a country'),
    currency: requiredText(),
    timeZone: requiredChoice(timeZones, 'Choose a time zone'),
  })
  .partial()
  .transform((value) => ({
    ...(value.language === undefined
      ? {}
      : { language: (value.language as string).trim() }),
    ...(value.country === undefined
      ? {}
      : { country: (value.country as string).trim() }),
    ...(value.currency === undefined
      ? {}
      : { currency: (value.currency as string).trim() }),
    ...(value.timeZone === undefined
      ? {}
      : { timeZone: (value.timeZone as string).trim() }),
  }));

export interface StudioSettings {
  language: string;
  country: string;
  currency: string;
  timeZone: string;
}
