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
    const result = parseCommand('/unknown some query');
    assert.equal(result.target, 'all');
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

  test('getHelpText returns fallback for unknown command', () => {
    const text = getHelpText('unknown');
    assert.ok(text.length > 0);
  });
});
