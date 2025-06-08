import { describe, expect, it } from 'vitest';
import {
  eventTrail,
  explainCar,
  explainText,
  runExplain,
} from '../../../src/cli/commands/explain.js';
import { loadConfig } from '../../../src/config/loadConfig.js';
import { assessMonth } from '../../../src/assessment/runMonth.js';
import { ingestCsv } from '../../../src/io/ingestEvents.js';
import { SERVICE } from '../../../src/tariff/freeTimeTable.js';
import { EVIDENCE, EXCLUSION } from '../../../src/exclusions/exclusion.js';
import { NotFoundError } from '../../../src/core/errors.js';
import { makeReadFile, sampleOptions } from '../../fixtures/world.js';

const document = {
  settings: { years: [2024] },
  stations: [{ splc: '412300', name: 'Memphis North', carrier: 'BNSF' }],
  tracks: [
    { id: 'IT-9', splc: '412300', name: 'Delta lead', capacityCars: 6, consigneeId: 'DELTA' },
  ],
  parties: [{ id: 'DELTA', name: 'Delta Chemical', noticeAddress: 'a@b.example' }],
  exclusions: [
    {
      kind: EXCLUSION.PLANT_CLOSURE,
      from: '2024-03-05T00:00',
      to: '2024-03-06T00:00',
      splc: '412300',
      consigneeId: 'DELTA',
      evidence: EVIDENCE.CONSIGNEE_NOTICE,
    },
  ],
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
  'UP 3,AP,2024-03-04T00:00,FOREIGN-1',
  '',
].join('\n');

const readFile = makeReadFile({ document, feed });
const options = { ...sampleOptions, car: 'bnsf400123' };

const world = loadConfig(document);
const result = assessMonth(world, ingestCsv(feed).events, { period: '202403', carrier: 'BNSF' });

describe('explainCar', () => {
  const explanation = explainCar(world, result, 'bnsf-400123');

  it('normalises the car it was asked about', () => {
    expect(explanation.carId).toBe('BNSF 400123');
  });

  it('names the page and the station', () => {
    expect(explanation.page).toBe('DEM-4000');
    expect(explanation.splc).toBe('412300');
    expect(explanation.consigneeId).toBe('DELTA');
  });

  it('lists the free and the charged days', () => {
    expect(explanation.freeDays).toEqual(['2024-03-04']);
    expect(explanation.chargedDays).toEqual(['2024-03-05', '2024-03-06', '2024-03-07']);
  });

  it('shows the relief it turned down and does not credit it', () => {
    expect(explanation.reliefApplied).toEqual([]);
    expect(explanation.reliefDeclined).toHaveLength(1);
    expect(explanation.reliefDeclined[0]).toContain('plant-closure');
  });

  it('lists the detentions', () => {
    expect(explanation.detentions).toHaveLength(1);
    expect(explanation.detentions[0].placement).toBe('actual');
    expect(explanation.detentions[0].open).toBe(false);
  });

  it('throws for a car that was not assessed', () => {
    expect(() => explainCar(world, result, 'GATX 77')).toThrow(NotFoundError);
  });

  it('says why when the car was skipped', () => {
    try {
      explainCar(world, result, 'UP 3');
      throw new Error('should have thrown');
    } catch (error) {
      expect(error.message).toContain('no track this office knows');
    }
  });
});

describe('explainText', () => {
  const text = explainText(explainCar(world, result, 'BNSF 400123'), world);

  it('opens with the car and the page', () => {
    expect(text.split('\n')[0]).toMatch(/^car\s+BNSF 400123$/);
    expect(text).toMatch(/page\s+DEM-4000/);
  });

  it('lists the days', () => {
    expect(text).toContain('free days   2024-03-04');
    expect(text).toContain('charged     2024-03-05 2024-03-06 2024-03-07');
  });

  it('says what relief was declined and why', () => {
    expect(text).toContain('relief declined');
    expect(text).toContain('placed this way');
  });

  it('says none when nothing was free', () => {
    const empty = { ...explainCar(world, result, 'BNSF 400123'), freeDays: [], chargedDays: [] };
    const rendered = explainText(empty);
    expect(rendered).toContain('free days   none');
    expect(rendered).toContain('charged     none');
  });
});

describe('eventTrail', () => {
  it('lists the events for one car in order', () => {
    const trail = eventTrail(ingestCsv(feed), 'bnsf400123');
    expect(trail).toHaveLength(2);
    expect(trail[0]).toContain('AP');
    expect(trail[1]).toContain('REL');
  });

  it('is empty for a car with no events', () => {
    expect(eventTrail(ingestCsv(feed), 'GATX 77')).toEqual([]);
  });
});

describe('runExplain', () => {
  it('reads the files and explains', () => {
    const { text, trail } = runExplain(options, { readFile });
    expect(text).toContain('BNSF 400123');
    expect(trail).toHaveLength(2);
  });

  it('writes JSON when asked', () => {
    const { text } = runExplain({ ...options, output: 'json' }, { readFile });
    expect(JSON.parse(text).page).toBe('DEM-4000');
  });
});
