import { ValidationError } from '../../core/errors.js';
import { requireString } from '../../core/guards.js';
import { assessmentsFor, consigneesIn } from '../../assessment/runMonth.js';
import { creditLedger } from '../../average/credits.js';
import { reconcile } from '../../average/reconcile.js';
import { agreementFor } from '../../config/loadConfig.js';
import { statement, statementCsv, statementText } from '../../reporting/statement.js';
import { OUTPUT } from '../format.js';
import { loadRun } from '../context.js';

/**
 * spurtally statement
 *
 * The detail behind an invoice that says one number. A consignee on an average
 * agreement gets the reconciliation printed under the car list, because without
 * it the statement and the invoice have no arithmetic in common and the first
 * question is always how one became the other.
 */

export function statementFor(world, result, consigneeId) {
  const assessments = assessmentsFor(result, consigneeId);
  const agreement = agreementFor(world, consigneeId);
  const ledger =
    agreement === undefined
      ? []
      : creditLedger(assessments, agreement, {
          cars: new Map(assessments.map((entry) => [entry.carId, world.cars.find(entry.carId)])),
        });
  const settlement =
    agreement === undefined ? undefined : reconcile(ledger, agreement, { period: result.period });
  return statement({ period: result.period, consigneeId, assessments, ledger, settlement });
}

export function statementBody(records, output = OUTPUT.TABLE) {
  if (output === OUTPUT.JSON) {
    return JSON.stringify(records, null, 2);
  }
  if (output === OUTPUT.CSV) {
    return records.map(statementCsv).join('');
  }
  return records.map(statementText).join('\n\n');
}

export function runStatement(options, deps = {}) {
  const { context, result } = loadRun(options, deps);
  const wanted =
    options.consignee === undefined
      ? consigneesIn(result)
      : [requireString(options.consignee, 'consignee').trim().toUpperCase()];
  if (options.consignee !== undefined && !consigneesIn(result).includes(wanted[0])) {
    throw new ValidationError('no cars were assessed for that consignee', {
      consignee: wanted[0],
      found: consigneesIn(result),
    });
  }
  const records = wanted.map((consigneeId) => statementFor(context.world, result, consigneeId));
  return { text: statementBody(records, context.output), statements: records, result };
}
