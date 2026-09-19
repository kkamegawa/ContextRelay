import { strict as assert } from 'assert';
import { getContextItemKey } from '../../models/contextItem';
import { ChatRenderer } from '../../webview/chatRenderer';
import { createVsCodeApiStub, installDom, type DomEnvironment, type VsCodeApiStub } from './domTestUtils';

type ResultItem = Parameters<ChatRenderer['renderQueryResult']>[0][number];

const TIMESTAMP = '2026-09-14T03:04:05.000Z';
const ITEM_URL = 'https://example.invalid/sites/team/release-plan.docx';

function makeItem(overrides: Partial<ResultItem> = {}): ResultItem {
  return {
    source: 'sharepoint',
    title: 'Release plan',
    snippet: 'Ship the release on Friday.',
    url: ITEM_URL,
    cache: { hit: false },
    ...overrides
  };
}

suite('ChatRenderer', () => {
  let dom: DomEnvironment;
  let chatArea: HTMLElement;
  let vscodeApi: VsCodeApiStub;
  let renderer: ChatRenderer;

  setup(async () => {
    dom = await installDom();
    chatArea = dom.byId('chatArea');
    vscodeApi = createVsCodeApiStub();
    renderer = new ChatRenderer(chatArea, vscodeApi);
  });

  teardown(async () => {
    await dom.dispose();
  });

  function all(selector: string, root: ParentNode = chatArea): HTMLElement[] {
    return Array.from(root.querySelectorAll<HTMLElement>(selector));
  }

  function one(selector: string, root: ParentNode = chatArea): HTMLElement {
    const element = root.querySelector<HTMLElement>(selector);
    assert.ok(element, `${selector} should be rendered`);
    return element;
  }

  function buttonLabels(root: ParentNode): string[] {
    return all('button', root).map(button => button.textContent ?? '');
  }

  interface WelcomeSnapshot {
    heading: string;
    paragraphs: string[];
    fontSizes: string[];
    codes: string[];
  }

  function describeWelcome(welcome: HTMLElement): WelcomeSnapshot {
    const paragraphs = all('p', welcome);

    return {
      heading: one('h2', welcome).textContent ?? '',
      paragraphs: paragraphs.map(paragraph => paragraph.textContent ?? ''),
      fontSizes: paragraphs.map(paragraph => paragraph.style.fontSize),
      codes: all('code', welcome).map(code => code.textContent ?? '')
    };
  }

  suite('messages', () => {
    test('renders a user message as text and removes the welcome block', () => {
      assert.ok(dom.document.getElementById('welcome'), 'the panel starts with the welcome block');

      renderer.renderUserMessage('Hello <b>there</b>', TIMESTAMP);

      const message = one('.message.user');
      assert.equal(message.getAttribute('role'), 'article');
      assert.equal(message.firstElementChild?.textContent, 'Hello <b>there</b>');
      assert.equal(message.querySelector('b'), null);
      assert.ok(one('.timestamp', message).textContent);
      assert.equal(dom.document.getElementById('welcome'), null);
    });

    test('renders an info reply as plain text without actions or context', () => {
      renderer.renderAssistantMessage('Working on it', TIMESTAMP, 'info');

      const message = one('.message.assistant');
      const text = one('.message-text', message);
      assert.equal(text.textContent, 'Working on it');
      assert.equal(text.classList.contains('message-text-rich'), false);
      assert.equal(message.querySelector('.assistant-actions'), null);
      assert.equal(message.querySelector('.context-used'), null);
    });

    test('keeps markup in a plain reply as text', () => {
      renderer.renderAssistantMessage('<img src=x onerror=alert(1)>', TIMESTAMP);

      const text = one('.message.assistant .message-text');
      assert.equal(text.querySelector('img'), null);
      assert.equal(text.textContent, '<img src=x onerror=alert(1)>');
    });

    test('formats a rich reply and escapes embedded markup', () => {
      renderer.renderAssistantMessage('## Summary\n- **one** <img src=x>\n- two', TIMESTAMP, 'chat');

      const text = one('.message.assistant .message-text');
      assert.equal(text.classList.contains('message-text-rich'), true);
      assert.equal(one('h2', text).textContent, 'Summary');
      assert.equal(all('li', text).length, 2);
      assert.equal(one('strong', text).textContent, 'one');
      assert.equal(text.querySelector('img'), null);
      assert.ok(text.textContent?.includes('<img src=x>'));
    });

    for (const kind of ['chat', 'ask'] as const) {
      test(`adds Copy, Append, and Replace actions to ${kind} replies`, () => {
        renderer.renderAssistantMessage('Answer text', TIMESTAMP, kind);

        const actions = one('.message.assistant .assistant-actions');
        assert.deepEqual(buttonLabels(actions), ['Copy', 'Append', 'Replace']);

        all('button', actions).forEach(button => button.click());

        assert.deepEqual(vscodeApi.messages, [
          { command: 'applyAssistantResult', action: 'copy', text: 'Answer text' },
          { command: 'applyAssistantResult', action: 'append', text: 'Answer text' },
          { command: 'applyAssistantResult', action: 'replace', text: 'Answer text' }
        ]);
      });
    }

    test('lists the context used for a reply', () => {
      renderer.renderAssistantMessage('Answer', TIMESTAMP, 'chat', ['Pinned: Release plan', 'notes.md']);

      assert.equal(one('.message.assistant .context-used').textContent, 'Context: Pinned: Release plan, notes.md');
    });

    test('renders slash command help with each example as code', () => {
      renderer.renderSlashHelp('/mail', ['/mail budget', '/mail from:alex']);

      const help = one('.slash-help');
      assert.equal(one('strong', help).textContent, '/mail');
      assert.deepEqual(all('code', help).map(code => code.textContent), ['/mail budget', '/mail from:alex']);
    });
  });

  suite('streaming', () => {
    test('replaces the bubble text with each cumulative update and finalizes it in place', () => {
      renderer.beginAssistantStream('reply-1');

      const bubble = one('.message.assistant.streaming');
      assert.equal(bubble.getAttribute('aria-live'), 'polite');
      assert.equal(dom.document.getElementById('welcome'), null);

      renderer.updateAssistantStream('reply-1', 'Hel');
      renderer.updateAssistantStream('reply-1', 'Hello wor');
      assert.equal(one('.message-text', bubble).textContent, 'Hello wor');

      renderer.finalizeAssistantMessage('reply-1', 'Hello world', TIMESTAMP, 'chat', ['notes.md']);

      assert.deepEqual(all('.message.assistant'), [bubble]);
      assert.equal(bubble.classList.contains('streaming'), false);
      assert.equal(all('.message-text', bubble).length, 1);
      assert.equal(one('.message-text', bubble).textContent, 'Hello world');
      assert.equal(one('.context-used', bubble).textContent, 'Context: notes.md');
      assert.deepEqual(buttonLabels(one('.assistant-actions', bubble)), ['Copy', 'Append', 'Replace']);
      assert.ok(one('.timestamp', bubble).textContent);
    });

    test('formats rich text only when the reply is finalized', () => {
      renderer.beginAssistantStream('reply-1');
      renderer.updateAssistantStream('reply-1', '**bold**');

      const bubble = one('.message.assistant.streaming');
      assert.equal(one('.message-text', bubble).textContent, '**bold**');
      assert.equal(bubble.querySelector('strong'), null);

      renderer.finalizeAssistantMessage('reply-1', '**bold**', TIMESTAMP, 'chat');

      assert.equal(one('strong', bubble).textContent, 'bold');
    });

    test('ignores updates for an unknown stream', () => {
      renderer.updateAssistantStream('missing', 'text');

      assert.equal(all('.message').length, 0);
    });

    test('creates a bubble when a reply is finalized without a stream', () => {
      renderer.finalizeAssistantMessage('reply-2', 'Final answer', TIMESTAMP);

      const message = one('.message.assistant');
      assert.equal(message.classList.contains('streaming'), false);
      assert.equal(one('.message-text', message).textContent, 'Final answer');
      assert.equal(message.querySelector('.assistant-actions'), null);
      assert.equal(dom.document.getElementById('welcome'), null);
    });

    test('finalizes each stream independently', () => {
      renderer.beginAssistantStream('first');
      renderer.beginAssistantStream('second');

      renderer.finalizeAssistantMessage('second', 'Second answer', TIMESTAMP);

      const [first, second] = all('.message.assistant');
      assert.equal(first.classList.contains('streaming'), true);
      assert.equal(second.classList.contains('streaming'), false);

      renderer.updateAssistantStream('second', 'ignored after finalizing');
      assert.equal(one('.message-text', second).textContent, 'Second answer');
    });
  });

  suite('result cards', () => {
    test('renders one card per result under a source header', () => {
      renderer.renderQueryResult(
        [makeItem(), makeItem({ title: 'Notes', snippet: 'Meeting notes', url: undefined, cache: { hit: true } })],
        'sharepoint',
        'release',
        TIMESTAMP
      );

      const message = one('.message.assistant');
      assert.ok(one('.source-header', message).textContent?.includes('2 result(s)'));

      const cards = all('.result-card', message);
      assert.equal(cards.length, 2);
      assert.equal(one('.snippet', cards[0]).textContent, 'Ship the release on Friday.');
      assert.equal(cards[0].dataset.url, ITEM_URL);
      assert.deepEqual(all('.source-badge', cards[0]).map(badge => badge.textContent).includes('Cached'), false);
      assert.deepEqual(all('.source-badge', cards[1]).map(badge => badge.textContent).includes('Cached'), true);
    });

    test('uses the same item key as the extension host', () => {
      const items = [
        makeItem(),
        makeItem({ source: 'mail', url: undefined, timestamp: '2026-09-01T00:00:00Z' }),
        makeItem({ source: 'teams', url: undefined, snippet: 'Standup notes' })
      ];

      renderer.renderQueryResult(items, 'all', 'release', TIMESTAMP);

      assert.deepEqual(
        all('.result-card').map(card => card.dataset.itemKey),
        items.map(item => getContextItemKey(item as never))
      );
    });

    test('posts openLink, copySnippet, and pinSnippet from the card buttons', () => {
      const item = makeItem();
      renderer.renderQueryResult([item], 'sharepoint', 'release', TIMESTAMP);

      const card = one('.result-card');
      assert.equal(one('.action-open', card).title, 'Open in browser');
      one('.action-open', card).click();
      one('.action-copy', card).click();
      one('.action-pin', card).click();

      assert.deepEqual(vscodeApi.messages, [
        { command: 'openLink', url: ITEM_URL },
        { command: 'copySnippet', text: 'Ship the release on Friday.' },
        { command: 'pinSnippet', item }
      ]);
    });

    test('opens an internal preview for a planner task without a URL', () => {
      const item = makeItem({ source: 'planner', title: 'Prepare demo', url: undefined });
      renderer.renderQueryResult([item], 'planner', 'demo', TIMESTAMP);

      const openButton = one('.result-card .action-open');
      assert.equal(openButton.title, 'Open preview');
      openButton.click();

      assert.deepEqual(vscodeApi.messages, [{ command: 'openItem', item }]);
    });

    test('omits Open for a result that cannot be opened', () => {
      renderer.renderQueryResult([makeItem({ source: 'mail', url: undefined })], 'mail', 'release', TIMESTAMP);

      const card = one('.result-card');
      assert.equal(card.querySelector('.action-open'), null);
      assert.deepEqual(buttonLabels(card), ['Copy', 'Pin']);
    });
  });

  suite('pin state', () => {
    function assertPinned(card: HTMLElement, pinned: boolean): void {
      const pinButton = one('.action-pin', card);
      assert.equal(card.classList.contains('pinned'), pinned);
      assert.equal(one('.pin-indicator', card).style.display, pinned ? '' : 'none');
      assert.equal(pinButton.textContent, pinned ? 'Unpin' : 'Pin');
      assert.equal(pinButton.title, pinned ? 'Unpin snippet' : 'Pin snippet');
      assert.equal(pinButton.getAttribute('aria-pressed'), pinned ? 'true' : 'false');
    }

    test('updates rendered cards when the pinned items change', () => {
      const pinnedItem = makeItem();
      const otherItem = makeItem({ title: 'Budget', url: undefined, snippet: 'Budget draft' });
      renderer.renderQueryResult([pinnedItem, otherItem], 'sharepoint', 'release', TIMESTAMP);
      const [pinnedCard, otherCard] = all('.result-card');
      assertPinned(pinnedCard, false);

      renderer.setPinnedItems([getContextItemKey(pinnedItem as never)]);
      assertPinned(pinnedCard, true);
      assertPinned(otherCard, false);

      renderer.setPinnedItems([]);
      assertPinned(pinnedCard, false);
    });

    test('shows the pinned state on cards rendered after pinning', () => {
      const item = makeItem();
      renderer.setPinnedItems([getContextItemKey(item as never)]);

      renderer.renderQueryResult([item], 'sharepoint', 'release', TIMESTAMP);

      assertPinned(one('.result-card'), true);
    });
  });

  suite('status and reset', () => {
    test('shows and removes a loading indicator per source', () => {
      renderer.setLoading('mail', true);
      renderer.setLoading('copilot', true, 'Asking Microsoft 365 Copilot...', '🤖');

      const [mailLoading, copilotLoading] = all('.loading');
      assert.ok(mailLoading.getAttribute('aria-label')?.startsWith('Searching '));
      assert.equal(copilotLoading.getAttribute('aria-label'), 'Asking Microsoft 365 Copilot...');
      assert.ok(copilotLoading.textContent?.includes('🤖'));

      renderer.setLoading('mail', false);
      assert.deepEqual(all('.loading'), [copilotLoading]);

      renderer.setLoading('unknown', false);
      assert.deepEqual(all('.loading'), [copilotLoading]);
    });

    test('renders an error banner with the message as text', () => {
      renderer.renderError('teams', '<b>Access denied</b>', TIMESTAMP);

      const banner = one('.error-banner');
      assert.ok(banner.textContent?.includes(': <b>Access denied</b>'));
      assert.equal(banner.querySelector('b'), null);
      assert.ok(one('.timestamp', banner).textContent);
    });

    test('clear() removes every message and rebuilds the welcome block', () => {
      renderer.renderUserMessage('Hello', TIMESTAMP);
      renderer.setLoading('mail', true);

      renderer.clear();

      assert.equal(chatArea.children.length, 1);
      const welcome = one('#welcome');
      assert.equal(one('h2', welcome).textContent, 'ContextRelay');

      renderer.setLoading('mail', false);
      assert.equal(all('.loading').length, 0);

      renderer.renderUserMessage('Hello again', TIMESTAMP);
      assert.equal(dom.document.getElementById('welcome'), null);
    });

    test('clear() rebuilds the welcome block with the text shipped in the panel HTML', () => {
      const initial = describeWelcome(one('#welcome'));

      renderer.renderUserMessage('Hello', TIMESTAMP);
      renderer.clear();

      // The initial block is rendered by the extension host and the rebuilt one
      // by the webview; both read the same shared welcome text.
      assert.deepEqual(describeWelcome(one('#welcome')), initial);
    });

    test('the welcome block says pinned context is attached automatically', () => {
      const hints = describeWelcome(one('#welcome')).paragraphs.join(' ');

      assert.match(hints, /grounding context automatically/);
      assert.match(hints, /Use \/ask to require that context before sending\./);
    });
  });
});
