import { strict as assert } from 'assert';
import * as path from 'path';

// The resolver is a dependency-free CommonJS module that also powers the
// release workflow, so it is loaded here via require to exercise the exact same
// code path that CI runs.
/* eslint-disable @typescript-eslint/no-require-imports */
const tagVersion = require(path.resolve(__dirname, '../../../../scripts/tag-version.cjs')) as {
  normalizeTag(rawTag: string): string;
  isValidVersion(version: string): boolean;
  stripRefsPrefix(value: string): string;
  resolveTagFromEnv(env: NodeJS.ProcessEnv): string | null;
  resolveLatestReachableTag(exec: (file: string, args: string[]) => string): string | null;
  resolveVersion(options?: {
    env?: NodeJS.ProcessEnv;
    requireEnv?: boolean;
    exec?: (file: string, args: string[]) => string;
  }): string;
  applyVersion(version: string, run?: (file: string, args: string[]) => void): void;
  parseArgs(argv: string[]): { apply: boolean; requireEnv: boolean; writeGithubOutput: boolean };
};

suite('Tag version resolver', () => {
  test('normalizes a plain v-prefixed tag', () => {
    assert.equal(tagVersion.normalizeTag('v1.2.3'), '1.2.3');
  });

  test('normalizes a refs/tags/ prefixed tag', () => {
    assert.equal(tagVersion.normalizeTag('refs/tags/v1.2.3'), '1.2.3');
  });

  test('normalizes a pre-release tag', () => {
    assert.equal(tagVersion.normalizeTag('v1.2.3-beta.1'), '1.2.3-beta.1');
  });

  test('trims surrounding whitespace before normalizing', () => {
    assert.equal(tagVersion.normalizeTag('  v1.2.3  '), '1.2.3');
  });

  test('rejects an uppercase V prefix', () => {
    assert.throws(() => tagVersion.normalizeTag('V1.2.3'), /lowercase "v"/);
  });

  test('rejects a tag without a v prefix', () => {
    assert.throws(() => tagVersion.normalizeTag('1.2.3'), /lowercase "v" prefix/);
  });

  test('rejects a non-version tag', () => {
    assert.throws(() => tagVersion.normalizeTag('vlatest'), /not a valid SemVer/);
  });

  test('rejects an empty tag', () => {
    assert.throws(() => tagVersion.normalizeTag(''), /No tag value/);
  });

  test('validates SemVer versions', () => {
    assert.equal(tagVersion.isValidVersion('1.2.3'), true);
    assert.equal(tagVersion.isValidVersion('1.2.3-beta.1'), true);
    assert.equal(tagVersion.isValidVersion('1.2'), false);
    assert.equal(tagVersion.isValidVersion('v1.2.3'), false);
  });

  test('reads the tag from GITHUB_REF_NAME first', () => {
    const tag = tagVersion.resolveTagFromEnv({ GITHUB_REF_NAME: 'v1.2.3' } as NodeJS.ProcessEnv);
    assert.equal(tag, 'v1.2.3');
  });

  test('falls back to GITHUB_REF when it points at a tag', () => {
    const tag = tagVersion.resolveTagFromEnv({
      GITHUB_REF: 'refs/tags/v1.2.3'
    } as NodeJS.ProcessEnv);
    assert.equal(tag, 'v1.2.3');
  });

  test('ignores GITHUB_REF when it points at a branch', () => {
    const tag = tagVersion.resolveTagFromEnv({
      GITHUB_REF: 'refs/heads/main'
    } as NodeJS.ProcessEnv);
    assert.equal(tag, null);
  });

  test('returns null when no tag ref is present', () => {
    assert.equal(tagVersion.resolveTagFromEnv({} as NodeJS.ProcessEnv), null);
  });

  test('resolves the version from the environment tag', () => {
    const version = tagVersion.resolveVersion({
      env: { GITHUB_REF_NAME: 'v2.0.0' } as NodeJS.ProcessEnv,
      exec: () => {
        throw new Error('git should not be called when an env tag is present');
      }
    });
    assert.equal(version, '2.0.0');
  });

  test('requireEnv fails when no environment tag is present', () => {
    assert.throws(
      () =>
        tagVersion.resolveVersion({
          env: {} as NodeJS.ProcessEnv,
          requireEnv: true,
          exec: () => {
            throw new Error('git should not be called in requireEnv mode');
          }
        }),
      /must run on a tag push/
    );
  });

  test('falls back to the latest reachable version tag', () => {
    const version = tagVersion.resolveVersion({
      env: {} as NodeJS.ProcessEnv,
      exec: (file, args) => {
        assert.equal(file, 'git');
        assert.deepEqual(args, ['tag', '--list', 'v*', '--sort=-v:refname', '--merged', 'HEAD']);
        return 'v0.9.0\nv0.8.0\n';
      }
    });
    assert.equal(version, '0.9.0');
  });

  test('fails when no reachable version tag exists', () => {
    assert.throws(
      () =>
        tagVersion.resolveVersion({
          env: {} as NodeJS.ProcessEnv,
          exec: () => ''
        }),
      /No reachable version tag/
    );
  });

  test('only considers v-prefixed tags during fallback discovery', () => {
    const latest = tagVersion.resolveLatestReachableTag(() => 'v1.4.0\n');
    assert.equal(latest, 'v1.4.0');
  });

  test('skips non-version v-prefixed tags during fallback discovery', () => {
    const version = tagVersion.resolveVersion({
      env: {} as NodeJS.ProcessEnv,
      exec: () => 'vlatest\nv1.2.3\n'
    });
    assert.equal(version, '1.2.3');
  });

  test('applies the version with the safe npm flags and both files in scope', () => {
    const calls: Array<{ file: string; args: string[] }> = [];
    tagVersion.applyVersion('3.1.4', (file, args) => {
      calls.push({ file, args });
    });

    assert.equal(calls.length, 1);
    assert.match(calls[0].file, /^npm(\.cmd)?$/);
    assert.deepEqual(calls[0].args, [
      'version',
      '--no-git-tag-version',
      '--allow-same-version',
      '--ignore-scripts',
      '3.1.4'
    ]);
  });

  test('refuses to apply an invalid version', () => {
    assert.throws(() => tagVersion.applyVersion('not-a-version', () => undefined), /invalid version/);
  });

  test('parses CLI flags', () => {
    assert.deepEqual(tagVersion.parseArgs(['--apply', '--require-env', '--write-github-output']), {
      apply: true,
      requireEnv: true,
      writeGithubOutput: true
    });
    assert.deepEqual(tagVersion.parseArgs([]), {
      apply: false,
      requireEnv: false,
      writeGithubOutput: false
    });
  });
});
