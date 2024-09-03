import { requireArray, requireString } from '../core/guards.js';
import { formatInstant } from '../time/instant.js';
import { CHARGE_TYPE, lineItem } from './lineItem.js';
import { invoice } from './invoice.js';

/**
 * Turning a month of work into paper.
 *
 * An average agreement changes the shape of the invoice and not only its total.
 * Without one, every chargeable day is its own line and the consignee can see
 * exactly which car earned what. With one, the demurrage collapses to a single
 * settled line and the detail moves to the statement, because billing the days
 * and then crediting them back is how a clerk loses an afternoon.
 */

export function demurrageLines(assessments) {
  return assessments.flatMap((assessment) =>
    assessment.lines.map((line) =>
      lineItem({
        type: CHARGE_TYPE.DEMURRAGE,
        carId: line.carId,
        date: line.date,
        unitAmount: line.rate,
        dayIndex: line.dayIndex,
        description: `demurrage day ${line.dayIndex}`,
        reference: assessment.pageId,
      })
    )
  );
}

export function storageLines(results) {
  return results.flatMap((result) =>
    result.lines.map((line) =>
      lineItem({
        type: CHARGE_TYPE.STORAGE,
        carId: line.carId,
        date: line.date,
        unitAmount: line.rate,
        dayIndex: line.dayIndex,
        description: `storage day ${line.dayIndex} ${line.loadState}`,
      })
    )
  );
}

export function switchingLines(result, { offsetMinutes = -360 } = {}) {
  return result.lines.map((line) =>
    lineItem({
      type: CHARGE_TYPE.SWITCHING,
      unitAmount: line.amount,
      description: `${line.kind} switch, ${line.carCount} car${line.carCount === 1 ? '' : 's'}`,
      reference: formatInstant(line.at, offsetMinutes),
      taxable: true,
    })
  );
}

export function settledDemurrageLine(settlement, unitAmount) {
  return lineItem({
    type: CHARGE_TYPE.DEMURRAGE,
    quantity: settlement.billableDebits === 0 ? 1 : settlement.billableDebits,
    unitAmount: settlement.billableDebits === 0 ? 0 : unitAmount,
    description: `demurrage on average, ${settlement.debits} days less ${settlement.offsetDebits} offset`,
    reference: settlement.agreementId,
  });
}

export function buildInvoice({
  sequence,
  period,
  consigneeId,
  splc,
  issuedOn,
  termsDays,
  taxRateBasisPoints,
  assessments = [],
  storage = [],
  switching,
  settlement,
  averageRate = 0,
  adjustments = [],
} = {}) {
  requireString(period, 'period');
  requireArray(assessments, 'assessments');
  requireArray(storage, 'storage');
  requireArray(adjustments, 'adjustments');
  const lines = [];
  if (settlement === undefined) {
    lines.push(...demurrageLines(assessments));
  } else {
    lines.push(settledDemurrageLine(settlement, averageRate));
  }
  lines.push(...storageLines(storage));
  if (switching !== undefined) {
    lines.push(...switchingLines(switching));
  }
  lines.push(...adjustments);
  return invoice({
    sequence,
    period,
    consigneeId,
    splc,
    issuedOn,
    termsDays,
    taxRateBasisPoints,
    lines,
  });
}

export function creditMemoLine(amount, description, reference) {
  return lineItem({
    type: CHARGE_TYPE.CREDIT,
    unitAmount: -Math.abs(amount),
    description: requireString(description, 'description'),
    reference,
  });
}
