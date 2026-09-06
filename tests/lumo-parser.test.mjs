import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseHTML } from 'linkedom';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('LumoParser correctly matches URL and extracts conversation', async () => {
  const html = fs.readFileSync(path.join(__dirname, 'fixtures/lumo-chat.html'), 'utf8');
  const { window, document, HTMLElement, Node, DOMParser } = parseHTML(html);

  // Expose browser globals
  global.window = window;
  global.document = document;
  global.HTMLElement = HTMLElement;
  global.Node = Node;
  global.DOMParser = DOMParser;

  const { LumoParser } = await import('decant-core');
  const parser = new LumoParser();

  assert.equal(
    parser.isAvailable('https://lumo.proton.me/guest/c/e9b48246-ae23-4092-8324-6ef3bd49f02f'),
    true,
  );
  assert.equal(parser.isAvailable('https://chatgpt.com'), false);

  const result = await parser.parse();
  assert.equal(result.title, 'Elixir Code And Work Data');
  assert.equal(result.messages.length, 2);

  // User Message
  assert.equal(result.messages[0].role, 'User');
  assert.match(result.messages[0].content, /Please write a short response/);
  assert.match(result.messages[0].content, /deadrat\.in/);

  // Assistant Message
  assert.equal(result.messages[1].role, 'Lumo');
  assert.match(result.messages[1].content, /bold statement/);
  assert.match(result.messages[1].content, /deadrat\.in/);
  assert.match(result.messages[1].content, /```elixir/);
  assert.match(result.messages[1].content, /IO\.puts\("Hello, World!"\)/);
  assert.match(result.messages[1].content, /\| Country \|/);
  assert.match(result.messages[1].content, /Denmark/);
  assert.match(result.messages[1].content, /e\^\{i\\pi\} \+ 1 = 0/);
});
