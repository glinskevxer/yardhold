import { describe, expect, it } from 'vitest';
import {
  EXCEPTION,
  carsWithExceptions,
  countByKind,
  exceptionReport,
  exceptionRows,
  exceptionsFor,
} from '../../src/reporting/exceptions.js';
import { MINUTES_PER_DAY } from '../../src/time/instant.js';
import { ValidationError } from '../../src/core/errors.js';

const detention = (extra = {}) => ({
  startsAt: 0,
  releasedAt: MINUTES_PER_DAY * 3,
  open: false,
  span: { start: 0, end: MINUTES_PER_DAY * 3 },
  ...extra,
});

const assessment = (carId, extra = {}) => ({
  carId,
  chargeableDays: 2,
  detentions: [detention()],
  counts: [{ relief: { applied: [], declined: [] } }],
  ...extra,
});

describe('exceptionsFor', () => {
  it('is quiet on an ordinary car', () => {
    expect(exceptionsFor(assessment('BNSF 1'))).toEqual([]);
  });

  it('flags a car that was never notified', () => {
    const found = exceptionsFor(
      assessment('BNSF 1', { detentions: [detention({ startsAt: undefined })] })
    );
    expect(found[0].kind).toBe(EXCEPTION.NEVER_NOTIFIED);
  });

  it('flags a car still standing', () => {
    const found = exceptionsFor(
      assessment('BNSF 1', { detentions: [detention({ open: true, releasedAt: undefined })] })
    );
    expect(found.some((entry) => entry.kind === EXCEPTION.STILL_OPEN)).toBe(true);
  });

  it('does not flag a detention a later placement superseded', () => {
    const found = exceptionsFor(
      assessment('BNSF 1', {
        detentions: [
          detention({ open: true, releasedAt: undefined, superseded: true }),
          detention(),
        ],
      })
    );
    expect(found.some((entry) => entry.kind === EXCEPTION.STILL_OPEN)).toBe(false);
  });

  it('flags a long stand', () => {
    const long = detention({ span: { start: 0, end: MINUTES_PER_DAY * 20 } });
    const found = exceptionsFor(assessment('BNSF 1', { detentions: [long] }));
    expect(found.some((entry) => entry.kind === EXCEPTION.LONG_STAND)).toBe(true);
  });

  it('takes a threshold of its own', () => {
    const long = detention({ span: { start: 0, end: MINUTES_PER_DAY * 20 } });
    const found = exceptionsFor(assessment('BNSF 1', { detentions: [long] }), {
      longStandDays: 30,
    });
    expect(found.some((entry) => entry.kind === EXCEPTION.LONG_STAND)).toBe(false);
  });

  it('flags relief that did not reach the car', () => {
    const found = exceptionsFor(
      assessment('BNSF 1', { counts: [{ relief: { applied: [], declined: [{}, {}] } }] })
    );
    const entry = found.find((item) => item.kind === EXCEPTION.RELIEF_DECLINED);
    expect(entry.detail).toContain('2 relief record(s)');
  });

  it('flags a suspension that was never lifted', () => {
    const found = exceptionsFor(
      assessment('BNSF 1', { unclosedSuspensions: [{ code: 'BO', at: 0 }] })
    );
    const entry = found.find((item) => item.kind === EXCEPTION.OPEN_SUSPENSION);
    expect(entry.detail).toContain('BO was reported and never lifted');
  });

  it('says nothing when there are no open suspensions', () => {
    expect(
      exceptionsFor(assessment('BNSF 1', { unclosedSuspensions: [] })).some(
        (item) => item.kind === EXCEPTION.OPEN_SUSPENSION
      )
    ).toBe(false);
  });

  it('flags a car that stood but was never chargeable', () => {
    const found = exceptionsFor(assessment('BNSF 1', { chargeableDays: 0 }));
    expect(found.some((entry) => entry.kind === EXCEPTION.NO_CHARGE)).toBe(true);
  });

  it('says nothing about a car that never stood', () => {
    const found = exceptionsFor(assessment('BNSF 1', { chargeableDays: 0, detentions: [] }));
    expect(found).toEqual([]);
  });

  it('refuses an absurd threshold', () => {
    expect(() => exceptionsFor(assessment('BNSF 1'), { longStandDays: 0 })).toThrow(
      ValidationError
    );
  });

  it('needs an assessment', () => {
    expect(() => exceptionsFor(undefined)).toThrow(ValidationError);
  });
});

describe('exceptionReport', () => {
  const result = {
    assessments: [
      assessment('BNSF 2', { chargeableDays: 0 }),
      assessment('BNSF 1', { detentions: [detention({ startsAt: undefined })] }),
    ],
    skipped: [{ carId: 'UP 3', why: 'no track this office knows' }],
  };

  it('puts the worst first', () => {
    const found = exceptionReport(result);
    expect(found[0].kind).toBe(EXCEPTION.NOT_ASSESSED);
    expect(found[1].kind).toBe(EXCEPTION.NEVER_NOTIFIED);
    expect(found[found.length - 1].kind).toBe(EXCEPTION.NO_CHARGE);
  });

  it('carries the skip reason through', () => {
    expect(exceptionReport(result)[0].detail).toBe('no track this office knows');
  });

  it('counts by kind', () => {
    expect(countByKind(exceptionReport(result))).toEqual({
      'never-notified': 1,
      'no-charge': 1,
      'not-assessed': 1,
    });
  });

  it('lists the cars once each', () => {
    expect(carsWithExceptions(exceptionReport(result))).toEqual(['BNSF 1', 'BNSF 2', 'UP 3']);
  });

  it('is empty for a clean month', () => {
    expect(exceptionReport({ assessments: [assessment('BNSF 1')], skipped: [] })).toEqual([]);
    expect(countByKind([])).toEqual({});
  });
});

describe('exceptionRows', () => {
  it('flattens for the table', () => {
    const rows = exceptionRows([{ kind: 'x', carId: 'BNSF 1', detail: 'y' }]);
    expect(rows).toEqual([{ kind: 'x', car: 'BNSF 1', detail: 'y' }]);
  });
});
