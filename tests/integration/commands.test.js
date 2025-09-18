import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildProgram, commandNames, main } from '../../src/cli/program.js';

/**
 * Every registered command, run against the shipped example.
 *
 * The per-command tests all drive their own small fixture, so a command can
 * pass its own suite and still fall over on the real configuration. This walks
 * the list the program actually registers rather than a list written out here,
 * so a command added without a smoke test fails this file instead of quietly
 * going uncovered.
 */

const root = resolve(process.cwd());
const config = resolve(root, 'examples/memphis-north.json');
const events = resolve(root, 'examples/march-2024.csv');
const carrier = resolve(root, 'examples/carrier-march-2024.csv');

function harness() {
  const out = [];
  const errs = [];
  const codes = [];
  return {
    out,
    errs,
    codes,
    deps: {
      write: (text) => out.push(text),
      fail: (text) => errs.push(text),
      exit: (code) => codes.push(code),
    },
  };
}

const month = ['-c', config, '-e', events, '-p', '202403', '-r', 'BNSF'];

const INVOCATIONS = {
  assess: month,
  invoice: [...month, '-i', '2024-04-05'],
  explain: [...month, '-k', 'BNSF 400123'],
  report: month,
  statement: month,
  settle: [...month, '-i', '2024-04-05'],
  reconcile: [...month, '-b', carrier],
  hire: month,
  fleet: ['-c', config, '-a', '2024-03-31'],
  validate: ['-c', config],
  history: ['-c', config, '-r', 'BNSF', '-m', `202403:${events}`],
};

describe('the command list', () => {
  it('covers every command the program registers', () => {
    const registered = commandNames(buildProgram(harness().deps));
    expect(registered.sort()).toEqual(Object.keys(INVOCATIONS).sort());
  });
});

describe.each(Object.entries(INVOCATIONS))('%s against the example', (name, argv) => {
  it('exits clean and writes something', async () => {
    const rig = harness();
    const code = await main([name, ...argv], rig.deps);
    expect(rig.errs, `${name} wrote to stderr`).toEqual([]);
    expect(code).toBe(0);
    expect(rig.out).toHaveLength(1);
    expect(rig.out[0].length).toBeGreaterThan(0);
  });

  it('writes JSON that parses', async () => {
    const rig = harness();
    const code = await main([name, ...argv, '-o', 'json'], rig.deps);
    expect(code).toBe(0);
    expect(() => JSON.parse(rig.out[0])).not.toThrow();
  });

  it('writes CSV without falling over', async () => {
    const rig = harness();
    const code = await main([name, ...argv, '-o', 'csv'], rig.deps);
    expect(rig.errs).toEqual([]);
    expect(code).toBe(0);
  });
});

describe('every report kind against the example', () => {
  const kinds = ['exceptions', 'kpi', 'dwell', 'register', 'trips', 'capacity', 'interchange'];

  it.each(kinds)('%s runs', async (kind) => {
    const rig = harness();
    const code = await main(['report', ...month, '-t', kind], rig.deps);
    expect(rig.errs).toEqual([]);
    expect(code).toBe(0);
    expect(rig.out[0].length).toBeGreaterThan(0);
  });

  it('refuses a kind it does not have', async () => {
    const rig = harness();
    await main(['report', ...month, '-t', 'weather'], rig.deps);
    expect(rig.errs[0]).toMatch(/^validation:/);
  });
});

describe('the shipped example holds together', () => {
  it('validates with no errors and no warnings', async () => {
    const rig = harness();
    const code = await main(['validate', '-c', config, '--strict', '--fail-on-warning'], rig.deps);
    expect(rig.errs).toEqual([]);
    expect(code).toBe(0);
  });

  it('is the configuration the package ships', () => {
    const declared = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
    expect(declared.files).toContain('examples/');
  });

  it('demonstrates bunching relief', async () => {
    const rig = harness();
    await main(['assess', ...month, '-o', 'json'], rig.deps);
    const rows = JSON.parse(rig.out[0]).rows;
    expect(rows.some((row) => row.bunched > 0)).toBe(true);
  });

  it('demonstrates relief that was declined as well as applied', async () => {
    const rig = harness();
    await main(['explain', ...month, '-k', 'UP 512004', '-o', 'json'], rig.deps);
    const explanation = JSON.parse(rig.out[0]);
    expect(explanation.reliefApplied.length).toBeGreaterThan(0);
  });
});
