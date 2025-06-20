import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The workflow cannot be run here, so these check the things that have broken
 * it: a job that installs dev dependencies it does not need, a node version
 * that drifts off the one the Dockerfile pins, and a smoke step that silently
 * stopped covering a command.
 */

const root = resolve(process.cwd());
const workflow = readFileSync(resolve(root, '.github/workflows/ci.yml'), 'utf8');
const dockerfile = readFileSync(resolve(root, 'Dockerfile'), 'utf8');
const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));

const jobsBlock = workflow.slice(workflow.indexOf('\njobs:'));
const jobNames = [...jobsBlock.matchAll(/^ {2}([a-z][a-z0-9-]*):$/gm)].map((match) => match[1]);

describe('the workflow', () => {
  it('declares every job the README lists', () => {
    expect(jobNames.sort()).toEqual([
      'audit',
      'config',
      'coverage',
      'image',
      'lint',
      'package',
      'smoke',
      'test',
    ]);
  });

  it('runs on a push and a pull request against main', () => {
    expect(workflow).toContain('branches: [main]');
    expect(workflow).toContain('pull_request:');
  });

  it('cancels a superseded run', () => {
    expect(workflow).toContain('cancel-in-progress: true');
  });

  it('tests on two node versions', () => {
    const matrix = workflow.match(/node: \[(.*)\]/);
    expect(matrix).not.toBeNull();
    expect(matrix[1].split(',')).toHaveLength(2);
  });

  it('pins every node version to a patch', () => {
    for (const version of workflow.matchAll(/node-version: ([\d.]+)/g)) {
      expect(version[1]).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });

  it('runs the same node major the image pins', () => {
    const major = packageJson.engines.node.match(/(\d+)/)[1];
    for (const version of workflow.matchAll(/node-version: (\d+)\./g)) {
      expect(version[1]).toBe(major);
    }
    expect(dockerfile).toContain(`node:${major}.`);
  });

  it('audits only what ships', () => {
    expect(workflow).toContain('npm audit --omit=dev');
  });

  it('installs without dev dependencies where it does not need them', () => {
    expect(workflow).toContain('npm ci --omit=dev');
  });

  it('smokes every command the program registers', () => {
    for (const command of ['assess', 'invoice', 'report', 'reconcile', 'validate']) {
      expect(workflow).toContain(`bin/spurtally.js ${command}`);
    }
  });

  it('checks that a written file is not empty', () => {
    expect(workflow).toContain('test -s out/march.csv');
  });

  it('builds and runs the image', () => {
    expect(workflow).toContain('docker/build-push-action');
    expect(workflow).toContain('docker run --rm spurtally:ci');
  });
});

describe('the scripts CI leans on', () => {
  it('are all declared', () => {
    for (const script of ['lint', 'format:check', 'test', 'coverage', 'smoke', 'validate']) {
      expect(packageJson.scripts[script]).toBeDefined();
    }
  });

  it('point at the worked example rather than a machine somewhere', () => {
    expect(packageJson.scripts.smoke).toContain('examples/');
    expect(packageJson.scripts.validate).toContain('examples/');
  });
});
