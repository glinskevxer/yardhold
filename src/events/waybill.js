import { ValidationError } from '../core/errors.js';
import {
  optional,
  requireArray,
  requireInteger,
  requireOneOf,
  requireString,
} from '../core/guards.js';
import { formatCivilDate, parseCivilDate } from '../time/civil.js';
import { normalizeCarId } from '../equipment/reportingMarks.js';
import { stcc } from '../tariff/commodity.js';

/**
 * The waybill.
 *
 * It matters here for one reason: it names the commodity, and the commodity is
 * what the free time table keys on. A car with no waybill therefore falls to
 * the bare service line of the tariff, which is nearly always the shortest
 * allowance in the book, so a missing waybill is expensive rather than merely
 * untidy.
 */

export const MOVEMENT = Object.freeze({
  INBOUND_LOADED: 'inbound-loaded',
  OUTBOUND_LOADED: 'outbound-loaded',
  INBOUND_EMPTY: 'inbound-empty',
  OUTBOUND_EMPTY: 'outbound-empty',
});

const MOVEMENTS = Object.values(MOVEMENT);

export function waybill({
  number,
  carId,
  movement,
  billedOn,
  commodityCode,
  netWeightPounds,
  originSplc,
  destinationSplc,
  shipperId,
  consigneeId,
  route = [],
  hazmatPlacard,
} = {}) {
  requireString(number, 'number');
  const car = normalizeCarId(requireString(carId, 'carId'));
  requireOneOf(movement, MOVEMENTS, 'movement');
  const billed = parseCivilDate(requireString(billedOn, 'billedOn'));
  requireArray(route, 'route');
  const loaded = movement === MOVEMENT.INBOUND_LOADED || movement === MOVEMENT.OUTBOUND_LOADED;
  if (loaded && commodityCode === undefined) {
    throw new ValidationError('a loaded waybill has to name a commodity', { number });
  }
  if (!loaded && commodityCode !== undefined) {
    throw new ValidationError('an empty waybill cannot carry a commodity', { number });
  }
  const weight = optional(netWeightPounds, (value) =>
    requireInteger(value, 'netWeightPounds', { min: 1, max: 400000 })
  );
  if (loaded && weight === undefined) {
    throw new ValidationError('a loaded waybill has to carry a weight', { number });
  }
  return Object.freeze({
    number,
    carId: car,
    movement,
    loaded,
    billedOn: formatCivilDate(billed),
    commodityCode: commodityCode === undefined ? undefined : stcc(commodityCode),
    netWeightPounds: weight,
    originSplc: optional(originSplc, (value) => requireString(value, 'originSplc')),
    destinationSplc: optional(destinationSplc, (value) => requireString(value, 'destinationSplc')),
    shipperId: optional(shipperId, (value) => requireString(value, 'shipperId').toUpperCase()),
    consigneeId: optional(consigneeId, (value) =>
      requireString(value, 'consigneeId').toUpperCase()
    ),
    route: Object.freeze(route.map((leg) => requireString(leg, 'route').toUpperCase())),
    hazmatPlacard: optional(hazmatPlacard, (value) => requireString(value, 'hazmatPlacard')),
  });
}

export function isInbound(record) {
  return record.movement === MOVEMENT.INBOUND_LOADED || record.movement === MOVEMENT.INBOUND_EMPTY;
}

export function serviceFor(record) {
  return isInbound(record) ? 'unloading' : 'loading';
}

export function waybillBook(records = []) {
  const byCar = new Map();
  for (const entry of requireArray(records, 'records')) {
    const built = Object.isFrozen(entry) && entry.loaded !== undefined ? entry : waybill(entry);
    const list = byCar.get(built.carId);
    if (list) {
      list.push(built);
    } else {
      byCar.set(built.carId, [built]);
    }
  }
  for (const list of byCar.values()) {
    list.sort((a, b) => (a.billedOn < b.billedOn ? -1 : a.billedOn > b.billedOn ? 1 : 0));
  }
  return {
    get size() {
      return [...byCar.values()].reduce((sum, list) => sum + list.length, 0);
    },
    forCar(carId) {
      return [...(byCar.get(normalizeCarId(carId)) ?? [])];
    },
    /** The waybill in force on a day is the latest one billed on or before it. */
    onDate(carId, date) {
      const day = typeof date === 'string' ? date : formatCivilDate(date);
      const list = byCar.get(normalizeCarId(carId)) ?? [];
      let found;
      for (const entry of list) {
        if (entry.billedOn > day) {
          break;
        }
        found = entry;
      }
      return found;
    },
    cars() {
      return [...byCar.keys()].sort();
    },
  };
}

export function commodityClassFor(book, commodities, carId, date) {
  const record = book.onDate(carId, date);
  if (record === undefined || record.commodityCode === undefined) {
    return undefined;
  }
  return commodities.classOf(record.commodityCode);
}
