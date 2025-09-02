import { requireObject } from '../core/guards.js';
import { period } from '../time/period.js';
import { eventKind } from '../events/eventTypes.js';
import { PLACEMENT, classifyPlacement } from './placement.js';
import { addMinutes } from '../time/instant.js';

/**
 * A detention is one visit: the car was placed, it stood, and it was released.
 * A respot after a partial unload opens a second detention on the same car, and
 * that matters because a ladder that resets each detention starts over at the
 * respot while a ladder that runs to the month does not.
 *
 * An open detention is not an error. A car standing at month end is billed to
 * the cut off and the rest lands on next month's invoice.
 */

export function buildDetentions(events, { page, trackBook, until } = {}) {
  requireObject(page, 'page');
  const detentions = [];
  let open;
  let pendingNotice;
  for (const record of events) {
    const kind = eventKind(record.code);
    if (record.code === 'NOT') {
      if (open === undefined) {
        pendingNotice = record;
      } else if (open.notifiedAt === undefined) {
        open.notifiedAt = record.at;
        open.startsAt = startFrom(open.placedAt, record.at, page);
      }
      continue;
    }
    if (kind.starts) {
      if (open !== undefined) {
        detentions.push(close(open, undefined, undefined, true));
      }
      open = openDetention(record, pendingNotice, { page, trackBook });
      pendingNotice = undefined;
      continue;
    }
    if (kind.stops && open !== undefined) {
      detentions.push(close(open, record.at, record));
      open = undefined;
    }
  }
  if (open !== undefined) {
    detentions.push(close(open, until, undefined));
  }
  return detentions;
}

function startFrom(placedAt, noticeAt, page) {
  if (!page.notificationRequired) {
    return placedAt;
  }
  if (noticeAt === undefined) {
    return undefined;
  }
  return Math.max(placedAt, addMinutes(noticeAt, page.noticeGraceMinutes));
}

function openDetention(record, notice, { page, trackBook }) {
  const noticeAt = notice === undefined ? undefined : notice.at;
  return {
    kind: classifyPlacement(record, trackBook),
    placedAt: record.at,
    notifiedAt: noticeAt,
    startsAt: startFrom(record.at, noticeAt, page),
    trackId: record.trackId,
    spot: record.spot,
    placementEvent: record,
  };
}

function close(open, endsAt, event, superseded = false) {
  const releasedAt = endsAt === undefined ? undefined : endsAt;
  const startsAt = open.startsAt;
  const chargeable =
    startsAt === undefined || releasedAt === undefined || releasedAt <= startsAt
      ? undefined
      : period(startsAt, releasedAt);
  return Object.freeze({
    ...open,
    releasedAt,
    releaseEvent: event,
    open: releasedAt === undefined,
    /**
     * Closed by a later placement rather than by a release. The car did not
     * stay, it moved, so this is not a car standing at the cut off. Reading the
     * two as the same thing flagged every constructively placed car on the
     * property as still on the ground.
     */
    superseded,
    span: chargeable,
  });
}

export function isOpen(detention) {
  return detention.open === true;
}

/** Still on the ground at the cut off, as against merely moved on from. */
export function isStillStanding(detention) {
  return detention.open === true && detention.superseded !== true;
}

export function detentionMinutes(detention) {
  return detention.span === undefined ? 0 : detention.span.end - detention.span.start;
}

export function constructiveDetentions(detentions) {
  return detentions.filter((entry) => entry.kind === PLACEMENT.CONSTRUCTIVE);
}

export function actualDetentions(detentions) {
  return detentions.filter((entry) => entry.kind === PLACEMENT.ACTUAL);
}

export function firstStart(detentions) {
  const starts = detentions.map((entry) => entry.startsAt).filter((value) => value !== undefined);
  return starts.length === 0 ? undefined : Math.min(...starts);
}

export function lastRelease(detentions) {
  const ends = detentions.map((entry) => entry.releasedAt).filter((value) => value !== undefined);
  return ends.length === 0 ? undefined : Math.max(...ends);
}

export function countRespots(detentions) {
  return Math.max(0, detentions.length - 1);
}
