# spurtally

Demurrage, storage and car hire accounting for a private industry track.

The engine takes a stream of car events from the serving carrier, applies the
tariff page that was in force on the day each car was placed, and produces the
chargeable day count, the assessment and the invoice.

## Why it is not a spreadsheet

Most of the work is not arithmetic. It is deciding what the arithmetic is
allowed to count:

- the tariff decides whether a day ends at midnight or 24 hours after placement
- the free time entry decides whether the days the carrier did not work are
  free, chargeable or invisible
- whether the car was spotted inside the gate or held outside it decides which
  relief reaches it, so the same closure credits one car and not another
- an average agreement decides whether a quick turnaround is worth a credit at
  all, and on which of two bases
- a claim's ground decides which inputs may be recomputed, so the same facts
  win on one ground and lose on another

## Using it

```
spurtally assess  -c world.json -e march.csv -p 202403 -r BNSF
spurtally invoice -c world.json -e march.csv -p 202403 -r BNSF -i 2024-04-05
spurtally explain -c world.json -e march.csv -p 202403 -r BNSF -k "BNSF 400123"
spurtally report  -c world.json -e march.csv -p 202403 -r BNSF -t kpi
spurtally reconcile -c world.json -e march.csv -p 202403 -r BNSF -b carrier.csv
spurtally validate  -c world.json --strict
```

Every command takes `-o table|csv|json` and `--out <path>` to write to a file
instead of the terminal. The file extension has to agree with the format.

`report` runs one of `exceptions`, `kpi`, `dwell` or `register`. The register is
a grid of car against day, one character per cell, showing where each day sat on
the rate ladder.

`reconcile` puts our count beside the carrier's own invoice and names every
disagreement, which is the thing this was written for.

A worked configuration, a month of events and the carrier's invoice for the same
month are in `examples/`.

## Development

```
npm install
npm test
npm run coverage
npm run lint
npm run validate
npm run smoke
```

Tests live in `tests/` and mirror `src/`.
