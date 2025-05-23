import { describe, expect, it } from 'vitest';
import {
  OFFICE_CLOSES_MINUTE,
  OFFICE_OPENS_MINUTE,
  delayMinutes,
  firstEffective,
  isAcknowledged,
  isImmediate,
  notice,
  noticesForCar,
} from '../../src/events/notice.js';
import { NOTICE_METHOD } from '../../src/site/party.js';
import { serviceCalendar } from '../../src/time/serviceCalendar.js';
import { formatInstant, parseInstant } from '../../src/time/instant.js';
import { ValidationError } from '../../src/core/errors.js';

const at = (text) => parseInstant(text, -360);
const shown = (record) => formatInstant(record.effectiveAt, -360);

const base = { carId: 'bnsf400123', method: NOTICE_METHOD.EDI, sentAt: '2024-03-04T03:00' };
const calendar = serviceCalendar({ id: 'MEM', years: [2024] });

describe('notice', () => {
  it('normalises the car and the consignee', () => {
    const record = notice({ ...base, consigneeId: 'delta' });
    expect(record.carId).toBe('BNSF 400123');
    expect(record.consigneeId).toBe('DELTA');
  });

  it('is frozen', () => {
    expect(Object.isFrozen(notice(base))).toBe(true);
  });

  it('refuses a method it does not know', () => {
    expect(() => notice({ ...base, method: 'carrier pigeon' })).toThrow(ValidationError);
  });

  it('refuses an office that closes before it opens', () => {
    expect(() => notice({ ...base, officeOpensMinute: 600, officeClosesMinute: 540 })).toThrow(
      /close before it opens/
    );
  });

  it('refuses an acknowledgement before the send', () => {
    expect(() => notice({ ...base, acknowledgedAt: '2024-03-03T00:00' })).toThrow(
      /acknowledged before it was sent/
    );
  });

  it('ships the office hours it defaults to', () => {
    expect(OFFICE_OPENS_MINUTE).toBe(480);
    expect(OFFICE_CLOSES_MINUTE).toBe(1020);
  });
});

describe('a message takes effect when it is sent', () => {
  it('for EDI at three in the morning', () => {
    const record = notice(base);
    expect(shown(record)).toBe('2024-03-04T03:00-06:00');
    expect(isImmediate(record)).toBe(true);
    expect(delayMinutes(record)).toBe(0);
  });

  it('for email at three in the morning', () => {
    expect(isImmediate(notice({ ...base, method: NOTICE_METHOD.EMAIL }))).toBe(true);
  });
});

describe('a phone call waits for the office', () => {
  it('takes effect at once during office hours', () => {
    const record = notice({ ...base, method: NOTICE_METHOD.PHONE, sentAt: '2024-03-04T09:00' });
    expect(isImmediate(record)).toBe(true);
  });

  it('waits until morning when it comes before the office opens', () => {
    const record = notice({ ...base, method: NOTICE_METHOD.PHONE });
    expect(shown(record)).toBe('2024-03-04T08:00-06:00');
    expect(delayMinutes(record)).toBe(300);
  });

  it('waits for the next day when it comes after the office closes', () => {
    const record = notice({ ...base, method: NOTICE_METHOD.PHONE, sentAt: '2024-03-04T18:00' });
    expect(shown(record)).toBe('2024-03-05T08:00-06:00');
  });

  it('takes effect on the closing minute itself as the next morning', () => {
    const record = notice({ ...base, method: NOTICE_METHOD.PHONE, sentAt: '2024-03-04T17:00' });
    expect(shown(record)).toBe('2024-03-05T08:00-06:00');
  });

  it('follows office hours the caller sets', () => {
    const record = notice({
      ...base,
      method: NOTICE_METHOD.PHONE,
      sentAt: '2024-03-04T06:30',
      officeOpensMinute: 6 * 60,
      officeClosesMinute: 14 * 60,
    });
    expect(isImmediate(record)).toBe(true);
  });
});

describe('a portal waits to be read', () => {
  it('takes effect when it was acknowledged', () => {
    const record = notice({
      ...base,
      method: NOTICE_METHOD.PORTAL,
      acknowledgedAt: '2024-03-04T05:30',
    });
    expect(shown(record)).toBe('2024-03-04T05:30-06:00');
    expect(isAcknowledged(record)).toBe(true);
  });

  it('falls back to the next opening when nobody read it', () => {
    const record = notice({ ...base, method: NOTICE_METHOD.PORTAL });
    expect(shown(record)).toBe('2024-03-04T08:00-06:00');
    expect(isAcknowledged(record)).toBe(false);
  });

  it('falls to the next day when it was posted during the day', () => {
    const record = notice({ ...base, method: NOTICE_METHOD.PORTAL, sentAt: '2024-03-04T10:00' });
    expect(shown(record)).toBe('2024-03-05T08:00-06:00');
  });
});

describe('two consignees told at the same minute', () => {
  it('start on different days', () => {
    const edi = notice(base);
    const phone = notice({ ...base, method: NOTICE_METHOD.PHONE });
    expect(edi.effectiveAt).toBe(at('2024-03-04T03:00'));
    expect(phone.effectiveAt).toBe(at('2024-03-04T08:00'));
    expect(phone.effectiveAt).toBeGreaterThan(edi.effectiveAt);
  });
});

describe('a calendar the office keeps', () => {
  it('holds a Saturday phone call over to Monday', () => {
    const record = notice({
      ...base,
      method: NOTICE_METHOD.PHONE,
      sentAt: '2024-03-09T09:00',
      calendar,
    });
    expect(shown(record)).toBe('2024-03-11T08:00-06:00');
  });

  it('leaves an EDI message alone on the same Saturday', () => {
    const record = notice({ ...base, sentAt: '2024-03-09T09:00', calendar });
    expect(shown(record)).toBe('2024-03-09T09:00-06:00');
  });

  it('takes the call at once on a working morning', () => {
    const record = notice({
      ...base,
      method: NOTICE_METHOD.PHONE,
      sentAt: '2024-03-11T09:00',
      calendar,
    });
    expect(isImmediate(record)).toBe(true);
  });
});

describe('working with a set', () => {
  const records = [
    notice({ ...base, sentAt: '2024-03-04T10:00' }),
    notice({ ...base, method: NOTICE_METHOD.PHONE, sentAt: '2024-03-04T03:00' }),
    notice({ ...base, carId: 'GATX 77' }),
  ];

  it('finds a car in send order', () => {
    const found = noticesForCar(records, 'bnsf-400123');
    expect(found).toHaveLength(2);
    expect(found[0].sentAt).toBeLessThan(found[1].sentAt);
  });

  it('picks the notice that took effect first rather than the one sent first', () => {
    expect(shown(firstEffective(records, 'BNSF 400123'))).toBe('2024-03-04T08:00-06:00');
  });

  it('has nothing for a car with no notice', () => {
    expect(noticesForCar(records, 'UP 1')).toEqual([]);
    expect(firstEffective(records, 'UP 1')).toBeUndefined();
  });
});
