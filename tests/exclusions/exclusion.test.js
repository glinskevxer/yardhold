import { describe, expect, it } from 'vitest';
import {
  EVIDENCE,
  EXCLUSION,
  appliesToCar,
  appliesToConsignee,
  appliesToStation,
  describeExclusion,
  exclusion,
  exclusionMinutes,
  isStationWide,
} from '../../src/exclusions/exclusion.js';
import { ValidationError } from '../../src/core/errors.js';

const weather = {
  kind: EXCLUSION.WEATHER,
  from: '2024-03-07T06:00',
  to: '2024-03-08T18:00',
  splc: '412300',
  evidence: EVIDENCE.CARRIER_BULLETIN,
  reference: 'BNSF SA-2024-113',
};

describe('building an exclusion', () => {
  it('reads both ends at the station offset', () => {
    const record = exclusion(weather);
    expect(exclusionMinutes(record)).toBe(36 * 60);
  });

  it('takes instants directly', () => {
    const record = exclusion({ ...weather, from: 0, to: 60 });
    expect(exclusionMinutes(record)).toBe(60);
  });

  it('carries its own id', () => {
    expect(exclusion(weather).id).toMatch(/^[0-9a-f]{8}$/);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(exclusion(weather))).toBe(true);
  });

  it('refuses an empty or backwards stretch', () => {
    expect(() => exclusion({ ...weather, to: weather.from })).toThrow(/cover some time/);
    expect(() => exclusion({ ...weather, from: '2024-03-09T06:00' })).toThrow(/cover some time/);
  });

  it('refuses one that applies to nothing', () => {
    expect(() => exclusion({ ...weather, splc: undefined })).toThrow(/what it applies to/);
  });

  it('refuses a kind or an evidence class it does not know', () => {
    expect(() => exclusion({ ...weather, kind: 'sunspots' })).toThrow(ValidationError);
    expect(() => exclusion({ ...weather, evidence: 'hearsay' })).toThrow(ValidationError);
  });

  it('uppercases the consignee', () => {
    const record = exclusion({ ...weather, consigneeId: 'delta' });
    expect(record.consigneeId).toBe('DELTA');
  });
});

describe('scope', () => {
  it('is station wide with no car and no consignee', () => {
    expect(isStationWide(exclusion(weather))).toBe(true);
    expect(isStationWide(exclusion({ ...weather, carId: 'BNSF 400123' }))).toBe(false);
  });

  it('matches any car when none is named', () => {
    const record = exclusion(weather);
    expect(appliesToCar(record, 'BNSF 400123')).toBe(true);
    expect(appliesToCar(record, 'GATX 77')).toBe(true);
  });

  it('narrows to the car when one is named', () => {
    const record = exclusion({ ...weather, kind: EXCLUSION.BAD_ORDER, carId: 'BNSF 400123' });
    expect(appliesToCar(record, 'BNSF 400123')).toBe(true);
    expect(appliesToCar(record, 'GATX 77')).toBe(false);
  });

  it('narrows to the consignee when one is named', () => {
    const record = exclusion({ ...weather, kind: EXCLUSION.PLANT_CLOSURE, consigneeId: 'DELTA' });
    expect(appliesToConsignee(record, 'delta')).toBe(true);
    expect(appliesToConsignee(record, 'ACME')).toBe(false);
    expect(appliesToConsignee(record, undefined)).toBe(false);
  });

  it('matches any consignee when none is named', () => {
    expect(appliesToConsignee(exclusion(weather), undefined)).toBe(true);
  });

  it('narrows to the station when one is named', () => {
    const record = exclusion(weather);
    expect(appliesToStation(record, '412300')).toBe(true);
    expect(appliesToStation(record, '509100')).toBe(false);
  });

  it('matches any station when only a car is named', () => {
    const record = exclusion({
      kind: EXCLUSION.BAD_ORDER,
      from: weather.from,
      to: weather.to,
      carId: 'BNSF 400123',
    });
    expect(appliesToStation(record, '509100')).toBe(true);
  });
});

describe('describeExclusion', () => {
  it('names the kind, the window and the bulletin', () => {
    expect(describeExclusion(exclusion(weather))).toBe(
      'weather 2024-03-07T06:00-06:00 to 2024-03-08T18:00-06:00 (BNSF SA-2024-113)'
    );
  });

  it('leaves the reference out when there is none', () => {
    const record = exclusion({ ...weather, reference: undefined });
    expect(describeExclusion(record)).not.toContain('(');
  });
});
