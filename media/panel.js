// @ts-check
(function () {
  'use strict';

  const vscode = acquireVsCodeApi();

  let isSignedIn = false;

  const tabs = /** @type {NodeListOf<HTMLButtonElement>} */ (document.querySelectorAll('.tab'));
  const panels = /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('.tab-panel'));
  const searchInput = /** @type {HTMLTextAreaElement} */ (document.getElementById('search-input'));
  const searchBtn = document.getElementById('search-btn');
  const searchStatus = document.getElementById('search-status');
  const searchResults = document.getElementById('search-results');
  const searchResultsView = document.getElementById('search-results-view');
  const searchPreviewView = document.getElementById('search-preview-view');
  const searchActiveQuery = document.getElementById('search-active-query');
  const searchQueryText = document.getElementById('search-query-text');
  const searchResultsCount = document.getElementById('search-results-count');
  const previewContent = document.getElementById('preview-content');
  const previewBackBtn = document.getElementById('preview-back-btn');
  const previewSourceBadge = document.getElementById('preview-source-badge');
  const previewSaveSelectionBtn = document.getElementById('preview-save-selection-btn');
  const previewSavePreviewBtn = document.getElementById('preview-save-preview-btn');
  const previewReviewHandoffBtn = document.getElementById('preview-review-handoff-btn');
  const previewSelectionStatus = document.getElementById('preview-selection-status');
  const chatInput = /** @type {HTMLTextAreaElement} */ (document.getElementById('chat-input'));
  const chatSendBtn = document.getElementById('chat-send-btn');
  const chatMessages = document.getElementById('chat-messages');
  const chatStatus = document.getElementById('chat-status');
  const newConversationBtn = document.getElementById('new-conversation-btn');
  const snippetsList = document.getElementById('snippets-list');
  const handoffCount = document.getElementById('handoff-count');
  const clearSnippetsBtn = document.getElementById('clear-snippets-btn');
  const generateDocsFromHandoffBtn = document.getElementById('generate-docs-from-handoff-btn');
  const openHandoffBtn = document.getElementById('open-handoff-btn');
  const openCopilotBtn = document.getElementById('open-copilot-btn');
  const copyPromptSecondaryBtn = document.getElementById('copy-prompt-secondary-btn');
  const clearCacheBtn = document.getElementById('clear-cache-btn');
  const generateDocsBtn = document.getElementById('generate-docs-btn');
  const copyPromptBtn = document.getElementById('copy-prompt-btn');
  const signInBtn = document.getElementById('sign-in-btn');
  const accountLabel = document.getElementById('account-label');
  const suggestionChips = /** @type {NodeListOf<HTMLButtonElement>} */ (document.querySelectorAll('.suggestion-chip'));
  let selectedItemKey = null;
  let latestSearchQuery = '';
  let currentPreviewItem = null;
  let currentPreview = null;

  function activateTab(target) {
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
  }

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;
      if (target) {
        activateTab(target);
      }
    });
  });

  function runSearch() {
    const query = searchInput.value.trim();
    if (!query) { return; }
    activateTab('search');
    vscode.postMessage({ type: 'search', query });
  }

  searchBtn && searchBtn.addEventListener('click', runSearch);
  searchInput && searchInput.addEventListener('input', () => {
    autosizeTextarea(searchInput);
  });
  searchInput && searchInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      runSearch();
    }
  });

  function sendChat() {
    const msg = chatInput.value.trim();
    if (!msg) { return; }
    addChatBubble('user', msg);
    chatInput.value = '';
    autosizeTextarea(chatInput);
    if (chatStatus) { chatStatus.textContent = ''; }
    vscode.postMessage({ type: 'chat', message: msg });
  }

  chatSendBtn && chatSendBtn.addEventListener('click', sendChat);
  chatInput && chatInput.addEventListener('input', () => {
    autosizeTextarea(chatInput);
  });
  chatInput && chatInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendChat();
    }
  });

  newConversationBtn && newConversationBtn.addEventListener('click', () => {
    if (chatMessages) { chatMessages.innerHTML = ''; }
    vscode.postMessage({ type: 'newConversation' });
  });

  clearSnippetsBtn && clearSnippetsBtn.addEventListener('click', () => {
    vscode.postMessage({ type: 'clearSnippets' });
  });

  clearCacheBtn && clearCacheBtn.addEventListener('click', () => {
    vscode.postMessage({ type: 'clearCache' });
  });

  generateDocsBtn && generateDocsBtn.addEventListener('click', () => {
    vscode.postMessage({ type: 'generateDocs' });
  });

  generateDocsFromHandoffBtn && generateDocsFromHandoffBtn.addEventListener('click', () => {
    vscode.postMessage({ type: 'generateDocs' });
  });

  copyPromptBtn && copyPromptBtn.addEventListener('click', () => {
    vscode.postMessage({ type: 'copyPrompt' });
  });

  copyPromptSecondaryBtn && copyPromptSecondaryBtn.addEventListener('click', () => {
    vscode.postMessage({ type: 'copyPrompt' });
  });

  openHandoffBtn && openHandoffBtn.addEventListener('click', () => {
    vscode.postMessage({ type: 'openHandoffDoc' });
  });

  openCopilotBtn && openCopilotBtn.addEventListener('click', () => {
    vscode.postMessage({ type: 'openCopilotChat' });
  });

  signInBtn && signInBtn.addEventListener('click', () => {
    vscode.postMessage({ type: 'signIn' });
  });

  previewBackBtn && previewBackBtn.addEventListener('click', () => {
    clearPreviewSelection(true);
  });

  previewSaveSelectionBtn && previewSaveSelectionBtn.addEventListener('click', () => {
    savePreviewToHandoff(true);
  });

  previewSavePreviewBtn && previewSavePreviewBtn.addEventListener('click', () => {
    savePreviewToHandoff(false);
  });

  previewReviewHandoffBtn && previewReviewHandoffBtn.addEventListener('click', () => {
    activateTab('snippets');
  });

  suggestionChips.forEach(chip => {
    chip.addEventListener('click', () => {
      const query = chip.dataset.query;
      if (!query || !searchInput) {
        return;
      }

      searchInput.value = query;
      autosizeTextarea(searchInput);
      searchInput.focus();
      runSearch();
    });
  });

  window.addEventListener('message', event => {
    const message = event.data;
    handleMessage(message);
  });

  document.addEventListener('selectionchange', () => {
    updatePreviewSelectionStatus();
  });

  /**
   * @param {any} message
   */
  function handleMessage(message) {
    switch (message.type) {
      case 'authState':
        updateAuthState(message.signedIn, message.accountLabel);
        break;
      case 'uiState':
        updateUiState(message);
        break;
      case 'authRequired':
        showAuthRequired(message.message);
        break;
      case 'searchStart':
        setSearchQuery(message.query);
        setSearchResultsCountLabel('Searching…');
        if (searchStatus) {
          searchStatus.innerHTML = '<span class="loading"></span>Searching...';
        }
        renderSearchLoadingState();
        clearPreviewSelection(true);
        break;
      case 'searchResults':
        renderSearchResults(message.results);
        break;
      case 'searchUpdate':
        updateSourceSection(message.source, message.items, message.badge);
        break;
      case 'previewStart':
        renderPreviewLoading(message.item);
        break;
      case 'previewContent':
        renderPreview(message.preview);
        break;
      case 'previewError':
        renderPreviewError(message.message);
        break;
      case 'help':
        if (searchResults) {
          searchResults.innerHTML = `<div class="help-text">${escapeHtml(message.text)}</div>`;
        }
        if (searchStatus) { searchStatus.textContent = ''; }
        setSearchResultsCountLabel('Tips');
        clearPreviewSelection(true);
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
        setPreviewSelectionStatus('Handoff に追加しました。');
        break;
      case 'snippetsCleared':
        updateHandoffCount(0);
        if (snippetsList) { snippetsList.innerHTML = '<div class="empty-state">まだ handoff 用の抜粋はありません。検索結果を開いて本文を選択してください。</div>'; }
        break;
      case 'cacheCleared':
        if (searchStatus) { searchStatus.textContent = 'Cache cleared.'; }
        break;
      case 'error':
        if (searchResults) {
          searchResults.innerHTML = `<div class="error-banner">${escapeHtml(message.message)}</div>`;
        }
        setSearchResultsCountLabel('Error');
        clearPreviewSelection(true);
        break;
      case 'setQuery':
        activateTab('search');
        if (searchInput) {
          searchInput.value = message.query;
          autosizeTextarea(searchInput);
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
      searchResults.innerHTML = '';
      const container = document.createElement('div');
      container.className = 'auth-required';

      const text = document.createElement('p');
      text.textContent = message;
      container.appendChild(text);

      const button = document.createElement('button');
      button.className = 'btn-primary';
      button.textContent = 'Sign in';
      button.addEventListener('click', () => {
        vscode.postMessage({ type: 'signIn' });
      });
      container.appendChild(button);

      searchResults.appendChild(container);
    }
    if (searchStatus) { searchStatus.textContent = ''; }
    setSearchResultsCountLabel('Sign in');
    clearPreviewSelection(true);
  }

  /**
   * @param {{ chatEnabled?: boolean }} state
   */
  function updateUiState(state) {
    const chatTab = document.getElementById('tab-chat');
    const chatPanel = document.getElementById('panel-chat');
    const chatEnabled = state.chatEnabled !== false;

    if (chatTab) {
      chatTab.style.display = chatEnabled ? '' : 'none';
      chatTab.setAttribute('aria-hidden', chatEnabled ? 'false' : 'true');
    }

    if (chatPanel) {
      chatPanel.style.display = chatEnabled && chatPanel.classList.contains('active') ? '' : 'none';
    }

    if (!chatEnabled) {
      const isChatActive = chatPanel && chatPanel.classList.contains('active');
      if (isChatActive) {
        activateTab('search');
      }
    }
  }

  /**
   * @param {Array<{source:string, items:any[], error?:string, cached?:boolean}>} results
   */
  function renderSearchResults(results) {
    if (!searchResults) { return; }
    if (searchStatus) { searchStatus.textContent = ''; }

    if (!results || results.length === 0) {
      searchResults.innerHTML = '<div class="empty-state">No results found.</div>';
      setSearchResultsCountLabel(formatResultCount(0));
      clearPreviewSelection(true);
      return;
    }

    const allItems = [];
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

      for (const item of result.items) {
        allItems.push(item);
      }

      const section = buildSourceSection(result.source, result.items, result.cached ? 'Cached' : undefined);
      section.dataset.source = result.source;
      searchResults.appendChild(section);
    }

    if (!searchResults.hasChildNodes()) {
      searchResults.innerHTML = '<div class="empty-state">No results found.</div>';
      setSearchResultsCountLabel(formatResultCount(0));
      clearPreviewSelection(true);
      return;
    }

    setSearchResultsCountLabel(formatResultCount(allItems.length));

    const firstItem = allItems[0];
    if (firstItem) {
      const nextKey = findMatchingItemKey(allItems);
      if (nextKey) {
        setSelectedItemKey(nextKey);
        const nextItem = allItems.find(item => getItemKey(item) === nextKey);
        if (nextItem) {
          vscode.postMessage({ type: 'previewItem', item: nextItem });
        }
      }
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

    const title = document.createElement('span');
    title.className = 'source-title';
    title.textContent = capitalizeSource(source);
    header.appendChild(title);

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
    setSearchResultsCountLabel(formatResultCount(getRenderedResultCount()));
    updateSelectedResultHighlight();
  }

  /**
   * @param {any} item
   */
  function buildResultItem(item) {
    const el = document.createElement('div');
    el.className = 'result-item';
    el.tabIndex = 0;
    el.setAttribute('role', 'button');
    el.setAttribute('aria-label', `Preview ${item.title || 'item'}`);
    const itemKey = getItemKey(item);
    el.dataset.itemKey = itemKey;
    if (selectedItemKey === itemKey) {
      el.classList.add('active');
    }

    const requestPreview = () => {
      setSelectedItemKey(itemKey);
      vscode.postMessage({ type: 'previewItem', item });
    };

    el.addEventListener('click', () => {
      requestPreview();
    });
    el.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        requestPreview();
      }
    });

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
      openBtn.addEventListener('click', event => {
        event.stopPropagation();
        vscode.postMessage({ type: 'openUrl', url: item.url });
      });
      actions.appendChild(openBtn);
    }

    const pinBtn = document.createElement('button');
    pinBtn.textContent = 'Pin full';
    pinBtn.title = 'Fetch full content for handoff';
    pinBtn.addEventListener('click', event => {
      event.stopPropagation();
      vscode.postMessage({ type: 'pinSnippet', item });
    });
    actions.appendChild(pinBtn);

    const copyBtn = document.createElement('button');
    copyBtn.textContent = 'Copy';
    copyBtn.title = 'Copy as Markdown citation';
    copyBtn.addEventListener('click', event => {
      event.stopPropagation();
      const md = buildMarkdownCitation(item);
      vscode.postMessage({ type: 'copyText', text: md });
    });
    actions.appendChild(copyBtn);

    el.appendChild(actions);
    return el;
  }

  /**
   * @param {any} item
   */
  function renderPreviewLoading(item) {
    currentPreviewItem = item || null;
    currentPreview = null;
    showPreviewView(item && item.source ? capitalizeSource(item.source) : 'Preview');
    if (!previewContent) { return; }
    previewContent.innerHTML = '<div class="preview-empty"><span class="loading"></span>Loading preview...</div>';
    searchPreviewView && searchPreviewView.classList.add('has-preview');
    setPreviewSelectionStatus('');
    updatePreviewActionState();
  }

  /**
   * @param {any} preview
   */
  function renderPreview(preview) {
    currentPreview = preview || null;
    showPreviewView(preview && preview.source ? capitalizeSource(preview.source) : 'Preview');
    if (!previewContent) { return; }
    searchPreviewView && searchPreviewView.classList.add('has-preview');

    previewContent.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'preview-header';

    const title = document.createElement('div');
    title.className = 'preview-title';
    title.textContent = preview.title || 'Untitled';
    header.appendChild(title);

    if (preview.subtitle) {
      const subtitle = document.createElement('div');
      subtitle.className = 'preview-subtitle';
      subtitle.textContent = preview.subtitle;
      header.appendChild(subtitle);
    }

    const metaParts = [];
    if (preview.timestamp) {
      metaParts.push(new Date(preview.timestamp).toLocaleString());
    }
    if (typeof preview.relevance === 'number') {
      metaParts.push(`Relevance: ${preview.relevance.toFixed(2)}`);
    }
    if (metaParts.length > 0) {
      const meta = document.createElement('div');
      meta.className = 'preview-meta';
      meta.textContent = metaParts.join(' · ');
      header.appendChild(meta);
    }

    previewContent.appendChild(header);

    const body = document.createElement('div');
    body.className = 'preview-body';

    const previewText = getPreviewText(preview) || 'No preview text is available for this item yet.';
    const contentKind = getPreviewContentKind(preview);
    if (contentKind === 'html' && preview.content && typeof preview.content.html === 'string') {
      body.classList.add('preview-body-html');
      body.innerHTML = sanitizeHtmlContent(preview.content.html);
    } else if (contentKind === 'image' && preview.content && typeof preview.content.src === 'string') {
      body.classList.add('preview-body-image');

      const image = document.createElement('img');
      image.className = 'preview-image';
      if (isValidImageUrl(preview.content.src)) {
        image.src = preview.content.src;
      }
      image.alt = preview.content.alt || `${preview.title || 'Preview'} image`;
      body.appendChild(image);

      if (previewText) {
        const caption = document.createElement('div');
        caption.className = 'preview-image-caption';
        caption.textContent = previewText;
        body.appendChild(caption);
      }
    } else {
      body.textContent = previewText;
    }

    previewContent.appendChild(body);

    if (preview.url) {
      const actions = document.createElement('div');
      actions.className = 'result-actions';

      const openBtn = document.createElement('button');
      openBtn.textContent = 'Open in browser';
      openBtn.addEventListener('click', () => {
        vscode.postMessage({ type: 'openUrl', url: preview.url });
      });
      actions.appendChild(openBtn);

      previewContent.appendChild(actions);
    }

    if (contentKind === 'image') {
      setPreviewSelectionStatus('Add preview で全文保存できます。画像プレビューでは本文選択はできません。');
    } else {
      setPreviewSelectionStatus('本文を選択して Add selection、または Add preview で全文保存できます。');
    }
    updatePreviewActionState();
  }

  /**
   * @param {string} message
   */
  function renderPreviewError(message) {
    currentPreview = null;
    showPreviewView('Preview');
    if (!previewContent) { return; }
    previewContent.innerHTML = `<div class="error-banner">${escapeHtml(message)}</div>`;
    searchPreviewView && searchPreviewView.classList.add('has-preview');
    setPreviewSelectionStatus('');
    updatePreviewActionState();
  }

  /**
   * @param {string} [label]
   */
  function showPreviewView(label) {
    if (previewSourceBadge) {
      previewSourceBadge.textContent = label || 'Preview';
    }
  }

  function clearPreviewSelection(showPlaceholder = false) {
    selectedItemKey = null;
    currentPreviewItem = null;
    currentPreview = null;
    updateSelectedResultHighlight();
    if (showPlaceholder) {
      renderPreviewPlaceholder();
    }
  }

  function renderPreviewPlaceholder() {
    showPreviewView('Preview');
    if (!previewContent) { return; }
    previewContent.innerHTML = '<div class="preview-empty">検索結果を選ぶと、ここに本文・メタデータ・リンクを表示します。</div>';
    searchPreviewView && searchPreviewView.classList.remove('has-preview');
    setPreviewSelectionStatus('');
    updatePreviewActionState();
  }

  function renderSearchLoadingState() {
    if (!searchResults) { return; }
    searchResults.innerHTML = '<div class="empty-state"><span class="loading"></span>Searching your Microsoft 365 context...</div>';
  }

  function renderSearchWelcome() {
    if (!searchResults) { return; }
    searchResults.innerHTML = [
      '<div class="search-hero">',
      '<div class="search-hero-title">Search your Microsoft 365 context</div>',
      '<div class="search-hero-copy">下の入力欄から自然文で検索すると、ここにソース別の結果が並びます。結果をクリックすると、その詳細を下段のプレビューで確認できます。</div>',
      '</div>'
    ].join('');
  }

  /**
   * @param {HTMLTextAreaElement | null} textarea
   */
  function autosizeTextarea(textarea) {
    if (!textarea) { return; }
    textarea.style.height = '0px';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 180)}px`;
  }

  function setSelectedItemKey(itemKey) {
    selectedItemKey = itemKey;
    updateSelectedResultHighlight();
  }

  function updateSelectedResultHighlight() {
    if (!searchResults) { return; }
    const items = searchResults.querySelectorAll('.result-item');
    items.forEach(itemEl => {
      itemEl.classList.toggle('active', itemEl.dataset.itemKey === selectedItemKey);
    });
  }

  function findMatchingItemKey(items) {
    if (selectedItemKey && items.some(item => getItemKey(item) === selectedItemKey)) {
      return selectedItemKey;
    }

    const firstItem = items[0];
    return firstItem ? getItemKey(firstItem) : null;
  }

  function getItemKey(item) {
    const raw = item && typeof item.raw === 'object' && item.raw ? item.raw : undefined;
    const messageId = raw && raw.messageId ? raw.messageId : '';
    return [item.source, messageId, item.url || '', item.timestamp || '', item.title || ''].join('::');
  }

  function setSearchQuery(query) {
    latestSearchQuery = typeof query === 'string' ? query.trim() : latestSearchQuery;
    if (searchQueryText) {
      searchQueryText.textContent = latestSearchQuery;
    }
    if (searchActiveQuery) {
      const hasQuery = latestSearchQuery.length > 0;
      searchActiveQuery.hidden = !hasQuery;
      searchActiveQuery.setAttribute('aria-hidden', hasQuery ? 'false' : 'true');
    }
  }

  function setSearchResultsCountLabel(label) {
    if (searchResultsCount) {
      searchResultsCount.textContent = label;
    }
  }

  function getRenderedResultCount() {
    if (!searchResults) {
      return 0;
    }

    return searchResults.querySelectorAll('.result-item').length;
  }

  function formatResultCount(count) {
    return `${count} ${count === 1 ? 'item' : 'items'}`;
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
    updateHandoffCount(Array.isArray(snippets) ? snippets.length : 0);
    if (!snippets || snippets.length === 0) {
      snippetsList.innerHTML = '<div class="empty-state">まだ handoff 用の抜粋はありません。検索結果を開いて本文を選択してください。</div>';
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

  /**
   * Sanitize HTML by removing script tags and dangerous attributes.
   * @param {string} html
   * @returns {string}
   */
  function sanitizeHtmlContent(html) {
    if (!html || typeof html !== 'string') {
      return '';
    }

    const temp = document.createElement('div');
    temp.innerHTML = html;

    const dangerous = ['script', 'iframe', 'object', 'embed', 'form', 'input', 'button'];
    dangerous.forEach(tag => {
      const elements = temp.querySelectorAll(tag);
      elements.forEach(el => el.remove());
    });

    const allElements = temp.querySelectorAll('*');
    allElements.forEach(el => {
      const dangerousAttrs = Array.from(el.attributes || [])
        .filter(attr => attr.name.toLowerCase().startsWith('on'));
      dangerousAttrs.forEach(attr => el.removeAttribute(attr.name));
    });

    return temp.innerHTML;
  }

  /**
   * Validate that an image URL is safe to use.
   * @param {string} url
   * @returns {boolean}
   */
  function isValidImageUrl(url) {
    if (!url || typeof url !== 'string') {
      return false;
    }

    try {
      const parsed = new URL(url, window.location.href);
      const protocol = parsed.protocol;
      if (protocol === 'http:' || protocol === 'https:') {
        return true;
      }

      if (protocol === 'data:') {
        return url.startsWith('data:image/');
      }

      return false;
    } catch {
      return false;
    }
  }

  function savePreviewToHandoff(selectionOnly) {
    const previewBody = getPreviewText(currentPreview);
    if (!currentPreviewItem || !currentPreview || !previewBody) {
      setPreviewSelectionStatus('保存できる preview がありません。先に検索結果を選択してください。');
      return;
    }

    const selectedText = selectionOnly ? getSelectedPreviewText() : '';
    if (selectionOnly && !selectedText) {
      setPreviewSelectionStatus('preview 本文をドラッグ選択してから Add selection を押してください。');
      return;
    }

    vscode.postMessage({
      type: 'savePreviewSnippet',
      item: currentPreviewItem,
      selectedText,
      previewBody
    });
  }

  function getSelectedPreviewText() {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || !previewContent) {
      return '';
    }

    const range = selection.getRangeAt(0);
    const ancestor = range.commonAncestorContainer;
    const container = ancestor.nodeType === Node.TEXT_NODE ? ancestor.parentElement : ancestor;
    if (!(container instanceof Element) || !previewContent.contains(container)) {
      return '';
    }

    return selection.toString().trim();
  }

  function updatePreviewActionState() {
    const hasPreview = !!(currentPreviewItem && currentPreview && getPreviewText(currentPreview));
    const hasSelectablePreview = hasPreview && getPreviewContentKind(currentPreview) !== 'image';
    if (previewSaveSelectionBtn) {
      previewSaveSelectionBtn.disabled = !hasSelectablePreview;
    }
    if (previewSavePreviewBtn) {
      previewSavePreviewBtn.disabled = !hasPreview;
    }
    if (previewReviewHandoffBtn) {
      previewReviewHandoffBtn.disabled = false;
    }
  }

  function updatePreviewSelectionStatus() {
    if (!currentPreview || !getPreviewText(currentPreview) || getPreviewContentKind(currentPreview) === 'image') {
      return;
    }

    const selectedText = getSelectedPreviewText();
    if (selectedText) {
      setPreviewSelectionStatus(`選択中: ${selectedText.length} 文字`);
    }
  }

  function setPreviewSelectionStatus(text) {
    if (previewSelectionStatus) {
      previewSelectionStatus.textContent = text;
    }
  }

  function getPreviewText(preview) {
    return preview && preview.content && typeof preview.content.text === 'string'
      ? preview.content.text.trim()
      : '';
  }

  function getPreviewContentKind(preview) {
    return preview && preview.content && typeof preview.content.kind === 'string'
      ? preview.content.kind
      : 'text';
  }

  function updateHandoffCount(count) {
    if (handoffCount) {
      handoffCount.textContent = String(count);
    }
  }

  autosizeTextarea(searchInput);
  autosizeTextarea(chatInput);
  setSearchResultsCountLabel('Ready');
  updateHandoffCount(0);
  renderSearchWelcome();
  renderPreviewPlaceholder();
  vscode.postMessage({ type: 'ready' });
}());
