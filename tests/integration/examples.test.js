import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { main } from '../../src/cli/program.js';
import { parseDocument } from '../../src/config/schema.js';
import { loadConfig, worldSummary } from '../../src/config/loadConfig.js';

const root = resolve(process.cwd());
const config = resolve(root, 'examples/memphis-north.json');
const events = resolve(root, 'examples/march-2024.csv');

const common = ['-c', config, '-e', events, '-p', '202403', '-r', 'BNSF'];

function harness() {
  const out = [];
  const errs = [];
  return {
    out,
    errs,
    deps: { write: (text) => out.push(text), fail: (text) => errs.push(text), exit: () => {} },
  };
}

describe('the shipped example configuration', () => {
  const world = loadConfig(parseDocument(readFileSync(config, 'utf8')));

  it('loads', () => {
    expect(worldSummary(world)).toEqual({
      stations: 2,
      tracks: 3,
      parties: 2,
      cars: 4,
      calendars: 2,
      tariffs: 2,
      agreements: 1,
      orders: 2,
      exclusions: 1,
      commodities: 6,
      waybills: 2,
      supplements: 0,
      leases: 1,
      scaleTickets: 2,
    });
  });

  it('carries both tariff pages', () => {
    expect(world.tariffs.pageIds()).toEqual(['CON-DELTA-2024', 'DEM-4000']);
  });

  it('picks the contract page for Delta and the public page for Yazoo', () => {
    expect(
      world.tariffs.resolve({ carrier: 'BNSF', consigneeId: 'DELTA', on: '2024-03-04' }).id
    ).toBe('CON-DELTA-2024');
    expect(
      world.tariffs.resolve({ carrier: 'BNSF', consigneeId: 'YAZOO', on: '2024-03-04' }).id
    ).toBe('DEM-4000');
  });
});

describe('assess against the example', () => {
  it('assesses every car in the feed', async () => {
    const rig = harness();
    const code = await main(['assess', ...common], rig.deps);
    expect(code).toBe(0);
    expect(rig.errs).toEqual([]);
    for (const car of ['BNSF 400123', 'BNSF 400188', 'UP 512004', 'GATX 77']) {
      expect(rig.out[0]).toContain(car);
    }
  });

  it('reports a total', async () => {
    const rig = harness();
    await main(['assess', ...common, '-o', 'json'], rig.deps);
    const parsed = JSON.parse(rig.out[0]);
    expect(parsed.skipped).toEqual([]);
    expect(parsed.total).toBeGreaterThan(0);
    expect(parsed.rows).toHaveLength(4);
  });

  it('gives the two Delta boxcars the contract page', async () => {
    const rig = harness();
    await main(['assess', ...common, '-o', 'json'], rig.deps);
    const rows = JSON.parse(rig.out[0]).rows;
    const delta = rows.filter((row) => row.consignee === 'DELTA');
    expect(delta.every((row) => row.page === 'CON-DELTA-2024')).toBe(true);
  });
});

describe('explain against the example', () => {
  it('credits the March storm to the hopper held outside', async () => {
    const rig = harness();
    await main(['explain', ...common, '-k', 'UP 512004', '-o', 'json'], rig.deps);
    const explanation = JSON.parse(rig.out[0]);
    expect(explanation.reliefApplied.length + explanation.reliefDeclined.length).toBeGreaterThan(0);
    expect(explanation.detentions.length).toBeGreaterThan(1);
  });

  it('shows the free day and the charged days for the first boxcar', async () => {
    const rig = harness();
    await main(['explain', ...common, '-k', 'BNSF 400123', '-o', 'json'], rig.deps);
    const explanation = JSON.parse(rig.out[0]);
    expect(explanation.freeDays.length).toBe(2);
    expect(explanation.chargedDays.length).toBeGreaterThan(0);
  });
});

describe('invoice against the example', () => {
  it('cuts one invoice per consignee', async () => {
    const rig = harness();
    await main(['invoice', ...common, '-i', '2024-04-05'], rig.deps);
    expect(rig.out[0]).toContain('Consignee DELTA');
    expect(rig.out[0]).toContain('Consignee YAZOO');
  });

  it('settles Delta on its average agreement', async () => {
    const rig = harness();
    await main(['invoice', ...common, '-i', '2024-04-05'], rig.deps);
    expect(rig.out[0]).toContain('on average');
  });

  it('bills Yazoo day by day', async () => {
    const rig = harness();
    await main(['invoice', ...common, '-i', '2024-04-05', '-o', 'json'], rig.deps);
    const invoices = JSON.parse(rig.out[0]);
    const yazoo = invoices.find((record) => record.consigneeId === 'YAZOO');
    expect(yazoo.lines.every((line) => line.description.startsWith('demurrage day'))).toBe(true);
  });
});
