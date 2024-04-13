import { describe, expect, it } from 'vitest';
import {
  NOTICE_METHOD,
  PARTY_ROLE,
  billTo,
  isOnAverageAgreement,
  party,
  partyBook,
  receives,
  ships,
} from '../../src/site/party.js';
import { ConflictError, NotFoundError, ValidationError } from '../../src/core/errors.js';

const delta = {
  id: ' delta ',
  name: 'Delta Chemical',
  noticeAddress: 'rail@deltachem.example',
};

describe('party', () => {
  it('normalises the id and keeps the name as written', () => {
    const record = party(delta);
    expect(record.id).toBe('DELTA');
    expect(record.name).toBe('Delta Chemical');
  });

  it('defaults to a consignee noticed by EDI', () => {
    const record = party(delta);
    expect(record.role).toBe(PARTY_ROLE.CONSIGNEE);
    expect(record.noticeMethod).toBe(NOTICE_METHOD.EDI);
  });

  it('needs an address for every method but phone', () => {
    expect(() => party({ ...delta, noticeAddress: undefined })).toThrow(/needs an address/);
    expect(
      party({ ...delta, noticeMethod: NOTICE_METHOD.PHONE, noticeAddress: undefined }).noticeAddress
    ).toBeUndefined();
  });

  it('refuses payment terms outside the range', () => {
    expect(() => party({ ...delta, paymentTermsDays: 200 })).toThrow(ValidationError);
  });

  it('refuses a role or method it does not know', () => {
    expect(() => party({ ...delta, role: 'broker' })).toThrow(ValidationError);
    expect(() => party({ ...delta, noticeMethod: 'fax' })).toThrow(ValidationError);
  });

  it('freezes the guarantor list', () => {
    const record = party({ ...delta, responsibleFor: ['acme'] });
    expect(record.responsibleFor).toEqual(['ACME']);
    expect(Object.isFrozen(record.responsibleFor)).toBe(true);
  });
});

describe('roles', () => {
  it('reads receiving and shipping off the role', () => {
    expect(receives(party(delta))).toBe(true);
    expect(ships(party(delta))).toBe(false);
    const both = party({ ...delta, role: PARTY_ROLE.BOTH });
    expect(receives(both)).toBe(true);
    expect(ships(both)).toBe(true);
  });

  it('leaves a third party neither', () => {
    const third = party({ ...delta, role: PARTY_ROLE.THIRD_PARTY });
    expect(receives(third)).toBe(false);
    expect(ships(third)).toBe(false);
  });
});

describe('average agreement', () => {
  it('is off unless an agreement is named', () => {
    expect(isOnAverageAgreement(party(delta))).toBe(false);
    expect(isOnAverageAgreement(party({ ...delta, averageAgreementId: 'AVG-1' }))).toBe(true);
  });
});

describe('billTo', () => {
  const book = partyBook([
    delta,
    { id: 'ACME', name: 'Acme Logistics', noticeAddress: 'ap@acme.example' },
    { id: 'GONE', name: 'Closed Co', noticeAddress: 'x@y.example', active: false },
  ]);

  it('bills the party itself when nobody has taken it on', () => {
    expect(billTo(book.get('DELTA'), book)).toBe('DELTA');
  });

  it('bills the guarantor when there is one', () => {
    const record = party({ ...delta, responsibleFor: ['ACME'] });
    expect(billTo(record, book)).toBe('ACME');
  });

  it('falls back when the guarantor is not active', () => {
    const record = party({ ...delta, responsibleFor: ['GONE'] });
    expect(billTo(record, book)).toBe('DELTA');
  });

  it('falls back when the guarantor is not in the book at all', () => {
    const record = party({ ...delta, responsibleFor: ['NOBODY'] });
    expect(billTo(record, book)).toBe('DELTA');
  });
});

describe('partyBook', () => {
  const book = partyBook([
    delta,
    { id: 'ACME', name: 'Acme', noticeAddress: 'a@b.example', averageAgreementId: 'AVG-1' },
    { id: 'GONE', name: 'Closed Co', noticeAddress: 'x@y.example', active: false },
  ]);

  it('looks up case insensitively', () => {
    expect(book.has('delta')).toBe(true);
    expect(book.get(' delta ').name).toBe('Delta Chemical');
    expect(book.find('nobody')).toBeUndefined();
    expect(() => book.get('nobody')).toThrow(NotFoundError);
  });

  it('slices the book', () => {
    expect(book.size).toBe(3);
    expect(book.active()).toHaveLength(2);
    expect(book.onAverageAgreement()).toHaveLength(1);
    expect(book.all().map((entry) => entry.id)).toEqual(['ACME', 'DELTA', 'GONE']);
  });

  it('refuses a duplicate id', () => {
    expect(() => partyBook([delta, delta])).toThrow(ConflictError);
  });
});
