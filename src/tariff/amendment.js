import { ConflictError, ValidationError } from '../core/errors.js';
import { optional, requireArray, requireOneOf, requireString } from '../core/guards.js';
import { compareDates, formatCivilDate, parseCivilDate } from '../time/civil.js';
import { inForceOn } from './effectivity.js';
import { freeTimeTable } from './freeTimeTable.js';
import { rateLadder } from './rateLadder.js';
import { tariff } from './tariff.js';

/**
 * Supplements.
 *
 * A carrier does not reissue a tariff page to change one rate, it files a
 * supplement, and the page in force on a day is the original with every
 * supplement up to that day laid over it in order. This matters more than it
 * sounds: supplement 3 raising a rate and supplement 5 lowering it back leaves
 * the page where it started, and an office that applies only the latest
 * supplement gets that wrong in both directions.
 */

export const AMENDS = Object.freeze({
  LADDER: 'ladder',
  FREE_TIME: 'free-time',
  SETTINGS: 'settings',
});

const KINDS = Object.values(AMENDS);

export function supplement({
  number,
  pageId,
  effectiveFrom,
  effectiveTo,
  amends,
  ladder,
  freeTime,
  settings,
  note,
} = {}) {
  requireString(number, 'number');
  requireString(pageId, 'pageId');
  requireOneOf(amends, KINDS, 'amends');
  const from = parseCivilDate(requireString(effectiveFrom, 'effectiveFrom'));
  const to = effectiveTo === undefined ? undefined : parseCivilDate(effectiveTo);
  if (to !== undefined && compareDates(from, to) > 0) {
    throw new ValidationError('a supplement cannot be cancelled before it takes effect', {
      number,
    });
  }
  if (amends === AMENDS.LADDER && ladder === undefined) {
    throw new ValidationError('a ladder supplement has to carry a ladder', { number });
  }
  if (amends === AMENDS.FREE_TIME && freeTime === undefined) {
    throw new ValidationError('a free time supplement has to carry a table', { number });
  }
  if (amends === AMENDS.SETTINGS && settings === undefined) {
    throw new ValidationError('a settings supplement has to carry settings', { number });
  }
  return Object.freeze({
    number,
    pageId,
    amends,
    effectiveFrom: formatCivilDate(from),
    from,
    to,
    effectiveTo: to === undefined ? undefined : formatCivilDate(to),
    ladder: optional(ladder, (value) => (Array.isArray(value) ? rateLadder(value) : value)),
    freeTime: optional(freeTime, (value) => (Array.isArray(value) ? freeTimeTable(value) : value)),
    settings: optional(settings, (value) => value),
    note: optional(note, (value) => requireString(value, 'note')),
  });
}

export function supplementSeries(supplements = []) {
  const built = requireArray(supplements, 'supplements').map((entry) =>
    Object.isFrozen(entry) && entry.amends ? entry : supplement(entry)
  );
  const seen = new Set();
  for (const entry of built) {
    const key = `${entry.pageId}|${entry.number}`;
    if (seen.has(key)) {
      throw new ConflictError('that supplement number is filed twice', { key });
    }
    seen.add(key);
  }
  return Object.freeze(
    [...built].sort((a, b) => compareDates(a.from, b.from) || (a.number < b.number ? -1 : 1))
  );
}

/**
 * Supplements can carry an end date, and the hand-rolled filter here only ever
 * looked at the start, so one that had been cancelled stayed laid over the page
 * for good. The shared test reads both ends.
 */
export function supplementsInForce(series, pageId, date) {
  return inForceOn(
    series.filter((entry) => entry.pageId === pageId),
    date
  );
}

/** Lay every supplement in force over the page, oldest first. */
export function pageAsAmended(page, series, date) {
  const applied = supplementsInForce(series, page.id, date);
  if (applied.length === 0) {
    return { page, applied: [] };
  }
  let ladder = page.ladder;
  let freeTime = page.freeTime;
  let settings = {};
  for (const entry of applied) {
    if (entry.amends === AMENDS.LADDER) {
      ladder = entry.ladder;
    }
    if (entry.amends === AMENDS.FREE_TIME) {
      freeTime = entry.freeTime;
    }
    if (entry.amends === AMENDS.SETTINGS) {
      settings = { ...settings, ...entry.settings };
    }
  }
  const amended = tariff({
    id: page.id,
    carrier: page.carrier,
    title: page.title,
    countBasis: page.countBasis,
    excludeDayKind: page.excludeDayKind,
    holidayRules: [...page.holidayRules],
    observesHolidays: page.observesHolidays,
    creditsWeekends: page.creditsWeekends,
    notificationRequired: page.notificationRequired,
    noticeGraceMinutes: page.noticeGraceMinutes,
    bunchingRelief: page.bunchingRelief,
    bunchingCapDays: page.bunchingCapDays,
    minimumCharge: String(page.minimumCharge / 100),
    storageLadder: page.storageLadder,
    storageFreeDays: page.storageFreeDays,
    averageAgreementAllowed: page.averageAgreementAllowed,
    ...settings,
    ladder,
    freeTime,
  });
  return { page: amended, applied: applied.map((entry) => entry.number) };
}

export function supplementNumbers(series, pageId) {
  return series.filter((entry) => entry.pageId === pageId).map((entry) => entry.number);
}
