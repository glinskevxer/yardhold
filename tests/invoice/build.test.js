import { describe, expect, it } from 'vitest';
import {
  buildInvoice,
  creditMemoLine,
  demurrageLines,
  settledDemurrageLine,
  storageLines,
  switchingLines,
} from '../../src/invoice/build.js';
import { CHARGE_TYPE, linesOfType } from '../../src/invoice/lineItem.js';
import { parseInstant } from '../../src/time/instant.js';
import { ValidationError } from '../../src/core/errors.js';

const assessment = {
  carId: 'BNSF 400123',
  pageId: 'DEM-4000',
  chargeableDays: 2,
  lines: [
    { carId: 'BNSF 400123', date: '2024-03-07', dayIndex: 1, rate: 15000 },
    { carId: 'BNSF 400123', date: '2024-03-08', dayIndex: 2, rate: 22500 },
  ],
};

const storage = {
  carId: 'GATX 77',
  lines: [{ carId: 'GATX 77', date: '2024-03-09', dayIndex: 1, rate: 6000, loadState: 'loaded' }],
};

const switching = {
  lines: [
    {
      kind: 'intra-plant',
      at: parseInstant('2024-03-10T09:00-06:00'),
      cars: ['BNSF 400123', 'GATX 77'],
      carCount: 2,
      billedCars: 1,
      amount: 34000,
    },
  ],
  total: 34000,
};

const base = { sequence: 1, period: '202403', consigneeId: 'DELTA', issuedOn: '2024-04-05' };

describe('demurrageLines', () => {
  it('makes one line per chargeable day', () => {
    const lines = demurrageLines([assessment]);
    expect(lines).toHaveLength(2);
    expect(lines[0].description).toBe('demurrage day 1');
    expect(lines[1].unitAmount).toBe(22500);
  });

  it('carries the page the day was priced under', () => {
    expect(demurrageLines([assessment])[0].reference).toBe('DEM-4000');
  });

  it('makes nothing from nothing', () => {
    expect(demurrageLines([])).toEqual([]);
  });
});

describe('storageLines', () => {
  it('names the load state in the description', () => {
    expect(storageLines([storage])[0].description).toBe('storage day 1 loaded');
  });

  it('stamps the storage type', () => {
    expect(storageLines([storage])[0].type).toBe(CHARGE_TYPE.STORAGE);
  });
});

describe('switchingLines', () => {
  it('counts the cars in the handling', () => {
    expect(switchingLines(switching)[0].description).toBe('intra-plant switch, 2 cars');
  });

  it('says one car in the singular', () => {
    const single = { lines: [{ ...switching.lines[0], carCount: 1 }], total: 34000 };
    expect(switchingLines(single)[0].description).toBe('intra-plant switch, 1 car');
  });

  it('marks switching taxable', () => {
    expect(switchingLines(switching)[0].taxable).toBe(true);
  });

  it('references when the handling happened', () => {
    expect(switchingLines(switching)[0].reference).toBe('2024-03-10T09:00-06:00');
  });
});

describe('an invoice with no average agreement', () => {
  const record = buildInvoice({
    ...base,
    assessments: [assessment],
    storage: [storage],
    switching,
  });

  it('bills every day as its own line', () => {
    expect(linesOfType(record.lines, CHARGE_TYPE.DEMURRAGE)).toHaveLength(2);
  });

  it('adds the storage and the switching', () => {
    expect(linesOfType(record.lines, CHARGE_TYPE.STORAGE)).toHaveLength(1);
    expect(linesOfType(record.lines, CHARGE_TYPE.SWITCHING)).toHaveLength(1);
  });

  it('totals everything', () => {
    expect(record.subtotal).toBe(15000 + 22500 + 6000 + 34000);
  });
});

describe('an invoice under an average agreement', () => {
  const settlement = {
    agreementId: 'AVG-1',
    debits: 6,
    offsetDebits: 4,
    billableDebits: 2,
  };

  it('collapses the demurrage to one line', () => {
    const record = buildInvoice({
      ...base,
      assessments: [assessment],
      settlement,
      averageRate: 15000,
    });
    const demurrage = linesOfType(record.lines, CHARGE_TYPE.DEMURRAGE);
    expect(demurrage).toHaveLength(1);
    expect(demurrage[0].quantity).toBe(2);
    expect(demurrage[0].amount).toBe(30000);
  });

  it('says on the line what was offset', () => {
    const record = buildInvoice({
      ...base,
      assessments: [assessment],
      settlement,
      averageRate: 15000,
    });
    expect(record.lines[0].description).toBe('demurrage on average, 6 days less 4 offset');
  });

  it('bills nothing when the credits covered it all', () => {
    const covered = { ...settlement, offsetDebits: 6, billableDebits: 0 };
    const line = settledDemurrageLine(covered, 15000);
    expect(line.amount).toBe(0);
    expect(line.quantity).toBe(1);
  });

  it('ignores the per day assessment lines entirely', () => {
    const record = buildInvoice({
      ...base,
      assessments: [assessment],
      settlement,
      averageRate: 15000,
    });
    expect(record.lines.some((line) => line.description === 'demurrage day 1')).toBe(false);
  });
});

describe('adjustments and credit memos', () => {
  it('appends the adjustments as given', () => {
    const memo = creditMemoLine(5000, 'goodwill on the March weather', 'CLM-1');
    const record = buildInvoice({ ...base, assessments: [assessment], adjustments: [memo] });
    expect(record.subtotal).toBe(15000 + 22500 - 5000);
  });

  it('always makes a credit negative', () => {
    expect(creditMemoLine(-5000, 'x').amount).toBe(-5000);
    expect(creditMemoLine(5000, 'x').amount).toBe(-5000);
  });

  it('needs a description on a credit memo', () => {
    expect(() => creditMemoLine(5000)).toThrow(ValidationError);
  });
});

describe('validation', () => {
  it('needs a period', () => {
    expect(() => buildInvoice({ ...base, period: undefined })).toThrow(ValidationError);
  });

  it('refuses a non array of assessments', () => {
    expect(() => buildInvoice({ ...base, assessments: 'nope' })).toThrow(ValidationError);
  });

  it('builds an empty invoice happily', () => {
    expect(buildInvoice(base).total).toBe(0);
  });
});
