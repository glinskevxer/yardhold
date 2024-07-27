import { ValidationError } from '../core/errors.js';
import { optional, requireInteger, requireOneOf, requireString } from '../core/guards.js';
import { dateRange, rangeContains } from '../time/civil.js';

/**
 * An average agreement.
 *
 * Under one of these the consignee stops being billed car by car and is billed
 * on the month: cars turned around inside their free time earn credits, cars
 * held over earn debits, and only the balance is invoiced.
 *
 * What counts as a credit is the agreement's own business, and the two bases
 * do not measure the same thing at all:
 *
 *   free-day   every unused free day on every car, so a car released a day
 *              early on a two day allowance earns one
 *   car        one credit per car released inside its free time, however much
 *              of the allowance was left
 *
 * A plant with long allowances and quick turnarounds is far better off on the
 * first; a plant that empties everything the same afternoon is better off on
 * the second. The basis therefore decides what the reconciliation is counting,
 * which is why it is on the agreement and not in the code.
 */

export const CREDIT_BASIS = Object.freeze({
  FREE_DAY: 'free-day',
  CAR: 'car',
});

const BASES = Object.values(CREDIT_BASIS);

export function averageAgreement({
  id,
  consigneeId,
  splc,
  from,
  to,
  creditBasis = CREDIT_BASIS.FREE_DAY,
  offsetRatio = 1,
  creditCapPerCar = 5,
  carryOver = false,
  coversPrivateCars = false,
  countsBunchingRelief = false,
} = {}) {
  requireString(id, 'id');
  requireString(consigneeId, 'consigneeId');
  requireOneOf(creditBasis, BASES, 'creditBasis');
  requireInteger(offsetRatio, 'offsetRatio', { min: 1, max: 10 });
  requireInteger(creditCapPerCar, 'creditCapPerCar', { min: 1, max: 60 });
  const term = dateRange(requireString(from, 'from'), requireString(to, 'to'));
  if (creditBasis === CREDIT_BASIS.CAR && creditCapPerCar !== 1) {
    throw new ValidationError('an agreement counting whole cars caps a car at one credit', { id });
  }
  return Object.freeze({
    id,
    consigneeId: consigneeId.trim().toUpperCase(),
    splc: optional(splc, (value) => requireString(value, 'splc')),
    term,
    creditBasis,
    offsetRatio,
    creditCapPerCar,
    carryOver: carryOver === true,
    coversPrivateCars: coversPrivateCars === true,
    countsBunchingRelief: countsBunchingRelief === true,
  });
}

export function coversDay(agreement, date) {
  return rangeContains(agreement.term, date);
}

export function coversStation(agreement, splc) {
  return agreement.splc === undefined || agreement.splc === splc;
}

export function coversCar(agreement, car) {
  if (car === undefined) {
    return true;
  }
  return agreement.coversPrivateCars || car.ownership !== 'private';
}

export function creditsPerFreeDay(agreement) {
  return agreement.creditBasis === CREDIT_BASIS.FREE_DAY;
}

export function debitsCoveredBy(agreement, credits) {
  return Math.floor(credits / agreement.offsetRatio);
}

export function creditsNeededFor(agreement, debits) {
  return debits * agreement.offsetRatio;
}

export function describeAgreement(agreement) {
  return `${agreement.id} ${agreement.consigneeId} on ${agreement.creditBasis} at ${agreement.offsetRatio} to 1`;
}
