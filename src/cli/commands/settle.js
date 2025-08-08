import { ValidationError } from '../../core/errors.js';
import { requireOneOf, requireString } from '../../core/guards.js';
import { readRemittance } from '../../io/remittance.js';
import { applyAll } from '../../settlement/payment.js';
import {
  agingLines,
  ageInvoices,
  bucketTotals,
  pastDue,
  totalOutstanding,
} from '../../settlement/aging.js';
import {
  accountText,
  fromInvoice,
  fromPayment,
  statementOfAccount,
} from '../../settlement/statementOfAccount.js';
import { OUTPUT, keyValueBlock, plainMoney, renderRows } from '../format.js';
import { loadRun, readTextFile } from '../context.js';
import { buildAll } from './invoice.js';

/**
 * spurtally settle
 *
 * Everything after the invoice goes out. The billing side of this program was
 * complete and the collection side was a library nobody could reach from a
 * terminal, so an office could cut an invoice here and then had to age it
 * somewhere else.
 *
 * Two views, because they answer different questions with the same inputs.
 * Aging is the collections question, which is who owes us what and for how
 * long. The account is the consignee question, which is what happened on my
 * account and in what order.
 *
 * The remittance file is optional and that is deliberate. Aging with no
 * payments read is the position on invoice day, which is a real thing to want
 * to look at, and it is better than refusing to run because a file nobody has
 * been sent yet is missing.
 */

export const SETTLE = Object.freeze({
  AGING: 'aging',
  ACCOUNT: 'account',
});

const KINDS = Object.values(SETTLE);

export function readPayments(options, deps = {}) {
  if (options.payments === undefined) {
    return { payments: [], rejects: [], read: 0, total: 0 };
  }
  return readRemittance(readTextFile(options.payments, deps));
}

export function agingBody(invoices, payments, asOf, output) {
  const { balances } = applyAll(payments, invoices);
  const items = ageInvoices(invoices, asOf, balances);
  if (output === OUTPUT.JSON) {
    return JSON.stringify(
      {
        asOf,
        items,
        buckets: bucketTotals(items),
        outstanding: totalOutstanding(items),
        pastDue: totalOutstanding(pastDue(items)),
      },
      null,
      2
    );
  }
  if (output === OUTPUT.CSV) {
    return renderRows(items, OUTPUT.CSV, ['number', 'consigneeId', 'days', 'bucket', 'amount']);
  }
  if (items.length === 0) {
    return 'nothing open';
  }
  const buckets = bucketTotals(items);
  return [
    agingLines(items).join('\n'),
    '',
    keyValueBlock({
      ...Object.fromEntries(
        Object.entries(buckets).map(([label, amount]) => [label, plainMoney(amount)])
      ),
      outstanding: plainMoney(totalOutstanding(items)),
      'past due': plainMoney(totalOutstanding(pastDue(items))),
    }),
  ].join('\n');
}

export function accountsFor(invoices, payments) {
  const consignees = [
    ...new Set([
      ...invoices.map((record) => record.consigneeId),
      ...payments.map((record) => record.consigneeId),
    ]),
  ].sort();
  return consignees.map((consigneeId) =>
    statementOfAccount({
      consigneeId,
      entries: [
        ...invoices.filter((record) => record.consigneeId === consigneeId).map(fromInvoice),
        ...payments.filter((record) => record.consigneeId === consigneeId).map(fromPayment),
      ],
    })
  );
}

export function accountBody(invoices, payments, output, only) {
  let accounts = accountsFor(invoices, payments);
  if (only !== undefined) {
    const wanted = only.trim().toUpperCase();
    accounts = accounts.filter((account) => account.consigneeId === wanted);
    if (accounts.length === 0) {
      throw new ValidationError('no account for that consignee', { consignee: only });
    }
  }
  if (output === OUTPUT.JSON) {
    return JSON.stringify(accounts, null, 2);
  }
  if (output === OUTPUT.CSV) {
    return renderRows(
      accounts.flatMap((account) =>
        account.rows.map((row) => ({ consignee: account.consigneeId, ...row }))
      ),
      OUTPUT.CSV,
      ['consignee', 'date', 'kind', 'reference', 'amount', 'balance']
    );
  }
  return accounts.map(accountText).join('\n\n');
}

export function settleBody(kind, invoices, payments, { asOf, output, consignee }) {
  requireOneOf(kind, KINDS, 'settle');
  if (kind === SETTLE.AGING) {
    return agingBody(invoices, payments, asOf, output);
  }
  return accountBody(invoices, payments, output, consignee);
}

export function runSettle(options, deps = {}) {
  const kind = options.settle ?? SETTLE.AGING;
  if (!KINDS.includes(kind)) {
    throw new ValidationError(`settle has to be one of ${KINDS.join(', ')}`, { settle: kind });
  }
  requireString(options.issuedOn, 'issuedOn');
  const asOf = options.asOf ?? options.issuedOn;
  const { context, result } = loadRun(options, deps);
  const invoices = buildAll(context.world, result, { issuedOn: options.issuedOn });
  const remittance = readPayments(options, deps);
  return {
    text: settleBody(kind, invoices, remittance.payments, {
      asOf,
      output: context.output,
      consignee: options.consignee,
    }),
    invoices,
    remittance,
  };
}
