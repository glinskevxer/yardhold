import { describe, expect, it } from 'vitest';
import { documentCounts, runValidate, validateBody } from '../../../src/cli/commands/validate.js';
import { loadConfig } from '../../../src/config/loadConfig.js';
import { validateWorld } from '../../../src/config/validate.js';
import { OUTPUT } from '../../../src/cli/format.js';
import { SERVICE } from '../../../src/tariff/freeTimeTable.js';
import { ValidationError } from '../../../src/core/errors.js';

const page = {
  id: 'DEM-4000',
  carrier: 'BNSF',
  ladder: [{ fromDay: 1, rate: '150.00' }],
  freeTime: [{ service: SERVICE.UNLOADING, days: 1 }],
};

const sound = {
  settings: { years: [2024] },
  stations: [{ splc: '412300', name: 'Memphis North', carrier: 'BNSF' }],
  tracks: [
    { id: 'IT-9', splc: '412300', name: 'Delta lead', capacityCars: 6, consigneeId: 'DELTA' },
  ],
  parties: [{ id: 'DELTA', name: 'Delta Chemical', noticeAddress: 'a@b.example' }],
  tariffs: [{ page, effectiveFrom: '2024-01-01' }],
};

const warned = {
  ...sound,
  parties: [...sound.parties, { id: 'ACME', name: 'Acme', noticeAddress: 'c@d.example' }],
};

const broken = { ...sound, tracks: [{ ...sound.tracks[0], consigneeId: 'NOBODY' }] };

const readFile = (path) => {
  if (path.endsWith('sound.json')) {
    return JSON.stringify(sound);
  }
  if (path.endsWith('warned.json')) {
    return JSON.stringify(warned);
  }
  if (path.endsWith('broken.json')) {
    return JSON.stringify(broken);
  }
  throw new Error('ENOENT');
};

describe('runValidate', () => {
  it('passes a sound configuration', () => {
    const { text, problems } = runValidate({ config: 'sound.json' }, { readFile });
    expect(problems).toEqual([]);
    expect(text).toContain('nothing to report');
  });

  it('reports the counts', () => {
    const { text } = runValidate({ config: 'sound.json' }, { readFile });
    expect(text).toContain('stations');
    expect(text).toContain('tariffs');
  });

  it('passes a configuration that only has warnings', () => {
    const { problems } = runValidate({ config: 'warned.json' }, { readFile });
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.every((entry) => entry.severity === 'warning')).toBe(true);
  });

  it('hides the warnings unless strict was asked for', () => {
    const quiet = runValidate({ config: 'warned.json' }, { readFile });
    const loud = runValidate({ config: 'warned.json', strict: true }, { readFile });
    expect(quiet.text).toContain('not shown');
    expect(loud.text).toContain('party-has-no-track');
  });

  it('refuses a configuration with an error', () => {
    try {
      runValidate({ config: 'broken.json' }, { readFile });
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect(error.details.errors).toBe(1);
      expect(error.details.first.code).toBe('track-consignee-missing');
    }
  });

  it('can be told to refuse a warning as well', () => {
    expect(() => runValidate({ config: 'warned.json', failOnWarning: true }, { readFile })).toThrow(
      /strict was asked for/
    );
  });

  it('lets a sound configuration through even in that mode', () => {
    expect(
      runValidate({ config: 'sound.json', failOnWarning: true }, { readFile }).problems
    ).toEqual([]);
  });

  it('needs a config it can read', () => {
    expect(() => runValidate({ config: 'missing.json' }, { readFile })).toThrow(/could not read/);
  });
});

describe('validateBody', () => {
  const world = loadConfig(warned);
  const problems = validateWorld(world);

  it('writes the summary and the problems as JSON', () => {
    const parsed = JSON.parse(validateBody(world, problems, { output: OUTPUT.JSON }));
    expect(parsed.summary.parties).toBe(2);
    expect(parsed.problems.length).toBe(problems.length);
  });

  it('writes every problem as CSV whatever strict says', () => {
    const csv = validateBody(world, problems, { output: OUTPUT.CSV });
    expect(csv.split('\n')[0]).toBe('severity,code,where,detail');
    expect(csv).toContain('party-has-no-track');
  });

  it('says nothing to report when there is nothing', () => {
    const clean = loadConfig(sound);
    expect(validateBody(clean, [])).toContain('nothing to report');
  });
});

describe('documentCounts', () => {
  it('counts each section of the raw document', () => {
    const counts = documentCounts(sound);
    expect(counts.stations).toBe(1);
    expect(counts.waybills).toBe(0);
  });
});
