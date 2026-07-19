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

  test('pins vsce packaging script to the 3.9.1 baseline or newer', () => {
    const packageJson = readRepoJson<PackageJson>('package.json');
    const vsceScript = packageJson.scripts?.['vsce:package'];
    const versionMatch = vsceScript?.match(/@vscode\/vsce@([0-9]+(?:\.[0-9]+){1,2})/);

    assert.ok(vsceScript, 'vsce:package script must exist');
    assert.ok(versionMatch?.[1], `vsce:package must pin an explicit @vscode/vsce version (found: ${vsceScript ?? 'missing'})`);
    assert.ok(
      compareVersions(versionMatch?.[1], '3.9.1') >= 0,
      `vsce:package must use @vscode/vsce 3.9.1 or newer (found: ${versionMatch?.[1] ?? 'missing'})`
    );
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

  test('pins the consolidated Dependabot package.json baselines', () => {
    const packageJson = readRepoJson<PackageJson>('package.json');

    const expectedBaselines = [
      {
        label: 'marked',
        actual: packageJson.dependencies?.marked,
        expected: '^18.0.6',
        message: 'must stay aligned with the consolidated Dependabot update'
      },
      {
        label: 'sanitize-html',
        actual: packageJson.dependencies?.['sanitize-html'],
        expected: '^2.17.6',
        message: 'must stay aligned with the consolidated Dependabot update'
      },
      {
        label: 'mocha',
        actual: packageJson.devDependencies?.mocha,
        expected: '11.7.6',
        message: 'must stay aligned with the consolidated Dependabot update'
      },
      {
        label: '@types/node',
        actual: packageJson.devDependencies?.['@types/node'],
        expected: '^26.1.1',
        message: 'must stay aligned with the consolidated Dependabot update'
      },
      {
        label: 'concurrently',
        actual: packageJson.devDependencies?.concurrently,
        expected: '^10.0.3',
        message: 'must stay aligned with the consolidated Dependabot update'
      },
      {
        label: '@typescript-eslint/eslint-plugin',
        actual: packageJson.devDependencies?.['@typescript-eslint/eslint-plugin'],
        expected: '^8.64.0',
        message: 'must stay aligned with the consolidated Dependabot update'
      },
      {
        label: '@typescript-eslint/parser',
        actual: packageJson.devDependencies?.['@typescript-eslint/parser'],
        expected: '8.64.0',
        message: 'must stay aligned with the consolidated Dependabot update'
      },
      {
        label: 'esbuild',
        actual: packageJson.devDependencies?.esbuild,
        expected: '^0.28.1',
        message: 'must stay aligned with the audited security baseline'
      },
      {
        label: 'eslint',
        actual: packageJson.devDependencies?.eslint,
        expected: '^10.7.0',
        message: 'must stay aligned with the consolidated Dependabot update'
      },
      {
        label: 'webpack',
        actual: packageJson.devDependencies?.webpack,
        expected: '^5.108.4',
        message: 'must stay aligned with the consolidated Dependabot update'
      },
      {
        label: 'webpack-cli',
        actual: packageJson.devDependencies?.['webpack-cli'],
        expected: '^7.2.1',
        message: 'must stay aligned with the consolidated Dependabot update'
      },
      {
        label: 'ts-loader',
        actual: packageJson.devDependencies?.['ts-loader'],
        expected: '^9.6.2',
        message: 'must stay aligned with the consolidated Dependabot update'
      },
      {
        label: 'brace-expansion override',
        actual: packageJson.overrides?.['brace-expansion'],
        expected: '5.0.6',
        message: 'must stay on the audited non-vulnerable release'
      },
      {
        label: 'shell-quote override',
        actual: packageJson.overrides?.['shell-quote'],
        expected: '1.8.4',
        message: 'must stay on the audited non-vulnerable release'
      },
      {
        label: 'js-yaml override',
        actual: packageJson.overrides?.['js-yaml'],
        expected: '4.2.0',
        message: 'must stay on the audited non-vulnerable release'
      }
    ];

    for (const { label, actual, expected, message } of expectedBaselines) {
      assert.equal(actual, expected, `${label} ${message} (found: ${actual ?? 'missing'})`);
    }
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

  test('keeps @types/vscode aligned with engines.vscode', () => {
    const packageJson = readRepoJson<PackageJson>('package.json');
    const vscodeTypesVersion = packageJson.devDependencies?.['@types/vscode'];
    const vscodeEngineVersion = packageJson.engines?.vscode;

    assert.ok(vscodeTypesVersion, '@types/vscode must be declared in devDependencies');
    assert.ok(vscodeEngineVersion, 'engines.vscode must be declared');
    assert.ok(
      compareVersions(vscodeEngineVersion, vscodeTypesVersion ?? '') >= 0,
      `@types/vscode (${vscodeTypesVersion ?? 'missing'}) must not exceed engines.vscode (${vscodeEngineVersion ?? 'missing'})`
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

    assert.ok(
      compareVersions(packageJson.overrides?.['shell-quote'], '1.8.4') >= 0,
      `shell-quote override must stay on a non-vulnerable release (found: ${packageJson.overrides?.['shell-quote'] ?? 'missing'})`
    );

    assert.ok(
      compareVersions(packageJson.overrides?.['js-yaml'], '4.2.0') >= 0,
      `js-yaml override must stay on a non-vulnerable release (found: ${packageJson.overrides?.['js-yaml'] ?? 'missing'})`
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
      compareVersions(packageJson.dependencies?.['sanitize-html'], '2.17.5') >= 0,
      `sanitize-html must stay on a non-vulnerable baseline or newer (found: ${packageJson.dependencies?.['sanitize-html'] ?? 'missing'})`
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
    assert.ok(
      compareVersions(packageLockJson.packages?.['node_modules/sanitize-html']?.version, '2.17.5') >= 0,
      `installed sanitize-html must stay on a non-vulnerable baseline or newer (found: ${packageLockJson.packages?.['node_modules/sanitize-html']?.version ?? 'missing'})`
    );
  });

  test('locks the consolidated Dependabot package versions in package-lock.json', () => {
    const packageLockJson = readRepoJson<PackageLockJson>('package-lock.json');

    const expectedLockfileVersions = [
      {
        label: 'installed marked',
        actual: packageLockJson.packages?.['node_modules/marked']?.version,
        expected: '18.0.6',
        message: 'must stay aligned with the consolidated Dependabot update'
      },
      {
        label: 'installed sanitize-html',
        actual: packageLockJson.packages?.['node_modules/sanitize-html']?.version,
        expected: '2.17.6',
        message: 'must stay aligned with the consolidated Dependabot update'
      },
      {
        label: 'installed mocha',
        actual: packageLockJson.packages?.['node_modules/mocha']?.version,
        expected: '11.7.6',
        message: 'must stay aligned with the consolidated Dependabot update'
      },
      {
        label: 'installed @types/node',
        actual: packageLockJson.packages?.['node_modules/@types/node']?.version,
        expected: '26.1.1',
        message: 'must stay aligned with the consolidated Dependabot update'
      },
      {
        label: 'installed concurrently',
        actual: packageLockJson.packages?.['node_modules/concurrently']?.version,
        expected: '10.0.3',
        message: 'must stay aligned with the consolidated Dependabot update'
      },
      {
        label: 'installed @typescript-eslint/eslint-plugin',
        actual: packageLockJson.packages?.['node_modules/@typescript-eslint/eslint-plugin']?.version,
        expected: '8.64.0',
        message: 'must stay aligned with the consolidated Dependabot update'
      },
      {
        label: 'installed @typescript-eslint/parser',
        actual: packageLockJson.packages?.['node_modules/@typescript-eslint/parser']?.version,
        expected: '8.64.0',
        message: 'must stay aligned with the consolidated Dependabot update'
      },
      {
        label: 'installed esbuild',
        actual: packageLockJson.packages?.['node_modules/esbuild']?.version,
        expected: '0.28.1',
        message: 'must stay aligned with the audited security baseline'
      },
      {
        label: 'installed eslint',
        actual: packageLockJson.packages?.['node_modules/eslint']?.version,
        expected: '10.7.0',
        message: 'must stay aligned with the consolidated Dependabot update'
      },
      {
        label: 'installed webpack',
        actual: packageLockJson.packages?.['node_modules/webpack']?.version,
        expected: '5.108.4',
        message: 'must stay aligned with the consolidated Dependabot update'
      },
      {
        label: 'installed webpack-cli',
        actual: packageLockJson.packages?.['node_modules/webpack-cli']?.version,
        expected: '7.2.1',
        message: 'must stay aligned with the consolidated Dependabot update'
      },
      {
        label: 'installed ts-loader',
        actual: packageLockJson.packages?.['node_modules/ts-loader']?.version,
        expected: '9.6.2',
        message: 'must stay aligned with the consolidated Dependabot update'
      },
      {
        label: 'installed brace-expansion',
        actual: packageLockJson.packages?.['node_modules/brace-expansion']?.version,
        expected: '5.0.6',
        message: 'must stay on the audited non-vulnerable release'
      },
      {
        label: 'installed shell-quote',
        actual: packageLockJson.packages?.['node_modules/shell-quote']?.version,
        expected: '1.8.4',
        message: 'must stay on the audited non-vulnerable release'
      },
      {
        label: 'installed js-yaml',
        actual: packageLockJson.packages?.['node_modules/js-yaml']?.version,
        expected: '4.2.0',
        message: 'must stay on the audited non-vulnerable release'
      }
    ];

    for (const { label, actual, expected, message } of expectedLockfileVersions) {
      assert.equal(actual, expected, `${label} ${message} (found: ${actual ?? 'missing'})`);
    }
    assert.equal(
      packageLockJson.packages?.['node_modules/brace-expansion']?.deprecated,
      undefined,
      `installed brace-expansion must not be deprecated (found: ${packageLockJson.packages?.['node_modules/brace-expansion']?.deprecated ?? 'not deprecated'})`
    );
    assert.equal(
      packageLockJson.packages?.['node_modules/shell-quote']?.deprecated,
      undefined,
      `installed shell-quote must not be deprecated (found: ${packageLockJson.packages?.['node_modules/shell-quote']?.deprecated ?? 'not deprecated'})`
    );
    assert.equal(
      packageLockJson.packages?.['node_modules/js-yaml']?.deprecated,
      undefined,
      `installed js-yaml must not be deprecated (found: ${packageLockJson.packages?.['node_modules/js-yaml']?.deprecated ?? 'not deprecated'})`
    );
  });

  test('does not install known deprecated transitive packages', () => {
    const packageLockJson = readRepoJson<PackageLockJson>('package-lock.json');
    const packageEntries = packageLockJson.packages ?? {};

    const blockedPackages = ['node_modules/whatwg-encoding', 'node_modules/prebuild-install'];
    for (const packageName of blockedPackages) {
      assert.equal(
        packageEntries[packageName],
        undefined,
        `${packageName} must not be present in package-lock.json`
      );
    }

    const legacyGlobPackage = packageEntries['node_modules/glob'];
    if (legacyGlobPackage) {
      assert.ok(
        compareVersions(legacyGlobPackage.version, '12.0.0') >= 0,
        `installed glob must be 12.0.0+ (found: ${legacyGlobPackage.version ?? 'missing'})`
      );
      assert.equal(
        legacyGlobPackage.deprecated,
        undefined,
        `installed glob must not be deprecated (found: ${legacyGlobPackage.deprecated ?? 'not deprecated'})`
      );
    }
  });
});
