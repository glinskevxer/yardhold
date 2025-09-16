import { describe, expect, it } from 'vitest';
import {
  historyBody,
  parseMonth,
  parseMonths,
  runHistory,
  runMonths,
} from '../../../src/cli/commands/history.js';
import { loadConfig } from '../../../src/config/loadConfig.js';
import { periodSeries } from '../../../src/reporting/trend.js';
import { OUTPUT } from '../../../src/cli/format.js';
import { makeReadFile, sampleDocument } from '../../fixtures/world.js';
import { ValidationError } from '../../../src/core/errors.js';

const document = sampleDocument();

const monthFeed = (day, released) =>
  [
    'car,event,event_time,track',
    `BNSF 400123,AP,${day}T00:00,IT-9`,
    `BNSF 400123,REL,${released}T00:00,IT-9`,
    '',
  ].join('\n');

const readFile = makeReadFile({
  document,
  extra: {
    'jan.csv': monthFeed('2024-01-04', '2024-01-07'),
    'feb.csv': monthFeed('2024-02-04', '2024-02-09'),
    'mar.csv': monthFeed('2024-03-04', '2024-03-12'),
  },
});

const options = {
  config: 'world.json',
  carrier: 'BNSF',
  month: ['202401:jan.csv', '202402:feb.csv', '202403:mar.csv'],
};

describe('parseMonth', () => {
  it('splits the period from the path', () => {
    expect(parseMonth('202403:march.csv')).toEqual({ period: '202403', path: 'march.csv' });
  });

  it('keeps a colon in the path', () => {
    expect(parseMonth('202403:C:/feeds/march.csv').path).toBe('C:/feeds/march.csv');
  });

  it('trims either side', () => {
    expect(parseMonth('202403: march.csv ')).toEqual({ period: '202403', path: 'march.csv' });
  });

  it('refuses a value with no colon', () => {
    expect(() => parseMonth('202403')).toThrow(/PERIOD:PATH/);
  });

  it('refuses a period that is not a real month', () => {
    expect(() => parseMonth('202413:march.csv')).toThrow(/YYYYMM/);
    expect(() => parseMonth('2024:march.csv')).toThrow(/YYYYMM/);
  });

  it('refuses a month naming no file', () => {
    expect(() => parseMonth('202403:')).toThrow(/name an event file/);
  });

  it('refuses a leading colon', () => {
    expect(() => parseMonth(':march.csv')).toThrow(/PERIOD:PATH/);
  });
});

describe('parseMonths', () => {
  it('sorts into period order whatever order it was given', () => {
    const months = parseMonths(['202403:c.csv', '202401:a.csv', '202402:b.csv']);
    expect(months.map((entry) => entry.period)).toEqual(['202401', '202402', '202403']);
  });

  it('refuses the same period twice', () => {
    expect(() => parseMonths(['202401:a.csv', '202401:b.csv'])).toThrow(/given twice/);
  });

  it('needs at least one month', () => {
    expect(() => parseMonths([])).toThrow(ValidationError);
  });
});

describe('runMonths', () => {
  const world = loadConfig(document);

  it('assesses each month against the same configuration', () => {
    const { byPeriod, results } = runMonths(
      world,
      parseMonths(options.month),
      { carrier: 'BNSF' },
      { readFile }
    );
    expect([...byPeriod.keys()]).toEqual(['202401', '202402', '202403']);
    expect(results.get('202403').period).toBe('202403');
  });

  it('reads each feed at the offset the world declares', () => {
    const { results } = runMonths(
      world,
      parseMonths(options.month),
      { carrier: 'BNSF' },
      { readFile }
    );
    expect(results.get('202401').assessments).toHaveLength(1);
  });

  it('fails on a feed it cannot read', () => {
    expect(() =>
      runMonths(world, parseMonths(['202401:missing.csv']), { carrier: 'BNSF' }, { readFile })
    ).toThrow(/could not read/);
  });
});

describe('runHistory', () => {
  const { series, text } = runHistory(options, { readFile });

  it('reports a row per month in order', () => {
    expect(series.map((row) => row.period)).toEqual(['202401', '202402', '202403']);
  });

  it('shows the charge climbing as the stands lengthen', () => {
    expect(series[0].gross).toBeLessThan(series[1].gross);
    expect(series[1].gross).toBeLessThan(series[2].gross);
  });

  it('prints the month on month movement', () => {
    expect(text).toContain('month on month');
    expect(text).toContain('202401 to 202402');
  });

  it('names the dearest and the cheapest month', () => {
    expect(text).toMatch(/dearest\s+202403/);
    expect(text).toMatch(/cheapest\s+202401/);
  });

  it('calls three real rises a rise', () => {
    const parsed = JSON.parse(runHistory({ ...options, output: 'json' }, { readFile }).text);
    expect(parsed.direction).toBe('rising');
    expect(parsed.months).toBe(3);
  });

  it('shows a moving average when a window is asked for', () => {
    const wide = runHistory({ ...options, window: '3' }, { readFile });
    expect(wide.text).toContain('3 month average');
  });

  it('leaves the moving average out when the run is too short for it', () => {
    const short = runHistory({ ...options, month: ['202401:jan.csv'], window: '3' }, { readFile });
    expect(short.text).not.toContain('month average');
  });

  it('needs at least one month', () => {
    expect(() => runHistory({ ...options, month: [] }, { readFile })).toThrow(ValidationError);
  });

  it('needs a config it can read', () => {
    expect(() => runHistory({ ...options, config: 'missing.json' }, { readFile })).toThrow(
      /could not read/
    );
  });
});

describe('historyBody', () => {
  const { series } = runHistory(options, { readFile });

  it('writes a CSV in a fixed column order', () => {
    expect(historyBody(series, { output: OUTPUT.CSV }).split('\n')[0]).toBe(
      'period,cars,days,gross,perCar'
    );
  });

  it('carries the movements into the JSON', () => {
    const parsed = JSON.parse(historyBody(series, { output: OUTPUT.JSON }));
    expect(parsed.movements).toHaveLength(2);
    expect(parsed.best).toBe('202401');
    expect(parsed.worst).toBe('202403');
  });

  it('says so when there is nothing to compare', () => {
    expect(historyBody(periodSeries(new Map()))).toBe('no months to compare');
  });

  it('reads another field when asked', () => {
    const parsed = JSON.parse(
      historyBody(series, { output: OUTPUT.JSON, field: 'chargeableDays' })
    );
    expect(parsed.worst).toBe('202403');
  });

  it('reports a movement from nothing rather than an infinite percentage', () => {
    const fromZero = [
      { period: '202401', cars: 0, chargeableDays: 0, gross: 0, perCar: 0 },
      { period: '202402', cars: 1, chargeableDays: 1, gross: 15000, perCar: 15000 },
    ];
    expect(historyBody(fromZero)).toContain('from nothing');
  });
});
