import { requireObject } from '../core/guards.js';
import { addMinutes } from '../time/instant.js';
import { TRACK_ROLE } from '../site/track.js';
import { eventKind } from '../events/eventTypes.js';

/**
 * Working out when the clock is allowed to start.
 *
 * Three things have to agree: the carrier put the car somewhere, the consignee
 * was told, and the tariff says notification counts. A placement reported on a
 * hold track is constructive however it was coded, and a placement coded
 * constructive onto the industry track is actual, because what the car is
 * sitting on is a fact and what the feed called it is an opinion.
 */

export const PLACEMENT = Object.freeze({
  ACTUAL: 'actual',
  CONSTRUCTIVE: 'constructive',
  NONE: 'none',
});

export function classifyPlacement(event, trackBook) {
  if (event === undefined) {
    return PLACEMENT.NONE;
  }
  const track = event.trackId === undefined ? undefined : trackBook?.find(event.trackId);
  if (track !== undefined) {
    return track.role === TRACK_ROLE.INDUSTRY ? PLACEMENT.ACTUAL : PLACEMENT.CONSTRUCTIVE;
  }
  return event.code === 'AP' || event.code === 'RSP' ? PLACEMENT.ACTUAL : PLACEMENT.CONSTRUCTIVE;
}

export function firstPlacement(events) {
  return events.find((record) => eventKind(record.code).starts);
}

export function firstNotification(events) {
  return events.find((record) => record.code === 'NOT');
}

/**
 * The clock starts at the later of the placement and the moment notification
 * takes effect. A page that does not require notification ignores it entirely,
 * which is the difference between a car that starts running on Friday night
 * and one that starts running on Monday morning.
 */
export function resolvePlacement(events, { page, trackBook } = {}) {
  requireObject(page, 'page');
  const placement = firstPlacement(events);
  if (placement === undefined) {
    return {
      kind: PLACEMENT.NONE,
      placedAt: undefined,
      notifiedAt: undefined,
      startsAt: undefined,
      waitingOnNotice: false,
    };
  }
  const kind = classifyPlacement(placement, trackBook);
  const notice = firstNotification(events);
  const noticeEffective =
    notice === undefined ? undefined : addMinutes(notice.at, page.noticeGraceMinutes);
  if (!page.notificationRequired) {
    return {
      kind,
      placedAt: placement.at,
      notifiedAt: notice?.at,
      startsAt: placement.at,
      waitingOnNotice: false,
      event: placement,
    };
  }
  if (noticeEffective === undefined) {
    return {
      kind,
      placedAt: placement.at,
      notifiedAt: undefined,
      startsAt: undefined,
      waitingOnNotice: true,
      event: placement,
    };
  }
  return {
    kind,
    placedAt: placement.at,
    notifiedAt: notice.at,
    startsAt: Math.max(placement.at, noticeEffective),
    waitingOnNotice: false,
    event: placement,
  };
}

export function isConstructive(resolved) {
  return resolved.kind === PLACEMENT.CONSTRUCTIVE;
}

export function isActual(resolved) {
  return resolved.kind === PLACEMENT.ACTUAL;
}

export function noticeDelayMinutes(resolved) {
  if (resolved.startsAt === undefined || resolved.placedAt === undefined) {
    return 0;
  }
  return resolved.startsAt - resolved.placedAt;
}

export function describePlacement(resolved) {
  if (resolved.kind === PLACEMENT.NONE) {
    return 'never placed';
  }
  if (resolved.waitingOnNotice) {
    return `${resolved.kind} placement, notice outstanding`;
  }
  return `${resolved.kind} placement`;
}
