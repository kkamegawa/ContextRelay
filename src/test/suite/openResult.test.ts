import { strict as assert } from 'assert';
import { buildPreviewDocument, buildPreviewWebviewHtml } from '../../panel/openResult';
import { canOpenResult } from '../../models/contextItem';

suite('Open result', () => {
  test('shows open action for task results without external URLs', () => {
    assert.equal(canOpenResult({ source: 'planner' }), true);
    assert.equal(canOpenResult({ source: 'todo' }), true);
    assert.equal(canOpenResult({ source: 'mail' }), false);
  });

  test('shows open action for any result that already has a URL', () => {
    assert.equal(canOpenResult({ source: 'mail', url: 'https://example.com' }), true);
  });

  test('builds a readable markdown preview document', () => {
    const content = buildPreviewDocument({
      source: 'todo',
      title: 'Buy groceries',
      subtitle: 'Personal · notStarted',
      content: { kind: 'text', text: 'Need milk and fruit' },
      timestamp: '2026-04-30T00:00:00Z'
    });

    assert.ok(content.includes('# Buy groceries'));
    assert.ok(content.includes('- Source: Microsoft To Do'));
    assert.ok(content.includes('- Context: Personal · notStarted'));
    assert.ok(content.includes('Need milk and fruit'));
  });

  test('builds rich preview webview html for image previews', () => {
    const html = buildPreviewWebviewHtml({
      source: 'sharepoint',
      title: 'Quarterly deck',
      content: {
        kind: 'image',
        src: 'data:image/jpeg;base64,abc123',
        alt: 'Quarterly deck preview image',
        text: 'Executive summary'
      }
    }, 'vscode-resource:preview');

    assert.ok(html.includes('Quarterly deck'));
    assert.ok(html.includes('data:image/jpeg;base64,abc123'));
    assert.ok(html.includes('Executive summary'));
  });
});
