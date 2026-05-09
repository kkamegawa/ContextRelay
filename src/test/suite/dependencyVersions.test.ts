import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as path from 'path';

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  engines?: Record<string, string>;
  scripts?: Record<string, string>;
  overrides?: Record<string, string>;
}

interface PackageLockJson {
  packages?: Record<string, { deprecated?: string; version?: string }>;
}

function readRepoJson<T>(fileName: string): T {
  const filePath = path.resolve(__dirname, '../../../../', fileName);
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
}

function getMajor(versionRange: string | undefined): number | undefined {
  if (!versionRange) {
    return undefined;
  }
  const match = versionRange.match(/\d+/);
  return match ? Number(match[0]) : undefined;
}

function compareVersions(left: string | undefined, right: string): number {
  if (!left) {
    return -1;
  }

  const normalize = (value: string): number[] =>
    value
      .replace(/^[^\d]*/, '')
      .split(/[.-]/)
      .map(part => Number.parseInt(part, 10) || 0);

  const lhs = normalize(left);
  const rhs = normalize(right);
  const length = Math.max(lhs.length, rhs.length);
  for (let i = 0; i < length; i += 1) {
    const delta = (lhs[i] ?? 0) - (rhs[i] ?? 0);
    if (delta !== 0) {
      return delta;
    }
  }

  return 0;
}

suite('Dependency security baselines', () => {
  test('enforces npm audit at moderate level during build paths', () => {
    const packageJson = readRepoJson<PackageJson>('package.json');

    const securityCheck = packageJson.scripts?.['security:check'];
    const precompile = packageJson.scripts?.precompile;
    const prepackage = packageJson.scripts?.prepackage;
    const testSecurity = packageJson.scripts?.['test:security'];

    assert.equal(
      securityCheck,
      'npm audit --audit-level=moderate',
      'security:check must enforce zero moderate/high/critical vulnerabilities'
    );

    assert.equal(precompile, 'npm run security:check', 'precompile must run security:check');
    assert.equal(prepackage, 'npm run security:check', 'prepackage must run security:check');
    assert.equal(testSecurity, 'npm run security:check', 'test:security must reuse security:check');
  });

  test('uses non-vulnerable @typescript-eslint major versions', () => {
    const packageJson = readRepoJson<PackageJson>('package.json');

    const pluginVersion = packageJson.devDependencies?.['@typescript-eslint/eslint-plugin'];
    const parserVersion = packageJson.devDependencies?.['@typescript-eslint/parser'];

    assert.ok(pluginVersion, '@typescript-eslint/eslint-plugin must exist in devDependencies');
    assert.ok(parserVersion, '@typescript-eslint/parser must exist in devDependencies');

    assert.ok(
      (getMajor(pluginVersion) ?? 0) >= 8,
      `@typescript-eslint/eslint-plugin must be v8+ to avoid known high vulnerabilities (found: ${pluginVersion})`
    );

    assert.ok(
      (getMajor(parserVersion) ?? 0) >= 8,
      `@typescript-eslint/parser must be v8+ to avoid known high vulnerabilities (found: ${parserVersion})`
    );
  });

  test('declares Node 22+ for the supported glob baseline', () => {
    const packageJson = readRepoJson<PackageJson>('package.json');
    const nodeEngine = packageJson.engines?.node;

    assert.ok(nodeEngine, 'package.json must declare a node engine requirement');
    assert.ok(
      (getMajor(nodeEngine) ?? 0) >= 22,
      `package.json must require Node.js 22 or later when using the supported glob baseline (found: ${nodeEngine ?? 'missing'})`
    );
  });

  test('pins safe override versions for vulnerable transitive dependencies', () => {
    const packageJson = readRepoJson<PackageJson>('package.json');

    assert.ok(
      compareVersions(packageJson.overrides?.flatted, '3.4.2') >= 0,
      `flatted override must stay on a non-vulnerable release (found: ${packageJson.overrides?.flatted ?? 'missing'})`
    );

    assert.ok(
      compareVersions(packageJson.overrides?.['serialize-javascript'], '7.0.4') >= 0,
      `serialize-javascript override must stay on a non-vulnerable release (found: ${packageJson.overrides?.['serialize-javascript'] ?? 'missing'})`
    );

    assert.ok(
      compareVersions(packageJson.overrides?.glob, '12.0.0') >= 0,
      `glob override must stay on a supported, non-deprecated release (found: ${packageJson.overrides?.glob ?? 'missing'})`
    );

    assert.ok(
      compareVersions(packageJson.overrides?.diff, '8.0.3') >= 0,
      `diff override must stay outside the vulnerable range 6.0.0-8.0.2 (found: ${packageJson.overrides?.diff ?? 'missing'})`
    );
  });

  test('locks installed glob, diff, and fast-uri versions outside known vulnerable ranges', () => {
    const packageLockJson = readRepoJson<PackageLockJson>('package-lock.json');

    // The glob override applies to mocha's transitive dependency, so the installed
    // glob lives under node_modules/mocha/node_modules/glob (or root if hoisted).
    const globPackage =
      packageLockJson.packages?.['node_modules/mocha/node_modules/glob'] ??
      packageLockJson.packages?.['node_modules/glob'];
    const globVersion = globPackage?.version;
    const diffVersion = packageLockJson.packages?.['node_modules/diff']?.version;
    const fastUriPackage = packageLockJson.packages?.['node_modules/fast-uri'];
    const fastUriVersion = fastUriPackage?.version;

    assert.ok(
      compareVersions(globVersion, '12.0.0') >= 0,
      `installed glob must stay on a supported, non-deprecated release (found: ${globVersion ?? 'missing'})`
    );

    assert.equal(
      globPackage?.deprecated,
      undefined,
      `installed glob must not be deprecated (found: ${globPackage?.deprecated ?? 'not deprecated'})`
    );

    assert.ok(
      Boolean(diffVersion) &&
        (compareVersions(diffVersion, '6.0.0') < 0 || compareVersions(diffVersion, '8.0.3') >= 0),
      `installed diff must stay outside the vulnerable range 6.0.0-8.0.2 (found: ${diffVersion ?? 'missing'})`
    );

    assert.ok(
      compareVersions(fastUriVersion, '3.1.2') >= 0,
      `installed fast-uri must stay on a non-vulnerable release (found: ${fastUriVersion ?? 'missing'})`
    );

    assert.equal(
      fastUriPackage?.deprecated,
      undefined,
      `installed fast-uri must not be deprecated (found: ${fastUriPackage?.deprecated ?? 'not deprecated'})`
    );
  });

  test('pins preview rendering dependencies at vetted versions', () => {
    const packageJson = readRepoJson<PackageJson>('package.json');
    const packageLockJson = readRepoJson<PackageLockJson>('package-lock.json');

    assert.ok(
      compareVersions(packageJson.dependencies?.marked, '18.0.2') >= 0,
      `marked must stay on a vetted baseline or newer (found: ${packageJson.dependencies?.marked ?? 'missing'})`
    );
    assert.ok(
      compareVersions(packageJson.dependencies?.['sanitize-html'], '2.17.3') >= 0,
      `sanitize-html must stay on a vetted baseline or newer (found: ${packageJson.dependencies?.['sanitize-html'] ?? 'missing'})`
    );

    assert.equal(
      packageLockJson.packages?.['node_modules/marked']?.deprecated,
      undefined,
      `installed marked must not be deprecated (found: ${packageLockJson.packages?.['node_modules/marked']?.deprecated ?? 'not deprecated'})`
    );
    assert.equal(
      packageLockJson.packages?.['node_modules/sanitize-html']?.deprecated,
      undefined,
      `installed sanitize-html must not be deprecated (found: ${packageLockJson.packages?.['node_modules/sanitize-html']?.deprecated ?? 'not deprecated'})`
    );
  });
});
