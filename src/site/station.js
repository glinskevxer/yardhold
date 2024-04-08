import { ValidationError } from '../core/errors.js';
import { requireArray, requireInteger, requireString } from '../core/guards.js';

/**
 * A station is the billing point. The SPLC is the six digit code the carrier
 * puts on the waybill, and it is the key everything else joins on, because the
 * station name is written a dozen ways across the feeds.
 */

const SPLC_PATTERN = /^\d{6}$/;

export function station({
  splc,
  name,
  carrier,
  offsetMinutes = -360,
  calendarId,
  switchingLimits = [],
} = {}) {
  requireString(splc, 'splc');
  if (!SPLC_PATTERN.test(splc)) {
    throw new ValidationError('an SPLC is six digits', { splc });
  }
  requireString(name, 'name');
  requireString(carrier, 'carrier');
  requireInteger(offsetMinutes, 'offsetMinutes', { min: -840, max: 840 });
  requireArray(switchingLimits, 'switchingLimits');
  return Object.freeze({
    splc,
    name: name.trim().toUpperCase(),
    carrier: carrier.trim().toUpperCase(),
    offsetMinutes,
    calendarId:
      calendarId === undefined ? `${carrier}-${splc}` : requireString(calendarId, 'calendarId'),
    switchingLimits: Object.freeze(
      [...switchingLimits].map((limit) => requireString(limit, 'limit'))
    ),
  });
}

export function isWithinSwitchingLimits(record, place) {
  if (record.switchingLimits.length === 0) {
    return true;
  }
  const wanted = requireString(place, 'place').trim().toUpperCase();
  return record.switchingLimits.some((limit) => limit.trim().toUpperCase() === wanted);
}

export function stationBook(stations = []) {
  const bySplc = new Map();
  for (const record of stations) {
    const built = record.splc && record.offsetMinutes !== undefined ? record : station(record);
    if (bySplc.has(built.splc)) {
      throw new ValidationError('that SPLC is already in the book', { splc: built.splc });
    }
    bySplc.set(built.splc, built);
  }
  return {
    get size() {
      return bySplc.size;
    },
    has(splc) {
      return bySplc.has(splc);
    },
    find(splc) {
      return bySplc.get(splc);
    },
    all() {
      return [...bySplc.values()].sort((a, b) => (a.splc < b.splc ? -1 : 1));
    },
    ofCarrier(carrier) {
      const wanted = requireString(carrier, 'carrier').toUpperCase();
      return [...bySplc.values()].filter((record) => record.carrier === wanted);
    },
    byName(name) {
      const wanted = requireString(name, 'name').trim().toUpperCase();
      return [...bySplc.values()].filter((record) => record.name === wanted);
    },
  };
}
