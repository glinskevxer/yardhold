import { requireString } from '../core/guards.js';
import { add, formatMoney } from '../core/money.js';
import { toCsv } from '../io/csv.js';

/**
 * The statement.
 *
 * An invoice under an average agreement says one number, and the consignee
 * cannot check one number. The statement is where the detail goes: every car,
 * what it earned, what it cost, and what the offset did. Nobody reads it until
 * the total surprises them, and then it is the only thing they read.
 */

export function statementRows(assessments, ledger = []) {
  const credits = new Map(ledger.map((entry) => [entry.carId, entry]));
  return assessments
    .map((assessment) => {
      const entry = credits.get(assessment.carId);
      return {
        car: assessment.carId,
        page: assessment.pageId,
        detentions: assessment.detentions.length,
        free: assessment.counts.reduce((sum, count) => sum + count.freeUsed, 0),
        chargeable: assessment.chargeableDays,
        credits: entry?.credits ?? 0,
        debits: entry?.debits ?? assessment.chargeableDays,
        gross: assessment.gross,
      };
    })
    .sort((a, b) => (a.car < b.car ? -1 : a.car > b.car ? 1 : 0));
}

export function statement({ period, consigneeId, assessments, ledger = [], settlement } = {}) {
  requireString(period, 'period');
  requireString(consigneeId, 'consigneeId');
  const rows = statementRows(assessments, ledger);
  return {
    period,
    consigneeId: consigneeId.toUpperCase(),
    rows,
    cars: rows.length,
    totalFree: rows.reduce((sum, row) => sum + row.free, 0),
    totalChargeable: rows.reduce((sum, row) => sum + row.chargeable, 0),
    totalCredits: rows.reduce((sum, row) => sum + row.credits, 0),
    totalDebits: rows.reduce((sum, row) => sum + row.debits, 0),
    gross: add(...rows.map((row) => row.gross)),
    settlement,
  };
}

export function statementText(record) {
  const lines = [
    `Statement ${record.consigneeId} ${record.period}`,
    `${record.cars} car(s), ${record.totalFree} free day(s), ${record.totalChargeable} chargeable day(s)`,
    '',
  ];
  for (const row of record.rows) {
    lines.push(
      `  ${row.car.padEnd(12)} ${row.page.padEnd(16)} free ${String(row.free).padStart(2)}  charge ${String(
        row.chargeable
      ).padStart(2)}  ${formatMoney(row.gross).padStart(11)}`
    );
  }
  lines.push('');
  if (record.settlement === undefined) {
    lines.push(`Total ${formatMoney(record.gross)}`);
    return lines.join('\n');
  }
  lines.push(`Credits earned   ${record.settlement.earnedCredits}`);
  lines.push(`Credits opening  ${record.settlement.openingCredits}`);
  lines.push(`Debits           ${record.settlement.debits}`);
  lines.push(`Offset           ${record.settlement.offsetDebits}`);
  lines.push(`Billable days    ${record.settlement.billableDebits}`);
  lines.push(`Carried forward  ${record.settlement.carriedOut}`);
  return lines.join('\n');
}

export function statementCsv(record) {
  return toCsv(record.rows, {
    columns: ['car', 'page', 'detentions', 'free', 'chargeable', 'credits', 'debits', 'gross'],
  });
}
