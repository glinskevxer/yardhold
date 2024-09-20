import { describe, expect, it } from 'vitest';
import {
  RENDER_FORMAT,
  invoiceRows,
  renderCsv,
  renderInvoice,
  renderJson,
  renderText,
} from '../../src/invoice/render.js';
import { invoice } from '../../src/invoice/invoice.js';
import { CHARGE_TYPE, lineItem } from '../../src/invoice/lineItem.js';
import { parseCsvRecords } from '../../src/io/csv.js';
import { ValidationError } from '../../src/core/errors.js';

const record = invoice({
  sequence: 12,
  period: '202403',
  consigneeId: 'DELTA',
  issuedOn: '2024-04-05',
  taxRateBasisPoints: 925,
  lines: [
    lineItem({
      type: CHARGE_TYPE.DEMURRAGE,
      carId: 'BNSF 400123',
      date: '2024-03-07',
      unitAmount: 15000,
      description: 'demurrage day 1',
    }),
    lineItem({ type: CHARGE_TYPE.SWITCHING, unitAmount: 34000, taxable: true }),
  ],
});

describe('invoiceRows', () => {
  it('flattens a line into plain fields', () => {
    const rows = invoiceRows(record);
    expect(rows[0]).toEqual({
      car: 'BNSF 400123',
      date: '2024-03-07',
      type: 'demurrage',
      description: 'demurrage day 1',
      quantity: 1,
      unit: '150.00',
      amount: '150.00',
    });
  });

  it('leaves missing fields blank rather than undefined', () => {
    expect(invoiceRows(record)[1].car).toBe('');
    expect(invoiceRows(record)[1].date).toBe('');
  });
});

describe('renderText', () => {
  const text = renderText(record);

  it('opens with the invoice number', () => {
    expect(text.split('\n')[0]).toBe('Invoice INV-202403-00012');
  });

  it('names the consignee and the dates', () => {
    expect(text).toContain('Consignee DELTA');
    expect(text).toContain('Issued 2024-04-05');
    expect(text).toContain('Due 2024-04-20');
  });

  it('lists every line', () => {
    expect(text).toContain('BNSF 400123');
    expect(text).toContain('demurrage day 1');
    expect(text).toContain('switching');
  });

  it('foots to the total', () => {
    expect(text).toContain('Subtotal');
    expect(text).toContain('Total');
    expect(text).toContain('$521.45');
  });

  it('shows the tax when there is any', () => {
    expect(text).toContain('Tax');
  });

  it('leaves the tax line out when there is none', () => {
    const untaxed = invoice({
      sequence: 1,
      period: '202403',
      consigneeId: 'DELTA',
      issuedOn: '2024-04-05',
      lines: [lineItem({ type: CHARGE_TYPE.DEMURRAGE, unitAmount: 100 })],
    });
    expect(renderText(untaxed)).not.toContain('Tax');
  });

  it('handles an invoice with no lines', () => {
    const empty = invoice({
      sequence: 1,
      period: '202403',
      consigneeId: 'DELTA',
      issuedOn: '2024-04-05',
    });
    expect(renderText(empty)).toContain('Total');
  });
});

describe('renderCsv', () => {
  it('reads back through the CSV reader', () => {
    const rows = parseCsvRecords(renderCsv(record));
    expect(rows).toHaveLength(2);
    expect(rows[0].car).toBe('BNSF 400123');
    expect(rows[0].amount).toBe('150.00');
  });

  it('keeps the columns in a fixed order', () => {
    expect(renderCsv(record).split('\n')[0]).toBe('car,date,type,description,quantity,unit,amount');
  });
});

describe('renderJson', () => {
  const parsed = JSON.parse(renderJson(record));

  it('carries the header and the totals', () => {
    expect(parsed.number).toBe('INV-202403-00012');
    expect(parsed.total).toBe(52145);
    expect(parsed.subtotals).toEqual({ demurrage: 15000, switching: 34000 });
  });

  it('carries the lines whole', () => {
    expect(parsed.lines).toHaveLength(2);
    expect(parsed.lines[0].unitAmount).toBe(15000);
  });
});

describe('renderInvoice', () => {
  it('defaults to text', () => {
    expect(renderInvoice(record)).toBe(renderText(record));
  });

  it('dispatches on the format', () => {
    expect(renderInvoice(record, RENDER_FORMAT.CSV)).toBe(renderCsv(record));
    expect(renderInvoice(record, RENDER_FORMAT.JSON)).toBe(renderJson(record));
  });

  it('refuses a format it does not know', () => {
    expect(() => renderInvoice(record, 'pdf')).toThrow(ValidationError);
  });
});
