import { ValidationError } from '../core/errors.js';
import {
  optional,
  requireArray,
  requireInteger,
  requireOneOf,
  requireString,
} from '../core/guards.js';
import { scale } from '../core/money.js';
import { dateRange, rangeContains } from '../time/civil.js';

/**
 * Contract terms sitting over a tariff page.
 *
 * A commitment is a promise about volume, and the discount it buys is only
 * earned if the volume arrived. That makes the whole month's shipping decide
 * what each individual car cost, which is uncomfortable but is what the paper
 * says: a plant that promised two hundred cars and shipped a hundred and ninety
 * pays the undiscounted rate on all hundred and ninety, not on the last ten.
 */

export const RELIEF_STYLE = Object.freeze({
  ALL_CARS: 'all-cars',
  EXCESS_ONLY: 'excess-only',
});

const STYLES = Object.values(RELIEF_STYLE);

export function contract({
  id,
  consigneeId,
  from,
  to,
  minimumCars = 0,
  discountBasisPoints = 0,
  style = RELIEF_STYLE.ALL_CARS,
  freeDayBonus = 0,
  pageIds = [],
} = {}) {
  requireString(id, 'id');
  requireString(consigneeId, 'consigneeId');
  requireOneOf(style, STYLES, 'style');
  requireInteger(minimumCars, 'minimumCars', { min: 0, max: 100000 });
  requireInteger(discountBasisPoints, 'discountBasisPoints', { min: 0, max: 10000 });
  requireInteger(freeDayBonus, 'freeDayBonus', { min: 0, max: 30 });
  requireArray(pageIds, 'pageIds');
  const term = dateRange(requireString(from, 'from'), requireString(to, 'to'));
  if (minimumCars === 0 && discountBasisPoints > 0) {
    throw new ValidationError('a discount with no commitment behind it is just a rate', { id });
  }
  return Object.freeze({
    id,
    consigneeId: consigneeId.trim().toUpperCase(),
    term,
    minimumCars,
    discountBasisPoints,
    style,
    freeDayBonus,
    pageIds: Object.freeze([...pageIds]),
  });
}

export function coversPage(record, pageId) {
  return record.pageIds.length === 0 || record.pageIds.includes(pageId);
}

export function coversDay(record, date) {
  return rangeContains(record.term, date);
}

export function isEarned(record, carsShipped) {
  requireInteger(carsShipped, 'carsShipped', { min: 0 });
  return carsShipped >= record.minimumCars;
}

export function shortfall(record, carsShipped) {
  return Math.max(0, record.minimumCars - carsShipped);
}

/** What the whole month's volume did to one car's charge. */
export function applyDiscount(record, amount, { carsShipped, carIndex = 1 } = {}) {
  if (!isEarned(record, carsShipped)) {
    return { amount, discount: 0, earned: false };
  }
  if (record.style === RELIEF_STYLE.EXCESS_ONLY && carIndex <= record.minimumCars) {
    return { amount, discount: 0, earned: true };
  }
  const discount = scale(amount, record.discountBasisPoints, 10000);
  return { amount: amount - discount, discount, earned: true };
}

export function bonusFreeDays(record, carsShipped) {
  return isEarned(record, carsShipped) ? record.freeDayBonus : 0;
}

export function selectContract(contracts, { consigneeId, pageId, on }) {
  const wanted = requireString(consigneeId, 'consigneeId').trim().toUpperCase();
  return contracts.find(
    (record) => record.consigneeId === wanted && coversDay(record, on) && coversPage(record, pageId)
  );
}

export function optionalContractId(value) {
  return optional(value, (id) => requireString(id, 'contractId'));
}
