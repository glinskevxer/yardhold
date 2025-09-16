import { ValidationError } from '../../core/errors.js';
import { requireArray, requireString } from '../../core/guards.js';
import { ingestCsv } from '../../io/ingestEvents.js';
import { assessMonth } from '../../assessment/runMonth.js';
import {
  DIRECTION,
  bestMonth,
  direction,
  movements,
  movingAverage,
  periodSeries,
  trendRows,
  worstMonth,
} from '../../reporting/trend.js';
import { OUTPUT, keyValueBlock, plainMoney, renderRows } from '../format.js';
import { commandContext, readTextFile } from '../context.js';

/**
 * spurtally history
 *
 * Several months at once. Everything else in this program answers a question
 * about one billing period, and the question an office actually asks at the end
 * of a quarter is whether it is getting worse.
 *
 * The trend module has been here since the beginning with no way to feed it,
 * because every command takes exactly one event file. This takes a month per
 * `--month`, which is ugly on the command line and is the honest shape: the
 * feeds arrive one per month and there is nothing to gain by pretending they
 * are one file.
 *
 * The figure to read is the charge per car, not the charge. A month can be
 * expensive because the plant was slow or because the plant was busy, and those
 * two want opposite answers.
 */

export function parseMonth(text) {
  const value = requireString(text, 'month');
  const at = value.indexOf(':');
  if (at < 1) {
    throw new ValidationError('a month is written PERIOD:PATH', { month: text });
  }
  const period = value.slice(0, at).trim();
  const path = value.slice(at + 1).trim();
  if (!/^\d{4}(0[1-9]|1[0-2])$/.test(period)) {
    throw new ValidationError('a month period is written YYYYMM', { month: text });
  }
  if (path === '') {
    throw new ValidationError('a month has to name an event file', { month: text });
  }
  return { period, path };
}

export function parseMonths(values) {
  const months = requireArray(values, 'months', { minLength: 1 }).map(parseMonth);
  const seen = new Set();
  for (const month of months) {
    if (seen.has(month.period)) {
      throw new ValidationError('the same period was given twice', { period: month.period });
    }
    seen.add(month.period);
  }
  return months.sort((a, b) => (a.period < b.period ? -1 : 1));
}

export function runMonths(world, months, { carrier }, deps = {}) {
  const byPeriod = new Map();
  const results = new Map();
  for (const month of months) {
    const feed = ingestCsv(readTextFile(month.path, deps), {
      offsetMinutes: world.settings.offsetMinutes,
    });
    const result = assessMonth(world, feed.events, { period: month.period, carrier });
    byPeriod.set(month.period, result.assessments);
    results.set(month.period, result);
  }
  return { byPeriod, results };
}

export function historyBody(series, { output = OUTPUT.TABLE, field = 'gross', window } = {}) {
  const rows = trendRows(series);
  const steps = movements(series, field);
  const heading = direction(series, field);
  if (output === OUTPUT.JSON) {
    return JSON.stringify(
      {
        months: series.length,
        direction: heading,
        best: bestMonth(series, field)?.period,
        worst: worstMonth(series, field)?.period,
        movements: steps,
        rows: series,
      },
      null,
      2
    );
  }
  if (output === OUTPUT.CSV) {
    return renderRows(rows, OUTPUT.CSV, ['period', 'cars', 'days', 'gross', 'perCar']);
  }
  if (series.length === 0) {
    return 'no months to compare';
  }
  const table = rows.map((row) => ({
    ...row,
    gross: plainMoney(row.gross),
    perCar: plainMoney(row.perCar),
  }));
  const lines = [renderRows(table, OUTPUT.TABLE, ['period', 'cars', 'days', 'gross', 'perCar'])];
  if (steps.length > 0) {
    lines.push('');
    lines.push('month on month');
    for (const step of steps) {
      const percent = step.percent === null ? 'from nothing' : `${step.percent}%`;
      lines.push(`  ${step.from} to ${step.to}  ${plainMoney(step.delta)}  ${percent}`);
    }
  }
  if (window !== undefined && series.length >= window) {
    lines.push('');
    lines.push(`${window} month average`);
    for (const point of movingAverage(series, field, window)) {
      lines.push(`  ${point.period}  ${plainMoney(point.average)}`);
    }
  }
  lines.push('');
  lines.push(
    keyValueBlock({
      months: series.length,
      direction: heading === DIRECTION.FLAT ? 'flat' : heading,
      dearest: worstMonth(series, field)?.period ?? '',
      cheapest: bestMonth(series, field)?.period ?? '',
    })
  );
  return lines.join('\n');
}

export function runHistory(options, deps = {}) {
  const months = parseMonths(options.month ?? []);
  const context = commandContext({ ...options, period: months[0].period }, deps);
  const { byPeriod, results } = runMonths(
    context.world,
    months,
    { carrier: options.carrier },
    deps
  );
  const series = periodSeries(byPeriod);
  return {
    text: historyBody(series, {
      output: context.output,
      field: options.field ?? 'gross',
      window: options.window === undefined ? undefined : Number(options.window),
    }),
    series,
    results,
  };
}
