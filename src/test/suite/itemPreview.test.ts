import { strict as assert } from 'assert';
import { ContextItem } from '../../models/contextItem';
import {
  createFallbackPreview,
  createMailPreview,
  getMailMessageId,
  normalizePreviewText
} from '../../panel/itemPreview';

function makeItem(overrides: Partial<ContextItem>): ContextItem {
  return {
    source: 'mail',
    title: 'Test item',
    snippet: 'Snippet text',
    cache: { hit: false },
    ...overrides
  };
}

suite('Item preview', () => {
  test('normalizes html into readable text', () => {
    const text = normalizePreviewText('<div>Hello&nbsp;<strong>world</strong><br>Line 2</div>', true);
    assert.equal(text, 'Hello world\nLine 2');
  });

  test('creates fallback preview from retrieval extracts', () => {
    const preview = createFallbackPreview(makeItem({
      source: 'sharepoint',
      snippet: '',
      raw: { extracts: ['First paragraph', 'Second paragraph'] }
    }));

    assert.equal(preview.source, 'sharepoint');
    assert.equal(preview.body, 'First paragraph\n\nSecond paragraph');
  });

  test('creates full mail preview from fetched body', () => {
    const item = makeItem({
      source: 'mail',
      raw: {
        messageId: 'abc123',
        senderName: 'Adele Vance',
        senderAddress: 'adele@example.com'
      }
    });

    const preview = createMailPreview(item, {
      body: {
        contentType: 'html',
        content: '<p>Hello team,</p><p>This is the full message.</p>'
      }
    });

    assert.equal(preview.subtitle, 'Adele Vance <adele@example.com>');
    assert.equal(preview.body, 'Hello team,\n\nThis is the full message.');
    assert.equal(getMailMessageId(item), 'abc123');
  });

  test('falls back to snippet when message body is unavailable', () => {
    const item = makeItem({ source: 'teams', snippet: 'Short summary from Teams' });
    const preview = createFallbackPreview(item);

    assert.equal(preview.body, 'Short summary from Teams');
  });
});