import { strict as assert } from 'assert';
import { decodeHtmlEntitiesOnce, extractWordprocessingText } from '../../textExtraction';

suite('Text extraction helpers', () => {
  test('decodes supported entities in a single pass', () => {
    assert.equal(
      decodeHtmlEntitiesOnce('&lt;tag&gt; &amp; &#39; &#x1F600;'),
      '<tag> & \' 😀'
    );
  });

  test('does not double decode nested entity sequences', () => {
    assert.equal(
      decodeHtmlEntitiesOnce('&amp;lt;script&amp;gt;notice&amp;lt;/script&amp;gt;'),
      '&lt;script&gt;notice&lt;/script&gt;'
    );
  });

  test('extracts Wordprocessing text runs without generic tag stripping', () => {
    const xml = [
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
      '<w:body>',
      '<w:p><w:r><w:t>Alpha</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>Beta</w:t></w:r></w:p>',
      '<w:p><w:r><w:instrText>&lt;literal&gt;</w:instrText></w:r><w:r><w:br/></w:r><w:r><w:t>Gamma</w:t></w:r></w:p>',
      '</w:body>',
      '</w:document>'
    ].join('');

    assert.equal(extractWordprocessingText(xml), 'Alpha\tBeta\n\n<literal>\nGamma');
  });
});
