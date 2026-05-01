import { strict as assert } from 'assert';
import { formatAssistantMessageAsHtml, hasRichTextFormatting } from '../../webview/assistantMessageFormatting';

suite('assistantMessageFormatting', () => {
  test('detects markdown-like formatting in Work IQ responses', () => {
    assert.equal(
      hasRichTextFormatting('## Microsoft 365\n\n- admin\n- [Docs](https://example.com/docs)'),
      true
    );
    assert.equal(hasRichTextFormatting('plain response text only'), false);
  });

  test('renders headings, lists, bold text, and links as safe html', () => {
    const html = formatAssistantMessageAsHtml(
      '## Microsoft 365\n\n- **admin** update\n- [品川](https://example.com/shinagawa)\n\n<script>alert(1)</script>'
    );

    assert.ok(html.includes('<h2>Microsoft 365</h2>'));
    assert.ok(html.includes('<li><strong>admin</strong> update</li>'));
    assert.ok(
      html.includes('<a href="https://example.com/shinagawa" target="_blank" rel="noopener noreferrer">品川</a>')
    );
    assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
    assert.ok(!html.includes('<script>'));
  });
});
