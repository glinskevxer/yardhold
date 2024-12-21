import { ValidationError } from '../core/errors.js';
import { optional, requireInteger, requireOneOf, requireString } from '../core/guards.js';
import { formatCivilDate, parseCivilDate } from '../time/civil.js';

/**
 * Writing something off.
 *
 * Two rules and neither is negotiable. A balance under the de minimis is
 * written off by anyone, because chasing eleven dollars costs more than eleven
 * dollars. Anything above it needs an approver whose limit covers it, and an
 * approver cannot write off their own assessment, which is the only control in
 * this whole system that exists because of people rather than arithmetic.
 */

export const WRITE_OFF_REASON = Object.freeze({
  DE_MINIMIS: 'de-minimis',
  UNCOLLECTABLE: 'uncollectable',
  GOODWILL: 'goodwill',
  BILLING_ERROR: 'billing-error',
  SETTLED_AT_LESS: 'settled-at-less',
});

const REASONS = Object.values(WRITE_OFF_REASON);

export const DE_MINIMIS_CENTS = 2500;

export const APPROVAL_LIMITS = Object.freeze({
  clerk: 0,
  supervisor: 50000,
  manager: 250000,
  controller: Number.POSITIVE_INFINITY,
});

export function limitFor(role) {
  return APPROVAL_LIMITS[role] ?? 0;
}

export function needsApproval(amount, { deMinimis = DE_MINIMIS_CENTS } = {}) {
  return amount > deMinimis;
}

export function writeOff({
  invoiceNumber,
  amount,
  reason,
  approvedBy,
  approverRole,
  assessedBy,
  writtenOn,
  note,
  deMinimis = DE_MINIMIS_CENTS,
} = {}) {
  requireString(invoiceNumber, 'invoiceNumber');
  requireOneOf(reason, REASONS, 'reason');
  requireInteger(amount, 'amount', { min: 1 });
  const written = parseCivilDate(requireString(writtenOn, 'writtenOn'));
  if (!needsApproval(amount, { deMinimis })) {
    return Object.freeze({
      invoiceNumber,
      amount,
      reason,
      approvedBy: approvedBy ?? 'automatic',
      approverRole: approverRole ?? 'clerk',
      writtenOn: formatCivilDate(written),
      note: optional(note, (value) => requireString(value, 'note')),
      automatic: true,
    });
  }
  requireString(approvedBy, 'approvedBy');
  requireString(approverRole, 'approverRole');
  const limit = limitFor(approverRole);
  if (amount > limit) {
    throw new ValidationError('the approver cannot write off that much', {
      invoiceNumber,
      amount,
      approverRole,
      limit: limit === Number.POSITIVE_INFINITY ? null : limit,
    });
  }
  if (assessedBy !== undefined && assessedBy === approvedBy) {
    throw new ValidationError('an assessment cannot be written off by whoever raised it', {
      invoiceNumber,
      approvedBy,
    });
  }
  return Object.freeze({
    invoiceNumber,
    amount,
    reason,
    approvedBy,
    approverRole,
    writtenOn: formatCivilDate(written),
    note: optional(note, (value) => requireString(value, 'note')),
    automatic: false,
  });
}

export function totalWrittenOff(records) {
  return records.reduce((sum, record) => sum + record.amount, 0);
}

export function byReason(records) {
  const totals = new Map();
  for (const record of records) {
    totals.set(record.reason, (totals.get(record.reason) ?? 0) + record.amount);
  }
  return Object.fromEntries([...totals.entries()].sort(([a], [b]) => (a < b ? -1 : 1)));
}

export function automaticShare(records) {
  if (records.length === 0) {
    return 0;
  }
  return records.filter((record) => record.automatic).length / records.length;
}
