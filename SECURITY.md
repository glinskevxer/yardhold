# Security

## Runtime dependencies

One: `commander`. The audit job in CI runs `npm audit --omit=dev` at moderate
and above, and it is expected to stay clean.

## Development dependencies

The dev tree carries advisories that come with the pinned toolchain. They are
accepted rather than fixed, because none of it ships: the container image
installs with `--omit=dev` and `.dockerignore` keeps the test tree out of the
build context entirely.

Review this decision when the toolchain is next moved forward.

## Reporting

This is a private repository. Raise anything you find as an issue.
