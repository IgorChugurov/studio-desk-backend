import type { FieldError } from '../../../common/errors/api-error.js';
import { FieldErrorCode } from '../../../common/errors/api-error.js';
import type { ScheduleConfig } from '../../../common/organization-config.js';

export type SlotKind = 'service' | 'block';
export type Audience = 'group' | 'one_person';
export type SlotFormat = 'offline' | 'offline_and_online' | 'online_only';
export type ResourceRole = 'place' | 'resource' | 'offering';
export type ConflictMode = 'strict' | 'warning' | 'none';

export interface CatalogType {
  id: string;
  role: ResourceRole;
  required: boolean;
  multiple: boolean;
  conflictMode: ConflictMode;
  label: string;
}

export interface CatalogResource {
  id: string;
  name: string;
  type: 'ordinary' | 'virtual' | null;
  timeZone: string | null;
  typeId: string;
  role: ResourceRole;
  required: boolean;
  multiple: boolean;
  conflictMode: ConflictMode;
  label: string;
}

export interface SlotDraft {
  kind: SlotKind;
  placeResourceId?: string;
  resourceIds: string[];
  startTime: string;
  durationMinutes: number;
  audience?: Audience | null;
  format?: SlotFormat | null;
  places?: number | null;
  note?: string | null;
  blocksAll?: boolean;
}

export interface SlotFields {
  kind: SlotKind;
  placeResourceId: string;
  resourceIds: string[];
  startTime: string;
  durationMinutes: number;
  audience: Audience | null;
  format: SlotFormat | null;
  places: number | null;
  note: string | null;
  blocksAll: boolean;
}

export interface PreparedSlot extends SlotFields {
  timeZone: string;
  links: CatalogResource[];
}

export function slotTitle(
  kind: SlotKind,
  offeringNames: string[],
  note: string | null,
): string {
  if (kind === 'block') {
    const text = note?.trim();
    return text ? text : 'Blocked time';
  }
  return offeringNames.length > 0 ? offeringNames.join(', ') : 'Service';
}

export function offeringIds(
  resourceIds: string[],
  resources: Map<string, CatalogResource>,
): string[] {
  return resourceIds
    .filter((id) => resources.get(id)?.role === 'offering')
    .sort();
}

export function prepareSlot(
  draft: SlotDraft,
  resources: Map<string, CatalogResource>,
  places: CatalogResource[],
  types: CatalogType[],
  config: ScheduleConfig,
): { value?: PreparedSlot; errors: FieldError[] } {
  const errors: FieldError[] = [];
  const place = resolvePlace(draft.placeResourceId, resources, places, errors);
  const selected = resolveResources(draft.resourceIds, resources, errors);
  if (draft.kind === 'block') {
    prepareBlock(draft, selected, errors);
  } else {
    prepareService(draft, selected, types, place, config, errors);
  }
  if (errors.length > 0 || !place?.timeZone || place.type === null) {
    if (errors.length === 0) {
      errors.push({
        code: FieldErrorCode.INVALID_VALUE,
        field: 'placeResourceId',
        message: 'Choose a place of this organization',
      });
    }
    return { errors };
  }
  const normalized = normalizedFields(draft, place, selected, config);
  if (!normalized) return { errors };
  return {
    errors,
    value: {
      ...normalized,
      timeZone: place.timeZone,
      links: [place, ...selected],
    },
  };
}

function resolvePlace(
  placeResourceId: string | undefined,
  resources: Map<string, CatalogResource>,
  places: CatalogResource[],
  errors: FieldError[],
): CatalogResource | undefined {
  if (placeResourceId === undefined) {
    if (places.length === 1) return places[0];
    errors.push({
      code: FieldErrorCode.REQUIRED,
      field: 'placeResourceId',
      message: 'Select a place',
    });
    return undefined;
  }
  const place = resources.get(placeResourceId);
  if (!place || place.role !== 'place' || !place.timeZone || !place.type) {
    errors.push({
      code: FieldErrorCode.INVALID_VALUE,
      field: 'placeResourceId',
      message: 'Choose a place of this organization',
    });
    return undefined;
  }
  return place;
}

function resolveResources(
  resourceIds: string[],
  resources: Map<string, CatalogResource>,
  errors: FieldError[],
): CatalogResource[] {
  const selected: CatalogResource[] = [];
  let invalid = false;
  for (const id of resourceIds) {
    const resource = resources.get(id);
    if (!resource || resource.role === 'place') invalid = true;
    else selected.push(resource);
  }
  if (invalid) {
    errors.push({
      code: FieldErrorCode.INVALID_VALUE,
      field: 'resourceIds',
      message: 'Choose resources of this organization',
    });
  }
  return selected;
}

function prepareBlock(
  draft: SlotDraft,
  selected: CatalogResource[],
  errors: FieldError[],
) {
  if (selected.some((resource) => resource.role === 'offering')) {
    errors.push({
      code: FieldErrorCode.INVALID_VALUE,
      field: 'resourceIds',
      message: 'A block cannot include an offering',
    });
  }
  assertMultiplicity(selected, errors);
  if (draft.audience != null) {
    errors.push({
      code: FieldErrorCode.INVALID_VALUE,
      field: 'audience',
      message: 'A block has no audience',
    });
  }
  if (draft.format != null) {
    errors.push({
      code: FieldErrorCode.INVALID_VALUE,
      field: 'format',
      message: 'A block has no format',
    });
  }
  if (draft.places != null) {
    errors.push({
      code: FieldErrorCode.INVALID_VALUE,
      field: 'places',
      message: 'A block has no places',
    });
  }
}

function prepareService(
  draft: SlotDraft,
  selected: CatalogResource[],
  types: CatalogType[],
  place: CatalogResource | undefined,
  config: ScheduleConfig,
  errors: FieldError[],
) {
  if (draft.note != null) {
    errors.push({
      code: FieldErrorCode.INVALID_VALUE,
      field: 'note',
      message: 'A service has no note',
    });
  }
  if (draft.blocksAll) {
    errors.push({
      code: FieldErrorCode.INVALID_VALUE,
      field: 'blocksAll',
      message: 'A service cannot block every resource',
    });
  }
  const counts = new Map<string, number>();
  for (const resource of selected) {
    counts.set(resource.typeId, (counts.get(resource.typeId) ?? 0) + 1);
  }
  for (const type of types) {
    if (type.role === 'place') continue;
    const count = counts.get(type.id) ?? 0;
    if (type.required && count === 0) {
      errors.push({
        code: FieldErrorCode.REQUIRED,
        field: 'resourceIds',
        message: `Select a ${type.label}`,
      });
    }
    if (!type.multiple && count > 1) {
      errors.push({
        code: FieldErrorCode.INVALID_VALUE,
        field: 'resourceIds',
        message: `Choose one ${type.label}`,
      });
    }
  }
  const virtual = place?.type === 'virtual';
  if (
    config.formatEnabled &&
    virtual &&
    draft.format &&
    draft.format !== 'online_only'
  ) {
    errors.push({
      code: FieldErrorCode.INVALID_VALUE,
      field: 'format',
      message: 'A virtual place is online only',
    });
  }
  if (config.audienceEnabled && place) {
    const format = resolvedFormat(draft, place, config);
    const audience = draft.audience ?? 'group';
    const placesForbidden =
      virtual || audience === 'one_person' || format === 'online_only';
    if (placesForbidden && draft.places != null) {
      errors.push({
        code: FieldErrorCode.INVALID_VALUE,
        field: 'places',
        message: 'Places are not used for this slot',
      });
    }
    if (!placesForbidden && (draft.places == null || draft.places < 1)) {
      errors.push({
        code: FieldErrorCode.REQUIRED,
        field: 'places',
        message: 'Enter the number of places',
      });
    }
  }
}

function assertMultiplicity(selected: CatalogResource[], errors: FieldError[]) {
  const counts = new Map<
    string,
    { count: number; label: string; multiple: boolean }
  >();
  for (const resource of selected) {
    const current = counts.get(resource.typeId);
    if (current) current.count += 1;
    else {
      counts.set(resource.typeId, {
        count: 1,
        label: resource.label,
        multiple: resource.multiple,
      });
    }
  }
  for (const type of counts.values()) {
    if (!type.multiple && type.count > 1) {
      errors.push({
        code: FieldErrorCode.INVALID_VALUE,
        field: 'resourceIds',
        message: `Choose one ${type.label}`,
      });
    }
  }
}

function normalizedFields(
  draft: SlotDraft,
  place: CatalogResource,
  selected: CatalogResource[],
  config: ScheduleConfig,
): SlotFields | undefined {
  if (draft.kind === 'block') {
    return {
      kind: 'block',
      placeResourceId: place.id,
      resourceIds: selected.map((resource) => resource.id),
      startTime: draft.startTime,
      durationMinutes: draft.durationMinutes,
      audience: null,
      format: null,
      places: null,
      note: draft.note ?? null,
      blocksAll: draft.blocksAll ?? false,
    };
  }
  const format = resolvedFormat(draft, place, config);
  const audience = config.audienceEnabled
    ? (draft.audience ?? 'group')
    : 'one_person';
  const placesForbidden =
    !config.audienceEnabled ||
    place.type === 'virtual' ||
    audience === 'one_person' ||
    format === 'online_only';
  return {
    kind: 'service',
    placeResourceId: place.id,
    resourceIds: selected.map((resource) => resource.id),
    startTime: draft.startTime,
    durationMinutes: draft.durationMinutes,
    audience,
    format,
    places: placesForbidden ? null : (draft.places ?? null),
    note: null,
    blocksAll: false,
  };
}

function resolvedFormat(
  draft: SlotDraft,
  place: CatalogResource,
  config: ScheduleConfig,
): SlotFormat {
  if (place.type === 'virtual') return 'online_only';
  if (!config.formatEnabled) return 'offline';
  return draft.format ?? 'offline';
}
