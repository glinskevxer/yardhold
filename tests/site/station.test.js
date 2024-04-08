import { describe, expect, it } from 'vitest';
import { isWithinSwitchingLimits, station, stationBook } from '../../src/site/station.js';
import { ValidationError } from '../../src/core/errors.js';

const base = { splc: '412300', name: ' memphis north ', carrier: 'bnsf' };

describe('station', () => {
  it('normalises the name and the carrier', () => {
    const record = station(base);
    expect(record.name).toBe('MEMPHIS NORTH');
    expect(record.carrier).toBe('BNSF');
  });

  it('defaults the calendar id off the carrier and the code', () => {
    expect(station(base).calendarId).toBe('bnsf-412300');
  });

  it('takes an explicit calendar id', () => {
    expect(station({ ...base, calendarId: 'SHARED' }).calendarId).toBe('SHARED');
  });

  it('refuses an SPLC that is not six digits', () => {
    expect(() => station({ ...base, splc: '4123' })).toThrow(/six digits/);
    expect(() => station({ ...base, splc: '41230A' })).toThrow(/six digits/);
  });

  it('refuses an offset outside the day', () => {
    expect(() => station({ ...base, offsetMinutes: -900 })).toThrow(ValidationError);
  });

  it('is frozen down to the switching limits', () => {
    const record = station({ ...base, switchingLimits: ['Yard A'] });
    expect(Object.isFrozen(record)).toBe(true);
    expect(Object.isFrozen(record.switchingLimits)).toBe(true);
  });
});

describe('switching limits', () => {
  it('lets everything through when none are listed', () => {
    expect(isWithinSwitchingLimits(station(base), 'anywhere')).toBe(true);
  });

  it('matches case insensitively', () => {
    const record = station({ ...base, switchingLimits: ['Yard A', 'Frisco Lead'] });
    expect(isWithinSwitchingLimits(record, 'frisco lead')).toBe(true);
    expect(isWithinSwitchingLimits(record, 'Yard B')).toBe(false);
  });
});

describe('stationBook', () => {
  const book = stationBook([
    base,
    { splc: '412400', name: 'Collierville', carrier: 'BNSF' },
    { splc: '509100', name: 'Cordova', carrier: 'UP' },
  ]);

  it('indexes by SPLC', () => {
    expect(book.size).toBe(3);
    expect(book.has('412300')).toBe(true);
    expect(book.find('412300').name).toBe('MEMPHIS NORTH');
    expect(book.find('999999')).toBeUndefined();
  });

  it('lists in code order', () => {
    expect(book.all().map((record) => record.splc)).toEqual(['412300', '412400', '509100']);
  });

  it('slices by carrier and by name', () => {
    expect(book.ofCarrier('bnsf')).toHaveLength(2);
    expect(book.byName(' cordova ')).toHaveLength(1);
    expect(book.byName('nowhere')).toEqual([]);
  });

  it('refuses a duplicate code', () => {
    expect(() => stationBook([base, base])).toThrow(/already in the book/);
  });
});
