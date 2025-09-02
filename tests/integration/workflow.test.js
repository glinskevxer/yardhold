import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadConfig } from '../../src/config/loadConfig.js';
import { parseDocument } from '../../src/config/schema.js';
import { ingestCsv } from '../../src/io/ingestEvents.js';
import { assessMonth, consigneesIn, monthTotal } from '../../src/assessment/runMonth.js';
import { invoiceForConsignee } from '../../src/cli/commands/invoice.js';
import { readCarrierInvoice } from '../../src/io/carrierInvoice.js';
import { reconcile, reconciliationSummary } from '../../src/reporting/reconciliation.js';
import { claim, GROUND } from '../../src/disputes/claim.js';
import { isTimely } from '../../src/disputes/timeLimits.js';
import { allocateOverCars, creditMemo } from '../../src/disputes/creditMemo.js';
import { payment, applyAll, openInvoiceNumbers } from '../../src/settlement/payment.js';
import {
  fromCreditMemo,
  fromInvoice,
  fromPayment,
  isClear,
  statementOfAccount,
} from '../../src/settlement/statementOfAccount.js';
import { ACTION, auditTrail } from '../../src/audit/trail.js';

/**
 * A month from end to end: read the feed, assess, invoice, reconcile against
 * the carrier, file a claim on the difference, credit it and take the payment.
 * Every stage feeds the next from its real output rather than a fixture.
 */

const root = resolve(process.cwd());
const world = loadConfig(
  parseDocument(readFileSync(resolve(root, 'examples/memphis-north.json'), 'utf8'))
);
const feed = ingestCsv(readFileSync(resolve(root, 'examples/march-2024.csv'), 'utf8'));
const carrier = readCarrierInvoice(
  readFileSync(resolve(root, 'examples/carrier-march-2024.csv'), 'utf8')
);

const result = assessMonth(world, feed.events, { period: '202403', carrier: 'BNSF' });

describe('reading the month', () => {
  it('takes every event without a reject', () => {
    expect(feed.rejects).toEqual([]);
    expect(feed.problems).toEqual([]);
  });

  it('assesses every car', () => {
    expect(result.skipped).toEqual([]);
    expect(result.assessments).toHaveLength(6);
  });

  it('finds both consignees', () => {
    expect(consigneesIn(result)).toEqual(['DELTA', 'YAZOO']);
  });
});

describe('invoicing the month', () => {
  const invoices = consigneesIn(result).map((consigneeId, index) =>
    invoiceForConsignee(world, result, consigneeId, { sequence: index + 1, issuedOn: '2024-04-05' })
  );

  it('cuts an invoice for each', () => {
    expect(invoices.map((record) => record.consigneeId)).toEqual(['DELTA', 'YAZOO']);
  });

  it('settles Delta on its agreement and bills Yazoo by the day', () => {
    const delta = invoices[0];
    const yazoo = invoices[1];
    expect(delta.lines[0].description).toContain('on average');
    expect(yazoo.lines.every((line) => line.description.startsWith('demurrage day'))).toBe(true);
  });

  it('foots to the month total for the day billed consignee', () => {
    const yazoo = invoices[1];
    const assessed = result.assessments
      .filter((entry) => entry.consigneeId === 'YAZOO')
      .reduce((sum, entry) => sum + entry.total, 0);
    expect(yazoo.subtotal).toBe(assessed);
  });

  it('never invoices more than the month was assessed at', () => {
    const billed = invoices.reduce((sum, record) => sum + record.subtotal, 0);
    expect(billed).toBeLessThanOrEqual(monthTotal(result));
  });
});

describe('reconciling against the carrier', () => {
  const rows = reconcile(result, carrier);

  it('lines every car up', () => {
    expect(rows).toHaveLength(6);
  });

  it('finds a difference worth claiming', () => {
    const summary = reconciliationSummary(rows);
    expect(summary.claimable).toBeGreaterThan(0);
  });

  it('names the car the carrier overbilled', () => {
    const over = rows.filter((row) => row.verdict === 'overbilled');
    expect(over.length).toBeGreaterThan(0);
    expect(over[0].theirs).toBeGreaterThan(over[0].ours);
  });
});

describe('claiming and settling the difference', () => {
  const rows = reconcile(result, carrier);
  const claimable = reconciliationSummary(rows).claimable;
  const filed = claim({
    sequence: 1,
    period: '202404',
    invoiceNumber: 'D-778120',
    consigneeId: 'YAZOO',
    ground: GROUND.ARITHMETIC,
    filedOn: '2024-04-20',
    amountClaimed: claimable,
    cars: rows.filter((row) => row.verdict === 'overbilled').map((row) => row.carId),
  });

  it('files inside the window', () => {
    expect(isTimely(filed, '2024-04-05')).toBe(true);
  });

  it('credits the difference and spreads it over the cars', () => {
    const invoice = invoiceForConsignee(world, result, 'YAZOO', {
      sequence: 2,
      issuedOn: '2024-04-05',
    });
    const memo = creditMemo({
      sequence: 1,
      period: '202404',
      invoiceNumber: invoice.number,
      consigneeId: 'YAZOO',
      amount: 1000,
      reason: 'carrier overbilled on the March invoice',
      claimNumber: filed.number,
      issuedOn: '2024-04-30',
      allocations: allocateOverCars(1000, invoice.lines),
    });
    expect(memo.allocations.reduce((sum, entry) => sum + entry.amount, 0)).toBe(1000);
  });

  it('clears the account once the balance is paid', () => {
    const invoice = invoiceForConsignee(world, result, 'YAZOO', {
      sequence: 2,
      issuedOn: '2024-04-05',
    });
    const memo = creditMemo({
      sequence: 1,
      period: '202404',
      invoiceNumber: invoice.number,
      consigneeId: 'YAZOO',
      amount: 1000,
      reason: 'carrier overbilled',
      issuedOn: '2024-04-30',
    });
    const paid = payment({
      consigneeId: 'YAZOO',
      receivedOn: '2024-05-02',
      amount: invoice.total - 1000,
      advisedInvoices: [invoice.number],
    });
    const account = statementOfAccount({
      consigneeId: 'YAZOO',
      entries: [fromInvoice(invoice), fromCreditMemo(memo), fromPayment(paid)],
    });
    expect(isClear(account)).toBe(true);
  });

  it('applies the payment against the invoice and leaves nothing open', () => {
    const invoice = invoiceForConsignee(world, result, 'YAZOO', {
      sequence: 2,
      issuedOn: '2024-04-05',
    });
    const paid = payment({
      consigneeId: 'YAZOO',
      receivedOn: '2024-05-02',
      amount: invoice.total,
      advisedInvoices: [invoice.number],
    });
    const { balances } = applyAll([paid], [invoice]);
    expect(openInvoiceNumbers(balances)).toEqual([]);
  });
});

describe('the audit trail over the whole run', () => {
  it('records each stage against the same inputs', () => {
    const inputs = ['examples/memphis-north.json', 'examples/march-2024.csv', '202403'];
    const trail = auditTrail([
      {
        action: ACTION.CONFIG_LOADED,
        at: '2024-04-05T08:00',
        actor: 'clerk',
        subject: 'world',
        inputs,
      },
      { action: ACTION.INGESTED, at: '2024-04-05T08:01', actor: 'clerk', subject: 'march', inputs },
      {
        action: ACTION.ASSESSED,
        at: '2024-04-05T08:02',
        actor: 'clerk',
        subject: '202403',
        inputs,
      },
      { action: ACTION.INVOICED, at: '2024-04-05T08:03', actor: 'clerk', subject: 'YAZOO', inputs },
    ]);
    const prints = new Set(trail.all().map((entry) => entry.inputFingerprint));
    expect(trail.size).toBe(4);
    expect(prints.size).toBe(1);
  });
});
