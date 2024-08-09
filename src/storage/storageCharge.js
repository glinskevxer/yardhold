import { requireObject, requireOneOf } from '../core/guards.js';
import { add } from '../core/money.js';
import { rateForDay } from '../tariff/rateLadder.js';
import { dayUnits } from '../time/dayCount.js';
import { chargeableUnitOptions } from '../tariff/tariff.js';

/**
 * Storage on a private car.
 *
 * A private car is the owner's problem, so the carrier does not charge
 * demurrage on it. What it does charge for is the track the car is standing on,
 * and the two are not the same charge: storage has its own ladder, its own free
 * time, and it runs whether or not the consignee was ever notified.
 *
 * The load state decides the free time. An empty private car sitting on carrier
 * track is a nuisance and gets almost none; a loaded one waiting to be placed
 * gets the same courtesy a railroad car would.
 */

export const LOAD_STATE = Object.freeze({
  LOADED: 'loaded',
  EMPTY: 'empty',
});

const STATES = Object.values(LOAD_STATE);

export const DEFAULT_FREE_DAYS = Object.freeze({
  [LOAD_STATE.LOADED]: 2,
  [LOAD_STATE.EMPTY]: 0,
});

export function storageFreeDays(page, loadState) {
  requireOneOf(loadState, STATES, 'loadState');
  const table = page.storageFreeDays ?? DEFAULT_FREE_DAYS;
  return table[loadState] ?? 0;
}

export function assessStorage({
  carId,
  span,
  page,
  loadState = LOAD_STATE.LOADED,
  calendar,
  startIndex = 1,
} = {}) {
  requireObject(page, 'page');
  requireOneOf(loadState, STATES, 'loadState');
  const ladder = page.storageLadder ?? page.ladder;
  if (span === undefined) {
    return { carId, lines: [], chargeableDays: 0, freeDays: 0, total: 0, nextIndex: startIndex };
  }
  const offsetMinutes = calendar?.offsetMinutes ?? -360;
  const units = dayUnits(span, { ...chargeableUnitOptions(page), offsetMinutes });
  const allowance = storageFreeDays(page, loadState);
  const lines = [];
  let index = startIndex;
  let free = 0;
  for (const unit of units) {
    if (free < allowance) {
      free += 1;
      continue;
    }
    lines.push({
      carId,
      date: unit.label,
      dayIndex: index,
      rate: rateForDay(ladder, index),
      loadState,
    });
    index += 1;
  }
  return {
    carId,
    lines,
    chargeableDays: lines.length,
    freeDays: free,
    total: add(...lines.map((line) => line.rate)),
    nextIndex: index,
  };
}

export function storageTotal(result) {
  return result.total;
}

export function storageDates(result) {
  return result.lines.map((line) => line.date);
}

export function isEmptyStorage(result) {
  return result.lines.every((line) => line.loadState === LOAD_STATE.EMPTY);
}
