import { strict as assert } from 'assert';
import { ContextItem, getPreviewText } from '../../models/contextItem';
import { inferDrivePreviewMode, resolvePreview } from '../../panel/previewResolver';

function makeDriveItem(overrides: Partial<ContextItem> = {}): ContextItem {
  return {
    source: 'sharepoint',
    title: 'notes.md',
    snippet: 'Fallback snippet',
    cache: { hit: false },
    raw: {
      driveId: 'drive-1',
      id: 'item-1',
      mimeType: 'text/markdown',
      extracts: ['Fallback snippet']
    },
    ...overrides
  };
}

suite('Preview resolver', () => {
  test('detects markdown and image-convertible drive previews', () => {
    assert.equal(inferDrivePreviewMode('notes.md', 'text/markdown'), 'markdown');
    assert.equal(
      inferDrivePreviewMode(
        'deck.pptx',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation'
      ),
      'imageConvertible'
    );
  });

  test('renders markdown drive items as html previews', async () => {
    const originalFetch = globalThis.fetch;

    globalThis.fetch = (async () => new Response('# Title\n\n- First\n- Second', {
      status: 200,
      headers: { 'Content-Type': 'text/markdown' }
    })) as typeof fetch;

    try {
      const preview = await resolvePreview(makeDriveItem(), async () => 'token');

      assert.equal(preview.content.kind, 'html');
      assert.ok(preview.content.html.includes('<h1>Title</h1>'));
      assert.equal(getPreviewText(preview), 'Title\n\n• First\n\n• Second');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('falls back to plain text preview when image conversion fails', async () => {
    const originalFetch = globalThis.fetch;

    globalThis.fetch = (async () => new Response('conversion failed', {
      status: 500,
      headers: { 'Content-Type': 'text/plain' }
    })) as typeof fetch;

    try {
      const preview = await resolvePreview(makeDriveItem({
        title: 'deck.pptx',
        raw: {
          driveId: 'drive-1',
          id: 'item-1',
          mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          extracts: ['Slide summary']
        }
      }), async () => 'token');

      assert.equal(preview.content.kind, 'text');
      assert.equal(getPreviewText(preview), 'Slide summary');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
