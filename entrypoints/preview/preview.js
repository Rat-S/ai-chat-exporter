import { MarkdownFormatter } from '../../content/formatters/markdown.js';
import { JsonFormatter } from '../../content/formatters/json.js';
import { HtmlFormatter } from '../../content/formatters/html.js';
import { DocFormatter } from '../../content/formatters/doc.js';
import { ImageFormatter } from '../../content/formatters/image.js';
import {
  ContinuationFormatter,
  stripEncodedImages,
} from '../../content/formatters/continuation.js';
import { sanitizeHtml } from '../../content/utils/sanitizer.js';
import { initI18n, applyI18n, t } from '../../content/utils/i18n.js';
import {
  formatFilename,
  resolveConversationTitle,
  DEFAULT_FILENAME_TEMPLATE,
} from '../../content/utils/filename.js';
import renderMathInElement from 'katex/dist/contrib/auto-render.mjs';
import Prism from '../../content/lib/prismjs/prism-bundle.js';

function injectPreviewStyles(doc) {
  if (!doc || !doc.head) return;
  if (!doc.getElementById('katex-preview-style')) {
    const linkKaTeX = doc.createElement('link');
    linkKaTeX.id = 'katex-preview-style';
    linkKaTeX.rel = 'stylesheet';
    linkKaTeX.href = chrome.runtime.getURL('content/lib/katex/katex.min.css');
    doc.head.appendChild(linkKaTeX);
  }
  if (!doc.getElementById('prism-preview-style')) {
    const linkPrism = doc.createElement('link');
    linkPrism.id = 'prism-preview-style';
    linkPrism.rel = 'stylesheet';
    linkPrism.href = chrome.runtime.getURL('content/lib/prismjs/prism-tomorrow.min.css');
    doc.head.appendChild(linkPrism);
  }
}

function applyTheme(theme, targetDoc = document) {
  if (!targetDoc || !targetDoc.documentElement) return;
  if (theme && theme !== 'system') {
    targetDoc.documentElement.setAttribute('data-theme', theme);
  } else {
    targetDoc.documentElement.removeAttribute('data-theme');
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  if (window.self !== window.top) {
    document.documentElement.classList.add('in-iframe');
  }

  await initI18n();
  applyI18n();

  const titleEl = document.getElementById('preview-title');
  const filenameInput = document.getElementById('preview-filename-input');
  const codeEl = document.getElementById('preview-code');
  const copyBtn = document.getElementById('copy-btn');
  const downloadBtn = document.getElementById('download-btn');
  const printBtn = document.getElementById('print-btn');
  const formatTabsContainer = document.getElementById('format-tabs');

  const pngWarningBanner = document.getElementById('png-warning-banner');
  const pngOptionsBar = document.getElementById('png-options-bar');
  const pngQualityCheckbox = document.getElementById('png-quality-checkbox');
  const includeImagesCheckbox = document.getElementById('include-images-checkbox');

  if (pngQualityCheckbox) {
    pngQualityCheckbox.addEventListener('change', () => {
      cachedPngBlob = null;
    });
  }
  if (includeImagesCheckbox) {
    includeImagesCheckbox.addEventListener('change', () => {
      cachedPngBlob = null;
    });
  }

  const codeWrapper = document.getElementById('code-wrapper');
  const renderWrapper = document.getElementById('render-wrapper');
  const previewRendered = document.getElementById('preview-rendered');

  const markdownFormatter = new MarkdownFormatter();
  const jsonFormatter = new JsonFormatter();
  const htmlFormatter = new HtmlFormatter();
  const docFormatter = new DocFormatter();
  const imageFormatter = new ImageFormatter();
  const continuationFormatter = new ContinuationFormatter();

  const transferBtn = document.getElementById('transfer-btn');
  const transferTargetSelect = document.getElementById('transfer-target-select');

  let currentSyncTheme = 'system';
  try {
    const syncData = await chrome.storage.sync.get('theme');
    currentSyncTheme = syncData.theme || 'system';
    applyTheme(currentSyncTheme, document);
  } catch {
    // Ignore theme loading errors when running standalone
  }

  const previewThemeSelect = document.getElementById('preview-theme-select');
  if (previewThemeSelect) {
    previewThemeSelect.value = currentSyncTheme || 'system';
    previewThemeSelect.addEventListener('change', () => {
      const selected = previewThemeSelect.value;
      currentSyncTheme = selected;
      chrome.storage.sync.set({ theme: selected });
      applyTheme(selected, document);
      syncThemeToIframe(selected);
      cachedPngBlob = null;
      recalculateContent();
    });
  }

  const syncThemeToIframe = (theme) => {
    try {
      if (previewRendered && previewRendered.contentWindow) {
        previewRendered.contentWindow.postMessage({ action: 'setTheme', theme }, '*');
      }
    } catch {
      // Ignore iframe postMessage error
    }
    try {
      const doc =
        previewRendered.contentDocument ||
        (previewRendered.contentWindow && previewRendered.contentWindow.document);
      if (!doc || !doc.documentElement) return;
      const themeDropdown = doc.getElementById('theme-select-dropdown');
      if (theme && theme !== 'system') {
        doc.documentElement.setAttribute('data-theme', theme);
        if (themeDropdown) themeDropdown.value = theme;
      } else {
        const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        doc.documentElement.setAttribute('data-theme', isDark ? 'modern-dark' : 'modern-light');
        if (themeDropdown) themeDropdown.value = isDark ? 'modern-dark' : 'modern-light';
      }
    } catch {
      // Ignore iframe DOM access error
    }
  };

  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'sync' && changes.theme) {
        currentSyncTheme = changes.theme.newValue || 'system';
        if (previewThemeSelect) previewThemeSelect.value = currentSyncTheme;
        applyTheme(currentSyncTheme, document);
        syncThemeToIframe(currentSyncTheme);
        cachedPngBlob = null;
        recalculateContent();
      }
    });
  }

  let conversation = null;
  let title = 'Untitled Chat';
  let initialFormat;

  let htmlContent = '';
  let markdownContent = '';
  let jsonContent = '';
  let docContent = '';

  let activeContent = '';
  let activeExtension = 'html';

  let currentBlobUrl = null;
  let cachedPngBlob = null;

  const setIframeContent = (content) => {
    if (currentBlobUrl) {
      URL.revokeObjectURL(currentBlobUrl);
      currentBlobUrl = null;
    }

    const cleanForPreview = content
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/\s*onclick="[^"]*"/gi, '');
    const blob = new Blob([cleanForPreview], { type: 'text/html' });
    currentBlobUrl = URL.createObjectURL(blob);
    previewRendered.src = currentBlobUrl;
  };

  previewRendered.addEventListener('load', () => {
    syncThemeToIframe(currentSyncTheme);
    try {
      const doc =
        previewRendered.contentDocument ||
        (previewRendered.contentWindow && previewRendered.contentWindow.document);
      if (!doc) return;

      injectPreviewStyles(doc);

      try {
        if (doc.body && typeof renderMathInElement === 'function') {
          renderMathInElement(doc.body, {
            delimiters: [
              { left: '$$', right: '$$', display: true },
              { left: '$', right: '$', display: false },
              { left: '\\[', right: '\\]', display: true },
              { left: '\\(', right: '\\)', display: false },
            ],
            throwOnError: false,
          });
        }
        if (doc.body && typeof Prism !== 'undefined' && Prism.highlightAllUnder) {
          if (!Prism.languages['markup-templating']) {
            Prism.languages['markup-templating'] = {
              buildPlaceholders: function (env, language, placeholderPattern) {
                if (env.language !== language) return;
                env.tokenStack = [];
                env.code = env.code.replace(placeholderPattern, function (match) {
                  var placeholder = '___' + language.toUpperCase() + env.tokenStack.length + '___';
                  env.tokenStack.push(match);
                  return placeholder;
                });
              },
              tokenizePlaceholders: function (env, language) {
                if (env.language !== language || !env.tokenStack) return;
                env.grammar = Prism.languages[language];
                var j = 0;
                function walkTokens(tokens) {
                  for (var i = 0; i < tokens.length; i++) {
                    if (j >= env.tokenStack.length) break;
                    var token = tokens[i];
                    if (
                      typeof token === 'string' ||
                      (token && token.content && typeof token.content === 'string')
                    ) {
                      var str = typeof token === 'string' ? token : token.content;
                      var placeholder = '___' + language.toUpperCase() + j + '___';
                      var index = str.indexOf(placeholder);
                      if (index > -1) {
                        var before = str.substring(0, index);
                        var middle = new Prism.Token(
                          language,
                          Prism.tokenize(env.tokenStack[j], env.grammar),
                          'language-' + language,
                          env.tokenStack[j],
                        );
                        var after = str.substring(index + placeholder.length);
                        var replacement = [];
                        if (before) replacement.push(before);
                        replacement.push(middle);
                        if (after) replacement.push(after);
                        if (typeof token === 'string') {
                          tokens.splice.apply(tokens, [i, 1].concat(replacement));
                        } else {
                          token.content = replacement;
                        }
                        j++;
                      }
                    } else if (token && token.content && Array.isArray(token.content)) {
                      walkTokens(token.content);
                    }
                  }
                }
                walkTokens(env.tokens);
              },
            };
          }
          Prism.highlightAllUnder(doc.body);
        }
      } catch (e) {
        console.warn('[Preview] Math/Prism rendering failed:', e);
      }

      const toggle = doc.getElementById('theme-toggle-checkbox');
      if (toggle) {
        toggle.addEventListener('change', (e) => {
          cachedPngBlob = null;
          if (e.target.checked) {
            doc.documentElement.setAttribute('data-theme', 'dark');
          } else {
            doc.documentElement.removeAttribute('data-theme');
          }
        });
      }

      doc.addEventListener('click', async (e) => {
        const codeBtn = e.target.closest('.copy-code-btn');
        if (codeBtn) {
          const card = codeBtn.closest('.code-card');
          const codeBlock = card ? card.querySelector('code') : null;
          if (!codeBlock) return;
          const span = codeBtn.querySelector('span');
          const originalBtnText = span ? span.textContent : 'Copy';
          try {
            await navigator.clipboard.writeText(codeBlock.textContent);
            if (span) span.textContent = 'Copied!';
            codeBtn.style.borderColor = '#10b981';
            codeBtn.style.color = '#10b981';

            setTimeout(() => {
              if (span) span.textContent = originalBtnText;
              codeBtn.style.borderColor = '';
              codeBtn.style.color = '';
            }, 2000);
          } catch (err) {
            console.error('Failed to copy text: ', err);
          }
        }

        const msgBtn = e.target.closest('.copy-msg-btn');
        if (msgBtn) {
          const card = msgBtn.closest('.message-card');
          const content = card ? card.querySelector('.message-content') : null;
          if (!content) return;
          const span = msgBtn.querySelector('span');
          const originalBtnText = span ? span.textContent : 'Copy';
          try {
            await navigator.clipboard.writeText(
              (content.innerText || content.textContent || '').trim(),
            );
            if (span) span.textContent = 'Copied!';
            msgBtn.style.borderColor = '#10b981';
            msgBtn.style.color = '#10b981';

            setTimeout(() => {
              if (span) span.textContent = originalBtnText;
              msgBtn.style.borderColor = '';
              msgBtn.style.color = '';
            }, 2000);
          } catch (err) {
            console.error('Failed to copy message text: ', err);
          }
        }
      });
    } catch (err) {
      console.error('Failed to initialize content inside iframe:', err);
    }
  });

  const turnSelectBtn = document.getElementById('turn-select-btn');
  const turnCountBadge = document.getElementById('turn-count-badge');
  const turnDrawer = document.getElementById('turn-selector-drawer');
  const turnSelectAllBtn = document.getElementById('turn-select-all-btn');
  const turnDeselectAllBtn = document.getElementById('turn-deselect-all-btn');
  const turnCloseBtn = document.getElementById('turn-drawer-close-btn');
  const turnListContainer = document.getElementById('turn-list-container');

  const printOptionsBar = document.getElementById('print-options-bar');
  const pageBreakCheckbox = document.getElementById('page-break-prompt-checkbox');
  const includeTocCheckbox = document.getElementById('include-toc-checkbox');

  let selectedIndices = new Set();
  let lastCheckedIndex = null;
  let currentActiveTab = 'html-render';

  const updateTurnBadge = () => {
    if (turnCountBadge) {
      const total = conversation?.messages?.length || 0;
      turnCountBadge.textContent = `${selectedIndices.size}/${total}`;
    }
  };

  const renderTurnList = () => {
    if (!turnListContainer || !conversation || !Array.isArray(conversation.messages)) return;
    turnListContainer.innerHTML = '';

    conversation.messages.forEach((msg, idx) => {
      const isSelected = selectedIndices.has(idx);
      const itemEl = document.createElement('div');
      itemEl.className = `turn-item ${isSelected ? 'selected' : ''}`;
      itemEl.dataset.index = idx;

      const roleLabel = msg.role === 'User' ? 'User' : conversation.metadata?.Source || 'Assistant';
      const snippetText =
        (msg.content || '')
          .replace(/<[^>]*>/g, '')
          .trim()
          .substring(0, 70) || '(Empty message)';

      itemEl.innerHTML = `
        <input type="checkbox" ${isSelected ? 'checked' : ''} data-index="${idx}" />
        <div class="turn-item-info">
          <div class="turn-item-role">${roleLabel} #${idx + 1}</div>
          <div class="turn-item-snippet">${snippetText}</div>
        </div>
      `;

      itemEl.addEventListener('click', (e) => {
        const checkbox = itemEl.querySelector('input[type="checkbox"]');
        let shouldCheck = !selectedIndices.has(idx);
        if (e.target === checkbox) {
          shouldCheck = checkbox.checked;
        }

        if (e.shiftKey && lastCheckedIndex !== null && lastCheckedIndex !== idx) {
          const start = Math.min(lastCheckedIndex, idx);
          const end = Math.max(lastCheckedIndex, idx);
          for (let i = start; i <= end; i++) {
            if (shouldCheck) selectedIndices.add(i);
            else selectedIndices.delete(i);
          }
        } else {
          if (shouldCheck) selectedIndices.add(idx);
          else selectedIndices.delete(idx);
        }

        lastCheckedIndex = idx;
        renderTurnList();
        recalculateContent();
      });

      turnListContainer.appendChild(itemEl);
    });

    updateTurnBadge();
  };

  const recalculateContent = () => {
    if (!conversation || !Array.isArray(conversation.messages)) return;

    const filteredMessages = conversation.messages.filter((_, idx) => selectedIndices.has(idx));
    const activeConv = { ...conversation, messages: filteredMessages };

    const shouldIncludeToc = Boolean(includeTocCheckbox && includeTocCheckbox.checked);

    htmlContent = htmlFormatter.format(activeConv, {
      theme: currentSyncTheme,
      includeToc: shouldIncludeToc,
    });
    markdownContent = markdownFormatter.format(activeConv);
    jsonContent = jsonFormatter.format(activeConv);
    docContent = docFormatter.format(activeConv);

    cachedPngBlob = null;
    switchTab(currentActiveTab);
  };

  const turnDoneBtn = document.getElementById('turn-done-btn');
  const turnDoneBottomBtn = document.getElementById('turn-done-bottom-btn');

  if (turnSelectBtn && turnDrawer) {
    turnSelectBtn.addEventListener('click', () => {
      turnDrawer.classList.toggle('hidden');
    });
  }
  if (turnCloseBtn && turnDrawer) {
    turnCloseBtn.addEventListener('click', () => {
      turnDrawer.classList.add('hidden');
    });
  }
  if (turnDoneBtn && turnDrawer) {
    turnDoneBtn.addEventListener('click', () => {
      turnDrawer.classList.add('hidden');
    });
  }
  if (turnDoneBottomBtn && turnDrawer) {
    turnDoneBottomBtn.addEventListener('click', () => {
      turnDrawer.classList.add('hidden');
    });
  }
  if (turnSelectAllBtn) {
    turnSelectAllBtn.addEventListener('click', () => {
      if (conversation?.messages) {
        selectedIndices = new Set(conversation.messages.map((_, i) => i));
        renderTurnList();
        recalculateContent();
      }
    });
  }
  if (turnDeselectAllBtn) {
    turnDeselectAllBtn.addEventListener('click', () => {
      selectedIndices.clear();
      renderTurnList();
      recalculateContent();
    });
  }
  if (pageBreakCheckbox) {
    pageBreakCheckbox.addEventListener('change', () => {
      setIframeContent(htmlContent);
    });
  }
  if (includeTocCheckbox) {
    includeTocCheckbox.addEventListener('change', () => {
      recalculateContent();
    });
  }

  const printIframe = () => {
    if (!previewRendered) return;
    try {
      const doc =
        previewRendered.contentDocument ||
        (previewRendered.contentWindow && previewRendered.contentWindow.document);
      if (doc && doc.documentElement) {
        if (currentSyncTheme && currentSyncTheme !== 'system') {
          doc.documentElement.setAttribute('data-theme', currentSyncTheme);
        } else {
          const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
          doc.documentElement.setAttribute('data-theme', isDark ? 'modern-dark' : 'modern-light');
        }
        let printStyle = doc.getElementById('print-custom-style');
        if (!printStyle) {
          printStyle = doc.createElement('style');
          printStyle.id = 'print-custom-style';
          doc.head.appendChild(printStyle);
        }
        let cssRules = '';
        if (pageBreakCheckbox && pageBreakCheckbox.checked) {
          cssRules +=
            '.message-card.role-user { page-break-before: always !important; break-before: page !important; }';
        }
        printStyle.textContent = cssRules;
      }
    } catch {
      // Ignore iframe style injection errors
    }

    try {
      if (previewRendered.contentWindow) {
        previewRendered.contentWindow.focus();
        previewRendered.contentWindow.print();
        return;
      }
    } catch (err) {
      console.warn('[Preview] Iframe print access blocked, falling back to window.print():', err);
    }
    window.print();
  };

  const updateDownloadButtonLabel = (extension) => {
    if (!downloadBtn) return;
    const downloadSvgIcon = `<svg viewBox="0 0 24 24" class="icon"><path d="M19 12v7H5v-7H3v7c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2v-7h-2zm-6 .67l2.59-2.58L17 11.5l-5 5-5-5 1.41-1.41L11 12.67V3h2v9.67z"/></svg>`;
    const printSvgIcon = `<svg viewBox="0 0 24 24" class="icon"><path d="M19 8H5c-1.66 0-3 1.34-3 3v6h4v4h12v-4h4v-6c0-1.66-1.34-3-3-3zm-3 11H8v-5h8v5zm3-7c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm-1-9H6v4h12V3z"/></svg>`;
    let label = t('downloadFile') || 'Download File';
    let icon = downloadSvgIcon;
    if (extension === 'png') {
      label = t('downloadPng') || 'Download PNG';
    } else if (extension === 'html') {
      label = t('downloadHtml') || 'Download HTML';
    } else if (extension === 'md') {
      label = t('downloadMarkdown') || 'Download Markdown';
    } else if (extension === 'json') {
      label = t('downloadJson') || 'Download JSON';
    } else if (extension === 'doc') {
      label = t('downloadWordDoc') || 'Download Word Doc';
    } else if (extension === 'pdf') {
      label = t('printSavePdf') || 'Print / Save PDF';
      icon = printSvgIcon;
    }
    downloadBtn.innerHTML = `${icon} ${label}`;
  };

  const switchTab = (tabName) => {
    currentActiveTab = tabName;
    const buttons = formatTabsContainer.querySelectorAll('.control-btn');
    buttons.forEach((btn) => {
      if (btn.getAttribute('data-tab') === tabName) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    if (pngWarningBanner) {
      pngWarningBanner.classList.toggle('hidden', tabName !== 'png');
    }
    if (pngOptionsBar) {
      pngOptionsBar.classList.toggle('hidden', tabName !== 'png');
    }
    if (printOptionsBar) {
      const isHtmlOrPdf = tabName === 'html-render' || tabName === 'pdf';
      printOptionsBar.classList.toggle('hidden', !isHtmlOrPdf);

      const pageBreakContainer = document.getElementById('page-break-container');
      if (pageBreakContainer) {
        pageBreakContainer.classList.toggle('hidden', tabName !== 'pdf');
      }
      const printHint = document.getElementById('print-hint');
      if (printHint) {
        printHint.classList.toggle('hidden', tabName !== 'pdf');
      }
    }

    // Contextual copy button: hide on png, pdf, and doc; show on text code/markup formats
    if (copyBtn) {
      if (tabName === 'png' || tabName === 'pdf' || tabName === 'doc') {
        copyBtn.classList.add('hidden');
      } else {
        copyBtn.classList.remove('hidden');
      }
    }

    if (tabName === 'html-render' || tabName === 'png' || tabName === 'pdf') {
      activeContent = htmlContent;
      if (tabName === 'png') {
        activeExtension = 'png';
      } else if (tabName === 'pdf') {
        activeExtension = 'pdf';
      } else {
        activeExtension = 'html';
      }

      codeWrapper.classList.add('hidden');
      renderWrapper.classList.remove('hidden');
      if (printBtn) {
        printBtn.classList.add('hidden');
      }

      if (
        !previewRendered.src ||
        previewRendered.src === 'about:blank' ||
        previewRendered.getAttribute('data-content') !== htmlContent
      ) {
        previewRendered.setAttribute('data-content', htmlContent);
        setIframeContent(htmlContent);
      }
    } else {
      renderWrapper.classList.add('hidden');
      codeWrapper.classList.remove('hidden');
      if (printBtn) printBtn.classList.add('hidden');

      if (tabName === 'html-source') {
        activeContent = htmlContent;
        activeExtension = 'html';
      } else if (tabName === 'markdown') {
        activeContent = markdownContent;
        activeExtension = 'md';
      } else if (tabName === 'json') {
        activeContent = jsonContent;
        activeExtension = 'json';
      } else if (tabName === 'doc') {
        activeContent = docContent;
        activeExtension = 'doc';
      }

      codeEl.textContent = activeContent;
    }

    updateDownloadButtonLabel(activeExtension);
  };

  formatTabsContainer.addEventListener('click', (e) => {
    const btn = e.target.closest('.control-btn');
    if (btn && btn.hasAttribute('data-tab')) {
      switchTab(btn.getAttribute('data-tab'));
    }
  });

  if (printBtn) {
    printBtn.addEventListener('click', () => printIframe());
  }

  previewRendered.addEventListener('load', () => {
    syncThemeToIframe(currentSyncTheme);
  });

  let previewFilename = null;

  try {
    const data = await chrome.storage.local.get([
      'previewConversation',
      'previewContent',
      'previewTitle',
      'previewFilename',
      'previewFormat',
      'autoPrint',
      'autoDownloadPng',
      'highQualityPng',
      'includeImages',
    ]);

    conversation = data.previewConversation || null;
    title = data.previewTitle || 'Untitled Chat';
    previewFilename = data.previewFilename || null;
    initialFormat = data.previewFormat || 'markdown';
    const autoPrint = data.autoPrint || false;
    const autoDownloadPng = data.autoDownloadPng || false;

    if (conversation && Array.isArray(conversation.messages)) {
      selectedIndices = new Set(conversation.messages.map((_, i) => i));
    }

    if (pngQualityCheckbox && data.highQualityPng !== undefined) {
      pngQualityCheckbox.checked = data.highQualityPng;
    }
    if (includeImagesCheckbox && data.includeImages !== undefined) {
      includeImagesCheckbox.checked = data.includeImages;
    }

    let filenameTemplate = DEFAULT_FILENAME_TEMPLATE;
    try {
      const syncData = await chrome.storage.sync.get('filenameTemplate');
      if (syncData && syncData.filenameTemplate) {
        filenameTemplate = syncData.filenameTemplate;
      }
    } catch {
      // Fallback to default
    }

    const platform = conversation?.metadata?.Source || 'AI';
    const displayTitle = resolveConversationTitle(
      conversation?.title || title,
      platform,
      typeof document !== 'undefined' ? document : null,
    );
    const computedDefaultFilename = formatFilename(filenameTemplate, {
      platform,
      title: displayTitle,
    });

    const effectiveFilename = previewFilename || computedDefaultFilename;
    if (filenameInput) {
      filenameInput.value = effectiveFilename;
    }
    if (titleEl) {
      titleEl.textContent = displayTitle;
    }
    document.title = `${effectiveFilename} - Chat Export Preview`;

    if (conversation) {
      htmlContent = htmlFormatter.format(conversation, { theme: currentSyncTheme });
      markdownContent = markdownFormatter.format(conversation);
      jsonContent = jsonFormatter.format(conversation);
      docContent = docFormatter.format(conversation);
    } else {
      const fallbackContent = data.previewContent || '';
      htmlContent = sanitizeHtml(fallbackContent);
      markdownContent = fallbackContent;
      jsonContent = fallbackContent;
      docContent = fallbackContent;
    }

    renderTurnList();

    let initialTab = 'html-render';
    if (initialFormat === 'json') {
      initialTab = 'json';
    } else if (initialFormat === 'markdown') {
      initialTab = 'markdown';
    } else if (initialFormat === 'doc') {
      initialTab = 'doc';
    } else if (initialFormat === 'png') {
      initialTab = 'png';
    } else if (initialFormat === 'pdf') {
      initialTab = 'pdf';
    } else if (initialFormat === 'html') {
      initialTab = 'html-render';
    }

    if (autoPrint && (initialFormat === 'pdf' || initialFormat === 'html')) {
      previewRendered.addEventListener(
        'load',
        () => {
          setTimeout(printIframe, 400);
        },
        { once: true },
      );
    }

    switchTab(initialTab);

    if (autoDownloadPng && initialFormat === 'png') {
      setTimeout(() => {
        downloadBtn.click();
      }, 300);
    }
  } catch (error) {
    console.error('Failed to load preview data:', error);
    codeEl.textContent = 'Error loading content: ' + error.message;
  }

  copyBtn.addEventListener('click', async () => {
    if (!activeContent && !cachedPngBlob) return;
    copyBtn.disabled = true;
    const originalText = copyBtn.innerHTML;

    try {
      if (
        activeExtension === 'png' &&
        cachedPngBlob &&
        typeof ClipboardItem !== 'undefined' &&
        navigator.clipboard &&
        navigator.clipboard.write
      ) {
        await navigator.clipboard.write([
          new ClipboardItem({
            'image/png': cachedPngBlob,
          }),
        ]);
      } else {
        await navigator.clipboard.writeText(activeContent);
      }
      copyBtn.innerHTML = `
        <svg viewBox="0 0 24 24" class="icon"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
        Copied!
      `;
      setTimeout(() => {
        copyBtn.innerHTML = originalText;
        copyBtn.disabled = false;
      }, 2000);
    } catch (e) {
      console.error(e);
      copyBtn.textContent = 'Copy Failed';
      setTimeout(() => {
        copyBtn.innerHTML = originalText;
        copyBtn.disabled = false;
      }, 2000);
    }
  });

  downloadBtn.addEventListener('click', async () => {
    if (activeExtension === 'pdf') {
      printIframe();
      return;
    }

    let downloadBaseName = filenameInput ? filenameInput.value.trim() : '';
    if (!downloadBaseName) {
      downloadBaseName = previewFilename;
    }
    if (!downloadBaseName) {
      let filenameTemplate = DEFAULT_FILENAME_TEMPLATE;
      try {
        const syncData = await chrome.storage.sync.get('filenameTemplate');
        if (syncData && syncData.filenameTemplate) {
          filenameTemplate = syncData.filenameTemplate;
        }
      } catch {
        // Fallback to default
      }
      const platform = conversation?.metadata?.Source || 'AI';
      downloadBaseName = formatFilename(filenameTemplate, {
        platform,
        title: conversation?.title || title || 'Conversation',
      });
    }

    const filename = `${downloadBaseName}.${activeExtension}`;

    const getIframeTheme = () => {
      try {
        const doc =
          previewRendered.contentDocument ||
          (previewRendered.contentWindow && previewRendered.contentWindow.document);
        if (doc && doc.documentElement) {
          if (doc.documentElement.getAttribute('data-theme') === 'dark') return 'dark';
          if (doc.documentElement.getAttribute('data-theme') === 'light') return 'light';
        }
      } catch {
        // Ignore cross-origin error
      }
      if (currentSyncTheme === 'dark') return 'dark';
      if (currentSyncTheme === 'light') return 'light';
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    };

    if (activeExtension === 'png') {
      const originalText = downloadBtn.innerHTML;
      try {
        downloadBtn.disabled = true;
        downloadBtn.textContent = 'Rendering PNG...';

        let pngBlob = cachedPngBlob;
        if (!pngBlob && conversation) {
          const isHighQuality = pngQualityCheckbox ? pngQualityCheckbox.checked : true;
          const isDarkTheme = getIframeTheme() === 'dark';
          pngBlob = await imageFormatter.format(conversation, {
            highQuality: isHighQuality,
            isDark: isDarkTheme,
          });
          cachedPngBlob = pngBlob;
        }

        if (!pngBlob) {
          throw new Error('PNG generation failed');
        }

        const url = URL.createObjectURL(pngBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch (err) {
        console.error('[Preview] PNG download failed:', err);
        alert('PNG Download Failed: ' + err.message);
      } finally {
        downloadBtn.disabled = false;
        downloadBtn.innerHTML = originalText;
      }
      return;
    }

    if (!activeContent) return;

    let mimeType = 'text/plain';
    let blobParts = [activeContent];

    if (activeExtension === 'html') {
      mimeType = 'text/html';
    } else if (activeExtension === 'doc') {
      mimeType = 'application/msword';
      blobParts = ['\ufeff', activeContent];
    } else if (activeExtension === 'json') {
      mimeType = 'application/json';
    } else if (activeExtension === 'md') {
      mimeType = 'text/markdown';
    }

    const blob = new Blob(blobParts, { type: `${mimeType};charset=utf-8` });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();

    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });

  if (transferBtn && transferTargetSelect) {
    transferBtn.addEventListener('click', async () => {
      const targetPlatform = transferTargetSelect.value || 'claude';
      const originalText = transferBtn.innerHTML;

      try {
        transferBtn.disabled = true;
        transferBtn.textContent = 'Transferring...';

        let payload = '';
        if (conversation) {
          payload = continuationFormatter.format(conversation);
        } else {
          payload = stripEncodedImages(markdownContent || activeContent);
        }

        await chrome.runtime.sendMessage({
          action: 'TRANSFER_CHAT',
          targetPlatform: targetPlatform,
          title: title || 'AI Conversation',
          payload: payload,
        });
      } catch (err) {
        console.error('[Preview] Transfer chat failed:', err);
        alert('Transfer failed: ' + err.message);
      } finally {
        transferBtn.disabled = false;
        transferBtn.innerHTML = originalText;
      }
    });
  }
});
