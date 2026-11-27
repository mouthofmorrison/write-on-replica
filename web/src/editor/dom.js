// Blocks to DOM and back. Every block in #editor is a <p> element:
//   - headings: data-h="1..6"
//   - bullet lists: data-ul="0..2"
//   - numbered lists: data-ol="0..2" data-num="1.."
//   - block quotes: data-quote=""
//   - code blocks: data-code="" (optional data-lang)
//   - paragraph groups: data-vid="id"
// Inline runs render as text with <span data-vid>, <span data-ghost>, <strong>, <em>,
// <s>, <code>, and <a href="...">.

import { runsToHtml, safeHref } from '../doc/format.js';
import { isId } from '../doc/ids.js';

const keyCache = new WeakMap();

/** A string that is equal for two blocks exactly when they render the same. */
export function blockKey(block, olNum = 0) {
  let base = keyCache.get(block);
  if (base === undefined) {
    const extra =
      block.kind === 'h'
        ? block.level
        : block.kind === 'ul' || block.kind === 'ol'
          ? block.indent ?? 0
          : block.kind === 'codeblock'
            ? block.lang ?? ''
            : '';
    const body =
      block.kind === 'codeblock'
        ? block.runs.map((r) => r.text).join('')
        : block.runs.length
          ? runsToHtml(block.runs)
          : '';
    base = `${block.kind}:${extra}|${block.vid ?? ''}|${body}`;
    keyCache.set(block, base);
  }
  return block.kind === 'ol' ? `${base}#${olNum}` : base;
}

function toAlpha(n) {
  let out = '';
  let v = n;
  while (v > 0) {
    v -= 1;
    out = String.fromCharCode(97 + (v % 26)) + out;
    v = Math.floor(v / 26);
  }
  return out || 'a';
}

function toRoman(n) {
  const table = [
    [1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'],
    [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'],
    [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i'],
  ];
  let out = '';
  let v = Math.max(1, n);
  for (const [val, sym] of table) {
    while (v >= val) {
      out += sym;
      v -= val;
    }
  }
  return out;
}

export function formatListMarker(indent, num) {
  const n = num || 1;
  if (indent === 1) return toAlpha(n);
  if (indent >= 2) return toRoman(n);
  return String(n);
}

export function updateBlockElement(p, block, olNum = 0) {
  delete p.dataset.h;
  delete p.dataset.ul;
  delete p.dataset.ol;
  delete p.dataset.num;
  delete p.dataset.quote;
  delete p.dataset.code;
  delete p.dataset.lang;
  delete p.dataset.vid;

  if (block.kind === 'h') p.dataset.h = String(block.level);
  else if (block.kind === 'ul') p.dataset.ul = String(block.indent ?? 0);
  else if (block.kind === 'ol') {
    const indent = block.indent ?? 0;
    p.dataset.ol = String(indent);
    p.dataset.num = formatListMarker(indent, olNum);
  } else if (block.kind === 'blockquote') p.dataset.quote = '';
  else if (block.kind === 'codeblock') {
    p.dataset.code = '';
    if (block.lang) p.dataset.lang = block.lang;
  }

  if (block.vid) p.dataset.vid = block.vid;
  p.removeAttribute('class');

  if (block.kind === 'codeblock') {
    const text = block.runs.map((r) => r.text).join('');
    if (text) p.textContent = text;
    else p.innerHTML = '<br>';
  } else {
    p.innerHTML = block.runs.length ? runsToHtml(block.runs) : '<br>';
  }
}

export function createBlockElement(block, olNum = 0) {
  const p = document.createElement('p');
  updateBlockElement(p, block, olNum);
  return p;
}

// Spans the Lab adds while a proposal is showing. They are not part of the document.
const TRANSIENT = ['trim', 'mark'];
const isTransient = (el) => TRANSIENT.some((name) => name in el.dataset);

const INLINE_TAGS = new Set(['STRONG', 'B', 'EM', 'I', 'S', 'DEL', 'CODE', 'A']);

function sameRunMarks(a, b) {
  return (
    a.vid === b.vid &&
    Boolean(a.ghost) === Boolean(b.ghost) &&
    Boolean(a.bold) === Boolean(b.bold) &&
    Boolean(a.italic) === Boolean(b.italic) &&
    Boolean(a.strike) === Boolean(b.strike) &&
    Boolean(a.code) === Boolean(b.code) &&
    (a.link ?? null) === (b.link ?? null)
  );
}

/** Reads a block back from its element, whatever the browser has done inside it. */
export function readBlock(p) {
  if ('code' in (p.dataset ?? {})) {
    const text = p.textContent ?? '';
    const block = { kind: 'codeblock', runs: text ? [{ text }] : [] };
    if (p.dataset.lang) block.lang = p.dataset.lang;
    return block;
  }

  const runs = [];
  const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.data) continue;
    const run = { text: node.data };
    for (let el = node.parentElement; el && el !== p; el = el.parentElement) {
      if (!run.vid && isId(el.dataset.vid)) run.vid = el.dataset.vid;
      if ('ghost' in el.dataset) run.ghost = true;
      const tag = el.tagName;
      if (tag === 'STRONG' || tag === 'B') run.bold = true;
      else if (tag === 'EM' || tag === 'I') run.italic = true;
      else if (tag === 'S' || tag === 'DEL') run.strike = true;
      else if (tag === 'CODE') run.code = true;
      else if (tag === 'A' && !run.link) {
        const href = safeHref(el.getAttribute('href'));
        if (href) run.link = href;
      }
    }
    const last = runs[runs.length - 1];
    if (last && sameRunMarks(last, run)) last.text += run.text;
    else runs.push(run);
  }

  const ds = p.dataset ?? {};
  const level = Number(ds.h);
  let block;
  if (level >= 1 && level <= 6) block = { kind: 'h', level, runs };
  else if ('ul' in ds) block = { kind: 'ul', indent: Math.max(0, Math.min(2, Number(ds.ul) || 0)), runs };
  else if ('ol' in ds) block = { kind: 'ol', indent: Math.max(0, Math.min(2, Number(ds.ol) || 0)), runs };
  else if ('quote' in ds) block = { kind: 'blockquote', runs };
  else block = runs.length ? { kind: 'p', runs } : { kind: 'blank', runs: [] };

  if (isId(ds.vid) && runs.length) block.vid = ds.vid;
  return block;
}

/**
 * Whether the element holds only what rendering would put there: text, known inline tags,
 * the two kinds of span, and a lone <br> when empty.
 */
export function isTidy(p) {
  if (p.tagName !== 'P') return false;
  if ('code' in (p.dataset ?? {})) {
    const hasText = Boolean(p.textContent);
    if (!hasText) return p.childNodes.length === 1 && p.firstChild?.tagName === 'BR';
    return [...p.childNodes].every((n) => n.nodeType === Node.TEXT_NODE);
  }
  let hasText = false;
  let breaks = 0;
  const check = (parent) => {
    for (const node of parent.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        if (node.data) hasText = true;
        continue;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return false;
      if (node.tagName === 'BR') {
        breaks += 1;
        if (parent !== p) return false;
        continue;
      }
      if (node.hasAttribute('style')) return false;
      if (node.tagName === 'SPAN') {
        const known = node.dataset.vid || 'ghost' in node.dataset || isTransient(node);
        if (!known || node.textContent === '') return false;
        if (!check(node)) return false;
        continue;
      }
      if (INLINE_TAGS.has(node.tagName)) {
        if (node.textContent === '') return false;
        if (!check(node)) return false;
        continue;
      }
      return false;
    }
    return true;
  };
  if (!check(p)) return false;
  return hasText ? breaks === 0 : breaks === 1;
}
