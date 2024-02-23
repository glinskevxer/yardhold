import { ValidationError } from '../core/errors.js';
import { formatInstant, minutesBetween } from './instant.js';

/**
 * A period is a half open interval of instants, `[start, end)`. Half open is
 * the only convention that lets a suspension end and the clock resume in the
 * same minute without that minute being counted twice or lost.
 */

export function period(start, end) {
  if (end < start) {
    throw new ValidationError('a period cannot end before it starts', { start, end });
  }
  return { start, end };
}

export function isEmpty(value) {
  return value.end <= value.start;
}

export function durationMinutes(value) {
  return Math.max(0, minutesBetween(value.start, value.end));
}

export function contains(value, moment) {
  return moment >= value.start && moment < value.end;
}

export function overlaps(left, right) {
  return left.start < right.end && right.start < left.end;
}

export function intersect(left, right) {
  const start = Math.max(left.start, right.start);
  const end = Math.min(left.end, right.end);
  return end <= start ? null : period(start, end);
}

export function union(left, right) {
  if (!overlaps(left, right) && left.end !== right.start && right.end !== left.start) {
    return null;
  }
  return period(Math.min(left.start, right.start), Math.max(left.end, right.end));
}

/** Cut `holes` out of `value`, returning what is left in order. */
export function subtract(value, holes) {
  let pieces = [value];
  for (const hole of holes) {
    const next = [];
    for (const piece of pieces) {
      if (!overlaps(piece, hole)) {
        next.push(piece);
        continue;
      }
      if (hole.start > piece.start) {
        next.push(period(piece.start, hole.start));
      }
      if (hole.end < piece.end) {
        next.push(period(hole.end, piece.end));
      }
    }
    pieces = next;
  }
  return pieces.filter((piece) => !isEmpty(piece));
}

export function mergePeriods(values) {
  const sorted = [...values]
    .filter((value) => !isEmpty(value))
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const merged = [];
  for (const value of sorted) {
    const last = merged[merged.length - 1];
    if (last && value.start <= last.end) {
      merged[merged.length - 1] = period(last.start, Math.max(last.end, value.end));
    } else {
      merged.push(value);
    }
  }
  return merged;
}

export function totalMinutes(values) {
  return mergePeriods(values).reduce((sum, value) => sum + durationMinutes(value), 0);
}

export function clamp(value, bounds) {
  return intersect(value, bounds);
}

export function formatPeriod(value, offsetMinutes = 0) {
  return `${formatInstant(value.start, offsetMinutes)}/${formatInstant(value.end, offsetMinutes)}`;
}
