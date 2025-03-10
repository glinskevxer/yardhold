import { requireArray, requireString } from '../core/guards.js';
import { plainMoneyRows } from './rows.js';

/**
 * The register.
 *
 * A grid of car against day with one letter per cell, which is how the office
 * kept it before there was software and still how anyone reads it fastest:
 *
 *   .  the car was not here
 *   f  a free day
 *   1  a chargeable day, showing where it sat on the ladder
 *   -  a day that did not count at all
 *   r  a day relieved
 *
 * The ladder position rather than a tick is the point. A row of 5555 says the
 * car has been at the top rate for four days and somebody should go and look.
 */

export const MARK = Object.freeze({
  ABSENT: '.',
  FREE: 'f',
  SKIPPED: '-',
  RELIEVED: 'r',
});

export function registerRow(assessment, days) {
  const free = new Set(assessment.counts.flatMap((count) => count.free.map((unit) => unit.label)));
  const skipped = new Set(
    assessment.counts.flatMap((count) => count.skipped.map((unit) => unit.label))
  );
  const relieved = new Set(assessment.counts.flatMap((count) => count.relief.droppedUnits ?? []));
  const charged = new Map(assessment.lines.map((line) => [line.date, Math.min(9, line.dayIndex)]));
  const cells = days.map((day) => {
    if (charged.has(day)) {
      return String(charged.get(day));
    }
    if (free.has(day)) {
      return MARK.FREE;
    }
    if (relieved.has(day)) {
      return MARK.RELIEVED;
    }
    if (skipped.has(day)) {
      return MARK.SKIPPED;
    }
    return MARK.ABSENT;
  });
  return {
    car: assessment.carId,
    consignee: assessment.consigneeId ?? '',
    grid: cells.join(''),
    cells,
    chargeable: assessment.chargeableDays,
    amount: assessment.total,
  };
}

export function registerDays(result) {
  const labels = new Set();
  for (const assessment of result.assessments) {
    for (const count of assessment.counts) {
      for (const unit of [...count.free, ...count.charged, ...count.skipped]) {
        labels.add(unit.label);
      }
    }
  }
  return [...labels].sort();
}

export function buildRegister(result, { days } = {}) {
  requireArray(result.assessments, 'assessments');
  const columns = days ?? registerDays(result);
  return {
    period: result.period,
    days: columns,
    rows: result.assessments
      .map((assessment) => registerRow(assessment, columns))
      .sort((a, b) => (a.car < b.car ? -1 : a.car > b.car ? 1 : 0)),
  };
}

export function registerText(register) {
  if (register.rows.length === 0) {
    return 'nothing on the track';
  }
  const width = register.rows.reduce((best, row) => Math.max(best, row.car.length), 3);
  const header = `${'car'.padEnd(width)}  ${register.days.map((day) => day.slice(8)).join('')}`;
  const lines = register.rows.map((row) => `${row.car.padEnd(width)}  ${row.grid}`);
  return [header, ...lines].join('\n');
}

export function registerRows(register) {
  return plainMoneyRows(
    register.rows.map((row) => ({
      car: row.car,
      consignee: row.consignee,
      grid: row.grid,
      chargeable: row.chargeable,
      amount: row.amount,
    })),
    ['amount']
  );
}

export function busiestDay(register) {
  let best;
  let bestCount = -1;
  register.days.forEach((day, index) => {
    const count = register.rows.filter((row) => row.cells[index] !== MARK.ABSENT).length;
    if (count > bestCount) {
      bestCount = count;
      best = day;
    }
  });
  return requireString(best ?? '', 'day', { allowEmpty: true }) === '' ? undefined : best;
}
