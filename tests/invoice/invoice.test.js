import { describe, expect, it } from 'vitest';
import {
  INVOICE_STATUS,
  carsOn,
  describeInvoice,
  invoice,
  isOpen,
  isPayable,
  lineCount,
  withStatus,
} from '../../src/invoice/invoice.js';
import { CHARGE_TYPE, lineItem } from '../../src/invoice/lineItem.js';
import { ValidationError } from '../../src/core/errors.js';

const lines = [
  lineItem({
    type: CHARGE_TYPE.DEMURRAGE,
    carId: 'BNSF 400123',
    date: '2024-03-07',
    unitAmount: 15000,
  }),
  lineItem({
    type: CHARGE_TYPE.DEMURRAGE,
    carId: 'GATX 77',
    date: '2024-03-08',
    unitAmount: 22500,
  }),
  lineItem({ type: CHARGE_TYPE.SWITCHING, unitAmount: 34000, taxable: true }),
];

const base = {
  sequence: 12,
  period: '202403',
  consigneeId: ' delta ',
  issuedOn: '2024-04-05',
  lines,
};

describe('building an invoice', () => {
  it('numbers itself', () => {
    expect(invoice(base).number).toBe('INV-202403-00012');
  });

  it('uppercases the consignee', () => {
    expect(invoice(base).consigneeId).toBe('DELTA');
  });

  it('totals the lines', () => {
    const record = invoice(base);
    expect(record.subtotal).toBe(71500);
    expect(record.total).toBe(71500);
  });

  it('subtotals by type', () => {
    expect(invoice(base).subtotals).toEqual({ demurrage: 37500, switching: 34000 });
  });

  it('works out the due date from the terms', () => {
    expect(invoice(base).dueOn).toBe('2024-04-20');
    expect(invoice({ ...base, termsDays: 30 }).dueOn).toBe('2024-05-05');
  });

  it('starts as a draft', () => {
    expect(invoice(base).status).toBe(INVOICE_STATUS.DRAFT);
  });

  it('is frozen down to the lines', () => {
    const record = invoice(base);
    expect(Object.isFrozen(record)).toBe(true);
    expect(Object.isFrozen(record.lines)).toBe(true);
  });

  it('needs a period, a consignee and an issue date', () => {
    expect(() => invoice({ ...base, period: undefined })).toThrow(ValidationError);
    expect(() => invoice({ ...base, consigneeId: undefined })).toThrow(ValidationError);
    expect(() => invoice({ ...base, issuedOn: undefined })).toThrow(ValidationError);
  });
});

describe('tax', () => {
  it('is charged only on the taxable lines', () => {
    const record = invoice({ ...base, taxRateBasisPoints: 925 });
    expect(record.tax).toBe(3145);
    expect(record.total).toBe(74645);
  });

  it('is nothing when the rate is nothing', () => {
    expect(invoice(base).tax).toBe(0);
  });

  it('refuses an absurd rate', () => {
    expect(() => invoice({ ...base, taxRateBasisPoints: 4000 })).toThrow(/thirty percent/);
    expect(() => invoice({ ...base, taxRateBasisPoints: -1 })).toThrow(ValidationError);
  });
});

describe('status', () => {
  it('moves through the states', () => {
    const issued = withStatus(invoice(base), INVOICE_STATUS.ISSUED);
    expect(issued.status).toBe(INVOICE_STATUS.ISSUED);
    expect(isPayable(issued)).toBe(true);
    expect(isOpen(issued)).toBe(true);
  });

  it('is payable while disputed', () => {
    expect(isPayable(withStatus(invoice(base), INVOICE_STATUS.DISPUTED))).toBe(true);
  });

  it('is neither payable nor open once settled', () => {
    const settled = withStatus(invoice(base), INVOICE_STATUS.SETTLED);
    expect(isPayable(settled)).toBe(false);
    expect(isOpen(settled)).toBe(false);
  });

  it('will not move a voided invoice', () => {
    const voided = withStatus(invoice(base), INVOICE_STATUS.VOIDED);
    expect(() => withStatus(voided, INVOICE_STATUS.ISSUED)).toThrow(/cannot change status/);
  });

  it('refuses a status it does not know', () => {
    expect(() => withStatus(invoice(base), 'paid-ish')).toThrow(ValidationError);
  });

  it('leaves the original untouched', () => {
    const draft = invoice(base);
    withStatus(draft, INVOICE_STATUS.ISSUED);
    expect(draft.status).toBe(INVOICE_STATUS.DRAFT);
  });
});

describe('reading an invoice', () => {
  it('lists the cars on it', () => {
    expect(carsOn(invoice(base))).toEqual(['BNSF 400123', 'GATX 77']);
  });

  it('counts the lines', () => {
    expect(lineCount(invoice(base))).toBe(3);
  });

  it('handles an invoice with no lines', () => {
    const empty = invoice({ ...base, lines: [] });
    expect(empty.total).toBe(0);
    expect(carsOn(empty)).toEqual([]);
  });

  it('describes itself', () => {
    expect(describeInvoice(invoice(base))).toBe('INV-202403-00012 DELTA 202403 draft');
  });
});
