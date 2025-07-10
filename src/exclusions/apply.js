import { requireObject } from '../core/guards.js';
import { dayUnits } from '../time/dayCount.js';
import { durationMinutes, intersect, mergePeriods, subtract } from '../time/period.js';
import { chargeableUnitOptions, countsInWholeDays } from '../tariff/tariff.js';
import { eligibleExclusions } from './eligibility.js';
import { DEFAULT_OFFSET_MINUTES } from '../time/instant.js';

/**
 * Taking the relief off a detention.
 *
 * The page decides how, and the two ways do not agree. Removing whole days
 * throws away a nine hour storm because it did not cover a day; removing
 * minutes credits the same storm and can leave two half days that add up to a
 * chargeable one. Neither is more correct, and which one the page uses has to
 * be read rather than assumed.
 */

export function relieveByMinutes(span, windows) {
  const merged = mergePeriods(windows);
  const pieces = subtract(span, merged);
  const removed = merged
    .map((window) => intersect(window, span))
    .filter(Boolean)
    .reduce((sum, piece) => sum + durationMinutes(piece), 0);
  return { pieces, removedMinutes: removed, droppedUnits: [] };
}

export function relieveByWholeDays(span, windows, options) {
  const merged = mergePeriods(windows);
  const units = dayUnits(span, options);
  const dropped = units.filter((unit) =>
    merged.some((window) => window.start <= unit.span.start && window.end >= unit.span.end)
  );
  const kept = units.filter((unit) => !dropped.includes(unit));
  return {
    pieces: kept.map((unit) => unit.span),
    removedMinutes: dropped.reduce((sum, unit) => sum + unit.minutes, 0),
    droppedUnits: dropped.map((unit) => unit.label),
  };
}

export function relieveSpan(
  span,
  exclusions,
  { page, offsetMinutes = DEFAULT_OFFSET_MINUTES, placement, carId } = {}
) {
  requireObject(page, 'page');
  const eligible = eligibleExclusions(exclusions, { placement, page, carId });
  const windows = eligible.map((record) => record.span);
  const options = { ...chargeableUnitOptions(page), offsetMinutes };
  const result = countsInWholeDays(page)
    ? relieveByWholeDays(span, windows, options)
    : relieveByMinutes(span, windows);
  return {
    ...result,
    applied: eligible,
    declined: exclusions.filter((record) => !eligible.includes(record)),
  };
}

export function reliefSummary(result) {
  const byKind = new Map();
  for (const record of result.applied) {
    byKind.set(record.kind, (byKind.get(record.kind) ?? 0) + 1);
  }
  return {
    appliedCount: result.applied.length,
    declinedCount: result.declined.length,
    removedMinutes: result.removedMinutes,
    droppedDays: result.droppedUnits.length,
    byKind: Object.fromEntries([...byKind.entries()].sort(([a], [b]) => (a < b ? -1 : 1))),
  };
}
