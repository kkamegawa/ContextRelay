import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildChatContextPayload, MAX_CHAT_CONTEXT_CHARS, MAX_LOCAL_FILE_CHARS } from '../../panel/chatContext';
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

  test('returns no context when nothing is attached and ContextRelay context is excluded', async () => {
    const payload = await buildChatContextPayload({ snippets: [], includeContextRelayContext: false });
    assert.equal(payload.additionalContext, undefined);
    assert.equal(payload.contextualResources, undefined);
    assert.deepEqual(payload.labels, []);
  });

  test('plain chat (includeContextRelayContext: false) omits pinned snippets, visible result, and search summary', async () => {
    const payload = await buildChatContextPayload({
      snippets: [snippet('teams', 'standup', 'Release is blocked by test failures.')],
      visibleResult: 'Draft answer from the panel',
      searchSummary: 'summary text',
      includeContextRelayContext: false
    });

    assert.equal(payload.additionalContext, undefined);
    assert.equal(payload.contextualResources, undefined);
    assert.deepEqual(payload.labels, []);
  });

  test('/ask (includeContextRelayContext: true) uses SharePoint and OneDrive snippet URLs as file contextual resources', async () => {
    const payload = await buildChatContextPayload({
      snippets: [
        snippet('sharepoint', 'spec.docx', 'body', 'https://contoso.sharepoint.com/sites/docs/spec.docx'),
        snippet('onedrive', 'plan.docx', 'body', 'https://contoso-my.sharepoint.com/personal/docs/plan.docx')
      ],
      includeContextRelayContext: true
    });

    assert.deepEqual(payload.contextualResources?.files, [
      { uri: 'https://contoso.sharepoint.com/sites/docs/spec.docx' },
      { uri: 'https://contoso-my.sharepoint.com/personal/docs/plan.docx' }
    ]);
    assert.deepEqual(payload.labels, ['spec.docx', 'plan.docx']);
  });

  test('reads attached local file content into additionalContext instead of contextualResources.files', async () => {
    const filePath = path.join(root, 'notes.md');
    fs.writeFileSync(filePath, 'Ship checklist body', 'utf8');

    const payload = await buildChatContextPayload({
      snippets: [],
      attachments: [makeAttachment(filePath, 'notes.md')],
      includeContextRelayContext: false
    });

    assert.equal(payload.contextualResources, undefined, 'local files must never be sent as contextualResources.files');
    assert.equal(payload.additionalContext?.length, 1);
    assert.equal(payload.additionalContext?.[0].description, 'Local file: notes.md');
    assert.ok(payload.additionalContext?.[0].text.includes('Ship checklist body'));
    assert.deepEqual(payload.labels, ['Local file: notes.md']);
  });

  test('reads only the selected line range when an attachment has a selection', async () => {
    const filePath = path.join(root, 'range.txt');
    fs.writeFileSync(filePath, 'line1\nline2\nline3\nline4', 'utf8');

    const payload = await buildChatContextPayload({
      snippets: [],
      attachments: [makeAttachment(filePath, 'range.txt', { startLine: 2, endLine: 3 })],
      includeContextRelayContext: false
    });

    const text = payload.additionalContext?.[0].text ?? '';
    assert.ok(text.includes('line2'));
    assert.ok(text.includes('line3'));
    assert.ok(!text.includes('line1'));
    assert.ok(!text.includes('line4'));
    assert.equal(payload.additionalContext?.[0].description, 'Local file: range.txt (L2-L3)');
  });

  test('orders attachments before pinned snippets, then visible result, then search summary', async () => {
    const filePath = path.join(root, 'notes.md');
    fs.writeFileSync(filePath, 'attachment body', 'utf8');

    const payload = await buildChatContextPayload({
      snippets: [snippet('teams', 'standup', 'snippet body')],
      visibleResult: 'visible result body',
      searchSummary: 'search summary body',
      attachments: [makeAttachment(filePath, 'notes.md')],
      includeContextRelayContext: true
    });

    assert.deepEqual(payload.labels, [
      'Local file: notes.md',
      'standup',
      'Latest visible ContextRelay result',
      'Latest ContextRelay search summary'
    ]);
  });

  test('skips an attachment whose file no longer exists instead of throwing', async () => {
    const missingPath = path.join(root, 'missing.md');

    const payload = await buildChatContextPayload({
      snippets: [],
      attachments: [makeAttachment(missingPath, 'missing.md')],
      includeContextRelayContext: false
    });

    assert.equal(payload.additionalContext, undefined);
    assert.deepEqual(payload.labels, []);
  });

  test('caps a single large attachment at MAX_LOCAL_FILE_CHARS', async () => {
    const filePath = path.join(root, 'big.txt');
    fs.writeFileSync(filePath, 'x'.repeat(MAX_LOCAL_FILE_CHARS * 2), 'utf8');

    const payload = await buildChatContextPayload({
      snippets: [],
      attachments: [makeAttachment(filePath, 'big.txt')],
      includeContextRelayContext: false
    });

    assert.ok((payload.additionalContext?.[0].text.length ?? 0) <= MAX_LOCAL_FILE_CHARS);
    assert.ok(payload.additionalContext?.[0].text.includes('truncated'));
  });

  test('caps additional context to the shared budget', async () => {
    const payload = await buildChatContextPayload({
      snippets: [snippet('teams', 'huge', 'x'.repeat(MAX_CHAT_CONTEXT_CHARS * 2))],
      includeContextRelayContext: true
    });

    const length = payload.additionalContext?.reduce((total, item) => total + item.text.length, 0) ?? 0;
    assert.ok(length <= MAX_CHAT_CONTEXT_CHARS);
    assert.ok(payload.additionalContext?.[0].text.includes('truncated'));
  });

  test('reports the number of omitted characters after accounting for the suffix length', async () => {
    const oversizedBody = 'x'.repeat(MAX_CHAT_CONTEXT_CHARS * 2);
    const payload = await buildChatContextPayload({
      snippets: [snippet('teams', 'huge', oversizedBody)],
      includeContextRelayContext: true
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
