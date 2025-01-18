import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The image cannot be built here, so these check the things that have actually
 * broken it: a base image that drifts off the version the CI matrix tests, a
 * COPY that drags the test tree in, and a root entrypoint.
 */

const root = resolve(process.cwd());
const dockerfile = readFileSync(resolve(root, 'Dockerfile'), 'utf8');
const dockerignore = readFileSync(resolve(root, '.dockerignore'), 'utf8');
const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));

const lines = dockerfile.split('\n').map((line) => line.trim());

describe('the Dockerfile', () => {
  it('builds in two stages', () => {
    const stages = lines.filter((line) => line.startsWith('FROM '));
    expect(stages).toHaveLength(2);
    expect(stages[0]).toContain('AS deps');
    expect(stages[1]).toContain('AS runtime');
  });

  it('pins the base image to an exact patch', () => {
    for (const stage of lines.filter((line) => line.startsWith('FROM '))) {
      expect(stage).toMatch(/node:\d+\.\d+\.\d+-/);
    }
  });

  it('uses the same major node the package requires', () => {
    const major = packageJson.engines.node.match(/(\d+)/)[1];
    for (const stage of lines.filter((line) => line.startsWith('FROM '))) {
      expect(stage).toContain(`node:${major}.`);
    }
  });

  it('installs from the lockfile without dev dependencies', () => {
    expect(dockerfile).toContain('npm ci --omit=dev');
  });

  it('copies the lockfile before the sources so the layer caches', () => {
    const lock = lines.findIndex((line) => line.includes('package-lock.json'));
    const sources = lines.findIndex((line) => line.startsWith('COPY src'));
    expect(lock).toBeGreaterThan(-1);
    expect(lock).toBeLessThan(sources);
  });

  it('does not copy the test tree into the image', () => {
    expect(lines.some((line) => line.startsWith('COPY tests'))).toBe(false);
    expect(dockerignore).toContain('tests');
  });

  it('drops to the node user before the entrypoint', () => {
    const user = lines.findIndex((line) => line === 'USER node');
    const entrypoint = lines.findIndex((line) => line.startsWith('ENTRYPOINT'));
    expect(user).toBeGreaterThan(-1);
    expect(entrypoint).toBeGreaterThan(user);
  });

  it('chowns the tree before dropping privileges', () => {
    const chown = lines.findIndex((line) => line.startsWith('RUN chown'));
    const user = lines.findIndex((line) => line === 'USER node');
    expect(chown).toBeGreaterThan(-1);
    expect(chown).toBeLessThan(user);
  });

  it('runs the binary the package declares', () => {
    const declared = packageJson.bin.spurtally.replace('./', '');
    expect(dockerfile).toContain(`/app/${declared}`);
  });

  it('opens no port', () => {
    expect(dockerfile).not.toContain('EXPOSE');
  });
});

describe('.dockerignore', () => {
  it('keeps node_modules and coverage out of the context', () => {
    expect(dockerignore).toContain('node_modules');
    expect(dockerignore).toContain('coverage');
  });

  it('keeps the git directory out', () => {
    expect(dockerignore).toContain('.git');
  });
});
