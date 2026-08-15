import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { mergeAttachments, resolveAttachmentPath, type ResolvedAttachment } from '../../panel/attachments';

suite('resolveAttachmentPath', () => {
  let root: string;

  setup(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'context-relay-attachments-'));
  });

  teardown(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('resolves a supported file inside the workspace', async () => {
    const filePath = path.join(root, 'notes.md');
    fs.writeFileSync(filePath, 'body', 'utf8');

    const result = await resolveAttachmentPath(filePath, [root], 'drop');
    assert.equal(typeof result, 'object');
    const attachment = result as ResolvedAttachment;
    assert.equal(attachment.relativePath, 'notes.md');
    assert.equal(attachment.origin, 'drop');
    assert.ok(attachment.uri.startsWith('file:///'));
  });

  test('carries through an optional selection', async () => {
    const filePath = path.join(root, 'notes.md');
    fs.writeFileSync(filePath, 'body', 'utf8');

    const result = await resolveAttachmentPath(filePath, [root], 'activeEditor', { startLine: 3, endLine: 9 });
    const attachment = result as ResolvedAttachment;
    assert.deepEqual(attachment.selection, { startLine: 3, endLine: 9 });
  });

  test('rejects a file outside every workspace root', async () => {
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'context-relay-outside-'));
    try {
      const filePath = path.join(outsideDir, 'notes.md');
      fs.writeFileSync(filePath, 'body', 'utf8');

      const result = await resolveAttachmentPath(filePath, [root], 'drop');
      assert.equal(typeof result, 'string');
      assert.ok((result as string).toLowerCase().includes('outside the opened workspace'));
    } finally {
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  test('rejects a missing file', async () => {
    const result = await resolveAttachmentPath(path.join(root, 'missing.md'), [root], 'picker');
    assert.equal(typeof result, 'string');
    assert.ok((result as string).toLowerCase().includes('not found'));
  });

  test('rejects an unsupported file extension', async () => {
    const filePath = path.join(root, 'capture.pcap');
    fs.writeFileSync(filePath, 'binary', 'utf8');

    const result = await resolveAttachmentPath(filePath, [root], 'drop');
    assert.equal(typeof result, 'string');
    assert.ok((result as string).toLowerCase().includes('unsupported file type'));
  });

  test('rejects when no workspace folder is open', async () => {
    const filePath = path.join(root, 'notes.md');
    fs.writeFileSync(filePath, 'body', 'utf8');

    const result = await resolveAttachmentPath(filePath, [], 'drop');
    assert.equal(typeof result, 'string');
    assert.ok((result as string).toLowerCase().includes('workspace folder'));
  });
});

suite('mergeAttachments', () => {
  function attachment(absolutePath: string, origin: ResolvedAttachment['origin']): ResolvedAttachment {
    return {
      absolutePath,
      workspaceRoot: path.dirname(absolutePath),
      relativePath: path.basename(absolutePath),
      uri: `file://${absolutePath}`,
      origin
    };
  }

  test('deduplicates the same file attached via multiple origins, keeping order of first appearance', () => {
    const mention = attachment('/workspace/notes.md', 'mention');
    const drop = attachment('/workspace/notes.md', 'drop');
    const other = attachment('/workspace/other.md', 'mention');

    const merged = mergeAttachments([mention], [drop], [other]);
    assert.equal(merged.length, 2);
    assert.equal(merged[0].absolutePath, '/workspace/notes.md');
    assert.equal(merged[1].absolutePath, '/workspace/other.md');
  });

  test('a later group overrides an earlier one for the same path', () => {
    const mention = attachment('/workspace/notes.md', 'mention');
    const drop = attachment('/workspace/notes.md', 'drop');

    const merged = mergeAttachments([mention], [drop]);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].origin, 'drop');
  });

  test('returns an empty array for no groups or all-empty groups', () => {
    assert.deepEqual(mergeAttachments(), []);
    assert.deepEqual(mergeAttachments([], []), []);
  });
});
