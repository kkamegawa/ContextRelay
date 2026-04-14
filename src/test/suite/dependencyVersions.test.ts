import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as path from 'path';

interface PackageJson {
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
  overrides?: Record<string, string>;
}

interface PackageLockJson {
  packages?: Record<string, { version?: string }>;
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
      compareVersions(packageJson.overrides?.glob, '13.0.6') >= 0,
      `glob override must stay on a current non-vulnerable release (found: ${packageJson.overrides?.glob ?? 'missing'})`
    );
  });

  test('locks installed glob and diff versions outside known vulnerable ranges', () => {
    const packageLockJson = readRepoJson<PackageLockJson>('package-lock.json');

    const globVersion = packageLockJson.packages?.['node_modules/glob']?.version;
    const diffVersion = packageLockJson.packages?.['node_modules/diff']?.version;

    assert.ok(
      compareVersions(globVersion, '13.0.6') >= 0,
      `installed glob must stay on a current non-vulnerable release (found: ${globVersion ?? 'missing'})`
    );

    assert.ok(
      Boolean(diffVersion) &&
        (compareVersions(diffVersion, '6.0.0') < 0 || compareVersions(diffVersion, '8.0.3') >= 0),
      `installed diff must stay outside the vulnerable range 6.0.0-8.0.2 (found: ${diffVersion ?? 'missing'})`
    );
  });
});
