import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as path from 'path';

interface PackageCommand {
  command: string;
  title: string;
}

interface PackageJson {
  main?: string;
  scripts?: Record<string, string>;
  contributes?: {
    commands?: PackageCommand[];
    viewsContainers?: {
      activitybar?: Array<{ id: string; title: string; icon?: string }>;
    };
  };
}

suite('Extension manifest consistency', () => {
  const packageJsonPath = path.resolve(__dirname, '../../../../package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as PackageJson;

  test('documents open panel command in the extension manifest', () => {
    const commands = packageJson.contributes?.commands ?? [];
    const openPanelCommand = commands.find(command => command.command === 'contextRelay.openPanel');

    assert.ok(openPanelCommand, 'contextRelay.openPanel command must be contributed');
    assert.equal(openPanelCommand?.title, 'ContextRelay: Open Panel');
  });

  test('uses an SVG file for the activity bar icon', () => {
    const activitybar = packageJson.contributes?.viewsContainers?.activitybar ?? [];
    const container = activitybar.find(view => view.id === 'contextRelay');

    assert.ok(container, 'ContextRelay activity bar container must exist');
    assert.ok(container?.icon?.endsWith('.svg'), 'Activity bar icon must point to an SVG asset');
  });

  test('compile script produces the declared runtime entrypoint', () => {
    assert.equal(
      packageJson.main,
      './dist/extension.js',
      'Extension runtime entrypoint must remain the webpack output path'
    );

    const compileScript = packageJson.scripts?.compile ?? '';
    assert.ok(
      compileScript.includes('webpack'),
      'compile script must generate the webpack runtime bundle used by package.json#main'
    );
  });
});