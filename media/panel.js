// @ts-check
(function () {
  'use strict';

  const vscode = acquireVsCodeApi();

  // State
  let isSignedIn = false;

  // Elements
  const tabs = /** @type {NodeListOf<HTMLButtonElement>} */ (document.querySelectorAll('.tab'));
  const panels = /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('.tab-panel'));
  const searchInput = /** @type {HTMLInputElement} */ (document.getElementById('search-input'));
  const searchBtn = document.getElementById('search-btn');
  const searchStatus = document.getElementById('search-status');
  const searchResults = document.getElementById('search-results');
  const chatInput = /** @type {HTMLInputElement} */ (document.getElementById('chat-input'));
  const chatSendBtn = document.getElementById('chat-send-btn');
  const chatMessages = document.getElementById('chat-messages');
  const chatStatus = document.getElementById('chat-status');
  const newConversationBtn = document.getElementById('new-conversation-btn');
  const snippetsList = document.getElementById('snippets-list');
  const clearSnippetsBtn = document.getElementById('clear-snippets-btn');
  const clearCacheBtn = document.getElementById('clear-cache-btn');
  const generateDocsBtn = document.getElementById('generate-docs-btn');
  const copyPromptBtn = document.getElementById('copy-prompt-btn');
  const signInBtn = document.getElementById('sign-in-btn');
  const accountLabel = document.getElementById('account-label');

  // Tab switching
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;
      tabs.forEach(t => {
        t.classList.toggle('active', t.dataset.tab === target);
        t.setAttribute('aria-selected', t.dataset.tab === target ? 'true' : 'false');
      });
      panels.forEach(p => {
        const isActive = p.id === `panel-${target}`;
        p.classList.toggle('active', isActive);
        p.style.display = isActive ? '' : 'none';
      });
      if (target === 'snippets') {
        vscode.postMessage({ type: 'getSnippets' });
      }
    });
  });

  // Search
  function runSearch() {
    const query = searchInput.value.trim();
    if (!query) { return; }
    vscode.postMessage({ type: 'search', query });
  }

  searchBtn && searchBtn.addEventListener('click', runSearch);
  searchInput && searchInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { runSearch(); }
  });

  // Chat
  function sendChat() {
    const msg = chatInput.value.trim();
    if (!msg) { return; }
    addChatBubble('user', msg);
    chatInput.value = '';
    if (chatStatus) { chatStatus.textContent = ''; }
    vscode.postMessage({ type: 'chat', message: msg });
  }

  chatSendBtn && chatSendBtn.addEventListener('click', sendChat);
  chatInput && chatInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { sendChat(); }
  });

  newConversationBtn && newConversationBtn.addEventListener('click', () => {
    if (chatMessages) { chatMessages.innerHTML = ''; }
    vscode.postMessage({ type: 'newConversation' });
  });

  // Snippets / Settings
  clearSnippetsBtn && clearSnippetsBtn.addEventListener('click', () => {
    vscode.postMessage({ type: 'clearSnippets' });
  });

  clearCacheBtn && clearCacheBtn.addEventListener('click', () => {
    vscode.postMessage({ type: 'clearCache' });
  });

  generateDocsBtn && generateDocsBtn.addEventListener('click', () => {
    vscode.postMessage({ type: 'generateDocs' });
  });

  copyPromptBtn && copyPromptBtn.addEventListener('click', () => {
    vscode.postMessage({ type: 'copyPrompt' });
  });

  signInBtn && signInBtn.addEventListener('click', () => {
    vscode.postMessage({ type: 'signIn' });
  });

  // Message handling from extension
  window.addEventListener('message', event => {
    const message = event.data;
    handleMessage(message);
  });

  /**
   * @param {any} message
   */
  function handleMessage(message) {
    switch (message.type) {
      case 'authState':
        updateAuthState(message.signedIn, message.accountLabel);
        break;
      case 'authRequired':
        showAuthRequired(message.message);
        break;
      case 'searchStart':
        if (searchStatus) {
          searchStatus.innerHTML = '<span class="loading"></span>Searching...';
        }
        if (searchResults) { searchResults.innerHTML = ''; }
        break;
      case 'searchResults':
        renderSearchResults(message.results);
        break;
      case 'searchUpdate':
        updateSourceSection(message.source, message.items, message.badge);
        break;
      case 'help':
        if (searchResults) {
          searchResults.innerHTML = `<div class="help-text">${escapeHtml(message.text)}</div>`;
        }
        if (searchStatus) { searchStatus.textContent = ''; }
        break;
      case 'chatStart':
        if (chatStatus) { chatStatus.innerHTML = '<span class="loading"></span>Thinking...'; }
        break;
      case 'chatReply':
        addChatBubble('assistant', message.message);
        if (chatStatus) { chatStatus.textContent = ''; }
        break;
      case 'chatError':
        if (chatStatus) { chatStatus.textContent = `Error: ${message.message}`; }
        break;
      case 'conversationReset':
        if (chatMessages) { chatMessages.innerHTML = ''; }
        break;
      case 'snippets':
        renderSnippets(message.snippets);
        break;
      case 'snippetSaved':
        // Could show a toast, for now just update snippets if on tab
        break;
      case 'snippetsCleared':
        if (snippetsList) { snippetsList.innerHTML = '<div class="empty-state">No saved snippets.</div>'; }
        break;
      case 'cacheCleared':
        if (searchStatus) { searchStatus.textContent = 'Cache cleared.'; }
        break;
      case 'error':
        if (searchResults) {
          searchResults.innerHTML = `<div class="error-banner">${escapeHtml(message.message)}</div>`;
        }
        break;
      case 'setQuery':
        if (searchInput) {
          searchInput.value = message.query;
          runSearch();
        }
        break;
    }
  }

  /**
   * @param {boolean} signedIn
   * @param {string|null} label
   */
  function updateAuthState(signedIn, label) {
    isSignedIn = signedIn;
    if (accountLabel) {
      accountLabel.textContent = signedIn && label ? `Signed in: ${label}` : '';
    }
    if (signInBtn) {
      signInBtn.style.display = signedIn ? 'none' : '';
    }
  }

  /**
   * @param {string} message
   */
  function showAuthRequired(message) {
    if (searchResults) {
      searchResults.innerHTML = `
        <div class="auth-required">
          <p>${escapeHtml(message)}</p>
          <button class="btn-primary" onclick="document.getElementById('sign-in-btn').click()">Sign in</button>
        </div>`;
    }
    if (searchStatus) { searchStatus.textContent = ''; }
  }

  /**
   * @param {Array<{source:string, items:any[], error?:string, cached?:boolean}>} results
   */
  function renderSearchResults(results) {
    if (!searchResults) { return; }
    if (searchStatus) { searchStatus.textContent = ''; }

    if (!results || results.length === 0) {
      searchResults.innerHTML = '<div class="empty-state">No results found.</div>';
      return;
    }

    searchResults.innerHTML = '';
    for (const result of results) {
      if (result.error && result.items.length === 0) {
        const banner = document.createElement('div');
        banner.className = 'error-banner';
        banner.textContent = `${capitalizeSource(result.source)} search failed: ${result.error}`;
        searchResults.appendChild(banner);
        continue;
      }

      if (result.items.length === 0) { continue; }

      const section = buildSourceSection(result.source, result.items, result.cached ? 'Cached' : undefined);
      section.dataset.source = result.source;
      searchResults.appendChild(section);
    }

    if (!searchResults.hasChildNodes()) {
      searchResults.innerHTML = '<div class="empty-state">No results found.</div>';
    }
  }

  /**
   * @param {string} source
   * @param {any[]} items
   * @param {string} [badge]
   */
  function buildSourceSection(source, items, badge) {
    const section = document.createElement('div');
    section.className = 'source-section';

    const header = document.createElement('div');
    header.className = 'source-header';
    header.textContent = capitalizeSource(source);

    if (badge) {
      const badgeEl = document.createElement('span');
      badgeEl.className = `source-badge ${badge.toLowerCase().replace(/\s/g, '-') === 'cached' ? 'cached' : 'updated'}`;
      badgeEl.textContent = badge;
      header.appendChild(badgeEl);
    }

    section.appendChild(header);

    for (const item of items) {
      section.appendChild(buildResultItem(item));
    }

    return section;
  }

  /**
   * @param {string} source
   * @param {any[]} items
   * @param {string} badge
   */
  function updateSourceSection(source, items, badge) {
    if (!searchResults) { return; }
    const existing = searchResults.querySelector(`[data-source="${source}"]`);
    const newSection = buildSourceSection(source, items, badge);
    newSection.dataset.source = source;
    if (existing) {
      searchResults.replaceChild(newSection, existing);
    } else {
      searchResults.appendChild(newSection);
    }
  }

  /**
   * @param {any} item
   */
  function buildResultItem(item) {
    const el = document.createElement('div');
    el.className = 'result-item';

    const title = document.createElement('div');
    title.className = 'result-title';
    title.textContent = item.title || 'Untitled';
    el.appendChild(title);

    if (item.snippet) {
      const snippet = document.createElement('div');
      snippet.className = 'result-snippet';
      snippet.textContent = item.snippet;
      el.appendChild(snippet);
    }

    if (item.timestamp) {
      const meta = document.createElement('div');
      meta.className = 'result-meta';
      meta.textContent = new Date(item.timestamp).toLocaleString();
      el.appendChild(meta);
    }

    const actions = document.createElement('div');
    actions.className = 'result-actions';

    if (item.url) {
      const openBtn = document.createElement('button');
      openBtn.textContent = 'Open';
      openBtn.title = 'Open in browser';
      openBtn.addEventListener('click', () => {
        vscode.postMessage({ type: 'openUrl', url: item.url });
      });
      actions.appendChild(openBtn);
    }

    const pinBtn = document.createElement('button');
    pinBtn.textContent = 'Pin';
    pinBtn.title = 'Save as snippet';
    pinBtn.addEventListener('click', () => {
      vscode.postMessage({ type: 'pinSnippet', item });
    });
    actions.appendChild(pinBtn);

    const copyBtn = document.createElement('button');
    copyBtn.textContent = 'Copy';
    copyBtn.title = 'Copy as Markdown citation';
    copyBtn.addEventListener('click', () => {
      const md = buildMarkdownCitation(item);
      vscode.postMessage({ type: 'copyText', text: md });
    });
    actions.appendChild(copyBtn);

    el.appendChild(actions);
    return el;
  }

  /**
   * @param {any} item
   * @returns {string}
   */
  function buildMarkdownCitation(item) {
    const parts = [`**${item.title}** (${item.source})`];
    if (item.snippet) { parts.push(`> ${item.snippet}`); }
    if (item.url) { parts.push(`[Open](${item.url})`); }
    return parts.join('\n');
  }

  /**
   * @param {'user'|'assistant'} role
   * @param {string} text
   */
  function addChatBubble(role, text) {
    if (!chatMessages) { return; }
    const bubble = document.createElement('div');
    bubble.className = `chat-bubble ${role}`;
    bubble.textContent = text;
    chatMessages.appendChild(bubble);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  /**
   * @param {any[]} snippets
   */
  function renderSnippets(snippets) {
    if (!snippetsList) { return; }
    if (!snippets || snippets.length === 0) {
      snippetsList.innerHTML = '<div class="empty-state">No saved snippets.</div>';
      return;
    }

    snippetsList.innerHTML = '';
    for (const snippet of snippets) {
      const el = document.createElement('div');
      el.className = 'snippet-item';

      const title = document.createElement('div');
      title.className = 'snippet-title';
      title.textContent = snippet.name || snippet.item.title;
      el.appendChild(title);

      const meta = document.createElement('div');
      meta.className = 'snippet-meta';
      meta.textContent = `${capitalizeSource(snippet.item.source)} · ${new Date(snippet.savedAt).toLocaleString()}`;
      el.appendChild(meta);

      if (snippet.item.snippet) {
        const snip = document.createElement('div');
        snip.className = 'snippet-snippet';
        snip.textContent = snippet.item.snippet;
        el.appendChild(snip);
      }

      const actions = document.createElement('div');
      actions.className = 'result-actions';

      const removeBtn = document.createElement('button');
      removeBtn.textContent = 'Remove';
      removeBtn.addEventListener('click', () => {
        vscode.postMessage({ type: 'removeSnippet', id: snippet.id });
      });
      actions.appendChild(removeBtn);

      if (snippet.item.url) {
        const openBtn = document.createElement('button');
        openBtn.textContent = 'Open';
        openBtn.addEventListener('click', () => {
          vscode.postMessage({ type: 'openUrl', url: snippet.item.url });
        });
        actions.appendChild(openBtn);
      }

      el.appendChild(actions);
      snippetsList.appendChild(el);
    }
  }

  /**
   * @param {string} source
   * @returns {string}
   */
  function capitalizeSource(source) {
    const labels = {
      mail: 'Mail',
      teams: 'Teams',
      sharepoint: 'SharePoint',
      onedrive: 'OneDrive',
      connectors: 'Connectors'
    };
    return labels[source] || source.charAt(0).toUpperCase() + source.slice(1);
  }

  /**
   * @param {string} str
   * @returns {string}
   */
  function escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Initialize
  vscode.postMessage({ type: 'ready' });
}());
