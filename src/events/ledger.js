import { requireArray, requireString } from '../core/guards.js';
import { normalizeCarId } from '../equipment/reportingMarks.js';
import { compareEvents, isCancelled, trackEvent } from './event.js';
import { eventCode } from './eventTypes.js';

/**
 * The ledger holds every event ever reported, including the ones that were
 * later cancelled or superseded. Nothing is thrown away, because an assessment
 * has to be reproducible from the ledger as it stood on the day it was cut.
 */

export function eventLedger(events = []) {
  const all = [];
  const byCar = new Map();

  function index(record) {
    all.push(record);
    const list = byCar.get(record.carId);
    if (list) {
      list.push(record);
    } else {
      byCar.set(record.carId, [record]);
    }
    return record;
  }

  const ledger = {
    add(event) {
      const record = event.id && event.at !== undefined ? event : trackEvent(event);
      return index(record);
    },
    addAll(list) {
      return requireArray(list, 'events').map((event) => ledger.add(event));
    },
    get size() {
      return all.length;
    },
    cars() {
      return [...byCar.keys()].sort();
    },
    raw() {
      return [...all];
    },
    all() {
      return [...all].sort(compareEvents);
    },
    forCar(carId, { includeCancelled = false } = {}) {
      const key = normalizeCarId(requireString(carId, 'carId'));
      const list = byCar.get(key) ?? [];
      const kept = includeCancelled ? list : list.filter((record) => !isCancelled(record));
      return [...kept].sort(compareEvents);
    },
    firstOf(carId, code) {
      const wanted = eventCode(code);
      return ledger.forCar(carId).find((record) => record.code === wanted);
    },
    latestOf(carId, code) {
      const wanted = eventCode(code);
      const matches = ledger.forCar(carId).filter((record) => record.code === wanted);
      return matches[matches.length - 1];
    },
    countOf(carId, code) {
      const wanted = eventCode(code);
      return ledger.forCar(carId).filter((record) => record.code === wanted).length;
    },
    between(from, to, { includeCancelled = false } = {}) {
      return ledger
        .all()
        .filter((record) => record.at >= from && record.at < to)
        .filter((record) => includeCancelled || !isCancelled(record));
    },
    cancel(eventIdentifier, reason) {
      const wanted = requireString(eventIdentifier, 'eventId');
      const found = all.find((record) => record.id === wanted && !isCancelled(record));
      if (!found) {
        return undefined;
      }
      const replacement = Object.freeze({
        ...found,
        cancelled: true,
        reason: requireString(reason, 'reason'),
      });
      all[all.indexOf(found)] = replacement;
      const list = byCar.get(found.carId);
      list[list.indexOf(found)] = replacement;
      return replacement;
    },
  };

  ledger.addAll(events);
  return ledger;
}

export function groupByCar(events) {
  const grouped = new Map();
  for (const record of [...events].sort(compareEvents)) {
    const list = grouped.get(record.carId);
    if (list) {
      list.push(record);
    } else {
      grouped.set(record.carId, [record]);
    }
  }
  return grouped;
}
