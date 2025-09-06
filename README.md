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
- how many cars turned up together decides whether a late car was bunched or
  merely late, and only the first of those earns relief
- a claim's ground decides which inputs may be recomputed, so the same facts
  win on one ground and lose on another

## Using it

```
spurtally assess  -c world.json -e march.csv -p 202403 -r BNSF
spurtally invoice -c world.json -e march.csv -p 202403 -r BNSF -i 2024-04-05
spurtally explain -c world.json -e march.csv -p 202403 -r BNSF -k "BNSF 400123"
spurtally report  -c world.json -e march.csv -p 202403 -r BNSF -t kpi
spurtally reconcile -c world.json -e march.csv -p 202403 -r BNSF -b carrier.csv
spurtally fleet     -c world.json -a 2024-03-31 --flagged
spurtally hire      -c world.json -e march.csv -p 202403 -r BNSF
spurtally validate  -c world.json --strict
```

Every command takes `-o table|csv|json` and `--out <path>` to write to a file
instead of the terminal. The file extension has to agree with the format.

`report` runs one of `exceptions`, `kpi`, `dwell`, `register`, `trips` or
`capacity`. The register is
a grid of car against day, one character per cell, showing where each day sat on
the rate ladder. `trips` reads the event feed rather than the assessment, so it
shows cars that arrived, were never placed and left again, which have no
assessment at all. `capacity` counts what stood on each industry track each day,
which is the consignee's best answer to a constructive placement charge: a plant
whose track was full every day did not fail to take its cars.

`reconcile` puts our count beside the carrier's own invoice and names every
disagreement, which is the thing this was written for.

`hire` is the car-hire side: what the carrier paid to hold foreign cars, and how
much of that the consignee caused and can be charged for. The hours come off the
trip rather than the detention, because hire runs from the moment the carrier
takes the car and the days it sat in the yard before anyone placed it are
exactly the days the consignee is not liable for.

`fleet` and `validate` take no event feed. They read the standing state of the
equipment and the configuration, which is a different question from what
happened in a month.

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
