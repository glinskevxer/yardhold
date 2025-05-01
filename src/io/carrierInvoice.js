import { IngestError, isSpurtallyError } from '../core/errors.js';
import { requireArray, requireObject, requireString } from '../core/guards.js';
import { parseMoney } from '../core/money.js';
import { formatCivilDate, parseCivilDate } from '../time/civil.js';
import { normalizeCarId } from '../equipment/reportingMarks.js';
import { parseCsvRecords } from './csv.js';

/**
 * Reading the carrier's own demurrage invoice.
 *
 * This is the document the office is checking against, so it is read as
 * literally as possible: no normalising of amounts, no filling in of dates that
 * were left blank, and every row that cannot be read is kept with its line
 * number rather than dropped. A reconciliation that quietly skipped the rows it
 * could not parse would agree with the carrier about a car neither of us had
 * looked at.
 */

export const CARRIER_COLUMNS = Object.freeze({
  carId: ['car', 'car_id', 'equipment', 'equipment_initial_number'],
  date: ['date', 'charge_date', 'day', 'demurrage_date'],
  days: ['days', 'chargeable_days', 'qty', 'quantity'],
  amount: ['amount', 'charge', 'total', 'net_amount'],
  invoiceNumber: ['invoice', 'invoice_number', 'bill_number'],
  tariff: ['tariff', 'tariff_number', 'item'],
});

function pick(row, names) {
  for (const name of names) {
    const value = row[name];
    if (value !== undefined && String(value).trim() !== '') {
      return String(value).trim();
    }
  }
  return undefined;
}

export function mapCarrierRow(row, { columnMap = CARRIER_COLUMNS } = {}) {
  requireObject(row, 'row');
  const carId = pick(row, columnMap.carId);
  if (carId === undefined) {
    throw new IngestError('the carrier row does not name a car', { row });
  }
  const amount = pick(row, columnMap.amount);
  if (amount === undefined) {
    throw new IngestError('the carrier row carries no amount', { car: carId });
  }
  const date = pick(row, columnMap.date);
  const days = pick(row, columnMap.days);
  return Object.freeze({
    carId: normalizeCarId(carId),
    date: date === undefined ? undefined : formatCivilDate(parseCivilDate(date)),
    days: days === undefined ? undefined : Number(days),
    amount: parseMoney(amount),
    invoiceNumber: pick(row, columnMap.invoiceNumber),
    tariff: pick(row, columnMap.tariff),
  });
}

export function readCarrierRows(rows, options = {}) {
  const lines = [];
  const rejects = [];
  requireArray(rows, 'rows').forEach((row, index) => {
    try {
      lines.push(mapCarrierRow(row, options));
    } catch (error) {
      if (!isSpurtallyError(error)) {
        throw error;
      }
      rejects.push({ line: index + 2, code: error.code, message: error.message, row });
    }
  });
  return { lines, rejects };
}

export function readCarrierInvoice(text, options = {}) {
  const rows = parseCsvRecords(requireString(text, 'text', { allowEmpty: true }));
  const { lines, rejects } = readCarrierRows(rows, options);
  return {
    lines,
    rejects,
    read: rows.length,
    total: lines.reduce((sum, line) => sum + line.amount, 0),
  };
}

export function byCar(result) {
  const totals = new Map();
  for (const line of result.lines) {
    const entry = totals.get(line.carId) ?? { carId: line.carId, amount: 0, days: 0, lines: 0 };
    entry.amount += line.amount;
    entry.days += line.days ?? 0;
    entry.lines += 1;
    totals.set(line.carId, entry);
  }
  return [...totals.values()].sort((a, b) => (a.carId < b.carId ? -1 : 1));
}

export function carsBilled(result) {
  return [...new Set(result.lines.map((line) => line.carId))].sort();
}
