import { describe, expect, it } from 'vitest';
import {
  acrossCars,
  betterThanBilled,
  cheapest,
  dearest,
  runScenarios,
  scenario,
  scenarioRows,
  spread,
} from '../../src/assessment/scenario.js';
import { assessCar } from '../../src/assessment/assess.js';
import { trackEvent } from '../../src/events/event.js';
import { trackBook } from '../../src/site/track.js';
import { tariff } from '../../src/tariff/tariff.js';
import { SERVICE } from '../../src/tariff/freeTimeTable.js';
import { serviceCalendar } from '../../src/time/serviceCalendar.js';
import { ValidationError } from '../../src/core/errors.js';

const tracks = trackBook([
  { id: 'IT-9', splc: '412300', name: 'Delta lead', capacityCars: 6, consigneeId: 'DELTA' },
]);
const calendar = serviceCalendar({ id: 'MEM', years: [2024] });

const page = tariff({
  id: 'DEM-4000',
  carrier: 'BNSF',
  notificationRequired: false,
  ladder: [{ fromDay: 1, rate: '150.00' }],
  freeTime: [{ service: SERVICE.UNLOADING, days: 1 }],
});

const cheaperPage = tariff({
  id: 'CON-DELTA',
  carrier: 'BNSF',
  notificationRequired: false,
  ladder: [{ fromDay: 1, rate: '95.00' }],
  freeTime: [{ service: SERVICE.UNLOADING, days: 1 }],
});

const generousPage = tariff({
  id: 'DEM-4100',
  carrier: 'BNSF',
  notificationRequired: false,
  ladder: [{ fromDay: 1, rate: '150.00' }],
  freeTime: [{ service: SERVICE.UNLOADING, days: 3 }],
});

const events = [
  trackEvent({ carId: 'BNSF 400123', code: 'AP', at: '2024-03-04T00:00', trackId: 'IT-9' }),
  trackEvent({ carId: 'BNSF 400123', code: 'REL', at: '2024-03-08T00:00' }),
];

const inputs = {
  carId: 'BNSF 400123',
  events,
  page,
  calendar,
  trackBook: tracks,
  query: { service: SERVICE.UNLOADING },
};
const original = { ...assessCar(inputs), ...inputs, exclusions: [] };

const scenarios = [
  scenario({ name: 'contract rates', substitutions: { page: cheaperPage } }),
  scenario({ name: 'three free days', substitutions: { page: generousPage } }),
];

describe('scenario', () => {
  it('needs a name', () => {
    expect(() => scenario({})).toThrow(ValidationError);
  });

  it('refuses substitutions that are not an object', () => {
    expect(() => scenario({ name: 'x', substitutions: 'nope' })).toThrow(ValidationError);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(scenario({ name: 'x' }))).toBe(true);
  });
});

describe('runScenarios', () => {
  const result = runScenarios(original, scenarios);

  it('reports what was actually billed as the base', () => {
    expect(result.base.name).toBe('as billed');
    expect(result.base.total).toBe(45000);
    expect(result.base.chargeableDays).toBe(3);
  });

  it('runs each scenario against the same events', () => {
    expect(result.rows.map((row) => row.name)).toEqual(['contract rates', 'three free days']);
  });

  it('prices the same three days cheaper under the contract', () => {
    expect(result.rows[0].total).toBe(28500);
    expect(result.rows[0].chargeableDays).toBe(3);
  });

  it('charges one day under the longer allowance', () => {
    expect(result.rows[1].chargeableDays).toBe(1);
    expect(result.rows[1].total).toBe(15000);
  });

  it('reports the difference against what was billed', () => {
    expect(result.rows.map((row) => row.difference)).toEqual([-16500, -30000]);
  });

  it('carries the recomputed assessment', () => {
    expect(result.rows[0].assessment.pageId).toBe('CON-DELTA');
  });

  it('takes plain objects as well as built scenarios', () => {
    const plain = runScenarios(original, [
      { name: 'contract', substitutions: { page: cheaperPage } },
    ]);
    expect(plain.rows[0].total).toBe(28500);
  });

  it('needs an original and a list', () => {
    expect(() => runScenarios(undefined, scenarios)).toThrow(ValidationError);
    expect(() => runScenarios(original, 'nope')).toThrow(ValidationError);
  });

  it('reports only the base when there is nothing to compare', () => {
    expect(runScenarios(original, []).rows).toEqual([]);
  });
});

describe('reading the answers', () => {
  const result = runScenarios(original, scenarios);

  it('picks the cheapest and the dearest including the base', () => {
    expect(cheapest(result).name).toBe('three free days');
    expect(dearest(result).name).toBe('as billed');
  });

  it('measures the spread', () => {
    expect(spread(result)).toBe(30000);
  });

  it('lists what beat the bill, best first', () => {
    expect(betterThanBilled(result).map((row) => row.name)).toEqual([
      'three free days',
      'contract rates',
    ]);
  });

  it('reports nothing better when the base was cheapest', () => {
    const worse = runScenarios(original, [
      scenario({
        name: 'no free time',
        substitutions: {
          page: tariff({
            id: 'X',
            carrier: 'BNSF',
            notificationRequired: false,
            ladder: [{ fromDay: 1, rate: '150.00' }],
          }),
        },
      }),
    ]);
    expect(betterThanBilled(worse)).toEqual([]);
    expect(cheapest(worse).name).toBe('as billed');
  });

  it('flattens to rows for a table', () => {
    const rows = scenarioRows(result);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({ name: 'as billed', days: 3, total: 45000, difference: 0 });
  });
});

describe('acrossCars', () => {
  it('totals each scenario over a set of cars', () => {
    const totals = acrossCars([original, original], scenarios);
    expect(totals.find((row) => row.name === 'as billed').total).toBe(90000);
    expect(totals.find((row) => row.name === 'three free days').total).toBe(30000);
  });

  it('sorts cheapest first', () => {
    expect(acrossCars([original], scenarios)[0].name).toBe('three free days');
  });

  it('reports nothing for no cars', () => {
    expect(acrossCars([], scenarios)).toEqual([]);
  });
});
