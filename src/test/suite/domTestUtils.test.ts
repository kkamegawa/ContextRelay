import { strict as assert } from 'assert';
import { PANEL_ELEMENT_IDS, installDom, loadPanelHtml } from './domTestUtils';

suite('domTestUtils', () => {
  test('loads the production panel markup with every panel element', async () => {
    const dom = await installDom();

    try {
      for (const id of PANEL_ELEMENT_IDS) {
        assert.ok(dom.document.getElementById(id), `#${id} should be present in the panel HTML`);
      }
      assert.equal(document, dom.document, 'the document global should point at the panel document');
    } finally {
      await dom.dispose();
    }
  });

  test('keeps the panel script disabled', async () => {
    const dom = await installDom();

    try {
      const settings = dom.window.happyDOM.settings;
      assert.equal(settings.enableJavaScriptEvaluation, false);
      assert.equal(settings.disableJavaScriptFileLoading, true);
      assert.ok(dom.document.querySelector('script[src]'), 'the panel script tag should still be parsed');
    } finally {
      await dom.dispose();
    }
  });

  test('restores the previous globals on dispose', async () => {
    const dom = await installDom();
    await dom.dispose();

    assert.equal(typeof (globalThis as Record<string, unknown>).document, 'undefined');
    assert.equal(typeof (globalThis as Record<string, unknown>).window, 'undefined');
    assert.equal(typeof (globalThis as Record<string, unknown>).requestAnimationFrame, 'undefined');
  });

  test('does not leave a provider loaded with the stubbed vscode API in the module cache', async () => {
    const providerPath = require.resolve('../../panel/chatViewProvider');
    const cachedProvider = require.cache[providerPath];
    delete require.cache[providerPath];

    try {
      const html = await loadPanelHtml();

      assert.ok(html.includes('id="chatArea"'), 'the provider should still render the panel HTML');
      assert.equal(require.cache[providerPath], undefined);
    } finally {
      if (cachedProvider) {
        require.cache[providerPath] = cachedProvider;
      }
    }
  });
});
