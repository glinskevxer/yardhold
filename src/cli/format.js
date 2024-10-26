import { requireArray, requireOneOf } from '../core/guards.js';
import { formatMoney } from '../core/money.js';
import { toCsv } from '../io/csv.js';

/**
 * Output for a terminal. The table is deliberately plain: no colour, no box
 * drawing, nothing that survives being pasted into an email badly. Columns are
 * sized to their content and numbers are right aligned so a clerk can add a
 * column by eye.
 */

export const OUTPUT = Object.freeze({
  TABLE: 'table',
  CSV: 'csv',
  JSON: 'json',
});

const OUTPUTS = Object.values(OUTPUT);

export function columnWidths(rows, columns) {
  return columns.map((column) =>
    rows.reduce((width, row) => Math.max(width, String(row[column] ?? '').length), column.length)
  );
}

export function isNumericColumn(rows, column) {
  const values = rows
    .map((row) => row[column])
    .filter((value) => value !== undefined && value !== '');
  return values.length > 0 && values.every((value) => /^-?[\d,.$]+$/.test(String(value)));
}

export function renderTable(rows, columns) {
  requireArray(rows, 'rows');
  if (rows.length === 0) {
    return 'nothing to show';
  }
  const keys = columns ?? [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const widths = columnWidths(rows, keys);
  const numeric = keys.map((key) => isNumericColumn(rows, key));
  const line = (values) =>
    values
      .map((value, index) =>
        numeric[index]
          ? String(value ?? '').padStart(widths[index])
          : String(value ?? '').padEnd(widths[index])
      )
      .join('  ')
      .trimEnd();
  const header = line(keys);
  const rule = widths.map((width) => '-'.repeat(width)).join('  ');
  return [header, rule, ...rows.map((row) => line(keys.map((key) => row[key])))].join('\n');
}

export function renderRows(rows, format = OUTPUT.TABLE, columns) {
  requireOneOf(format, OUTPUTS, 'format');
  if (format === OUTPUT.JSON) {
    return JSON.stringify(rows, null, 2);
  }
  if (format === OUTPUT.CSV) {
    return rows.length === 0 ? '' : toCsv(rows, { columns });
  }
  return renderTable(rows, columns);
}

export function money(cents) {
  return formatMoney(cents);
}

export function plainMoney(cents) {
  return formatMoney(cents, { symbol: '', grouping: false });
}

export function keyValueBlock(record, order) {
  const keys = order ?? Object.keys(record);
  const width = keys.reduce((best, key) => Math.max(best, key.length), 0);
  return keys.map((key) => `${key.padEnd(width)}  ${record[key]}`).join('\n');
}
