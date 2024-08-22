import { describe, expect, it } from 'vitest';
import {
  STANDARD_SWITCH_RATES,
  chargeSwitches,
  groupHandlings,
  switchRate,
  switchTariff,
  switchTotal,
} from '../../src/switching/switchCharge.js';
import { SWITCH_KIND, SWITCH_REASON, switchOrder } from '../../src/switching/switchOrder.js';
import { NotFoundError, ValidationError } from '../../src/core/errors.js';

const book = switchTariff(STANDARD_SWITCH_RATES);

const move = (carId, at, kind = SWITCH_KIND.INTRA_PLANT, extra = {}) =>
  switchOrder({ carId, kind, at, fromTrackId: 'IT-9', toTrackId: 'IT-10', ...extra });

describe('switchRate', () => {
  it('parses the rate', () => {
    expect(switchRate({ kind: 'x', rate: '340.00' }).rate).toBe(34000);
  });

  it('refuses a negative rate', () => {
    expect(() => switchRate({ kind: 'x', rate: '-1.00' })).toThrow(/cannot be negative/);
  });

  it('needs a kind', () => {
    expect(() => switchRate({ rate: '1.00' })).toThrow(ValidationError);
  });

  it('refuses a minimum outside the range', () => {
    expect(() => switchRate({ kind: 'x', rate: '1.00', minimumCars: 0 })).toThrow(ValidationError);
  });
});

describe('switchTariff', () => {
  it('indexes by kind', () => {
    expect(book.size).toBe(3);
    expect(book.find(SWITCH_KIND.RECIPROCAL).rate).toBe(42500);
    expect(book.find('nothing')).toBeUndefined();
  });

  it('throws when asked to price a kind it has not got', () => {
    expect(() => book.rateFor('nothing')).toThrow(NotFoundError);
  });

  it('lists its kinds', () => {
    expect(book.kinds()).toEqual(['intra-plant', 'reciprocal', 'weigh']);
  });

  it('refuses a non array', () => {
    expect(() => switchTariff('nope')).toThrow(ValidationError);
  });
});

describe('groupHandlings', () => {
  it('folds cars moved together into one handling', () => {
    const orders = [
      move('BNSF 1', '2024-03-07T09:00'),
      move('BNSF 2', '2024-03-07T09:00'),
      move('BNSF 3', '2024-03-07T14:00'),
    ];
    const handlings = groupHandlings(orders);
    expect(handlings).toHaveLength(2);
    expect(handlings[0]).toHaveLength(2);
  });

  it('keeps two kinds at the same minute apart', () => {
    const orders = [
      move('BNSF 1', '2024-03-07T09:00'),
      move('BNSF 2', '2024-03-07T09:00', SWITCH_KIND.RECIPROCAL),
    ];
    expect(groupHandlings(orders)).toHaveLength(2);
  });

  it('drops what is not billable', () => {
    const orders = [
      move('BNSF 1', '2024-03-07T09:00', SWITCH_KIND.INTRA_PLANT, {
        reason: SWITCH_REASON.CARRIER_CONVENIENCE,
      }),
    ];
    expect(groupHandlings(orders)).toEqual([]);
  });

  it('sorts by when the handling happened', () => {
    const orders = [move('BNSF 1', '2024-03-08T09:00'), move('BNSF 2', '2024-03-07T09:00')];
    expect(groupHandlings(orders)[0][0].carId).toBe('BNSF 2');
  });
});

describe('chargeSwitches', () => {
  it('charges one rate for a handling of three cars', () => {
    const orders = ['BNSF 1', 'BNSF 2', 'BNSF 3'].map((car) => move(car, '2024-03-07T09:00'));
    const result = chargeSwitches(orders, book);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].carCount).toBe(3);
    expect(result.lines[0].billedCars).toBe(1);
    expect(switchTotal(result)).toBe(34000);
  });

  it('charges three rates for the same three cars moved separately', () => {
    const orders = ['BNSF 1', 'BNSF 2', 'BNSF 3'].map((car, index) =>
      move(car, `2024-03-07T${String(9 + index).padStart(2, '0')}:00`)
    );
    expect(chargeSwitches(orders, book).total).toBe(102000);
  });

  it('charges per car when the rate says to', () => {
    const orders = ['BNSF 1', 'BNSF 2'].map((car) =>
      switchOrder({ carId: car, kind: SWITCH_KIND.WEIGH, at: '2024-03-07T09:00' })
    );
    const result = chargeSwitches(orders, book);
    expect(result.lines[0].billedCars).toBe(2);
    expect(result.total).toBe(19000);
  });

  it('honours a minimum car count on a per car rate', () => {
    const withMinimum = switchTariff([
      { kind: SWITCH_KIND.WEIGH, rate: '95.00', perCar: true, minimumCars: 4 },
    ]);
    const orders = [
      switchOrder({ carId: 'BNSF 1', kind: SWITCH_KIND.WEIGH, at: '2024-03-07T09:00' }),
    ];
    expect(chargeSwitches(orders, withMinimum).total).toBe(38000);
  });

  it('skips a kind the tariff does not price', () => {
    const orders = [
      switchOrder({
        carId: 'BNSF 1',
        kind: SWITCH_KIND.PLACEMENT,
        at: '2024-03-07T09:00',
        toTrackId: 'IT-9',
      }),
    ];
    expect(chargeSwitches(orders, book).total).toBe(0);
  });

  it('charges nothing for nothing', () => {
    expect(chargeSwitches([], book)).toEqual({ lines: [], total: 0 });
  });
});
