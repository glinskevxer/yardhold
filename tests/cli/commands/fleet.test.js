import { describe, expect, it } from 'vitest';
import {
  fleetBody,
  fleetRows,
  leaseLines,
  leaseStateFor,
  runFleet,
  weightFor,
} from '../../../src/cli/commands/fleet.js';
import { loadConfig } from '../../../src/config/loadConfig.js';
import { WEIGHING } from '../../../src/equipment/scaleTicket.js';
import { OUTPUT } from '../../../src/cli/format.js';
import { makeReadFile, sampleDocument } from '../../fixtures/world.js';
import { ValidationError } from '../../../src/core/errors.js';

const document = sampleDocument({
  cars: [
    { id: 'BNSF 400123', designation: 'XM', capacityPounds: 200000 },
    { id: 'GATX 77', designation: 'T', ownerName: 'Delta Chemical', leaseId: 'L-2024-11' },
    { id: 'GATX 88', designation: 'T', leaseId: 'L-OLD' },
    { id: 'UP 512004', designation: 'LO', leaseId: 'L-GONE' },
  ],
  leases: [
    {
      id: 'L-2024-11',
      lessee: 'Delta Chemical',
      lessor: 'General American',
      from: '2024-01-01',
      to: '2026-12-31',
      monthlyRent: '1250.00',
    },
    {
      id: 'L-OLD',
      lessee: 'Delta Chemical',
      lessor: 'General American',
      from: '2020-01-01',
      to: '2023-12-31',
    },
  ],
  scaleTickets: [
    {
      number: 'ST-4411',
      carId: 'BNSF 400123',
      weighedOn: '2024-03-05',
      grossPounds: 258000,
      tarePounds: 62000,
      scaleId: 'MEM-1',
      certificateExpiresOn: '2024-12-31',
    },
    {
      number: 'ST-4412',
      carId: 'GATX 77',
      weighedOn: '2024-03-06',
      method: WEIGHING.ESTIMATED,
      grossPounds: 240000,
      tarePounds: 70000,
    },
  ],
});

const world = loadConfig(document);
const readFile = makeReadFile({ document });
const options = { config: 'world.json', asOf: '2024-03-31' };

describe('loading the equipment sections', () => {
  it('builds the leases and the tickets', () => {
    expect(world.leases).toHaveLength(2);
    expect(world.scaleTickets).toHaveLength(2);
  });

  it('takes records that are already built', () => {
    const twice = loadConfig({
      ...document,
      leases: world.leases,
      scaleTickets: world.scaleTickets,
    });
    expect(twice.leases).toHaveLength(2);
    expect(twice.scaleTickets[0].netPounds).toBe(196000);
  });

  it('loads happily with neither section', () => {
    const bare = loadConfig(sampleDocument());
    expect(bare.leases).toEqual([]);
    expect(bare.scaleTickets).toEqual([]);
  });
});

describe('leaseStateFor', () => {
  it('reports a car with no lease', () => {
    expect(leaseStateFor(world, 'BNSF 400123', '2024-03-31').state).toBe('none');
  });

  it('reports a lease in its term as active', () => {
    const found = leaseStateFor(world, 'GATX 77', '2024-03-31');
    expect(found.state).toBe('active');
    expect(found.lease.id).toBe('L-2024-11');
  });

  it('reports a lease whose term has run as expired', () => {
    expect(leaseStateFor(world, 'GATX 88', '2024-03-31').state).toBe('expired');
  });

  it('reports a lease that has not started yet apart from an expired one', () => {
    const future = loadConfig({
      ...document,
      cars: [{ id: 'GATX 99', designation: 'T', leaseId: 'L-FUTURE' }],
      leases: [
        {
          id: 'L-FUTURE',
          lessee: 'Delta',
          lessor: 'GATX',
          from: '2025-01-01',
          to: '2027-12-31',
        },
      ],
    });
    expect(leaseStateFor(future, 'GATX 99', '2024-03-31').state).toBe('not-yet-in-term');
  });

  it('reports nothing for a lease the car names but nobody filed', () => {
    expect(leaseStateFor(world, 'UP 512004', '2024-03-31').state).toBe('none');
  });
});

describe('weightFor', () => {
  it('caps the billed weight at the capacity when the net runs over it', () => {
    const heavy = loadConfig({
      ...document,
      scaleTickets: [
        {
          number: 'ST-9',
          carId: 'BNSF 400123',
          weighedOn: '2024-03-05',
          grossPounds: 280000,
          tarePounds: 62000,
          scaleId: 'MEM-1',
          certificateExpiresOn: '2024-12-31',
        },
      ],
    });
    expect(weightFor(heavy, heavy.cars.get('BNSF 400123')).weight).toBe(200000);
  });

  it('bills on the latest admissible ticket', () => {
    const found = weightFor(world, world.cars.get('BNSF 400123'));
    expect(found.weight).toBe(196000);
    expect(found.ticket.number).toBe('ST-4411');
  });

  it('reports the overload against the capacity', () => {
    expect(weightFor(world, world.cars.get('BNSF 400123')).overload).toBe(0);
  });

  it('has no weight and says why when the only ticket is an estimate', () => {
    const found = weightFor(world, world.cars.get('GATX 77'));
    expect(found.weight).toBeUndefined();
    expect(found.why).toMatch(/not a weight/);
  });

  it('says so when the car was never weighed', () => {
    expect(weightFor(world, world.cars.get('GATX 88')).why).toBe('never weighed');
  });
});

describe('fleetRows', () => {
  const rows = fleetRows(world, { asOf: '2024-03-31' });

  it('gives one row per car in register order', () => {
    expect(rows.map((row) => row.car)).toEqual(['BNSF 400123', 'GATX 77', 'GATX 88', 'UP 512004']);
  });

  it('names which book each car is billed under', () => {
    expect(rows.find((row) => row.car === 'BNSF 400123').book).toBe('demurrage');
    expect(rows.find((row) => row.car === 'GATX 77').book).toBe('storage');
  });

  it('flags an expired lease', () => {
    expect(rows.find((row) => row.car === 'GATX 88').flag).toContain('lease expired');
  });

  it('flags a lease the car names but nobody filed', () => {
    expect(rows.find((row) => row.car === 'UP 512004').flag).toContain('lease not on file');
  });

  it('flags a car whose only ticket cannot be used', () => {
    expect(rows.find((row) => row.car === 'GATX 77').flag).toMatch(/not a weight/);
  });

  it('does not flag a car that was simply never weighed', () => {
    expect(rows.find((row) => row.car === 'GATX 88').flag).not.toMatch(/never weighed/);
  });

  it('leaves a sound car unflagged', () => {
    expect(rows.find((row) => row.car === 'BNSF 400123').flag).toBe('');
  });
});

describe('fleetBody', () => {
  const asOf = '2024-03-31';

  it('prints a table with a footer', () => {
    const text = fleetBody(world, { asOf });
    expect(text).toContain('BNSF 400123');
    expect(text).toMatch(/cars\s+4/);
    expect(text).toMatch(/scale tickets\s+2/);
  });

  it('narrows to the flagged cars', () => {
    const text = fleetBody(world, { asOf, flagged: true });
    expect(text).not.toContain('BNSF 400123');
    expect(text).toContain('GATX 88');
  });

  it('narrows to one car', () => {
    const text = fleetBody(world, { asOf, car: 'gatx 77' });
    expect(text).toContain('GATX 77');
    expect(text).not.toContain('GATX 88');
  });

  it('writes JSON with the summary folded in', () => {
    const parsed = JSON.parse(fleetBody(world, { asOf, output: OUTPUT.JSON }));
    expect(parsed.summary.total).toBe(4);
    expect(parsed.rows).toHaveLength(4);
    expect(parsed.asOf).toBe(asOf);
  });

  it('writes CSV in a fixed column order', () => {
    expect(fleetBody(world, { asOf, output: OUTPUT.CSV }).split('\n')[0]).toBe(
      'car,type,ownership,book,lease,leaseState,weight,flag'
    );
  });

  it('says so when nothing is flagged', () => {
    const clean = loadConfig(sampleDocument());
    expect(fleetBody(clean, { asOf, flagged: true })).toBe('nothing flagged');
  });

  it('says so when the register is empty', () => {
    const empty = loadConfig(sampleDocument({ cars: [] }));
    expect(fleetBody(empty, { asOf })).toBe('no cars on the register');
  });
});

describe('leaseLines', () => {
  it('describes each lease and whether it is running', () => {
    const lines = leaseLines(world, '2024-03-31');
    expect(lines[0]).toContain('L-2024-11');
    expect(lines[0]).toContain('active');
    expect(lines[1]).toContain('not active');
  });
});

describe('runFleet', () => {
  it('reads the config and reports', () => {
    const { text, rows } = runFleet(options, { readFile });
    expect(rows).toHaveLength(4);
    expect(text).toContain('GATX 77');
  });

  it('needs a day to read the leases on', () => {
    expect(() => runFleet({ config: 'world.json' }, { readFile })).toThrow(ValidationError);
  });

  it('needs a config it can read', () => {
    expect(() => runFleet({ ...options, config: 'missing.json' }, { readFile })).toThrow(
      /could not read/
    );
  });

  it('refuses a car that is not on the register', () => {
    try {
      runFleet({ ...options, car: 'CN 90' }, { readFile });
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect(error.details.known).toBe(4);
    }
  });

  it('reads the leases on the day it was given', () => {
    const early = runFleet({ ...options, asOf: '2023-06-01' }, { readFile });
    const row = early.rows.find((entry) => entry.car === 'GATX 88');
    expect(row.leaseState).toBe('active');
  });
});
