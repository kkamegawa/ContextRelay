import { strict as assert } from 'assert';
import { buildSearchSnippet, escapeODataString, isOneDriveUrl, stripSearchMarkup } from '../../adapters/retrievalSearchUtils';

suite('Retrieval adapter', () => {
  test('escapes single quotes for OData search', () => {
    assert.equal(escapeODataString("O'Brien plan"), "O''Brien plan");
  });

  test('detects OneDrive personal site URLs', () => {
    assert.equal(
      isOneDriveUrl('https://contoso-my.sharepoint.com/personal/user_contoso_com/Documents/file.docx'),
      true
    );
    assert.equal(
      isOneDriveUrl('https://contoso.sharepoint.com/sites/engineering/Shared%20Documents/spec.docx'),
      false
    );
  });

  test('removes search highlight markup from summaries', () => {
    assert.equal(stripSearchMarkup('<c0>Project</c0> plan <ddd/> preview'), 'Project plan … preview');
  });

  test('prefers search summary for preview snippet', () => {
    assert.equal(
      buildSearchSnippet('<c0>Architecture</c0> review <ddd/> excerpt', undefined, 'https://contoso-my.sharepoint.com/personal/user/Documents/file.docx'),
      'Architecture review … excerpt'
    );
  });
});