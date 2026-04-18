import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { graphFetch, handleGraphResponse, setGraphLogger, GraphLogger } from '../../adapters/graphClient';

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
    configuration?: {
      properties?: Record<string, {
        type?: string;
        default?: unknown;
      }>;
    };
  };
}

suite('Ellipsis menu manifest entries', () => {
  const packageJsonPath = path.resolve(__dirname, '../../../../package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as PackageJson;

  const ellipsisCommands = [
    { id: 'contextRelay.moveChatToEditorArea', title: 'ContextRelay: Move Chat into Editor Area', group: '1_move' },
    { id: 'contextRelay.moveChatToNewWindow', title: 'ContextRelay: Move Chat into New Window', group: '1_move' },
    { id: 'contextRelay.showDebugLog', title: 'ContextRelay: Show Debug Log', group: '2_debug' },
    { id: 'contextRelay.openSettings', title: 'ContextRelay: Chat Settings', group: '3_settings' },
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

  test('declares opt-in graph debug logging configuration', () => {
    const setting = packageJson.contributes?.configuration?.properties?.['contextRelay.enableGraphDebugLogging'];
    assert.ok(setting, 'contextRelay.enableGraphDebugLogging must be declared');
    assert.equal(setting?.type, 'boolean');
    assert.equal(setting?.default, false);
  });
});

suite('Graph API debug logger', () => {
  test('setGraphLogger accepts a logger implementation without emitting logs', () => {
    const messages: string[] = [];
    const logger: GraphLogger = { log: (msg: string) => messages.push(msg) };

    assert.doesNotThrow(() => setGraphLogger(logger));
    assert.deepEqual(messages, []);
    setGraphLogger(undefined);
  });

  test('GraphLogger interface has log method', () => {
    const logger: GraphLogger = { log: () => {} };
    assert.equal(typeof logger.log, 'function');
  });

  test('graphFetch logs request and response details', async () => {
    const messages: string[] = [];
    const originalFetch = globalThis.fetch;

    setGraphLogger({ log: (msg: string) => messages.push(msg) });
    globalThis.fetch = (async () => new Response('{}', {
      status: 200,
      statusText: 'OK',
      headers: { 'Content-Type': 'application/json' }
    })) as typeof globalThis.fetch;

    try {
      await graphFetch('https://graph.microsoft.com/v1.0/me', 'token-abc', { method: 'POST' });
      assert.deepEqual(messages, [
        '→ POST https://graph.microsoft.com/v1.0/me',
        '← 200 OK https://graph.microsoft.com/v1.0/me'
      ]);
    } finally {
      globalThis.fetch = originalFetch;
      setGraphLogger(undefined);
    }
  });

  test('handleGraphResponse logs redacted error details', async () => {
    const messages: string[] = [];
    setGraphLogger({ log: (msg: string) => messages.push(msg) });

    const response = new Response(JSON.stringify({
      error: {
        code: 'Forbidden',
        message: 'secret body content'
      }
    }), {
      status: 403,
      headers: {
        'Content-Type': 'application/json',
        'request-id': 'req-123'
      }
    });

    try {
      await assert.rejects(() => handleGraphResponse(response), /Forbidden \(403\)/);
      assert.deepEqual(messages, [
        '✖ Graph API error 403 code=Forbidden requestId=req-123'
      ]);
      assert.ok(!messages[0].includes('secret body content'));
    } finally {
      setGraphLogger(undefined);
    }
  });
});
