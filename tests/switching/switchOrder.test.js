import { describe, expect, it } from 'vitest';
import {
  SWITCH_KIND,
  SWITCH_REASON,
  billableOrders,
  countByKind,
  describeSwitch,
  isBillable,
  ordersForCar,
  switchOrder,
} from '../../src/switching/switchOrder.js';
import { ValidationError } from '../../src/core/errors.js';

const base = {
  carId: 'bnsf400123',
  kind: SWITCH_KIND.INTRA_PLANT,
  at: '2024-03-07T09:00',
  fromTrackId: 'IT-9',
  toTrackId: 'IT-10',
};

describe('switchOrder', () => {
  it('normalises the car and carries its own id', () => {
    const order = switchOrder(base);
    expect(order.carId).toBe('BNSF 400123');
    expect(order.id).toMatch(/^[0-9a-f]{8}$/);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(switchOrder(base))).toBe(true);
  });

  it('makes an intra plant switch name both tracks', () => {
    expect(() => switchOrder({ ...base, toTrackId: undefined })).toThrow(/both tracks/);
  });

  it('refuses a switch that goes nowhere', () => {
    expect(() => switchOrder({ ...base, toTrackId: 'IT-9' })).toThrow(/same track/);
  });

  it('refuses a kind or a reason it does not know', () => {
    expect(() => switchOrder({ ...base, kind: 'shuffle' })).toThrow(ValidationError);
    expect(() => switchOrder({ ...base, reason: 'because' })).toThrow(ValidationError);
  });

  it('uppercases the consignee', () => {
    expect(switchOrder({ ...base, consigneeId: 'delta' }).consigneeId).toBe('DELTA');
  });

  it('lets a placement stand with one track', () => {
    const order = switchOrder({
      carId: 'BNSF 1',
      kind: SWITCH_KIND.PLACEMENT,
      at: '2024-03-07T09:00',
      toTrackId: 'IT-9',
    });
    expect(order.fromTrackId).toBeUndefined();
  });
});

describe('what is billable', () => {
  it('bills a switch the customer asked for', () => {
    expect(isBillable(switchOrder(base))).toBe(true);
  });

  it('does not bill one the carrier made for itself', () => {
    expect(isBillable(switchOrder({ ...base, reason: SWITCH_REASON.CARRIER_CONVENIENCE }))).toBe(
      false
    );
  });

  it('bills a repeat caused by a refused spot', () => {
    expect(isBillable(switchOrder({ ...base, reason: SWITCH_REASON.REFUSED_SPOT }))).toBe(true);
  });

  it('does not bill a bad order move', () => {
    expect(isBillable(switchOrder({ ...base, reason: SWITCH_REASON.BAD_ORDER }))).toBe(false);
  });

  it('never bills the placement or the pull', () => {
    const placement = switchOrder({
      carId: 'BNSF 1',
      kind: SWITCH_KIND.PLACEMENT,
      at: '2024-03-07T09:00',
      toTrackId: 'IT-9',
    });
    const pull = switchOrder({
      carId: 'BNSF 1',
      kind: SWITCH_KIND.PULL,
      at: '2024-03-09T09:00',
      fromTrackId: 'IT-9',
    });
    expect(isBillable(placement)).toBe(false);
    expect(isBillable(pull)).toBe(false);
  });

  it('does not bill a move that never happened', () => {
    expect(isBillable(switchOrder({ ...base, completed: false }))).toBe(false);
  });
});

describe('working with a set', () => {
  const orders = [
    switchOrder(base),
    switchOrder({ ...base, at: '2024-03-08T09:00', reason: SWITCH_REASON.CARRIER_CONVENIENCE }),
    switchOrder({
      carId: 'GATX 77',
      kind: SWITCH_KIND.RECIPROCAL,
      at: '2024-03-08T11:00',
      fromTrackId: 'IT-9',
      toTrackId: 'INT-1',
    }),
  ];

  it('keeps the billable ones', () => {
    expect(billableOrders(orders)).toHaveLength(2);
  });

  it('slices by car', () => {
    expect(ordersForCar(orders, 'bnsf-400123')).toHaveLength(2);
    expect(ordersForCar(orders, 'UP 1')).toEqual([]);
  });

  it('counts by kind', () => {
    expect(countByKind(orders)).toEqual({ 'intra-plant': 2, reciprocal: 1 });
  });

  it('counts nothing for nothing', () => {
    expect(countByKind([])).toEqual({});
  });
});

describe('describeSwitch', () => {
  it('names the legs when there are two', () => {
    expect(describeSwitch(switchOrder(base))).toBe('BNSF 400123 intra-plant IT-9 to IT-10');
  });

  it('says yard when there is no destination', () => {
    const pull = switchOrder({
      carId: 'BNSF 1',
      kind: SWITCH_KIND.PULL,
      at: '2024-03-09T09:00',
      fromTrackId: 'IT-9',
    });
    expect(describeSwitch(pull)).toBe('BNSF 1 pull IT-9 to yard');
  });

  it('leaves the legs out when there are none', () => {
    const weigh = switchOrder({ carId: 'BNSF 1', kind: SWITCH_KIND.WEIGH, at: '2024-03-09T09:00' });
    expect(describeSwitch(weigh)).toBe('BNSF 1 weigh');
  });
});
