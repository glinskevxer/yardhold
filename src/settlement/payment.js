import { ValidationError } from '../core/errors.js';
import { optional, requireArray, requireOneOf, requireString } from '../core/guards.js';
import { fingerprint } from '../core/ids.js';
import { compareDates, formatCivilDate, parseCivilDate } from '../time/civil.js';

/**
 * Payments and how they land.
 *
 * A remittance that names its invoices is applied to those and nowhere else,
 * even when that leaves an older invoice open and the consignee looks
 * delinquent. Guessing at what a payer meant is how a disputed invoice quietly
 * gets paid and the dispute dies with it.
 */

export const APPLICATION = Object.freeze({
  AS_ADVISED: 'as-advised',
  OLDEST_FIRST: 'oldest-first',
  SMALLEST_FIRST: 'smallest-first',
});

const METHODS = Object.values(APPLICATION);

export function payment({
  consigneeId,
  receivedOn,
  amount,
  reference,
  advisedInvoices = [],
  method,
} = {}) {
  requireString(consigneeId, 'consigneeId');
  const received = parseCivilDate(requireString(receivedOn, 'receivedOn'));
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new ValidationError('a payment has to be a whole cent amount above zero', { amount });
  }
  requireArray(advisedInvoices, 'advisedInvoices');
  const chosen =
    method === undefined
      ? advisedInvoices.length > 0
        ? APPLICATION.AS_ADVISED
        : APPLICATION.OLDEST_FIRST
      : requireOneOf(method, METHODS, 'method');
  if (chosen === APPLICATION.AS_ADVISED && advisedInvoices.length === 0) {
    throw new ValidationError('a payment applied as advised has to name its invoices', {
      consigneeId,
    });
  }
  const record = {
    consigneeId: consigneeId.trim().toUpperCase(),
    receivedOn: formatCivilDate(received),
    amount,
    reference: optional(reference, (value) => requireString(value, 'reference')),
    advisedInvoices: Object.freeze([...advisedInvoices]),
    method: chosen,
  };
  record.id = fingerprint([record.consigneeId, record.receivedOn, record.amount, record.reference]);
  return Object.freeze(record);
}

function orderFor(record, invoices) {
  if (record.method === APPLICATION.AS_ADVISED) {
    return record.advisedInvoices
      .map((number) => invoices.find((entry) => entry.number === number))
      .filter(Boolean);
  }
  if (record.method === APPLICATION.SMALLEST_FIRST) {
    return [...invoices].sort((a, b) => a.total - b.total || (a.number < b.number ? -1 : 1));
  }
  return [...invoices].sort(
    (a, b) =>
      compareDates(parseCivilDate(a.issuedOn), parseCivilDate(b.issuedOn)) ||
      (a.number < b.number ? -1 : 1)
  );
}

export function applyPayment(record, invoices, balances = new Map()) {
  for (const target of invoices) {
    if (!balances.has(target.number)) {
      balances.set(target.number, target.total);
    }
  }
  const applications = [];
  let remaining = record.amount;
  for (const target of orderFor(record, invoices)) {
    if (remaining <= 0) {
      break;
    }
    const outstanding = balances.get(target.number);
    if (outstanding <= 0) {
      continue;
    }
    const applied = Math.min(remaining, outstanding);
    applications.push({
      invoiceNumber: target.number,
      applied,
      remainingOnInvoice: outstanding - applied,
    });
    balances.set(target.number, outstanding - applied);
    remaining -= applied;
  }
  return { paymentId: record.id, applications, unapplied: remaining, balances };
}

export function applyAll(payments, invoices) {
  const balances = new Map(invoices.map((entry) => [entry.number, entry.total]));
  const results = [];
  for (const record of [...payments].sort((a, b) =>
    compareDates(parseCivilDate(a.receivedOn), parseCivilDate(b.receivedOn))
  )) {
    results.push(applyPayment(record, invoices, balances));
  }
  return { results, balances };
}

export function totalApplied(result) {
  return result.applications.reduce((sum, entry) => sum + entry.applied, 0);
}

export function openInvoiceNumbers(balances) {
  return [...balances.entries()]
    .filter(([, outstanding]) => outstanding > 0)
    .map(([number]) => number)
    .sort();
}
