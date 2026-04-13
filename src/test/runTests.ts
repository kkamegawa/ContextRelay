import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runTests } from '@vscode/test-electron';

async function main(): Promise<void> {
  const testCachePath = fs.mkdtempSync(path.join(os.tmpdir(), 'contextrelay-vscode-test-'));

  try {
    const extensionDevelopmentPath = path.resolve(__dirname, '../../..');
    const extensionTestsPath = path.resolve(__dirname, './suite/index');

    await runTests({
      cachePath: testCachePath,
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: ['--disable-extensions']
    });
  } catch (err) {
    process.stderr.write(`Failed to run tests: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
    process.exit(1);
  } finally {
    try {
      fs.rmSync(testCachePath, { recursive: true, force: true, maxRetries: 3, retryDelay: 250 });
    } catch {
      // Ignore best-effort cleanup failures (e.g. Windows file locking)
    }
  }
}

main();
