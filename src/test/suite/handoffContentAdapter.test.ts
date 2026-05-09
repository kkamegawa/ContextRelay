import { strict as assert } from 'assert';
import {
  extractWordprocessingText,
  inferDriveContentMode,
  normalizeDownloadedText
} from '../../adapters/handoffContentAdapter';

suite('Handoff content adapter', () => {
  test('detects docx files for full extraction', () => {
    assert.equal(
      inferDriveContentMode('LendHub_Requirements_Document_Fictional.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
      'docx'
    );
  });

  test('detects plain text files by extension', () => {
    assert.equal(inferDriveContentMode('notes.md', 'text/markdown'), 'plainText');
    assert.equal(inferDriveContentMode('data.json', 'application/json'), 'plainText');
  });

  test('extracts readable text from Wordprocessing XML', () => {
    const xml = [
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
      '<w:body>',
      '<w:p><w:r><w:t>Hello</w:t></w:r><w:r><w:t xml:space="preserve"> world</w:t></w:r></w:p>',
      '<w:p><w:r><w:t>Second paragraph</w:t></w:r><w:r><w:br/></w:r><w:r><w:t>Line 2</w:t></w:r></w:p>',
      '</w:body>',
      '</w:document>'
    ].join('');

    assert.equal(extractWordprocessingText(xml), 'Hello world\n\nSecond paragraph\nLine 2');
  });

  test('decodes entities once when extracting Wordprocessing XML text', () => {
    const xml = [
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
      '<w:body>',
      '<w:p><w:r><w:t>&amp;lt;script&amp;gt;alert(1)&amp;lt;/script&amp;gt;</w:t></w:r></w:p>',
      '<w:p><w:r><w:t>&#x1F642;</w:t></w:r></w:p>',
      '</w:body>',
      '</w:document>'
    ].join('');

    assert.equal(extractWordprocessingText(xml), '&lt;script&gt;alert(1)&lt;/script&gt;\n\n🙂');
  });

  test('normalizes downloaded text and strips BOM', () => {
    assert.equal(normalizeDownloadedText('\uFEFFline1\r\n\r\n\r\nline2\r'), 'line1\n\nline2');
  });
});
