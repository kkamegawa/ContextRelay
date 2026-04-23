import { strict as assert } from 'assert';
import { buildPreviewDocument, canOpenResult } from '../../panel/openResult';

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
      body: 'Need milk and fruit',
      timestamp: '2026-04-30T00:00:00Z'
    });

    assert.ok(content.includes('# Buy groceries'));
    assert.ok(content.includes('- Source: Microsoft To Do'));
    assert.ok(content.includes('- Context: Personal · notStarted'));
    assert.ok(content.includes('Need milk and fruit'));
  });
});
