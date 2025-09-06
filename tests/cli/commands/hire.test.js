import { describe, expect, it } from 'vitest';
import {
  heldHoursFor,
  hireBody,
  hireRows,
  runHire,
  termsFrom,
} from '../../../src/cli/commands/hire.js';
import { loadConfig } from '../../../src/config/loadConfig.js';
import { RECLAIM_BASIS } from '../../../src/storage/reclaim.js';
import { OUTPUT } from '../../../src/cli/format.js';
import { makeReadFile, sampleDocument, sampleOptions } from '../../fixtures/world.js';

const document = sampleDocument({
  settings: { years: [2024], reclaim: { basis: 'chargeable-hours', sharePercent: 100 } },
  cars: [
    { id: 'BNSF 400123', designation: 'XM' },
    { id: 'GATX 77', designation: 'T', ownerName: 'Delta Chemical' },
    { id: 'UP 3', designation: 'LO' },
  ],
  hireRates: [{ carKind: 'boxcar', hourlyRate: '0.7500', freeRunningHours: 24 }],
});

const feed = [
  'car,event,event_time,track',
  'BNSF 400123,ARR,2024-03-03T00:00,',
  'BNSF 400123,AP,2024-03-04T00:00,IT-9',
  'BNSF 400123,REL,2024-03-08T00:00,IT-9',
  'BNSF 400123,DEP,2024-03-09T00:00,',
  'GATX 77,AP,2024-03-04T00:00,IT-9',
  'GATX 77,REL,2024-03-08T00:00,IT-9',
  'UP 3,AP,2024-03-04T00:00,IT-9',
  'UP 3,REL,2024-03-06T00:00,IT-9',
  '',
].join('\n');

const readFile = makeReadFile({ document, feed });
const options = { ...sampleOptions };
const { result, rows } = runHire(options, { readFile });
const world = loadConfig(document);

describe('termsFrom', () => {
  it('reads the reclaim block off the settings', () => {
    expect(termsFrom(world).sharePercent).toBe(100);
    expect(termsFrom(world).basis).toBe(RECLAIM_BASIS.CHARGEABLE_HOURS);
  });

  it('falls back to the defaults when the settings say nothing', () => {
    const bare = loadConfig(sampleDocument());
    expect(termsFrom(bare).basis).toBe(RECLAIM_BASIS.CHARGEABLE_HOURS);
    expect(termsFrom(bare).sharePercent).toBe(100);
  });
});

describe('heldHoursFor', () => {
  it('measures the whole trip, not just the detention', () => {
    const row = rows.find((entry) => entry.car === 'BNSF 400123');
    expect(row.heldHours).toBe(144);
  });

  it('counts more hours than the car was chargeable for', () => {
    const row = rows.find((entry) => entry.car === 'BNSF 400123');
    expect(row.heldHours).toBeGreaterThan(row.chargeableHours);
  });

  it('falls back to the detention when the trip never closed', () => {
    const row = rows.find((entry) => entry.car === 'UP 3');
    expect(row.heldHours).toBe(48);
  });

  it('is nothing for a car that never stood', () => {
    expect(heldHoursFor({ carId: 'X', detentions: [] }, new Map())).toBe(0);
  });
});

describe('hireRows called directly', () => {
  it('gives the same rows the command reports', () => {
    expect(hireRows(world, result, [])).toHaveLength(rows.length);
  });
});

describe('hireRows', () => {
  it('charges hire on a railroad car with a rate on file', () => {
    const row = rows.find((entry) => entry.car === 'BNSF 400123');
    expect(row.hire).toBeGreaterThan(0);
    expect(row.kind).toBe('boxcar');
  });

  it('waives the free running hours before charging', () => {
    const row = rows.find((entry) => entry.car === 'BNSF 400123');
    expect(row.hire).toBe(Math.round((144 - 24) * 0.75 * 100));
  });

  it('reports a private car as not on hire rather than as a missing rate', () => {
    const row = rows.find((entry) => entry.car === 'GATX 77');
    expect(row.reclaimed).toBe('not on hire');
    expect(row.hire).toBe(0);
  });

  it('reports a missing rate as a missing rate', () => {
    const row = rows.find((entry) => entry.car === 'UP 3');
    expect(row.reclaimed).toBe('no rate filed');
  });

  it('reclaims only the chargeable hours', () => {
    const row = rows.find((entry) => entry.car === 'BNSF 400123');
    expect(row.reclaimable).toBeGreaterThan(0);
    expect(row.reclaimable).toBeLessThan(row.hire);
  });

  it('reclaims nothing from a car that was never over its free time', () => {
    const quick = runHire(
      { ...options, events: 'quick.csv' },
      {
        readFile: makeReadFile({
          document,
          extra: {
            'quick.csv': [
              'car,event,event_time,track',
              'BNSF 400123,ARR,2024-03-03T00:00,',
              'BNSF 400123,AP,2024-03-04T00:00,IT-9',
              'BNSF 400123,REL,2024-03-04T12:00,IT-9',
              'BNSF 400123,DEP,2024-03-05T00:00,',
              '',
            ].join('\n'),
          },
        }),
      }
    );
    const row = quick.rows[0];
    expect(row.hire).toBeGreaterThan(0);
    expect(row.reclaimable).toBe(0);
  });
});

describe('hireBody', () => {
  it('foots with the hire and what comes back', () => {
    const text = hireBody(world, result, [], OUTPUT.TABLE);
    expect(text).toMatch(/hire\s+\d/);
    expect(text).toMatch(/reclaimable\s+\d/);
    expect(text).toMatch(/private cars\s+1/);
  });

  it('writes JSON with both totals', () => {
    const parsed = JSON.parse(hireBody(world, result, [], OUTPUT.JSON));
    expect(parsed.period).toBe('202403');
    expect(parsed.hire).toBeGreaterThanOrEqual(0);
    expect(parsed.rows).toHaveLength(3);
  });

  it('writes a CSV in a fixed column order', () => {
    expect(hireBody(world, result, [], OUTPUT.CSV).split('\n')[0]).toBe(
      'car,kind,heldHours,chargeableHours,hire,reclaimable,reclaimed'
    );
  });

  it('says so when there is nothing to charge', () => {
    expect(hireBody(world, { period: '202403', assessments: [] }, [], OUTPUT.TABLE)).toBe(
      'no cars to charge hire on'
    );
  });
});

describe('runHire', () => {
  it('reports a row per assessed car', () => {
    expect(rows).toHaveLength(3);
  });

  it('prints the table', () => {
    expect(runHire(options, { readFile }).text).toContain('BNSF 400123');
  });

  it('needs a config it can read', () => {
    expect(() => runHire({ ...options, config: 'missing.json' }, { readFile })).toThrow(
      /could not read/
    );
  });
});
