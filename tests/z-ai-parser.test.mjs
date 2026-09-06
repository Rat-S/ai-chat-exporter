import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseHTML } from 'linkedom';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('ZAiParser correctly extracts user and assistant messages', async () => {
  const html = fs.readFileSync(path.join(__dirname, 'fixtures/z-ai-chat.html'), 'utf8');
  const { window, document, HTMLElement, Node, DOMParser } = parseHTML(html);

  // Expose browser globals
  global.window = window;
  global.document = document;
  global.HTMLElement = HTMLElement;
  global.Node = Node;
  global.DOMParser = DOMParser;

  const { ZAiParser } = await import('decant-core');
  const parser = new ZAiParser();

  const result = await parser.parse();
  assert.equal(result.title, 'Z.ai - Advanced AI Chatbot & Agent powered by GLM-5.2');
  assert.equal(result.messages.length, 2);

  assert.equal(result.messages[0].role, 'User');
  assert.match(result.messages[0].content, /Please write a short response/);
  assert.match(result.messages[0].content, /deadrat\.in/);

  assert.equal(result.messages[1].role, 'Z.ai');
  assert.match(result.messages[1].content, /It is fascinating how different nations/);
  assert.match(result.messages[1].content, /```elixir/);
  assert.match(result.messages[1].content, /IO\.puts\("Hello, World!"\)/);
  assert.match(result.messages[1].content, /\| Country \|/);
  assert.match(result.messages[1].content, /Denmark/);
  assert.match(result.messages[1].content, /\$e\^\{i\\pi\} \+ 1 = 0\$/);
});
