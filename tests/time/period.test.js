import { describe, expect, it } from 'vitest';
import {
  clamp,
  contains,
  durationMinutes,
  formatPeriod,
  intersect,
  isEmpty,
  mergePeriods,
  overlaps,
  period,
  subtract,
  totalMinutes,
  union,
} from '../../src/time/period.js';
import { parseInstant } from '../../src/time/instant.js';
import { ValidationError } from '../../src/core/errors.js';

const at = (text) => parseInstant(`2024-03-07T${text}Z`);
const span = (from, to) => period(at(from), at(to));

describe('period', () => {
  it('refuses a backwards interval', () => {
    expect(() => span('10:00', '09:00')).toThrow(ValidationError);
  });

  it('allows an empty one', () => {
    const value = span('10:00', '10:00');
    expect(isEmpty(value)).toBe(true);
    expect(durationMinutes(value)).toBe(0);
  });

  it('measures in minutes', () => {
    expect(durationMinutes(span('10:00', '12:30'))).toBe(150);
  });
});

describe('containment', () => {
  it('is closed at the start and open at the end', () => {
    const value = span('10:00', '12:00');
    expect(contains(value, at('10:00'))).toBe(true);
    expect(contains(value, at('11:59'))).toBe(true);
    expect(contains(value, at('12:00'))).toBe(false);
    expect(contains(value, at('09:59'))).toBe(false);
  });

  it('does not count a shared endpoint as an overlap', () => {
    expect(overlaps(span('10:00', '12:00'), span('12:00', '13:00'))).toBe(false);
    expect(overlaps(span('10:00', '12:00'), span('11:59', '13:00'))).toBe(true);
  });
});

describe('intersect and union', () => {
  it('takes the common part', () => {
    expect(intersect(span('10:00', '12:00'), span('11:00', '14:00'))).toEqual(
      span('11:00', '12:00')
    );
  });

  it('is null when nothing is shared', () => {
    expect(intersect(span('10:00', '11:00'), span('11:00', '12:00'))).toBeNull();
  });

  it('joins touching periods', () => {
    expect(union(span('10:00', '11:00'), span('11:00', '12:00'))).toEqual(span('10:00', '12:00'));
  });

  it('refuses to join a gap', () => {
    expect(union(span('10:00', '11:00'), span('11:01', '12:00'))).toBeNull();
  });
});

describe('subtract', () => {
  it('cuts a hole in the middle', () => {
    const left = subtract(span('08:00', '18:00'), [span('12:00', '13:00')]);
    expect(left).toEqual([span('08:00', '12:00'), span('13:00', '18:00')]);
  });

  it('trims from the front and the back', () => {
    expect(subtract(span('08:00', '18:00'), [span('06:00', '09:00')])).toEqual([
      span('09:00', '18:00'),
    ]);
    expect(subtract(span('08:00', '18:00'), [span('17:00', '20:00')])).toEqual([
      span('08:00', '17:00'),
    ]);
  });

  it('can remove everything', () => {
    expect(subtract(span('08:00', '18:00'), [span('07:00', '19:00')])).toEqual([]);
  });

  it('leaves a period a hole does not touch', () => {
    expect(subtract(span('08:00', '10:00'), [span('12:00', '13:00')])).toEqual([
      span('08:00', '10:00'),
    ]);
  });

  it('applies several holes in turn', () => {
    const left = subtract(span('00:00', '23:00'), [span('06:00', '07:00'), span('12:00', '13:00')]);
    expect(left).toHaveLength(3);
  });
});

describe('merge', () => {
  it('folds overlapping and touching periods', () => {
    const merged = mergePeriods([
      span('12:00', '13:00'),
      span('08:00', '10:00'),
      span('09:30', '11:00'),
      span('11:00', '11:30'),
    ]);
    expect(merged).toEqual([span('08:00', '11:30'), span('12:00', '13:00')]);
  });

  it('drops empty periods', () => {
    expect(mergePeriods([span('08:00', '08:00')])).toEqual([]);
  });

  it('totals without double counting', () => {
    expect(totalMinutes([span('08:00', '10:00'), span('09:00', '11:00')])).toBe(180);
  });
});

describe('clamp and format', () => {
  it('clamps into bounds', () => {
    expect(clamp(span('06:00', '20:00'), span('08:00', '18:00'))).toEqual(span('08:00', '18:00'));
  });

  it('formats as a slash pair', () => {
    expect(formatPeriod(span('08:00', '18:00'))).toBe('2024-03-07T08:00Z/2024-03-07T18:00Z');
  });
});
