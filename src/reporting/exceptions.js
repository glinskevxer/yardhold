import { requireInteger, requireObject } from '../core/guards.js';
import { MINUTES_PER_DAY } from '../time/instant.js';
import { isStillStanding } from '../clock/detention.js';

/**
 * The exception report.
 *
 * Everything on here is a car the office should look at before the invoice
 * goes out, and the order matters: a car that was never notified is a bill that
 * will be lost, a car standing open for a fortnight is a bill nobody has seen
 * yet, and relief that was declined is a bill that will be argued.
 */

export const EXCEPTION = Object.freeze({
  NOT_ASSESSED: 'not-assessed',
  NEVER_NOTIFIED: 'never-notified',
  STILL_OPEN: 'still-open',
  RELIEF_DECLINED: 'relief-declined',
  LONG_STAND: 'long-stand',
  OPEN_SUSPENSION: 'open-suspension',
  NO_CHARGE: 'no-charge',
});

const SEVERITY = Object.freeze({
  [EXCEPTION.NOT_ASSESSED]: 1,
  [EXCEPTION.NEVER_NOTIFIED]: 2,
  [EXCEPTION.STILL_OPEN]: 3,
  [EXCEPTION.LONG_STAND]: 4,
  [EXCEPTION.OPEN_SUSPENSION]: 5,
  [EXCEPTION.RELIEF_DECLINED]: 6,
  [EXCEPTION.NO_CHARGE]: 7,
});

export function exceptionsFor(assessment, { longStandDays = 14 } = {}) {
  requireObject(assessment, 'assessment');
  requireInteger(longStandDays, 'longStandDays', { min: 1, max: 365 });
  const found = [];
  for (const detention of assessment.detentions) {
    if (detention.startsAt === undefined) {
      found.push({
        kind: EXCEPTION.NEVER_NOTIFIED,
        carId: assessment.carId,
        detail: 'placed but never notified, so the clock never started',
      });
    }
    if (isStillStanding(detention)) {
      found.push({
        kind: EXCEPTION.STILL_OPEN,
        carId: assessment.carId,
        detail: 'still standing at the cut off',
      });
    }
    if (
      detention.span !== undefined &&
      detention.span.end - detention.span.start > longStandDays * MINUTES_PER_DAY
    ) {
      found.push({
        kind: EXCEPTION.LONG_STAND,
        carId: assessment.carId,
        detail: `stood more than ${longStandDays} days`,
      });
    }
  }
  for (const open of assessment.unclosedSuspensions ?? []) {
    found.push({
      kind: EXCEPTION.OPEN_SUSPENSION,
      carId: assessment.carId,
      detail: `a ${open.code} was reported and never lifted`,
    });
  }
  const declined = assessment.counts.flatMap((count) => count.relief.declined);
  if (declined.length > 0) {
    found.push({
      kind: EXCEPTION.RELIEF_DECLINED,
      carId: assessment.carId,
      detail: `${declined.length} relief record(s) did not reach this car`,
    });
  }
  if (assessment.chargeableDays === 0 && assessment.detentions.length > 0) {
    found.push({
      kind: EXCEPTION.NO_CHARGE,
      carId: assessment.carId,
      detail: 'stood but nothing was chargeable',
    });
  }
  return found;
}

export function exceptionReport(result, options = {}) {
  const found = result.assessments.flatMap((assessment) => exceptionsFor(assessment, options));
  for (const entry of result.skipped) {
    found.push({ kind: EXCEPTION.NOT_ASSESSED, carId: entry.carId, detail: entry.why });
  }
  return found.sort(
    (a, b) =>
      (SEVERITY[a.kind] ?? 99) - (SEVERITY[b.kind] ?? 99) ||
      (a.carId < b.carId ? -1 : a.carId > b.carId ? 1 : 0)
  );
}

export function countByKind(found) {
  const counts = new Map();
  for (const entry of found) {
    counts.set(entry.kind, (counts.get(entry.kind) ?? 0) + 1);
  }
  return Object.fromEntries([...counts.entries()].sort(([a], [b]) => (a < b ? -1 : 1)));
}

export function carsWithExceptions(found) {
  return [...new Set(found.map((entry) => entry.carId))].sort();
}

export function exceptionRows(found) {
  return found.map((entry) => ({ kind: entry.kind, car: entry.carId, detail: entry.detail }));
}
