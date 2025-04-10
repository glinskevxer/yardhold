import { ValidationError } from '../../core/errors.js';
import { requireOneOf } from '../../core/guards.js';

import { exceptionReport, exceptionRows } from '../../reporting/exceptions.js';
import { assessmentKpis, reliefKpis } from '../../reporting/kpi.js';
import { dwellSummary, fromDetentions, toDays } from '../../reporting/dwell.js';
import { buildRegister, registerRows, registerText } from '../../reporting/register.js';
import { OUTPUT, keyValueBlock, plainMoney, renderRows } from '../format.js';
import { loadRun } from '../context.js';

/**
 * spurtally report
 *
 * Three reports behind one command because they are read together at month end
 * and nobody wants three invocations. Which one runs is an argument rather than
 * a subcommand, since they take exactly the same inputs.
 */

export const REPORT = Object.freeze({
  EXCEPTIONS: 'exceptions',
  KPI: 'kpi',
  DWELL: 'dwell',
  REGISTER: 'register',
});

const REPORTS = Object.values(REPORT);

export function exceptionsBody(result, output) {
  const rows = exceptionRows(exceptionReport(result));
  if (rows.length === 0 && output === OUTPUT.TABLE) {
    return 'no exceptions';
  }
  return renderRows(rows, output, ['kind', 'car', 'detail']);
}

export function kpiBody(result, output) {
  const kpis = assessmentKpis(result.assessments);
  const relief = reliefKpis(result.assessments);
  if (output === OUTPUT.JSON) {
    return JSON.stringify({ period: result.period, ...kpis, relief }, null, 2);
  }
  const rows = {
    period: result.period,
    cars: kpis.cars,
    'cars with a clock': kpis.carsWithAClock,
    'cars over free time': kpis.carsOverFreeTime,
    'over free time share': `${Math.round(kpis.overFreeTimeShare * 1000) / 10}%`,
    'chargeable days': kpis.chargeableDays,
    'free days': kpis.freeDays,
    respots: kpis.respots,
    'relief applied': relief.applied,
    'relief declined': relief.declined,
    gross: plainMoney(kpis.gross),
  };
  if (output === OUTPUT.CSV) {
    return renderRows([rows], OUTPUT.CSV);
  }
  return keyValueBlock(rows);
}

export function dwellBody(result, output) {
  const rows = result.assessments.map((assessment) =>
    fromDetentions(assessment.carId, assessment.detentions, {
      arrivedAt: assessment.firstEventAt,
    })
  );
  const summary = dwellSummary(rows);
  if (output === OUTPUT.JSON) {
    return JSON.stringify({ period: result.period, rows, summary }, null, 2);
  }
  const table = rows.map((row) => ({
    car: row.carId,
    yard: toDays(row.yardMinutes) ?? '',
    plant: toDays(row.plantMinutes) ?? '',
    total: toDays(row.totalMinutes) ?? '',
  }));
  return renderRows(table, output, ['car', 'yard', 'plant', 'total']);
}

export function registerBody(result, output) {
  const register = buildRegister(result);
  if (output === OUTPUT.JSON) {
    return JSON.stringify(
      { period: register.period, days: register.days, rows: register.rows },
      null,
      2
    );
  }
  if (output === OUTPUT.CSV) {
    return renderRows(registerRows(register), OUTPUT.CSV, [
      'car',
      'consignee',
      'grid',
      'chargeable',
      'amount',
    ]);
  }
  return registerText(register);
}

export function reportBody(kind, result, output) {
  requireOneOf(kind, REPORTS, 'report');
  if (kind === REPORT.EXCEPTIONS) {
    return exceptionsBody(result, output);
  }
  if (kind === REPORT.KPI) {
    return kpiBody(result, output);
  }
  if (kind === REPORT.REGISTER) {
    return registerBody(result, output);
  }
  return dwellBody(result, output);
}

export function runReport(options, deps = {}) {
  const kind = options.report ?? REPORT.EXCEPTIONS;
  if (!REPORTS.includes(kind)) {
    throw new ValidationError(`report has to be one of ${REPORTS.join(', ')}`, { report: kind });
  }
  const { context, result } = loadRun(options, deps);
  return { text: reportBody(kind, result, context.output), result };
}
