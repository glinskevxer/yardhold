import { describe, expect, it } from 'vitest';
import {
  commandContext,
  loadRun,
  loadWorld,
  readTextFile,
  reportError,
  resolveOutput,
  resolvePeriod,
} from '../../src/cli/context.js';
import { OUTPUT } from '../../src/cli/format.js';
import { SERVICE } from '../../src/tariff/freeTimeTable.js';
import { IngestError, NotFoundError, ValidationError } from '../../src/core/errors.js';

const document = {
  stations: [{ splc: '412300', name: 'Memphis North', carrier: 'BNSF' }],
  tracks: [
    { id: 'IT-9', splc: '412300', name: 'Delta lead', capacityCars: 6, consigneeId: 'DELTA' },
  ],
  parties: [{ id: 'DELTA', name: 'Delta Chemical', noticeAddress: 'rail@delta.example' }],
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

describe('loadRun', () => {
  const options = {
    config: 'world.json',
    events: 'events.csv',
    period: '202403',
    carrier: 'BNSF',
  };

  it('builds the world, reads the feed and assesses the month', () => {
    const { context, feed: read, result } = loadRun(options, { readFile });
    expect(context.world.stations.size).toBe(1);
    expect(read.events).toHaveLength(2);
    expect(result.assessments).toHaveLength(1);
  });

  it('reads the feed at the offset the world declares', () => {
    const { feed: read } = loadRun(options, { readFile });
    expect(read.events[0].offsetMinutes).toBe(-360);
  });

  it('passes the period and the carrier through', () => {
    const { result } = loadRun(options, { readFile });
    expect(result.period).toBe('202403');
    expect(result.skipped).toEqual([]);
  });

  it('fails on the config before it reads the feed', () => {
    expect(() => loadRun({ ...options, config: 'missing.json' }, { readFile })).toThrow(
      IngestError
    );
  });

  it('fails on a feed it cannot read', () => {
    expect(() => loadRun({ ...options, events: 'missing.csv' }, { readFile })).toThrow(IngestError);
  });
});
