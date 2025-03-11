import { monthTotal } from '../../assessment/runMonth.js';
import { OUTPUT, plainMoney, renderRows } from '../format.js';
import { loadRun } from '../context.js';

/**
 * spurtally assess
 *
 * One row per car, because that is the unit a consignee argues about. The
 * detail behind a row is the statement's job and lives behind the detail flag,
 * which nobody uses until the first dispute and everybody uses after it.
 */

const COLUMNS = ['car', 'consignee', 'page', 'days', 'free', 'relief', 'amount'];
const DETAIL_COLUMNS = ['car', 'date', 'day', 'placement', 'rate'];

export function assessRows(result) {
  return result.assessments
    .map((assessment) => ({
      car: assessment.carId,
      consignee: assessment.consigneeId ?? '',
      page: assessment.pageId,
      days: assessment.chargeableDays,
      free: assessment.counts.reduce((sum, count) => sum + count.freeUsed, 0),
      relief: assessment.counts.reduce((sum, count) => sum + count.relief.applied.length, 0),
      amount: plainMoney(assessment.total),
    }))
    .sort((a, b) => (a.car < b.car ? -1 : a.car > b.car ? 1 : 0));
}

export function detailRows(result) {
  return result.assessments.flatMap((assessment) =>
    assessment.lines.map((line) => ({
      car: line.carId,
      date: line.date,
      day: line.dayIndex,
      placement: line.placement,
      rate: plainMoney(line.rate),
    }))
  );
}

export function skippedRows(result) {
  return result.skipped.map((entry) => ({ car: entry.carId, why: entry.why }));
}

export function assessReport(result, { output = OUTPUT.TABLE, detail = false } = {}) {
  const rows = detail ? detailRows(result) : assessRows(result);
  const columns = detail ? DETAIL_COLUMNS : COLUMNS;
  if (output === OUTPUT.JSON) {
    return renderRows(
      { period: result.period, total: monthTotal(result), rows, skipped: skippedRows(result) },
      OUTPUT.JSON
    );
  }
  const body = renderRows(rows, output, columns);
  if (output === OUTPUT.CSV) {
    return body;
  }
  const tail = [`total ${plainMoney(monthTotal(result))}`];
  if (result.skipped.length > 0) {
    tail.push(`${result.skipped.length} car(s) not assessed`);
  }
  return [body, '', ...tail].join('\n');
}

export function runAssess(options, deps = {}) {
  const { context, feed, result } = loadRun(options, deps);
  return {
    text: assessReport(result, { output: context.output, detail: options.detail === true }),
    result,
    feed,
  };
}
