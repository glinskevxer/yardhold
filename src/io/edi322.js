import { IngestError } from '../core/errors.js';
import { requireString } from '../core/guards.js';
import { trackEvent } from '../events/event.js';

/**
 * Reading a 322.
 *
 * The rail terminal operations set is the feed most carriers actually send, and
 * it is a flat pile of segments rather than a table. What this reader wants is
 * the N7 for the car and the R4 or Y6 status codes with their dates, and it is
 * deliberately forgiving about everything else, because a real 322 carries a
 * dozen segment types this office has no use for.
 */

const ELEMENT = '*';
const SEGMENT = '~';

export const STATUS_TO_EVENT = Object.freeze({
  AA: 'ARR',
  AB: 'CP',
  AC: 'AP',
  AD: 'REL',
  AE: 'PUL',
  AF: 'DEP',
  AG: 'NOT',
  BO: 'BO',
  BR: 'BOR',
});

export function splitSegments(text) {
  return requireString(text, 'text')
    .split(SEGMENT)
    .map((segment) => segment.trim())
    .filter((segment) => segment !== '')
    .map((segment) => segment.split(ELEMENT).map((element) => element.trim()));
}

export function parseDateTime(date, time) {
  if (!/^\d{8}$/.test(date ?? '')) {
    throw new IngestError('a 322 date has to be eight digits', { date });
  }
  const clock = time === undefined || time === '' ? '0000' : time;
  if (!/^\d{4}$/.test(clock)) {
    throw new IngestError('a 322 time has to be four digits', { time });
  }
  return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${clock.slice(0, 2)}:${clock.slice(2, 4)}`;
}

export function readSegments(segments, { offsetMinutes = -360 } = {}) {
  const events = [];
  const problems = [];
  let carId;
  let trackId;
  for (const segment of segments) {
    const [tag, ...rest] = segment;
    if (tag === 'N7') {
      carId = `${rest[0] ?? ''} ${rest[1] ?? ''}`.trim();
      trackId = undefined;
      continue;
    }
    if (tag === 'N9' && rest[0] === 'TR') {
      trackId = rest[1];
      continue;
    }
    if (tag !== 'R4' && tag !== 'Y6') {
      continue;
    }
    const code = STATUS_TO_EVENT[rest[0]];
    if (code === undefined) {
      problems.push({ kind: 'unknown-status', status: rest[0], carId });
      continue;
    }
    if (carId === undefined) {
      problems.push({ kind: 'status-before-car', status: rest[0] });
      continue;
    }
    try {
      events.push(
        trackEvent({ carId, code, at: parseDateTime(rest[1], rest[2]), trackId, offsetMinutes })
      );
    } catch (error) {
      problems.push({ kind: 'bad-status', status: rest[0], carId, message: error.message });
    }
  }
  return { events, problems };
}

export function readEdi322(text, options = {}) {
  return readSegments(splitSegments(text), options);
}

export function isLikely322(text) {
  if (typeof text !== 'string') {
    return false;
  }
  return /(^|~)\s*(ISA|ST\*322|N7)\*/.test(text);
}
