import { IngestError, isSpurtallyError } from '../core/errors.js';
import { requireArray, requireObject, requireString } from '../core/guards.js';
import { parseMoney } from '../core/money.js';
import { formatCivilDate, parseCivilDate } from '../time/civil.js';
import { payment } from '../settlement/payment.js';
import { parseCsvRecords } from './csv.js';

/**
 * Reading a remittance advice.
 *
 * This is the file that comes off the lockbox or out of the payer's portal, and
 * like the carrier's invoice it is read literally. A row that cannot be read is
 * kept with its line number rather than dropped, because a remittance that
 * silently lost a row leaves an invoice open that somebody already paid, and
 * the consignee finds out when the dunning letter arrives.
 *
 * The advised invoice list is the interesting column. A payer who names the
 * invoices has told us where the money goes and we do what we are told, even
 * when that leaves an older invoice open. Where nothing is named the payment
 * falls back to oldest first, which is the assumption everyone in the industry
 * makes and the only one worth defaulting to.
 */

export const REMITTANCE_COLUMNS = Object.freeze({
  consigneeId: ['consignee', 'consignee_id', 'payer', 'customer', 'account'],
  receivedOn: ['date', 'received', 'received_on', 'payment_date', 'posted'],
  amount: ['amount', 'paid', 'payment', 'remittance', 'net_amount'],
  reference: ['reference', 'check', 'check_number', 'trace', 'eft', 'ref'],
  advisedInvoices: ['invoices', 'invoice', 'invoice_numbers', 'applied_to', 'bill'],
  method: ['method', 'application', 'apply'],
});

const LIST_SEPARATOR = /[;|]|\s+/;

function pick(row, names) {
  for (const name of names) {
    const value = row[name];
    if (value !== undefined && String(value).trim() !== '') {
      return String(value).trim();
    }
  }
  return undefined;
}

export function splitInvoiceList(value) {
  if (value === undefined) {
    return [];
  }
  return String(value)
    .split(LIST_SEPARATOR)
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
}

export function mapRemittanceRow(row, { columnMap = REMITTANCE_COLUMNS } = {}) {
  requireObject(row, 'row');
  const consigneeId = pick(row, columnMap.consigneeId);
  if (consigneeId === undefined) {
    throw new IngestError('the remittance row does not name a consignee', { row });
  }
  const amount = pick(row, columnMap.amount);
  if (amount === undefined) {
    throw new IngestError('the remittance row carries no amount', { consignee: consigneeId });
  }
  const receivedOn = pick(row, columnMap.receivedOn);
  if (receivedOn === undefined) {
    throw new IngestError('the remittance row carries no date', { consignee: consigneeId });
  }
  return payment({
    consigneeId,
    receivedOn: formatCivilDate(parseCivilDate(receivedOn)),
    amount: parseMoney(amount),
    reference: pick(row, columnMap.reference),
    advisedInvoices: splitInvoiceList(pick(row, columnMap.advisedInvoices)),
    method: pick(row, columnMap.method),
  });
}

export function readRemittanceRows(rows, options = {}) {
  const payments = [];
  const rejects = [];
  requireArray(rows, 'rows').forEach((row, index) => {
    try {
      payments.push(mapRemittanceRow(row, options));
    } catch (error) {
      if (!isSpurtallyError(error)) {
        throw error;
      }
      rejects.push({ line: index + 2, code: error.code, message: error.message, row });
    }
  });
  return { payments, rejects };
}

export function readRemittance(text, options = {}) {
  const rows = parseCsvRecords(requireString(text, 'text', { allowEmpty: true }));
  const { payments, rejects } = readRemittanceRows(rows, options);
  return {
    payments,
    rejects,
    read: rows.length,
    total: payments.reduce((sum, record) => sum + record.amount, 0),
  };
}

export function byConsignee(result) {
  const totals = new Map();
  for (const record of result.payments) {
    const entry = totals.get(record.consigneeId) ?? {
      consigneeId: record.consigneeId,
      amount: 0,
      payments: 0,
    };
    entry.amount += record.amount;
    entry.payments += 1;
    totals.set(record.consigneeId, entry);
  }
  return [...totals.values()].sort((a, b) => (a.consigneeId < b.consigneeId ? -1 : 1));
}
