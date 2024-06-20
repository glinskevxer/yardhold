import { describe, expect, it } from 'vitest';
import {
  exclusionRegistry,
  groupByKind,
  totalRegisteredMinutes,
} from '../../src/exclusions/registry.js';
import { EVIDENCE, EXCLUSION } from '../../src/exclusions/exclusion.js';
import { parseInstant } from '../../src/time/instant.js';
import { period } from '../../src/time/period.js';
import { ValidationError } from '../../src/core/errors.js';

const at = (text) => parseInstant(text, -360);

const registry = exclusionRegistry([
  {
    kind: EXCLUSION.WEATHER,
    from: '2024-03-07T06:00',
    to: '2024-03-08T18:00',
    splc: '412300',
    evidence: EVIDENCE.CARRIER_BULLETIN,
  },
  {
    kind: EXCLUSION.PLANT_CLOSURE,
    from: '2024-03-09T00:00',
    to: '2024-03-11T06:00',
    splc: '412300',
    consigneeId: 'DELTA',
    evidence: EVIDENCE.CONSIGNEE_NOTICE,
  },
  {
    kind: EXCLUSION.BAD_ORDER,
    from: '2024-03-08T12:00',
    to: '2024-03-09T12:00',
    carId: 'BNSF 400123',
    evidence: EVIDENCE.EVENT_FEED,
  },
]);

describe('the register', () => {
  it('counts what it holds', () => {
    expect(registry.size).toBe(3);
  });

  it('sorts by when the relief starts', () => {
    expect(registry.all().map((record) => record.kind)).toEqual([
      EXCLUSION.WEATHER,
      EXCLUSION.BAD_ORDER,
      EXCLUSION.PLANT_CLOSURE,
    ]);
  });

  it('takes another record after construction', () => {
    const fresh = exclusionRegistry();
    fresh.add({
      kind: EXCLUSION.STRIKE,
      from: '2024-04-01T00:00',
      to: '2024-04-03T00:00',
      splc: '412300',
      evidence: EVIDENCE.CONSIGNEE_NOTICE,
    });
    expect(fresh.size).toBe(1);
  });

  it('refuses a non array', () => {
    expect(() => exclusionRegistry('nope')).toThrow(ValidationError);
  });
});

describe('slicing', () => {
  it('filters by kind', () => {
    expect(registry.ofKind(EXCLUSION.WEATHER)).toHaveLength(1);
    expect(registry.ofKind(EXCLUSION.EMBARGO)).toEqual([]);
  });

  it('finds what covers a span', () => {
    const span = period(at('2024-03-08T00:00'), at('2024-03-08T06:00'));
    expect(registry.covering(span)).toHaveLength(1);
  });

  it('needs a span object', () => {
    expect(() => registry.covering(undefined)).toThrow(ValidationError);
  });
});

describe('forCar', () => {
  it('gives a Delta car at Memphis all three', () => {
    const found = registry.forCar({
      carId: 'BNSF 400123',
      splc: '412300',
      consigneeId: 'DELTA',
    });
    expect(found).toHaveLength(3);
  });

  it('drops the plant closure for another consignee', () => {
    const found = registry.forCar({ carId: 'BNSF 400123', splc: '412300', consigneeId: 'ACME' });
    expect(found.map((record) => record.kind).sort()).toEqual(['bad-order', 'weather']);
  });

  it('drops the bad order for another car', () => {
    const found = registry.forCar({ carId: 'GATX 77', splc: '412300', consigneeId: 'DELTA' });
    expect(found.map((record) => record.kind).sort()).toEqual(['plant-closure', 'weather']);
  });

  it('drops the station bulletins at another station', () => {
    const found = registry.forCar({ carId: 'BNSF 400123', splc: '509100', consigneeId: 'DELTA' });
    expect(found.map((record) => record.kind)).toEqual(['bad-order']);
  });

  it('narrows by span when one is given', () => {
    const span = period(at('2024-03-07T00:00'), at('2024-03-08T00:00'));
    const found = registry.forCar({
      carId: 'BNSF 400123',
      splc: '412300',
      consigneeId: 'DELTA',
      span,
    });
    expect(found).toHaveLength(1);
  });
});

describe('windows', () => {
  it('merges what overlaps into continuous stretches', () => {
    const windows = registry.windows({
      carId: 'BNSF 400123',
      splc: '412300',
      consigneeId: 'DELTA',
    });
    expect(windows).toHaveLength(1);
    expect(windows[0].start).toBe(at('2024-03-07T06:00'));
    expect(windows[0].end).toBe(at('2024-03-11T06:00'));
  });

  it('leaves a real gap alone', () => {
    const windows = registry.windows({ carId: 'GATX 77', splc: '412300', consigneeId: 'DELTA' });
    expect(windows).toHaveLength(2);
  });
});

describe('summaries', () => {
  it('adds up every registered minute without merging', () => {
    expect(totalRegisteredMinutes(registry)).toBe(36 * 60 + 54 * 60 + 24 * 60);
  });

  it('groups by kind', () => {
    const grouped = groupByKind(registry);
    expect([...grouped.keys()].sort()).toEqual(['bad-order', 'plant-closure', 'weather']);
    expect(grouped.get('weather')).toHaveLength(1);
  });

  it('handles an empty register', () => {
    expect(totalRegisteredMinutes(exclusionRegistry())).toBe(0);
    expect(groupByKind(exclusionRegistry()).size).toBe(0);
  });
});
