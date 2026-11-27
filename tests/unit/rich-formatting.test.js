import test from 'node:test';
import assert from 'node:assert/strict';

import { markdownToBlocks, blocksToMarkdown, blocksToHtml, htmlToBlocks, parse, serialize, plainText, orderedListNumbers } from '../../web/src/doc/format.js';
import {
  normalizeBlocks,
  splitBlock,
  exitCodeBlock,
  mergeBackward,
  toggleMark,
  hasMark,
  setLink,
  linkAt,
  toggleBlockKind,
  indentList,
  wrapInline,
  setGroupText,
} from '../../web/src/doc/blocks.js';
import { resolveTarget } from '../../web/src/doc/target.js';
import { offered } from '../../web/src/doc/proposal.js';
import { formatListMarker } from '../../web/src/editor/dom.js';

test('inline Markdown round-trips bold, italic, strike, code, and links', () => {
  const md = 'Hello **bold**, *italic*, ~~strike~~, `code`, and [site](https://example.com).';
  const blocks = markdownToBlocks(md);
  assert.equal(blocks.length, 1);
  assert.equal(blocksToMarkdown(blocks), md);

  // Also round-trips through HTML representation
  const html = blocksToHtml(blocks);
  assert.deepEqual(htmlToBlocks(html), blocks);
});

test('unsupported Markdown (frontmatter, wikilinks, snake_case, tables, hr) is preserved verbatim', () => {
  const md = [
    '---',
    'title: My Note',
    'tags: [writing, draft]',
    '---',
    '',
    'See [[Other Note]] and my_var_name.',
    '',
    '| Col A | Col B |',
    '| --- | --- |',
    '| 1 | 2 |',
    '',
    '---',
  ].join('\n');
  const blocks = markdownToBlocks(md);
  assert.equal(blocksToMarkdown(blocks), md);
  // Plain Markdown saves without a write_on metadata comment
  const saved = serialize({ html: blocksToHtml(blocks), groups: {}, overflow: '' });
  assert.equal(saved, `${md}\n`);
  assert.ok(!saved.includes('<!-- write_on'));
});

test('rich blocks (ul, ol, blockquote, codeblock) parse and serialize cleanly', () => {
  const md = [
    '- First bullet',
    '  - Nested bullet',
    '1. First item',
    '2. Second item',
    '> A wise quote',
    '```js',
    'const x = 1;',
    'const y = 2;',
    '```',
  ].join('\n');
  const blocks = markdownToBlocks(md);
  assert.deepEqual(
    blocks.map((b) => b.kind),
    ['ul', 'ul', 'ol', 'ol', 'blockquote', 'codeblock'],
  );
  assert.equal(blocks[1].indent, 1);
  assert.equal(blocks[5].lang, 'js');
  assert.equal(blocksToMarkdown(blocks), md);
  assert.deepEqual(orderedListNumbers(blocks), [0, 0, 1, 2, 0, 0]);
});

test('auto-promotion converts - , 1. , and >  paragraphs', () => {
  const { blocks } = normalizeBlocks(
    [
      { kind: 'p', runs: [{ text: '- hello' }] },
      { kind: 'p', runs: [{ text: '1. first' }] },
      { kind: 'p', runs: [{ text: '> quoted' }] },
    ],
    {},
  );
  assert.deepEqual(blocks, [
    { kind: 'ul', indent: 0, runs: [{ text: 'hello' }] },
    { kind: 'ol', indent: 0, runs: [{ text: 'first' }] },
    { kind: 'blockquote', runs: [{ text: 'quoted' }] },
  ]);
});

test('list Return continuation, empty-item exit, Backspace unwrap, and Tab indent', () => {
  let blocks = [{ kind: 'ul', indent: 0, runs: [{ text: 'item one' }] }];
  // Return at end starts a new bullet item
  let res = splitBlock(blocks, { block: 0, offset: 8 });
  assert.equal(res.blocks.length, 2);
  assert.equal(res.blocks[1].kind, 'ul');
  assert.equal(res.blocks[1].runs.length, 0);

  // Return on empty bullet exits to blank paragraph
  res = splitBlock(res.blocks, { block: 1, offset: 0 });
  assert.equal(res.blocks[1].kind, 'blank');

  // Tab indents up to 2, Shift+Tab outdents
  blocks = [{ kind: 'ul', indent: 0, runs: [{ text: 'nested' }] }];
  blocks = indentList(blocks, 0, 0, 1);
  assert.equal(blocks[0].indent, 1);
  // Backspace at offset 0 on indented item outdents first, then unwraps to p
  res = mergeBackward(blocks, 0);
  assert.equal(res.blocks[0].kind, 'ul');
  assert.equal(res.blocks[0].indent, 0);
  res = mergeBackward(res.blocks, 0);
  assert.equal(res.blocks[0].kind, 'p');
});

test('code block ``` promotion, Return newline, and Cmd+Enter exit', () => {
  const start = [{ kind: 'p', runs: [{ text: '```ts' }] }];
  let res = splitBlock(start, { block: 0, offset: 5 });
  assert.equal(res.blocks[0].kind, 'codeblock');
  assert.equal(res.blocks[0].lang, 'ts');

  res = splitBlock([{ kind: 'codeblock', lang: 'ts', runs: [{ text: 'a' }] }], { block: 0, offset: 1 });
  assert.equal(res.blocks.length, 1);
  assert.equal(res.blocks[0].runs[0].text, 'a\n');

  res = exitCodeBlock(res.blocks, 0);
  assert.equal(res.blocks.length, 2);
  assert.equal(res.blocks[1].kind, 'blank');
  assert.deepEqual(res.caret, { block: 1, offset: 0 });
});

test('toggleMark, setLink, linkAt, and toggleBlockKind', () => {
  let blocks = [{ kind: 'p', runs: [{ text: 'hello world' }] }];
  const start = { block: 0, offset: 6 };
  const end = { block: 0, offset: 11 };

  blocks = toggleMark(blocks, start, end, 'bold');
  assert.equal(hasMark(blocks, start, end, 'bold'), true);
  assert.equal(blocksToMarkdown(blocks), 'hello **world**');

  blocks = setLink(blocks, start, end, 'https://example.com');
  assert.equal(linkAt(blocks, start, end)?.url, 'https://example.com');
  assert.equal(blocksToMarkdown(blocks), 'hello **[world](https://example.com)**');

  blocks = toggleMark(blocks, start, end, 'bold');
  assert.equal(hasMark(blocks, start, end, 'bold'), false);
  assert.equal(blocksToMarkdown(blocks), 'hello [world](https://example.com)');

  const quoted = toggleBlockKind(blocks, 0, 0, 'blockquote');
  assert.equal(quoted.blocks[0].kind, 'blockquote');
});

test('alternatives inherit inline marks and code blocks are excluded from Alternatives and Lab', () => {
  let blocks = markdownToBlocks('This is **great** work.\n```js\nconst a = 1;\n```');
  blocks = wrapInline(blocks, 0, 8, 13, 'grp1234');
  const swapped = setGroupText(blocks, 'grp1234', 'excellent');
  assert.equal(blocksToMarkdown(swapped), 'This is **excellent** work.\n```js\nconst a = 1;\n```');

  // Code block is excluded from Alternatives
  const target = resolveTarget(swapped, {}, { start: { block: 1, offset: 2 }, end: { block: 1, offset: 5 }, collapsed: false });
  assert.equal(target, null);

  // Code block is excluded from Lab offered()
  const offer = offered(swapped);
  assert.equal(offer.length, 1);
  assert.equal(offer[0].block, 0);
});

test('ordered list markers follow 1/2/3 -> a/b/c -> i/ii/iii/iv by indent level', () => {
  assert.deepEqual([1, 2, 3].map((n) => formatListMarker(0, n)), ['1', '2', '3']);
  assert.deepEqual([1, 2, 3].map((n) => formatListMarker(1, n)), ['a', 'b', 'c']);
  assert.deepEqual([1, 2, 3, 4].map((n) => formatListMarker(2, n)), ['i', 'ii', 'iii', 'iv']);
});

test('parse and plainText round-trip formatted file with groups', () => {
  let blocks = markdownToBlocks('A **bold** word.');
  blocks = wrapInline(blocks, 0, 2, 6, 'grp1234');
  const state = {
    html: blocksToHtml(blocks),
    groups: { grp1234: { scope: 'word', variants: ['bold', 'strong'], active: 0 } },
    overflow: '',
  };
  const saved = serialize(state);
  const loaded = parse(saved);
  assert.equal(loaded.note, null);
  assert.equal(plainText(loaded.state, { withoutGhost: true }), 'A **bold** word.');
});
