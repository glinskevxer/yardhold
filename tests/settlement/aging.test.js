import { describe, expect, it } from 'vitest';
import {
  BUCKETS,
  DISPUTED_BUCKET,
  ageDays,
  ageInvoices,
  ageItem,
  agingLines,
  bucketFor,
  bucketTotals,
  pastDue,
  totalOutstanding,
} from '../../src/settlement/aging.js';
import { ValidationError } from '../../src/core/errors.js';

const open = (number, dueOn, total, status = 'issued', consigneeId = 'DELTA') => ({
  number,
  dueOn,
  total,
  status,
  consigneeId,
});

const invoices = [
  open('INV-202401-00001', '2024-02-20', 30000),
  open('INV-202402-00002', '2024-03-20', 10000),
  open('INV-202403-00003', '2024-04-20', 50000),
  open('INV-202404-00004', '2024-05-20', 20000, 'disputed'),
];

const asOf = '2024-05-15';

describe('ageDays', () => {
  it('counts from the due date', () => {
    expect(ageDays(invoices[0], asOf)).toBe(85);
  });

  it('is negative before the due date', () => {
    expect(ageDays(invoices[3], asOf)).toBe(-5);
  });

  it('needs both dates', () => {
    expect(() => ageDays({ dueOn: undefined }, asOf)).toThrow(ValidationError);
    expect(() => ageDays(invoices[0], undefined)).toThrow(ValidationError);
  });
});

describe('bucketFor', () => {
  it('puts anything not yet due in current', () => {
    expect(bucketFor(0)).toBe('current');
    expect(bucketFor(-30)).toBe('current');
  });

  it('walks up the buckets', () => {
    expect(bucketFor(1)).toBe('1-30');
    expect(bucketFor(30)).toBe('1-30');
    expect(bucketFor(31)).toBe('31-60');
    expect(bucketFor(61)).toBe('61-90');
    expect(bucketFor(91)).toBe('over-90');
    expect(bucketFor(900)).toBe('over-90');
  });

  it('covers every day with exactly one bucket', () => {
    expect(BUCKETS).toHaveLength(5);
    for (let day = -5; day < 200; day += 1) {
      expect(BUCKETS.filter((bucket) => day >= bucket.from && day <= bucket.to)).toHaveLength(1);
    }
  });
});

describe('ageItem', () => {
  it('reads the invoice total when no balance is given', () => {
    expect(ageItem(invoices[0], asOf).amount).toBe(30000);
  });

  it('takes an outstanding balance instead', () => {
    expect(ageItem(invoices[0], asOf, { outstanding: 5000 }).amount).toBe(5000);
  });

  it('sends a disputed invoice to its own bucket however old', () => {
    const stale = open('INV-1', '2023-01-01', 100, 'disputed');
    expect(ageItem(stale, asOf).bucket).toBe(DISPUTED_BUCKET);
  });
});

describe('ageInvoices', () => {
  const items = ageInvoices(invoices, asOf);

  it('sorts oldest first', () => {
    expect(items.map((item) => item.number)).toEqual([
      'INV-202401-00001',
      'INV-202402-00002',
      'INV-202403-00003',
      'INV-202404-00004',
    ]);
  });

  it('drops what has been paid', () => {
    const balances = new Map([['INV-202401-00001', 0]]);
    expect(ageInvoices(invoices, asOf, balances)).toHaveLength(3);
  });

  it('ages a part paid invoice on what is left', () => {
    const balances = new Map([['INV-202401-00001', 12000]]);
    expect(ageInvoices(invoices, asOf, balances)[0].amount).toBe(12000);
  });

  it('refuses a non array', () => {
    expect(() => ageInvoices('nope', asOf)).toThrow(ValidationError);
  });
});

describe('bucketTotals', () => {
  const totals = bucketTotals(ageInvoices(invoices, asOf));

  it('reports every bucket even the empty ones', () => {
    expect(Object.keys(totals).sort()).toEqual([
      '1-30',
      '31-60',
      '61-90',
      'current',
      'disputed',
      'over-90',
    ]);
  });

  it('puts each invoice where it belongs', () => {
    expect(totals['1-30']).toBe(50000);
    expect(totals['31-60']).toBe(10000);
    expect(totals['61-90']).toBe(30000);
    expect(totals.disputed).toBe(20000);
    expect(totals.current).toBe(0);
  });

  it('foots to the outstanding total', () => {
    const items = ageInvoices(invoices, asOf);
    const sum = Object.values(totals).reduce((a, b) => a + b, 0);
    expect(sum).toBe(totalOutstanding(items));
  });
});

describe('pastDue', () => {
  it('leaves out what is not yet due and what is disputed', () => {
    const items = ageInvoices(invoices, asOf);
    expect(pastDue(items).map((item) => item.number)).toEqual([
      'INV-202401-00001',
      'INV-202402-00002',
      'INV-202403-00003',
    ]);
  });
});

describe('agingLines', () => {
  it('makes one readable line per item', () => {
    const lines = agingLines(ageInvoices(invoices, asOf));
    expect(lines[0]).toBe('INV-202401-00001  DELTA  61-90  $300.00');
    expect(lines).toHaveLength(4);
  });
});
