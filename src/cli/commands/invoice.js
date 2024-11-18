import { requireString } from '../../core/guards.js';
import { ingestCsv } from '../../io/ingestEvents.js';
import { assessMonth, assessmentsFor, consigneesIn } from '../../assessment/runMonth.js';
import { creditLedger } from '../../average/credits.js';
import { reconcile } from '../../average/reconcile.js';
import { buildInvoice } from '../../invoice/build.js';
import { RENDER_FORMAT, renderInvoice } from '../../invoice/render.js';
import { agreementFor } from '../../config/loadConfig.js';
import { rateForDay } from '../../tariff/rateLadder.js';
import { OUTPUT } from '../format.js';
import { commandContext, readTextFile } from '../context.js';

/**
 * spurtally invoice
 *
 * One invoice per consignee. A consignee on an average agreement gets the
 * reconciled shape, and because the reconciliation needs every car in the month
 * at once, the invoice cannot be cut car by car and then summed. That is the
 * only reason this command exists rather than a loop over assess.
 */

export function averageDayRate(assessments) {
  const rates = assessments.flatMap((assessment) => assessment.lines.map((line) => line.rate));
  if (rates.length > 0) {
    return Math.round(rates.reduce((sum, rate) => sum + rate, 0) / rates.length);
  }
  const page = assessments[0]?.page;
  return page === undefined ? 0 : rateForDay(page.ladder, 1);
}

export function invoiceForConsignee(world, result, consigneeId, { sequence, issuedOn }) {
  const assessments = assessmentsFor(result, consigneeId);
  const agreement = agreementFor(world, consigneeId);
  const party = world.parties.find(consigneeId);
  const settlement =
    agreement === undefined
      ? undefined
      : reconcile(
          creditLedger(assessments, agreement, {
            cars: new Map(assessments.map((entry) => [entry.carId, world.cars.find(entry.carId)])),
          }),
          agreement,
          { period: result.period }
        );
  return buildInvoice({
    sequence,
    period: result.period,
    consigneeId,
    splc: assessments[0]?.splc,
    issuedOn,
    termsDays: party?.paymentTermsDays ?? world.settings.termsDays,
    taxRateBasisPoints: world.settings.taxRateBasisPoints,
    assessments,
    settlement,
    averageRate: averageDayRate(assessments),
  });
}

export function buildAll(world, result, { issuedOn }) {
  return consigneesIn(result).map((consigneeId, index) =>
    invoiceForConsignee(world, result, consigneeId, { sequence: index + 1, issuedOn })
  );
}

export function invoiceRowsFor(invoices) {
  return invoices.map((record) => ({
    number: record.number,
    consignee: record.consigneeId,
    lines: record.lines.length,
    due: record.dueOn,
    total: (record.total / 100).toFixed(2),
  }));
}

export function invoiceReport(invoices, { output = OUTPUT.TABLE } = {}) {
  if (output === OUTPUT.JSON) {
    return `[${invoices.map((record) => renderInvoice(record, RENDER_FORMAT.JSON)).join(',')}]`;
  }
  if (output === OUTPUT.CSV) {
    return invoices.map((record) => renderInvoice(record, RENDER_FORMAT.CSV)).join('');
  }
  return invoices.map((record) => renderInvoice(record, RENDER_FORMAT.TEXT)).join('\n\n');
}

export function runInvoice(options, deps = {}) {
  const context = commandContext(options, deps);
  requireString(options.issuedOn, 'issuedOn');
  const feed = ingestCsv(readTextFile(options.events, deps), {
    offsetMinutes: context.world.settings.offsetMinutes,
  });
  const result = assessMonth(context.world, feed.events, {
    period: context.period,
    carrier: options.carrier,
  });
  const invoices = buildAll(context.world, result, { issuedOn: options.issuedOn });
  return { text: invoiceReport(invoices, { output: context.output }), invoices, result };
}
