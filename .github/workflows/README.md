# CI

Every push and pull request against `main` runs the same seven jobs, which
expand to eight with the node matrix:

| job        | what it protects                                                    |
| ---------- | ------------------------------------------------------------------- |
| `lint`     | eslint and a prettier check, so formatting never lands in a review  |
| `test`     | the suite on node 20.18.2 and 22.13.1                               |
| `coverage` | the thresholds in `vitest.config.js`, uploaded as lcov              |
| `audit`    | runtime dependencies only, at moderate and above                    |
| `smoke`    | the three commands against the worked example, with dev deps absent |
| `package`  | that `npm pack` carries the binary and the sources                  |
| `image`    | that the container builds and can run an assessment                 |

The audit job deliberately passes `--omit=dev`. Development advisories are
tracked in `SECURITY.md` and do not block a release, because nothing in the
dev tree ships.
