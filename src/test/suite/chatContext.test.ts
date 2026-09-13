import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  buildChatContextPayload,
  buildGroundedPrompt,
  GROUNDING_INSTRUCTION,
  MAX_CHAT_CONTEXT_CHARS,
  MAX_LOCAL_FILE_CHARS,
  PINNED_LABEL_PREFIX
} from '../../panel/chatContext';
import type { ResolvedAttachment } from '../../panel/attachments';
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

function makeAttachment(
  absolutePath: string,
  relativePath: string,
  selection?: { startLine: number; endLine: number }
): ResolvedAttachment {
  return {
    absolutePath,
    workspaceRoot: path.dirname(absolutePath),
    relativePath,
    uri: `file://${absolutePath}`,
    origin: 'mention',
    selection
  };
}

suite('chatContext', () => {
  let root: string;

  setup(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'context-relay-chatcontext-'));
  });

  teardown(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('returns no ContextRelay context when nothing has been added', async () => {
    const payload = await buildChatContextPayload({ snippets: [] });
    assert.equal(payload.additionalContext, undefined);
    assert.equal(payload.contextualResources, undefined);
    assert.deepEqual(payload.labels, []);
    assert.equal(payload.hasGroundingContext, false);
  });

  test('uses SharePoint and OneDrive snippet URLs as file contextual resources and disables web grounding', async () => {
    const payload = await buildChatContextPayload({
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

  test('reads attached local file content into additionalContext instead of contextualResources.files', async () => {
    const filePath = path.join(root, 'notes.md');
    fs.writeFileSync(filePath, 'ship checklist', 'utf8');

    const payload = await buildChatContextPayload({
      snippets: [],
      attachments: [makeAttachment(filePath, 'notes.md')]
    });

    assert.equal(payload.contextualResources?.files, undefined);
    assert.deepEqual(payload.additionalContext, [
      { description: 'Local file: notes.md', text: 'ship checklist' }
    ]);
    assert.deepEqual(payload.labels, ['Local file: notes.md']);
    assert.equal(payload.hasGroundingContext, true);
    assert.equal(payload.contextualResources?.webContext?.isWebEnabled, false);
  });

  test('reads only the selected line range when an attachment has a selection', async () => {
    const filePath = path.join(root, 'app.ts');
    fs.writeFileSync(filePath, 'line1\nline2\nline3\nline4', 'utf8');

    const payload = await buildChatContextPayload({
      snippets: [],
      attachments: [makeAttachment(filePath, 'app.ts', { startLine: 2, endLine: 3 })]
    });

    assert.deepEqual(payload.additionalContext, [
      { description: 'Local file: app.ts (L2-L3)', text: 'line2\nline3' }
    ]);
  });

  test('orders attachments before pinned snippets, then the search summary', async () => {
    const filePath = path.join(root, 'notes.md');
    fs.writeFileSync(filePath, 'meeting notes', 'utf8');

    const payload = await buildChatContextPayload({
      snippets: [snippet('teams', 'standup', 'Release is blocked by test failures.')],
      searchSummary: 'Found 3 mail results for "budget".',
      attachments: [makeAttachment(filePath, 'notes.md')]
    });

    assert.deepEqual(payload.labels, [
      'Local file: notes.md',
      `${PINNED_LABEL_PREFIX}standup`,
      'Latest ContextRelay search summary'
    ]);
  });

  test('skips an unreadable attachment without throwing and without enabling grounding', async () => {
    const payload = await buildChatContextPayload({
      snippets: [],
      attachments: [makeAttachment(path.join(root, 'missing.md'), 'missing.md')]
    });

    assert.equal(payload.additionalContext, undefined);
    assert.deepEqual(payload.labels, []);
    assert.equal(payload.hasGroundingContext, false);
    assert.equal(payload.contextualResources, undefined);
  });

  test('caps a single large attachment at MAX_LOCAL_FILE_CHARS', async () => {
    const filePath = path.join(root, 'big.md');
    fs.writeFileSync(filePath, 'y'.repeat(MAX_LOCAL_FILE_CHARS * 2), 'utf8');

    const payload = await buildChatContextPayload({
      snippets: [],
      attachments: [makeAttachment(filePath, 'big.md')]
    });

    const text = payload.additionalContext?.[0].text ?? '';
    assert.ok(text.length <= MAX_LOCAL_FILE_CHARS);
    assert.ok(text.includes('truncated'));
  });

  test('uses non-file snippets as additional context and labels them as pinned', async () => {
    const payload = await buildChatContextPayload({
      snippets: [snippet('teams', 'standup', 'Release is blocked by test failures.')]
    });

    assert.equal(payload.additionalContext?.length, 1);
    assert.ok(payload.additionalContext?.[0].text.includes('Release is blocked'));
    assert.deepEqual(payload.labels, [`${PINNED_LABEL_PREFIX}standup`]);
    assert.equal(payload.hasGroundingContext, true);
  });

  test('does not enable grounding for a search summary alone', async () => {
    const payload = await buildChatContextPayload({
      snippets: [],
      searchSummary: 'Found 3 mail results for "budget".'
    });

    assert.equal(payload.additionalContext?.length, 1);
    assert.ok(payload.additionalContext?.[0].text.includes('Found 3 mail results'));
    assert.deepEqual(payload.labels, ['Latest ContextRelay search summary']);
    assert.equal(payload.hasGroundingContext, false);
    assert.equal(payload.contextualResources, undefined);
  });

  test('caps additional context to the shared budget', async () => {
    const payload = await buildChatContextPayload({
      snippets: [snippet('teams', 'huge', 'x'.repeat(MAX_CHAT_CONTEXT_CHARS * 2))]
    });

    const length = payload.additionalContext?.reduce((total, item) => total + item.text.length, 0) ?? 0;
    assert.ok(length <= MAX_CHAT_CONTEXT_CHARS);
    assert.ok(payload.additionalContext?.[0].text.includes('truncated'));
  });

  test('reports the number of omitted characters after accounting for the suffix length', async () => {
    const oversizedBody = 'x'.repeat(MAX_CHAT_CONTEXT_CHARS * 2);
    const payload = await buildChatContextPayload({
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

  test('prepends the grounding instruction when pinned/attached context is included', () => {
    const prompt = 'Summarize the pinned document.';
    const result = buildGroundedPrompt(prompt, { hasGroundingContext: true });

    assert.ok(result.startsWith(GROUNDING_INSTRUCTION));
    assert.ok(result.endsWith(prompt));
    assert.ok(result.includes('[User request]'));
  });
});
