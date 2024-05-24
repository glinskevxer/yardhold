import { ValidationError } from '../core/errors.js';
import { requireArray, requireInteger, requireOneOf, requireString } from '../core/guards.js';

/**
 * The free time table.
 *
 * An allowance is a number of days, but the days it counts are not the same
 * everywhere. A table entry says which:
 *
 *   running    every day counts, weekend and holiday alike
 *   service    only days the carrier worked the track count
 *
 * That flag is the reason the same forty eight hours can be one free day or
 * three. It is a property of the entry, so the commodity can change what the
 * calendar means for the very same car.
 */

export const SERVICE = Object.freeze({
  LOADING: 'loading',
  UNLOADING: 'unloading',
  HELD: 'held',
});

const SERVICES = Object.values(SERVICE);

export const DAY_KIND = Object.freeze({
  RUNNING: 'running',
  SERVICE: 'service',
});

const DAY_KINDS = Object.values(DAY_KIND);

export function freeTimeEntry({
  service,
  days,
  dayKind = DAY_KIND.RUNNING,
  carKind,
  commodityClass,
  note,
} = {}) {
  requireOneOf(service, SERVICES, 'service');
  requireInteger(days, 'days', { min: 0, max: 60 });
  requireOneOf(dayKind, DAY_KINDS, 'dayKind');
  return Object.freeze({
    service,
    days,
    dayKind,
    carKind: carKind === undefined ? undefined : requireString(carKind, 'carKind'),
    commodityClass:
      commodityClass === undefined ? undefined : requireString(commodityClass, 'commodityClass'),
    note,
    specificity: (carKind === undefined ? 0 : 2) + (commodityClass === undefined ? 0 : 1),
  });
}

export function freeTimeTable(entries = []) {
  const built = requireArray(entries, 'entries').map((entry) =>
    entry.specificity === undefined ? freeTimeEntry(entry) : entry
  );
  const seen = new Set();
  for (const entry of built) {
    const key = `${entry.service}|${entry.carKind ?? ''}|${entry.commodityClass ?? ''}`;
    if (seen.has(key)) {
      throw new ValidationError('the table lists the same combination twice', { key });
    }
    seen.add(key);
  }
  return Object.freeze([...built].sort((a, b) => b.specificity - a.specificity));
}

/**
 * The most specific entry wins: car kind and commodity beat car kind, which
 * beats commodity, which beats the bare service line.
 */
export function lookupFreeTime(table, { service, carKind, commodityClass } = {}) {
  requireOneOf(service, SERVICES, 'service');
  return table.find(
    (entry) =>
      entry.service === service &&
      (entry.carKind === undefined || entry.carKind === carKind) &&
      (entry.commodityClass === undefined || entry.commodityClass === commodityClass)
  );
}

export function freeDays(table, query, fallback = 0) {
  const entry = lookupFreeTime(table, query);
  return entry === undefined ? fallback : entry.days;
}

export function freeTimeDayKind(table, query, fallback = DAY_KIND.RUNNING) {
  const entry = lookupFreeTime(table, query);
  return entry === undefined ? fallback : entry.dayKind;
}

export function countsServiceDaysOnly(table, query) {
  return freeTimeDayKind(table, query) === DAY_KIND.SERVICE;
}

export function describeFreeTime(entry) {
  const scope = [entry.carKind, entry.commodityClass].filter(Boolean).join(' ');
  const tail = scope === '' ? '' : ` for ${scope}`;
  return `${entry.days} ${entry.dayKind} days ${entry.service}${tail}`;
}
