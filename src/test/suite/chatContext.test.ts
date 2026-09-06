import { strict as assert } from 'assert';
import {
  buildChatContextPayload,
  buildGroundedPrompt,
  GROUNDING_INSTRUCTION,
  MAX_CHAT_CONTEXT_CHARS,
  PINNED_LABEL_PREFIX
} from '../../panel/chatContext';
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
    assert.equal(payload.hasGroundingContext, false);
  });

  test('uses SharePoint and OneDrive snippet URLs as file contextual resources and disables web grounding', () => {
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
    assert.deepEqual(payload.labels, [
      `${PINNED_LABEL_PREFIX}spec.docx`,
      `${PINNED_LABEL_PREFIX}plan.docx`
    ]);
    assert.equal(payload.hasGroundingContext, true);
    assert.equal(payload.contextualResources?.webContext?.isWebEnabled, false);
  });

  test('adds local # mention files before snippet URLs and deduplicates by uri', () => {
    const payload = buildChatContextPayload({
      snippets: [
        snippet('sharepoint', 'spec.docx', 'body', 'file:///workspace/spec.docx')
      ],
      localFiles: [
        { uri: 'file:///workspace/spec.docx', label: 'Local file: spec.docx' },
        { uri: 'file:///workspace/notes.md', label: 'Local file: notes.md' }
      ]
    });

    assert.deepEqual(payload.contextualResources?.files, [
      { uri: 'file:///workspace/spec.docx' },
      { uri: 'file:///workspace/notes.md' }
    ]);
    assert.deepEqual(payload.labels, [
      'Local file: spec.docx',
      'Local file: notes.md',
      `${PINNED_LABEL_PREFIX}spec.docx`
    ]);
    assert.equal(payload.hasGroundingContext, true);
  });

  test('uses non-file snippets as additional context and labels them as pinned', () => {
    const payload = buildChatContextPayload({
      snippets: [snippet('teams', 'standup', 'Release is blocked by test failures.')]
    });

    assert.equal(payload.additionalContext?.length, 1);
    assert.ok(payload.additionalContext?.[0].text.includes('Release is blocked'));
    assert.deepEqual(payload.labels, [`${PINNED_LABEL_PREFIX}standup`]);
    assert.equal(payload.hasGroundingContext, true);
  });

  test('does not enable grounding for a search summary alone', () => {
    const payload = buildChatContextPayload({
      snippets: [],
      searchSummary: 'Found 3 mail results for "budget".'
    });

    assert.equal(payload.additionalContext?.length, 1);
    assert.ok(payload.additionalContext?.[0].text.includes('Found 3 mail results'));
    assert.deepEqual(payload.labels, ['Latest ContextRelay search summary']);
    assert.equal(payload.hasGroundingContext, false);
    assert.equal(payload.contextualResources, undefined);
  });

  test('caps additional context to the shared budget', () => {
    const payload = buildChatContextPayload({
      snippets: [snippet('teams', 'huge', 'x'.repeat(MAX_CHAT_CONTEXT_CHARS * 2))]
    });

    const length = payload.additionalContext?.reduce((total, item) => total + item.text.length, 0) ?? 0;
    assert.ok(length <= MAX_CHAT_CONTEXT_CHARS);
    assert.ok(payload.additionalContext?.[0].text.includes('truncated'));
  });

  test('reports the number of omitted characters after accounting for the suffix length', () => {
    const oversizedBody = 'x'.repeat(MAX_CHAT_CONTEXT_CHARS * 2);
    const payload = buildChatContextPayload({
      snippets: [snippet('teams', 'huge', oversizedBody)]
    });

    const text = payload.additionalContext?.[0].text ?? '';
    const suffixIndex = text.indexOf('\n[truncated ');
    const match = text.match(/\[truncated (\d+) chars\]$/);
    assert.ok(suffixIndex > 0);
    assert.ok(match);

    const original = `Title: huge\nSource: teams\n\n${oversizedBody}`;
    assert.equal(Number(match?.[1]), original.length - suffixIndex);
  });
});

suite('buildGroundedPrompt', () => {
  test('leaves the prompt untouched when there is no grounding context', () => {
    const prompt = 'What is the capital of France?';
    assert.equal(buildGroundedPrompt(prompt, { hasGroundingContext: false }), prompt);
  });

  test('prepends the grounding instruction when pinned/mentioned context is attached', () => {
    const prompt = 'Summarize the pinned document.';
    const result = buildGroundedPrompt(prompt, { hasGroundingContext: true });

    assert.ok(result.startsWith(GROUNDING_INSTRUCTION));
    assert.ok(result.endsWith(prompt));
    assert.ok(result.includes('[User request]'));
  });
});
