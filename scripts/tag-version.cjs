'use strict';

// Resolve the extension version from a git tag and (optionally) apply it to
// package.json. The git tag is the source of truth for release builds.
//
// Accepted tag format: a lowercase `v` prefix followed by a strict SemVer
// version (e.g. `v1.2.3`, `v1.2.3-beta.1`). The `v` is stripped to produce the
// package.json version. Uppercase `V`, a missing prefix, or non-SemVer values
// are rejected.
//
// This file is intentionally a dependency-free CommonJS module so it can run
// before the build (no TypeScript/ts-node bootstrapping) and be unit-tested by
// the existing Mocha suite via `require`.

const { execFileSync } = require('child_process');

// Official SemVer 2.0.0 pattern (without the leading `v`).
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

const REFS_TAGS_PREFIX = 'refs/tags/';

/**
 * Remove a leading `refs/tags/` ref prefix if present.
 * @param {string} value
 * @returns {string}
 */
function stripRefsPrefix(value) {
  if (value.startsWith(REFS_TAGS_PREFIX)) {
    return value.slice(REFS_TAGS_PREFIX.length);
  }
  return value;
}

/**
 * @param {string} version
 * @returns {boolean}
 */
function isValidVersion(version) {
  return typeof version === 'string' && SEMVER.test(version);
}

/**
 * Normalize a raw tag value (optionally `refs/tags/`-prefixed) into a strict
 * SemVer version string. Throws on any value that is not a lowercase
 * `v`-prefixed SemVer tag.
 * @param {string} rawTag
 * @returns {string}
 */
function normalizeTag(rawTag) {
  if (typeof rawTag !== 'string' || rawTag.trim() === '') {
    throw new Error('No tag value was provided to normalize.');
  }

  const tag = stripRefsPrefix(rawTag.trim());

  if (tag.startsWith('V')) {
    throw new Error(
      `Invalid tag "${tag}": the version prefix must be a lowercase "v" (uppercase "V" is not allowed).`
    );
  }

  if (!tag.startsWith('v')) {
    throw new Error(
      `Invalid tag "${tag}": tags must start with a lowercase "v" prefix (e.g. "v1.2.3").`
    );
  }

  const version = tag.slice(1);

  if (!isValidVersion(version)) {
    throw new Error(
      `Invalid tag "${tag}": "${version}" is not a valid SemVer version (expected e.g. "v1.2.3" or "v1.2.3-beta.1").`
    );
  }

  return version;
}

/**
 * Pick the tag reference from the environment, preferring `GITHUB_REF_NAME`
 * (the tag name on a tag push) and falling back to `GITHUB_REF`.
 * @param {NodeJS.ProcessEnv} env
 * @returns {string | null}
 */
function resolveTagFromEnv(env) {
  const refName = env.GITHUB_REF_NAME;
  if (typeof refName === 'string' && refName.trim() !== '') {
    return refName.trim();
  }

  const ref = env.GITHUB_REF;
  if (typeof ref === 'string' && ref.startsWith(REFS_TAGS_PREFIX)) {
    return stripRefsPrefix(ref).trim();
  }

  return null;
}

/**
 * Discover the latest version tag reachable from HEAD. Only `v*` tags are
 * considered, sorted by descending SemVer-aware version order, so unrelated
 * tags (e.g. `docs-update`) never shadow a real release tag.
 * @param {(file: string, args: string[]) => string} exec
 * @returns {string | null}
 */
function resolveLatestReachableTag(exec) {
  const output = exec('git', [
    'tag',
    '--list',
    'v*',
    '--sort=-v:refname',
    '--merged',
    'HEAD'
  ]);

  const firstTag = output
    .split('\n')
    .map(line => line.trim())
    .find(line => line !== '');

  return firstTag ?? null;
}

/**
 * @param {string} file
 * @param {string[]} args
 * @returns {string}
 */
function defaultExec(file, args) {
  return execFileSync(file, args, { encoding: 'utf8' });
}

/**
 * Resolve the normalized version from a tag.
 *
 * @param {object} [options]
 * @param {NodeJS.ProcessEnv} [options.env] Environment to read tag refs from.
 * @param {boolean} [options.requireEnv] When true, only the environment tag is
 *   used (no local git fallback). Intended for release CI.
 * @param {(file: string, args: string[]) => string} [options.exec] git runner.
 * @returns {string} The normalized SemVer version (no `v` prefix).
 */
function resolveVersion(options) {
  const opts = options ?? {};
  const env = opts.env ?? process.env;
  const requireEnv = opts.requireEnv ?? false;
  const exec = opts.exec ?? defaultExec;

  const envTag = resolveTagFromEnv(env);
  if (envTag !== null) {
    return normalizeTag(envTag);
  }

  if (requireEnv) {
    throw new Error(
      'No tag ref found in the environment (GITHUB_REF_NAME / GITHUB_REF). ' +
        'This command must run on a tag push.'
    );
  }

  const latestTag = resolveLatestReachableTag(exec);
  if (latestTag === null) {
    throw new Error(
      'No reachable version tag (v*) was found from HEAD. ' +
        'Create a tag like "v1.2.3" before building from a tag.'
    );
  }

  return normalizeTag(latestTag);
}

/**
 * Apply the resolved version to package.json (and package-lock.json) using npm,
 * without creating a git tag/commit and without running lifecycle scripts.
 * @param {string} version
 * @param {(file: string, args: string[]) => void} [run]
 */
function applyVersion(version, run) {
  if (!isValidVersion(version)) {
    throw new Error(`Refusing to apply invalid version "${version}".`);
  }

  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const exec =
    run ??
    ((file, args) => {
      execFileSync(file, args, { stdio: 'inherit' });
    });

  exec(npm, [
    'version',
    '--no-git-tag-version',
    '--allow-same-version',
    '--ignore-scripts',
    version
  ]);
}

function parseArgs(argv) {
  return {
    apply: argv.includes('--apply'),
    requireEnv: argv.includes('--require-env'),
    writeGithubOutput: argv.includes('--write-github-output')
  };
}

function main(argv) {
  const args = parseArgs(argv);

  let version;
  try {
    version = resolveVersion({ requireEnv: args.requireEnv });
  } catch (error) {
    process.stderr.write(
      `tag-version: ${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exit(1);
    return;
  }

  if (args.apply) {
    applyVersion(version);
  }

  if (args.writeGithubOutput && process.env.GITHUB_OUTPUT) {
    require('fs').appendFileSync(
      process.env.GITHUB_OUTPUT,
      `version=${version}\n`
    );
  }

  process.stdout.write(`${version}\n`);
}

module.exports = {
  SEMVER,
  stripRefsPrefix,
  isValidVersion,
  normalizeTag,
  resolveTagFromEnv,
  resolveLatestReachableTag,
  resolveVersion,
  applyVersion,
  parseArgs
};

if (require.main === module) {
  main(process.argv.slice(2));
}
