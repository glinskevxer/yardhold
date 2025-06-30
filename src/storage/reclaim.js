import { ValidationError } from '../core/errors.js';
import { requireArray, requireOneOf, requireString } from '../core/guards.js';
import { add, scale } from '../core/money.js';
import { EXCLUSION } from '../exclusions/exclusion.js';

/**
 * Reclaiming car hire.
 *
 * The serving carrier pays hire on a foreign car for every hour it holds it,
 * including the hours it was standing at a plant that would not unload. Those
 * hours can be reclaimed from the consignee, but only the ones the consignee
 * actually caused, and the test for that is exactly the relief test run
 * backwards: an hour that would have been relieved is an hour the carrier
 * cannot reclaim.
 *
 * So the same weather bulletin that reduces the demurrage also reduces what can
 * be reclaimed alongside it, and a system that applies one without the other
 * bills the consignee twice for the same storm.
 */

export const RECLAIM_BASIS = Object.freeze({
  CHARGEABLE_HOURS: 'chargeable-hours',
  ALL_HELD_HOURS: 'all-held-hours',
});

const BASES = Object.values(RECLAIM_BASIS);

/** Relief the carrier caused itself is never reclaimable from anybody else. */
const CARRIER_CAUSED = new Set([EXCLUSION.CARRIER_DELAY, EXCLUSION.BAD_ORDER, EXCLUSION.EMBARGO]);

export function reclaimTerms({
  basis = RECLAIM_BASIS.CHARGEABLE_HOURS,
  sharePercent = 100,
  cap,
  appliesToPrivateCars = false,
} = {}) {
  requireOneOf(basis, BASES, 'basis');
  if (!Number.isInteger(sharePercent) || sharePercent < 0 || sharePercent > 100) {
    throw new ValidationError('a reclaim share is a whole percentage', { sharePercent });
  }
  if (cap !== undefined && (!Number.isInteger(cap) || cap < 0)) {
    throw new ValidationError('a reclaim cap is a whole cent amount', { cap });
  }
  return Object.freeze({
    basis,
    sharePercent,
    cap,
    appliesToPrivateCars: appliesToPrivateCars === true,
  });
}

export function reliefIsCarrierCaused(record) {
  return CARRIER_CAUSED.has(record.kind);
}

export function reclaimableHours(terms, { heldHours, chargeableHours, reliefHours = 0 }) {
  if (terms.basis === RECLAIM_BASIS.ALL_HELD_HOURS) {
    return Math.max(0, heldHours - reliefHours);
  }
  return Math.max(0, Math.min(chargeableHours, heldHours - reliefHours));
}

export function carrierCausedHours(exclusions) {
  return requireArray(exclusions, 'exclusions')
    .filter(reliefIsCarrierCaused)
    .reduce((sum, record) => sum + Math.ceil((record.span.end - record.span.start) / 60), 0);
}

export function reclaim(
  terms,
  { carId, hireCharge, heldHours, chargeableHours, exclusions = [], car } = {}
) {
  requireString(carId, 'carId');
  if (car !== undefined && car.ownership === 'private' && !terms.appliesToPrivateCars) {
    return { carId, hours: 0, amount: 0, reclaimable: false, why: 'the car is not on hire' };
  }
  const reliefHours = carrierCausedHours(exclusions);
  const hours = reclaimableHours(terms, { heldHours, chargeableHours, reliefHours });
  if (hours === 0) {
    return { carId, hours: 0, amount: 0, reclaimable: false, why: 'no reclaimable hours' };
  }
  const share = scale(hireCharge.total, hours * terms.sharePercent, Math.max(1, heldHours) * 100);
  const amount = terms.cap === undefined ? share : Math.min(share, terms.cap);
  return {
    carId,
    hours,
    reliefHours,
    amount,
    reclaimable: true,
    cappedAt: terms.cap !== undefined && share > terms.cap ? terms.cap : undefined,
  };
}

export function reclaimAll(terms, entries) {
  const lines = requireArray(entries, 'entries').map((entry) => reclaim(terms, entry));
  return { lines, total: add(...lines.map((line) => line.amount)) };
}

export function reclaimedShare(result, hireTotal) {
  return hireTotal === 0 ? 0 : Math.round((result.total / hireTotal) * 1000) / 1000;
}
