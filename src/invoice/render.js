import { requireOneOf } from '../core/guards.js';
import { formatMoney } from '../core/money.js';
import { toCsv } from '../io/csv.js';

/**
 * Printing an invoice. Three shapes, and each one has a reader: the plain text
 * goes in the envelope, the CSV goes to the consignee's accounts payable, and
 * the JSON goes back to us when they dispute it.
 */

export const RENDER_FORMAT = Object.freeze({
  TEXT: 'text',
  CSV: 'csv',
  JSON: 'json',
});

const FORMATS = Object.values(RENDER_FORMAT);

const COLUMNS = ['car', 'date', 'type', 'description', 'quantity', 'unit', 'amount'];

export function invoiceRows(record) {
  return record.lines.map((line) => ({
    car: line.carId ?? '',
    date: line.date ?? '',
    type: line.type,
    description: line.description,
    quantity: line.quantity,
    unit: formatMoney(line.unitAmount, { symbol: '', grouping: false }),
    amount: formatMoney(line.amount, { symbol: '', grouping: false }),
  }));
}

function pad(text, width) {
  const value = String(text);
  return value.length >= width ? value : value + ' '.repeat(width - value.length);
}

function padLeft(text, width) {
  const value = String(text);
  return value.length >= width ? value : ' '.repeat(width - value.length) + value;
}

export function renderText(record) {
  const header = [
    `Invoice ${record.number}`,
    `Consignee ${record.consigneeId}`,
    `Period ${record.period}   Issued ${record.issuedOn}   Due ${record.dueOn}`,
    '',
  ];
  const rows = invoiceRows(record);
  const widths = {
    car: Math.max(3, ...rows.map((row) => row.car.length)),
    date: 10,
    description: Math.max(11, ...rows.map((row) => row.description.length)),
  };
  const body = rows.map(
    (row) =>
      `${pad(row.car, widths.car)}  ${pad(row.date, widths.date)}  ${pad(
        row.description,
        widths.description
      )}  ${padLeft(row.amount, 12)}`
  );
  const footer = [
    '',
    `${pad('', widths.car + widths.date + widths.description + 4)}Subtotal ${padLeft(
      formatMoney(record.subtotal),
      12
    )}`,
  ];
  if (record.tax !== 0) {
    footer.push(
      `${pad('', widths.car + widths.date + widths.description + 9)}Tax ${padLeft(
        formatMoney(record.tax),
        12
      )}`
    );
  }
  footer.push(
    `${pad('', widths.car + widths.date + widths.description + 7)}Total ${padLeft(
      formatMoney(record.total),
      12
    )}`
  );
  return [...header, ...body, ...footer].join('\n');
}

export function renderCsv(record) {
  return toCsv(invoiceRows(record), { columns: COLUMNS });
}

export function renderJson(record) {
  return JSON.stringify(
    {
      number: record.number,
      period: record.period,
      consigneeId: record.consigneeId,
      issuedOn: record.issuedOn,
      dueOn: record.dueOn,
      status: record.status,
      subtotal: record.subtotal,
      tax: record.tax,
      total: record.total,
      subtotals: record.subtotals,
      lines: record.lines,
    },
    null,
    2
  );
}

export function renderInvoice(record, format = RENDER_FORMAT.TEXT) {
  requireOneOf(format, FORMATS, 'format');
  if (format === RENDER_FORMAT.CSV) {
    return renderCsv(record);
  }
  if (format === RENDER_FORMAT.JSON) {
    return renderJson(record);
  }
  return renderText(record);
}
