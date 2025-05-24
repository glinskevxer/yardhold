import { requireArray, requireObject, requireString } from '../core/guards.js';
import { recomputeCar } from './recompute.js';

/**
 * Running the same car under different rules.
 *
 * The office uses this twice a year, when a page is about to change and when a
 * consignee asks whether an average agreement would have been worth having.
 * Both questions are the same question: hold the events fixed, move one rule,
 * and read the difference.
 *
 * It is deliberately not a forecast. The events are what happened, so the
 * answer is what the month would have cost, never what the next one will.
 */

export function scenario({ name, substitutions = {} } = {}) {
  requireString(name, 'name');
  requireObject(substitutions, 'substitutions');
  return Object.freeze({ name, substitutions });
}

export function runScenarios(original, scenarios) {
  requireObject(original, 'original');
  requireArray(scenarios, 'scenarios');
  const base = {
    name: 'as billed',
    total: original.total,
    chargeableDays: original.chargeableDays,
  };
  const rows = scenarios.map((entry) => {
    const built = entry.substitutions === undefined ? scenario(entry) : entry;
    const revised = recomputeCar(original, built.substitutions);
    return {
      name: built.name,
      total: revised.total,
      chargeableDays: revised.chargeableDays,
      difference: revised.total - original.total,
      assessment: revised,
    };
  });
  return { base, rows };
}

export function cheapest(result) {
  return [result.base, ...result.rows].reduce((best, row) => (row.total < best.total ? row : best));
}

export function dearest(result) {
  return [result.base, ...result.rows].reduce((best, row) => (row.total > best.total ? row : best));
}

export function spread(result) {
  return dearest(result).total - cheapest(result).total;
}

export function betterThanBilled(result) {
  return result.rows
    .filter((row) => row.difference < 0)
    .sort((a, b) => a.difference - b.difference);
}

export function scenarioRows(result) {
  return [
    {
      name: result.base.name,
      days: result.base.chargeableDays,
      total: result.base.total,
      difference: 0,
    },
    ...result.rows.map((row) => ({
      name: row.name,
      days: row.chargeableDays,
      total: row.total,
      difference: row.difference,
    })),
  ];
}

export function acrossCars(originals, scenarios) {
  const totals = new Map();
  for (const original of originals) {
    const result = runScenarios(original, scenarios);
    totals.set('as billed', (totals.get('as billed') ?? 0) + result.base.total);
    for (const row of result.rows) {
      totals.set(row.name, (totals.get(row.name) ?? 0) + row.total);
    }
  }
  return [...totals.entries()]
    .map(([name, total]) => ({ name, total }))
    .sort((a, b) => a.total - b.total);
}
