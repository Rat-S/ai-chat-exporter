import { MarkdownFormatter } from '../content/formatters/markdown.js';
import { JsonFormatter } from '../content/formatters/json.js';
import { HtmlFormatter } from '../content/formatters/html.js';
import { DocFormatter } from '../content/formatters/doc.js';
import { ImageFormatter } from '../content/formatters/image.js';
import { ContinuationFormatter, stripEncodedImages } from '../content/formatters/continuation.js';
import { sanitizeHtml } from '../content/utils/sanitizer.js';
import { initI18n, applyI18n, t } from '../content/utils/i18n.js';
import {
  formatFilename,
  resolveConversationTitle,
  DEFAULT_FILENAME_TEMPLATE,
} from '../content/utils/filename.js';

function applyTheme(theme, targetDoc = document) {
  if (!targetDoc || !targetDoc.documentElement) return;
  if (theme === 'dark') {
    targetDoc.documentElement.setAttribute('data-theme', 'dark');
  } else if (theme === 'light') {
    targetDoc.documentElement.setAttribute('data-theme', 'light');
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

  // Load and apply extension theme
  let currentSyncTheme = 'system';
  try {
    const syncData = await chrome.storage.sync.get('theme');
    currentSyncTheme = syncData.theme || 'system';
    applyTheme(currentSyncTheme, document);
  } catch {
    // Ignore theme loading errors when running standalone
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
      const toggle = doc.getElementById('theme-toggle-checkbox');
      let isDark = false;
      if (theme === 'dark') {
        isDark = true;
      } else if (theme === 'light') {
        isDark = false;
      } else {
        isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      }
      if (isDark) {
        doc.documentElement.setAttribute('data-theme', 'dark');
        if (toggle) toggle.checked = true;
      } else {
        doc.documentElement.removeAttribute('data-theme');
        if (toggle) toggle.checked = false;
      }
    } catch {
      // Ignore iframe DOM access error
    }
  };

  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'sync' && changes.theme) {
        currentSyncTheme = changes.theme.newValue || 'system';
        applyTheme(currentSyncTheme, document);
        syncThemeToIframe(currentSyncTheme);
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

    const blob = new Blob([content], { type: 'text/html' });
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

  const printIframe = () => {
    if (!previewRendered || !previewRendered.contentWindow) return;
    previewRendered.contentWindow.focus();
    previewRendered.contentWindow.print();
  };

  const updateDownloadButtonLabel = (extension) => {
    if (!downloadBtn) return;
    const svgIcon = `<svg viewBox="0 0 24 24" class="icon"><path d="M19 12v7H5v-7H3v7c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2v-7h-2zm-6 .67l2.59-2.58L17 11.5l-5 5-5-5 1.41-1.41L11 12.67V3h2v9.67z"/></svg>`;
    let label = t('downloadFile') || 'Download File';
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
    }
    downloadBtn.innerHTML = `${svgIcon} ${label}`;
  };

  const switchTab = (tabName) => {
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

    if (tabName === 'html-render' || tabName === 'png') {
      activeContent = htmlContent;
      activeExtension = tabName === 'png' ? 'png' : 'html';
      codeWrapper.classList.add('hidden');
      renderWrapper.classList.remove('hidden');
      if (printBtn) {
        if (tabName === 'png') printBtn.classList.add('hidden');
        else printBtn.classList.remove('hidden');
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

    if (pngQualityCheckbox && data.highQualityPng !== undefined) {
      pngQualityCheckbox.checked = data.highQualityPng;
    }
    if (includeImagesCheckbox && data.includeImages !== undefined) {
      includeImagesCheckbox.checked = data.includeImages;
    }

    titleEl.textContent = title;

    if (conversation) {
      htmlContent = htmlFormatter.format(conversation);
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

    let initialTab = 'html-render';
    if (initialFormat === 'json') {
      initialTab = 'json';
    } else if (initialFormat === 'markdown') {
      initialTab = 'markdown';
    } else if (initialFormat === 'doc') {
      initialTab = 'doc';
    } else if (initialFormat === 'png') {
      initialTab = 'png';
    } else if (initialFormat === 'html' || initialFormat === 'pdf') {
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

  // Copy button logic
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

  // Download button logic
  downloadBtn.addEventListener('click', async () => {
    let downloadBaseName = previewFilename;
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
      const displayTitle = resolveConversationTitle(
        conversation?.title || title,
        platform,
        typeof document !== 'undefined' ? document : null,
      );
      downloadBaseName = formatFilename(filenameTemplate, {
        platform,
        title: displayTitle,
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

  // Transfer button logic
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
