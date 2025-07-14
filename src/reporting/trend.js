import { ValidationError } from '../core/errors.js';
import { requireArray, requireInteger } from '../core/guards.js';
import { assessmentKpis } from './kpi.js';

/**
 * A run of months.
 *
 * The number worth watching is not the charge. A month can be expensive because
 * the plant was slow or because the plant was busy, and the two want opposite
 * answers, so the charge per car is reported beside the count and the reader
 * gets to see which of them moved.
 *
 * The trend is deliberately blunt: three points in the same direction, and the
 * step has to be worth reporting. A run of noise reported as a trend is worse
 * than no report, because somebody acts on it.
 */

export const DIRECTION = Object.freeze({
  RISING: 'rising',
  FALLING: 'falling',
  FLAT: 'flat',
});

export const MINIMUM_RUN = 3;

export function periodSeries(monthsByPeriod) {
  const periods = [...monthsByPeriod.keys()].sort();
  return periods.map((period) => {
    const kpis = assessmentKpis(monthsByPeriod.get(period));
    return {
      period,
      cars: kpis.cars,
      chargeableDays: kpis.chargeableDays,
      gross: kpis.gross,
      perCar: kpis.averagePerCar,
      overFreeTimeShare: Math.round(kpis.overFreeTimeShare * 1000) / 1000,
    };
  });
}

export function movements(series, field = 'gross') {
  requireArray(series, 'series');
  return series.slice(1).map((row, index) => {
    const previous = series[index];
    const delta = row[field] - previous[field];
    return {
      from: previous.period,
      to: row.period,
      delta,
      percent: previous[field] === 0 ? null : Math.round((delta / previous[field]) * 1000) / 10,
    };
  });
}

export function direction(
  series,
  field = 'gross',
  { run = MINIMUM_RUN, thresholdPercent = 5 } = {}
) {
  requireInteger(run, 'run', { min: 2, max: 24 });
  if (series.length < run) {
    return DIRECTION.FLAT;
  }
  const steps = movements(series.slice(-run), field);
  if (steps.every((step) => step.delta > 0 && (step.percent ?? 0) >= thresholdPercent)) {
    return DIRECTION.RISING;
  }
  if (steps.every((step) => step.delta < 0 && Math.abs(step.percent ?? 0) >= thresholdPercent)) {
    return DIRECTION.FALLING;
  }
  return DIRECTION.FLAT;
}

export function worstMonth(series, field = 'gross') {
  if (series.length === 0) {
    return undefined;
  }
  return series.reduce((best, row) => (row[field] > best[field] ? row : best));
}

export function bestMonth(series, field = 'gross') {
  if (series.length === 0) {
    return undefined;
  }
  return series.reduce((best, row) => (row[field] < best[field] ? row : best));
}

export function movingAverage(series, field = 'gross', window = 3) {
  requireInteger(window, 'window', { min: 1, max: 24 });
  if (window > series.length && series.length > 0) {
    throw new ValidationError('the window is longer than the series', {
      window,
      length: series.length,
    });
  }
  return series.slice(window - 1).map((row, index) => {
    const slice = series.slice(index, index + window);
    return {
      period: row.period,
      average: Math.round(slice.reduce((sum, entry) => sum + entry[field], 0) / window),
    };
  });
}

export function trendRows(series) {
  return series.map((row) => ({
    period: row.period,
    cars: row.cars,
    days: row.chargeableDays,
    gross: row.gross,
    perCar: row.perCar,
  }));
}
