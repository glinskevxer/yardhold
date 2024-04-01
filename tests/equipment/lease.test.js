import { describe, expect, it } from 'vitest';
import {
  LEASE_KIND,
  billableMiles,
  describeLease,
  isLeaseActive,
  lease,
  leaseExpired,
  optionalLeaseId,
  selectLease,
} from '../../src/equipment/lease.js';
import { quantity } from '../../src/core/quantity.js';
import { ValidationError } from '../../src/core/errors.js';

const base = {
  id: 'L-2024-11',
  lessee: 'Delta Chemical',
  lessor: 'General American',
  from: '2024-01-01',
  to: '2026-12-31',
};

describe('building a lease', () => {
  it('parses the money and the mileage terms', () => {
    const record = lease({
      ...base,
      monthlyRent: '1,250.00',
      mileageAllowance: '18000',
      mileageRate: '0.0425',
    });
    expect(record.monthlyRent).toBe(125000);
    expect(record.mileageAllowance).toEqual(quantity(18000, 0));
    expect(record.mileageRate).toEqual(quantity(425, 4));
  });

  it('defaults to a net lease', () => {
    expect(lease(base).kind).toBe(LEASE_KIND.NET);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(lease(base))).toBe(true);
  });

  it('needs both parties and both dates', () => {
    expect(() => lease({ ...base, lessee: undefined })).toThrow(ValidationError);
    expect(() => lease({ ...base, to: undefined })).toThrow(ValidationError);
  });

  it('refuses a backwards term', () => {
    expect(() => lease({ ...base, from: '2026-01-01', to: '2024-01-01' })).toThrow(
      /end before it starts/
    );
  });

  it('refuses negative money and mileage', () => {
    expect(() => lease({ ...base, monthlyRent: '-1.00' })).toThrow(/cannot be negative/);
    expect(() => lease({ ...base, mileageRate: '-0.0425' })).toThrow(/cannot be negative/);
  });

  it('refuses a repair share outside a percentage', () => {
    expect(() => lease({ ...base, repairSharePercent: 101 })).toThrow(ValidationError);
  });

  it('refuses a lease kind it does not know', () => {
    expect(() => lease({ ...base, kind: 'handshake' })).toThrow(ValidationError);
  });
});

describe('the term', () => {
  const record = lease(base);

  it('is active on both end days', () => {
    expect(isLeaseActive(record, '2024-01-01')).toBe(true);
    expect(isLeaseActive(record, '2026-12-31')).toBe(true);
  });

  it('is not active outside', () => {
    expect(isLeaseActive(record, '2023-12-31')).toBe(false);
    expect(isLeaseActive(record, '2027-01-01')).toBe(false);
  });

  it('reports expiry only forwards', () => {
    expect(leaseExpired(record, '2027-01-01')).toBe(true);
    expect(leaseExpired(record, '2023-12-31')).toBe(false);
  });
});

describe('billableMiles', () => {
  const record = lease({ ...base, mileageAllowance: '18000' });

  it('is zero inside the allowance', () => {
    expect(billableMiles(record, 17999)).toEqual(quantity(0, 0));
    expect(billableMiles(record, 18000)).toEqual(quantity(0, 0));
  });

  it('bills only the excess', () => {
    expect(billableMiles(record, 18500)).toEqual(quantity(500, 0));
  });

  it('takes a quantity as well as a number', () => {
    expect(billableMiles(record, quantity(19000, 0))).toEqual(quantity(1000, 0));
  });
});

describe('selectLease', () => {
  const older = lease({ ...base, id: 'L-OLD', from: '2020-01-01', to: '2024-12-31' });
  const newer = lease({ ...base, id: 'L-NEW', from: '2024-06-01', to: '2028-12-31' });

  it('returns nothing when none covers the day', () => {
    expect(selectLease([older, newer], '2019-01-01')).toBeUndefined();
  });

  it('picks the one that started most recently when they overlap', () => {
    expect(selectLease([older, newer], '2024-07-01').id).toBe('L-NEW');
  });

  it('falls back to the only one in force', () => {
    expect(selectLease([older, newer], '2024-02-01').id).toBe('L-OLD');
  });
});

describe('helpers', () => {
  it('describes a lease for a statement line', () => {
    expect(describeLease(lease(base))).toBe('L-2024-11 net Delta Chemical');
  });

  it('passes an optional lease id through', () => {
    expect(optionalLeaseId(undefined)).toBeUndefined();
    expect(optionalLeaseId('L-1')).toBe('L-1');
  });
});
