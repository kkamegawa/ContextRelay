import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  buildWorkIqPromptWithFiles,
  extractFileMentionCandidates,
  resolveFileMentions
} from '../../panel/fileMentions';

suite('fileMentions', () => {
  test('extracts # mention candidates and ignores C# and issue refs', () => {
    const candidates = extractFileMentionCandidates('Use C# for API #123 and read #docs/plan.md and #"notes/release plan.md"');
    assert.deepEqual(candidates.map(candidate => candidate.rawPath), [
      'docs/plan.md',
      'notes/release plan.md'
    ]);
  });

  test('resolves workspace-relative files and strips mention tokens from prompt', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'context-relay-mentions-'));
    fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(root, 'docs', 'plan.md'), 'Ship checklist', 'utf8');

    try {
      const result = await resolveFileMentions('Summarize #docs/plan.md for me', [root]);
      assert.equal(result.errors.length, 0);
      assert.equal(result.cleanedPrompt, 'Summarize for me');
      assert.equal(result.files.length, 1);
      assert.equal(result.files[0].relativePath, 'docs/plan.md');
      assert.ok(result.files[0].uri.startsWith('file:///'));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('rejects unsupported extensions', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'context-relay-mentions-'));
    fs.writeFileSync(path.join(root, 'capture.pcap'), 'pcap-binary', 'utf8');

    try {
      const result = await resolveFileMentions('Inspect #capture.pcap', [root]);
      assert.equal(result.files.length, 0);
      assert.ok(result.errors[0].toLowerCase().includes('unsupported file type'));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('builds Work IQ prompt with bounded local file sections', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'context-relay-workiq-'));
    fs.writeFileSync(path.join(root, 'notes.md'), 'line1\nline2', 'utf8');

    try {
      const resolved = await resolveFileMentions('Summarize #notes.md', [root]);
      assert.equal(resolved.errors.length, 0);
      const workIqPrompt = await buildWorkIqPromptWithFiles('Summarize', resolved.files);
      assert.ok(workIqPrompt.includes('ContextRelay local file context'));
      assert.ok(workIqPrompt.includes('[File: notes.md]'));
      assert.ok(workIqPrompt.includes('line1'));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

