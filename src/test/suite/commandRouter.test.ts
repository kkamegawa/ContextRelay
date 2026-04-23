import { strict as assert } from 'assert';
import { parseCommand, getHelpText } from '../../router/commandRouter';

suite('CommandRouter', () => {
  test('bare query routes to all', () => {
    const result = parseCommand('architecture decisions');
    assert.equal(result.target, 'all');
    assert.equal(result.query, 'architecture decisions');
    assert.equal(result.isEmpty, false);
  });

  test('/mail command routes to mail', () => {
    const result = parseCommand('/mail incident review');
    assert.equal(result.target, 'mail');
    assert.equal(result.query, 'incident review');
    assert.equal(result.isEmpty, false);
  });

  test('/teams command routes to teams', () => {
    const result = parseCommand('/teams sprint review');
    assert.equal(result.target, 'teams');
    assert.equal(result.query, 'sprint review');
  });

  test('/sharepoint command routes to sharepoint', () => {
    const result = parseCommand('/sharepoint VPN setup');
    assert.equal(result.target, 'sharepoint');
    assert.equal(result.query, 'VPN setup');
  });

  test('/onedrive command routes to onedrive', () => {
    const result = parseCommand('/onedrive architecture diagram');
    assert.equal(result.target, 'onedrive');
    assert.equal(result.query, 'architecture diagram');
  });

  test('/onenote command routes to onenote', () => {
    const result = parseCommand('/onenote architecture decision log');
    assert.equal(result.target, 'onenote');
    assert.equal(result.query, 'architecture decision log');
  });

  test('/task command routes to combined task search', () => {
    const result = parseCommand('/task release checklist');
    assert.equal(result.target, 'task');
    assert.equal(result.query, 'release checklist');
  });

  test('slash command accepts newline-separated query', () => {
    const result = parseCommand('/onedrive\nLendHub_Requirements_Document_Fictional.docx');
    assert.equal(result.target, 'onedrive');
    assert.equal(result.query, 'LendHub_Requirements_Document_Fictional.docx');
    assert.equal(result.isEmpty, false);
  });

  test('bare multiline query is normalized', () => {
    const result = parseCommand('LendHub_Requirements\nDocument\tFictional.docx');
    assert.equal(result.target, 'all');
    assert.equal(result.query, 'LendHub_Requirements Document Fictional.docx');
    assert.equal(result.isEmpty, false);
  });

  test('/all command routes to all', () => {
    const result = parseCommand('/all architecture decisions');
    assert.equal(result.target, 'all');
    assert.equal(result.query, 'architecture decisions');
  });

  test('empty query after /mail sets isEmpty', () => {
    const result = parseCommand('/mail');
    assert.equal(result.target, 'mail');
    assert.equal(result.isEmpty, true);
    assert.equal(result.query, '');
  });

  test('empty query after /teams sets isEmpty', () => {
    const result = parseCommand('/teams');
    assert.equal(result.target, 'teams');
    assert.equal(result.isEmpty, true);
  });

  test('unknown slash command treated as /all', () => {
    const result = parseCommand('/unknown some\nquery');
    assert.equal(result.target, 'all');
    assert.equal(result.query, '/unknown some query');
  });

  test('empty input is isEmpty', () => {
    const result = parseCommand('');
    assert.equal(result.isEmpty, true);
    assert.equal(result.target, 'all');
  });

  test('whitespace-only input is isEmpty', () => {
    const result = parseCommand('   ');
    assert.equal(result.isEmpty, true);
  });

  test('getHelpText returns string for known commands', () => {
    const text = getHelpText('mail');
    assert.ok(text.length > 0);
    assert.ok(text.includes('Example'));
  });

  test('getHelpText returns onboarding examples for onenote and task search', () => {
    assert.ok(getHelpText('onenote').includes('/onenote'));
    assert.ok(getHelpText('task').includes('/task'));
  });

  test('getHelpText returns fallback for unknown command', () => {
    const text = getHelpText('unknown');
    assert.ok(text.length > 0);
  });

  test('/ask command routes to ask and preserves newlines in the query', () => {
    const result = parseCommand('/ask translate to Japanese\nand output as markdown');
    assert.equal(result.target, 'ask');
    assert.equal(result.query, 'translate to Japanese\nand output as markdown');
    assert.equal(result.isEmpty, false);
  });

  test('empty /ask triggers isEmpty for slash help', () => {
    const result = parseCommand('/ask');
    assert.equal(result.target, 'ask');
    assert.equal(result.isEmpty, true);
  });

  test('getHelpText for ask mentions Microsoft 365 Copilot', () => {
    const text = getHelpText('ask');
    assert.ok(text.toLowerCase().includes('microsoft 365 copilot'));
  });

  test('/clear command routes to clear with empty query but is not isEmpty', () => {
    const result = parseCommand('/clear');
    assert.equal(result.target, 'clear');
    assert.equal(result.query, '');
    assert.equal(result.isEmpty, false);
  });

  test('/clear ignores trailing arguments but still executes', () => {
    const result = parseCommand('/clear everything now');
    assert.equal(result.target, 'clear');
    assert.equal(result.query, '');
    assert.equal(result.isEmpty, false);
  });

  test('getHelpText for clear describes the effect', () => {
    const text = getHelpText('clear');
    assert.ok(text.toLowerCase().includes('clear'));
    assert.ok(text.toLowerCase().includes('pinned'));
  });
});
