/**
 * Utility for formatting and sanitizing export filenames using templates.
 */

export const DEFAULT_FILENAME_TEMPLATE = '{platform} - {title} - {datetime}';

/**
 * Strips common platform brand prefixes/suffixes and delimiters from raw HTML <title>.
 *
 * @param {string} rawTitle - Raw document title string.
 * @param {string} [platform=''] - Platform name to prioritize stripping.
 * @returns {string} Cleaned title string without platform branding.
 */
export function cleanPageTitle(rawTitle, platform = '') {
  if (!rawTitle || typeof rawTitle !== 'string') return '';
  let cleaned = rawTitle.replace(/\s+/g, ' ').trim();

  const brandPatterns = [
    /^(?:Google\s+)?Gemini(?:\s+Advanced)?\s*[-–—|:]\s*/i,
    /\s*[-–—|:]\s*(?:Google\s+)?Gemini(?:\s+Advanced)?$/i,
    /^ChatGPT\s*[-–—|:]\s*/i,
    /\s*[-–—|:]\s*ChatGPT$/i,
    /^Claude\s*[-–—|:]\s*/i,
    /\s*[-–—|:]\s*Claude$/i,
    /^DeepSeek\s*[-–—|:]\s*/i,
    /\s*[-–—|:]\s*DeepSeek$/i,
    /^Perplexity\s*[-–—|:]\s*/i,
    /\s*[-–—|:]\s*Perplexity$/i,
    /^Mistral(?:\s+AI)?\s*[-–—|:]\s*/i,
    /\s*[-–—|:]\s*(?:Le Chat|Mistral(?:\s+AI)?)$/i,
    /^(?:Microsoft\s+)?Copilot\s*[-–—|:]\s*/i,
    /\s*[-–—|:]\s*(?:Microsoft\s+)?Copilot$/i,
    /^Google AI Studio\s*[-–—|:]\s*/i,
    /\s*[-–—|:]\s*Google AI Studio$/i,
    /^NotebookLM\s*[-–—|:]\s*/i,
    /\s*[-–—|:]\s*NotebookLM$/i,
  ];

  if (platform && typeof platform === 'string' && platform.trim().length > 0) {
    const escaped = platform.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    brandPatterns.unshift(
      new RegExp(`^(?:Google\\s+)?${escaped}\\s*[-–—|:]\\s*`, 'i'),
      new RegExp(`\\s*[-–—|:]\\s*(?:Google\\s+)?${escaped}$`, 'i'),
    );
  }

  for (const pattern of brandPatterns) {
    cleaned = cleaned.replace(pattern, '').trim();
  }

  // Strip leading/trailing punctuation/separators
  cleaned = cleaned.replace(/^[-–—|:·/\\\s]+|[-–—|:·/\\\s]+$/g, '').trim();

  if (isGenericTitle(cleaned, platform)) {
    return '';
  }

  return cleaned;
}

/**
 * Checks if a title is a generic placeholder or matches only the platform name.
 *
 * @param {string} title
 * @param {string} [platform='']
 * @returns {boolean}
 */
export function isGenericTitle(title, platform = '') {
  if (!title || typeof title !== 'string') return true;
  const t = title.trim().toLowerCase();
  if (!t || t.length <= 1) return true;

  const genericValues = new Set([
    'conversation',
    'chat',
    'ai conversation',
    'ai chat',
    'untitled',
    'untitled chat',
    'untitled conversation',
    'new chat',
    'new conversation',
    'chat export',
  ]);

  if (genericValues.has(t)) return true;

  if (platform && typeof platform === 'string') {
    const p = platform.trim().toLowerCase();
    if (t === p) return true;
    if (t === `${p} conversation` || t === `${p} chat`) return true;
    if (t === `google ${p}` || t === `google ${p} conversation` || t === `google ${p} chat`)
      return true;
  }

  const commonBrands = [
    'gemini',
    'google gemini',
    'gemini advanced',
    'chatgpt',
    'claude',
    'deepseek',
    'perplexity',
    'mistral',
    'mistral ai',
    'le chat',
    'copilot',
    'microsoft copilot',
    'google ai studio',
    'notebooklm',
    'qwen',
    'z.ai',
    'lumo',
  ];
  if (commonBrands.includes(t)) return true;

  return false;
}

/**
 * Resolves a conversation title, falling back to the HTML head <title> / document.title
 * when the parsed title is missing or generic.
 *
 * @param {string} [title] - Title extracted by the parser.
 * @param {string} [platform='AI'] - Platform name.
 * @param {Document|Object} [doc] - Document or object containing title property (defaults to global document).
 * @returns {string} The resolved title.
 */
export function resolveConversationTitle(
  title,
  platform = 'AI',
  doc = typeof document !== 'undefined' ? document : null,
) {
  const trimmed = typeof title === 'string' ? title.trim() : '';

  if (trimmed && !isGenericTitle(trimmed, platform)) {
    return trimmed;
  }

  if (doc) {
    const rawHeadTitle =
      (typeof doc.querySelector === 'function' ? doc.querySelector('title')?.textContent : null) ||
      doc.title ||
      '';
    const cleaned = cleanPageTitle(rawHeadTitle, platform);
    if (cleaned && !isGenericTitle(cleaned, platform)) {
      return cleaned;
    }
  }

  return trimmed || (platform ? `${platform} Conversation` : 'Conversation');
}

/**
 * Formats a filename based on a template string and contextual properties.
 *
 * @param {string} [template] - Template string with tokens like {platform}, {title}, {date}, {time}, {datetime}
 * @param {Object} [context]
 * @param {string} [context.platform='AI'] - Platform name (e.g. Gemini, ChatGPT, Claude)
 * @param {string} [context.title='Conversation'] - Chat or conversation title
 * @param {Date|number|string} [context.date=new Date()] - Date to format
 * @param {Document|Object} [context.doc] - Document for fallback title resolution
 * @returns {string} Sanitized filename without extension
 */
export function formatFilename(
  template,
  { platform = 'AI', title = 'Conversation', date = new Date(), doc } = {},
) {
  const now = date instanceof Date ? date : new Date(date || Date.now());
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');

  const resolved = resolveConversationTitle(title, platform, doc);

  // Sanitize title for filename usage (remove characters invalid across Windows/Linux/macOS)
  const cleanTitle =
    (resolved || 'Conversation')
      .replace(/[/\\?%*:|"<>]/g, '')
      .replace(/\s+/g, ' ')
      .trim() || 'Conversation';

  const cleanPlatform =
    (platform || 'AI')
      .replace(/[/\\?%*:|"<>]/g, '')
      .replace(/\s+/g, ' ')
      .trim() || 'AI';

  const replacements = {
    '{platform}': cleanPlatform,
    '{title}': cleanTitle,
    '{date}': `${yyyy}-${mm}-${dd}`,
    '{time}': `${hh}-${min}`,
    '{datetime}': `${yyyy}-${mm}-${dd}_${hh}-${min}`,
    '{timestamp}': `${yyyy}-${mm}-${dd}_${hh}-${min}`,
  };

  let formatted = (template && template.trim()) || DEFAULT_FILENAME_TEMPLATE;
  for (const [token, val] of Object.entries(replacements)) {
    formatted = formatted.replaceAll(token, val);
  }

  // Remove any remaining illegal filename characters and clean up whitespace
  const finalFilename = formatted
    .replace(/[/\\?%*:|"<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);

  return finalFilename || `${cleanPlatform} - ${cleanTitle}`;
}
