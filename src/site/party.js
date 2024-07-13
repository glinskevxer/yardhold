import { ValidationError } from '../core/errors.js';
import { keyedBook } from '../core/keyedBook.js';
import {
  optional,
  requireArray,
  requireInteger,
  requireOneOf,
  requireString,
} from '../core/guards.js';

/**
 * Parties. A consignee receives, a shipper loads, and the same company is often
 * both at the same plant. What the billing cares about is who is responsible
 * for the car while it sits, which is a separate field again, because a plant
 * can hold cars a third party has agreed to answer for.
 */

export const PARTY_ROLE = Object.freeze({
  CONSIGNEE: 'consignee',
  SHIPPER: 'shipper',
  BOTH: 'both',
  THIRD_PARTY: 'third-party',
});

const ROLES = Object.values(PARTY_ROLE);

export const NOTICE_METHOD = Object.freeze({
  EMAIL: 'email',
  EDI: 'edi',
  PHONE: 'phone',
  PORTAL: 'portal',
});

const METHODS = Object.values(NOTICE_METHOD);

export function party({
  id,
  name,
  role = PARTY_ROLE.CONSIGNEE,
  noticeMethod = NOTICE_METHOD.EDI,
  noticeAddress,
  responsibleFor = [],
  paymentTermsDays = 15,
  averageAgreementId,
  active = true,
} = {}) {
  requireString(id, 'id');
  requireString(name, 'name');
  requireOneOf(role, ROLES, 'role');
  requireOneOf(noticeMethod, METHODS, 'noticeMethod');
  requireArray(responsibleFor, 'responsibleFor');
  requireInteger(paymentTermsDays, 'paymentTermsDays', { min: 0, max: 120 });
  if (noticeMethod !== NOTICE_METHOD.PHONE && noticeAddress === undefined) {
    throw new ValidationError('a party noticed by anything but phone needs an address', { id });
  }
  return Object.freeze({
    id: id.trim().toUpperCase(),
    name: name.trim(),
    role,
    noticeMethod,
    noticeAddress: optional(noticeAddress, (value) => requireString(value, 'noticeAddress')),
    responsibleFor: Object.freeze(
      responsibleFor.map((value) => requireString(value, 'responsibleFor').trim().toUpperCase())
    ),
    paymentTermsDays,
    averageAgreementId: optional(averageAgreementId, (value) =>
      requireString(value, 'averageAgreementId')
    ),
    active: active === true,
  });
}

export function receives(record) {
  return record.role === PARTY_ROLE.CONSIGNEE || record.role === PARTY_ROLE.BOTH;
}

export function ships(record) {
  return record.role === PARTY_ROLE.SHIPPER || record.role === PARTY_ROLE.BOTH;
}

export function isOnAverageAgreement(record) {
  return record.averageAgreementId !== undefined;
}

/** Who answers for a car standing at this party's plant. */
export function billTo(record, partyBook) {
  if (record.responsibleFor.length === 0) {
    return record.id;
  }
  const guarantor = record.responsibleFor[0];
  const found = partyBook.find(guarantor);
  return found && found.active ? guarantor : record.id;
}

export function partyBook(parties = []) {
  const book = keyedBook({
    label: 'party',
    records: parties,
    keyOf: (record) => record.id,
    build: (record) => (record.noticeMethod && record.responsibleFor ? record : party(record)),
    normalizeKey: (id) => requireString(id, 'id').trim().toUpperCase(),
  });
  return {
    get size() {
      return book.size;
    },
    has: book.has,
    get: book.get,
    find: book.find,
    all: book.all,
    active() {
      return book.filter((entry) => entry.active);
    },
    onAverageAgreement() {
      return book.filter(isOnAverageAgreement);
    },
  };
}
