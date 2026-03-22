import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as path from 'path';

interface PackageJson {
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
  overrides?: Record<string, string>;
}

function getMajor(versionRange: string | undefined): number | undefined {
  if (!versionRange) {
    return undefined;
  }
  const match = versionRange.match(/\d+/);
  return match ? Number(match[0]) : undefined;
}

suite('Dependency security baselines', () => {
  test('enforces npm audit at moderate level during build paths', () => {
    const packageJsonPath = path.resolve(__dirname, '../../../../package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as PackageJson;

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
    const packageJsonPath = path.resolve(__dirname, '../../../../package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as PackageJson;

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
    const packageJsonPath = path.resolve(__dirname, '../../../../package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as PackageJson;

    assert.equal(
      packageJson.overrides?.flatted,
      '3.4.2',
      'flatted override must pin the first non-vulnerable release'
    );

    assert.equal(
      packageJson.overrides?.['serialize-javascript'],
      '7.0.4',
      'serialize-javascript override must pin a non-vulnerable release'
    );
  });
});
