import { strict as assert } from 'assert';
import { normalizeSafeExternalUrl } from '../../panel/safeExternalUrl';

suite('safeExternalUrl', () => {
  test('normalizes http and https URLs for external opening', () => {
    assert.equal(normalizeSafeExternalUrl(' https://example.com/path?q=1 '), 'https://example.com/path?q=1');
    assert.equal(normalizeSafeExternalUrl('http://example.com'), 'http://example.com/');
  });

  test('rejects unsafe or malformed external URLs', () => {
    assert.equal(normalizeSafeExternalUrl('javascript:alert(1)'), undefined);
    assert.equal(normalizeSafeExternalUrl('data:text/html;base64,PHNjcmlwdD4='), undefined);
    assert.equal(normalizeSafeExternalUrl('not a url'), undefined);
  });

  test('allows mailto only when the caller explicitly opts in', () => {
    assert.equal(normalizeSafeExternalUrl('mailto:security@example.com'), undefined);
    assert.equal(
      normalizeSafeExternalUrl('mailto:security@example.com', ['http:', 'https:', 'mailto:']),
      'mailto:security@example.com'
    );
  });
});
