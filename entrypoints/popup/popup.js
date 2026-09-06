import { initI18n, applyI18n, t } from '../../content/utils/i18n.js';
import {
  formatFilename,
  resolveConversationTitle,
  DEFAULT_FILENAME_TEMPLATE,
} from '../../content/utils/filename.js';
import { createLogger } from '../../content/utils/logger.js';

const logger = createLogger('Popup');

function applyTheme(theme) {
  if (theme && theme !== 'system') {
    document.documentElement.setAttribute('data-theme', theme);
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  if (window.self !== window.top) {
    document.documentElement.classList.add('in-iframe');
  }

  // Initialize localization
  await initI18n();
  applyI18n();

  const statusEl = document.getElementById('status');
  const chatInfoEl = document.getElementById('chat-info');
  const actionsEl = document.getElementById('actions');
  const errorEl = document.getElementById('error-msg');
  const chatTitleEl = document.getElementById('chat-title');
  const msgCountEl = document.getElementById('message-count');
  const exportBtn = document.getElementById('export-btn');
  const copyBtn = document.getElementById('copy-btn');
  const previewBtn = document.getElementById('preview-btn');
  const formatSelect = document.getElementById('format-select');
  const includeImagesCheckbox = document.getElementById('include-images-checkbox');
  const filenameInput = document.getElementById('filename-input');
  const continueTargetSelect = document.getElementById('continue-target-select');
  const previewableFormats = new Set(['markdown', 'json', 'html', 'doc', 'png', 'pdf']);
  const copyableFormats = new Set(['markdown', 'json', 'html']);

  const openOptionsBtn = document.getElementById('open-options-btn');
  if (openOptionsBtn) {
    openOptionsBtn.addEventListener('click', () => {
      if (chrome.runtime.openOptionsPage) {
        chrome.runtime.openOptionsPage();
      } else {
        chrome.tabs.create({ url: chrome.runtime.getURL('options.html') });
      }
    });
  }

  const reportIssueLink = document.getElementById('report-issue-link');
  if (reportIssueLink) {
    reportIssueLink.addEventListener('click', (e) => {
      e.preventDefault();
      const issueUrl =
        'https://github.com/Covai-Labs/ai-chat-exporter/issues/new?template=bug_report.md';
      chrome.tabs.create({ url: issueUrl });
    });
  }

  const decantLink = document.getElementById('decant-link');
  if (decantLink) {
    decantLink.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: decantLink.href });
    });
  }

  const copilotRedirectBox = document.getElementById('copilot-redirect-box');
  const copilotRedirectBtn = document.getElementById('copilot-redirect-btn');
  if (copilotRedirectBtn) {
    copilotRedirectBtn.addEventListener('click', async () => {
      if (tab && tab.url) {
        const targetUrl = tab.url.replace('copilot.microsoft.com', 'copilot.com');
        chrome.tabs.create({ url: targetUrl });
      } else {
        chrome.tabs.create({ url: 'https://copilot.com/' });
      }
    });
  }

  const storedSettings = await chrome.storage.sync.get([
    'theme',
    'uiLanguage',
    'defaultFormat',
    'includeImages',
    'filenameTemplate',
    'defaultTransferTarget',
    'parserMode',
  ]);
  applyTheme(storedSettings.theme || 'system');

  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener(async (changes, areaName) => {
      if (areaName === 'sync') {
        if (changes.theme) {
          storedSettings.theme = changes.theme.newValue || 'system';
          applyTheme(storedSettings.theme);
        }
        if (changes.uiLanguage) {
          await initI18n(changes.uiLanguage.newValue || 'auto');
          applyI18n();
          updateCopyButtonVisibility();
        }
        if (changes.filenameTemplate) {
          storedSettings.filenameTemplate = changes.filenameTemplate.newValue;
        }
      }
    });
  }

  if (storedSettings.defaultFormat && formatSelect) {
    formatSelect.value = storedSettings.defaultFormat;
  }
  if (storedSettings.includeImages !== undefined && includeImagesCheckbox) {
    includeImagesCheckbox.checked = storedSettings.includeImages;
  }

  async function getActiveTab() {
    if (typeof chrome === 'undefined' || !chrome.tabs) return null;
    try {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (tab) return tab;
    } catch {
      // Ignore
    }
    try {
      const [fallbackTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      return fallbackTab || null;
    } catch {
      return null;
    }
  }

  let tab = await getActiveTab();
  logger.debug('Active tab detected:', {
    id: tab?.id,
    url: tab?.url,
    title: tab?.title,
  });

  if (!tab) {
    logger.warn('No active tab found');
    statusEl.textContent = 'Error: No active tab';
    return;
  }

  const MAX_RETRIES = 3;
  const RETRY_DELAY_MS = 500;

  async function checkAvailability() {
    tab = await getActiveTab();
    logger.debug('checkAvailability() starting for tab:', tab?.id, tab?.url);
    if (!tab || !tab.id) {
      logger.warn('Tab or Tab ID invalid');
      statusEl.textContent = 'Error: No active tab';
      showError();
      return;
    }
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        logger.debug(
          `Attempt ${attempt + 1}/${MAX_RETRIES}: Sending CHECK_AVAILABILITY to tab ${tab.id}`,
        );
        const response = await chrome.tabs.sendMessage(tab.id, {
          action: 'CHECK_AVAILABILITY',
        });
        logger.debug('Response received:', response);
        if (response && response.available) {
          logger.info(
            `Successfully connected to platform: ${response.platform} with ${response.count} messages`,
          );
          statusEl.textContent = `${t('statusReady') || 'Ready'}: ${response.platform}`;
          const platformName = response.platform || 'AI';
          const displayTitle = resolveConversationTitle(response.title, platformName, {
            title: tab.title,
          });
          chatTitleEl.textContent = displayTitle;
          const count = response.count || 0;
          msgCountEl.textContent = t('messagesFound', count) || `${count} messages found`;
          if (filenameInput) {
            const formattedDefault = formatFilename(
              storedSettings.filenameTemplate || DEFAULT_FILENAME_TEMPLATE,
              {
                platform: response.platform,
                title: displayTitle,
              },
            );
            filenameInput.value = formattedDefault;
          }
          if (continueTargetSelect) {
            const platformKey = (response.platform || '').toLowerCase();
            let target = storedSettings.defaultTransferTarget || 'claude';
            if (platformKey.includes('chatgpt') && target === 'chatgpt') {
              target = 'claude';
            } else if (platformKey.includes('claude') && target === 'claude') {
              target = 'chatgpt';
            }
            continueTargetSelect.value = target;
          }
          chatInfoEl.classList.remove('hidden');
          actionsEl.classList.remove('hidden');
          errorEl.classList.add('hidden');
          if (copilotRedirectBox) {
            copilotRedirectBox.classList.add('hidden');
          }
          return;
        } else {
          logger.debug(
            'Response indicated parser is not available or returned empty response:',
            response,
          );
          showError();
          return;
        }
      } catch (e) {
        const isNotReady = e.message && e.message.includes('Receiving end does not exist');
        logger.debug(`Attempt ${attempt + 1} communication status:`, e.message);
        if (
          isNotReady &&
          attempt === 0 &&
          typeof chrome !== 'undefined' &&
          chrome.scripting?.executeScript
        ) {
          try {
            logger.debug('Attempting on-demand script injection for tab:', tab.id);
            await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              files: ['content-scripts/content.js'],
            });
            await new Promise((resolve) => setTimeout(resolve, 200));
            continue;
          } catch (injectErr) {
            logger.debug('Dynamic script injection failed:', injectErr);
          }
        }
        if (!isNotReady) {
          logger.debug('Unexpected error connecting to tab:', e);
          showError();
          return;
        }
        if (attempt < MAX_RETRIES - 1) {
          logger.debug(`Waiting ${RETRY_DELAY_MS}ms before retry...`);
          await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
        }
      }
    }
    logger.debug('Exhausted connection attempts to content script.');
    showError();
  }

  window.addEventListener('message', async (event) => {
    if (event.data?.action === 'REFRESH_PANEL') {
      await checkAvailability();
    }
  });

  const pngWarningBanner = document.getElementById('png-warning-banner');
  const pngQualityContainer = document.getElementById('png-quality-container');
  const pngQualityCheckbox = document.getElementById('png-quality-checkbox');

  function updateCopyButtonVisibility() {
    const format = formatSelect.value;
    const isCopyable = copyableFormats.has(format);
    const isPreviewable = previewableFormats.has(format) && format !== 'png';
    copyBtn.classList.toggle('hidden', !isCopyable);
    previewBtn.classList.toggle('hidden', !isPreviewable);
    if (format === 'png') {
      exportBtn.textContent = '🖼️ ' + (t('openInTab') || 'Export in New Tab');
    } else if (format === 'pdf') {
      exportBtn.textContent = '📄 ' + (t('printSavePdf') || 'Export & Print PDF');
    } else {
      exportBtn.textContent = t('exportChat') || '📥 Export Chat';
    }
    if (pngWarningBanner) {
      pngWarningBanner.classList.toggle('hidden', format !== 'png');
    }
    if (pngQualityContainer) {
      pngQualityContainer.classList.toggle('hidden', format !== 'png');
    }
  }

  function showError() {
    statusEl.textContent = t('statusError') || 'Not Supported';
    errorEl.classList.remove('hidden');
    if (copilotRedirectBox) {
      const isCopilotMs = Boolean(tab?.url && tab.url.includes('copilot.microsoft.com'));
      copilotRedirectBox.classList.toggle('hidden', !isCopilotMs);
    }
  }

  formatSelect.addEventListener('change', updateCopyButtonVisibility);
  updateCopyButtonVisibility();

  await checkAvailability();

  exportBtn.addEventListener('click', async () => {
    const format = formatSelect.value;
    const customFilename = filenameInput ? filenameInput.value.trim() : '';
    exportBtn.disabled = true;
    exportBtn.textContent =
      format === 'png'
        ? t('loadingContent') || 'Opening Preview...'
        : format === 'pdf'
          ? t('loadingContent') || 'Opening PDF Preview...'
          : t('statusExporting') || 'Exporting...';

    try {
      if (format === 'pdf' || format === 'png') {
        const formatToRequest = format === 'pdf' ? 'html' : 'markdown';
        const response = await chrome.tabs.sendMessage(tab.id, {
          action: 'COPY_CHAT',
          format: formatToRequest,
          includeImages: includeImagesCheckbox.checked,
          parserMode: storedSettings.parserMode || 'auto',
          theme: storedSettings.theme || 'system',
        });

        if (response && response.success) {
          await chrome.storage.local.set({
            previewConversation: response.conversation || null,
            previewContent: response.content,
            previewTitle: response.conversation?.title || tab.title || 'Untitled Chat',
            previewFilename: customFilename || null,
            previewFormat: format,
            autoPrint: format === 'pdf',
            autoDownloadPng: format === 'png',
            highQualityPng: pngQualityCheckbox ? pngQualityCheckbox.checked : true,
            includeImages: includeImagesCheckbox ? includeImagesCheckbox.checked : true,
          });

          await chrome.tabs.create({
            url: chrome.runtime.getURL('preview.html'),
          });

          statusEl.textContent = t('statusExportSuccess') || 'Export Successful!';
        } else {
          statusEl.textContent =
            (t('statusError') || 'Export Failed') + ': ' + (response?.error || 'Unknown');
        }
      } else {
        const response = await chrome.tabs.sendMessage(tab.id, {
          action: 'EXPORT_CHAT',
          format: format,
          includeImages: includeImagesCheckbox.checked,
          customFilename: customFilename,
          highQualityPng: pngQualityCheckbox ? pngQualityCheckbox.checked : true,
          parserMode: storedSettings.parserMode || 'auto',
          theme: storedSettings.theme || 'system',
        });

        if (response && response.success) {
          statusEl.textContent = t('statusExportSuccess') || 'Export Successful!';
        } else {
          statusEl.textContent =
            (t('statusError') || 'Export Failed') + ': ' + (response?.error || 'Unknown');
        }
      }
    } catch (e) {
      statusEl.textContent = 'Error: ' + e.message;
    } finally {
      exportBtn.disabled = false;
      updateCopyButtonVisibility();
    }
  });

  copyBtn.addEventListener('click', async () => {
    const format = formatSelect.value;
    copyBtn.disabled = true;
    copyBtn.textContent = t('statusExporting') || 'Copying...';

    try {
      const response = await chrome.tabs.sendMessage(tab.id, {
        action: 'COPY_CHAT',
        format: format,
        includeImages: includeImagesCheckbox.checked,
        theme: storedSettings.theme || 'system',
      });

      if (response && response.success) {
        if (
          response.htmlContent &&
          typeof ClipboardItem !== 'undefined' &&
          navigator.clipboard &&
          navigator.clipboard.write
        ) {
          try {
            const htmlBlob = new Blob([response.htmlContent], { type: 'text/html' });
            const textBlob = new Blob([response.content], { type: 'text/plain' });
            await navigator.clipboard.write([
              new ClipboardItem({
                'text/html': htmlBlob,
                'text/plain': textBlob,
              }),
            ]);
          } catch (writeErr) {
            logger.warn('Dual-MIME clipboard write failed, falling back to text:', writeErr);
            await navigator.clipboard.writeText(response.content);
          }
        } else {
          await navigator.clipboard.writeText(response.content);
        }
        statusEl.textContent = t('statusCopied') || 'Copied to clipboard!';
      } else {
        statusEl.textContent = 'Copy Failed: ' + (response?.error || 'Unknown');
      }
    } catch (e) {
      statusEl.textContent = 'Error: ' + e.message;
    } finally {
      copyBtn.disabled = false;
      copyBtn.textContent = t('copyChat') || '📋 Copy Chat';
    }
  });

  previewBtn.addEventListener('click', async () => {
    const format = formatSelect.value;
    previewBtn.disabled = true;
    previewBtn.textContent = t('loadingContent') || 'Opening...';

    try {
      const formatToRequest = format === 'pdf' ? 'html' : format === 'png' ? 'markdown' : format;
      const response = await chrome.tabs.sendMessage(tab.id, {
        action: 'COPY_CHAT',
        format: formatToRequest,
        includeImages: includeImagesCheckbox.checked,
        parserMode: storedSettings.parserMode || 'auto',
      });

      if (response && response.success) {
        const customFilename = filenameInput ? filenameInput.value.trim() : '';
        await chrome.storage.local.set({
          previewConversation: response.conversation || null,
          previewContent: response.content,
          previewTitle: response.conversation?.title || tab.title || 'Untitled Chat',
          previewFilename: customFilename || null,
          previewFormat: format,
          autoPrint: false,
          autoDownloadPng: false,
          highQualityPng: pngQualityCheckbox ? pngQualityCheckbox.checked : true,
          includeImages: includeImagesCheckbox ? includeImagesCheckbox.checked : true,
        });

        await chrome.tabs.create({
          url: chrome.runtime.getURL('preview.html'),
        });

        statusEl.textContent = t('statusOpenedInTab') || 'Opened in New Tab!';
      } else {
        statusEl.textContent = 'Preview Failed: ' + (response?.error || 'Unknown');
      }
    } catch (e) {
      statusEl.textContent = 'Error: ' + e.message;
    } finally {
      previewBtn.disabled = false;
      previewBtn.textContent = t('openInTab') || '👁️ Open in Tab';
    }
  });

  const transferBtn = document.getElementById('transfer-btn');

  if (transferBtn) {
    transferBtn.addEventListener('click', async () => {
      const targetPlatform = continueTargetSelect ? continueTargetSelect.value : 'chatgpt';
      transferBtn.disabled = true;
      transferBtn.textContent = t('statusExporting') || 'Transferring...';

      try {
        const response = await chrome.tabs.sendMessage(tab.id, {
          action: 'GET_CONTINUATION_PAYLOAD',
          includeImages: includeImagesCheckbox.checked,
        });

        if (response && response.success && response.payload) {
          await chrome.runtime.sendMessage({
            action: 'TRANSFER_CHAT',
            targetPlatform: targetPlatform,
            title: filenameInput ? filenameInput.value : 'AI Conversation',
            payload: response.payload,
          });
          statusEl.textContent = `Opening ${targetPlatform}...`;
        } else {
          statusEl.textContent = 'Transfer Failed: ' + (response?.error || 'No content');
        }
      } catch (e) {
        statusEl.textContent = 'Error: ' + e.message;
      } finally {
        transferBtn.disabled = false;
        transferBtn.textContent = t('transferBtn') || '↗ Transfer';
      }
    });
  }
});
