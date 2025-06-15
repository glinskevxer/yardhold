import { describe, expect, it } from 'vitest';
import {
  INTERCHANGE_STATUS,
  REFUSAL_GRACE_HOURS,
  describeInterchange,
  interchange,
  interchangesForCar,
  isDeemedAccepted,
  refusals,
  responsibleCarrier,
  timeAtJunctionMinutes,
} from '../../src/switching/interchange.js';
import { parseInstant } from '../../src/time/instant.js';
import { ValidationError } from '../../src/core/errors.js';

const at = (text) => parseInstant(text, -360);

const base = {
  carId: 'bnsf400123',
  junction: ' memphis jct ',
  deliveringCarrier: 'bnsf',
  receivingCarrier: 'up',
  offeredAt: '2024-03-04T06:00',
};

describe('interchange', () => {
  it('normalises the car, the junction and both carriers', () => {
    const record = interchange(base);
    expect(record.carId).toBe('BNSF 400123');
    expect(record.junction).toBe('MEMPHIS JCT');
    expect(record.deliveringCarrier).toBe('BNSF');
    expect(record.receivingCarrier).toBe('UP');
  });

  it('works out when the offer is deemed accepted', () => {
    expect(interchange(base).deemedAcceptedAt).toBe(at('2024-03-05T06:00'));
    expect(REFUSAL_GRACE_HOURS).toBe(24);
  });

  it('takes a grace of its own', () => {
    expect(interchange({ ...base, graceHours: 4 }).deemedAcceptedAt).toBe(at('2024-03-04T10:00'));
  });

  it('refuses an interchange with the same carrier', () => {
    expect(() => interchange({ ...base, receivingCarrier: 'BNSF' })).toThrow(/same carrier/);
  });

  it('refuses a settlement before the offer', () => {
    expect(() => interchange({ ...base, settledAt: '2024-03-03T06:00' })).toThrow(
      /settled before it was offered/
    );
  });

  it('makes a refusal say why', () => {
    expect(() => interchange({ ...base, status: INTERCHANGE_STATUS.REFUSED })).toThrow(
      /has to say why/
    );
    const record = interchange({
      ...base,
      status: INTERCHANGE_STATUS.REFUSED,
      refusalReason: 'brake rigging down',
    });
    expect(record.refusalReason).toBe('brake rigging down');
  });

  it('refuses a status it does not know', () => {
    expect(() => interchange({ ...base, status: 'maybe' })).toThrow(ValidationError);
  });

  it('needs both carriers and a junction', () => {
    expect(() => interchange({ ...base, junction: undefined })).toThrow(ValidationError);
    expect(() => interchange({ ...base, receivingCarrier: undefined })).toThrow(ValidationError);
  });
});

describe('who owns the time', () => {
  it('gives it to the receiving carrier once accepted', () => {
    const record = interchange({
      ...base,
      status: INTERCHANGE_STATUS.ACCEPTED,
      settledAt: '2024-03-04T08:00',
    });
    expect(responsibleCarrier(record)).toBe('UP');
  });

  it('gives it back to the delivering carrier on a refusal', () => {
    const record = interchange({
      ...base,
      status: INTERCHANGE_STATUS.REFUSED,
      refusalReason: 'brake rigging down',
      settledAt: '2024-03-04T08:00',
    });
    expect(responsibleCarrier(record)).toBe('BNSF');
  });

  it('leaves it with the delivering carrier inside the grace', () => {
    const record = interchange(base);
    expect(responsibleCarrier(record, at('2024-03-04T20:00'))).toBe('BNSF');
  });

  it('moves it once the grace has run', () => {
    const record = interchange(base);
    expect(responsibleCarrier(record, at('2024-03-05T07:00'))).toBe('UP');
    expect(isDeemedAccepted(record, at('2024-03-05T07:00'))).toBe(true);
    expect(isDeemedAccepted(record, at('2024-03-04T20:00'))).toBe(false);
  });

  it('never deems an already settled interchange accepted', () => {
    const record = interchange({
      ...base,
      status: INTERCHANGE_STATUS.REFUSED,
      refusalReason: 'x',
    });
    expect(isDeemedAccepted(record, at('2024-03-09T07:00'))).toBe(false);
  });

  it('gives the same handover to two different carriers depending on the answer', () => {
    const accepted = interchange({ ...base, status: INTERCHANGE_STATUS.ACCEPTED });
    const refused = interchange({
      ...base,
      status: INTERCHANGE_STATUS.REFUSED,
      refusalReason: 'x',
    });
    expect(responsibleCarrier(accepted)).not.toBe(responsibleCarrier(refused));
  });
});

describe('time at the junction', () => {
  it('runs to the settlement when there is one', () => {
    const record = interchange({ ...base, settledAt: '2024-03-04T09:00' });
    expect(timeAtJunctionMinutes(record)).toBe(180);
  });

  it('runs to the moment asked about when there is not', () => {
    expect(timeAtJunctionMinutes(interchange(base), at('2024-03-04T12:00'))).toBe(360);
  });

  it('is nothing when nobody says when', () => {
    expect(timeAtJunctionMinutes(interchange(base))).toBe(0);
  });
});

describe('working with a set', () => {
  const records = [
    interchange({ ...base, offeredAt: '2024-03-06T06:00' }),
    interchange(base),
    interchange({
      ...base,
      carId: 'GATX 77',
      status: INTERCHANGE_STATUS.REFUSED,
      refusalReason: 'placard missing',
    }),
  ];

  it('finds a car in offer order', () => {
    const found = interchangesForCar(records, 'bnsf-400123');
    expect(found).toHaveLength(2);
    expect(found[0].offeredAt).toBeLessThan(found[1].offeredAt);
  });

  it('lists the refusals', () => {
    expect(refusals(records).map((record) => record.carId)).toEqual(['GATX 77']);
  });
});

describe('describeInterchange', () => {
  it('names both carriers and the junction', () => {
    expect(describeInterchange(interchange(base))).toBe(
      'BNSF 400123 BNSF to UP at MEMPHIS JCT 2024-03-04T06:00-06:00'
    );
  });
});
