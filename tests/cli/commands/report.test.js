import { describe, expect, it } from 'vitest';
import {
  REPORT,
  dwellBody,
  exceptionsBody,
  kpiBody,
  reportBody,
  runReport,
} from '../../../src/cli/commands/report.js';
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
  'BNSF 400123,ARR,2024-03-03T20:00,',
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

const { result } = runReport(options, { readFile });

describe('exceptionsBody', () => {
  it('lists the car it could not assess', () => {
    const text = exceptionsBody(result, OUTPUT.TABLE);
    expect(text).toContain('not-assessed');
    expect(text).toContain('UP 3');
  });

  it('says so when there is nothing', () => {
    expect(exceptionsBody({ assessments: [], skipped: [] }, OUTPUT.TABLE)).toBe('no exceptions');
  });

  it('writes an empty CSV rather than a message', () => {
    expect(exceptionsBody({ assessments: [], skipped: [] }, OUTPUT.CSV)).toBe('');
  });
});

describe('kpiBody', () => {
  it('lays the figures out as a block', () => {
    const text = kpiBody(result, OUTPUT.TABLE);
    expect(text).toContain('cars');
    expect(text).toContain('over free time share');
    expect(text).toContain('gross');
  });

  it('writes JSON with the relief figures folded in', () => {
    const parsed = JSON.parse(kpiBody(result, OUTPUT.JSON));
    expect(parsed.period).toBe('202403');
    expect(parsed.relief.applied).toBe(0);
    expect(parsed.chargeableDays).toBe(3);
  });

  it('writes a single CSV row', () => {
    const csv = kpiBody(result, OUTPUT.CSV);
    expect(csv.trim().split('\n')).toHaveLength(2);
  });
});

describe('dwellBody', () => {
  it('reports a row per car in days', () => {
    const text = dwellBody(result, OUTPUT.TABLE);
    expect(text).toContain('BNSF 400123');
    expect(text).toContain('plant');
  });

  it('carries the summary in the JSON', () => {
    const parsed = JSON.parse(dwellBody(result, OUTPUT.JSON));
    expect(parsed.summary.plantMinutes.cars).toBe(1);
    expect(parsed.rows).toHaveLength(1);
  });

  it('measures the yard time from the arrival', () => {
    const parsed = JSON.parse(dwellBody(result, OUTPUT.JSON));
    expect(parsed.rows[0].yardMinutes).toBe(240);
  });
});

describe('reportBody', () => {
  it('dispatches on the kind', () => {
    expect(reportBody(REPORT.EXCEPTIONS, result, OUTPUT.TABLE)).toContain('not-assessed');
    expect(reportBody(REPORT.KPI, result, OUTPUT.TABLE)).toContain('respots');
    expect(reportBody(REPORT.DWELL, result, OUTPUT.TABLE)).toContain('yard');
  });

  it('refuses a kind it does not have', () => {
    expect(() => reportBody('weather', result, OUTPUT.TABLE)).toThrow(ValidationError);
  });
});

describe('runReport', () => {
  it('defaults to the exceptions', () => {
    expect(runReport(options, { readFile }).text).toContain('not-assessed');
  });

  it('takes the kind from the options', () => {
    expect(runReport({ ...options, report: 'kpi' }, { readFile }).text).toContain('gross');
  });

  it('refuses a kind it does not have before doing the work', () => {
    expect(() => runReport({ ...options, report: 'weather' }, { readFile })).toThrow(
      /exceptions, kpi or dwell/
    );
  });
});
