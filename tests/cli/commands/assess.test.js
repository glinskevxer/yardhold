import { describe, expect, it } from 'vitest';
import {
  assessReport,
  assessRows,
  detailRows,
  runAssess,
  skippedRows,
} from '../../../src/cli/commands/assess.js';
import { OUTPUT } from '../../../src/cli/format.js';
import { SERVICE } from '../../../src/tariff/freeTimeTable.js';
import { ValidationError } from '../../../src/core/errors.js';

const document = {
  settings: { years: [2024] },
  stations: [{ splc: '412300', name: 'Memphis North', carrier: 'BNSF' }],
  tracks: [
    { id: 'IT-9', splc: '412300', name: 'Delta lead', capacityCars: 6, consigneeId: 'DELTA' },
  ],
  parties: [{ id: 'DELTA', name: 'Delta Chemical', noticeAddress: 'a@b.example' }],
  cars: [{ id: 'BNSF 400123', designation: 'XM' }],
  tariffs: [
    {
      page: {
        id: 'DEM-4000',
        carrier: 'BNSF',
        notificationRequired: false,
        ladder: [{ fromDay: 1, rate: '150.00' }],
        freeTime: [{ service: SERVICE.UNLOADING, days: 1 }],
      },
      effectiveFrom: '2024-01-01',
    },
  ],
};

const feed = [
  'car,event,event_time,track',
  'BNSF 400123,AP,2024-03-04T00:00,IT-9',
  'BNSF 400123,REL,2024-03-08T00:00,IT-9',
  'UP 3,AP,2024-03-04T00:00,FOREIGN-1',
  '',
].join('\n');

const readFile = (path) => {
  if (path.endsWith('world.json')) {
    return JSON.stringify(document);
  }
  if (path.endsWith('events.csv')) {
    return feed;
  }
  throw new Error('ENOENT');
};

const options = {
  config: 'world.json',
  events: 'events.csv',
  period: '202403',
  carrier: 'BNSF',
};

describe('runAssess', () => {
  const { result, text, feed: read } = runAssess(options, { readFile });

  it('assesses the car it could place', () => {
    expect(result.assessments).toHaveLength(1);
    expect(result.assessments[0].chargeableDays).toBe(3);
  });

  it('sets aside the car it could not', () => {
    expect(skippedRows(result)).toEqual([{ car: 'UP 3', why: 'no track this office knows' }]);
  });

  it('reads the whole feed', () => {
    expect(read.events).toHaveLength(3);
  });

  it('prints a table by default', () => {
    expect(text).toContain('BNSF 400123');
    expect(text).toContain('total 450.00');
    expect(text).toContain('1 car(s) not assessed');
  });

  it('needs a config it can read', () => {
    expect(() => runAssess({ ...options, config: 'missing.json' }, { readFile })).toThrow(
      /could not read/
    );
  });

  it('needs a period it understands', () => {
    expect(() => runAssess({ ...options, period: 'March' }, { readFile })).toThrow(ValidationError);
  });
});

describe('assessRows', () => {
  const { result } = runAssess(options, { readFile });

  it('gives one row per car', () => {
    expect(assessRows(result)).toEqual([
      {
        car: 'BNSF 400123',
        consignee: 'DELTA',
        page: 'DEM-4000',
        days: 3,
        free: 1,
        relief: 0,
        amount: '450.00',
      },
    ]);
  });

  it('sorts by car', () => {
    const rows = assessRows({
      assessments: [
        { carId: 'UP 3', counts: [], lines: [], total: 0, chargeableDays: 0, pageId: 'X' },
        { carId: 'BNSF 1', counts: [], lines: [], total: 0, chargeableDays: 0, pageId: 'X' },
      ],
    });
    expect(rows.map((row) => row.car)).toEqual(['BNSF 1', 'UP 3']);
  });
});

describe('detailRows', () => {
  const { result } = runAssess(options, { readFile });

  it('gives one row per chargeable day', () => {
    const rows = detailRows(result);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({
      car: 'BNSF 400123',
      date: '2024-03-05',
      day: 1,
      placement: 'actual',
      rate: '150.00',
    });
  });
});

describe('assessReport', () => {
  const { result } = runAssess(options, { readFile });

  it('switches to the detail columns when asked', () => {
    const text = assessReport(result, { detail: true });
    expect(text.split('\n')[0]).toContain('date');
    expect(text.split('\n')[0]).toContain('placement');
  });

  it('writes CSV with no footer', () => {
    const csv = assessReport(result, { output: OUTPUT.CSV });
    expect(csv).not.toContain('total');
    expect(csv.split('\n')[0]).toBe('car,consignee,page,days,free,relief,amount');
  });

  it('wraps the JSON in a header', () => {
    const parsed = JSON.parse(assessReport(result, { output: OUTPUT.JSON }));
    expect(parsed.period).toBe('202403');
    expect(parsed.total).toBe(45000);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.skipped).toHaveLength(1);
  });

  it('leaves the skipped note out when nothing was skipped', () => {
    const text = assessReport({ ...result, skipped: [] });
    expect(text).not.toContain('not assessed');
  });
});
