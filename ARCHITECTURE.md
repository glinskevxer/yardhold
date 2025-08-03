# How this is put together

Read this before changing anything in `src/tariff/`, `src/clock/` or
`src/exclusions/`. The rest is ordinary code.

## The shape

```
events  ->  detentions  ->  chargeable days  ->  assessment  ->  invoice
              ^                  ^                    ^
           placement          tariff page         agreement
           rules              and relief          and contract
```

Each arrow is a decision that the layer to its right is not allowed to make for
itself, and the whole design is about keeping those decisions where they belong.

## Rules that decide what other rules measure

This is the part worth understanding, because it is why the code is not simply
a sum over days.

- **`countBasis` on the tariff page** decides whether a day ends at midnight or
  24 hours after placement. Every day count downstream reads it.
- **`dayKind` on the free time entry** decides whether the days the carrier did
  not work count at all. The same Saturday is free under one commodity and
  invisible under another.
- **The placement kind** decides which relief can reach the car. A plant closure
  relieves a car held outside the gate and not one already spotted inside it.
- **`excludeDayKind` on the page** decides whether relief comes off in whole
  days or by the minute, and the two disagree about the same storm.
- **The ladder reset rule** decides what a day's index means, so a respotted car
  either walks up the ladder again or keeps climbing.
- **The average agreement's credit basis** decides what a credit is at all, and
  the two bases do not measure the same thing.
- **A claim's ground** decides which inputs a recomputation may move, so the
  same facts win on one ground and lose on another.

If a change makes one of those decisions in the wrong layer it will look like it
works, because the tests for that layer will pass. The composition tests in
`tests/clock/chargeableDays.test.js` and `tests/exclusions/eligibility.test.js`
are the ones that catch it.

## Layers, bottom up

| directory                                         | what lives there                                        |
| ------------------------------------------------- | ------------------------------------------------------- |
| `core/`                                           | money, quantities, ids, guards, the register helpers    |
| `time/`                                           | civil dates, instants, periods, calendars, day counting |
| `equipment/`, `site/`                             | cars, tracks, stations, parties, weights                |
| `events/`                                         | the reported stream, waybills, notices, trips           |
| `tariff/`                                         | pages, free time, ladders, supplements, contracts       |
| `clock/`, `exclusions/`                           | placement, detentions, relief, the count                |
| `assessment/`                                     | one car, one month, recomputation, scenarios            |
| `average/`, `bunching/`, `storage/`, `switching/` | the charges beside demurrage                            |
| `invoice/`, `disputes/`, `settlement/`            | the paper and what happens to it                        |
| `reporting/`, `cli/`, `config/`, `io/`, `audit/`  | the edges                                               |

Nothing in `core/` or `time/` imports anything above it. Everything else is
allowed to reach downward and nothing reaches sideways into a peer's internals.

## Conventions

- Money is integer cents. There is no float anywhere near a charge.
- Records are frozen once built and replaced rather than edited.
- A register takes either a raw record or one already built. Which it was given
  is decided by looking at a field the builder produces, never by `isFrozen`
  alone. `tests/builders.test.js` holds that line for every register.
- Errors carry a stable `code`. The CLI branches on the code, never the message.
- Nothing throws for a broken feed. Problems come back beside the data, because
  a month still has to be billed.
