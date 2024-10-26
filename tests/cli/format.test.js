import { describe, expect, it } from 'vitest';
import {
  OUTPUT,
  columnWidths,
  isNumericColumn,
  keyValueBlock,
  money,
  plainMoney,
  renderRows,
  renderTable,
} from '../../src/cli/format.js';
import { parseCsvRecords } from '../../src/io/csv.js';
import { ValidationError } from '../../src/core/errors.js';

const rows = [
  { car: 'BNSF 400123', days: 3, amount: '$525.00' },
  { car: 'UP 3', days: 12, amount: '$1,200.00' },
];

describe('columnWidths', () => {
  it('sizes to the widest of header and content', () => {
    expect(columnWidths(rows, ['car', 'days'])).toEqual([11, 4]);
  });

  it('never goes below the header', () => {
    expect(columnWidths([{ car: 'A' }], ['car'])).toEqual([3]);
  });
});

describe('isNumericColumn', () => {
  it('spots a column of numbers', () => {
    expect(isNumericColumn(rows, 'days')).toBe(true);
    expect(isNumericColumn(rows, 'amount')).toBe(true);
  });

  it('does not call a car id numeric', () => {
    expect(isNumericColumn(rows, 'car')).toBe(false);
  });

  it('is not numeric when there is nothing in it', () => {
    expect(isNumericColumn([{ a: '' }], 'a')).toBe(false);
  });
});

describe('renderTable', () => {
  const table = renderTable(rows);

  it('opens with the headers', () => {
    expect(table.split('\n')[0]).toBe('car          days     amount');
  });

  it('rules under the headers', () => {
    expect(table.split('\n')[1]).toBe('-----------  ----  ---------');
  });

  it('right aligns the numbers', () => {
    expect(table.split('\n')[2]).toBe('BNSF 400123     3    $525.00');
  });

  it('takes an explicit column order', () => {
    expect(renderTable(rows, ['days', 'car']).split('\n')[0]).toBe('days  car');
  });

  it('says so when there is nothing', () => {
    expect(renderTable([])).toBe('nothing to show');
  });

  it('refuses a non array', () => {
    expect(() => renderTable('nope')).toThrow(ValidationError);
  });

  it('leaves a missing field blank', () => {
    expect(renderTable([{ a: 1 }, { a: 2, b: 3 }])).toContain('1');
  });
});

describe('renderRows', () => {
  it('defaults to the table', () => {
    expect(renderRows(rows)).toBe(renderTable(rows));
  });

  it('writes CSV that reads back', () => {
    expect(parseCsvRecords(renderRows(rows, OUTPUT.CSV))).toHaveLength(2);
  });

  it('writes JSON that parses back', () => {
    expect(JSON.parse(renderRows(rows, OUTPUT.JSON))).toEqual(rows);
  });

  it('writes nothing for empty CSV', () => {
    expect(renderRows([], OUTPUT.CSV)).toBe('');
  });

  it('refuses a format it does not know', () => {
    expect(() => renderRows(rows, 'yaml')).toThrow(ValidationError);
  });
});

describe('money helpers', () => {
  it('formats with a symbol and grouping', () => {
    expect(money(127525)).toBe('$1,275.25');
  });

  it('formats plainly for a machine', () => {
    expect(plainMoney(127525)).toBe('1275.25');
  });
});

describe('keyValueBlock', () => {
  it('lines up the keys', () => {
    const block = keyValueBlock({ number: 'INV-1', total: '$10.00' });
    expect(block).toBe('number  INV-1\ntotal   $10.00');
  });

  it('takes an order of its own', () => {
    const block = keyValueBlock({ a: 1, b: 2 }, ['b', 'a']);
    expect(block.split('\n')[0]).toBe('b  2');
  });
});
