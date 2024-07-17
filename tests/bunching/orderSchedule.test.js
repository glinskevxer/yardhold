import { describe, expect, it } from 'vitest';
import { carOrder, driftDays, orderSchedule } from '../../src/bunching/orderSchedule.js';
import { civilDate, formatCivilDate } from '../../src/time/civil.js';
import { ConflictError, ValidationError } from '../../src/core/errors.js';

const rows = [
  { consigneeId: 'delta', splc: '412300', wantedOn: '2024-03-05', cars: 2 },
  { consigneeId: 'DELTA', splc: '412300', wantedOn: '2024-03-04', cars: 2 },
  { consigneeId: 'DELTA', splc: '412300', wantedOn: '2024-03-06', cars: 2 },
  { consigneeId: 'ACME', splc: '412300', wantedOn: '2024-03-04', cars: 5 },
];

describe('carOrder', () => {
  it('uppercases the consignee and parses the day', () => {
    const order = carOrder(rows[0]);
    expect(order.consigneeId).toBe('DELTA');
    expect(formatCivilDate(order.wantedOn)).toBe('2024-03-05');
  });

  it('needs a consignee, a station, a day and a count', () => {
    expect(() => carOrder({ ...rows[0], consigneeId: undefined })).toThrow(ValidationError);
    expect(() => carOrder({ ...rows[0], splc: undefined })).toThrow(ValidationError);
    expect(() => carOrder({ ...rows[0], wantedOn: undefined })).toThrow(ValidationError);
    expect(() => carOrder({ ...rows[0], cars: 0 })).toThrow(ValidationError);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(carOrder(rows[0]))).toBe(true);
  });
});

describe('orderSchedule', () => {
  const schedule = orderSchedule(rows);

  it('sorts by the day the cars were wanted', () => {
    expect(schedule.all().map((order) => formatCivilDate(order.wantedOn))).toEqual([
      '2024-03-04',
      '2024-03-04',
      '2024-03-05',
      '2024-03-06',
    ]);
  });

  it('refuses two orders for the same consignee and day', () => {
    expect(() => orderSchedule([rows[0], rows[0]])).toThrow(ConflictError);
  });

  it('keeps two consignees apart on the same day', () => {
    expect(schedule.forConsignee('DELTA')).toHaveLength(3);
    expect(schedule.forConsignee('acme')).toHaveLength(1);
  });

  it('finds the order for a day', () => {
    expect(schedule.on('DELTA', '2024-03-05').cars).toBe(2);
    expect(schedule.on('DELTA', '2024-03-07')).toBeUndefined();
  });

  it('reports nothing ordered for a day with no order', () => {
    expect(schedule.carsOrderedOn('DELTA', '2024-03-07')).toBe(0);
    expect(schedule.carsOrderedOn('DELTA', '2024-03-05')).toBe(2);
  });

  it('takes a parsed date as well as text', () => {
    expect(schedule.carsOrderedOn('DELTA', civilDate(2024, 3, 6))).toBe(2);
  });
});

describe('windows', () => {
  const schedule = orderSchedule(rows);

  it('collects the orders inside a range', () => {
    expect(schedule.window('DELTA', '2024-03-04', '2024-03-05')).toHaveLength(2);
  });

  it('totals what was asked for', () => {
    expect(schedule.totalOrdered('DELTA', '2024-03-04', '2024-03-06')).toBe(6);
    expect(schedule.totalOrdered('DELTA', '2024-03-07', '2024-03-09')).toBe(0);
  });

  it('refuses a backwards window', () => {
    expect(() => schedule.window('DELTA', '2024-03-06', '2024-03-04')).toThrow(ValidationError);
  });
});

describe('driftDays', () => {
  const order = carOrder(rows[1]);

  it('is zero on the day', () => {
    expect(driftDays(order, '2024-03-04')).toBe(0);
  });

  it('is positive when the car came late', () => {
    expect(driftDays(order, '2024-03-07')).toBe(3);
  });

  it('is negative when the car came early', () => {
    expect(driftDays(order, '2024-03-02')).toBe(-2);
  });
});
