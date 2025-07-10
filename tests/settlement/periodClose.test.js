import { describe, expect, it } from 'vitest';
import {
  PERIOD_STATE,
  heldCount,
  periodRecord,
  periodRegister,
  routeLateEvents,
} from '../../src/settlement/periodClose.js';
import { parseInstant } from '../../src/time/instant.js';
import { ConflictError, ValidationError } from '../../src/core/errors.js';

const closed = {
  period: '202403',
  state: PERIOD_STATE.CLOSED,
  closedOn: '2024-04-10',
  closedBy: 'clerk',
};

describe('periodRecord', () => {
  it('starts open', () => {
    expect(periodRecord({ period: '202403' }).state).toBe(PERIOD_STATE.OPEN);
  });

  it('refuses a period that is not a real month', () => {
    expect(() => periodRecord({ period: '202413' })).toThrow(/YYYYMM/);
    expect(() => periodRecord({ period: '2024' })).toThrow(/YYYYMM/);
  });

  it('makes a closed period say when and by whom', () => {
    expect(() => periodRecord({ ...closed, closedBy: undefined })).toThrow(/when and by whom/);
    expect(() => periodRecord({ ...closed, closedOn: undefined })).toThrow(/when and by whom/);
  });

  it('refuses a state it does not know', () => {
    expect(() => periodRecord({ period: '202403', state: 'shut' })).toThrow(ValidationError);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(periodRecord({ period: '202403' }))).toBe(true);
  });
});

describe('the register', () => {
  it('treats a period it has never heard of as open', () => {
    const register = periodRegister();
    expect(register.stateOf('202403')).toBe(PERIOD_STATE.OPEN);
    expect(register.isOpen('202403')).toBe(true);
    expect(register.find('202403')).toBeUndefined();
  });

  it('closes a period', () => {
    const register = periodRegister();
    const record = register.close('202403', { closedOn: '2024-04-10', closedBy: 'clerk' });
    expect(record.state).toBe(PERIOD_STATE.CLOSED);
    expect(register.isOpen('202403')).toBe(false);
  });

  it('will not close the same period twice', () => {
    const register = periodRegister([closed]);
    expect(() => register.close('202403', { closedOn: '2024-04-11', closedBy: 'clerk' })).toThrow(
      ConflictError
    );
  });

  it('makes a close say when and by whom', () => {
    const register = periodRegister();
    expect(() => register.close('202403', {})).toThrow(/when and by whom/);
  });

  it('lists the closed periods in order', () => {
    const register = periodRegister([closed, { ...closed, period: '202401' }]);
    expect(register.closedPeriods()).toEqual(['202401', '202403']);
  });

  it('refuses a non array', () => {
    expect(() => periodRegister('nope')).toThrow(ValidationError);
  });
});

describe('reopening', () => {
  it('needs a reason and records it', () => {
    const register = periodRegister([closed]);
    expect(() => register.reopen('202403')).toThrow(ValidationError);
    const record = register.reopen('202403', 'carrier sent March events in May');
    expect(record.state).toBe(PERIOD_STATE.REOPENED);
    expect(record.note).toBe('carrier sent March events in May');
  });

  it('makes the period open again', () => {
    const register = periodRegister([closed]);
    register.reopen('202403', 'late events');
    expect(register.isOpen('202403')).toBe(true);
  });

  it('will not reopen something that was never closed', () => {
    const register = periodRegister();
    expect(() => register.reopen('202403', 'why not')).toThrow(ConflictError);
  });

  it('counts the reopenings and flags a period reopened twice', () => {
    const register = periodRegister([closed]);
    register.reopen('202403', 'once');
    register.close('202403', { closedOn: '2024-05-01', closedBy: 'clerk' });
    register.reopen('202403', 'twice');
    register.close('202403', { closedOn: '2024-05-10', closedBy: 'clerk' });
    register.reopen('202403', 'three times');
    expect(register.find('202403').reopenings).toBe(3);
    expect(register.troubled().map((entry) => entry.period)).toEqual(['202403']);
  });

  it('reports nothing troubled on a quiet register', () => {
    expect(periodRegister([closed]).troubled()).toEqual([]);
  });
});

describe('routeLateEvents', () => {
  const register = periodRegister([closed]);
  const events = [
    { at: parseInstant('2024-03-20T08:00-06:00') },
    { at: parseInstant('2024-04-02T08:00-06:00') },
    { at: parseInstant('2024-03-31T23:00-06:00') },
  ];

  it('holds the events that land in a closed month', () => {
    const result = routeLateEvents(register, events);
    expect(result.accepted).toHaveLength(1);
    expect(heldCount(result)).toBe(2);
  });

  it('says which period each held event belonged to', () => {
    const result = routeLateEvents(register, events);
    expect(result.held.every((entry) => entry.period === '202403')).toBe(true);
  });

  it('takes them all once the month is reopened', () => {
    const reopened = periodRegister([closed]);
    reopened.reopen('202403', 'late events');
    expect(routeLateEvents(reopened, events).held).toEqual([]);
  });

  it('reads the day at the offset it is given', () => {
    const utc = routeLateEvents(register, [{ at: parseInstant('2024-04-01T02:00Z') }], {
      offsetMinutes: 0,
    });
    const central = routeLateEvents(register, [{ at: parseInstant('2024-04-01T02:00Z') }]);
    expect(utc.accepted).toHaveLength(1);
    expect(central.held).toHaveLength(1);
  });
});
