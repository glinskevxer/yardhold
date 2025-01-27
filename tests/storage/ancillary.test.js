import { describe, expect, it } from 'vitest';
import {
  REFUSAL,
  SERVICE_KIND,
  STANDARD_SERVICE_RATES,
  chargeAll,
  chargeService,
  isAdmissible,
  serviceBook,
  serviceRate,
} from '../../src/storage/ancillary.js';
import { NotFoundError, ValidationError } from '../../src/core/errors.js';

const book = serviceBook(STANDARD_SERVICE_RATES);
const phenol = { requiresHeat: true, commodityClass: 'HAZ' };
const caustic = { requiresHeat: false, commodityClass: 'HAZ' };

describe('serviceRate', () => {
  it('parses the rate', () => {
    expect(serviceRate({ kind: SERVICE_KIND.WEIGHING, rate: '95.00' }).rate).toBe(9500);
  });

  it('refuses a negative rate and an unknown kind', () => {
    expect(() => serviceRate({ kind: SERVICE_KIND.WEIGHING, rate: '-1.00' })).toThrow(
      /cannot be negative/
    );
    expect(() => serviceRate({ kind: 'polishing', rate: '1.00' })).toThrow(ValidationError);
  });

  it('refuses a minimum outside the range', () => {
    expect(() =>
      serviceRate({ kind: SERVICE_KIND.WEIGHING, rate: '1.00', minimumUnits: 0 })
    ).toThrow(ValidationError);
  });
});

describe('serviceBook', () => {
  it('indexes by kind', () => {
    expect(book.size).toBe(4);
    expect(book.rateFor(SERVICE_KIND.HEATING).perHour).toBe(true);
    expect(book.find('polishing')).toBeUndefined();
  });

  it('throws for a kind it has not got', () => {
    expect(() => book.rateFor(SERVICE_KIND.HOLD_FOR_ORDERS)).toThrow(NotFoundError);
  });

  it('lists its kinds', () => {
    expect(book.kinds()).toEqual(['blocking', 'cleaning', 'heating', 'weighing']);
  });
});

describe('what a car can be given', () => {
  it('heats a tank car', () => {
    expect(
      isAdmissible(SERVICE_KIND.HEATING, { carKind: 'tank', commodity: phenol }).admissible
    ).toBe(true);
  });

  it('refuses to heat a boxcar', () => {
    const verdict = isAdmissible(SERVICE_KIND.HEATING, { carKind: 'boxcar', commodity: phenol });
    expect(verdict.admissible).toBe(false);
    expect(verdict.refusal).toBe(REFUSAL.WRONG_CAR);
  });

  it('refuses to heat a tank of something that does not need it', () => {
    const verdict = isAdmissible(SERVICE_KIND.HEATING, { carKind: 'tank', commodity: caustic });
    expect(verdict.refusal).toBe(REFUSAL.NOT_REQUIRED);
  });

  it('heats when it was told nothing about the commodity', () => {
    expect(isAdmissible(SERVICE_KIND.HEATING, { carKind: 'tank' }).admissible).toBe(true);
  });

  it('weighs almost anything', () => {
    for (const carKind of ['tank', 'hopper', 'boxcar', 'flatcar']) {
      expect(isAdmissible(SERVICE_KIND.WEIGHING, { carKind }).admissible).toBe(true);
    }
  });

  it('blocks only what has a deck', () => {
    expect(isAdmissible(SERVICE_KIND.BLOCKING, { carKind: 'flatcar' }).admissible).toBe(true);
    expect(isAdmissible(SERVICE_KIND.BLOCKING, { carKind: 'tank' }).admissible).toBe(false);
  });

  it('refuses a kind it does not know', () => {
    expect(() => isAdmissible('polishing', { carKind: 'tank' })).toThrow(ValidationError);
  });
});

describe('chargeService', () => {
  it('charges the rate', () => {
    const line = chargeService(SERVICE_KIND.WEIGHING, book, { carKind: 'hopper' });
    expect(line.amount).toBe(9500);
    expect(line.billed).toBe(true);
  });

  it('honours the minimum on an hourly service', () => {
    const line = chargeService(SERVICE_KIND.HEATING, book, {
      carKind: 'tank',
      commodity: phenol,
      units: 2,
    });
    expect(line.units).toBe(4);
    expect(line.amount).toBe(58000);
  });

  it('charges above the minimum when the hours ran long', () => {
    const line = chargeService(SERVICE_KIND.HEATING, book, {
      carKind: 'tank',
      commodity: phenol,
      units: 9,
    });
    expect(line.amount).toBe(130500);
  });

  it('bills nothing for a service the car cannot take', () => {
    const line = chargeService(SERVICE_KIND.HEATING, book, { carKind: 'boxcar' });
    expect(line.billed).toBe(false);
    expect(line.amount).toBe(0);
    expect(line.refusal).toBe(REFUSAL.WRONG_CAR);
  });

  it('bills nothing when no rate is filed', () => {
    const line = chargeService(SERVICE_KIND.HOLD_FOR_ORDERS, book, { carKind: 'tank' });
    expect(line.refusal).toBe(REFUSAL.NO_RATE);
  });

  it('refuses a unit count outside the range', () => {
    expect(() => chargeService(SERVICE_KIND.WEIGHING, book, { carKind: 'tank', units: 0 })).toThrow(
      ValidationError
    );
  });
});

describe('chargeAll', () => {
  it('runs a set of orders and totals them', () => {
    const result = chargeAll(
      [
        { kind: SERVICE_KIND.WEIGHING, carKind: 'hopper' },
        { kind: SERVICE_KIND.HEATING, carKind: 'tank', commodity: phenol, units: 6 },
        { kind: SERVICE_KIND.HEATING, carKind: 'boxcar' },
      ],
      book
    );
    expect(result.lines).toHaveLength(3);
    expect(result.total).toBe(9500 + 87000);
  });

  it('totals nothing for nothing', () => {
    expect(chargeAll([], book)).toEqual({ lines: [], total: 0 });
  });
});
