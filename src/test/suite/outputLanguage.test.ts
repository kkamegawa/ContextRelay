import { strict as assert } from 'assert';
import { detectOutputLanguage } from '../../panel/outputLanguage';

suite('detectOutputLanguage', () => {
  test('strips a single wrapping fenced block and uses its language', () => {
    const response = '```json\n{"a":1}\n```';
    const result = detectOutputLanguage('convert to json', response);
    assert.equal(result.language, 'json');
    assert.equal(result.content, '{"a":1}');
  });

  test('maps md alias to markdown', () => {
    const response = '```md\n# Title\n\nBody\n```';
    const result = detectOutputLanguage('make it a markdown file', response);
    assert.equal(result.language, 'markdown');
    assert.equal(result.content, '# Title\n\nBody');
  });

  test('strips a single wrapping fenced block with CRLF line endings', () => {
    const response = '```json\r\n{"a":1}\r\n```';
    const result = detectOutputLanguage('convert to json', response);
    assert.equal(result.language, 'json');
    assert.equal(result.content, '{"a":1}');
  });

  test('does not strip fences when the response contains multiple blocks', () => {
    const response = 'Intro\n\n```ts\nconst a = 1;\n```\n\n```ts\nconst b = 2;\n```';
    const result = detectOutputLanguage('explain', response);
    assert.equal(result.language, 'typescript');
    assert.equal(result.content, response);
  });

  test('picks dominant inner fence language when response is mixed content', () => {
    const response = 'Here is the data:\n\n```yaml\nkey: value\n```\n\nDone.';
    const result = detectOutputLanguage('do the thing', response);
    assert.equal(result.language, 'yaml');
    assert.equal(result.content, response);
  });

  test('picks dominant inner fence language with CRLF line endings', () => {
    const response = 'Here is the data:\r\n\r\n```yaml\r\nkey: value\r\n```\r\n\r\nDone.';
    const result = detectOutputLanguage('do the thing', response);
    assert.equal(result.language, 'yaml');
    assert.equal(result.content, response);
  });

  test('falls back to prompt keyword when no fenced block is present', () => {
    const result = detectOutputLanguage('translate to Japanese and return as HTML', 'Plain text reply.');
    assert.equal(result.language, 'html');
    assert.equal(result.content, 'Plain text reply.');
  });

  test('defaults to markdown when nothing else matches', () => {
    const result = detectOutputLanguage('translate to Japanese', 'Plain text reply.');
    assert.equal(result.language, 'markdown');
    assert.equal(result.content, 'Plain text reply.');
  });

  test('markdown keyword in prompt wins over default', () => {
    const result = detectOutputLanguage('please give me markdown output', 'no fences here');
    assert.equal(result.language, 'markdown');
  });
});
