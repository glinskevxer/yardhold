import { ValidationError } from '../core/errors.js';
import { optional, requireArray, requireOneOf, requireString } from '../core/guards.js';
import { referenceNumber } from '../core/ids.js';
import { add, scale } from '../core/money.js';
import { addDays, formatCivilDate, parseCivilDate } from '../time/civil.js';
import { lineTotal, subtotalsByType, taxableTotal } from './lineItem.js';

/**
 * An invoice. Once issued it is immutable: a correction is a credit memo and a
 * new invoice, never an edit, because the consignee has the old paper and the
 * carrier has the old number.
 */

export const INVOICE_STATUS = Object.freeze({
  DRAFT: 'draft',
  ISSUED: 'issued',
  DISPUTED: 'disputed',
  SETTLED: 'settled',
  VOIDED: 'voided',
});

const STATUSES = Object.values(INVOICE_STATUS);

export function invoice({
  sequence,
  period,
  consigneeId,
  splc,
  lines = [],
  issuedOn,
  termsDays = 15,
  taxRateBasisPoints = 0,
  status = INVOICE_STATUS.DRAFT,
  note,
} = {}) {
  requireString(period, 'period');
  requireString(consigneeId, 'consigneeId');
  requireArray(lines, 'lines');
  requireOneOf(status, STATUSES, 'status');
  const issued = parseCivilDate(requireString(issuedOn, 'issuedOn'));
  if (taxRateBasisPoints < 0 || taxRateBasisPoints > 3000) {
    throw new ValidationError('a tax rate has to be between zero and thirty percent', {
      taxRateBasisPoints,
    });
  }
  const subtotal = lineTotal(lines);
  const tax = scale(taxableTotal(lines), taxRateBasisPoints, 10000);
  return Object.freeze({
    number: referenceNumber('INV', period, sequence),
    period,
    consigneeId: consigneeId.trim().toUpperCase(),
    splc: optional(splc, (value) => requireString(value, 'splc')),
    lines: Object.freeze([...lines]),
    issuedOn: formatCivilDate(issued),
    dueOn: formatCivilDate(addDays(issued, termsDays)),
    termsDays,
    subtotal,
    tax,
    total: add(subtotal, tax),
    subtotals: subtotalsByType(lines),
    status,
    note,
  });
}

export function withStatus(record, status) {
  requireOneOf(status, STATUSES, 'status');
  if (record.status === INVOICE_STATUS.VOIDED) {
    throw new ValidationError('a voided invoice cannot change status again', {
      number: record.number,
    });
  }
  return Object.freeze({ ...record, status });
}

export function isPayable(record) {
  return record.status === INVOICE_STATUS.ISSUED || record.status === INVOICE_STATUS.DISPUTED;
}

export function isOpen(record) {
  return record.status !== INVOICE_STATUS.SETTLED && record.status !== INVOICE_STATUS.VOIDED;
}

export function carsOn(record) {
  return [...new Set(record.lines.map((line) => line.carId).filter(Boolean))].sort();
}

export function lineCount(record) {
  return record.lines.length;
}

export function describeInvoice(record) {
  return `${record.number} ${record.consigneeId} ${record.period} ${record.status}`;
}
