import { describe, expect, it } from 'vitest';
import {
  CHANGE,
  applyToAllowance,
  carriesFreeTimeForward,
  changesConsignee,
  changesForCar,
  changesStation,
  describeChange,
  resetsFreeTime,
  routeChange,
  totalChangeCharges,
} from '../../src/events/diversion.js';
import { ValidationError } from '../../src/core/errors.js';

const diverted = {
  carId: 'bnsf400123',
  kind: CHANGE.DIVERSION,
  orderedAt: '2024-03-03T10:00',
  fromSplc: '412300',
  toSplc: '412400',
  charge: '285.00',
};

const reconsigned = {
  carId: 'BNSF 400123',
  kind: CHANGE.RECONSIGNMENT,
  orderedAt: '2024-03-06T10:00',
  fromSplc: '412300',
  toSplc: '412400',
  placedBeforeChange: true,
  charge: '285.00',
};

describe('routeChange', () => {
  it('normalises the car and parses the charge', () => {
    const record = routeChange(diverted);
    expect(record.carId).toBe('BNSF 400123');
    expect(record.charge).toBe(28500);
  });

  it('uppercases the consignees', () => {
    const record = routeChange({ ...diverted, fromConsigneeId: 'delta', toConsigneeId: 'acme' });
    expect(record.fromConsigneeId).toBe('DELTA');
    expect(record.toConsigneeId).toBe('ACME');
  });

  it('is frozen', () => {
    expect(Object.isFrozen(routeChange(diverted))).toBe(true);
  });

  it('needs a destination', () => {
    expect(() => routeChange({ ...diverted, toSplc: undefined })).toThrow(ValidationError);
  });

  it('refuses a change that changes nothing', () => {
    expect(() => routeChange({ ...diverted, toSplc: '412300' })).toThrow(/change something/);
  });

  it('allows a same station change of consignee', () => {
    const record = routeChange({ ...diverted, toSplc: '412300', toConsigneeId: 'ACME' });
    expect(changesStation(record)).toBe(false);
    expect(changesConsignee(record)).toBe(true);
  });
});

describe('the two words are not the same thing', () => {
  it('refuses to call a placed car diverted', () => {
    expect(() => routeChange({ ...diverted, placedBeforeChange: true })).toThrow(
      /reconsigned, not diverted/
    );
  });

  it('refuses to call an unplaced car reconsigned', () => {
    expect(() => routeChange({ ...reconsigned, placedBeforeChange: false })).toThrow(
      /diverted, not reconsigned/
    );
  });
});

describe('what happens to the free time', () => {
  it('starts a diverted car over', () => {
    const record = routeChange(diverted);
    expect(resetsFreeTime(record)).toBe(true);
    expect(carriesFreeTimeForward(record)).toBe(false);
    expect(applyToAllowance(record, { allowance: 2, alreadySpent: 2 })).toEqual({
      allowance: 2,
      spent: 0,
    });
  });

  it('makes a reconsigned car keep what it has burned', () => {
    const record = routeChange(reconsigned);
    expect(carriesFreeTimeForward(record)).toBe(true);
    expect(applyToAllowance(record, { allowance: 2, alreadySpent: 2 })).toEqual({
      allowance: 2,
      spent: 2,
    });
  });

  it('never carries more spent days than the allowance', () => {
    const record = routeChange(reconsigned);
    expect(applyToAllowance(record, { allowance: 2, alreadySpent: 9 }).spent).toBe(2);
  });

  it('gives the same car a different answer on the same day', () => {
    const beforePlacement = applyToAllowance(routeChange(diverted), {
      allowance: 2,
      alreadySpent: 2,
    });
    const afterPlacement = applyToAllowance(routeChange(reconsigned), {
      allowance: 2,
      alreadySpent: 2,
    });
    expect(beforePlacement.spent).not.toBe(afterPlacement.spent);
  });
});

describe('working with a set', () => {
  const records = [
    routeChange(reconsigned),
    routeChange(diverted),
    routeChange({ ...diverted, carId: 'GATX 77' }),
  ];

  it('finds a car in time order', () => {
    const found = changesForCar(records, 'bnsf-400123');
    expect(found).toHaveLength(2);
    expect(found[0].kind).toBe(CHANGE.DIVERSION);
  });

  it('is empty for a car with no changes', () => {
    expect(changesForCar(records, 'UP 1')).toEqual([]);
  });

  it('totals the charges', () => {
    expect(totalChangeCharges(records)).toBe(85500);
    expect(totalChangeCharges([])).toBe(0);
  });
});

describe('describeChange', () => {
  it('names both ends when it has them', () => {
    expect(describeChange(routeChange(diverted))).toBe('BNSF 400123 diversion 412300 to 412400');
  });

  it('names only the destination when that is all it has', () => {
    const record = routeChange({ ...diverted, fromSplc: undefined });
    expect(describeChange(record)).toBe('BNSF 400123 diversion 412400');
  });
});
