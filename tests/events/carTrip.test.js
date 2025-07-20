import { describe, expect, it } from 'vitest';
import {
  describeTrip,
  openTrips,
  repeatVisitors,
  splitTrips,
  tripMinutes,
  tripSummary,
  tripsByCar,
  tripsForCar,
} from '../../src/events/carTrip.js';
import { trackEvent } from '../../src/events/event.js';
import { parseInstant } from '../../src/time/instant.js';
import { ValidationError } from '../../src/core/errors.js';

const at = (text) => parseInstant(text, -360);
const build = (rows) => rows.map((row) => trackEvent({ carId: 'BNSF 400123', ...row }));

const oneTrip = build([
  { code: 'ARR', at: '2024-03-03T22:00' },
  { code: 'AP', at: '2024-03-04T08:00', trackId: 'IT-9' },
  { code: 'REL', at: '2024-03-08T10:00' },
  { code: 'PUL', at: '2024-03-08T14:00', trackId: 'IT-9' },
  { code: 'DEP', at: '2024-03-09T06:00' },
]);

const twoTrips = [
  ...oneTrip,
  ...build([
    { code: 'ARR', at: '2024-03-20T22:00' },
    { code: 'AP', at: '2024-03-21T08:00', trackId: 'IT-10' },
    { code: 'REL', at: '2024-03-23T10:00' },
    { code: 'DEP', at: '2024-03-24T06:00' },
  ]),
];

describe('splitTrips', () => {
  it('makes one trip of a complete visit', () => {
    expect(splitTrips(oneTrip)).toHaveLength(1);
  });

  it('splits at each departure', () => {
    expect(splitTrips(twoTrips)).toHaveLength(2);
  });

  it('keeps a trailing visit that has not departed', () => {
    const trips = splitTrips([...oneTrip, ...build([{ code: 'ARR', at: '2024-03-20T22:00' }])]);
    expect(trips).toHaveLength(2);
    expect(trips[1]).toHaveLength(1);
  });

  it('does not split on a pull', () => {
    const noDeparture = build([
      { code: 'ARR', at: '2024-03-03T22:00' },
      { code: 'PUL', at: '2024-03-08T14:00', trackId: 'IT-9' },
    ]);
    expect(splitTrips(noDeparture)).toHaveLength(1);
  });

  it('has nothing to split in an empty stream', () => {
    expect(splitTrips([])).toEqual([]);
  });

  it('refuses a non array', () => {
    expect(() => splitTrips('nope')).toThrow(ValidationError);
  });
});

describe('tripSummary', () => {
  const trip = tripSummary(oneTrip);

  it('finds both ends', () => {
    expect(trip.arrivedAt).toBe(at('2024-03-03T22:00'));
    expect(trip.departedAt).toBe(at('2024-03-09T06:00'));
    expect(trip.open).toBe(false);
  });

  it('counts the placements and the releases without the departure', () => {
    expect(trip.placements).toBe(1);
    expect(trip.releases).toBe(2);
  });

  it('lists the tracks it touched', () => {
    expect(trip.tracks).toEqual(['IT-9']);
  });

  it('measures the visit', () => {
    expect(tripMinutes(trip)).toBe(5 * 1440 + 8 * 60);
  });

  it('reports an open visit as open', () => {
    const open = tripSummary(oneTrip.slice(0, 3));
    expect(open.open).toBe(true);
    expect(tripMinutes(open)).toBeUndefined();
  });

  it('survives a stream with no arrival', () => {
    const summary = tripSummary(build([{ code: 'AP', at: '2024-03-04T08:00', trackId: 'IT-9' }]));
    expect(summary.arrivedAt).toBeUndefined();
    expect(tripMinutes(summary)).toBeUndefined();
  });

  it('survives an empty stream', () => {
    expect(tripSummary([]).carId).toBeUndefined();
  });
});

describe('tripsForCar', () => {
  it('summarises each trip separately', () => {
    const trips = tripsForCar(twoTrips);
    expect(trips).toHaveLength(2);
    expect(trips[0].tracks).toEqual(['IT-9']);
    expect(trips[1].tracks).toEqual(['IT-10']);
  });

  it('reports the open ones', () => {
    const trips = tripsForCar([...oneTrip, ...build([{ code: 'ARR', at: '2024-03-20T22:00' }])]);
    expect(openTrips(trips)).toHaveLength(1);
  });
});

describe('tripsByCar', () => {
  const mixed = [
    ...twoTrips,
    ...['GATX 77'].flatMap((carId) => [
      trackEvent({ carId, code: 'ARR', at: '2024-03-05T22:00' }),
      trackEvent({ carId, code: 'DEP', at: '2024-03-09T06:00' }),
    ]),
  ];

  it('keeps the cars apart', () => {
    const byCar = tripsByCar(mixed);
    expect([...byCar.keys()].sort()).toEqual(['BNSF 400123', 'GATX 77']);
    expect(byCar.get('BNSF 400123')).toHaveLength(2);
    expect(byCar.get('GATX 77')).toHaveLength(1);
  });

  it('names the cars that came back', () => {
    expect(repeatVisitors(tripsByCar(mixed))).toEqual([{ carId: 'BNSF 400123', trips: 2 }]);
  });

  it('takes a threshold of its own', () => {
    expect(repeatVisitors(tripsByCar(mixed), { minimumTrips: 3 })).toEqual([]);
    expect(repeatVisitors(tripsByCar(mixed), { minimumTrips: 1 })).toHaveLength(2);
  });
});

describe('describeTrip', () => {
  it('names both ends', () => {
    expect(describeTrip(tripSummary(oneTrip), -360)).toBe(
      'BNSF 400123 2024-03-03T22:00-06:00 to 2024-03-09T06:00-06:00, 1 placement(s)'
    );
  });

  it('says so when the car is still here', () => {
    expect(describeTrip(tripSummary(oneTrip.slice(0, 3)), -360)).toContain('still here');
  });

  it('says so when nobody reported an arrival', () => {
    const summary = tripSummary(build([{ code: 'AP', at: '2024-03-04T08:00', trackId: 'IT-9' }]));
    expect(describeTrip(summary, -360)).toContain('unknown');
  });
});
