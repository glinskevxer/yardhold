import { ConflictError, ValidationError } from '../core/errors.js';
import { requireArray, requireString } from '../core/guards.js';
import { compareDates, formatCivilDate, parseCivilDate } from '../time/civil.js';

/**
 * Effective dating. A tariff page is published with a date it takes effect and
 * usually no end date at all, so the page in force on a day is the latest one
 * published on or before it. Two pages with the same effective date is a real
 * error rather than something to resolve quietly, because the carrier's own
 * system will pick one and there is no telling which.
 */

export function effectiveEntry(effectiveFrom, value, { effectiveTo, note } = {}) {
  const from = parseCivilDate(requireString(effectiveFrom, 'effectiveFrom'));
  const to = effectiveTo === undefined ? undefined : parseCivilDate(effectiveTo);
  if (to !== undefined && compareDates(from, to) > 0) {
    throw new ValidationError('an entry cannot expire before it takes effect', {
      effectiveFrom,
      effectiveTo,
    });
  }
  return Object.freeze({ from, to, value, note });
}

export function effectiveSeries(entries = []) {
  const built = requireArray(entries, 'entries').map((entry) =>
    entry.from && entry.value !== undefined
      ? entry
      : effectiveEntry(entry.effectiveFrom, entry.value, entry)
  );
  const sorted = [...built].sort((a, b) => compareDates(a.from, b.from));
  for (let index = 1; index < sorted.length; index += 1) {
    if (compareDates(sorted[index - 1].from, sorted[index].from) === 0) {
      throw new ConflictError('two entries take effect on the same day', {
        on: formatCivilDate(sorted[index].from),
      });
    }
  }
  return Object.freeze(sorted);
}

/**
 * Is this record the one in force on that day. Three places were each writing
 * the same pair of comparisons out by hand, and the tariff book's copy was the
 * only one that remembered an entry can expire, so a supplement with an end
 * date stayed in force forever.
 */
export function isInForceOn(entry, date) {
  const day = typeof date === 'string' ? parseCivilDate(date) : date;
  if (compareDates(entry.from, day) > 0) {
    return false;
  }
  return entry.to === undefined || compareDates(entry.to, day) >= 0;
}

export function inForceOn(entries, date) {
  return entries.filter((entry) => isInForceOn(entry, date));
}

export function entryOn(series, date) {
  const day = typeof date === 'string' ? parseCivilDate(date) : date;
  let found;
  for (const entry of series) {
    if (compareDates(entry.from, day) > 0) {
      break;
    }
    if (isInForceOn(entry, day)) {
      found = entry;
    }
  }
  return found;
}

export function valueOn(series, date, fallback) {
  const entry = entryOn(series, date);
  return entry === undefined ? fallback : entry.value;
}

export function isCoveredOn(series, date) {
  return entryOn(series, date) !== undefined;
}

export function effectiveDates(series) {
  return series.map((entry) => formatCivilDate(entry.from));
}

/** The day a page stops being the one in force, or undefined if it never does. */
export function supersededOn(series, index) {
  const entry = series[index];
  const next = series[index + 1];
  if (entry === undefined) {
    return undefined;
  }
  if (next === undefined) {
    return entry.to === undefined ? undefined : formatCivilDate(entry.to);
  }
  return formatCivilDate(next.from);
}
