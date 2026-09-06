// Static imports for parsers
import {
  ChatGPTParser,
  GeminiParser,
  ClaudeParser,
  QwenParser,
  PerplexityParser,
  DeepSeekParser,
  MetaParser,
  MistralParser,
  GoogleSearchAIParser,
  ZAiParser,
  GeminiCloudAssistParser,
  GoogleAIStudioParser,
  NotebookLMParser,
  CopilotParser,
  LumoParser,
  JoylandParser,
  ChubParser,
  ArticleParser,
} from 'decant-core';

import { MarkdownFormatter } from './formatters/markdown.js';
import { JsonFormatter } from './formatters/json.js';
import { HtmlFormatter } from './formatters/html.js';
import { ImageFormatter } from './formatters/image.js';
import { ContinuationFormatter } from './formatters/continuation.js';
import { DocFormatter } from './formatters/doc.js';
import {
  formatFilename,
  resolveConversationTitle,
  DEFAULT_FILENAME_TEMPLATE,
} from './utils/filename.js';
import { createLogger } from './utils/logger.js';

const logger = createLogger('ContentScript');

const isTopFrame = typeof window === 'undefined' || window.self === window.top;
logger.debug(`Script initialized on: ${window.location.href} (isTopFrame: ${isTopFrame})`);

const continuationFormatter = new ContinuationFormatter();

function enrichConversation(conversation) {
  if (!conversation) return conversation;
  const platformName =
    typeof activeParser?.getPlatformName === 'function'
      ? activeParser.getPlatformName()
      : activeParser?.name || activeParser?.constructor?.name?.replace('Parser', '') || 'AI';
  conversation.title = resolveConversationTitle(
    conversation.title,
    platformName,
    typeof document !== 'undefined' ? document : null,
  );
  return conversation;
}

async function checkAndInjectContinuation() {
  try {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
    const res = await chrome.storage.local.get('pendingContinuation');
    const data = res?.pendingContinuation;
    if (!data || !data.payload) return;

    // Expire pending continuation after 5 minutes
    if (Date.now() - (data.timestamp || 0) > 300000) {
      await chrome.storage.local.remove('pendingContinuation');
      return;
    }

    const inputSelectors = [
      '#prompt-textarea',
      'div[contenteditable="true"]',
      'textarea',
      '.user-prompt textarea',
      'ms-prompt-editor textarea',
    ];

    let inputEl = null;
    for (const sel of inputSelectors) {
      inputEl = document.querySelector(sel);
      if (inputEl) break;
    }

    if (inputEl) {
      if (inputEl.tagName === 'TEXTAREA' || inputEl.tagName === 'INPUT') {
        inputEl.value = data.payload;
        inputEl.dispatchEvent(new Event('input', { bubbles: true }));
        inputEl.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        inputEl.textContent = data.payload;
        inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      }

      await chrome.storage.local.remove('pendingContinuation');
      logger.info('Auto-injected transferred conversation context.');
    }
  } catch (e) {
    logger.warn('Continuation injection check failed:', e);
  }
}

// Registry of available parsers
const parsers = [
  new ChatGPTParser(),
  new GeminiParser(),
  new ClaudeParser(),
  new QwenParser(),
  new PerplexityParser(),
  new DeepSeekParser(),
  new MetaParser(),
  new MistralParser(),
  new GoogleSearchAIParser(),
  new ZAiParser(),
  new GeminiCloudAssistParser(),
  new GoogleAIStudioParser(),
  new NotebookLMParser(),
  new CopilotParser(),
  new LumoParser(),
  new JoylandParser(),
  new ChubParser(),
  new ArticleParser(),
];

// Registry of formatters
const formatters = {
  markdown: new MarkdownFormatter(),
  json: new JsonFormatter(),
  html: new HtmlFormatter(),
  png: new ImageFormatter(),
  doc: new DocFormatter(),
};

async function ensureHtml2CanvasLoaded() {
  if (typeof window !== 'undefined' && window.html2canvas) return;
  try {
    const scriptUrl = chrome.runtime.getURL('content/lib/html2canvas.min.js');
    await import(scriptUrl);
  } catch (e) {
    console.warn(
      '[AI Exporter ContentScript] Dynamic import of html2canvas failed, attempting script injection:',
      e,
    );
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = chrome.runtime.getURL('content/lib/html2canvas.min.js');
      s.onload = resolve;
      s.onerror = reject;
      (document.head || document.documentElement).appendChild(s);
    });
  }
}

function stripImages(content) {
  if (!content) return '';
  // 1. Remove markdown images
  let cleaned = content.replace(/!\[.*?\]\(.*?\)/g, '');

  // 2. Clean up leftover bullet points that are now empty
  cleaned = cleaned.replace(/^\s*[-*+]\s*$/gm, '');

  // 3. Remove **Images:** header if it has no bullets under it
  cleaned = cleaned.replace(/\*\*Images:\*\*\s*(?=\*\*|$)/gi, '');

  // 4. Remove **Attachments & Images:** section if it has no remaining attachments
  const attachmentSectionIndex = cleaned.indexOf('**Attachments & Images:**');
  if (attachmentSectionIndex !== -1) {
    const afterHeader = cleaned.slice(attachmentSectionIndex + '**Attachments & Images:**'.length);
    if (!/- \S/g.test(afterHeader)) {
      cleaned = cleaned.slice(0, attachmentSectionIndex);
    }
  }

  // 5. Collapse consecutive newlines
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();

  return cleaned;
}

let activeParser = null;

function detectParser() {
  const currentUrl = window.location.href;
  logger.debug('Detecting parser for URL:', currentUrl);
  activeParser = parsers.find((p) => p.isAvailable(currentUrl));
  if (activeParser) {
    const platformName =
      typeof activeParser.getPlatformName === 'function'
        ? activeParser.getPlatformName()
        : activeParser.name || activeParser.constructor.name.replace('Parser', '');
    logger.debug('Matched active parser:', platformName);
  } else {
    logger.debug('No parser matched for URL:', currentUrl);
  }
}

// Listen for messages from the popup
if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    const currentFrameIsTop = typeof window === 'undefined' || window.self === window.top;
    logger.debug(
      `Message received: action=${request.action} on frame=${currentFrameIsTop ? 'TOP' : 'IFRAME'}`,
    );

    if (request.action === 'CHECK_AVAILABILITY') {
      detectParser();
      if (activeParser) {
        (async () => {
          try {
            logger.debug('Executing activeParser.parse({ full: false })...');
            const conversation = enrichConversation(await activeParser.parse({ full: false }));
            logger.debug(
              `Availability check parsed ${conversation.messages.length} messages, title: "${conversation.title || ''}"`,
            );
            if (!currentFrameIsTop && conversation.messages.length === 0) {
              logger.debug('Subframe has 0 messages, ignoring subframe response');
              return;
            }
            const platformName =
              typeof activeParser.getPlatformName === 'function'
                ? activeParser.getPlatformName()
                : activeParser.name || activeParser.constructor.name.replace('Parser', '');
            const responseData = {
              available: true,
              platform: platformName,
              count: conversation.messages.length,
              title: conversation.title || '',
            };
            logger.debug('Sending CHECK_AVAILABILITY response:', responseData);
            sendResponse(responseData);
          } catch (e) {
            logger.error('Check availability parse threw error:', e);
            if (currentFrameIsTop) {
              const platformName =
                typeof activeParser.getPlatformName === 'function'
                  ? activeParser.getPlatformName()
                  : activeParser.name || activeParser.constructor.name.replace('Parser', '');
              sendResponse({
                available: true,
                platform: platformName,
                count: 0,
                title: '',
              });
            }
          }
        })();
        return true;
      } else if (currentFrameIsTop) {
        logger.debug('No active parser on top frame, sending available: false');
        sendResponse({ available: false });
      }
    }

    if (request.action === 'EXPORT_CHAT') {
      if (!activeParser) {
        detectParser();
      }
      if (!activeParser) {
        sendResponse({ success: false, error: 'No parser available' });
        return true;
      }

      const formatter = formatters[request.format];
      if (!formatter) {
        sendResponse({ success: false, error: 'Invalid format' });
        return true;
      }

      (async () => {
        try {
          const conversation = enrichConversation(
            await activeParser.parse({
              full: true,
              parserMode: request.parserMode || 'auto',
              includeImages: request.includeImages !== false,
            }),
          );
          if (request.includeImages === false) {
            conversation.messages.forEach((msg) => {
              if (msg.content) {
                msg.content = stripImages(msg.content);
              }
            });
          }
          if (request.format === 'png') {
            await ensureHtml2CanvasLoaded();
          }
          const options = {
            highQuality: request.highQualityPng !== false,
            theme: request.theme,
          };
          const formattedResult = await formatter.format(conversation, options);
          const mimeType = formatter.getMimeType();
          const blob =
            formattedResult instanceof Blob
              ? formattedResult
              : new Blob(
                  formatter.getFileExtension() === 'doc'
                    ? ['\ufeff', formattedResult]
                    : [formattedResult],
                  { type: `${mimeType};charset=utf-8` },
                );

          // Trigger download
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;

          let downloadName;
          if (request.customFilename && request.customFilename.trim().length > 0) {
            const userCustom = request.customFilename.trim().replace(/[\\/:*?"<>|]/g, '');
            downloadName = userCustom.endsWith(`.${formatter.getFileExtension()}`)
              ? userCustom
              : `${userCustom}.${formatter.getFileExtension()}`;
          } else {
            let filenameTemplate = DEFAULT_FILENAME_TEMPLATE;
            try {
              const syncData = await chrome.storage.sync.get('filenameTemplate');
              if (syncData && syncData.filenameTemplate) {
                filenameTemplate = syncData.filenameTemplate;
              }
            } catch {
              // Fallback to default
            }
            const platformName =
              typeof activeParser.getPlatformName === 'function'
                ? activeParser.getPlatformName()
                : activeParser.name || activeParser.constructor.name.replace('Parser', '');
            const formattedName = formatFilename(filenameTemplate, {
              platform: platformName,
              title: conversation.title || 'Conversation',
            });
            downloadName = `${formattedName}.${formatter.getFileExtension()}`;
          }

          a.download = downloadName;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);

          sendResponse({ success: true });
        } catch (e) {
          console.error(e);
          sendResponse({ success: false, error: e.message });
        }
      })();
      return true; // Indicates async response
    }

    if (request.action === 'COPY_CHAT') {
      if (!activeParser) {
        detectParser();
      }
      if (!activeParser) {
        sendResponse({ success: false, error: 'No parser available' });
        return true;
      }

      const formatter = formatters[request.format];
      if (!formatter) {
        sendResponse({ success: false, error: 'Invalid format' });
        return true;
      }

      (async () => {
        try {
          const conversation = enrichConversation(
            await activeParser.parse({
              full: true,
              parserMode: request.parserMode || 'auto',
              includeImages: request.includeImages !== false,
            }),
          );
          if (request.includeImages === false) {
            conversation.messages.forEach((msg) => {
              if (msg.content) {
                msg.content = stripImages(msg.content);
              }
            });
          }
          console.log('Parsed conversation with', conversation.messages.length, 'messages');
          const formatOptions = request.theme ? { theme: request.theme } : {};
          const primaryContent = formatter.format(conversation, formatOptions);
          const htmlFormatter = formatters.html;
          const richHtmlContent = htmlFormatter
            ? htmlFormatter.format(conversation, formatOptions)
            : null;

          sendResponse({
            success: true,
            content: primaryContent,
            htmlContent: richHtmlContent,
            conversation: conversation,
          });
        } catch (e) {
          console.error(e);
          sendResponse({ success: false, error: e.message });
        }
      })();
      return true;
    }

    if (request.action === 'GET_CONTINUATION_PAYLOAD') {
      if (!activeParser) {
        sendResponse({ success: false, error: 'No parser available' });
        return true;
      }

      (async () => {
        try {
          const conversation = enrichConversation(
            await activeParser.parse({
              full: true,
              parserMode: request.parserMode || 'auto',
              includeImages: request.includeImages !== false,
            }),
          );
          if (request.includeImages === false) {
            conversation.messages.forEach((msg) => {
              if (msg.content) {
                msg.content = stripImages(msg.content);
              }
            });
          }
          const platformName =
            typeof activeParser.getPlatformName === 'function'
              ? activeParser.getPlatformName()
              : activeParser.name || activeParser.constructor.name.replace('Parser', '');
          conversation.metadata = { ...conversation.metadata, Source: platformName };
          const payload = continuationFormatter.format(conversation, request.instruction || '');

          sendResponse({ success: true, payload });
        } catch (e) {
          console.error(e);
          sendResponse({ success: false, error: e.message });
        }
      })();
      return true;
    }

    if (request.action === 'EXECUTE_SHORTCUT') {
      const isTopFrame = typeof window === 'undefined' || window.self === window.top;
      if (!activeParser) {
        detectParser();
      }
      if (!activeParser) {
        if (isTopFrame) {
          showExporterToast('⚠️ No supported AI chat found on this tab', 'error');
        }
        sendResponse({ success: false, error: 'No parser available' });
        return true;
      }

      const shortcut = request.shortcutAction;

      (async () => {
        try {
          const conversation = enrichConversation(
            await activeParser.parse({
              full: true,
              parserMode: 'auto',
              includeImages: true,
            }),
          );

          if (!conversation || !conversation.messages || conversation.messages.length === 0) {
            if (isTopFrame) {
              showExporterToast('⚠️ No messages found in conversation', 'error');
            }
            sendResponse({ success: false, error: 'No messages found' });
            return;
          }

          const formatter = formatters.markdown;
          const markdownContent = formatter.format(conversation);

          if (shortcut === 'copy_markdown') {
            const copied = await copyToClipboard(markdownContent);
            if (copied && isTopFrame) {
              showExporterToast('📋 Markdown copied to clipboard!');
            }
            sendResponse({ success: copied });
          } else if (shortcut === 'download_markdown') {
            const mimeType = formatter.getMimeType();
            const blob = new Blob([markdownContent], { type: `${mimeType};charset=utf-8` });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;

            let filenameTemplate = DEFAULT_FILENAME_TEMPLATE;
            try {
              const syncData = await chrome.storage.sync.get('filenameTemplate');
              if (syncData && syncData.filenameTemplate) {
                filenameTemplate = syncData.filenameTemplate;
              }
            } catch {
              // Fallback to default
            }
            const platformName =
              typeof activeParser.getPlatformName === 'function'
                ? activeParser.getPlatformName()
                : activeParser.name || activeParser.constructor.name.replace('Parser', '');
            const formattedName = formatFilename(filenameTemplate, {
              platform: platformName,
              title: conversation.title || 'Conversation',
            });
            a.download = `${formattedName}.${formatter.getFileExtension()}`;

            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            if (isTopFrame) {
              showExporterToast('📥 Markdown file downloaded!');
            }
            sendResponse({ success: true });
          } else {
            sendResponse({ success: false, error: 'Unknown shortcut action' });
          }
        } catch (e) {
          console.error('[AI Exporter] Shortcut action failed:', e);
          if (isTopFrame) {
            showExporterToast('⚠️ Failed to export conversation', 'error');
          }
          sendResponse({ success: false, error: e.message });
        }
      })();
      return true;
    }
  });
}

async function copyToClipboard(text) {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (err) {
    console.warn('[AI Exporter] navigator.clipboard failed, attempting fallback:', err);
  }
  try {
    if (typeof document !== 'undefined') {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.left = '-9999px';
      textarea.style.top = '-9999px';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const successful = document.execCommand('copy');
      document.body.removeChild(textarea);
      if (successful) return true;
    }
  } catch (err) {
    console.error('[AI Exporter] execCommand fallback failed:', err);
  }
  return false;
}

function showExporterToast(message, type = 'success') {
  if (typeof document === 'undefined' || !document.body) return;
  const isTopFrame = typeof window === 'undefined' || window.self === window.top;
  if (!isTopFrame) return;

  const existingToast = document.getElementById('ai-chat-exporter-toast');
  if (existingToast) {
    existingToast.remove();
  }

  const toast = document.createElement('div');
  toast.id = 'ai-chat-exporter-toast';
  toast.textContent = message;
  Object.assign(toast.style, {
    position: 'fixed',
    top: '20px',
    right: '20px',
    zIndex: '2147483647',
    padding: '10px 16px',
    backgroundColor: type === 'error' ? '#ef4444' : '#0f172a',
    color: '#ffffff',
    fontSize: '13px',
    fontWeight: '500',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    borderRadius: '8px',
    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.25), 0 0 0 1px rgba(255, 255, 255, 0.1)',
    backdropFilter: 'blur(8px)',
    opacity: '0',
    transform: 'translateY(-8px)',
    transition: 'opacity 0.2s ease, transform 0.2s ease',
    pointerEvents: 'none',
  });

  (document.body || document.documentElement).appendChild(toast);

  if (typeof requestAnimationFrame !== 'undefined') {
    requestAnimationFrame(() => {
      toast.style.opacity = '1';
      toast.style.transform = 'translateY(0)';
    });
  } else {
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0)';
  }

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-8px)';
    setTimeout(() => {
      if (toast.parentNode) {
        toast.remove();
      }
    }, 250);
  }, 2500);
}

// Initial detection & continuation check
detectParser();
checkAndInjectContinuation();
