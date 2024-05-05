import { describe, expect, it } from 'vitest';
import {
  PROBLEM,
  applySupersessions,
  checkSequence,
  dedupe,
  normalizeStream,
  problemsOfKind,
} from '../../src/events/normalize.js';
import { EVENT_SOURCE, trackEvent } from '../../src/events/event.js';
import { ValidationError } from '../../src/core/errors.js';

const build = (rows) => rows.map(trackEvent);
const car = 'BNSF 400123';

describe('dedupe', () => {
  it('collapses two reports of the same event', () => {
    const { events, problems } = dedupe(
      build([
        { carId: car, code: 'AP', at: '2024-03-07T08:00', trackId: 'IT-9' },
        { carId: car, code: 'AP', at: '2024-03-07T08:00', trackId: 'IT-9' },
      ])
    );
    expect(events).toHaveLength(1);
    expect(problems).toHaveLength(1);
    expect(problems[0].kind).toBe(PROBLEM.DUPLICATE);
  });

  it('keeps the carrier report over an office entry', () => {
    const { events } = dedupe(
      build([
        {
          carId: car,
          code: 'AP',
          at: '2024-03-07T08:00',
          source: EVENT_SOURCE.OFFICE,
          reason: 'phoned in',
        },
        { carId: car, code: 'AP', at: '2024-03-07T08:00' },
      ])
    );
    expect(events[0].source).toBe(EVENT_SOURCE.CARRIER);
  });

  it('keeps the earlier report when the source is the same', () => {
    const { events } = dedupe(
      build([
        { carId: car, code: 'AP', at: '2024-03-07T08:00', reportedAt: '2024-03-07T12:00' },
        { carId: car, code: 'AP', at: '2024-03-07T08:00', reportedAt: '2024-03-07T09:00' },
      ])
    );
    expect(events[0].reportedAt).toBe(
      trackEvent({ carId: car, code: 'AP', at: '2024-03-07T09:00' }).at
    );
  });

  it('leaves two different events alone', () => {
    const { events, problems } = dedupe(
      build([
        { carId: car, code: 'AP', at: '2024-03-07T08:00' },
        { carId: car, code: 'REL', at: '2024-03-09T10:00' },
      ])
    );
    expect(events).toHaveLength(2);
    expect(problems).toEqual([]);
  });

  it('refuses a non array', () => {
    expect(() => dedupe('nope')).toThrow(ValidationError);
  });
});

describe('applySupersessions', () => {
  it('cancels the event a later one replaces', () => {
    const first = trackEvent({ carId: car, code: 'AP', at: '2024-03-07T08:00' });
    const correction = trackEvent({
      carId: car,
      code: 'AP',
      at: '2024-03-07T09:00',
      supersedes: first.id,
    });
    const { events, problems } = applySupersessions([first, correction]);
    expect(events[0].cancelled).toBe(true);
    expect(events[0].reason).toBe('superseded');
    expect(events[1].cancelled).toBe(false);
    expect(problems).toEqual([]);
  });

  it('reports a correction that points at nothing', () => {
    const correction = trackEvent({
      carId: car,
      code: 'AP',
      at: '2024-03-07T09:00',
      supersedes: 'deadbeef',
    });
    const { problems } = applySupersessions([correction]);
    expect(problems[0].kind).toBe(PROBLEM.SUPERSEDED_MISSING);
  });
});

describe('checkSequence', () => {
  it('is quiet on a clean stream', () => {
    const problems = checkSequence(
      build([
        { carId: car, code: 'CP', at: '2024-03-07T06:00' },
        { carId: car, code: 'REL', at: '2024-03-09T10:00' },
      ])
    );
    expect(problems).toEqual([]);
  });

  it('catches a release with no placement', () => {
    const problems = checkSequence(build([{ carId: car, code: 'REL', at: '2024-03-09T10:00' }]));
    expect(problems[0].kind).toBe(PROBLEM.STOP_BEFORE_START);
  });

  it('catches two placements with nothing between', () => {
    const problems = checkSequence(
      build([
        { carId: car, code: 'AP', at: '2024-03-07T08:00' },
        { carId: car, code: 'AP', at: '2024-03-08T08:00' },
      ])
    );
    expect(problems[0].kind).toBe(PROBLEM.DOUBLE_START);
  });

  it('allows a respot after a release', () => {
    const problems = checkSequence(
      build([
        { carId: car, code: 'AP', at: '2024-03-07T08:00' },
        { carId: car, code: 'REL', at: '2024-03-08T08:00' },
        { carId: car, code: 'RSP', at: '2024-03-08T12:00' },
        { carId: car, code: 'REL', at: '2024-03-09T08:00' },
      ])
    );
    expect(problems).toEqual([]);
  });

  it('catches a bad order that never came back', () => {
    const problems = checkSequence(
      build([
        { carId: car, code: 'AP', at: '2024-03-07T08:00' },
        { carId: car, code: 'BO', at: '2024-03-08T08:00' },
      ])
    );
    expect(problems[0].kind).toBe(PROBLEM.UNPAIRED_SUSPENSION);
    expect(problems[0].expected).toBe('BOR');
  });

  it('catches a resume with nothing to resume', () => {
    const problems = checkSequence(
      build([
        { carId: car, code: 'AP', at: '2024-03-07T08:00' },
        { carId: car, code: 'BOR', at: '2024-03-08T08:00' },
      ])
    );
    expect(problems[0].kind).toBe(PROBLEM.RESUME_WITHOUT_SUSPENSION);
  });

  it('keeps each car separate', () => {
    const problems = checkSequence(
      build([
        { carId: car, code: 'AP', at: '2024-03-07T08:00' },
        { carId: 'GATX 77', code: 'AP', at: '2024-03-07T08:00' },
      ])
    );
    expect(problems).toEqual([]);
  });
});

describe('normalizeStream', () => {
  it('runs all three passes and gathers the problems', () => {
    const first = trackEvent({ carId: car, code: 'AP', at: '2024-03-07T08:00' });
    const { events, problems } = normalizeStream([
      first,
      first,
      trackEvent({ carId: car, code: 'REL', at: '2024-03-09T10:00' }),
      trackEvent({ carId: 'UP 3', code: 'PUL', at: '2024-03-09T10:00' }),
    ]);
    expect(events).toHaveLength(3);
    expect(problemsOfKind(problems, PROBLEM.DUPLICATE)).toHaveLength(1);
    expect(problemsOfKind(problems, PROBLEM.STOP_BEFORE_START)).toHaveLength(1);
  });

  it('never throws on a broken stream', () => {
    expect(() =>
      normalizeStream(build([{ carId: car, code: 'PUL', at: '2024-03-09T10:00' }]))
    ).not.toThrow();
  });
});
