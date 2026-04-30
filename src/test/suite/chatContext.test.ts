import { strict as assert } from 'assert';
import { buildChatContextPayload, MAX_CHAT_CONTEXT_CHARS } from '../../panel/chatContext';
import type { SavedSnippet } from '../../models/contextItem';

function snippet(source: SavedSnippet['item']['source'], name: string, body: string, url?: string): SavedSnippet {
  return {
    id: `s-${name}`,
    name,
    savedAt: '2026-04-30T00:00:00.000Z',
    item: {
      source,
      title: name,
      snippet: body,
      url,
      cache: { hit: false }
    }
  };
}

suite('chatContext', () => {
  test('returns no ContextRelay context when nothing has been added', () => {
    const payload = buildChatContextPayload({ snippets: [] });
    assert.equal(payload.additionalContext, undefined);
    assert.equal(payload.contextualResources, undefined);
    assert.deepEqual(payload.labels, []);
  });

  test('uses SharePoint and OneDrive snippet URLs as file contextual resources', () => {
    const payload = buildChatContextPayload({
      snippets: [
        snippet('sharepoint', 'spec.docx', 'body', 'https://contoso.sharepoint.com/sites/docs/spec.docx'),
        snippet('onedrive', 'plan.docx', 'body', 'https://contoso-my.sharepoint.com/personal/docs/plan.docx')
      ]
    });

    assert.deepEqual(payload.contextualResources?.files, [
      { uri: 'https://contoso.sharepoint.com/sites/docs/spec.docx' },
      { uri: 'https://contoso-my.sharepoint.com/personal/docs/plan.docx' }
    ]);
    assert.deepEqual(payload.labels, ['spec.docx', 'plan.docx']);
  });

  test('uses non-file snippets and visible result as additional context', () => {
    const payload = buildChatContextPayload({
      snippets: [snippet('teams', 'standup', 'Release is blocked by test failures.')],
      visibleResult: 'Draft answer from the panel'
    });

    assert.equal(payload.additionalContext?.length, 2);
    assert.ok(payload.additionalContext?.[0].text.includes('Release is blocked'));
    assert.ok(payload.additionalContext?.[1].text.includes('Draft answer'));
    assert.ok(payload.labels.includes('Latest visible ContextRelay result'));
  });

  test('caps additional context to the shared budget', () => {
    const payload = buildChatContextPayload({
      snippets: [snippet('teams', 'huge', 'x'.repeat(MAX_CHAT_CONTEXT_CHARS * 2))]
    });

    const length = payload.additionalContext?.reduce((total, item) => total + item.text.length, 0) ?? 0;
    assert.ok(length <= MAX_CHAT_CONTEXT_CHARS);
    assert.ok(payload.additionalContext?.[0].text.includes('truncated'));
  });
});
