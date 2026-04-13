import { strict as assert } from 'assert';
import { ContextItem } from '../../models/contextItem';
import { buildHandoffSnippetDraft, normalizeHandoffExcerpt } from '../../panel/handoffSelection';

function makeItem(): ContextItem {
  return {
    source: 'sharepoint',
    title: 'Architecture review notes',
    snippet: 'Original summary',
    url: 'https://contoso.sharepoint.com/sites/engineering/Shared%20Documents/adr.docx',
    cache: { hit: true }
  };
}

suite('Handoff selection', () => {
  test('normalizes whitespace while preserving paragraphs', () => {
    const normalized = normalizeHandoffExcerpt('  first line\r\n\r\n\r\nsecond   line\twith   spaces  ');
    assert.equal(normalized, 'first line\n\nsecond line with spaces');
  });

  test('builds selection-based draft with excerpt name', () => {
    const draft = buildHandoffSnippetDraft(makeItem(), {
      selectedText: 'Important paragraph from preview'
    });

    assert.ok(draft);
    assert.equal(draft?.name, 'Architecture review notes — excerpt');
    assert.equal(draft?.item.snippet, 'Important paragraph from preview');
    assert.deepEqual(draft?.item.cache, { hit: false });
  });

  test('falls back to full preview body when no selection exists', () => {
    const draft = buildHandoffSnippetDraft(makeItem(), {
      previewBody: 'Full preview body text'
    });

    assert.ok(draft);
    assert.equal(draft?.name, 'Architecture review notes — full preview');
    assert.equal(draft?.item.snippet, 'Full preview body text');
  });

  test('returns undefined when no preview text exists', () => {
    const emptyItem = { ...makeItem(), snippet: '' };
    const draft = buildHandoffSnippetDraft(emptyItem, {});
    assert.equal(draft, undefined);
  });
});