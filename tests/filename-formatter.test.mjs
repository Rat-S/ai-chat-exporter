import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  formatFilename,
  DEFAULT_FILENAME_TEMPLATE,
  cleanPageTitle,
  isGenericTitle,
  resolveConversationTitle,
} from '../content/utils/filename.js';

test('DEFAULT_FILENAME_TEMPLATE is configured with platform, title, and datetime', () => {
  assert.equal(DEFAULT_FILENAME_TEMPLATE, '{platform} - {title} - {datetime}');
});

test('formatFilename formats filename using default template', () => {
  const fixedDate = new Date(2026, 7, 19, 14, 5); // 2026-08-19 14:05
  const result = formatFilename(DEFAULT_FILENAME_TEMPLATE, {
    platform: 'Gemini',
    title: 'Comparing Markdown and PDF',
    date: fixedDate,
  });

  assert.equal(result, 'Gemini - Comparing Markdown and PDF - 2026-08-19_14-05');
});

test('formatFilename supports custom templates and individual tokens', () => {
  const fixedDate = new Date(2026, 7, 19, 9, 3); // 2026-08-19 09:03

  // Date first format
  const dateFirst = formatFilename('{date} - {platform} - {title}', {
    platform: 'ChatGPT',
    title: 'Quantum Computing Intro',
    date: fixedDate,
  });
  assert.equal(dateFirst, '2026-08-19 - ChatGPT - Quantum Computing Intro');

  // Time and date format
  const timeAndDate = formatFilename('{platform} [{date} {time}] {title}', {
    platform: 'Claude',
    title: 'Refactoring React Hooks',
    date: fixedDate,
  });
  assert.equal(timeAndDate, 'Claude [2026-08-19 09-03] Refactoring React Hooks');

  // Minimal format
  const minimal = formatFilename('{platform}_{title}', {
    platform: 'DeepSeek',
    title: 'Math Proof',
    date: fixedDate,
  });
  assert.equal(minimal, 'DeepSeek_Math Proof');
});

test('formatFilename sanitizes illegal filename characters', () => {
  const fixedDate = new Date(2026, 7, 19, 10, 0);
  const dirtyTitle = 'What is 10/2? *Are you sure:* "Yes" <maybe> | test';
  const result = formatFilename(DEFAULT_FILENAME_TEMPLATE, {
    platform: 'Gemini/Pro',
    title: dirtyTitle,
    date: fixedDate,
  });

  assert.ok(!/[/\\?%*:|"<>]/g.test(result), 'Filename should not contain illegal characters');
  assert.equal(result, 'GeminiPro - What is 102 Are you sure Yes maybe test - 2026-08-19_10-00');
});

test('formatFilename handles empty or missing inputs gracefully', () => {
  const fixedDate = new Date(2026, 7, 19, 10, 0);

  // Missing options
  const defaultResult = formatFilename(undefined, { date: fixedDate });
  assert.equal(defaultResult, 'AI - Conversation - 2026-08-19_10-00');

  // Empty string template
  const emptyTemplateResult = formatFilename('', {
    platform: 'Claude',
    title: 'My Chat',
    date: fixedDate,
  });
  assert.equal(emptyTemplateResult, 'Claude - My Chat - 2026-08-19_10-00');
});

test('cleanPageTitle strips platform brands, prefixes, and suffixes correctly', () => {
  assert.equal(
    cleanPageTitle('Google Gemini - Comparing Markdown and PDF', 'Gemini'),
    'Comparing Markdown and PDF',
  );
  assert.equal(
    cleanPageTitle('Comparing Markdown and PDF - Gemini', 'Gemini'),
    'Comparing Markdown and PDF',
  );
  assert.equal(
    cleanPageTitle('Comparing Markdown and PDF | Perplexity', 'Perplexity'),
    'Comparing Markdown and PDF',
  );
  assert.equal(
    cleanPageTitle('ChatGPT - React Design Patterns', 'ChatGPT'),
    'React Design Patterns',
  );
  assert.equal(
    cleanPageTitle('Comparing Markdown and PDF - Le Chat', 'Mistral'),
    'Comparing Markdown and PDF',
  );
  assert.equal(cleanPageTitle('Google Gemini', 'Gemini'), '');
  assert.equal(cleanPageTitle('ChatGPT', 'ChatGPT'), '');
  assert.equal(cleanPageTitle('', 'Claude'), '');
});

test('isGenericTitle detects placeholder and platform titles', () => {
  assert.equal(isGenericTitle(''), true);
  assert.equal(isGenericTitle('Conversation'), true);
  assert.equal(isGenericTitle('Gemini Conversation', 'Gemini'), true);
  assert.equal(isGenericTitle('New chat', 'ChatGPT'), true);
  assert.equal(isGenericTitle('ChatGPT', 'ChatGPT'), true);
  assert.equal(isGenericTitle('Untitled Chat'), true);
  assert.equal(isGenericTitle('Comparing Markdown and PDF', 'Gemini'), false);
  assert.equal(isGenericTitle('DeepSeek Reasoning Trace', 'DeepSeek'), false);
});

test('resolveConversationTitle falls back to HTML head title when parser title is generic', () => {
  const mockDoc = {
    querySelector: (selector) => {
      if (selector === 'title') {
        return { textContent: 'Comparing Markdown and PDF - Google Gemini' };
      }
      return null;
    },
    title: 'Comparing Markdown and PDF - Google Gemini',
  };

  // When conversation title is generic, fallback to cleaned <title>
  const fallbackResult = resolveConversationTitle('Gemini Conversation', 'Gemini', mockDoc);
  assert.equal(fallbackResult, 'Comparing Markdown and PDF');

  // When conversation title is empty, fallback to cleaned <title>
  const emptyResult = resolveConversationTitle('', 'Gemini', mockDoc);
  assert.equal(emptyResult, 'Comparing Markdown and PDF');

  // When conversation title is already meaningful, keep it
  const explicitResult = resolveConversationTitle('Explicit Title', 'Gemini', mockDoc);
  assert.equal(explicitResult, 'Explicit Title');

  // When mockDoc has generic title as well, fallback to default
  const genericDoc = {
    title: 'Google Gemini',
  };
  const defaultFallback = resolveConversationTitle('Gemini Conversation', 'Gemini', genericDoc);
  assert.equal(defaultFallback, 'Gemini Conversation');
});

test('formatFilename uses HTML head title fallback when doc is provided and title is generic', () => {
  const fixedDate = new Date(2026, 7, 19, 10, 0);
  const mockDoc = {
    title: 'Google Gemini - Comparing Markdown and PDF',
  };

  const result = formatFilename(DEFAULT_FILENAME_TEMPLATE, {
    platform: 'Gemini',
    title: 'Gemini Conversation',
    date: fixedDate,
    doc: mockDoc,
  });

  assert.equal(result, 'Gemini - Comparing Markdown and PDF - 2026-08-19_10-00');
});
