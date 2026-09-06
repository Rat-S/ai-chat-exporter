import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseHTML } from 'linkedom';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('GeminiParser correctly parses chat content from fixture', async () => {
  const html = fs.readFileSync(path.join(__dirname, 'fixtures/gemini-chat.html'), 'utf8');
  const { window, document, HTMLElement, Node, DOMParser } = parseHTML(html);

  // Expose browser globals for parser and Turndown dependencies
  global.window = window;
  global.document = document;
  global.HTMLElement = HTMLElement;
  global.Node = Node;
  global.DOMParser = DOMParser;

  // Mock window.location
  window.location = { href: 'https://gemini.google.com/app' };

  const { GeminiParser } = await import('decant-core');
  const parser = new GeminiParser();

  const result = await parser.parse();

  assert.equal(result.title, 'Gemini Conversation');
  assert.equal(result.messages.length, 2);
  assert.equal(result.messages[0].role, 'User');
  assert.equal(
    result.messages[0].content,
    'Please write a short response that includes:   \n' +
      ' 1. A paragraph containing **bold text**, *italic text*, and a [link to deadrat.in](https://www.deadrat.in/).   \n' +
      ' 2. A code block in Elixir showing a hello world.   \n' +
      ' 3. A simple table of a few countries (maybe denmark, sweden, USA, India, Pakistan, Nigeria) showing: median wages, average work hours per week, paid leave days, and union membership rate.    \n' +
      " 4. A math equation using LaTeX, maybe Euler's Identity.",
  );
  assert.equal(result.messages[1].role, 'Model');
  assert.equal(
    result.messages[1].content,
    "Here is a concise response combining your requested elements. It features **bold text** to grab your attention, *italic text* for emphasis, and a quick [link to deadrat.in](https://www.deadrat.in/) to fulfill your prompt's requirements.\n\n" +
      '```elixir\n' +
      'IO.puts("Hello, World!")\n' +
      '```\n\n' +
      '| Country | Est. Median Wage (USD/yr) | Avg Work Hours/Week | Min. Paid Leave Days | Est. Union Membership |\n' +
      '| --- | --- | --- | --- | --- |\n' +
      '| Denmark | ~$44,000 | 37 | 25 | ~65% |\n' +
      '| Sweden | ~$42,000 | 40 | 25 | ~68% |\n' +
      '| USA | ~$46,000 | 40 | 0 (Federal) | ~10% |\n' +
      '| India | ~$3,000 | 48 | 15 | ~10% |\n' +
      '| Pakistan | ~$1,500 | 48 | 14 | ~5% |\n' +
      '| Nigeria | ~$1,800 | 40 | 15 | ~12% |\n\n' +
      '> *Note: Wage and union figures are approximate global estimates and can vary based on specific industries and current exchange rates.*\n\n\n\n' +
      '$$e^{i\\pi} + 1 = 0$$',
  );
});

test('GeminiParser extracts title from document.title if valid', async () => {
  const { window, document, HTMLElement, Node, DOMParser } = parseHTML('<div></div>');
  global.window = window;
  global.document = document;
  global.HTMLElement = HTMLElement;
  global.Node = Node;
  global.DOMParser = DOMParser;

  document.title = 'The Core Difference - Google Gemini';
  window.location = { href: 'https://gemini.google.com/app' };

  const { GeminiParser } = await import('decant-core');
  const parser = new GeminiParser();
  const result = await parser.parse();

  assert.equal(result.title, 'The Core Difference');
});

test('GeminiParser extracts title from active navigation if document.title is generic', async () => {
  const { window, document, HTMLElement, Node, DOMParser } = parseHTML(
    '<div><a class="selected">Sidebar Title <span class="more-options">more_vert</span></a></div>',
  );
  global.window = window;
  global.document = document;
  global.HTMLElement = HTMLElement;
  global.Node = Node;
  global.DOMParser = DOMParser;

  document.title = 'Gemini';
  window.location = { href: 'https://gemini.google.com/app' };

  const { GeminiParser } = await import('decant-core');
  const parser = new GeminiParser();
  const result = await parser.parse();

  assert.equal(result.title, 'Sidebar Title');
});

test('GeminiParser does not extract title from headers inside chat messages', async () => {
  const { window, document, HTMLElement, Node, DOMParser } = parseHTML(
    '<div class="conversation-container">' +
      '  <model-response>' +
      '    <message-content>' +
      '      <div class="markdown">' +
      '        <h1>Header inside Message</h1>' +
      '      </div>' +
      '    </message-content>' +
      '  </model-response>' +
      '</div>',
  );
  global.window = window;
  global.document = document;
  global.HTMLElement = HTMLElement;
  global.Node = Node;
  global.DOMParser = DOMParser;

  document.title = 'Gemini';
  window.location = { href: 'https://gemini.google.com/app' };

  const { GeminiParser } = await import('decant-core');
  const parser = new GeminiParser();
  const result = await parser.parse();

  // Should fall back to 'Gemini Conversation' because the <h1> is inside a message
  assert.equal(result.title, 'Gemini Conversation');
});

test('GeminiParser parses real multi-turn conversation from fixture', async () => {
  const fixturePath = path.join(__dirname, 'fixtures/gemini-multiturn.html');
  const html = fs.readFileSync(fixturePath, 'utf8');
  const { window, document, HTMLElement, Node, DOMParser } = parseHTML(html);

  global.window = window;
  global.document = document;
  global.HTMLElement = HTMLElement;
  global.Node = Node;
  global.DOMParser = DOMParser;
  window.location = { href: 'https://gemini.google.com/app/test-convo-id' };

  const { GeminiParser } = await import('decant-core');
  const parser = new GeminiParser();
  const result = await parser.parse({ parserMode: 'dom' });

  assert.equal(result.title, 'Formatting Text and Links');
  assert.equal(result.messages.length, 8);
  assert.equal(result.messages[0].role, 'User');
  assert.ok(
    result.messages[0].content.includes('bold text, italic text, and a link to deadrat.in'),
  );
  assert.equal(result.messages[1].role, 'Model');
  assert.ok(result.messages[1].content.includes('strong technical execution'));
  assert.equal(result.messages[2].role, 'User');
  assert.ok(result.messages[2].content.includes('Elixir showing a hello world'));
  assert.equal(result.messages[3].role, 'Model');
  assert.ok(result.messages[3].content.includes('IO.puts("Hello, World!")'));
  assert.equal(result.messages[5].role, 'Model');
  assert.ok(result.messages[5].content.includes('| Language | Native Script |'));
  assert.equal(result.messages[7].role, 'Model');
  assert.ok(result.messages[7].content.includes('$$e^{i\\pi} + 1 = 0$$'));
});

test('GeminiParser rejects API response when it contains conversation IDs and falls back to DOM', async () => {
  const html = fs.readFileSync(path.join(__dirname, 'fixtures/gemini-chat.html'), 'utf8');
  const { window, document, HTMLElement, Node, DOMParser } = parseHTML(html);

  global.window = window;
  global.document = document;
  global.HTMLElement = HTMLElement;
  global.Node = Node;
  global.DOMParser = DOMParser;
  window.location = { href: 'https://gemini.google.com/app/27959a7cc57dfb66' };

  window.WIZ_global_data = {
    SNlM0e: 'mock-token',
    FdrFJe: 'mock-sid',
  };

  const { GeminiParser } = await import('decant-core');
  const parser = new GeminiParser();

  global.fetch = async () => {
    return {
      text: async () =>
        ')]}\'\n[["wrb.fr","hNvQHb","[[[\\"c_27959a7cc57dfb66\\",\\"c_27959a7cc57dfb66\\"]]]"]]',
    };
  };

  const result = await parser.parse();

  assert.equal(result.messages[0].role, 'User');
  assert.notEqual(result.messages[0].content, 'c_27959a7cc57dfb66');
  assert.ok(result.messages[0].content.includes('bold text'));
  assert.equal(result.metadata.Method, 'DOM');
});
