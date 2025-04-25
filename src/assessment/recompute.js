import { requireObject } from '../core/guards.js';
import { filterSubstitutions } from '../disputes/adjudicate.js';
import { adjudicate } from '../disputes/adjudicate.js';
import { assessCar } from './assess.js';

/**
 * Recomputing an assessment for a claim.
 *
 * The claim's ground says which inputs may move, and this is where that rule
 * stops being an opinion: the substitutions are filtered before anything is
 * recomputed, so an input the ground did not open cannot reach the engine at
 * all. Passing the whole claim in and letting the engine be careful would work
 * exactly until somebody added an argument and forgot.
 */

export function recomputeCar(original, substitutions = {}) {
  requireObject(original, 'original');
  return assessCar({
    carId: original.carId,
    events: substitutions.events ?? original.events,
    page: substitutions.page ?? original.page,
    calendar: substitutions.calendar ?? original.calendar,
    trackBook: original.trackBook,
    exclusions: substitutions.exclusions ?? original.exclusions,
    query: substitutions.query ?? original.query,
    until: original.until,
    startIndex: original.startIndex ?? 1,
  });
}

export function recomputeForClaim(record, original, substitutions = {}) {
  const { allowed, refused } = filterSubstitutions(record.ground, substitutions);
  const revised = recomputeCar(original, allowed);
  const decision = adjudicate(record, {
    originalTotal: original.total,
    revisedTotal: revised.total,
  });
  return {
    ...decision,
    revised,
    appliedInputs: Object.keys(allowed).sort(),
    refusedInputs: refused.sort(),
  };
}

export function differenceByDay(before, after) {
  const beforeDays = new Map(before.lines.map((line) => [line.date, line.rate]));
  const afterDays = new Map(after.lines.map((line) => [line.date, line.rate]));
  const dates = [...new Set([...beforeDays.keys(), ...afterDays.keys()])].sort();
  return dates
    .map((date) => ({
      date,
      before: beforeDays.get(date) ?? 0,
      after: afterDays.get(date) ?? 0,
    }))
    .filter((row) => row.before !== row.after)
    .map((row) => ({ ...row, difference: row.after - row.before }));
}

export function daysRemoved(before, after) {
  return differenceByDay(before, after)
    .filter((row) => row.after === 0)
    .map((row) => row.date);
}

export function daysAdded(before, after) {
  return differenceByDay(before, after)
    .filter((row) => row.before === 0)
    .map((row) => row.date);
}

export function summariseRecompute(before, after) {
  return {
    daysBefore: before.chargeableDays,
    daysAfter: after.chargeableDays,
    removed: daysRemoved(before, after),
    added: daysAdded(before, after),
    difference: after.total - before.total,
  };
}
