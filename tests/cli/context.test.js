import { describe, expect, it } from 'vitest';
import {
  commandContext,
  loadWorld,
  readTextFile,
  reportError,
  resolveOutput,
  resolvePeriod,
} from '../../src/cli/context.js';
import { OUTPUT } from '../../src/cli/format.js';
import { IngestError, NotFoundError, ValidationError } from '../../src/core/errors.js';

const document = {
  stations: [{ splc: '412300', name: 'Memphis North', carrier: 'BNSF' }],
  tracks: [
    { id: 'IT-9', splc: '412300', name: 'Delta lead', capacityCars: 6, consigneeId: 'DELTA' },
  ],
  parties: [{ id: 'DELTA', name: 'Delta Chemical', noticeAddress: 'rail@delta.example' }],
  tariffs: [],
};

const readFile = (path) => {
  if (path.endsWith('world.json')) {
    return JSON.stringify(document);
  }
  if (path.endsWith('broken.json')) {
    return '{ not json';
  }
  throw new Error('ENOENT');
};

describe('readTextFile', () => {
  it('reads through the injected reader', () => {
    expect(readTextFile('world.json', { readFile })).toContain('412300');
  });

  it('wraps a read failure', () => {
    try {
      readTextFile('missing.json', { readFile });
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(IngestError);
      expect(error.details.path).toContain('missing.json');
    }
  });

  it('needs a path', () => {
    expect(() => readTextFile(undefined, { readFile })).toThrow(ValidationError);
  });
});

describe('loadWorld', () => {
  it('builds the world from the file', () => {
    const world = loadWorld('world.json', { readFile });
    expect(world.stations.size).toBe(1);
  });

  it('reports broken JSON as a validation failure', () => {
    expect(() => loadWorld('broken.json', { readFile })).toThrow(/not valid JSON/);
  });
});

describe('resolveOutput', () => {
  it('defaults to a table', () => {
    expect(resolveOutput(undefined)).toBe(OUTPUT.TABLE);
  });

  it('is case insensitive', () => {
    expect(resolveOutput('JSON')).toBe(OUTPUT.JSON);
    expect(resolveOutput('csv')).toBe(OUTPUT.CSV);
  });

  it('refuses anything else', () => {
    expect(() => resolveOutput('yaml')).toThrow(/table, csv or json/);
  });
});

describe('resolvePeriod', () => {
  it('takes a real month', () => {
    expect(resolvePeriod(' 202403 ')).toBe('202403');
  });

  it('refuses a month that does not exist', () => {
    expect(() => resolvePeriod('202413')).toThrow(/YYYYMM/);
    expect(() => resolvePeriod('2024')).toThrow(/YYYYMM/);
  });

  it('needs a value', () => {
    expect(() => resolvePeriod(undefined)).toThrow(ValidationError);
  });
});

describe('commandContext', () => {
  it('gathers the world and the options', () => {
    const context = commandContext(
      { config: 'world.json', output: 'json', period: '202403', asOf: '2024-04-05' },
      { readFile }
    );
    expect(context.world.stations.size).toBe(1);
    expect(context.output).toBe(OUTPUT.JSON);
    expect(context.period).toBe('202403');
    expect(context.asOf).toBe('2024-04-05');
  });

  it('leaves the period out when none was given', () => {
    const context = commandContext({ config: 'world.json' }, { readFile });
    expect(context.period).toBeUndefined();
    expect(context.output).toBe(OUTPUT.TABLE);
  });

  it('fails on a bad period before doing any work', () => {
    expect(() => commandContext({ config: 'world.json', period: 'March' }, { readFile })).toThrow(
      ValidationError
    );
  });
});

describe('reportError', () => {
  it('turns a domain error into a message and a code', () => {
    expect(reportError(new ValidationError('bad car'))).toEqual({
      message: 'validation: bad car',
      code: 2,
    });
  });

  it('names the code on any of ours', () => {
    expect(reportError(new NotFoundError('tariff', 'X')).message).toBe(
      'not_found: no tariff found for X'
    );
  });

  it('marks anything else as unexpected', () => {
    expect(reportError(new TypeError('boom'))).toEqual({ message: 'unexpected: boom', code: 70 });
  });
});
