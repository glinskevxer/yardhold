import { requireArray } from '../core/guards.js';
import { add, scale } from '../core/money.js';

/**
 * The month at a glance.
 *
 * The number the plant manager wants is the share of cars that went over free
 * time, and it is worth being careful about the denominator: cars that never
 * started a clock at all are not in it, because a car that was never notified
 * did not fail to turn round, it was never handed over.
 */

export function assessmentKpis(assessments) {
  requireArray(assessments, 'assessments');
  const started = assessments.filter((assessment) =>
    assessment.detentions.some((detention) => detention.startsAt !== undefined)
  );
  const overFreeTime = started.filter((assessment) => assessment.chargeableDays > 0);
  const chargeableDays = assessments.reduce((sum, entry) => sum + entry.chargeableDays, 0);
  const freeDays = assessments.reduce(
    (sum, entry) => sum + entry.counts.reduce((inner, count) => inner + count.freeUsed, 0),
    0
  );
  const respots = assessments.reduce(
    (sum, entry) => sum + Math.max(0, entry.detentions.length - 1),
    0
  );
  return {
    cars: assessments.length,
    carsWithAClock: started.length,
    carsOverFreeTime: overFreeTime.length,
    overFreeTimeShare: started.length === 0 ? 0 : overFreeTime.length / started.length,
    chargeableDays,
    freeDays,
    respots,
    gross: add(...assessments.map((entry) => entry.gross)),
    averagePerCar:
      assessments.length === 0
        ? 0
        : Math.round(add(...assessments.map((entry) => entry.gross)) / assessments.length),
    averageChargeableDays:
      started.length === 0 ? 0 : Math.round((chargeableDays / started.length) * 100) / 100,
  };
}

export function reliefKpis(assessments) {
  const applied = assessments.flatMap((entry) =>
    entry.counts.flatMap((count) => count.relief.applied)
  );
  const declined = assessments.flatMap((entry) =>
    entry.counts.flatMap((count) => count.relief.declined)
  );
  const byKind = new Map();
  for (const record of applied) {
    byKind.set(record.kind, (byKind.get(record.kind) ?? 0) + 1);
  }
  return {
    applied: applied.length,
    declined: declined.length,
    acceptanceRate:
      applied.length + declined.length === 0
        ? 0
        : applied.length / (applied.length + declined.length),
    byKind: Object.fromEntries([...byKind.entries()].sort(([a], [b]) => (a < b ? -1 : 1))),
  };
}

export function comparePeriods(before, after) {
  const delta = (key) => (after[key] ?? 0) - (before[key] ?? 0);
  const share = (key) =>
    (before[key] ?? 0) === 0 ? null : Math.round((delta(key) / before[key]) * 1000) / 10;
  return {
    cars: delta('cars'),
    chargeableDays: delta('chargeableDays'),
    gross: delta('gross'),
    grossPercent: share('gross'),
    carsPercent: share('cars'),
  };
}

export function grossPerCarRounded(kpis, parts = 1) {
  return scale(kpis.gross, 1, Math.max(1, parts));
}
