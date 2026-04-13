import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Minimal DocGenerator logic for unit testing without vscode dependency
function utcTimestamp(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function generatePlan(snippets: Array<{ name: string; item: { source: string; snippet: string } }>): string {
  const ts = utcTimestamp();
  const snippetList = snippets.length > 0
    ? snippets.map(s => `- **${s.name}** (${s.item.source}) — ${s.item.snippet.slice(0, 120)}...`).join('\n')
    : '_No snippets saved._';
  return `## Update (${ts})\n\n### Saved Context\n\n${snippetList}\n`;
}

function generateHandoff(snippets: Array<{ name: string; savedAt: string; item: { source: string; snippet: string; url?: string } }>): string {
  const ts = utcTimestamp();
  const list = snippets.length > 0
    ? snippets.map(s => `### ${s.name}\n- **Source**: ${s.item.source}\n- **Saved**: ${s.savedAt}\n\n${s.item.snippet}\n`).join('\n')
    : '_No snippets saved._';
  return `## Update (${ts})\n\n### Saved Snippets\n\n${list}`;
}

suite('DocGenerator', () => {
  let tmpDir: string;

  setup(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'context-relay-test-'));
  });

  teardown(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('generatePlan includes Update timestamp', () => {
    const content = generatePlan([]);
    assert.ok(content.includes('## Update ('));
    assert.ok(content.includes('_No snippets saved._'));
  });

  test('generatePlan includes snippet names', () => {
    const snippets = [{ name: 'Test Snippet', item: { source: 'mail', snippet: 'Hello world content here' } }];
    const content = generatePlan(snippets);
    assert.ok(content.includes('Test Snippet'));
    assert.ok(content.includes('mail'));
  });

  test('generateHandoff includes Update timestamp', () => {
    const content = generateHandoff([]);
    assert.ok(content.includes('## Update ('));
    assert.ok(content.includes('_No snippets saved._'));
  });

  test('generateHandoff includes snippet details', () => {
    const snippets = [{
      name: 'My Snippet',
      savedAt: '2024-01-01T00:00:00Z',
      item: { source: 'teams', snippet: 'Teams message content', url: 'https://example.com' }
    }];
    const content = generateHandoff(snippets);
    assert.ok(content.includes('My Snippet'));
    assert.ok(content.includes('teams'));
    assert.ok(content.includes('Teams message content'));
  });

  test('appending to file creates sections without corruption', () => {
    const filePath = path.join(tmpDir, 'PLAN.md');
    const section1 = generatePlan([]);
    const section2 = generatePlan([]);

    fs.appendFileSync(filePath, '\n' + section1, 'utf8');
    fs.appendFileSync(filePath, '\n' + section2, 'utf8');

    const content = fs.readFileSync(filePath, 'utf8');
    const matches = content.match(/## Update \(/g);
    assert.ok(matches, 'Should have Update sections');
    assert.equal(matches?.length, 2, 'Should have exactly 2 Update sections');
  });

  test('UTC timestamp format is ISO 8601', () => {
    const ts = utcTimestamp();
    assert.ok(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(ts), `Timestamp "${ts}" should match ISO 8601 UTC format`);
  });
});
