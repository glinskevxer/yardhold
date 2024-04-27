import { describe, expect, it } from 'vitest';
import { eventLedger, groupByCar } from '../../src/events/ledger.js';
import { trackEvent } from '../../src/events/event.js';
import { parseInstant } from '../../src/time/instant.js';
import { ValidationError } from '../../src/core/errors.js';

const feed = [
  { carId: 'BNSF 400123', code: 'AP', at: '2024-03-07T08:00', trackId: 'IT-9' },
  { carId: 'BNSF 400123', code: 'ARR', at: '2024-03-06T22:00' },
  { carId: 'BNSF 400123', code: 'REL', at: '2024-03-09T10:00' },
  { carId: 'GATX 77', code: 'CP', at: '2024-03-07T06:00', trackId: 'HT-1' },
];

describe('building a ledger', () => {
  it('takes plain records and builds them', () => {
    const ledger = eventLedger(feed);
    expect(ledger.size).toBe(4);
    expect(ledger.cars()).toEqual(['BNSF 400123', 'GATX 77']);
  });

  it('takes an already built event', () => {
    const ledger = eventLedger();
    const built = trackEvent(feed[0]);
    expect(ledger.add(built)).toBe(built);
  });

  it('refuses a non array to addAll', () => {
    expect(() => eventLedger().addAll('nope')).toThrow(ValidationError);
  });
});

describe('reading it back', () => {
  const ledger = eventLedger(feed);

  it('sorts the whole ledger', () => {
    expect(ledger.all().map((record) => record.code)).toEqual(['ARR', 'CP', 'AP', 'REL']);
  });

  it('keeps the raw order separately', () => {
    expect(ledger.raw().map((record) => record.code)).toEqual(['AP', 'ARR', 'REL', 'CP']);
  });

  it('slices to one car in order', () => {
    expect(ledger.forCar('bnsf400123').map((record) => record.code)).toEqual(['ARR', 'AP', 'REL']);
  });

  it('is empty for a car it has never seen', () => {
    expect(ledger.forCar('UP 1')).toEqual([]);
  });
});

describe('finding one event', () => {
  const ledger = eventLedger([
    ...feed,
    { carId: 'BNSF 400123', code: 'AP', at: '2024-03-08T09:00', trackId: 'IT-10' },
  ]);

  it('finds the first and the last of a code', () => {
    expect(ledger.firstOf('BNSF 400123', 'ap').trackId).toBe('IT-9');
    expect(ledger.latestOf('BNSF 400123', 'ap').trackId).toBe('IT-10');
  });

  it('counts them', () => {
    expect(ledger.countOf('BNSF 400123', 'AP')).toBe(2);
    expect(ledger.countOf('BNSF 400123', 'PUL')).toBe(0);
  });

  it('returns nothing when the code never occurred', () => {
    expect(ledger.latestOf('BNSF 400123', 'PUL')).toBeUndefined();
  });
});

describe('cancelling', () => {
  it('marks the record and hides it by default', () => {
    const ledger = eventLedger(feed);
    const target = ledger.forCar('BNSF 400123')[1];
    const cancelled = ledger.cancel(target.id, 'reported twice');
    expect(cancelled.cancelled).toBe(true);
    expect(ledger.forCar('BNSF 400123')).toHaveLength(2);
    expect(ledger.forCar('BNSF 400123', { includeCancelled: true })).toHaveLength(3);
  });

  it('leaves the ledger size alone', () => {
    const ledger = eventLedger(feed);
    ledger.cancel(ledger.raw()[0].id, 'reported twice');
    expect(ledger.size).toBe(4);
  });

  it('returns nothing for an id it does not hold', () => {
    expect(eventLedger(feed).cancel('deadbeef', 'nope')).toBeUndefined();
  });

  it('will not cancel the same event twice', () => {
    const ledger = eventLedger(feed);
    const id = ledger.raw()[0].id;
    ledger.cancel(id, 'reported twice');
    expect(ledger.cancel(id, 'again')).toBeUndefined();
  });

  it('needs a reason', () => {
    const ledger = eventLedger(feed);
    expect(() => ledger.cancel(ledger.raw()[0].id)).toThrow(ValidationError);
  });
});

describe('between', () => {
  const ledger = eventLedger(feed);
  const from = parseInstant('2024-03-07T00:00-06:00');
  const to = parseInstant('2024-03-08T00:00-06:00');

  it('is closed at the start and open at the end', () => {
    expect(ledger.between(from, to).map((record) => record.code)).toEqual(['CP', 'AP']);
  });

  it('drops cancelled events unless asked', () => {
    const target = ledger.forCar('GATX 77')[0];
    ledger.cancel(target.id, 'wrong car');
    expect(ledger.between(from, to)).toHaveLength(1);
    expect(ledger.between(from, to, { includeCancelled: true })).toHaveLength(2);
  });
});

describe('groupByCar', () => {
  it('splits a loose list and sorts each stream', () => {
    const grouped = groupByCar(feed.map(trackEvent));
    expect([...grouped.keys()].sort()).toEqual(['BNSF 400123', 'GATX 77']);
    expect(grouped.get('BNSF 400123').map((record) => record.code)).toEqual(['ARR', 'AP', 'REL']);
  });

  it('handles an empty list', () => {
    expect(groupByCar([]).size).toBe(0);
  });
});
