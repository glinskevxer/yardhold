import { describe, expect, it } from 'vitest';
import { parseCsv, parseCsvRecords, toCsv } from '../../src/io/csv.js';
import { IngestError, ValidationError } from '../../src/core/errors.js';

describe('parseCsv', () => {
  it('splits plain rows', () => {
    expect(parseCsv('a,b\n1,2\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('trims fields by default', () => {
    expect(parseCsv(' a , b ')).toEqual([['a', 'b']]);
    expect(parseCsv(' a , b ', { trim: false })).toEqual([[' a ', ' b ']]);
  });

  it('reads quoted fields with commas and newlines', () => {
    expect(parseCsv('a,"b,c"\n')).toEqual([['a', 'b,c']]);
    expect(parseCsv('a,"line\nbreak"\n')).toEqual([['a', 'line\nbreak']]);
  });

  it('reads a doubled quote as one quote', () => {
    expect(parseCsv('a,"say ""hi"""')).toEqual([['a', 'say "hi"']]);
  });

  it('handles carriage returns', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('drops blank lines', () => {
    expect(parseCsv('a,b\n\n1,2\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('keeps an empty trailing field', () => {
    expect(parseCsv('a,')).toEqual([['a', '']]);
  });

  it('takes another delimiter', () => {
    expect(parseCsv('a|b', { delimiter: '|' })).toEqual([['a', 'b']]);
  });

  it('refuses a file that ends inside a quote', () => {
    expect(() => parseCsv('a,"open')).toThrow(IngestError);
  });

  it('refuses a non string', () => {
    expect(() => parseCsv(null)).toThrow(ValidationError);
  });

  it('returns nothing for an empty file', () => {
    expect(parseCsv('')).toEqual([]);
  });
});

describe('parseCsvRecords', () => {
  it('keys each row by the header', () => {
    const records = parseCsvRecords('car,code\nBNSF 400123,AP\n');
    expect(records).toEqual([{ car: 'BNSF 400123', code: 'AP' }]);
  });

  it('refuses a ragged row and names the line', () => {
    try {
      parseCsvRecords('car,code\nBNSF 400123\n');
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(IngestError);
      expect(error.details.line).toBe(2);
      expect(error.details.expected).toBe(2);
      expect(error.details.found).toBe(1);
    }
  });

  it('returns nothing for an empty file', () => {
    expect(parseCsvRecords('')).toEqual([]);
  });

  it('returns nothing for a header with no rows', () => {
    expect(parseCsvRecords('car,code\n')).toEqual([]);
  });
});

describe('toCsv', () => {
  it('writes the union of the keys in order', () => {
    expect(toCsv([{ b: 2, a: 1 }, { c: 3 }])).toBe('a,b,c\n1,2,\n,,3\n');
  });

  it('takes an explicit column order', () => {
    expect(toCsv([{ a: 1, b: 2 }], { columns: ['b', 'a'] })).toBe('b,a\n2,1\n');
  });

  it('quotes what needs quoting', () => {
    expect(toCsv([{ a: 'x,y' }])).toBe('a\n"x,y"\n');
    expect(toCsv([{ a: 'say "hi"' }])).toBe('a\n"say ""hi"""\n');
  });

  it('round trips through the reader', () => {
    const records = [{ car: 'BNSF 400123', note: 'held, per consignee' }];
    expect(parseCsvRecords(toCsv(records))).toEqual(records);
  });

  it('refuses a non array', () => {
    expect(() => toCsv('nope')).toThrow(ValidationError);
  });
});
