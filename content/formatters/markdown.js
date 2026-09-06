import { ExportFormatter } from './base.js';

function cleanLatexMath(latex) {
  if (!latex || typeof latex !== 'string') return '';
  return latex.replace(/\\\\([a-zA-Z]+)/g, '\\$1').replace(/\\([_\][*])/g, '$1');
}

export function normalizeLatexMath(text) {
  if (!text || typeof text !== 'string') return '';

  const placeholders = [];
  let tokenCounter = 0;

  // 1. Protect fenced code blocks (``` ... ``` or ~~~ ... ~~~)
  let processed = text.replace(/(```[\s\S]*?```|~~~[\s\S]*?~~~)/g, (match) => {
    const id = `@@MATH_CODE_BLOCK_${tokenCounter++}@@`;
    placeholders.push({ id, content: match });
    return id;
  });

  // 2. Protect inline code (`...`)
  processed = processed.replace(/`([^`\n]+?)`/g, (match) => {
    const id = `@@MATH_INLINE_CODE_${tokenCounter++}@@`;
    placeholders.push({ id, content: match });
    return id;
  });

  // 3. Protect existing display math ($$ ... $$) and clean any escaped LaTeX syntax
  processed = processed.replace(/\$\$([\s\S]*?)\$\$/g, (match, math) => {
    const id = `@@MATH_DISPLAY_${tokenCounter++}@@`;
    placeholders.push({ id, content: `$$${cleanLatexMath(math)}$$` });
    return id;
  });

  // 4. Protect existing inline math ($ ... $) and clean any escaped LaTeX syntax
  processed = processed.replace(/\$([^$\n]+?)\$/g, (match, math) => {
    const id = `@@MATH_INLINE_${tokenCounter++}@@`;
    placeholders.push({ id, content: `$${cleanLatexMath(math)}$` });
    return id;
  });

  // 5. Convert display math: \[ ... \] or \\[ ... \\]
  processed = processed.replace(/(?:\\{1,2}\[)([\s\S]+?)(?:\\{1,2}\])/g, (match, math) => {
    return `$$${cleanLatexMath(math).trim()}$$`;
  });

  // 6. Convert inline math: \( ... \) or \\( ... \\)
  processed = processed.replace(/(?:\\{1,2}\()([\s\S]+?)(?:\\{1,2}\))/g, (match, math) => {
    return `$${cleanLatexMath(math).trim()}$`;
  });

  // 7. Collapse excessive blank lines outside protected code
  processed = processed.replace(/\n{3,}/g, '\n\n');

  // 8. Restore protected items in reverse order
  for (let i = placeholders.length - 1; i >= 0; i--) {
    const { id, content } = placeholders[i];
    processed = processed.replace(id, () => content);
  }

  return processed;
}

export class MarkdownFormatter extends ExportFormatter {
  format(conversation) {
    const { title, messages } = conversation;
    const now = new Date();
    const formattedDate = `${now.getMonth() + 1}/${now.getDate()}/${now.getFullYear()} ${now.toLocaleTimeString('en-US', { hour12: false })}`;

    let output = `# ${title || 'AI Chat Export'}\n\n`;

    output += `**Exported with:** [AI Chat Exporter](https://ai-chat-exporter.covai.org)  \n`;

    const metadata = conversation.metadata || {};
    const platform = metadata.Source || 'AI';
    const date = metadata.Date || formattedDate;
    const link = conversation.url || metadata.Link || '';
    const model = metadata.Model;
    const method = metadata.Method;

    output += `**Source:** ${platform}  \n`;
    output += `**Date:** ${date}  \n`;

    if (link) {
      output += `**Link:** [${link}](${link})  \n`;
    }

    if (model) {
      output += `**Model:** ${model}  \n`;
    }

    if (method) {
      output += `**Method:** ${method}  \n`;
    }

    const standardKeys = new Set(['Source', 'Date', 'Link', 'Model', 'Method']);
    Object.entries(metadata).forEach(([key, value]) => {
      if (!standardKeys.has(key) && value) {
        if (typeof value === 'string' && value.startsWith('http')) {
          output += `**${key}:** [${value}](${value})  \n`;
        } else {
          output += `**${key}:** ${value}  \n`;
        }
      }
    });

    output += `\n`;

    const isWebArticle = platform === 'Web Article' || platform === 'WebArticle';

    messages.forEach((msg) => {
      const isArticleRole = msg.role === 'Article' || msg.role === 'Web Article';
      if (isWebArticle || isArticleRole) {
        output += `${normalizeLatexMath(msg.content)}\n\n`;
      } else {
        const heading = msg.role === 'User' ? '## Prompt:' : '## Response:';
        output += `${heading}\n`;
        output += `${normalizeLatexMath(msg.content)}\n\n`;
      }
    });

    return output;
  }

  getFileExtension() {
    return 'md';
  }

  getMimeType() {
    return 'text/markdown';
  }
}
