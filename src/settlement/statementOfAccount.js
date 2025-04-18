import { requireArray, requireString } from '../core/guards.js';
import { add, formatMoney } from '../core/money.js';
import { compareDates, parseCivilDate } from '../time/civil.js';

/**
 * The account.
 *
 * Everything that moved a consignee's balance, in the order it happened, with
 * a running total. The order is by date and then by kind, and the kind order is
 * deliberate: on a day when an invoice, a credit and a payment all land, the
 * invoice has to be on the account before the credit that reduces it, or the
 * running balance dips negative and the whole page looks wrong.
 */

const KIND_ORDER = Object.freeze({ invoice: 1, credit: 2, payment: 3, 'write-off': 4 });

export function accountEntry({ kind, date, reference, amount, note } = {}) {
  requireString(kind, 'kind');
  requireString(reference, 'reference');
  const on = parseCivilDate(requireString(date, 'date'));
  return Object.freeze({ kind, date, on, reference, amount, note });
}

export function fromInvoice(record) {
  return accountEntry({
    kind: 'invoice',
    date: record.issuedOn,
    reference: record.number,
    amount: record.total,
  });
}

export function fromCreditMemo(record) {
  return accountEntry({
    kind: 'credit',
    date: record.issuedOn,
    reference: record.number,
    amount: -record.amount,
    note: record.reason,
  });
}

export function fromPayment(record) {
  return accountEntry({
    kind: 'payment',
    date: record.receivedOn,
    reference: record.reference ?? record.id,
    amount: -record.amount,
  });
}

export function fromWriteOff(record) {
  return accountEntry({
    kind: 'write-off',
    date: record.writtenOn,
    reference: record.invoiceNumber,
    amount: -record.amount,
    note: record.reason,
  });
}

export function statementOfAccount({ consigneeId, entries = [], openingBalance = 0 } = {}) {
  requireString(consigneeId, 'consigneeId');
  requireArray(entries, 'entries');
  const sorted = [...entries].sort(
    (a, b) =>
      compareDates(a.on, b.on) ||
      (KIND_ORDER[a.kind] ?? 99) - (KIND_ORDER[b.kind] ?? 99) ||
      (a.reference < b.reference ? -1 : 1)
  );
  let balance = openingBalance;
  const rows = sorted.map((entry) => {
    balance = add(balance, entry.amount);
    return {
      date: entry.date,
      kind: entry.kind,
      reference: entry.reference,
      amount: entry.amount,
      balance,
    };
  });
  return {
    consigneeId: consigneeId.trim().toUpperCase(),
    openingBalance,
    rows,
    closingBalance: balance,
    charged: add(...rows.filter((row) => row.amount > 0).map((row) => row.amount)),
    relieved: add(...rows.filter((row) => row.amount < 0).map((row) => row.amount)),
  };
}

export function accountText(account) {
  const lines = [
    `Account ${account.consigneeId}`,
    `Opening ${formatMoney(account.openingBalance)}`,
    '',
  ];
  for (const row of account.rows) {
    lines.push(
      `  ${row.date}  ${row.kind.padEnd(10)} ${row.reference.padEnd(18)} ${formatMoney(
        row.amount
      ).padStart(12)}  ${formatMoney(row.balance).padStart(12)}`
    );
  }
  lines.push('', `Closing ${formatMoney(account.closingBalance)}`);
  return lines.join('\n');
}

export function isClear(account) {
  return account.closingBalance === 0;
}

export function isInCredit(account) {
  return account.closingBalance < 0;
}
