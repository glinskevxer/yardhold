import { describe, expect, it } from 'vitest';
import {
  chargeableLabels,
  countChargeableDays,
  freeLabels,
  skippedLabels,
  unusedFreeTime,
} from '../../src/clock/chargeableDays.js';
import { PLACEMENT } from '../../src/clock/placement.js';
import { tariff } from '../../src/tariff/tariff.js';
import { DAY_KIND, SERVICE } from '../../src/tariff/freeTimeTable.js';
import { EVIDENCE, EXCLUSION, exclusion } from '../../src/exclusions/exclusion.js';
import { serviceCalendar } from '../../src/time/serviceCalendar.js';
import { parseInstant } from '../../src/time/instant.js';
import { period } from '../../src/time/period.js';
import { ValidationError } from '../../src/core/errors.js';

const at = (text) => parseInstant(text, -360);
const calendar = serviceCalendar({ id: 'MEM', years: [2024] });

const detention = (from, to, kind = PLACEMENT.CONSTRUCTIVE) => ({
  kind,
  carId: 'BNSF 400123',
  span: period(at(from), at(to)),
});

const page = tariff({
  id: 'DEM-4000',
  carrier: 'BNSF',
  ladder: [{ fromDay: 1, rate: '150.00' }],
  freeTime: [
    { service: SERVICE.UNLOADING, days: 1 },
    { service: SERVICE.UNLOADING, days: 1, commodityClass: 'GRAIN', dayKind: DAY_KIND.SERVICE },
  ],
});

const unloading = { service: SERVICE.UNLOADING };
const grain = { service: SERVICE.UNLOADING, commodityClass: 'GRAIN' };

describe('the plain count', () => {
  it('spends the free day then charges the rest', () => {
    const count = countChargeableDays(detention('2024-03-04T00:00', '2024-03-08T00:00'), {
      page,
      calendar,
      query: unloading,
    });
    expect(freeLabels(count)).toEqual(['2024-03-04']);
    expect(chargeableLabels(count)).toEqual(['2024-03-05', '2024-03-06', '2024-03-07']);
    expect(count.chargeableCount).toBe(3);
  });

  it('numbers the chargeable days from one', () => {
    const count = countChargeableDays(detention('2024-03-04T00:00', '2024-03-08T00:00'), {
      page,
      calendar,
      query: unloading,
    });
    expect(count.charged.map((unit) => unit.dayIndex)).toEqual([1, 2, 3]);
    expect(count.nextIndex).toBe(4);
  });

  it('can start partway up the ladder', () => {
    const count = countChargeableDays(detention('2024-03-04T00:00', '2024-03-08T00:00'), {
      page,
      calendar,
      query: unloading,
      startIndex: 5,
    });
    expect(count.charged.map((unit) => unit.dayIndex)).toEqual([5, 6, 7]);
  });

  it('charges nothing inside the free time', () => {
    const count = countChargeableDays(detention('2024-03-04T00:00', '2024-03-05T00:00'), {
      page,
      calendar,
      query: unloading,
    });
    expect(count.chargeableCount).toBe(0);
    expect(unusedFreeTime(count)).toBe(0);
  });

  it('reports free time left over on a short stand', () => {
    const generous = tariff({
      id: 'DEM-4001',
      carrier: 'BNSF',
      ladder: [{ fromDay: 1, rate: '150.00' }],
      freeTime: [{ service: SERVICE.UNLOADING, days: 5 }],
    });
    const count = countChargeableDays(detention('2024-03-04T00:00', '2024-03-06T00:00'), {
      page: generous,
      calendar,
      query: unloading,
    });
    expect(unusedFreeTime(count)).toBe(3);
  });

  it('has nothing to count for a detention with no span', () => {
    const count = countChargeableDays({ kind: PLACEMENT.ACTUAL }, { page, calendar });
    expect(count.chargeableCount).toBe(0);
    expect(count.nextIndex).toBe(1);
    expect(count.units).toEqual([]);
  });

  it('needs a page', () => {
    expect(() =>
      countChargeableDays(detention('2024-03-04T00:00', '2024-03-05T00:00'), {})
    ).toThrow(ValidationError);
  });
});

describe('the free time entry decides which days can be spent', () => {
  const overWeekend = detention('2024-03-08T00:00', '2024-03-13T00:00');

  it('counts every day on a running day entry', () => {
    const count = countChargeableDays(overWeekend, { page, calendar, query: unloading });
    expect(freeLabels(count)).toEqual(['2024-03-08']);
    expect(chargeableLabels(count)).toEqual([
      '2024-03-09',
      '2024-03-10',
      '2024-03-11',
      '2024-03-12',
    ]);
    expect(skippedLabels(count)).toEqual([]);
  });

  it('steps over the weekend on a service day entry', () => {
    const count = countChargeableDays(overWeekend, { page, calendar, query: grain });
    expect(skippedLabels(count)).toEqual(['2024-03-09', '2024-03-10']);
    expect(freeLabels(count)).toEqual(['2024-03-08']);
    expect(chargeableLabels(count)).toEqual(['2024-03-11', '2024-03-12']);
  });

  it('bills the same car twice as much under the running entry', () => {
    const running = countChargeableDays(overWeekend, { page, calendar, query: unloading });
    const service = countChargeableDays(overWeekend, { page, calendar, query: grain });
    expect(running.chargeableCount).toBe(4);
    expect(service.chargeableCount).toBe(2);
  });

  it('counts every day when no calendar is supplied', () => {
    const count = countChargeableDays(overWeekend, { page, query: grain });
    expect(count.skipped).toEqual([]);
    expect(count.chargeableCount).toBe(4);
  });
});

describe('relief comes off before the days are cut', () => {
  const storm = exclusion({
    kind: EXCLUSION.WEATHER,
    from: '2024-03-05T00:00',
    to: '2024-03-06T00:00',
    splc: '412300',
    evidence: EVIDENCE.CARRIER_BULLETIN,
  });

  it('drops a relieved day from the charge', () => {
    const count = countChargeableDays(detention('2024-03-04T00:00', '2024-03-08T00:00'), {
      page,
      calendar,
      query: unloading,
      exclusions: [storm],
    });
    expect(chargeableLabels(count)).toEqual(['2024-03-06', '2024-03-07']);
    expect(count.relief.removedMinutes).toBe(1440);
  });

  it('leaves the count alone when the relief does not reach this placement', () => {
    const closure = exclusion({
      kind: EXCLUSION.PLANT_CLOSURE,
      from: '2024-03-05T00:00',
      to: '2024-03-06T00:00',
      splc: '412300',
      consigneeId: 'DELTA',
      evidence: EVIDENCE.CONSIGNEE_NOTICE,
    });
    const inside = countChargeableDays(
      detention('2024-03-04T00:00', '2024-03-08T00:00', PLACEMENT.ACTUAL),
      { page, calendar, query: unloading, exclusions: [closure] }
    );
    expect(inside.chargeableCount).toBe(3);
    expect(inside.relief.declined).toHaveLength(1);
  });

  it('relieves the same closure for a car left outside the gate', () => {
    const closure = exclusion({
      kind: EXCLUSION.PLANT_CLOSURE,
      from: '2024-03-05T00:00',
      to: '2024-03-06T00:00',
      splc: '412300',
      consigneeId: 'DELTA',
      evidence: EVIDENCE.CONSIGNEE_NOTICE,
    });
    const outside = countChargeableDays(detention('2024-03-04T00:00', '2024-03-08T00:00'), {
      page,
      calendar,
      query: unloading,
      exclusions: [closure],
    });
    expect(outside.chargeableCount).toBe(2);
  });
});
