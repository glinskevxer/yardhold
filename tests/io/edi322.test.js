import { describe, expect, it } from 'vitest';
import {
  STATUS_TO_EVENT,
  isLikely322,
  parseDateTime,
  readEdi322,
  readSegments,
  splitSegments,
} from '../../src/io/edi322.js';
import { IngestError, ValidationError } from '../../src/core/errors.js';

const feed = [
  'ST*322*0001',
  'N7*BNSF*400123',
  'N9*TR*IT-9',
  'R4*AC*20240304*0715',
  'R4*AD*20240309*1620',
  'N7*UP*512004',
  'N9*TR*HT-1',
  'R4*AB*20240304*0600',
  'SE*8*0001',
  '',
].join('~');

describe('splitSegments', () => {
  it('splits on the terminator and the separator', () => {
    expect(splitSegments('N7*BNSF*400123~R4*AC*20240304*0715~')).toEqual([
      ['N7', 'BNSF', '400123'],
      ['R4', 'AC', '20240304', '0715'],
    ]);
  });

  it('drops empty segments and trims', () => {
    expect(splitSegments('  ~ N7 * BNSF * 400123 ~ ')).toEqual([['N7', 'BNSF', '400123']]);
  });

  it('needs a string', () => {
    expect(() => splitSegments(undefined)).toThrow(ValidationError);
  });
});

describe('parseDateTime', () => {
  it('reads the date and the clock', () => {
    expect(parseDateTime('20240304', '0715')).toBe('2024-03-04T07:15');
  });

  it('defaults a missing time to midnight', () => {
    expect(parseDateTime('20240304')).toBe('2024-03-04T00:00');
    expect(parseDateTime('20240304', '')).toBe('2024-03-04T00:00');
  });

  it('refuses a date that is not eight digits', () => {
    expect(() => parseDateTime('2024304')).toThrow(IngestError);
    expect(() => parseDateTime(undefined)).toThrow(IngestError);
  });

  it('refuses a time that is not four digits', () => {
    expect(() => parseDateTime('20240304', '715')).toThrow(IngestError);
  });
});

describe('readEdi322', () => {
  const { events, problems } = readEdi322(feed);

  it('reads a car per N7', () => {
    expect([...new Set(events.map((event) => event.carId))]).toEqual(['BNSF 400123', 'UP 512004']);
  });

  it('maps the status codes to event codes', () => {
    expect(events.map((event) => event.code)).toEqual(['AP', 'REL', 'CP']);
  });

  it('attaches the track from the N9', () => {
    expect(events[0].trackId).toBe('IT-9');
    expect(events[2].trackId).toBe('HT-1');
  });

  it('clears the track when a new car starts', () => {
    const short = readEdi322(
      'N7*BNSF*1~N9*TR*IT-9~R4*AC*20240304*0715~N7*UP*3~R4*AC*20240304*0800~'
    );
    expect(short.events[1].trackId).toBeUndefined();
  });

  it('has nothing to complain about', () => {
    expect(problems).toEqual([]);
  });
});

describe('what it sets aside', () => {
  it('notes a status code it does not know', () => {
    const { problems } = readEdi322('N7*BNSF*1~R4*ZZ*20240304*0715~');
    expect(problems[0].kind).toBe('unknown-status');
    expect(problems[0].status).toBe('ZZ');
  });

  it('notes a status before any car', () => {
    const { problems } = readEdi322('R4*AC*20240304*0715~');
    expect(problems[0].kind).toBe('status-before-car');
  });

  it('notes a status with a broken date', () => {
    const { problems } = readEdi322('N7*BNSF*1~R4*AC*2024*0715~');
    expect(problems[0].kind).toBe('bad-status');
    expect(problems[0].carId).toBe('BNSF 1');
  });

  it('ignores segments it has no use for', () => {
    const { events, problems } = readEdi322('ISA*00*~GS*SR*~N7*BNSF*1~R4*AC*20240304*0715~SE*3*1~');
    expect(events).toHaveLength(1);
    expect(problems).toEqual([]);
  });

  it('reads a Y6 the same as an R4', () => {
    const { events } = readEdi322('N7*BNSF*1~Y6*AD*20240309*1620~');
    expect(events[0].code).toBe('REL');
  });
});

describe('readSegments', () => {
  it('takes already split segments', () => {
    const { events } = readSegments([
      ['N7', 'BNSF', '1'],
      ['R4', 'AC', '20240304', '0715'],
    ]);
    expect(events).toHaveLength(1);
  });

  it('reads at the offset it is given', () => {
    const central = readSegments([
      ['N7', 'BNSF', '1'],
      ['R4', 'AC', '20240304', '0715'],
    ]);
    const utc = readSegments(
      [
        ['N7', 'BNSF', '1'],
        ['R4', 'AC', '20240304', '0715'],
      ],
      {
        offsetMinutes: 0,
      }
    );
    expect(central.events[0].at).not.toBe(utc.events[0].at);
  });
});

describe('isLikely322', () => {
  it('spots a transaction set', () => {
    expect(isLikely322(feed)).toBe(true);
    expect(isLikely322('N7*BNSF*400123~')).toBe(true);
  });

  it('does not mistake a CSV for one', () => {
    expect(isLikely322('car,event,event_time\nBNSF 1,AP,2024-03-04T07:15')).toBe(false);
    expect(isLikely322(undefined)).toBe(false);
  });

  it('covers every mapped status', () => {
    expect(Object.keys(STATUS_TO_EVENT).length).toBeGreaterThan(6);
  });
});
