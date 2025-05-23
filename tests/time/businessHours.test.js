import { describe, expect, it } from 'vitest';
import {
  STANDARD_HOURS,
  businessHours,
  isOpenAt,
  nextOpening,
  openMinutesPerDay,
  receivedAt,
  waitMinutes,
} from '../../src/time/businessHours.js';
import { serviceCalendar } from '../../src/time/serviceCalendar.js';
import { formatInstant, parseInstant } from '../../src/time/instant.js';
import { ValidationError } from '../../src/core/errors.js';

const CENTRAL = -360;
const at = (text) => parseInstant(text, CENTRAL);
const shown = (moment) => formatInstant(moment, CENTRAL);

const hours = businessHours();
const calendar = serviceCalendar({ id: 'MEM', years: [2024] });
const workingHours = businessHours({ calendar });

describe('businessHours', () => {
  it('defaults to eight until five', () => {
    expect(hours.opensMinute).toBe(480);
    expect(hours.closesMinute).toBe(1020);
    expect(openMinutesPerDay(hours)).toBe(540);
  });

  it('refuses an office that closes before it opens', () => {
    expect(() => businessHours({ opensMinute: 600, closesMinute: 540 })).toThrow(
      /close before it opens/
    );
  });

  it('refuses a minute outside the day', () => {
    expect(() => businessHours({ opensMinute: -1 })).toThrow(ValidationError);
  });

  it('ships a standard set', () => {
    expect(STANDARD_HOURS.opensMinute).toBe(480);
  });
});

describe('isOpenAt', () => {
  it('is open during the day', () => {
    expect(isOpenAt(hours, at('2024-03-04T09:00'), CENTRAL)).toBe(true);
  });

  it('is closed before it opens and on the closing minute', () => {
    expect(isOpenAt(hours, at('2024-03-04T07:59'), CENTRAL)).toBe(false);
    expect(isOpenAt(hours, at('2024-03-04T17:00'), CENTRAL)).toBe(false);
  });

  it('is open on the opening minute', () => {
    expect(isOpenAt(hours, at('2024-03-04T08:00'), CENTRAL)).toBe(true);
  });

  it('is closed on a day the calendar does not work', () => {
    expect(isOpenAt(workingHours, at('2024-03-09T09:00'), CENTRAL)).toBe(false);
    expect(isOpenAt(hours, at('2024-03-09T09:00'), CENTRAL)).toBe(true);
  });
});

describe('nextOpening', () => {
  it('opens later the same day when it is still early', () => {
    expect(shown(nextOpening(hours, at('2024-03-04T03:00'), CENTRAL))).toBe(
      '2024-03-04T08:00-06:00'
    );
  });

  it('opens the next day once the office has already opened', () => {
    expect(shown(nextOpening(hours, at('2024-03-04T10:00'), CENTRAL))).toBe(
      '2024-03-05T08:00-06:00'
    );
    expect(shown(nextOpening(hours, at('2024-03-04T18:00'), CENTRAL))).toBe(
      '2024-03-05T08:00-06:00'
    );
  });

  it('steps over a weekend', () => {
    expect(shown(nextOpening(workingHours, at('2024-03-08T18:00'), CENTRAL))).toBe(
      '2024-03-11T08:00-06:00'
    );
  });

  it('steps over a holiday too', () => {
    expect(shown(nextOpening(workingHours, at('2024-08-30T18:00'), CENTRAL))).toBe(
      '2024-09-03T08:00-06:00'
    );
  });
});

describe('receivedAt', () => {
  it('is at once when the office is open', () => {
    const moment = at('2024-03-04T09:00');
    expect(receivedAt(hours, moment, CENTRAL)).toBe(moment);
    expect(waitMinutes(hours, moment, CENTRAL)).toBe(0);
  });

  it('waits for the office otherwise', () => {
    expect(waitMinutes(hours, at('2024-03-04T03:00'), CENTRAL)).toBe(300);
  });

  it('waits over the weekend on a calendar', () => {
    expect(waitMinutes(workingHours, at('2024-03-09T09:00'), CENTRAL)).toBe(47 * 60);
  });
});
