import { describe, expect, it } from 'vitest';
import {
  REPORT,
  dwellBody,
  registerBody,
  capacityBody,
  placementRecords,
  tripRows,
  tripsBody,
  exceptionsBody,
  kpiBody,
  reportBody,
  runReport,
} from '../../../src/cli/commands/report.js';
import { OUTPUT } from '../../../src/cli/format.js';
import { ValidationError } from '../../../src/core/errors.js';
import { loadConfig } from '../../../src/config/loadConfig.js';
import { makeReadFile, sampleDocument, sampleOptions } from '../../fixtures/world.js';

const feed = [
  'car,event,event_time,track',
  'BNSF 400123,ARR,2024-03-03T20:00,',
  'BNSF 400123,AP,2024-03-04T00:00,IT-9',
  'BNSF 400123,REL,2024-03-08T00:00,IT-9',
  'UP 3,AP,2024-03-04T00:00,FOREIGN-1',
  '',
].join('\n');

const readFile = makeReadFile({ feed });
const options = { ...sampleOptions };

const { result } = runReport(options, { readFile });

describe('exceptionsBody', () => {
  it('lists the car it could not assess', () => {
    const text = exceptionsBody(result, OUTPUT.TABLE);
    expect(text).toContain('not-assessed');
    expect(text).toContain('UP 3');
  });

  it('says so when there is nothing', () => {
    expect(exceptionsBody({ assessments: [], skipped: [] }, OUTPUT.TABLE)).toBe('no exceptions');
  });

  it('writes an empty CSV rather than a message', () => {
    expect(exceptionsBody({ assessments: [], skipped: [] }, OUTPUT.CSV)).toBe('');
  });
});

describe('kpiBody', () => {
  it('lays the figures out as a block', () => {
    const text = kpiBody(result, OUTPUT.TABLE);
    expect(text).toContain('cars');
    expect(text).toContain('over free time share');
    expect(text).toContain('gross');
  });

  it('writes JSON with the relief figures folded in', () => {
    const parsed = JSON.parse(kpiBody(result, OUTPUT.JSON));
    expect(parsed.period).toBe('202403');
    expect(parsed.relief.applied).toBe(0);
    expect(parsed.chargeableDays).toBe(3);
  });

  it('writes a single CSV row', () => {
    const csv = kpiBody(result, OUTPUT.CSV);
    expect(csv.trim().split('\n')).toHaveLength(2);
  });
});

describe('dwellBody', () => {
  it('reports a row per car in days', () => {
    const text = dwellBody(result, OUTPUT.TABLE);
    expect(text).toContain('BNSF 400123');
    expect(text).toContain('plant');
  });

  it('carries the summary in the JSON', () => {
    const parsed = JSON.parse(dwellBody(result, OUTPUT.JSON));
    expect(parsed.summary.plantMinutes.cars).toBe(1);
    expect(parsed.rows).toHaveLength(1);
  });

  it('measures the yard time from the arrival', () => {
    const parsed = JSON.parse(dwellBody(result, OUTPUT.JSON));
    expect(parsed.rows[0].yardMinutes).toBe(240);
  });
});

describe('registerBody', () => {
  it('draws the grid', () => {
    const text = registerBody(result, OUTPUT.TABLE);
    expect(text.split('\n')[0]).toMatch(/^car\s+\d+/);
    expect(text).toContain('BNSF 400123');
  });

  it('writes the days and the rows as JSON', () => {
    const parsed = JSON.parse(registerBody(result, OUTPUT.JSON));
    expect(parsed.period).toBe('202403');
    expect(parsed.days.length).toBeGreaterThan(0);
    expect(parsed.rows[0].grid).toMatch(/^[.\-rf0-9]+$/);
  });

  it('writes a CSV with the grid in a column', () => {
    const csv = registerBody(result, OUTPUT.CSV);
    expect(csv.split('\n')[0]).toBe('car,consignee,grid,chargeable,amount');
  });
});

describe('the trips report', () => {
  const events = runReport(options, { readFile }).feed.events;

  it('gives one row per trip', () => {
    const rows = tripRows(events);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.car)).toEqual(['BNSF 400123', 'UP 3']);
  });

  it('reads the arrival off the feed', () => {
    const row = tripRows(events).find((entry) => entry.car === 'BNSF 400123');
    expect(row.arrived).toBe('2024-03-03T20:00-06:00');
  });

  it('leaves the departure blank while the car is still here', () => {
    const row = tripRows(events).find((entry) => entry.car === 'BNSF 400123');
    expect(row.departed).toBe('');
    expect(row.open).toBe('yes');
    expect(row.days).toBe('');
  });

  it('counts the placements and lists the tracks', () => {
    const row = tripRows(events).find((entry) => entry.car === 'BNSF 400123');
    expect(row.placements).toBe(1);
    expect(row.tracks).toBe('IT-9');
  });

  it('reports a car the assessment could not place', () => {
    expect(tripRows(events).some((row) => row.car === 'UP 3')).toBe(true);
  });

  it('closes a trip at the departure and measures it', () => {
    const closed = runReport(
      {
        ...options,
        events: 'closed.csv',
      },
      {
        readFile: makeReadFile({
          extra: {
            'closed.csv': [
              'car,event,event_time,track',
              'BNSF 400123,ARR,2024-03-03T00:00,',
              'BNSF 400123,AP,2024-03-04T00:00,IT-9',
              'BNSF 400123,REL,2024-03-06T00:00,IT-9',
              'BNSF 400123,DEP,2024-03-07T00:00,',
              '',
            ].join('\n'),
          },
        }),
      }
    );
    const row = tripRows(closed.feed.events)[0];
    expect(row.open).toBe('no');
    expect(row.days).toBe(4);
  });

  it('foots with the counts', () => {
    const text = tripsBody(events, OUTPUT.TABLE);
    expect(text).toMatch(/cars\s+2/);
    expect(text).toMatch(/still here\s+2/);
  });

  it('writes JSON with the repeat visitors', () => {
    const parsed = JSON.parse(tripsBody(events, OUTPUT.JSON));
    expect(parsed.cars).toBe(2);
    expect(parsed.trips).toBe(2);
    expect(parsed.repeatVisitors).toEqual([]);
  });

  it('names a car that came back', () => {
    const twice = [
      'car,event,event_time,track',
      'BNSF 400123,ARR,2024-03-03T00:00,',
      'BNSF 400123,DEP,2024-03-05T00:00,',
      'BNSF 400123,ARR,2024-03-20T00:00,',
      'BNSF 400123,DEP,2024-03-22T00:00,',
      '',
    ].join('\n');
    const back = runReport(
      { ...options, events: 'twice.csv' },
      { readFile: makeReadFile({ extra: { 'twice.csv': twice } }) }
    );
    const parsed = JSON.parse(tripsBody(back.feed.events, OUTPUT.JSON));
    expect(parsed.repeatVisitors).toEqual([{ carId: 'BNSF 400123', trips: 2 }]);
  });

  it('writes a CSV in a fixed column order', () => {
    expect(tripsBody(events, OUTPUT.CSV).split('\n')[0]).toBe(
      'car,trip,arrived,departed,days,placements,tracks,open'
    );
  });

  it('says so when the feed holds nothing', () => {
    expect(tripsBody([], OUTPUT.TABLE)).toBe('no trips in the feed');
  });
});

describe('the capacity report', () => {
  const world = loadConfig(sampleDocument());

  it('turns every stand into a placed and released pair of days', () => {
    const records = placementRecords(result);
    expect(records).toEqual([
      { carId: 'BNSF 400123', trackId: 'IT-9', placedOn: '2024-03-04', releasedOn: '2024-03-08' },
    ]);
  });

  it('releases a car still standing at the cut off rather than leaving it open', () => {
    const open = runReport(
      { ...options, events: 'open.csv' },
      {
        readFile: makeReadFile({
          extra: {
            'open.csv': [
              'car,event,event_time,track',
              'BNSF 400123,AP,2024-03-04T00:00,IT-9',
              '',
            ].join('\n'),
          },
        }),
      }
    );
    expect(placementRecords(open.result)[0].releasedOn).toBe('2024-04-01');
  });

  it('counts that car as present for the rest of the month', () => {
    const open = runReport(
      { ...options, events: 'open.csv' },
      {
        readFile: makeReadFile({
          extra: {
            'open.csv': [
              'car,event,event_time,track',
              'BNSF 400123,AP,2024-03-04T00:00,IT-9',
              '',
            ].join('\n'),
          },
        }),
      }
    );
    const parsed = JSON.parse(capacityBody(world, open.result, OUTPUT.JSON));
    const rows = parsed.tracks[0].rows;
    expect(rows.find((row) => row.date === '2024-03-31').cars).toBe(1);
    expect(rows.find((row) => row.date === '2024-03-03').cars).toBe(0);
  });

  it('leaves the release open when nothing closed it and no cut off was given', () => {
    const loose = {
      assessments: [{ carId: 'A', detentions: [{ placedAt: 0, trackId: 'IT-9' }] }],
    };
    expect(placementRecords(loose)[0].releasedOn).toBeUndefined();
  });

  it('leaves out a stand with no track', () => {
    const loose = { assessments: [{ carId: 'A', detentions: [{ placedAt: 0 }] }] };
    expect(placementRecords(loose)).toEqual([]);
  });

  it('counts the peak and the days the track was full', () => {
    const text = capacityBody(world, result, OUTPUT.TABLE);
    expect(text).toContain('IT-9');
    expect(text).toContain('DELTA');
  });

  it('reports every industry track, even an empty one', () => {
    const parsed = JSON.parse(capacityBody(world, result, OUTPUT.JSON));
    expect(parsed.tracks.map((entry) => entry.track)).toEqual(['IT-9']);
    expect(parsed.window).toEqual({ from: '2024-03-01', to: '2024-03-31' });
  });

  it('leaves the hold track out, since nothing is consigned to it', () => {
    const withHold = loadConfig(
      sampleDocument({
        tracks: [
          {
            id: 'IT-9',
            splc: '412300',
            name: 'Delta lead',
            capacityCars: 6,
            consigneeId: 'DELTA',
          },
          { id: 'HT-1', splc: '412300', name: 'North hold', role: 'hold', capacityCars: 20 },
        ],
      })
    );
    const parsed = JSON.parse(capacityBody(withHold, result, OUTPUT.JSON));
    expect(parsed.tracks.map((entry) => entry.track)).toEqual(['IT-9']);
  });

  it('names the days a track was full', () => {
    const tight = loadConfig(
      sampleDocument({
        tracks: [
          {
            id: 'IT-9',
            splc: '412300',
            name: 'Delta lead',
            capacityCars: 1,
            consigneeId: 'DELTA',
          },
        ],
      })
    );
    const text = capacityBody(tight, result, OUTPUT.TABLE);
    expect(text).toContain('full on');
    expect(text).toContain('2024-03-04');
  });

  it('writes a CSV in a fixed column order', () => {
    expect(capacityBody(world, result, OUTPUT.CSV).split('\n')[0]).toBe(
      'track,consignee,capacity,peak,average,utilisation,fullDays'
    );
  });

  it('says so when there is no industry track at all', () => {
    const yardOnly = loadConfig(
      sampleDocument({
        tracks: [
          { id: 'HT-1', splc: '412300', name: 'North hold', role: 'hold', capacityCars: 20 },
        ],
      })
    );
    expect(capacityBody(yardOnly, result, OUTPUT.TABLE)).toBe(
      'no industry track in the configuration'
    );
  });
});

describe('reportBody', () => {
  it('dispatches on the kind', () => {
    expect(reportBody(REPORT.EXCEPTIONS, result, OUTPUT.TABLE)).toContain('not-assessed');
    expect(reportBody(REPORT.KPI, result, OUTPUT.TABLE)).toContain('respots');
    expect(reportBody(REPORT.DWELL, result, OUTPUT.TABLE)).toContain('yard');
    expect(reportBody(REPORT.REGISTER, result, OUTPUT.TABLE)).toContain('BNSF 400123');
    expect(
      reportBody(REPORT.TRIPS, result, OUTPUT.TABLE, {
        events: runReport(options, { readFile }).feed.events,
      })
    ).toContain('BNSF 400123');
  });

  it('refuses a kind it does not have', () => {
    expect(() => reportBody('weather', result, OUTPUT.TABLE)).toThrow(ValidationError);
  });
});

describe('runReport', () => {
  it('defaults to the exceptions', () => {
    expect(runReport(options, { readFile }).text).toContain('not-assessed');
  });

  it('takes the kind from the options', () => {
    expect(runReport({ ...options, report: 'kpi' }, { readFile }).text).toContain('gross');
  });

  it('refuses a kind it does not have before doing the work', () => {
    expect(() => runReport({ ...options, report: 'weather' }, { readFile })).toThrow(
      /report has to be one of/
    );
  });

  it('names every report it does have in the refusal', () => {
    try {
      runReport({ ...options, report: 'weather' }, { readFile });
      throw new Error('should have thrown');
    } catch (error) {
      for (const kind of Object.values(REPORT)) {
        expect(error.message).toContain(kind);
      }
    }
  });

  it('runs the capacity report', () => {
    expect(runReport({ ...options, report: 'capacity' }, { readFile }).text).toContain('IT-9');
  });

  it('runs the trips report', () => {
    expect(runReport({ ...options, report: 'trips' }, { readFile }).text).toContain('BNSF 400123');
  });

  it('runs the register', () => {
    expect(runReport({ ...options, report: 'register' }, { readFile }).text).toContain(
      'BNSF 400123'
    );
  });
});
