import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as path from 'path';

interface PackageJson {
  devDependencies?: Record<string, string>;
}

function getMajor(versionRange: string | undefined): number | undefined {
  if (!versionRange) {
    return undefined;
  }
  const match = versionRange.match(/\d+/);
  return match ? Number(match[0]) : undefined;
}

suite('Dependency security baselines', () => {
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
});
