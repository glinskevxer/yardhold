import { describe, expect, it } from 'vitest';
import { VERSION, buildProgram, commandNames, optionsOf } from '../../src/cli/program.js';
import { main } from '../../src/cli/program.js';
import { SERVICE } from '../../src/tariff/freeTimeTable.js';

const document = {
  settings: { years: [2024] },
  stations: [{ splc: '412300', name: 'Memphis North', carrier: 'BNSF' }],
  tracks: [
    { id: 'IT-9', splc: '412300', name: 'Delta lead', capacityCars: 6, consigneeId: 'DELTA' },
  ],
  parties: [{ id: 'DELTA', name: 'Delta Chemical', noticeAddress: 'a@b.example' }],
  tariffs: [
    {
      page: {
        id: 'DEM-4000',
        carrier: 'BNSF',
        notificationRequired: false,
        ladder: [{ fromDay: 1, rate: '150.00' }],
        freeTime: [{ service: SERVICE.UNLOADING, days: 1 }],
      },
      effectiveFrom: '2024-01-01',
    },
  ],
};

const feed = [
  'car,event,event_time,track',
  'BNSF 400123,AP,2024-03-04T00:00,IT-9',
  'BNSF 400123,REL,2024-03-08T00:00,IT-9',
  '',
].join('\n');

const readFile = (path) => {
  if (path.endsWith('world.json')) {
    return JSON.stringify(document);
  }
  if (path.endsWith('events.csv')) {
    return feed;
  }
  throw new Error('ENOENT');
};

function harness() {
  const out = [];
  const errs = [];
  const codes = [];
  const files = [];
  return {
    out,
    errs,
    codes,
    files,
    deps: {
      readFile,
      write: (text) => out.push(text),
      fail: (text) => errs.push(text),
      exit: (code) => codes.push(code),
      writeFile: (path, text) => files.push({ path, text }),
      mkdir: () => {},
    },
  };
}

const common = ['-c', 'world.json', '-e', 'events.csv', '-p', '202403', '-r', 'BNSF'];

describe('buildProgram', () => {
  it('names itself and carries a version', () => {
    const program = buildProgram(harness().deps);
    expect(program.name()).toBe('spurtally');
    expect(program.version()).toBe(VERSION);
  });

  it('registers every command', () => {
    const program = buildProgram(harness().deps);
    expect(program.commands.map((command) => command.name()).sort()).toEqual([
      'assess',
      'explain',
      'invoice',
      'report',
    ]);
  });
});

describe('assess', () => {
  it('prints the table', async () => {
    const rig = harness();
    const code = await main(['assess', ...common], rig.deps);
    expect(code).toBe(0);
    expect(rig.out[0]).toContain('BNSF 400123');
    expect(rig.out[0]).toContain('total 450.00');
  });

  it('takes the detail flag', async () => {
    const rig = harness();
    await main(['assess', ...common, '--detail'], rig.deps);
    expect(rig.out[0]).toContain('placement');
  });

  it('takes an output format', async () => {
    const rig = harness();
    await main(['assess', ...common, '-o', 'json'], rig.deps);
    expect(JSON.parse(rig.out[0]).period).toBe('202403');
  });
});

describe('invoice', () => {
  it('needs an issue date', async () => {
    const rig = harness();
    const code = await main(['invoice', ...common], rig.deps);
    expect(code).not.toBe(0);
    expect(rig.out).toEqual([]);
  });

  it('prints the invoice', async () => {
    const rig = harness();
    await main(['invoice', ...common, '-i', '2024-04-05'], rig.deps);
    expect(rig.out[0]).toContain('Invoice INV-202403-00001');
  });
});

describe('explain', () => {
  it('explains one car', async () => {
    const rig = harness();
    await main(['explain', ...common, '-k', 'bnsf400123'], rig.deps);
    expect(rig.out[0]).toContain('DEM-4000');
    expect(rig.out[0]).toContain('free days');
  });

  it('reports a car it cannot find without a stack', async () => {
    const rig = harness();
    await main(['explain', ...common, '-k', 'GATX 77'], rig.deps);
    expect(rig.out).toEqual([]);
    expect(rig.errs[0]).toMatch(/^not_found:/);
    expect(rig.codes).toEqual([2]);
  });
});

describe('report', () => {
  it('runs the exception report by default', async () => {
    const rig = harness();
    await main(['report', ...common], rig.deps);
    expect(rig.out[0]).toBe('no exceptions');
  });

  it('runs the month figures when asked', async () => {
    const rig = harness();
    await main(['report', ...common, '-t', 'kpi'], rig.deps);
    expect(rig.out[0]).toContain('chargeable days');
    expect(rig.out[0]).toContain('gross');
  });

  it('runs the dwell report when asked', async () => {
    const rig = harness();
    await main(['report', ...common, '-t', 'dwell'], rig.deps);
    expect(rig.out[0]).toContain('plant');
  });

  it('refuses a report it does not have', async () => {
    const rig = harness();
    await main(['report', ...common, '-t', 'weather'], rig.deps);
    expect(rig.errs[0]).toMatch(/^validation:/);
  });
});

describe('failures', () => {
  it('turns a missing file into a message', async () => {
    const rig = harness();
    await main(
      ['assess', '-c', 'nope.json', '-e', 'events.csv', '-p', '202403', '-r', 'BNSF'],
      rig.deps
    );
    expect(rig.errs[0]).toMatch(/^ingest:/);
    expect(rig.codes).toEqual([2]);
  });

  it('turns a bad period into a message', async () => {
    const rig = harness();
    await main(
      ['assess', '-c', 'world.json', '-e', 'events.csv', '-p', 'March', '-r', 'BNSF'],
      rig.deps
    );
    expect(rig.errs[0]).toMatch(/^validation:/);
  });

  it('returns a non zero code for an unknown command', async () => {
    const rig = harness();
    const code = await main(['nonesuch'], rig.deps);
    expect(code).not.toBe(0);
  });
});

describe('writing to a file', () => {
  it('writes rather than printing when out is given', async () => {
    const rig = harness();
    await main(['assess', ...common, '-o', 'csv', '--out', 'out/march.csv'], rig.deps);
    expect(rig.files).toHaveLength(1);
    expect(rig.files[0].text).toContain('BNSF 400123');
    expect(rig.out[0]).toMatch(/^wrote /);
  });

  it('refuses a name that disagrees with the format', async () => {
    const rig = harness();
    await main(['assess', ...common, '-o', 'json', '--out', 'out/march.csv'], rig.deps);
    expect(rig.files).toEqual([]);
    expect(rig.errs[0]).toMatch(/^validation:/);
  });

  it('gives every command the flag', () => {
    const program = buildProgram(harness().deps);
    for (const name of commandNames(program)) {
      expect(optionsOf(program, name)).toContain('--out');
    }
  });
});

describe('the help', () => {
  it('lists every command through the helper', () => {
    expect(commandNames(buildProgram(harness().deps))).toEqual([
      'assess',
      'explain',
      'invoice',
      'report',
    ]);
  });

  it('gives every command the shared options', () => {
    const program = buildProgram(harness().deps);
    for (const name of commandNames(program)) {
      const options = optionsOf(program, name);
      expect(options).toContain('--config');
      expect(options).toContain('--events');
      expect(options).toContain('--period');
      expect(options).toContain('--carrier');
      expect(options).toContain('--output');
    }
  });

  it('gives invoice its issue date and explain its car', () => {
    const program = buildProgram(harness().deps);
    expect(optionsOf(program, 'invoice')).toContain('--issued-on');
    expect(optionsOf(program, 'explain')).toContain('--car');
    expect(optionsOf(program, 'assess')).toContain('--detail');
  });

  it('has nothing to say about a command it does not have', () => {
    expect(optionsOf(buildProgram(harness().deps), 'nonesuch')).toEqual([]);
  });

  it('prints worked examples after the option list', () => {
    const program = buildProgram(harness().deps);
    let help = '';
    program.configureOutput({ writeOut: (text) => (help += text) });
    program.outputHelp();
    expect(help).toContain('Examples:');
    expect(help).toContain('spurtally invoice');
    expect(help).toContain('page in force on the day');
  });
});

describe('the version', () => {
  it('matches the package', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'));
    expect(VERSION).toBe(packageJson.version);
  });

  it('is a plain semantic version', () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
