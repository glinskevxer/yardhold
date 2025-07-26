import { describe, expect, it } from 'vitest';
import { explainSelection, tariffBook, tariffFiling } from '../../src/tariff/tariffBook.js';
import { SERVICE } from '../../src/tariff/freeTimeTable.js';
import { rateForDay } from '../../src/tariff/rateLadder.js';
import { NotFoundError, ValidationError } from '../../src/core/errors.js';

const amendmentsFor = (register, on) => register.amendmentsOn({ carrier: 'BNSF', on });

const page = (id, rate) => ({
  id,
  carrier: 'BNSF',
  ladder: [{ fromDay: 1, rate }],
  freeTime: [{ service: SERVICE.UNLOADING, days: 1 }],
});

const book = tariffBook([
  { page: page('DEM-4000', '150.00'), effectiveFrom: '2024-01-01' },
  { page: page('DEM-4100', '175.00'), effectiveFrom: '2024-07-01' },
  { page: page('STA-412300', '120.00'), effectiveFrom: '2024-01-01', splc: '412300' },
  {
    page: page('CON-DELTA', '95.00'),
    effectiveFrom: '2024-01-01',
    consigneeId: 'delta',
  },
  {
    page: page('CTR-77', '80.00'),
    effectiveFrom: '2024-01-01',
    contractId: 'C-77',
  },
]);

describe('tariffFiling', () => {
  it('works out its own scope and weight', () => {
    expect(tariffFiling({ page: page('A', '1.00'), effectiveFrom: '2024-01-01' }).scope).toBe(
      'carrier'
    );
    expect(
      tariffFiling({ page: page('A', '1.00'), effectiveFrom: '2024-01-01', splc: '412300' }).scope
    ).toBe('station');
    expect(
      tariffFiling({ page: page('A', '1.00'), effectiveFrom: '2024-01-01', contractId: 'C-1' })
        .weight
    ).toBe(4);
  });

  it('uppercases the consignee', () => {
    const filing = tariffFiling({
      page: page('A', '1.00'),
      effectiveFrom: '2024-01-01',
      consigneeId: 'delta',
    });
    expect(filing.consigneeId).toBe('DELTA');
  });

  it('refuses a filing that expires before it takes effect', () => {
    expect(() =>
      tariffFiling({
        page: page('A', '1.00'),
        effectiveFrom: '2024-07-01',
        effectiveTo: '2024-01-01',
      })
    ).toThrow(ValidationError);
  });
});

describe('resolving a page', () => {
  it('takes the general page when nothing else fits', () => {
    expect(book.resolve({ carrier: 'BNSF', on: '2024-03-01' }).id).toBe('DEM-4000');
  });

  it('reads the page in force on the day the car was placed', () => {
    expect(book.resolve({ carrier: 'BNSF', on: '2024-06-30' }).id).toBe('DEM-4000');
    expect(book.resolve({ carrier: 'BNSF', on: '2024-07-01' }).id).toBe('DEM-4100');
  });

  it('prefers a station filing over a general one', () => {
    expect(book.resolve({ carrier: 'BNSF', splc: '412300', on: '2024-08-01' }).id).toBe(
      'STA-412300'
    );
  });

  it('prefers a consignee filing over a station one', () => {
    const found = book.resolve({
      carrier: 'BNSF',
      splc: '412300',
      consigneeId: 'DELTA',
      on: '2024-08-01',
    });
    expect(found.id).toBe('CON-DELTA');
  });

  it('lets a contract beat everything', () => {
    const found = book.resolve({
      carrier: 'BNSF',
      splc: '412300',
      consigneeId: 'DELTA',
      contractId: 'C-77',
      on: '2024-08-01',
    });
    expect(found.id).toBe('CTR-77');
  });

  it('is case insensitive about the carrier and the consignee', () => {
    expect(book.resolve({ carrier: 'bnsf', consigneeId: 'Delta', on: '2024-03-01' }).id).toBe(
      'CON-DELTA'
    );
  });

  it('throws when nothing is on file that early', () => {
    expect(() => book.resolve({ carrier: 'BNSF', on: '2023-12-31' })).toThrow(NotFoundError);
    expect(book.find({ carrier: 'BNSF', on: '2023-12-31' })).toBeUndefined();
  });

  it('throws for a carrier it has never heard of', () => {
    expect(() => book.resolve({ carrier: 'CSXT', on: '2024-03-01' })).toThrow(NotFoundError);
  });

  it('insists on a date', () => {
    expect(() => book.find({ carrier: 'BNSF' })).toThrow(/day the car was placed/);
  });
});

describe('the book itself', () => {
  it('counts and lists what it holds', () => {
    expect(book.size).toBe(5);
    expect(book.pageIds()).toEqual(['CON-DELTA', 'CTR-77', 'DEM-4000', 'DEM-4100', 'STA-412300']);
  });

  it('returns every candidate in precedence order', () => {
    const candidates = book.filingsFor({
      carrier: 'BNSF',
      splc: '412300',
      consigneeId: 'DELTA',
      on: '2024-08-01',
    });
    expect(candidates.map((filing) => filing.page.id)).toEqual([
      'CON-DELTA',
      'STA-412300',
      'DEM-4100',
      'DEM-4000',
    ]);
  });
});

describe('supplements laid over the filed page', () => {
  const amended = tariffBook(
    [{ page: page('DEM-4000', '150.00'), effectiveFrom: '2024-01-01' }],
    [
      {
        number: 'SUPP-3',
        pageId: 'DEM-4000',
        amends: 'ladder',
        effectiveFrom: '2024-03-01',
        ladder: [{ fromDay: 1, rate: '200.00' }],
      },
      {
        number: 'SUPP-5',
        pageId: 'DEM-4000',
        amends: 'ladder',
        effectiveFrom: '2024-06-01',
        ladder: [{ fromDay: 1, rate: '150.00' }],
      },
    ]
  );

  it('resolves the original before the first supplement', () => {
    expect(rateForDay(amended.resolve({ carrier: 'BNSF', on: '2024-02-01' }).ladder, 1)).toBe(
      15000
    );
    expect(amended.amendmentsOn({ carrier: 'BNSF', on: '2024-02-01' })).toEqual([]);
  });

  it('resolves the amended page once one is in force', () => {
    expect(rateForDay(amended.resolve({ carrier: 'BNSF', on: '2024-04-01' }).ladder, 1)).toBe(
      20000
    );
    expect(amendmentsFor(amended, '2024-04-01')).toEqual(['SUPP-3']);
  });

  it('applies them in order rather than taking the latest', () => {
    expect(rateForDay(amended.resolve({ carrier: 'BNSF', on: '2024-07-01' }).ladder, 1)).toBe(
      15000
    );
    expect(amendmentsFor(amended, '2024-07-01')).toEqual(['SUPP-3', 'SUPP-5']);
  });

  it('leaves the filed page untouched', () => {
    const filing = amended.find({ carrier: 'BNSF', on: '2024-07-01' });
    expect(rateForDay(filing.page.ladder, 1)).toBe(15000);
  });

  it('lists what it holds', () => {
    expect(amended.supplements()).toHaveLength(2);
    expect(book.supplements()).toEqual([]);
  });

  it('has no amendments for a carrier it cannot resolve', () => {
    expect(amended.amendmentsOn({ carrier: 'CSXT', on: '2024-07-01' })).toEqual([]);
  });
});

describe('explainSelection', () => {
  it('says which filing won and why', () => {
    const filing = book.find({ carrier: 'BNSF', splc: '412300', on: '2024-08-01' });
    expect(explainSelection(filing)).toBe(
      'STA-412300 filed against station 412300 from 2024-01-01'
    );
  });

  it('says so when nothing is on file', () => {
    expect(explainSelection(undefined)).toBe('no page on file');
  });
});
