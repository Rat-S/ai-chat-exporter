import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseHTML } from 'linkedom';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('GoogleSearchAIParser correctly parses chat content from fixture', async () => {
  const html = fs.readFileSync(path.join(__dirname, 'fixtures/google-search-ai.html'), 'utf8');
  const { window, document, HTMLElement, Node, DOMParser } = parseHTML(html);

  global.window = window;
  global.document = document;
  global.HTMLElement = HTMLElement;
  global.Node = Node;
  global.DOMParser = DOMParser;

  window.location = { href: 'https://www.google.com/search?q=Please+write+a+short+response' };

  const { GoogleSearchAIParser } = await import('decant-core');
  const parser = new GoogleSearchAIParser();

  const result = await parser.parse();

  assert.equal(result.title, 'Google Search AI Overview');
  assert.equal(result.messages.length, 2);
  assert.equal(result.messages[0].role, 'User');
  assert.ok(result.messages[0].content.startsWith('Please write a short response that includes:'));

  assert.equal(result.messages[1].role, 'Model');
  assert.equal(
    result.messages[1].content,
    "It sounds like you're putting together a diverse set of requirements! Exploring global labor statistics can be quite **eye-opening**, especially when you look at how different cultures *balance* their professional and personal lives. If you're interested in checking out some unique creative projects, you should definitely visit deadrat.in.\n" +
      '\n' +
      'Here is a simple "Hello World" in Elixir:\n' +
      '\n' +
      '```elixir\n' +
      'IO.puts "Hello, world!"\n' +
      '```\n' +
      '\n' +
      'Global Labor Statistics (Estimates)\n' +
      '\n' +
      '| Country | Median Monthly Wage (USD) | Avg. Work Hours/Week | Paid Leave Days | Union Membership |\n' +
      '| --- | --- | --- | --- | --- |\n' +
      '| Denmark | ~$4,500 | 37 | 25 | ~67% |\n' +
      '| Sweden | ~$3,800 | 40 | 25 | ~65% |\n' +
      '| USA | ~$4,000 | 38 | 0 (No Fed Law) | ~10% |\n' +
      '| India | ~$350 | 48 | 12-15 | ~10-20% |\n' +
      '| Pakistan | ~$200 | 48+ | 14 | <5% |\n' +
      '| Nigeria | ~$150 | 40-48 | 6 | <10% |\n' +
      '\n' +
      "Finally, here is Euler's Identity, often cited as one of the most beautiful equations in mathematics:\n" +
      '\n' +
      '\n' +
      '\n' +
      '$$e^{i\\pi }+1=0$$',
  );
});

test('GoogleSearchAIParser correctly parses multi-turn SGE chat content from fixture', async () => {
  const html = fs.readFileSync(
    path.join(__dirname, 'fixtures/google-search-ai-multiturn.html'),
    'utf8',
  );
  const { window, document, HTMLElement, Node, DOMParser } = parseHTML(html);

  global.window = window;
  global.document = document;
  global.HTMLElement = HTMLElement;
  global.Node = Node;
  global.DOMParser = DOMParser;

  window.location = { href: 'https://www.google.com/search?q=Please+write+a+short+response' };

  const { GoogleSearchAIParser } = await import('decant-core');
  const parser = new GoogleSearchAIParser();

  const result = await parser.parse();

  assert.equal(result.title, 'Google Search AI Overview');
  assert.equal(result.messages.length, 4);

  // Turn 1
  assert.equal(result.messages[0].role, 'User');
  assert.ok(result.messages[0].content.includes('Please write a short response that includes:'));
  assert.equal(result.messages[1].role, 'Model');
  assert.ok(
    result.messages[1].content.includes(
      'Here are the requested elements tailored to your specific formatting needs',
    ),
  );
  assert.ok(result.messages[1].content.includes('```elixir'));
  assert.ok(result.messages[1].content.includes('| Country |'));

  // Turn 2
  assert.equal(result.messages[2].role, 'User');
  assert.ok(
    result.messages[2].content.includes(
      'What do they mean by "உலகத் தொழிலாளர்களே, ஒன்றுபடுங்கள்!"',
    ),
  );
  assert.equal(result.messages[3].role, 'Model');
  assert.ok(
    result.messages[3].content.includes(
      '"உலகத் தொழிலாளர்களே, ஒன்றுபடுங்கள்!" என்பது புகழ்பெற்ற **கம்யூனிச எழுச்சி முழக்கம்** ஆகும்',
    ),
  );
});
