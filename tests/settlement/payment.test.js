import { describe, expect, it } from 'vitest';
import {
  APPLICATION,
  applyAll,
  applyPayment,
  openInvoiceNumbers,
  payment,
  totalApplied,
} from '../../src/settlement/payment.js';
import { ValidationError } from '../../src/core/errors.js';

const invoices = [
  { number: 'INV-202401-00001', issuedOn: '2024-02-05', total: 30000 },
  { number: 'INV-202402-00002', issuedOn: '2024-03-05', total: 10000 },
  { number: 'INV-202403-00003', issuedOn: '2024-04-05', total: 50000 },
];

const base = { consigneeId: ' delta ', receivedOn: '2024-04-20', amount: 40000 };

describe('building a payment', () => {
  it('uppercases the consignee and carries an id', () => {
    const record = payment(base);
    expect(record.consigneeId).toBe('DELTA');
    expect(record.id).toMatch(/^[0-9a-f]{8}$/);
  });

  it('applies oldest first when no invoices are advised', () => {
    expect(payment(base).method).toBe(APPLICATION.OLDEST_FIRST);
  });

  it('applies as advised when invoices are named', () => {
    const record = payment({ ...base, advisedInvoices: ['INV-202403-00003'] });
    expect(record.method).toBe(APPLICATION.AS_ADVISED);
  });

  it('refuses an as advised payment naming nothing', () => {
    expect(() => payment({ ...base, method: APPLICATION.AS_ADVISED })).toThrow(/name its invoices/);
  });

  it('refuses an amount that is not above zero', () => {
    expect(() => payment({ ...base, amount: 0 })).toThrow(/above zero/);
    expect(() => payment({ ...base, amount: 12.5 })).toThrow(/whole cent/);
  });

  it('refuses a method it does not know', () => {
    expect(() => payment({ ...base, method: 'largest-first' })).toThrow(ValidationError);
  });
});

describe('applying oldest first', () => {
  const result = applyPayment(payment(base), invoices);

  it('clears the oldest then part of the next', () => {
    expect(result.applications).toEqual([
      { invoiceNumber: 'INV-202401-00001', applied: 30000, remainingOnInvoice: 0 },
      { invoiceNumber: 'INV-202402-00002', applied: 10000, remainingOnInvoice: 0 },
    ]);
  });

  it('applies everything it had', () => {
    expect(totalApplied(result)).toBe(40000);
    expect(result.unapplied).toBe(0);
  });

  it('leaves the newest invoice open', () => {
    expect(openInvoiceNumbers(result.balances)).toEqual(['INV-202403-00003']);
  });
});

describe('applying as advised', () => {
  it('lands only where it was told', () => {
    const record = payment({ ...base, advisedInvoices: ['INV-202403-00003'] });
    const result = applyPayment(record, invoices);
    expect(result.applications).toHaveLength(1);
    expect(result.applications[0].invoiceNumber).toBe('INV-202403-00003');
    expect(result.applications[0].remainingOnInvoice).toBe(10000);
  });

  it('leaves the older invoices open even though it could have paid them', () => {
    const record = payment({ ...base, advisedInvoices: ['INV-202403-00003'] });
    const result = applyPayment(record, invoices);
    expect(openInvoiceNumbers(result.balances)).toEqual([
      'INV-202401-00001',
      'INV-202402-00002',
      'INV-202403-00003',
    ]);
  });

  it('ignores an advised invoice it cannot find', () => {
    const record = payment({ ...base, advisedInvoices: ['INV-999999-00099'] });
    const result = applyPayment(record, invoices);
    expect(result.applications).toEqual([]);
    expect(result.unapplied).toBe(40000);
  });
});

describe('applying smallest first', () => {
  it('clears the little ones', () => {
    const record = payment({ ...base, amount: 45000, method: APPLICATION.SMALLEST_FIRST });
    const result = applyPayment(record, invoices);
    expect(result.applications.map((entry) => entry.invoiceNumber)).toEqual([
      'INV-202402-00002',
      'INV-202401-00001',
      'INV-202403-00003',
    ]);
    expect(result.applications[2].applied).toBe(5000);
  });
});

describe('overpayment', () => {
  it('reports what could not be applied', () => {
    const record = payment({ ...base, amount: 100000 });
    const result = applyPayment(record, invoices);
    expect(result.unapplied).toBe(10000);
    expect(openInvoiceNumbers(result.balances)).toEqual([]);
  });

  it('applies nothing when there is nothing open', () => {
    const result = applyPayment(payment(base), []);
    expect(result.applications).toEqual([]);
    expect(result.unapplied).toBe(40000);
  });
});

describe('applyAll', () => {
  it('runs the payments in the order they were received', () => {
    const payments = [
      payment({ ...base, receivedOn: '2024-05-01', amount: 20000 }),
      payment({ ...base, receivedOn: '2024-04-20', amount: 30000 }),
    ];
    const { results, balances } = applyAll(payments, invoices);
    expect(results[0].applications[0].invoiceNumber).toBe('INV-202401-00001');
    expect(results[1].applications[0].invoiceNumber).toBe('INV-202402-00002');
    expect(balances.get('INV-202402-00002')).toBe(0);
  });

  it('carries the running balance between payments', () => {
    const payments = [
      payment({ ...base, receivedOn: '2024-04-20', amount: 20000 }),
      payment({ ...base, receivedOn: '2024-04-21', amount: 20000 }),
    ];
    const { balances } = applyAll(payments, invoices);
    expect(balances.get('INV-202401-00001')).toBe(0);
    expect(balances.get('INV-202402-00002')).toBe(0);
    expect(balances.get('INV-202403-00003')).toBe(50000);
  });

  it('handles no payments', () => {
    const { results, balances } = applyAll([], invoices);
    expect(results).toEqual([]);
    expect(openInvoiceNumbers(balances)).toHaveLength(3);
  });
});
