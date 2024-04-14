import { NotFoundError } from '../core/errors.js';
import { requireString } from '../core/guards.js';

/**
 * The event vocabulary. These are the codes the carrier reports and the ones
 * the office adds itself, and each one carries what it does to the car rather
 * than only what it is called.
 *
 *   starts    the event can start a demurrage or storage clock
 *   stops     the event can stop one
 *   suspends  the event opens a stretch that does not count
 *   resumes   the event closes one
 */

const CATALOGUE = new Map([
  ['ARR', { name: 'arrival at the serving yard', starts: false, stops: false, position: 10 }],
  ['NOT', { name: 'notification to the consignee', starts: false, stops: false, position: 20 }],
  ['CP', { name: 'constructive placement', starts: true, stops: false, position: 30 }],
  ['AP', { name: 'actual placement', starts: true, stops: false, position: 40 }],
  ['RSP', { name: 'respot after a partial unload', starts: true, stops: false, position: 45 }],
  ['REL', { name: 'release by the consignee', starts: false, stops: true, position: 60 }],
  ['PUL', { name: 'pull from the industry track', starts: false, stops: true, position: 70 }],
  ['DEP', { name: 'departure from the serving yard', starts: false, stops: true, position: 80 }],
  ['BO', { name: 'bad order', starts: false, stops: false, suspends: true, position: 50 }],
  ['BOR', { name: 'bad order released', starts: false, stops: false, resumes: true, position: 51 }],
  ['EMB', { name: 'embargo applied', starts: false, stops: false, suspends: true, position: 52 }],
  ['EMR', { name: 'embargo lifted', starts: false, stops: false, resumes: true, position: 53 }],
  [
    'HLD',
    {
      name: 'held at the consignee request',
      starts: false,
      stops: false,
      suspends: true,
      position: 54,
    },
  ],
  ['HLR', { name: 'hold released', starts: false, stops: false, resumes: true, position: 55 }],
  ['DIV', { name: 'diversion ordered', starts: false, stops: true, position: 75 }],
  ['RCN', { name: 'reconsignment ordered', starts: false, stops: true, position: 76 }],
]);

export function eventCode(text) {
  return requireString(text, 'code').trim().toUpperCase();
}

export function eventKind(code) {
  const key = eventCode(code);
  const found = CATALOGUE.get(key);
  if (!found) {
    throw new NotFoundError('event code', key);
  }
  return {
    code: key,
    suspends: false,
    resumes: false,
    ...found,
  };
}

export function isKnownEventCode(code) {
  return CATALOGUE.has(eventCode(code));
}

export function knownEventCodes() {
  return [...CATALOGUE.keys()].sort();
}

export function startsClock(code) {
  return eventKind(code).starts;
}

export function stopsClock(code) {
  return eventKind(code).stops;
}

export function suspendsClock(code) {
  return eventKind(code).suspends;
}

export function resumesClock(code) {
  return eventKind(code).resumes;
}

/**
 * When two events carry the same timestamp the order is decided here, not by
 * the order the feed happened to list them in. A release and a pull stamped
 * the same minute have to settle the same way every time.
 */
export function orderPosition(code) {
  return eventKind(code).position;
}

export function compareEventCodes(left, right) {
  return orderPosition(left) - orderPosition(right);
}

export function describeEventCode(code) {
  const kind = eventKind(code);
  return `${kind.code} ${kind.name}`;
}

export const SUSPENSION_PAIRS = Object.freeze({
  BO: 'BOR',
  EMB: 'EMR',
  HLD: 'HLR',
});

export function resumeCodeFor(code) {
  return SUSPENSION_PAIRS[eventCode(code)];
}
