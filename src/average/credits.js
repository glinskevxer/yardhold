import { requireObject } from '../core/guards.js';
import { CREDIT_BASIS, coversCar } from './agreement.js';

/**
 * Turning an assessment into credits and debits.
 *
 * A debit is a chargeable day, and there is no argument about that. A credit is
 * whatever the agreement says it is, and the two bases disagree about the same
 * car often enough that a plant will run both and pick. Relief that was granted
 * rather than earned is the sharp edge: a car that only turned round in time
 * because the tariff gave it three bunching days did not earn anything, and an
 * agreement that says so has to be able to see which days those were.
 */

export function carCredit(assessment, agreement, { car, extraFreeDays = 0 } = {}) {
  requireObject(agreement, 'agreement');
  if (!coversCar(agreement, car)) {
    return { carId: assessment.carId, credits: 0, debits: 0, covered: false };
  }
  const debits = assessment.chargeableDays;
  if (debits > 0) {
    return { carId: assessment.carId, credits: 0, debits, covered: true };
  }
  const granted = agreement.countsBunchingRelief ? 0 : extraFreeDays;
  if (agreement.creditBasis === CREDIT_BASIS.CAR) {
    return {
      carId: assessment.carId,
      credits: 1,
      debits: 0,
      covered: true,
    };
  }
  const unused = assessment.counts.reduce(
    (sum, count) => sum + Math.max(0, count.allowance - count.freeUsed),
    0
  );
  const earned = Math.max(0, unused - granted);
  return {
    carId: assessment.carId,
    credits: Math.min(earned, agreement.creditCapPerCar),
    debits: 0,
    covered: true,
  };
}

export function creditLedger(
  assessments,
  agreement,
  { cars = new Map(), extraFreeDays = new Map() } = {}
) {
  return assessments.map((assessment) =>
    carCredit(assessment, agreement, {
      car: cars.get(assessment.carId),
      extraFreeDays: extraFreeDays.get(assessment.carId) ?? 0,
    })
  );
}

export function totalCredits(ledger) {
  return ledger.reduce((sum, entry) => sum + entry.credits, 0);
}

export function totalDebits(ledger) {
  return ledger.reduce((sum, entry) => sum + entry.debits, 0);
}

export function coveredCars(ledger) {
  return ledger.filter((entry) => entry.covered).map((entry) => entry.carId);
}

export function excludedCars(ledger) {
  return ledger.filter((entry) => !entry.covered).map((entry) => entry.carId);
}
