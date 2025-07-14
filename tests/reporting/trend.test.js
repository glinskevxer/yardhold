import { describe, expect, it } from 'vitest';
import {
  DIRECTION,
  MINIMUM_RUN,
  bestMonth,
  direction,
  movements,
  movingAverage,
  periodSeries,
  trendRows,
  worstMonth,
} from '../../src/reporting/trend.js';
import { ValidationError } from '../../src/core/errors.js';

const assessment = (carId, chargeableDays, gross) => ({
  carId,
  chargeableDays,
  gross,
  detentions: [{ startsAt: 0 }],
  counts: [{ freeUsed: 1, relief: { applied: [], declined: [] } }],
});

const months = new Map([
  ['202403', [assessment('A', 2, 30000), assessment('B', 0, 0)]],
  ['202401', [assessment('A', 1, 15000), assessment('B', 0, 0)]],
  ['202402', [assessment('A', 2, 22000), assessment('B', 0, 0)]],
]);

describe('periodSeries', () => {
  const series = periodSeries(months);

  it('runs in period order whatever order it was given', () => {
    expect(series.map((row) => row.period)).toEqual(['202401', '202402', '202403']);
  });

  it('carries the figures each month', () => {
    expect(series[0].cars).toBe(2);
    expect(series[0].gross).toBe(15000);
    expect(series[0].chargeableDays).toBe(1);
  });

  it('reports the charge per car and the share over free time', () => {
    expect(series[2].perCar).toBe(15000);
    expect(series[2].overFreeTimeShare).toBe(0.5);
  });

  it('handles an empty run', () => {
    expect(periodSeries(new Map())).toEqual([]);
  });
});

describe('movements', () => {
  const series = periodSeries(months);

  it('reports one movement fewer than there are months', () => {
    expect(movements(series)).toHaveLength(2);
  });

  it('names both ends and the step', () => {
    expect(movements(series)[0]).toEqual({
      from: '202401',
      to: '202402',
      delta: 7000,
      percent: 46.7,
    });
  });

  it('reads another field when asked', () => {
    expect(movements(series, 'cars')[0].delta).toBe(0);
  });

  it('reports null rather than infinity from a zero base', () => {
    const flat = [
      { period: '202401', gross: 0 },
      { period: '202402', gross: 100 },
    ];
    expect(movements(flat)[0].percent).toBeNull();
  });

  it('refuses a non array', () => {
    expect(() => movements('nope')).toThrow(ValidationError);
  });
});

describe('direction', () => {
  const rising = periodSeries(months);

  it('calls three real rises a rise', () => {
    expect(direction(rising)).toBe(DIRECTION.RISING);
  });

  it('calls three real falls a fall', () => {
    const falling = [...rising]
      .reverse()
      .map((row, index) => ({ ...row, period: `20240${index + 1}` }));
    expect(direction(falling)).toBe(DIRECTION.FALLING);
  });

  it('is flat on a run that is too short', () => {
    expect(direction(rising.slice(0, 2))).toBe(DIRECTION.FLAT);
    expect(MINIMUM_RUN).toBe(3);
  });

  it('is flat when a step is not big enough to report', () => {
    const gentle = [
      { period: '202401', gross: 100000 },
      { period: '202402', gross: 101000 },
      { period: '202403', gross: 102000 },
    ];
    expect(direction(gentle)).toBe(DIRECTION.FLAT);
  });

  it('takes a threshold of its own', () => {
    const gentle = [
      { period: '202401', gross: 100000 },
      { period: '202402', gross: 101000 },
      { period: '202403', gross: 102000 },
    ];
    expect(direction(gentle, 'gross', { thresholdPercent: 0.5 })).toBe(DIRECTION.RISING);
  });

  it('is flat on a run that changes its mind', () => {
    const wobble = [
      { period: '202401', gross: 100000 },
      { period: '202402', gross: 200000 },
      { period: '202403', gross: 100000 },
    ];
    expect(direction(wobble)).toBe(DIRECTION.FLAT);
  });

  it('refuses an absurd run length', () => {
    expect(() => direction(rising, 'gross', { run: 1 })).toThrow(ValidationError);
  });
});

describe('the extremes', () => {
  const series = periodSeries(months);

  it('names the dearest and the cheapest month', () => {
    expect(worstMonth(series).period).toBe('202403');
    expect(bestMonth(series).period).toBe('202401');
  });

  it('reads another field when asked', () => {
    expect(worstMonth(series, 'chargeableDays').chargeableDays).toBe(2);
  });

  it('has nothing to name in an empty series', () => {
    expect(worstMonth([])).toBeUndefined();
    expect(bestMonth([])).toBeUndefined();
  });
});

describe('movingAverage', () => {
  const series = periodSeries(months);

  it('reports one point per full window', () => {
    expect(movingAverage(series, 'gross', 3)).toEqual([{ period: '202403', average: 22333 }]);
  });

  it('reports every point at a window of one', () => {
    expect(movingAverage(series, 'gross', 1)).toHaveLength(3);
  });

  it('refuses a window longer than the series', () => {
    expect(() => movingAverage(series, 'gross', 9)).toThrow(/longer than the series/);
  });

  it('handles an empty series', () => {
    expect(movingAverage([], 'gross', 3)).toEqual([]);
  });
});

describe('trendRows', () => {
  it('flattens for a table', () => {
    const rows = trendRows(periodSeries(months));
    expect(Object.keys(rows[0])).toEqual(['period', 'cars', 'days', 'gross', 'perCar']);
  });
});
