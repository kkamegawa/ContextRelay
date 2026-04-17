import { strict as assert } from 'assert';
import { buildAskPrompt, MAX_ASK_CONTEXT_CHARS } from '../../panel/askPrompt';
import type { SavedSnippet } from '../../models/contextItem';

function snippet(name: string, body: string): SavedSnippet {
  return {
    id: `s-${name}`,
    name,
    savedAt: '2024-01-01T00:00:00.000Z',
    item: {
      source: 'onedrive',
      title: name,
      snippet: body,
      url: `https://example.com/${name}`,
      cache: { hit: false }
    }
  };
}

suite('buildAskPrompt', () => {
  test('includes every pinned snippet with its title and source', () => {
    const result = buildAskPrompt('translate', [
      snippet('doc-a.docx', 'Hello world'),
      snippet('doc-b.docx', 'Second document body')
    ]);

    assert.ok(result.includes('Pinned document 1: doc-a.docx'));
    assert.ok(result.includes('Hello world'));
    assert.ok(result.includes('Pinned document 2: doc-b.docx'));
    assert.ok(result.includes('Second document body'));
    assert.ok(result.includes('User instruction:'));
    assert.ok(result.trimEnd().endsWith('translate'));
  });

  test('truncates snippets that exceed the per-snippet budget', () => {
    const huge = 'x'.repeat(200_000);
    const result = buildAskPrompt('summarize', [snippet('big.txt', huge)]);
    assert.ok(result.includes('[truncated'), 'expected truncation marker');
    assert.ok(result.length < 200_000 + 2000);
  });

  test('references Microsoft 365 Copilot as the responder', () => {
    const result = buildAskPrompt('hi', [snippet('a', 'b')]);
    assert.ok(result.toLowerCase().includes('microsoft 365 copilot'));
  });

  test('caps combined pinned context even with many snippets', () => {
    const snippets = Array.from({ length: 200 }, (_, index) =>
      snippet(`doc-${index}.txt`, 'x'.repeat(1_000))
    );

    const result = buildAskPrompt('summarize', snippets);
    const start = result.indexOf('--- Pinned context ---\n');
    const end = result.indexOf('\n--- End of pinned context ---');

    assert.notEqual(start, -1);
    assert.notEqual(end, -1);

    const context = result.slice(start + '--- Pinned context ---\n'.length, end);
    assert.ok(context.length <= MAX_ASK_CONTEXT_CHARS);
    assert.ok(context.includes('[truncated'));
  });
});
