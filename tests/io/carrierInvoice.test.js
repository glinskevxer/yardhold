import { describe, expect, it } from 'vitest';
import {
  CARRIER_COLUMNS,
  byCar,
  carsBilled,
  mapCarrierRow,
  readCarrierInvoice,
  readCarrierRows,
} from '../../src/io/carrierInvoice.js';
import { IngestError, ValidationError } from '../../src/core/errors.js';

const csv = [
  'car,charge_date,chargeable_days,amount,invoice_number,tariff_number',
  'BNSF 400123,2024-03-05,1,150.00,D-778120,DEM-4000',
  'BNSF 400123,2024-03-06,1,150.00,D-778120,DEM-4000',
  'GATX 77,2024-03-09,2,450.00,D-778120,DEM-4000',
  '',
].join('\n');

describe('mapCarrierRow', () => {
  it('reads the columns the carrier used', () => {
    const line = mapCarrierRow({
      equipment: 'bnsf400123',
      demurrage_date: '2024-03-05',
      qty: '1',
      net_amount: '$150.00',
    });
    expect(line.carId).toBe('BNSF 400123');
    expect(line.amount).toBe(15000);
    expect(line.days).toBe(1);
  });

  it('normalises the date but leaves the amount as billed', () => {
    const line = mapCarrierRow({ car: 'UP 3', date: '2024-03-05', amount: '1,275.25' });
    expect(line.date).toBe('2024-03-05');
    expect(line.amount).toBe(127525);
  });

  it('leaves out what the row did not carry', () => {
    const line = mapCarrierRow({ car: 'UP 3', amount: '150.00' });
    expect(line.date).toBeUndefined();
    expect(line.days).toBeUndefined();
    expect(line.tariff).toBeUndefined();
  });

  it('names what is missing', () => {
    expect(() => mapCarrierRow({ amount: '150.00' })).toThrow(/does not name a car/);
    expect(() => mapCarrierRow({ car: 'UP 3' })).toThrow(/no amount/);
  });

  it('refuses a row that is not an object', () => {
    expect(() => mapCarrierRow('nope')).toThrow(ValidationError);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(mapCarrierRow({ car: 'UP 3', amount: '1.00' }))).toBe(true);
  });

  it('ships a map with several aliases each', () => {
    expect(CARRIER_COLUMNS.amount.length).toBeGreaterThan(2);
  });
});

describe('readCarrierRows', () => {
  it('keeps the bad rows with their line numbers', () => {
    const { lines, rejects } = readCarrierRows([
      { car: 'UP 3', amount: '150.00' },
      { car: 'UP 4' },
      { amount: '150.00' },
    ]);
    expect(lines).toHaveLength(1);
    expect(rejects.map((entry) => entry.line)).toEqual([3, 4]);
  });

  it('lets a programming error through', () => {
    expect(() =>
      readCarrierRows([{ car: 'UP 3', amount: '150.00' }], {
        columnMap: {
          get carId() {
            throw new TypeError('boom');
          },
        },
      })
    ).toThrow(TypeError);
  });
});

describe('readCarrierInvoice', () => {
  const result = readCarrierInvoice(csv);

  it('reads every row', () => {
    expect(result.read).toBe(3);
    expect(result.lines).toHaveLength(3);
    expect(result.rejects).toEqual([]);
  });

  it('totals what the carrier billed', () => {
    expect(result.total).toBe(75000);
  });

  it('carries the invoice number and the tariff', () => {
    expect(result.lines[0].invoiceNumber).toBe('D-778120');
    expect(result.lines[0].tariff).toBe('DEM-4000');
  });

  it('reads an empty file as nothing', () => {
    expect(readCarrierInvoice('')).toEqual({ lines: [], rejects: [], read: 0, total: 0 });
  });

  it('refuses a ragged file outright', () => {
    expect(() => readCarrierInvoice('car,amount\nUP 3\n')).toThrow(IngestError);
  });

  it('refuses a non string', () => {
    expect(() => readCarrierInvoice(null)).toThrow(ValidationError);
  });
});

describe('summarising', () => {
  const result = readCarrierInvoice(csv);

  it('rolls the lines up per car', () => {
    expect(byCar(result)).toEqual([
      { carId: 'BNSF 400123', amount: 30000, days: 2, lines: 2 },
      { carId: 'GATX 77', amount: 45000, days: 2, lines: 1 },
    ]);
  });

  it('lists the cars once each', () => {
    expect(carsBilled(result)).toEqual(['BNSF 400123', 'GATX 77']);
  });

  it('counts a missing day figure as nothing', () => {
    const partial = readCarrierInvoice('car,amount\nUP 3,150.00\n');
    expect(byCar(partial)[0].days).toBe(0);
  });
});
