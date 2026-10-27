import { describe, expect, it } from 'vitest';
import {
  appliedText,
  clocksOverlap,
  clearPreviewText,
  endsAfterMidnight,
  inclusiveDays,
  mondayOf,
  replacePreviewText,
  weekdayOf,
} from './schedule-time.js';

describe('schedule clock and weeks', () => {
  it('treats a week as Monday to Sunday', () => {
    expect(mondayOf('2026-10-16')).toBe('2026-10-12');
    expect(weekdayOf('2026-10-12')).toBe('monday');
    expect(weekdayOf('2026-10-18')).toBe('sunday');
    expect(inclusiveDays('2026-10-12', '2026-10-18')).toBe(7);
  });

  it('allows back-to-back and refuses a real overlap', () => {
    expect(clocksOverlap('18:00', 60, '19:00', 60)).toBe(false);
    expect(clocksOverlap('18:00', 60, '18:30', 60)).toBe(true);
  });

  it('refuses a class that would end after midnight', () => {
    expect(endsAfterMidnight('20:00', 240)).toBe(false);
    expect(endsAfterMidnight('20:05', 240)).toBe(true);
  });

  it('uses the singular sentence only when the first count is 1', () => {
    expect(appliedText(1)).toBe('Template applied: 1 class added');
    expect(appliedText(0)).toBe('Template applied: 0 classes added');
    expect(clearPreviewText(1)).toBe('1 class will be deleted');
    expect(replacePreviewText(1, 3)).toBe(
      '1 class will be deleted and 3 created',
    );
    expect(replacePreviewText(2, 1)).toBe(
      '2 classes will be deleted and 1 created',
    );
  });
});
