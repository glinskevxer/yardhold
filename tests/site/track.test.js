import { describe, expect, it } from 'vitest';
import {
  TRACK_ROLE,
  hasSpot,
  isHoldTrack,
  supportsActualPlacement,
  track,
  trackBook,
} from '../../src/site/track.js';
import { ConflictError, NotFoundError, ValidationError } from '../../src/core/errors.js';

const industry = {
  id: 'IT-9',
  splc: '412300',
  name: 'Delta Chemical lead',
  capacityCars: 6,
  spots: ['A', 'b', 'C'],
  consigneeId: 'DELTA',
};

const hold = {
  id: 'HT-1',
  splc: '412300',
  name: 'North hold',
  role: TRACK_ROLE.HOLD,
  capacityCars: 20,
};

describe('track', () => {
  it('uppercases and freezes the spots', () => {
    const record = track(industry);
    expect(record.spots).toEqual(['A', 'B', 'C']);
    expect(Object.isFrozen(record.spots)).toBe(true);
  });

  it('assumes an industry track belongs to the industry', () => {
    expect(track(industry).ownedByCarrier).toBe(false);
    expect(track(hold).ownedByCarrier).toBe(true);
  });

  it('takes an explicit ownership either way', () => {
    expect(track({ ...industry, ownedByCarrier: true }).ownedByCarrier).toBe(true);
  });

  it('makes an industry track name its consignee', () => {
    expect(() => track({ ...industry, consigneeId: undefined })).toThrow(/name its consignee/);
  });

  it('lets a hold track have no consignee', () => {
    expect(track(hold).consigneeId).toBeUndefined();
  });

  it('refuses duplicate spots', () => {
    expect(() => track({ ...industry, spots: ['A', 'a'] })).toThrow(/same spot twice/);
  });

  it('refuses more spots than car lengths', () => {
    expect(() => track({ ...industry, capacityCars: 2 })).toThrow(/more spots than car lengths/);
  });

  it('refuses a role it does not know', () => {
    expect(() => track({ ...industry, role: 'siding' })).toThrow(ValidationError);
  });
});

describe('what the role decides', () => {
  it('allows actual placement only on industry track', () => {
    expect(supportsActualPlacement(track(industry))).toBe(true);
    expect(supportsActualPlacement(track(hold))).toBe(false);
  });

  it('spots the hold track', () => {
    expect(isHoldTrack(track(hold))).toBe(true);
    expect(isHoldTrack(track(industry))).toBe(false);
  });
});

describe('hasSpot', () => {
  it('matches a listed spot case insensitively', () => {
    expect(hasSpot(track(industry), ' b ')).toBe(true);
    expect(hasSpot(track(industry), 'D')).toBe(false);
  });

  it('accepts anything on a track with no named spots', () => {
    expect(hasSpot(track(hold), 'anything')).toBe(true);
  });
});

describe('trackBook', () => {
  const book = trackBook([industry, hold, { ...industry, id: 'IT-10', splc: '412400' }]);

  it('indexes by id', () => {
    expect(book.size).toBe(3);
    expect(book.get('IT-9').name).toBe('Delta Chemical lead');
    expect(() => book.get('IT-99')).toThrow(NotFoundError);
    expect(book.find('IT-99')).toBeUndefined();
    expect(book.has('HT-1')).toBe(true);
  });

  it('slices by station, role and consignee', () => {
    expect(book.atStation('412300')).toHaveLength(2);
    expect(book.ofRole(TRACK_ROLE.HOLD)).toHaveLength(1);
    expect(book.forConsignee('DELTA')).toHaveLength(2);
  });

  it('adds up capacity', () => {
    expect(book.totalCapacity()).toBe(32);
    expect(book.totalCapacity('412300')).toBe(26);
  });

  it('lists in id order', () => {
    expect(book.all().map((entry) => entry.id)).toEqual(['HT-1', 'IT-10', 'IT-9']);
  });

  it('refuses a duplicate id', () => {
    expect(() => trackBook([industry, industry])).toThrow(ConflictError);
  });
});
