import { describe, expect, it } from 'vitest';
import {
  relieveByMinutes,
  relieveByWholeDays,
  relieveSpan,
  reliefSummary,
} from '../../src/exclusions/apply.js';
import { EVIDENCE, EXCLUSION, exclusion } from '../../src/exclusions/exclusion.js';
import { PLACEMENT } from '../../src/clock/placement.js';
import { tariff } from '../../src/tariff/tariff.js';
import { DAY_KIND } from '../../src/tariff/freeTimeTable.js';
import { parseInstant } from '../../src/time/instant.js';
import { durationMinutes, period } from '../../src/time/period.js';
import { ValidationError } from '../../src/core/errors.js';

const at = (text) => parseInstant(text, -360);
const span = period(at('2024-03-07T00:00'), at('2024-03-12T00:00'));

const wholeDayPage = tariff({
  id: 'DEM-4000',
  carrier: 'BNSF',
  ladder: [{ fromDay: 1, rate: '150.00' }],
});

const minutePage = tariff({
  id: 'DEM-4100',
  carrier: 'BNSF',
  excludeDayKind: DAY_KIND.SERVICE,
  creditsWeekends: true,
  ladder: [{ fromDay: 1, rate: '150.00' }],
});

const storm = exclusion({
  kind: EXCLUSION.WEATHER,
  from: '2024-03-08T00:00',
  to: '2024-03-09T00:00',
  splc: '412300',
  evidence: EVIDENCE.CARRIER_BULLETIN,
});

const shortStorm = exclusion({
  kind: EXCLUSION.WEATHER,
  from: '2024-03-08T06:00',
  to: '2024-03-08T15:00',
  splc: '412300',
  evidence: EVIDENCE.CARRIER_BULLETIN,
});

const closure = exclusion({
  kind: EXCLUSION.PLANT_CLOSURE,
  from: '2024-03-10T00:00',
  to: '2024-03-11T00:00',
  splc: '412300',
  consigneeId: 'DELTA',
  evidence: EVIDENCE.CONSIGNEE_NOTICE,
});

describe('relieveByMinutes', () => {
  it('cuts the window out and leaves the rest', () => {
    const result = relieveByMinutes(span, [storm.span]);
    expect(result.pieces).toHaveLength(2);
    expect(result.removedMinutes).toBe(1440);
  });

  it('credits a window shorter than a day', () => {
    expect(relieveByMinutes(span, [shortStorm.span]).removedMinutes).toBe(540);
  });

  it('does not double count overlapping windows', () => {
    expect(relieveByMinutes(span, [storm.span, shortStorm.span]).removedMinutes).toBe(1440);
  });

  it('only credits the part inside the span', () => {
    const outside = period(at('2024-03-06T00:00'), at('2024-03-07T06:00'));
    expect(relieveByMinutes(span, [outside]).removedMinutes).toBe(360);
  });

  it('leaves the span whole when nothing applies', () => {
    const result = relieveByMinutes(span, []);
    expect(result.pieces).toEqual([span]);
    expect(result.removedMinutes).toBe(0);
  });
});

describe('relieveByWholeDays', () => {
  const options = { offsetMinutes: -360 };

  it('drops a day the window covers end to end', () => {
    const result = relieveByWholeDays(span, [storm.span], options);
    expect(result.droppedUnits).toEqual(['2024-03-08']);
    expect(result.removedMinutes).toBe(1440);
  });

  it('drops nothing for a window that does not cover a whole day', () => {
    const result = relieveByWholeDays(span, [shortStorm.span], options);
    expect(result.droppedUnits).toEqual([]);
    expect(result.removedMinutes).toBe(0);
  });

  it('drops several days at once', () => {
    const result = relieveByWholeDays(span, [storm.span, closure.span], options);
    expect(result.droppedUnits).toEqual(['2024-03-08', '2024-03-10']);
  });

  it('keeps the days it did not drop', () => {
    const result = relieveByWholeDays(span, [storm.span], options);
    expect(result.pieces).toHaveLength(4);
    expect(result.pieces.every((piece) => durationMinutes(piece) === 1440)).toBe(true);
  });
});

describe('relieveSpan reads the page', () => {
  const context = { placement: PLACEMENT.CONSTRUCTIVE, carId: 'BNSF 400123', offsetMinutes: -360 };

  it('takes whole days off a page that counts them that way', () => {
    const result = relieveSpan(span, [shortStorm], { ...context, page: wholeDayPage });
    expect(result.removedMinutes).toBe(0);
  });

  it('takes minutes off a page that counts them that way', () => {
    const result = relieveSpan(span, [shortStorm], { ...context, page: minutePage });
    expect(result.removedMinutes).toBe(540);
  });

  it('still filters by eligibility first', () => {
    const actual = relieveSpan(span, [closure], {
      ...context,
      page: minutePage,
      placement: PLACEMENT.ACTUAL,
    });
    expect(actual.applied).toEqual([]);
    expect(actual.declined).toHaveLength(1);
    expect(actual.removedMinutes).toBe(0);
  });

  it('applies the same closure to a constructive placement', () => {
    const result = relieveSpan(span, [closure], { ...context, page: minutePage });
    expect(result.applied).toHaveLength(1);
    expect(result.removedMinutes).toBe(1440);
  });

  it('needs a page', () => {
    expect(() => relieveSpan(span, [], { placement: PLACEMENT.ACTUAL })).toThrow(ValidationError);
  });
});

describe('reliefSummary', () => {
  it('counts what was applied and what was turned down', () => {
    const result = relieveSpan(span, [storm, closure], {
      page: minutePage,
      placement: PLACEMENT.ACTUAL,
      carId: 'BNSF 400123',
    });
    expect(reliefSummary(result)).toEqual({
      appliedCount: 1,
      declinedCount: 1,
      removedMinutes: 1440,
      droppedDays: 0,
      byKind: { weather: 1 },
    });
  });

  it('counts dropped days on a whole day page', () => {
    const result = relieveSpan(span, [storm], {
      page: wholeDayPage,
      placement: PLACEMENT.ACTUAL,
      carId: 'BNSF 400123',
      offsetMinutes: -360,
    });
    expect(reliefSummary(result).droppedDays).toBe(1);
  });
});
