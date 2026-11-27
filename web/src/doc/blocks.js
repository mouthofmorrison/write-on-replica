// Editing the document as data. A document is a list of blocks (see format.js); a
// position is { block, offset }, an offset into the block's text. Every function here
// returns new blocks and leaves its input alone, so a list of blocks is also a snapshot.
//
// The editor uses these for every edit that changes structure (Return, joining lines,
// deleting across lines, pasting, ghosting, grouping, formatting) and lets the browser
// do plain typing inside a paragraph.

import { tidyGroup, setVariantText } from './model.js';
import { fixArticle } from './text.js';

// --- runs ---------------------------------------------------------------------------------

export const textOf = (block) => block.runs.map((run) => run.text).join('');
export const lengthOf = (block) => block.runs.reduce((n, run) => n + run.text.length, 0);

const INLINE_MARKS = ['bold', 'italic', 'strike', 'code'];

const sameMarks = (a, b) =>
  a.vid === b.vid &&
  Boolean(a.ghost) === Boolean(b.ghost) &&
  Boolean(a.bold) === Boolean(b.bold) &&
  Boolean(a.italic) === Boolean(b.italic) &&
  Boolean(a.strike) === Boolean(b.strike) &&
  Boolean(a.code) === Boolean(b.code) &&
  (a.link ?? null) === (b.link ?? null);

function run(text, marks = {}) {
  const made = { text };
  if (marks.vid) made.vid = marks.vid;
  if (marks.ghost) made.ghost = true;
  if (marks.bold) made.bold = true;
  if (marks.italic) made.italic = true;
  if (marks.strike) made.strike = true;
  if (marks.code) made.code = true;
  if (marks.link) made.link = marks.link;
  return made;
}

function inlineMarksOf(piece) {
  const marks = {};
  if (piece.bold) marks.bold = true;
  if (piece.italic) marks.italic = true;
  if (piece.strike) marks.strike = true;
  if (piece.code) marks.code = true;
  if (piece.link) marks.link = piece.link;
  return marks;
}

function mergeRuns(runs) {
  const merged = [];
  for (const piece of runs) {
    if (!piece.text) continue;
    const last = merged[merged.length - 1];
    if (last && sameMarks(last, piece)) last.text += piece.text;
    else merged.push({ ...piece });
  }
  return merged;
}

function splitRuns(runs, offset) {
  const left = [];
  const right = [];
  let at = 0;
  for (const piece of runs) {
    const end = at + piece.text.length;
    if (end <= offset) left.push(piece);
    else if (at >= offset) right.push(piece);
    else {
      left.push({ ...piece, text: piece.text.slice(0, offset - at) });
      right.push({ ...piece, text: piece.text.slice(offset - at) });
    }
    at = end;
  }
  return [left, right];
}

/** A block like `like` (its kind, heading level, list indent, lang, and paragraph group) holding `runs`. */
function withRuns(like, runs) {
  const merged = mergeRuns(runs);
  let block;
  if (like.kind === 'h') {
    block = { kind: 'h', level: like.level, runs: merged };
  } else if (like.kind === 'ul' || like.kind === 'ol') {
    block = { kind: like.kind, indent: like.indent ?? 0, runs: merged };
  } else if (like.kind === 'blockquote') {
    block = { kind: 'blockquote', runs: merged };
  } else if (like.kind === 'codeblock') {
    const plain = merged.map((r) => r.text).join('');
    block = { kind: 'codeblock', runs: plain ? [{ text: plain }] : [] };
    if (like.lang) block.lang = like.lang;
    return block;
  } else {
    block = merged.length ? { kind: 'p', runs: merged } : { kind: 'blank', runs: [] };
  }
  if (like.vid) block.vid = like.vid;
  return block;
}

const plain = (runs) => withRuns({ kind: 'p' }, runs);
const replaceBlocks = (blocks, from, count, ...items) => [...blocks.slice(0, from), ...items, ...blocks.slice(from + count)];

/**
 * The marks newly typed text takes at `offset`: those of the run it falls strictly inside,
 * or, on a boundary, only what both neighbors share (plus inline marks of the left run if
 * not a link/code edge). Typing at the edge of a group or ghost run lands outside it.
 */
export function marksAt(block, offset) {
  let at = 0;
  let left;
  let right;
  for (const piece of block.runs) {
    const end = at + piece.text.length;
    if (at < offset && offset < end) return marksOf(piece);
    if (end === offset) left = piece;
    if (at === offset) right = piece;
    at = end;
  }
  const marks = {};
  if (left && right) {
    if (left.vid && left.vid === right.vid) marks.vid = left.vid;
    if (left.ghost && right.ghost) marks.ghost = true;
    for (const k of INLINE_MARKS) if (left[k] && right[k]) marks[k] = true;
    if (left.link && left.link === right.link) marks.link = left.link;
  } else if (left) {
    if (left.bold) marks.bold = true;
    if (left.italic) marks.italic = true;
    if (left.strike) marks.strike = true;
  }
  return marks;
}

/** True when `offset` is at the edge of a group, ghost, link, or inline code run, where typing must be placed by hand. */
export function atMarkedEdge(block, offset) {
  let at = 0;
  for (const piece of block.runs) {
    const end = at + piece.text.length;
    if ((offset === at || offset === end) && (piece.vid || piece.ghost || piece.link || piece.code)) return true;
    at = end;
  }
  return false;
}

function marksOf(piece) {
  const marks = inlineMarksOf(piece);
  if (piece.vid) marks.vid = piece.vid;
  if (piece.ghost) marks.ghost = true;
  return marks;
}

// --- structure ------------------------------------------------------------------------------

/** Return. Behavior adapts to code blocks, lists, block quotes, and ``` fence promotion. */
export function splitBlock(blocks, pos) {
  const block = blocks[pos.block];

  // Inside a code block, Return inserts a newline inside the block.
  if (block.kind === 'codeblock') {
    const text = textOf(block);
    const nextText = text.slice(0, pos.offset) + '\n' + text.slice(pos.offset);
    return {
      blocks: replaceBlocks(blocks, pos.block, 1, withRuns(block, [{ text: nextText }])),
      caret: { block: pos.block, offset: pos.offset + 1 },
    };
  }

  // Typing ``` (optionally ```lang) and pressing Return promotes to a fenced code block.
  if (block.kind === 'p' && pos.offset === lengthOf(block)) {
    const fence = /^```([^\s`]*)$/.exec(textOf(block));
    if (fence) {
      const made = { kind: 'codeblock', runs: [] };
      if (fence[1]) made.lang = fence[1];
      return { blocks: replaceBlocks(blocks, pos.block, 1, made), caret: { block: pos.block, offset: 0 } };
    }
  }

  // Empty list item or empty block quote: Return exits back to a plain paragraph.
  if ((block.kind === 'ul' || block.kind === 'ol' || block.kind === 'blockquote') && block.runs.length === 0) {
    return {
      blocks: replaceBlocks(blocks, pos.block, 1, { kind: 'blank', runs: [] }),
      caret: { block: pos.block, offset: 0 },
    };
  }

  // Non-empty list item or block quote: Return continues with the same block kind.
  if (block.kind === 'ul' || block.kind === 'ol' || block.kind === 'blockquote') {
    const [left, right] = splitRuns(block.runs, pos.offset);
    const nextLike = block.kind === 'blockquote' ? { kind: 'blockquote' } : { kind: block.kind, indent: block.indent ?? 0 };
    return {
      blocks: replaceBlocks(blocks, pos.block, 1, withRuns(block, left), withRuns(nextLike, right)),
      caret: { block: pos.block + 1, offset: 0 },
    };
  }

  if (pos.offset === 0 && block.kind !== 'blank') {
    return { blocks: replaceBlocks(blocks, pos.block, 0, { kind: 'blank', runs: [] }), caret: { block: pos.block + 1, offset: 0 } };
  }
  const [left, right] = splitRuns(block.runs, pos.offset);
  return {
    blocks: replaceBlocks(blocks, pos.block, 1, withRuns(block, left), plain(right)),
    caret: { block: pos.block + 1, offset: 0 },
  };
}

/** Exits a code block by inserting a new blank paragraph right below it. */
export function exitCodeBlock(blocks, index) {
  return {
    blocks: replaceBlocks(blocks, index + 1, 0, { kind: 'blank', runs: [] }),
    caret: { block: index + 1, offset: 0 },
  };
}

/** Backspace at the start of block `index`. Null if there is nothing to do. */
export function mergeBackward(blocks, index) {
  const block = blocks[index];
  if (block.kind === 'ul' || block.kind === 'ol') {
    if ((block.indent ?? 0) > 0) {
      return {
        blocks: replaceBlocks(blocks, index, 1, withRuns({ ...block, indent: block.indent - 1 }, block.runs)),
        caret: { block: index, offset: 0 },
      };
    }
    const demoted = withRuns({ kind: 'p', vid: block.vid }, block.runs);
    return { blocks: replaceBlocks(blocks, index, 1, demoted), caret: { block: index, offset: 0 } };
  }
  if (block.kind === 'h' || block.kind === 'blockquote' || block.kind === 'codeblock') {
    const demoted = withRuns({ kind: 'p', vid: block.vid }, block.runs);
    return { blocks: replaceBlocks(blocks, index, 1, demoted), caret: { block: index, offset: 0 } };
  }
  if (index === 0) return null;
  const previous = blocks[index - 1];
  if (previous.kind === 'blank') return { blocks: replaceBlocks(blocks, index - 1, 1), caret: { block: index - 1, offset: 0 } };
  const caret = { block: index - 1, offset: lengthOf(previous) };
  if (block.kind === 'blank') return { blocks: replaceBlocks(blocks, index, 1), caret };
  return { blocks: replaceBlocks(blocks, index - 1, 2, withRuns(previous, [...previous.runs, ...block.runs])), caret };
}

/** Forward delete at the end of block `index`. Null if there is nothing to do. */
export function mergeForward(blocks, index) {
  const block = blocks[index];
  const next = blocks[index + 1];
  if (!next) return null;
  if (block.kind === 'blank') return { blocks: replaceBlocks(blocks, index, 1), caret: { block: index, offset: 0 } };
  const caret = { block: index, offset: lengthOf(block) };
  if (next.kind === 'blank') return { blocks: replaceBlocks(blocks, index + 1, 1), caret };
  return { blocks: replaceBlocks(blocks, index, 2, withRuns(block, [...block.runs, ...next.runs])), caret };
}

/** Removes the text from `start` to `end`, joining what is left of the two end blocks. */
export function deleteRange(blocks, start, end) {
  const first = blocks[start.block];
  const last = blocks[end.block];
  const [left] = splitRuns(first.runs, start.offset);
  const [, right] = splitRuns(last.runs, end.offset);
  const runs = [...left, ...right];
  let joined;
  if (start.block === end.block) joined = withRuns(first, runs);
  else if (mergeRuns(runs).length === 0) joined = { kind: 'blank', runs: [] };
  else joined = withRuns(start.offset === 0 ? last : first, runs); // a block deleted from its start does not pass on its kind
  return { blocks: replaceBlocks(blocks, start.block, end.block - start.block + 1, joined), caret: { ...start } };
}

/** Inserts text at `pos`. Line breaks in the text start new plain paragraphs (or stay inside a code block). */
export function insertText(blocks, pos, text) {
  const normalized = text.replace(/\r\n?/g, '\n');
  const block = blocks[pos.block];
  if (block.kind === 'codeblock') {
    const existing = textOf(block);
    const nextText = existing.slice(0, pos.offset) + normalized + existing.slice(pos.offset);
    return {
      blocks: replaceBlocks(blocks, pos.block, 1, withRuns(block, [{ text: nextText }])),
      caret: { block: pos.block, offset: pos.offset + normalized.length },
    };
  }
  const lines = normalized.split('\n');
  const marks = marksAt(block, pos.offset);
  const [left, right] = splitRuns(block.runs, pos.offset);

  if (lines.length === 1) {
    const typed = withRuns(block.kind === 'blank' ? { kind: 'p', vid: block.vid } : block, [...left, run(lines[0], marks), ...right]);
    return { blocks: replaceBlocks(blocks, pos.block, 1, typed), caret: { block: pos.block, offset: pos.offset + lines[0].length } };
  }
  const lastLine = lines[lines.length - 1];
  const made = [
    withRuns(block.kind === 'blank' ? { kind: 'p', vid: block.vid } : block, [...left, run(lines[0], marks)]),
    ...lines.slice(1, -1).map((line) => plain([run(line)])),
    plain([run(lastLine), ...right]),
  ];
  return {
    blocks: replaceBlocks(blocks, pos.block, 1, ...made),
    caret: { block: pos.block + lines.length - 1, offset: lastLine.length },
  };
}

/** The text between two positions, one line per block. */
export function extractText(blocks, start, end) {
  const lines = [];
  for (let i = start.block; i <= end.block; i++) {
    const text = textOf(blocks[i]);
    lines.push(text.slice(i === start.block ? start.offset : 0, i === end.block ? end.offset : text.length));
  }
  return lines.join('\n');
}

// --- inline marks & rich blocks -------------------------------------------------------------

function mapRange(blocks, start, end, change) {
  const out = [...blocks];
  for (let i = start.block; i <= end.block; i++) {
    const block = blocks[i];
    const from = i === start.block ? start.offset : 0;
    const to = i === end.block ? end.offset : lengthOf(block);
    if (to <= from) continue;
    const [before, rest] = splitRuns(block.runs, from);
    const [inside, after] = splitRuns(rest, to - from);
    out[i] = withRuns(block, [...before, ...inside.map(change), ...after]);
  }
  return out;
}

/** True when every non-empty run in `start`..`end` (outside code blocks) has `mark`. */
export function hasMark(blocks, start, end, mark) {
  let found = false;
  for (let i = start.block; i <= end.block; i++) {
    const block = blocks[i];
    if (block.kind === 'codeblock') continue;
    const from = i === start.block ? start.offset : 0;
    const to = i === end.block ? end.offset : lengthOf(block);
    if (to <= from) continue;
    const [, rest] = splitRuns(block.runs, from);
    const [inside] = splitRuns(rest, to - from);
    for (const piece of inside) {
      if (!piece.text) continue;
      found = true;
      if (!piece[mark]) return false;
    }
  }
  return found;
}

/** Returns the link URL if any run in `start`..`end` (or at caret) has a link, plus its full span. */
export function linkAt(blocks, start, end) {
  for (let i = start.block; i <= end.block; i++) {
    const block = blocks[i];
    if (block.kind === 'codeblock') continue;
    const from = i === start.block ? start.offset : 0;
    const to = i === end.block ? end.offset : lengthOf(block);
    let at = 0;
    for (const piece of block.runs) {
      const pieceEnd = at + piece.text.length;
      const overlaps = from === to ? at <= from && from <= pieceEnd : pieceEnd > from && at < to;
      if (overlaps && piece.link) {
        // Expand to contiguous runs with the same link URL
        let spanStart = at;
        let spanEnd = pieceEnd;
        let cursor = 0;
        for (const r of block.runs) {
          const rEnd = cursor + r.text.length;
          if (r.link === piece.link) {
            if (rEnd === spanStart) spanStart = cursor;
            if (cursor === spanEnd) spanEnd = rEnd;
          }
          cursor = rEnd;
        }
        return { block: i, start: spanStart, end: spanEnd, url: piece.link };
      }
      at = pieceEnd;
    }
  }
  return null;
}

/** Toggles an inline mark ('bold' | 'italic' | 'strike' | 'code') over `start`..`end`. */
export function toggleMark(blocks, start, end, mark) {
  const on = !hasMark(blocks, start, end, mark);
  const out = [...blocks];
  for (let i = start.block; i <= end.block; i++) {
    const block = blocks[i];
    if (block.kind === 'codeblock') continue;
    const from = i === start.block ? start.offset : 0;
    const to = i === end.block ? end.offset : lengthOf(block);
    if (to <= from) continue;
    const [before, rest] = splitRuns(block.runs, from);
    const [inside, after] = splitRuns(rest, to - from);
    const next = inside.map((piece) => {
      const m = marksOf(piece);
      if (on) m[mark] = true;
      else delete m[mark];
      return run(piece.text, m);
    });
    out[i] = withRuns(block, [...before, ...next, ...after]);
  }
  return out;
}

/** Sets or removes (`url = null`) a link on `start`..`end`. */
export function setLink(blocks, start, end, url) {
  const out = [...blocks];
  for (let i = start.block; i <= end.block; i++) {
    const block = blocks[i];
    if (block.kind === 'codeblock') continue;
    const from = i === start.block ? start.offset : 0;
    const to = i === end.block ? end.offset : lengthOf(block);
    if (to <= from) continue;
    const [before, rest] = splitRuns(block.runs, from);
    const [inside, after] = splitRuns(rest, to - from);
    const next = inside.map((piece) => {
      const m = marksOf(piece);
      if (url) m.link = url;
      else delete m.link;
      return run(piece.text, m);
    });
    out[i] = withRuns(block, [...before, ...next, ...after]);
  }
  return out;
}

/** Toggles a block kind ('blockquote' | 'codeblock' | 'ul' | 'ol') across `startBlock`..`endBlock`. */
export function toggleBlockKind(blocks, startBlock, endBlock, kind) {
  if (kind === 'codeblock') {
    const slice = blocks.slice(startBlock, endBlock + 1);
    if (slice.every((b) => b.kind === 'codeblock')) {
      // Unwrap code block(s) into paragraphs (one per line)
      const unwrapped = [];
      for (const b of slice) {
        const lines = textOf(b).split('\n');
        for (const line of lines) unwrapped.push(line ? { kind: 'p', runs: [{ text: line }] } : { kind: 'blank', runs: [] });
      }
      return {
        blocks: replaceBlocks(blocks, startBlock, endBlock - startBlock + 1, ...unwrapped),
        caret: { block: startBlock, offset: lengthOf(unwrapped[0]) },
      };
    }
    const joined = slice.map((b) => textOf(b)).join('\n');
    const made = { kind: 'codeblock', runs: joined ? [{ text: joined }] : [] };
    return {
      blocks: replaceBlocks(blocks, startBlock, endBlock - startBlock + 1, made),
      caret: { block: startBlock, offset: joined.length },
    };
  }

  const slice = blocks.slice(startBlock, endBlock + 1);
  const allSame = slice.every((b) => b.kind === kind);
  const next = slice.map((b) => {
    if (b.kind === 'codeblock') return b;
    if (allSame) return withRuns({ kind: 'p', vid: b.vid }, b.runs);
    if (kind === 'ul' || kind === 'ol') return withRuns({ kind, indent: b.indent ?? 0, vid: b.vid }, b.runs);
    return withRuns({ kind, vid: b.vid }, b.runs);
  });
  return {
    blocks: replaceBlocks(blocks, startBlock, endBlock - startBlock + 1, ...next),
    caret: null,
  };
}

/** Adjusts list indent (`delta` = +1 or -1, clamped to 0..2) across `startBlock`..`endBlock`. */
export function indentList(blocks, startBlock, endBlock, delta) {
  let changed = false;
  const out = [...blocks];
  for (let i = startBlock; i <= endBlock; i++) {
    const b = blocks[i];
    if (b.kind !== 'ul' && b.kind !== 'ol') continue;
    const nextIndent = Math.max(0, Math.min(2, (b.indent ?? 0) + delta));
    if (nextIndent !== (b.indent ?? 0)) {
      out[i] = withRuns({ ...b, indent: nextIndent }, b.runs);
      changed = true;
    }
  }
  return changed ? out : null;
}

// --- ghost ----------------------------------------------------------------------------------

/** Sets or clears ghost on exactly the given range. */
export function setGhost(blocks, start, end, on) {
  return mapRange(blocks, start, end, (piece) => run(piece.text, { ...marksOf(piece), ghost: on }));
}

// --- rewriting --------------------------------------------------------------------------------

/**
 * Block `index` with each character of its text passed through `write(offset)`, which
 * gives what to put in its place: the same character, another, or '' to drop it. Marks stay
 * with whatever is left of the text they were on.
 */
export function rewriteBlock(blocks, index, write) {
  const block = blocks[index];
  let at = 0;
  const runs = block.runs.map((piece) => {
    let text = '';
    for (let i = 0; i < piece.text.length; i++) text += write(at + i);
    at += piece.text.length;
    return run(text, piece);
  });
  const made = withRuns(block, runs);
  // Nothing left: a plain blank line, whatever the block was.
  return replaceBlocks(blocks, index, 1, made.runs.length ? made : { kind: 'blank', runs: [] });
}

// --- groups -----------------------------------------------------------------------------------

/** Marks `start`..`end` of one block as inline group `vid`, replacing any groups inside. */
export function wrapInline(blocks, index, start, end, vid) {
  return mapRange(blocks, { block: index, offset: start }, { block: index, offset: end }, (piece) => run(piece.text, { ...marksOf(piece), vid }));
}

/** Makes block `index` a paragraph group, dissolving inline groups inside it. */
export function setBlockGroup(blocks, index, vid) {
  const block = blocks[index];
  const made = withRuns(block, block.runs.map((piece) => run(piece.text, { ...inlineMarksOf(piece), ghost: piece.ghost })));
  made.vid = vid;
  return replaceBlocks(blocks, index, 1, made);
}

/** Removes every mark of group `vid`, leaving its text and inline marks. */
export function clearGroup(blocks, vid) {
  return blocks.map((block) => {
    const marked = block.vid === vid || block.runs.some((piece) => piece.vid === vid);
    if (!marked) return block;
    const cleared = withRuns(block, block.runs.map((piece) => (piece.vid === vid ? run(piece.text, { ...inlineMarksOf(piece), ghost: piece.ghost }) : piece)));
    if (block.vid === vid) delete cleared.vid;
    return cleared;
  });
}

/** Where group `vid` is: `{ block, start, end, whole }`, `whole` for a paragraph group. */
export function locateGroup(blocks, vid) {
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (block.vid === vid) return { block: i, start: 0, end: lengthOf(block), whole: true };
    let at = 0;
    let start = -1;
    for (const piece of block.runs) {
      if (piece.vid === vid) {
        if (start < 0) start = at;
      } else if (start >= 0) {
        return { block: i, start, end: at, whole: false };
      }
      at += piece.text.length;
    }
    if (start >= 0) return { block: i, start, end: at, whole: false };
  }
  return null;
}

/** The smallest range around `start`..`end` that does not cut through an inline group. */
export function expandToGroups(block, start, end) {
  let from = start;
  let to = end;
  let at = 0;
  const spans = new Map();
  for (const piece of block.runs) {
    const pieceEnd = at + piece.text.length;
    if (piece.vid) {
      const span = spans.get(piece.vid) ?? { start: at, end: pieceEnd };
      span.end = pieceEnd;
      spans.set(piece.vid, span);
    }
    at = pieceEnd;
  }
  for (const span of spans.values()) {
    if (span.start < to && span.end > from) {
      from = Math.min(from, span.start);
      to = Math.max(to, span.end);
    }
  }
  return { start: from, end: to };
}

/**
 * Shows different text for group `vid`. Variants inherit the inline marks of the group's
 * first run. Ghost marking inside the group belongs to the variant that was showing, so it
 * goes; a group that was ghosted as a whole stays ghosted.
 */
export function setGroupText(blocks, vid, text) {
  const where = locateGroup(blocks, vid);
  if (!where) return blocks;
  const block = blocks[where.block];
  if (where.whole) {
    const inherited = block.runs[0] ? inlineMarksOf(block.runs[0]) : {};
    return replaceBlocks(blocks, where.block, 1, withRuns(block, [run(text, inherited)]));
  }
  const [before, rest] = splitRuns(block.runs, where.start);
  const [inside, after] = splitRuns(rest, where.end - where.start);
  const ghost = inside.every((piece) => piece.ghost);
  const inherited = inside[0] ? inlineMarksOf(inside[0]) : {};
  return replaceBlocks(blocks, where.block, 1, withRuns(block, [...before, run(text, { ...inherited, vid, ghost }), ...after]));
}

// An "a" or "an" standing alone just before `offset`, with one space after it.
const ARTICLE = /(^|[^\p{L}\p{N}'’])(an?|An?|AN) $/u;

/**
 * Shows different text for group `vid`, as setGroupText does, and says where the group
 * now ends. With `agreeArticle`, an "a" or "an" just before the group is made to agree
 * with the new text ("like a thumbtack" becomes "like an eraser"); the article keeps its
 * capital, inline marks, and ghosting, and one that is part of another group is left alone.
 * @returns {{ blocks, end: {block, offset} | null }} `end` is null if the group is not there
 */
export function showVariant(blocks, vid, text, { agreeArticle = false } = {}) {
  const where = locateGroup(blocks, vid);
  if (!where) return { blocks, end: null };
  let shown = setGroupText(blocks, vid, text);
  let start = where.start;

  if (agreeArticle && !where.whole) {
    const block = shown[where.block];
    const before = textOf(block).slice(0, start);
    const found = ARTICLE.exec(before);
    const agreed = found ? fixArticle(before, text) : before;
    if (agreed !== before) {
      const from = found.index + found[1].length;
      const [left, rest] = splitRuns(block.runs, from);
      const [old, right] = splitRuns(rest, found[2].length);
      if (!old.some((piece) => piece.vid)) {
        const article = run(agreed.slice(from, agreed.length - 1), marksOf(old[0]));
        shown = replaceBlocks(shown, where.block, 1, withRuns(block, [...left, article, ...right]));
        start += article.text.length - found[2].length;
      }
    }
  }
  return { blocks: shown, end: { block: where.block, offset: start + text.length } };
}

/**
 * Where a caret at `position` belongs after showVariant has swapped the text of a group.
 */
export function carryCaret(position, was, end, grew) {
  if (position.block !== was.block) return position;
  if (was.whole || (position.offset >= was.start && position.offset <= was.end)) return end;
  if (position.offset > was.end) return { block: position.block, offset: position.offset + grew };
  return position;
}

// --- normalizing ------------------------------------------------------------------------------

function promoteBlock(block) {
  if (block.kind !== 'p') return block;
  const text = textOf(block);
  const heading = /^(#{1,6}) /.exec(text);
  if (heading) {
    const [, rest] = splitRuns(block.runs, heading[0].length);
    const made = { kind: 'h', level: heading[1].length, runs: mergeRuns(rest) };
    if (block.vid) made.vid = block.vid;
    return made;
  }
  const bullet = /^- /.exec(text);
  if (bullet) {
    const [, rest] = splitRuns(block.runs, bullet[0].length);
    const made = { kind: 'ul', indent: 0, runs: mergeRuns(rest) };
    if (block.vid) made.vid = block.vid;
    return made;
  }
  const ordered = /^1\. /.exec(text);
  if (ordered) {
    const [, rest] = splitRuns(block.runs, ordered[0].length);
    const made = { kind: 'ol', indent: 0, runs: mergeRuns(rest) };
    if (block.vid) made.vid = block.vid;
    return made;
  }
  const quote = /^> /.exec(text);
  if (quote) {
    const [, rest] = splitRuns(block.runs, quote[0].length);
    const made = { kind: 'blockquote', runs: mergeRuns(rest) };
    if (block.vid) made.vid = block.vid;
    return made;
  }
  return block;
}

// Blocks that have been through normalizeBlocks and carry no group: in order already, and
// nothing elsewhere in the document can put them out of it.
const settled = new WeakSet();

function sameBlock(a, b) {
  if (
    a.kind !== b.kind ||
    a.level !== b.level ||
    a.indent !== b.indent ||
    a.lang !== b.lang ||
    a.vid !== b.vid ||
    a.runs.length !== b.runs.length
  ) {
    return false;
  }
  for (let i = 0; i < a.runs.length; i++) {
    const one = a.runs[i];
    const other = b.runs[i];
    if (one.text !== other.text || !sameMarks(one, other)) return false;
  }
  return true;
}

/**
 * Puts the document back in order after any edit:
 *  - a paragraph beginning "# ", "- ", "1. ", or "> " promotes to heading, list, or quote;
 *  - a group keeps one place: the first run of text that carries its id, or the first
 *    block for a paragraph group. Later copies (left by splitting) are unmarked;
 *  - groups do not nest, and a mark with no group, or of the wrong kind, is removed;
 *  - each group's showing variant is re-read from its text;
 *  - groups with no text left in the document are forgotten.
 */
export function normalizeBlocks(blocks, groups) {
  const seen = new Map(); // vid -> its text
  const out = [];

  for (const original of blocks) {
    if (settled.has(original)) {
      out.push(original);
      continue;
    }
    let block = promoteBlock(original);
    let blockVid = block.kind === 'codeblock' ? undefined : block.vid;
    if (blockVid) {
      const group = groups[blockVid];
      if (!group || group.scope !== 'paragraph' || seen.has(blockVid) || block.runs.length === 0) blockVid = undefined;
    }

    let previousVid;
    const runs =
      block.kind === 'codeblock'
        ? block.runs
        : block.runs.map((piece) => {
            let vid = piece.vid;
            if (vid) {
              const group = groups[vid];
              const continues = previousVid === vid;
              if (blockVid || !group || group.scope === 'paragraph' || (seen.has(vid) && !continues)) vid = undefined;
            }
            previousVid = vid;
            if (vid) seen.set(vid, (seen.get(vid) ?? '') + piece.text);
            return vid === piece.vid ? piece : run(piece.text, { ...inlineMarksOf(piece), ghost: piece.ghost });
          });

    const cleaned = withRuns(block.kind === 'blank' ? { kind: 'p' } : block, runs);
    delete cleaned.vid;
    if (blockVid) {
      cleaned.vid = blockVid;
      seen.set(blockVid, textOf(cleaned));
    }
    const kept = sameBlock(cleaned, original) ? original : cleaned;
    if (!kept.vid && !kept.runs.some((piece) => piece.vid)) settled.add(kept);
    out.push(kept);
  }

  const kept = {};
  for (const [vid, text] of seen) {
    const group = tidyGroup(groups[vid]);
    setVariantText(group, group.active, text);
    kept[vid] = tidyGroup(group);
  }
  if (out.length === 0) out.push({ kind: 'blank', runs: [] });
  return { blocks: out, groups: kept };
}
