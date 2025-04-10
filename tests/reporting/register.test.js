import { describe, expect, it } from 'vitest';
import {
  MARK,
  buildRegister,
  busiestDay,
  registerDays,
  registerRow,
  registerRows,
  registerText,
} from '../../src/reporting/register.js';
import { moneyRows, plainMoneyRows } from '../../src/reporting/rows.js';
import { ValidationError } from '../../src/core/errors.js';

const unit = (label) => ({ label });

const assessment = (
  carId,
  { free = [], charged = [], skipped = [], dropped = [], amount = 0 }
) => ({
  carId,
  consigneeId: 'DELTA',
  chargeableDays: charged.length,
  total: amount,
  counts: [
    {
      free: free.map(unit),
      charged: charged.map((entry) => unit(entry.date)),
      skipped: skipped.map(unit),
      relief: { droppedUnits: dropped },
    },
  ],
  lines: charged.map((entry) => ({ date: entry.date, dayIndex: entry.dayIndex })),
});

const result = {
  period: '202403',
  assessments: [
    assessment('UP 3', {
      free: ['2024-03-05'],
      charged: [
        { date: '2024-03-06', dayIndex: 1 },
        { date: '2024-03-07', dayIndex: 2 },
      ],
      amount: 30000,
    }),
    assessment('BNSF 1', {
      free: ['2024-03-04'],
      skipped: ['2024-03-05'],
      dropped: ['2024-03-06'],
      charged: [{ date: '2024-03-07', dayIndex: 1 }],
      amount: 15000,
    }),
  ],
};

describe('registerDays', () => {
  it('collects every day any car touched, in order', () => {
    expect(registerDays(result)).toEqual(['2024-03-04', '2024-03-05', '2024-03-06', '2024-03-07']);
  });

  it('is empty for a month with nothing in it', () => {
    expect(registerDays({ assessments: [] })).toEqual([]);
  });
});

describe('registerRow', () => {
  const days = registerDays(result);

  it('marks a free day and the ladder position', () => {
    const row = registerRow(result.assessments[0], days);
    expect(row.grid).toBe('.f12');
  });

  it('marks skipped and relieved days apart', () => {
    const row = registerRow(result.assessments[1], days);
    expect(row.grid).toBe('f-r1');
  });

  it('marks a day the car was not there', () => {
    expect(registerRow(result.assessments[0], days).cells[0]).toBe(MARK.ABSENT);
  });

  it('caps the ladder position at a single digit', () => {
    const deep = assessment('A', { charged: [{ date: '2024-03-04', dayIndex: 14 }] });
    expect(registerRow(deep, ['2024-03-04']).grid).toBe('9');
  });
});

describe('buildRegister', () => {
  const register = buildRegister(result);

  it('sorts the rows by car', () => {
    expect(register.rows.map((row) => row.car)).toEqual(['BNSF 1', 'UP 3']);
  });

  it('carries the period and the columns', () => {
    expect(register.period).toBe('202403');
    expect(register.days).toHaveLength(4);
  });

  it('takes an explicit day list', () => {
    const narrow = buildRegister(result, { days: ['2024-03-07'] });
    expect(narrow.rows[0].grid).toBe('1');
  });

  it('refuses a result with no assessments array', () => {
    expect(() => buildRegister({})).toThrow(ValidationError);
  });
});

describe('registerText', () => {
  it('heads with the day numbers', () => {
    const text = registerText(buildRegister(result));
    expect(text.split('\n')[0]).toBe('car     04050607');
  });

  it('lines the grids up under it', () => {
    const text = registerText(buildRegister(result));
    expect(text.split('\n')[1]).toBe('BNSF 1  f-r1');
  });

  it('says so when there is nothing', () => {
    expect(registerText(buildRegister({ period: '202403', assessments: [] }))).toBe(
      'nothing on the track'
    );
  });
});

describe('registerRows', () => {
  it('formats the money plainly', () => {
    const rows = registerRows(buildRegister(result));
    expect(rows[0].amount).toBe('150.00');
    expect(rows[0].car).toBe('BNSF 1');
  });
});

describe('the grid reads as a ladder', () => {
  it('shows a car climbing the rungs', () => {
    const climbing = assessment('A', {
      charged: [
        { date: '2024-03-04', dayIndex: 3 },
        { date: '2024-03-05', dayIndex: 4 },
        { date: '2024-03-06', dayIndex: 5 },
      ],
    });
    expect(registerRow(climbing, ['2024-03-04', '2024-03-05', '2024-03-06']).grid).toBe('345');
  });

  it('shows a car that never went over free time', () => {
    const quick = assessment('B', { free: ['2024-03-04', '2024-03-05'] });
    expect(registerRow(quick, ['2024-03-04', '2024-03-05', '2024-03-06']).grid).toBe('ff.');
  });

  it('shows a car relieved for its whole stand', () => {
    const relieved = assessment('C', { dropped: ['2024-03-04', '2024-03-05'] });
    expect(registerRow(relieved, ['2024-03-04', '2024-03-05']).grid).toBe('rr');
  });
});

describe('busiestDay', () => {
  it('finds the day with the most cars on the ground', () => {
    expect(busiestDay(buildRegister(result))).toBe('2024-03-05');
  });

  it('breaks a tie on the earlier day', () => {
    const register = buildRegister(result);
    const counts = register.days.map(
      (day, index) => register.rows.filter((row) => row.cells[index] !== MARK.ABSENT).length
    );
    expect(counts).toEqual([1, 2, 2, 2]);
  });

  it('has nothing to report for an empty register', () => {
    expect(busiestDay(buildRegister({ period: '202403', assessments: [] }))).toBeUndefined();
  });
});

describe('the row helpers', () => {
  it('formats only the columns it was told about', () => {
    const rows = plainMoneyRows([{ car: 'BNSF 1', amount: 15000, days: 2 }], ['amount']);
    expect(rows[0]).toEqual({ car: 'BNSF 1', amount: '150.00', days: 2 });
  });

  it('leaves a column that is not a number alone', () => {
    expect(plainMoneyRows([{ amount: 'n/a' }], ['amount'])[0].amount).toBe('n/a');
  });

  it('has a form with the symbol and the grouping', () => {
    expect(moneyRows([{ amount: 127525 }], ['amount'])[0].amount).toBe('$1,275.25');
  });

  it('copies rather than mutating', () => {
    const row = { amount: 15000 };
    plainMoneyRows([row], ['amount']);
    expect(row.amount).toBe(15000);
  });
});
