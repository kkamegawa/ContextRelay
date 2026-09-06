import { strict as assert } from 'assert';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  engines?: Record<string, string>;
  allowScripts?: Record<string, boolean>;
  scripts?: Record<string, string>;
  overrides?: Record<string, string>;
}

interface PackageLockJson {
  packages?: Record<string, { deprecated?: string; hasInstallScript?: boolean; version?: string }>;
}

function readRepoJson<T>(fileName: string): T {
  const filePath = path.resolve(__dirname, '../../../../', fileName);
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
}

function readToolVersion(command: 'tsc' | 'tsc6'): string {
  const repoRoot = path.resolve(__dirname, '../../../../');
  const toolScript = command === 'tsc'
    ? path.join(repoRoot, 'node_modules', '@typescript', 'native', 'bin', 'tsc')
    : path.join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc6');
  return execFileSync(process.execPath, [toolScript, '--version'], {
    cwd: repoRoot,
    encoding: 'utf8'
  }).trim().replace(/^Version\\s+/, '');
}

function readTypeScriptApiVersion(): string {
  const repoRoot = path.resolve(__dirname, '../../../../');
  return execFileSync(process.execPath, ['-p', 'require("typescript").version'], {
    cwd: repoRoot,
    encoding: 'utf8'
  }).trim();
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
      'node scripts/run-audit-safe.cjs',
      'security:check must run the safe audit wrapper to avoid inherited allow-scripts runtime flags'
    );

    assert.equal(precompile, 'npm run security:check', 'precompile must run security:check');
    assert.equal(prepackage, 'npm run security:check', 'prepackage must run security:check');
    assert.equal(testSecurity, 'npm run security:check', 'test:security must reuse security:check');
  });

  test('allowlists every dependency install script under a strict npm policy', () => {
    const packageJson = readRepoJson<PackageJson>('package.json');
    const packageLockJson = readRepoJson<PackageLockJson>('package-lock.json');
    const repoRoot = path.resolve(__dirname, '../../../../');
    const npmrcLines = fs
      .readFileSync(path.join(repoRoot, '.npmrc'), 'utf8')
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean);

    assert.ok(
      npmrcLines.includes('strict-allow-scripts=true'),
      '.npmrc must enable strict-allow-scripts for CI'
    );
    assert.ok(
      !npmrcLines.some(line => line.startsWith('allow-scripts=')),
      '.npmrc must not define a redundant allow-scripts value when package.json owns the policy'
    );

    const installScriptPackages = Object.entries(packageLockJson.packages ?? {})
      .filter(([packagePath, metadata]) => packagePath && metadata.hasInstallScript && metadata.version)
      .map(([packagePath, metadata]) => {
        const packageNameParts = packagePath.split('node_modules/').filter(Boolean);
        const packageName = packageNameParts[packageNameParts.length - 1];
        assert.ok(packageName, `install-script package path must contain a package name: ${packagePath}`);
        return `${packageName}@${metadata.version}`;
      });

    assert.ok(installScriptPackages.length > 0, 'lockfile must identify install-script packages');
    for (const packageIdentity of installScriptPackages) {
      assert.equal(
        packageJson.allowScripts?.[packageIdentity],
        true,
        `${packageIdentity} must be explicitly allowed in package.json#allowScripts`
      );
    }
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

  test('uses the TypeScript 7 CLI with the TypeScript 6 compatibility API', function () {
    // Spawning tsc, tsc6, and the TypeScript API probe can exceed the 10s suite default
    // when the whole suite runs in one process.
    this.timeout(60000);

    const packageJson = readRepoJson<PackageJson>('package.json');
    const nativeCompiler = packageJson.devDependencies?.['@typescript/native'];
    const compatibilityCompiler = packageJson.devDependencies?.typescript;
    const nativeVersion = readToolVersion('tsc');
    const compatibilityVersion = readToolVersion('tsc6');
    const apiVersion = readTypeScriptApiVersion();

    assert.equal(
      nativeCompiler,
      'npm:typescript@^7.0.2',
      `@typescript/native must provide the TypeScript 7 CLI (found: ${nativeCompiler ?? 'missing'})`
    );
    assert.equal(
      compatibilityCompiler,
      'npm:@typescript/typescript6@^6.0.2',
      `typescript must provide the TypeScript 6 compatibility API (found: ${compatibilityCompiler ?? 'missing'})`
    );
    assert.equal(getMajor(nativeVersion), 7, `tsc must run TypeScript 7 (found: ${nativeVersion})`);
    assert.ok(compareVersions(nativeVersion, '7.0.2') >= 0, `tsc must be TypeScript 7.0.2 or newer (found: ${nativeVersion})`);
    assert.equal(getMajor(compatibilityVersion), 6, `tsc6 must run TypeScript 6 (found: ${compatibilityVersion})`);
    assert.ok(
      compareVersions(compatibilityVersion, '6.0.2') >= 0,
      `tsc6 must be TypeScript 6.0.2 or newer (found: ${compatibilityVersion})`
    );
    assert.equal(getMajor(apiVersion), 6, `require("typescript") must resolve the TypeScript 6 API (found: ${apiVersion})`);
    assert.ok(
      compareVersions(apiVersion, '6.0.2') >= 0,
      `require("typescript") must resolve TypeScript 6.0.2 or newer (found: ${apiVersion})`
    );
  });

  test('pins the consolidated Dependabot package.json baselines', () => {
    const packageJson = readRepoJson<PackageJson>('package.json');

    const expectedBaselines = [
      {
        label: 'marked',
        actual: packageJson.dependencies?.marked,
        expected: '^18.0.11',
        message: 'must stay aligned with the consolidated Dependabot update'
      },
      {
        label: 'sanitize-html',
        actual: packageJson.dependencies?.['sanitize-html'],
        expected: '^2.17.7',
        message: 'must stay aligned with the consolidated Dependabot update'
      },
      {
        label: 'mocha',
        actual: packageJson.devDependencies?.mocha,
        expected: '11.8.0',
        message: 'must stay aligned with the consolidated Dependabot update'
      },
      {
        label: '@types/node',
        actual: packageJson.devDependencies?.['@types/node'],
        expected: '^26.4.1',
        message: 'must stay aligned with the consolidated Dependabot update'
      },
      {
        label: 'concurrently',
        actual: packageJson.devDependencies?.concurrently,
        expected: '^10.0.5',
        message: 'must stay aligned with the consolidated Dependabot update'
      },
      {
        label: '@typescript-eslint/eslint-plugin',
        actual: packageJson.devDependencies?.['@typescript-eslint/eslint-plugin'],
        expected: '^8.69.0',
        message: 'must stay aligned with the consolidated Dependabot update'
      },
      {
        label: '@typescript-eslint/parser',
        actual: packageJson.devDependencies?.['@typescript-eslint/parser'],
        expected: '8.69.0',
        message: 'must stay aligned with the consolidated Dependabot update'
      },
      {
        label: 'esbuild',
        actual: packageJson.devDependencies?.esbuild,
        expected: '^0.28.2',
        message: 'must stay aligned with the audited security baseline'
      },
      {
        label: 'eslint',
        actual: packageJson.devDependencies?.eslint,
        expected: '^10.10.0',
        message: 'must stay aligned with the consolidated Dependabot update'
      },
      {
        label: 'webpack',
        actual: packageJson.devDependencies?.webpack,
        expected: '^5.109.2',
        message: 'must stay aligned with the consolidated Dependabot update'
      },
      {
        label: 'webpack-cli',
        actual: packageJson.devDependencies?.['webpack-cli'],
        expected: '^7.2.3',
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
        expected: '5.0.9',
        message: 'must stay on the audited non-vulnerable release'
      },
      {
        label: 'shell-quote override',
        actual: packageJson.overrides?.['shell-quote'],
        expected: '1.10.0',
        message: 'must stay on the audited non-vulnerable release'
      },
      {
        label: 'js-yaml override',
        actual: packageJson.overrides?.['js-yaml'],
        expected: '4.3.1',
        message: 'must stay on the audited non-vulnerable release'
      },
      {
        label: 'postcss override',
        actual: packageJson.overrides?.postcss,
        expected: '8.5.26',
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
      compareVersions(packageJson.overrides?.['brace-expansion'], '5.0.9') >= 0,
      `brace-expansion override must stay on a non-vulnerable release (found: ${packageJson.overrides?.['brace-expansion'] ?? 'missing'})`
    );

    assert.ok(
      compareVersions(packageJson.overrides?.['shell-quote'], '1.10.0') >= 0,
      `shell-quote override must stay on a non-vulnerable release (found: ${packageJson.overrides?.['shell-quote'] ?? 'missing'})`
    );

    assert.ok(
      compareVersions(packageJson.overrides?.['js-yaml'], '4.3.1') >= 0,
      `js-yaml override must stay on a non-vulnerable release (found: ${packageJson.overrides?.['js-yaml'] ?? 'missing'})`
    );

    assert.ok(
      compareVersions(packageJson.overrides?.postcss, '8.5.25') >= 0,
      `postcss override must stay on a non-vulnerable release (found: ${packageJson.overrides?.postcss ?? 'missing'})`
    );
  });

  test('pins nanoid outside its high-severity vulnerable range', () => {
    const packageJson = readRepoJson<PackageJson>('package.json');
    const packageLockJson = readRepoJson<PackageLockJson>('package-lock.json');
    const nanoidOverride = packageJson.overrides?.nanoid;
    const nanoidVersion = packageLockJson.packages?.['node_modules/nanoid']?.version;

    assert.ok(
      compareVersions(nanoidOverride, '3.3.18') >= 0,
      `nanoid override must stay on 3.3.18 or newer (found: ${nanoidOverride ?? 'missing'})`
    );
    assert.ok(
      compareVersions(nanoidVersion, '3.3.18') >= 0,
      `installed nanoid must stay on 3.3.18 or newer (found: ${nanoidVersion ?? 'missing'})`
    );
  });

  test('locks installed glob, diff, fast-uri, and browserslist versions outside known vulnerable ranges', () => {
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
    const browserslistVersion = packageLockJson.packages?.['node_modules/browserslist']?.version;

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
      compareVersions(fastUriVersion, '3.1.7') >= 0,
      `installed fast-uri must stay on a non-vulnerable release (found: ${fastUriVersion ?? 'missing'})`
    );

    assert.equal(
      fastUriPackage?.deprecated,
      undefined,
      `installed fast-uri must not be deprecated (found: ${fastUriPackage?.deprecated ?? 'not deprecated'})`
    );

    // GHSA-c83g-rgw3-j3cx (unbounded memory growth) affects browserslist up to 4.28.6.
    assert.ok(
      compareVersions(browserslistVersion, '4.28.7') >= 0,
      `installed browserslist must stay on a non-vulnerable release (found: ${browserslistVersion ?? 'missing'})`
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
        expected: '18.0.11',
        message: 'must stay aligned with the consolidated Dependabot update'
      },
      {
        label: 'installed sanitize-html',
        actual: packageLockJson.packages?.['node_modules/sanitize-html']?.version,
        expected: '2.17.7',
        message: 'must stay aligned with the consolidated Dependabot update'
      },
      {
        label: 'installed mocha',
        actual: packageLockJson.packages?.['node_modules/mocha']?.version,
        expected: '11.8.0',
        message: 'must stay aligned with the consolidated Dependabot update'
      },
      {
        label: 'installed @types/node',
        actual: packageLockJson.packages?.['node_modules/@types/node']?.version,
        expected: '26.4.1',
        message: 'must stay aligned with the consolidated Dependabot update'
      },
      {
        label: 'installed concurrently',
        actual: packageLockJson.packages?.['node_modules/concurrently']?.version,
        expected: '10.0.5',
        message: 'must stay aligned with the consolidated Dependabot update'
      },
      {
        label: 'installed @typescript-eslint/eslint-plugin',
        actual: packageLockJson.packages?.['node_modules/@typescript-eslint/eslint-plugin']?.version,
        expected: '8.69.0',
        message: 'must stay aligned with the consolidated Dependabot update'
      },
      {
        label: 'installed @typescript-eslint/parser',
        actual: packageLockJson.packages?.['node_modules/@typescript-eslint/parser']?.version,
        expected: '8.69.0',
        message: 'must stay aligned with the consolidated Dependabot update'
      },
      {
        label: 'installed esbuild',
        actual: packageLockJson.packages?.['node_modules/esbuild']?.version,
        expected: '0.28.2',
        message: 'must stay aligned with the audited security baseline'
      },
      {
        label: 'installed eslint',
        actual: packageLockJson.packages?.['node_modules/eslint']?.version,
        expected: '10.10.0',
        message: 'must stay aligned with the consolidated Dependabot update'
      },
      {
        label: 'installed webpack',
        actual: packageLockJson.packages?.['node_modules/webpack']?.version,
        expected: '5.109.2',
        message: 'must stay aligned with the consolidated Dependabot update'
      },
      {
        label: 'installed webpack-cli',
        actual: packageLockJson.packages?.['node_modules/webpack-cli']?.version,
        expected: '7.2.3',
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
        expected: '5.0.9',
        message: 'must stay on the audited non-vulnerable release'
      },
      {
        label: 'installed shell-quote',
        actual: packageLockJson.packages?.['node_modules/shell-quote']?.version,
        expected: '1.10.0',
        message: 'must stay on the audited non-vulnerable release'
      },
      {
        label: 'installed js-yaml',
        actual: packageLockJson.packages?.['node_modules/js-yaml']?.version,
        expected: '4.3.1',
        message: 'must stay on the audited non-vulnerable release'
      },
      {
        label: 'installed postcss',
        actual: packageLockJson.packages?.['node_modules/postcss']?.version,
        expected: '8.5.26',
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
