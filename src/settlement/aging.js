import { requireArray, requireString } from '../core/guards.js';
import { add, formatMoney } from '../core/money.js';
import { daysBetween, parseCivilDate } from '../time/civil.js';

/**
 * Aging the open items.
 *
 * The age is measured from the due date and not from the invoice date, because
 * a consignee on sixty day terms is not late on day thirty-one and a report
 * that says otherwise gets ignored within a week.
 *
 * Anything under dispute is aged in a bucket of its own. It is still open and
 * it still has to be looked at, but a dispute the carrier has not answered is
 * not a collection problem, and mixing the two hides both.
 */

export const BUCKETS = Object.freeze([
  { label: 'current', from: Number.NEGATIVE_INFINITY, to: 0 },
  { label: '1-30', from: 1, to: 30 },
  { label: '31-60', from: 31, to: 60 },
  { label: '61-90', from: 61, to: 90 },
  { label: 'over-90', from: 91, to: Number.POSITIVE_INFINITY },
]);

export const DISPUTED_BUCKET = 'disputed';

export function ageDays(record, asOf) {
  const due = parseCivilDate(requireString(record.dueOn, 'dueOn'));
  return daysBetween(due, parseCivilDate(requireString(asOf, 'asOf')));
}

export function bucketFor(days) {
  return BUCKETS.find((bucket) => days >= bucket.from && days <= bucket.to).label;
}

export function ageItem(record, asOf, { outstanding } = {}) {
  const days = ageDays(record, asOf);
  const amount = outstanding === undefined ? record.total : outstanding;
  return {
    number: record.number,
    consigneeId: record.consigneeId,
    dueOn: record.dueOn,
    days,
    amount,
    bucket: record.status === 'disputed' ? DISPUTED_BUCKET : bucketFor(days),
  };
}

export function ageInvoices(invoices, asOf, balances = new Map()) {
  return requireArray(invoices, 'invoices')
    .map((record) => ageItem(record, asOf, { outstanding: balances.get(record.number) }))
    .filter((item) => item.amount > 0)
    .sort((a, b) => b.days - a.days || (a.number < b.number ? -1 : 1));
}

export function bucketTotals(items) {
  const totals = new Map([...BUCKETS.map((bucket) => [bucket.label, 0]), [DISPUTED_BUCKET, 0]]);
  for (const item of items) {
    totals.set(item.bucket, add(totals.get(item.bucket) ?? 0, item.amount));
  }
  return Object.fromEntries(totals);
}

export function totalOutstanding(items) {
  return add(...items.map((item) => item.amount));
}

export function pastDue(items) {
  return items.filter((item) => item.days > 0 && item.bucket !== DISPUTED_BUCKET);
}

export function agingLines(items) {
  return items.map(
    (item) => `${item.number}  ${item.consigneeId}  ${item.bucket}  ${formatMoney(item.amount)}`
  );
}
