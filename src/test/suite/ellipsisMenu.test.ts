import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { setGraphLogger, GraphLogger } from '../../adapters/graphClient';

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
  contributes?: {
    commands?: PackageCommand[];
    menus?: {
      'view/title'?: ViewTitleMenuItem[];
    };
  };
}

suite('Ellipsis menu manifest entries', () => {
  const packageJsonPath = path.resolve(__dirname, '../../../../package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as PackageJson;

  const ellipsisCommands = [
    { id: 'contextRelay.moveChatToEditorArea', title: 'Move Chat into Editor Area', group: '1_move' },
    { id: 'contextRelay.moveChatToNewWindow', title: 'Move Chat into New Window', group: '1_move' },
    { id: 'contextRelay.showDebugLog', title: 'Show Debug Log', group: '2_debug' },
    { id: 'contextRelay.openSettings', title: 'Chat Settings', group: '3_settings' },
  ];

  for (const cmd of ellipsisCommands) {
    test(`contributes "${cmd.id}" command`, () => {
      const commands = packageJson.contributes?.commands ?? [];
      const found = commands.find(c => c.command === cmd.id);
      assert.ok(found, `${cmd.id} must be contributed in package.json`);
      assert.equal(found?.title, cmd.title);
    });

    test(`registers "${cmd.id}" in view/title menu under ${cmd.group} group`, () => {
      const viewTitleMenu = packageJson.contributes?.menus?.['view/title'] ?? [];
      const entry = viewTitleMenu.find(m => m.command === cmd.id);
      assert.ok(entry, `view/title must include ${cmd.id}`);
      assert.ok(
        entry?.when?.includes('contextRelay.chatView'),
        `${cmd.id} menu entry must be scoped to contextRelay.chatView`
      );
      assert.ok(
        entry?.group?.startsWith(cmd.group),
        `${cmd.id} must appear in the ${cmd.group} group, got "${entry?.group}"`
      );
    });
  }

  test('ellipsis menu commands do not appear in navigation group', () => {
    const viewTitleMenu = packageJson.contributes?.menus?.['view/title'] ?? [];
    for (const cmd of ellipsisCommands) {
      const entry = viewTitleMenu.find(m => m.command === cmd.id);
      assert.ok(entry, `view/title must include ${cmd.id}`);
      assert.ok(
        !entry?.group?.startsWith('navigation'),
        `${cmd.id} must NOT be in the navigation group (would show as icon, not in ellipsis menu)`
      );
    }
  });
});

suite('Graph API debug logger', () => {
  test('setGraphLogger accepts a logger implementation', () => {
    const messages: string[] = [];
    const logger: GraphLogger = { log: (msg: string) => messages.push(msg) };
    // Should not throw
    setGraphLogger(logger);
    assert.ok(true, 'setGraphLogger accepted a logger without error');
  });

  test('GraphLogger interface has log method', () => {
    const logger: GraphLogger = { log: () => {} };
    assert.equal(typeof logger.log, 'function');
  });
});
