const WEEKDAYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const;

export type Weekday = Exclude<(typeof WEEKDAYS)[number], 'sunday'> | 'sunday';

/** Monday of the week that contains `iso` (`YYYY-MM-DD`). */
export function mondayOf(iso: string): string {
  const date = utcDate(iso);
  const day = date.getUTCDay();
  const shift = day === 0 ? -6 : 1 - day;
  date.setUTCDate(date.getUTCDate() + shift);
  return formatIso(date);
}

export function addDays(iso: string, days: number): string {
  const date = utcDate(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return formatIso(date);
}

export function weekdayOf(iso: string): Weekday {
  return WEEKDAYS[utcDate(iso).getUTCDay()]!;
}

/** Inclusive day count from `start` through `end`. */
export function inclusiveDays(start: string, end: string): number {
  const a = utcDate(start).getTime();
  const b = utcDate(end).getTime();
  return Math.round((b - a) / 86_400_000) + 1;
}

export function eachDate(start: string, end: string): string[] {
  const dates: string[] = [];
  for (let cursor = start; cursor <= end; cursor = addDays(cursor, 1)) {
    dates.push(cursor);
  }
  return dates;
}

/** Clock minutes from `HH:MM`. */
export function minutesOf(hhmm: string): number {
  const [hour, minute] = hhmm.slice(0, 5).split(':').map(Number);
  return hour! * 60 + minute!;
}

export function clockOf(minutes: number): string {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** Half-open clock intervals. Ending at the next start does not overlap. */
export function clocksOverlap(
  startA: string,
  durationA: number,
  startB: string,
  durationB: number,
): boolean {
  const a0 = minutesOf(startA);
  const b0 = minutesOf(startB);
  return a0 < b0 + durationB && b0 < a0 + durationA;
}

export function endsAfterMidnight(start: string, duration: number): boolean {
  return minutesOf(start) + duration > 1440;
}

export function endClock(start: string, duration: number): string {
  return clockOf(minutesOf(start) + duration);
}

/** Singular when `n` is 1. Zero and every other count use the plural. */
export function counted(n: number, singular: string, plural: string): string {
  return n === 1 ? singular : plural;
}

export function appliedText(added: number): string {
  return counted(
    added,
    `Template applied: ${added} slot added`,
    `Template applied: ${added} slots added`,
  );
}

export function clearPreviewText(deleted: number): string {
  return counted(
    deleted,
    `${deleted} slot will be deleted`,
    `${deleted} slots will be deleted`,
  );
}

export function replacePreviewText(deleted: number, created: number): string {
  return counted(
    deleted,
    `${deleted} slot will be deleted and ${created} created`,
    `${deleted} slots will be deleted and ${created} created`,
  );
}

export function busyMessage(input: {
  resourceName: string;
  title: string;
  start: string;
  end: string;
}): string {
  return `${input.resourceName} is busy at this time: ${input.title} ${input.start}–${input.end}`;
}

function utcDate(iso: string): Date {
  const [year, month, day] = iso.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(year!, month! - 1, day));
}

function formatIso(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
