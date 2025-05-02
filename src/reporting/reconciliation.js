import { requireObject } from '../core/guards.js';
import { byCar } from '../io/carrierInvoice.js';

/**
 * Ours against theirs.
 *
 * The point of the whole system. Three kinds of disagreement come out of it and
 * they are not equally interesting:
 *
 *   overbilled   the carrier charged more than the tariff allows, which is a
 *                claim
 *   underbilled  the carrier charged less, which is not a claim and is worth
 *                knowing about anyway, because it usually means an event we
 *                have and they do not
 *   unbilled     we assessed a car they never invoiced, which is the one that
 *                catches a feed going stale
 *
 * A tolerance exists because rounding differs by a cent or two between systems
 * and nobody wants a hundred line report about single cents.
 */

export const VERDICT = Object.freeze({
  AGREED: 'agreed',
  OVERBILLED: 'overbilled',
  UNDERBILLED: 'underbilled',
  UNBILLED: 'unbilled',
  NOT_ASSESSED: 'not-assessed',
});

export const DEFAULT_TOLERANCE_CENTS = 2;

export function reconcile(
  result,
  carrierInvoice,
  { toleranceCents = DEFAULT_TOLERANCE_CENTS } = {}
) {
  requireObject(result, 'result');
  requireObject(carrierInvoice, 'carrierInvoice');
  const theirs = new Map(byCar(carrierInvoice).map((entry) => [entry.carId, entry]));
  const rows = [];
  for (const assessment of result.assessments) {
    const billed = theirs.get(assessment.carId);
    theirs.delete(assessment.carId);
    if (billed === undefined) {
      rows.push({
        carId: assessment.carId,
        ours: assessment.total,
        theirs: 0,
        difference: -assessment.total,
        verdict: assessment.total === 0 ? VERDICT.AGREED : VERDICT.UNBILLED,
      });
      continue;
    }
    const difference = billed.amount - assessment.total;
    rows.push({
      carId: assessment.carId,
      ours: assessment.total,
      theirs: billed.amount,
      ourDays: assessment.chargeableDays,
      theirDays: billed.days,
      difference,
      verdict: verdictFor(difference, toleranceCents),
    });
  }
  for (const entry of theirs.values()) {
    rows.push({
      carId: entry.carId,
      ours: 0,
      theirs: entry.amount,
      difference: entry.amount,
      verdict: VERDICT.NOT_ASSESSED,
    });
  }
  return rows.sort((a, b) => (a.carId < b.carId ? -1 : a.carId > b.carId ? 1 : 0));
}

function verdictFor(difference, tolerance) {
  if (Math.abs(difference) <= tolerance) {
    return VERDICT.AGREED;
  }
  return difference > 0 ? VERDICT.OVERBILLED : VERDICT.UNDERBILLED;
}

export function ofVerdict(rows, verdict) {
  return rows.filter((row) => row.verdict === verdict);
}

export function claimable(rows) {
  return ofVerdict(rows, VERDICT.OVERBILLED);
}

export function reconciliationSummary(rows) {
  const counts = new Map();
  for (const row of rows) {
    counts.set(row.verdict, (counts.get(row.verdict) ?? 0) + 1);
  }
  return {
    cars: rows.length,
    ours: rows.reduce((sum, row) => sum + row.ours, 0),
    theirs: rows.reduce((sum, row) => sum + row.theirs, 0),
    difference: rows.reduce((sum, row) => sum + row.difference, 0),
    claimable: claimable(rows).reduce((sum, row) => sum + row.difference, 0),
    byVerdict: Object.fromEntries([...counts.entries()].sort(([a], [b]) => (a < b ? -1 : 1))),
  };
}

export function agreesInFull(rows) {
  return rows.every((row) => row.verdict === VERDICT.AGREED);
}
