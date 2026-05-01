import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as path from 'path';

interface PackageCommand {
  command: string;
  title: string;
  icon?: string;
}

interface ViewTitleMenuItem {
  command: string;
  when?: string;
  group?: string;
}

interface PackageJson {
  main?: string;
  scripts?: Record<string, string>;
  contributes?: {
    commands?: PackageCommand[];
    viewsContainers?: {
      activitybar?: Array<{ id: string; title: string; icon?: string }>;
      secondarySidebar?: Array<{ id: string; title: string; icon?: string }>;
      auxiliarybar?: Array<{ id: string; title: string; icon?: string }>;
    };
    menus?: {
      'view/title'?: ViewTitleMenuItem[];
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

  test('declares a dedicated secondary sidebar container for sidebar moves', () => {
    const secondarySidebar = packageJson.contributes?.viewsContainers?.secondarySidebar ?? [];
    const container = secondarySidebar.find(view => view.id === 'contextRelaySecondary');

    assert.ok(container, 'ContextRelay secondary sidebar container must exist');
    assert.equal(container?.title, 'ContextRelay');
    assert.ok(container?.icon?.endsWith('.svg'), 'Secondary sidebar icon must point to an SVG asset');
    assert.equal(
      packageJson.contributes?.viewsContainers?.auxiliarybar,
      undefined,
      'ContextRelay must not use the obsolete viewsContainers.auxiliarybar manifest key'
    );
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

  test('wires Work IQ logging to the ContextRelay debug channel', () => {
    const extensionSourcePath = path.resolve(__dirname, '../../../../src/extension.ts');
    const extensionSource = fs.readFileSync(extensionSourcePath, 'utf8');

    assert.ok(
      extensionSource.includes("import { setWorkIqLogger } from './adapters/workIqAdapter';"),
      'extension activation must import the Work IQ logger hook'
    );
    assert.ok(
      extensionSource.includes('setWorkIqLogger(logger);'),
      'debug logging must enable Work IQ request/response status logs'
    );
    assert.ok(
      extensionSource.includes('setWorkIqLogger(undefined);') || extensionSource.includes('setWorkIqLogger(logger);'),
      'debug logging must be able to disable Work IQ logs with the shared logger state'
    );
  });

  test('contributes move-to-sidebar commands with icons for view/title menu', () => {
    const commands = packageJson.contributes?.commands ?? [];

    const moveRight = commands.find(c => c.command === 'contextRelay.moveToSecondarySideBar');
    const moveLeft = commands.find(c => c.command === 'contextRelay.moveToPrimarySideBar');

    assert.ok(moveRight, 'contextRelay.moveToSecondarySideBar command must be contributed');
    assert.ok(moveRight?.icon, 'moveToSecondarySideBar must have an icon for the title bar');
    assert.ok(moveLeft, 'contextRelay.moveToPrimarySideBar command must be contributed');
    assert.ok(moveLeft?.icon, 'moveToPrimarySideBar must have an icon for the title bar');
  });

  test('registers view/title menu entries for sidebar move commands', () => {
    const viewTitleMenu = packageJson.contributes?.menus?.['view/title'] ?? [];

    const moveRightEntry = viewTitleMenu.find(
      m => m.command === 'contextRelay.moveToSecondarySideBar'
    );
    const moveLeftEntry = viewTitleMenu.find(
      m => m.command === 'contextRelay.moveToPrimarySideBar'
    );

    assert.ok(moveRightEntry, 'view/title must include moveToSecondarySideBar');
    assert.ok(
      moveRightEntry?.when?.includes('contextRelay.chatView'),
      'moveToSecondarySideBar menu entry must be scoped to the chatView'
    );
    assert.ok(
      moveRightEntry?.when?.includes("contextRelay.viewLocation != 'auxiliarybar'"),
      'moveToSecondarySideBar must use the extension-managed contextRelay.viewLocation context key'
    );
    assert.ok(
      moveRightEntry?.group?.startsWith('navigation'),
      'moveToSecondarySideBar must appear in the navigation group'
    );

    assert.ok(moveLeftEntry, 'view/title must include moveToPrimarySideBar');
    assert.ok(
      moveLeftEntry?.when?.includes('contextRelay.chatView'),
      'moveToPrimarySideBar menu entry must be scoped to the chatView'
    );
    assert.ok(
      moveLeftEntry?.when?.includes("contextRelay.viewLocation != 'sidebar'"),
      'moveToPrimarySideBar must use the extension-managed contextRelay.viewLocation context key'
    );
    assert.ok(
      moveLeftEntry?.group?.startsWith('navigation'),
      'moveToPrimarySideBar must appear in the navigation group'
    );
    assert.ok(
      !moveRightEntry?.when?.includes('viewContainerLocation') &&
      !moveLeftEntry?.when?.includes('viewContainerLocation'),
      'sidebar move menu entries must not depend on the unreliable built-in viewContainerLocation context key'
    );
  });
});
