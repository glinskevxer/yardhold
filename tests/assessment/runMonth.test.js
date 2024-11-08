import { describe, expect, it } from 'vitest';
import {
  assessMonth,
  assessmentsFor,
  consigneesIn,
  monthTotal,
  periodBounds,
} from '../../src/assessment/runMonth.js';
import { loadConfig } from '../../src/config/loadConfig.js';
import { trackEvent } from '../../src/events/event.js';
import { SERVICE } from '../../src/tariff/freeTimeTable.js';
import { parseInstant } from '../../src/time/instant.js';
import { ValidationError } from '../../src/core/errors.js';

const page = (id, rate) => ({
  id,
  carrier: 'BNSF',
  notificationRequired: false,
  ladder: [{ fromDay: 1, rate }],
  freeTime: [{ service: SERVICE.UNLOADING, days: 1 }],
});

const world = loadConfig({
  settings: { years: [2024] },
  stations: [{ splc: '412300', name: 'Memphis North', carrier: 'BNSF' }],
  tracks: [
    { id: 'IT-9', splc: '412300', name: 'Delta lead', capacityCars: 6, consigneeId: 'DELTA' },
    { id: 'IT-10', splc: '412300', name: 'Acme lead', capacityCars: 6, consigneeId: 'ACME' },
  ],
  parties: [
    { id: 'DELTA', name: 'Delta Chemical', noticeAddress: 'a@b.example' },
    { id: 'ACME', name: 'Acme', noticeAddress: 'c@d.example' },
  ],
  cars: [{ id: 'BNSF 400123', designation: 'XM' }],
  tariffs: [
    { page: page('DEM-4000', '150.00'), effectiveFrom: '2024-01-01' },
    { page: page('CON-DELTA', '95.00'), effectiveFrom: '2024-01-01', consigneeId: 'DELTA' },
  ],
});

const at = (text) => parseInstant(text, -360);
const build = (rows) => rows.map(trackEvent);

describe('periodBounds', () => {
  it('spans the whole month at the station offset', () => {
    const bounds = periodBounds('202403', -360);
    expect(bounds.firstDay).toBe('2024-03-01');
    expect(bounds.lastDay).toBe('2024-03-31');
    expect(bounds.from).toBe(at('2024-03-01T00:00'));
    expect(bounds.to).toBe(at('2024-04-01T00:00'));
  });

  it('handles February in a leap year', () => {
    expect(periodBounds('202402').lastDay).toBe('2024-02-29');
  });

  it('needs a period', () => {
    expect(() => periodBounds(undefined)).toThrow(ValidationError);
  });
});

describe('assessMonth', () => {
  const events = build([
    { carId: 'BNSF 400123', code: 'AP', at: '2024-03-04T00:00', trackId: 'IT-9' },
    { carId: 'BNSF 400123', code: 'REL', at: '2024-03-08T00:00' },
    { carId: 'UP 3', code: 'AP', at: '2024-03-04T00:00', trackId: 'IT-10' },
    { carId: 'UP 3', code: 'REL', at: '2024-03-07T00:00' },
  ]);

  it('assesses every car it can place', () => {
    const result = assessMonth(world, events, { period: '202403', carrier: 'BNSF' });
    expect(result.assessments).toHaveLength(2);
    expect(result.skipped).toEqual([]);
  });

  it('picks the consignee page for the Delta car and the general one for Acme', () => {
    const result = assessMonth(world, events, { period: '202403', carrier: 'BNSF' });
    const delta = assessmentsFor(result, 'DELTA')[0];
    const acme = assessmentsFor(result, 'ACME')[0];
    expect(delta.pageId).toBe('CON-DELTA');
    expect(acme.pageId).toBe('DEM-4000');
  });

  it('prices the same three days differently under the two pages', () => {
    const result = assessMonth(world, events, { period: '202403', carrier: 'BNSF' });
    expect(assessmentsFor(result, 'DELTA')[0].total).toBe(3 * 9500);
    expect(assessmentsFor(result, 'ACME')[0].total).toBe(2 * 15000);
  });

  it('reads the station and the consignee off the track', () => {
    const result = assessMonth(world, events, { period: '202403', carrier: 'BNSF' });
    expect(result.assessments.every((entry) => entry.splc === '412300')).toBe(true);
    expect(consigneesIn(result)).toEqual(['ACME', 'DELTA']);
  });

  it('totals the month', () => {
    const result = assessMonth(world, events, { period: '202403', carrier: 'BNSF' });
    expect(monthTotal(result)).toBe(3 * 9500 + 2 * 15000);
  });
});

describe('cars it cannot place', () => {
  it('skips a car on a track this office does not know', () => {
    const events = build([
      { carId: 'BNSF 1', code: 'AP', at: '2024-03-04T00:00', trackId: 'FOREIGN-1' },
      { carId: 'BNSF 1', code: 'REL', at: '2024-03-08T00:00' },
    ]);
    const result = assessMonth(world, events, { period: '202403', carrier: 'BNSF' });
    expect(result.assessments).toEqual([]);
    expect(result.skipped[0].why).toBe('no track this office knows');
  });

  it('skips a car with no track at all', () => {
    const events = build([{ carId: 'BNSF 1', code: 'ARR', at: '2024-03-04T00:00' }]);
    expect(assessMonth(world, events, { period: '202403', carrier: 'BNSF' }).skipped).toHaveLength(
      1
    );
  });

  it('skips a car whose carrier has nothing on file', () => {
    const events = build([
      { carId: 'BNSF 1', code: 'AP', at: '2024-03-04T00:00', trackId: 'IT-9' },
      { carId: 'BNSF 1', code: 'REL', at: '2024-03-08T00:00' },
    ]);
    const result = assessMonth(world, events, { period: '202403', carrier: 'CSXT' });
    expect(result.skipped[0].why).toBe('no tariff page on file');
  });
});

describe('the period cut off', () => {
  it('bills a car still standing at month end to the cut off', () => {
    const events = build([
      { carId: 'BNSF 400123', code: 'AP', at: '2024-03-28T00:00', trackId: 'IT-9' },
    ]);
    const result = assessMonth(world, events, { period: '202403', carrier: 'BNSF' });
    expect(result.assessments[0].chargeableDays).toBe(3);
  });

  it('ignores events that land after the cut off', () => {
    const events = build([
      { carId: 'BNSF 400123', code: 'AP', at: '2024-03-28T00:00', trackId: 'IT-9' },
      { carId: 'BNSF 400123', code: 'REL', at: '2024-04-10T00:00' },
    ]);
    const result = assessMonth(world, events, { period: '202403', carrier: 'BNSF' });
    expect(result.assessments[0].chargeableDays).toBe(3);
  });

  it('needs a world and a carrier', () => {
    expect(() => assessMonth(undefined, [], { period: '202403', carrier: 'BNSF' })).toThrow(
      ValidationError
    );
    expect(() => assessMonth(world, [], { period: '202403' })).toThrow(ValidationError);
  });
});
