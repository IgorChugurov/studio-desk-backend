import { z } from 'zod';
import { studioNameField } from './validation/fields.js';

export const SECTIONS = [
  'schedule',
  'catalogs',
  'clients',
  'subscriptions',
  'accounting',
  'organization-settings',
  'staff',
] as const;

export type Section = (typeof SECTIONS)[number];

export const SLOT_STATUSES = [
  'planned',
  'confirmed',
  'in_progress',
  'completed',
  'cancelled',
  'no_show',
] as const;

const RESOURCE_ROLES = ['place', 'resource', 'offering'] as const;
const CONFLICT_MODES = ['strict', 'warning', 'none'] as const;
const LANGUAGES = ['en', 'sk', 'uk'] as const;

export interface LocalizedLabels {
  en: { singular: string; plural: string };
  sk: { singular: string; plural: string };
  uk: { singular: string; plural: string };
}

export interface ResourceTypeFields {
  role: 'place' | 'resource' | 'offering';
  labels: LocalizedLabels;
  geography: boolean;
  duration: boolean;
  showcase: boolean;
  person: boolean;
  skills: boolean;
  required: boolean;
  multiple: boolean;
  conflictMode: 'strict' | 'warning' | 'none';
}

export interface PresetResourceType extends ResourceTypeFields {
  key: string;
}

export interface OrganizationResourceTypeView extends ResourceTypeFields {
  id: string;
  sortOrder: number;
}

export interface ScheduleConfig {
  audienceEnabled: boolean;
  formatEnabled: boolean;
  statuses: string[];
}

export interface BillingConfig {
  settlementMode: 'subscription' | 'direct_check' | 'external_order';
}

export interface CatalogConfig {
  resourceTypes: ResourceTypeFields[];
}

function issue(
  ctx: z.RefinementCtx,
  path: PropertyKey[],
  fieldCode: 'REQUIRED' | 'INVALID_VALUE' | 'INVALID_FORMAT',
  message: string,
) {
  ctx.addIssue({
    code: 'custom',
    path,
    message,
    params: { fieldCode },
  });
}

function isBlank(value: unknown) {
  return (
    value === null ||
    value === undefined ||
    (typeof value === 'string' && value.trim() === '')
  );
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

export function orderSections(sections: readonly string[]): Section[] {
  const present = new Set(sections);
  return SECTIONS.filter((section) => present.has(section));
}

const sectionsValue = z.any().superRefine((value, ctx) => {
  if (!Array.isArray(value) || value.length === 0) {
    issue(ctx, [], 'REQUIRED', 'Select at least one section');
    return;
  }
  const seen = new Set<string>();
  for (const [index, item] of value.entries()) {
    if (typeof item !== 'string' || !SECTIONS.includes(item as Section)) {
      issue(ctx, [index], 'INVALID_VALUE', 'Select a section');
      continue;
    }
    if (seen.has(item)) {
      issue(ctx, [index], 'INVALID_VALUE', 'Select each section once');
    }
    seen.add(item);
  }
});

function labelsOf(value: unknown, ctx: z.RefinementCtx, path: PropertyKey[]) {
  const record = asRecord(value);
  if (!record) {
    issue(ctx, path, 'REQUIRED', 'Enter all language labels');
    return;
  }
  for (const language of LANGUAGES) {
    const entry = asRecord(record[language]);
    const singular = entry?.singular;
    const plural = entry?.plural;
    if (
      typeof singular !== 'string' ||
      singular.trim() === '' ||
      typeof plural !== 'string' ||
      plural.trim() === ''
    ) {
      issue(ctx, path, 'REQUIRED', 'Enter all language labels');
      return;
    }
  }
}

function resourceTypeOf(
  value: unknown,
  ctx: z.RefinementCtx,
  path: PropertyKey[],
  withKey: boolean,
) {
  const record = asRecord(value);
  if (!record) {
    issue(ctx, path, 'INVALID_VALUE', 'Enter a resource type');
    return;
  }
  if (withKey) {
    if (typeof record.key !== 'string' || record.key.trim() === '') {
      issue(ctx, [...path, 'key'], 'REQUIRED', 'Enter a resource type key');
    }
  } else if (record.id !== undefined && record.id !== null) {
    if (
      typeof record.id !== 'string' ||
      !z.uuid().safeParse(record.id).success
    ) {
      issue(ctx, [...path, 'id'], 'INVALID_FORMAT', 'Enter a resource type id');
    }
  }
  if (
    typeof record.role !== 'string' ||
    !RESOURCE_ROLES.includes(record.role as (typeof RESOURCE_ROLES)[number])
  ) {
    issue(ctx, [...path, 'role'], 'INVALID_VALUE', 'Choose a resource role');
  }
  labelsOf(record.labels, ctx, [...path, 'labels']);
  for (const flag of [
    'geography',
    'duration',
    'showcase',
    'person',
    'skills',
    'required',
    'multiple',
  ] as const) {
    if (typeof record[flag] !== 'boolean') {
      issue(ctx, [...path, flag], 'INVALID_VALUE', 'Choose yes or no');
    }
  }
  if (
    typeof record.conflictMode !== 'string' ||
    !CONFLICT_MODES.includes(
      record.conflictMode as (typeof CONFLICT_MODES)[number],
    )
  ) {
    issue(
      ctx,
      [...path, 'conflictMode'],
      'INVALID_VALUE',
      'Choose a conflict rule',
    );
  }
}

function assertRoleInvariants(
  types: ResourceTypeFields[],
  ctx: z.RefinementCtx,
) {
  const places = types.filter((type) => type.role === 'place');
  if (places.length !== 1) {
    issue(
      ctx,
      ['resourceTypes'],
      'INVALID_VALUE',
      'Exactly one place resource type is required',
    );
  }
  types.forEach((type, index) => {
    const path = ['resourceTypes', index];
    if (type.role === 'place') {
      if (
        !type.geography ||
        type.duration ||
        type.person ||
        !type.required ||
        type.multiple
      ) {
        issue(
          ctx,
          path,
          'INVALID_VALUE',
          'A place resource type must be the time-zone anchor',
        );
      }
    }
    if (type.role === 'resource' && (type.geography || type.duration)) {
      issue(
        ctx,
        path,
        'INVALID_VALUE',
        'A resource type cannot carry geography or duration',
      );
    }
    if (type.role === 'offering') {
      if (
        !type.duration ||
        type.geography ||
        type.person ||
        type.conflictMode !== 'none'
      ) {
        issue(
          ctx,
          path,
          'INVALID_VALUE',
          'An offering has a duration and no time conflict',
        );
      }
    }
    if (type.role !== 'resource' && type.person) {
      issue(
        ctx,
        path,
        'INVALID_VALUE',
        'Only a resource can be linked to a person',
      );
    }
  });
}

function catalogValue(withKey: boolean) {
  return z.any().superRefine((value, ctx) => {
    const record = asRecord(value);
    const types = record?.resourceTypes;
    if (!record || !Array.isArray(types) || types.length === 0) {
      issue(
        ctx,
        ['resourceTypes'],
        'INVALID_VALUE',
        'Exactly one place resource type is required',
      );
      return;
    }
    const before = ctx.issues.length;
    types.forEach((type, index) => {
      resourceTypeOf(type, ctx, ['resourceTypes', index], withKey);
    });
    if (ctx.issues.length > before) return;
    const parsed = types.map((type) => normalizeResourceType(type, withKey));
    if (withKey) {
      const keys = new Set<string>();
      parsed.forEach((type, index) => {
        const key = (type as PresetResourceType).key;
        if (keys.has(key)) {
          issue(
            ctx,
            ['resourceTypes', index, 'key'],
            'INVALID_VALUE',
            'Use each resource type key once',
          );
        }
        keys.add(key);
      });
    }
    assertRoleInvariants(parsed, ctx);
  });
}

function normalizeResourceType(
  value: unknown,
  withKey: boolean,
): ResourceTypeFields & { key?: string; id?: string } {
  const record = value as Record<string, unknown>;
  const labels = record.labels as LocalizedLabels;
  const trim = (language: 'en' | 'sk' | 'uk') => ({
    singular: labels[language].singular.trim(),
    plural: labels[language].plural.trim(),
  });
  return {
    ...(withKey ? { key: (record.key as string).trim() } : {}),
    ...(typeof record.id === 'string' ? { id: record.id } : {}),
    role: record.role as ResourceTypeFields['role'],
    labels: { en: trim('en'), sk: trim('sk'), uk: trim('uk') },
    geography: record.geography as boolean,
    duration: record.duration as boolean,
    showcase: record.showcase as boolean,
    person: record.person as boolean,
    skills: record.skills as boolean,
    required: record.required as boolean,
    multiple: record.multiple as boolean,
    conflictMode: record.conflictMode as ResourceTypeFields['conflictMode'],
  };
}

function scheduleValue() {
  return z.any().superRefine((value, ctx) => {
    const record = asRecord(value);
    if (!record || typeof record.audienceEnabled !== 'boolean') {
      issue(ctx, ['audienceEnabled'], 'INVALID_VALUE', 'Choose yes or no');
    }
    if (!record || typeof record.formatEnabled !== 'boolean') {
      issue(ctx, ['formatEnabled'], 'INVALID_VALUE', 'Choose yes or no');
    }
    const statuses = record?.statuses;
    if (!Array.isArray(statuses) || statuses.length === 0) {
      issue(ctx, ['statuses'], 'INVALID_VALUE', 'Choose the slot statuses');
      return;
    }
    const known = new Set<string>(SLOT_STATUSES);
    for (const status of statuses) {
      if (typeof status !== 'string' || !known.has(status)) {
        issue(ctx, ['statuses'], 'INVALID_VALUE', 'Choose the slot statuses');
        return;
      }
    }
    if (!statuses.includes('planned') || !statuses.includes('cancelled')) {
      issue(
        ctx,
        ['statuses'],
        'INVALID_VALUE',
        'Planned and cancelled are always on',
      );
    }
  });
}

function billingValue() {
  return z.any().superRefine((value, ctx) => {
    const record = asRecord(value);
    const mode = record?.settlementMode;
    if (
      mode !== 'subscription' &&
      mode !== 'direct_check' &&
      mode !== 'external_order'
    ) {
      issue(
        ctx,
        ['settlementMode'],
        'INVALID_VALUE',
        'Choose a settlement mode',
      );
    }
  });
}

function emptyToNull(value: unknown) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  return value;
}

const descriptionField = z.preprocess(
  emptyToNull,
  z.union([z.null(), z.string().trim().min(1)]),
);

function normalizeSections(value: string[]): Section[] {
  return orderSections(value);
}

function normalizeSchedule(value: {
  audienceEnabled: boolean;
  formatEnabled: boolean;
  statuses: string[];
}): ScheduleConfig {
  const selected = new Set(value.statuses);
  return {
    audienceEnabled: value.audienceEnabled,
    formatEnabled: value.formatEnabled,
    statuses: SLOT_STATUSES.filter((status) => selected.has(status)),
  };
}

function normalizeCatalog(
  value: { resourceTypes: unknown[] },
  withKey: boolean,
) {
  return {
    resourceTypes: value.resourceTypes.map((type) =>
      normalizeResourceType(type, withKey),
    ),
  };
}

export const presetCreateBody = z
  .object({
    name: studioNameField,
    description: descriptionField.optional(),
    sections: sectionsValue,
    catalogConfig: catalogValue(true),
    scheduleConfig: scheduleValue(),
    billingConfig: billingValue(),
  })
  .transform((value) => ({
    name: value.name,
    description: value.description ?? null,
    sections: normalizeSections(value.sections as string[]),
    catalogConfig: normalizeCatalog(
      value.catalogConfig as { resourceTypes: unknown[] },
      true,
    ),
    scheduleConfig: normalizeSchedule(
      value.scheduleConfig as {
        audienceEnabled: boolean;
        formatEnabled: boolean;
        statuses: string[];
      },
    ),
    billingConfig: value.billingConfig as BillingConfig,
  }));

export const presetPatchBody = z
  .object({
    name: studioNameField.optional(),
    description: descriptionField.optional(),
    sections: sectionsValue.optional(),
    catalogConfig: catalogValue(true).optional(),
    scheduleConfig: scheduleValue().optional(),
    billingConfig: billingValue().optional(),
  })
  .transform((value) => ({
    ...(value.name === undefined ? {} : { name: value.name }),
    ...(value.description === undefined
      ? {}
      : { description: value.description }),
    ...(value.sections === undefined
      ? {}
      : { sections: normalizeSections(value.sections as string[]) }),
    ...(value.catalogConfig === undefined
      ? {}
      : {
          catalogConfig: normalizeCatalog(
            value.catalogConfig as { resourceTypes: unknown[] },
            true,
          ),
        }),
    ...(value.scheduleConfig === undefined
      ? {}
      : {
          scheduleConfig: normalizeSchedule(
            value.scheduleConfig as {
              audienceEnabled: boolean;
              formatEnabled: boolean;
              statuses: string[];
            },
          ),
        }),
    ...(value.billingConfig === undefined
      ? {}
      : { billingConfig: value.billingConfig as BillingConfig }),
  }));

export const organizationSectionsField = sectionsValue.transform((value) =>
  normalizeSections(value as string[]),
);

export const organizationCatalogField = catalogValue(false).transform((value) =>
  normalizeCatalog(value as { resourceTypes: unknown[] }, false),
);

export const organizationScheduleField = scheduleValue().transform((value) =>
  normalizeSchedule(
    value as {
      audienceEnabled: boolean;
      formatEnabled: boolean;
      statuses: string[];
    },
  ),
);

export const organizationBillingField = billingValue().transform(
  (value) => value as BillingConfig,
);

export function isBlankPresetId(value: unknown) {
  return isBlank(value);
}
