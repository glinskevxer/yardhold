import { requireString } from '../../core/guards.js';
import { readCarrierInvoice } from '../../io/carrierInvoice.js';
import { VERDICT, reconcile, reconciliationSummary } from '../../reporting/reconciliation.js';
import { OUTPUT, keyValueBlock, plainMoney, renderRows } from '../format.js';
import { loadRun, readTextFile } from '../context.js';

/**
 * spurtally reconcile
 *
 * The command that gets run first on the fifth of the month and argued about
 * for the rest of it. Only the disagreements are shown unless everything is
 * asked for, because a report where four hundred agreed rows bury six claimable
 * ones is a report nobody finishes reading.
 */

const COLUMNS = ['car', 'verdict', 'ourDays', 'theirDays', 'ours', 'theirs', 'difference'];

export function reconciliationRows(rows) {
  return rows.map((row) => ({
    car: row.carId,
    verdict: row.verdict,
    ourDays: row.ourDays ?? '',
    theirDays: row.theirDays ?? '',
    ours: plainMoney(row.ours),
    theirs: plainMoney(row.theirs),
    difference: plainMoney(row.difference),
  }));
}

export function disagreements(rows) {
  return rows.filter((row) => row.verdict !== VERDICT.AGREED);
}

export function reconcileBody(rows, { output = OUTPUT.TABLE, all = false } = {}) {
  const shown = all ? rows : disagreements(rows);
  const summary = reconciliationSummary(rows);
  if (output === OUTPUT.JSON) {
    return JSON.stringify({ summary, rows: shown }, null, 2);
  }
  const table = renderRows(reconciliationRows(shown), output, COLUMNS);
  if (output === OUTPUT.CSV) {
    return table;
  }
  const tail = keyValueBlock(
    {
      cars: summary.cars,
      ours: plainMoney(summary.ours),
      theirs: plainMoney(summary.theirs),
      difference: plainMoney(summary.difference),
      claimable: plainMoney(summary.claimable),
    },
    ['cars', 'ours', 'theirs', 'difference', 'claimable']
  );
  const head = shown.length === 0 ? 'every car agrees' : table;
  return [head, '', tail].join('\n');
}

export function runReconcile(options, deps = {}) {
  requireString(options.carrierInvoice, 'carrierInvoice');
  const { context, result } = loadRun(options, deps);
  const carrierInvoice = readCarrierInvoice(readTextFile(options.carrierInvoice, deps));
  const rows = reconcile(result, carrierInvoice, {
    toleranceCents: options.tolerance === undefined ? undefined : Number(options.tolerance),
  });
  return {
    text: reconcileBody(rows, { output: context.output, all: options.all === true }),
    rows,
    carrierInvoice,
    result,
  };
}
