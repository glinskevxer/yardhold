import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COLUMN_MAP,
  ingestCsv,
  ingestRecords,
  ingestSummary,
  mapRow,
} from '../../src/io/ingestEvents.js';
import { EVENT_SOURCE } from '../../src/events/event.js';
import { IngestError, ValidationError } from '../../src/core/errors.js';

const goodCsv = [
  'car,event,event_time,track',
  'BNSF 400123,AP,2024-03-07T08:00,IT-9',
  'BNSF 400123,REL,2024-03-09T10:00,IT-9',
  'GATX 77,CP,2024-03-07T06:00,HT-1',
  '',
].join('\n');

describe('mapRow', () => {
  it('reads whichever column name the carrier used', () => {
    const record = mapRow({
      equipment_id: 'bnsf400123',
      status: 'ap',
      datetime: '2024-03-07T08:00',
    });
    expect(record.carId).toBe('BNSF 400123');
    expect(record.code).toBe('AP');
  });

  it('ignores blank columns and falls through to the next name', () => {
    const record = mapRow({ car: '  ', equipment: 'UP 3', code: 'AP', at: '2024-03-07T08:00' });
    expect(record.carId).toBe('UP 3');
  });

  it('names what is missing', () => {
    expect(() => mapRow({ code: 'AP', at: '2024-03-07T08:00' })).toThrow(/does not name a car/);
    expect(() => mapRow({ car: 'UP 3', at: '2024-03-07T08:00' })).toThrow(/event code/);
    expect(() => mapRow({ car: 'UP 3', code: 'AP' })).toThrow(/timestamp/);
  });

  it('stamps the source it was told', () => {
    const record = mapRow(
      { car: 'UP 3', code: 'AP', at: '2024-03-07T08:00', reason: 'phoned in' },
      { source: EVENT_SOURCE.OFFICE }
    );
    expect(record.source).toBe(EVENT_SOURCE.OFFICE);
  });

  it('takes a column map of its own', () => {
    const record = mapRow(
      { unit: 'UP 3', kind: 'AP', when: '2024-03-07T08:00' },
      { columnMap: { carId: ['unit'], code: ['kind'], at: ['when'] } }
    );
    expect(record.carId).toBe('UP 3');
  });

  it('refuses a row that is not an object', () => {
    expect(() => mapRow('nope')).toThrow(ValidationError);
  });

  it('ships a default map naming several aliases each', () => {
    expect(DEFAULT_COLUMN_MAP.carId.length).toBeGreaterThan(2);
  });
});

describe('ingestRecords', () => {
  it('keeps the good rows and sets the bad ones aside', () => {
    const { events, rejects } = ingestRecords([
      { car: 'UP 3', code: 'AP', at: '2024-03-07T08:00' },
      { car: 'UP 3', code: 'ZZZ', at: '2024-03-07T09:00' },
      { code: 'AP', at: '2024-03-07T10:00' },
    ]);
    expect(events).toHaveLength(1);
    expect(rejects).toHaveLength(2);
  });

  it('numbers the reject by the line it came from', () => {
    const { rejects } = ingestRecords([
      { car: 'UP 3', code: 'AP', at: '2024-03-07T08:00' },
      { car: 'UP 3', code: 'AP' },
    ]);
    expect(rejects[0].line).toBe(3);
    expect(rejects[0].code).toBe('INGEST');
  });

  it('lets a programming error through rather than swallowing it', () => {
    expect(() =>
      ingestRecords([{ car: 'UP 3', code: 'AP', at: '2024-03-07T08:00' }], {
        columnMap: {
          get carId() {
            throw new TypeError('boom');
          },
        },
      })
    ).toThrow(TypeError);
  });
});

describe('ingestCsv', () => {
  it('reads a clean file', () => {
    const result = ingestCsv(goodCsv);
    expect(result.read).toBe(3);
    expect(result.events).toHaveLength(3);
    expect(result.rejects).toEqual([]);
    expect(result.problems).toEqual([]);
  });

  it('sorts what it read', () => {
    const codes = ingestCsv(goodCsv).events.map((record) => record.code);
    expect(codes).toEqual(['CP', 'AP', 'REL']);
  });

  it('carries the normaliser problems through', () => {
    const csv = ['car,event,event_time', 'UP 3,REL,2024-03-09T10:00', ''].join('\n');
    const result = ingestCsv(csv);
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0].kind).toBe('stop-before-start');
  });

  it('refuses a ragged file outright', () => {
    const csv = ['car,event,event_time', 'UP 3,REL', ''].join('\n');
    expect(() => ingestCsv(csv)).toThrow(IngestError);
  });

  it('reads an empty file as nothing', () => {
    expect(ingestCsv('')).toEqual({ events: [], problems: [], rejects: [], read: 0 });
  });
});

describe('ingestSummary', () => {
  it('counts the four numbers the clerk looks at', () => {
    expect(ingestSummary(ingestCsv(goodCsv))).toEqual({
      read: 3,
      accepted: 3,
      rejected: 0,
      problems: 0,
    });
  });
});
