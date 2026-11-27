// Built-in rich formatting: floating selection toolbar (#formatbar), inline link
// popover (#linkpop), Cmd-click to open links, and the formatting commands wired to
// both keyboard shortcuts and the native Format menu.

import * as doc from '../doc/blocks.js';
import { safeHref } from '../doc/format.js';
import { wordAt } from '../doc/text.js';

const MARGIN = 10;

function normalizeUrl(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return safeHref(withScheme);
}

export function createFormatBar({ editor, ui, commands, native }) {
  const bar = document.getElementById('formatbar');
  const linkPop = document.getElementById('linkpop');
  const linkInput = linkPop.querySelector('input');
  const linkOpenBtn = linkPop.querySelector('.link-open');
  const linkRemoveBtn = linkPop.querySelector('.link-unlink');
  const scroller = document.getElementById('scroll');

  let linkTarget = null; // { start, end, existingUrl }
  let linkOpen = false;

  // --- formatting commands ------------------------------------------------------------------

  function targetRange(selection) {
    if (!selection) return null;
    if (!selection.collapsed) return { start: selection.start, end: selection.end };
    const block = editor.blocks[selection.start.block];
    if (!block || block.kind === 'codeblock') return null;
    const w = wordAt(doc.textOf(block), selection.start.offset);
    if (!w) return null;
    return {
      start: { block: selection.start.block, offset: w.start },
      end: { block: selection.start.block, offset: w.end },
    };
  }

  function applyMark(mark) {
    const selection = editor.selection();
    const range = targetRange(selection);
    if (!range) return;
    editor.change(mark, (draft) => {
      draft.blocks = doc.toggleMark(draft.blocks, range.start, range.end, mark);
      draft.selection = { start: selection.start, end: selection.end };
    });
    updateBar();
  }

  function applyBlockKind(kind) {
    const selection = editor.selection();
    if (!selection) return;
    editor.change(kind, (draft) => {
      const result = doc.toggleBlockKind(draft.blocks, selection.start.block, selection.end.block, kind);
      draft.blocks = result.blocks;
      draft.selection = result.caret ? { start: result.caret } : { start: selection.start, end: selection.end };
    });
    updateBar();
  }

  commands.register('bold', () => applyMark('bold'));
  commands.register('italic', () => applyMark('italic'));
  commands.register('strikethrough', () => applyMark('strike'));
  commands.register('code', () => applyMark('code'));
  commands.register('blockquote', () => applyBlockKind('blockquote'));
  commands.register('codeblock', () => applyBlockKind('codeblock'));
  commands.register('ul', () => applyBlockKind('ul'));
  commands.register('ol', () => applyBlockKind('ol'));
  commands.register('link', () => openLinkPopover());

  // --- floating selection toolbar -----------------------------------------------------------

  function selectionRect() {
    const sel = document.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return null;
    return rect;
  }

  function placeAbove(el, rect) {
    el.classList.add('is-open');
    const box = el.getBoundingClientRect();
    let left = rect.left + rect.width / 2 - box.width / 2;
    left = Math.max(MARGIN, Math.min(left, innerWidth - MARGIN - box.width));
    let top = rect.top - box.height - 10;
    if (top < MARGIN) top = rect.bottom + 10;
    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(top)}px`;
  }

  function hideBar() {
    bar.classList.remove('is-open');
  }

  function updateBar() {
    if (linkOpen || ui.get('read') || document.body.classList.contains('is-card') || document.body.classList.contains('is-source')) {
      hideBar();
      return;
    }
    const selection = editor.selection();
    if (!selection || selection.collapsed || document.activeElement !== editor.root) {
      hideBar();
      return;
    }
    const firstBlock = editor.blocks[selection.start.block];
    if (firstBlock?.kind === 'codeblock' && selection.start.block === selection.end.block) {
      hideBar();
      return;
    }
    const rect = selectionRect();
    if (!rect) {
      hideBar();
      return;
    }

    // Reflect active state on toolbar buttons
    const states = {
      bold: doc.hasMark(editor.blocks, selection.start, selection.end, 'bold'),
      italic: doc.hasMark(editor.blocks, selection.start, selection.end, 'italic'),
      strikethrough: doc.hasMark(editor.blocks, selection.start, selection.end, 'strike'),
      code: doc.hasMark(editor.blocks, selection.start, selection.end, 'code'),
      link: Boolean(doc.linkAt(editor.blocks, selection.start, selection.end)),
      blockquote: firstBlock?.kind === 'blockquote',
      codeblock: firstBlock?.kind === 'codeblock',
    };
    for (const btn of bar.querySelectorAll('button[data-cmd]')) {
      btn.classList.toggle('is-active', Boolean(states[btn.dataset.cmd]));
    }
    placeAbove(bar, rect);
  }

  bar.addEventListener('mousedown', (event) => event.preventDefault());
  bar.addEventListener('click', (event) => {
    const btn = event.target.closest('button[data-cmd]');
    if (!btn) return;
    commands.run(btn.dataset.cmd);
  });

  // --- inline link popover ------------------------------------------------------------------

  function closeLinkPopover({ restoreFocus = true } = {}) {
    if (!linkOpen) return;
    linkOpen = false;
    linkPop.classList.remove('is-open');
    const saved = linkTarget;
    linkTarget = null;
    if (restoreFocus) {
      editor.focus();
      if (saved) editor.select(saved.start, saved.end);
    }
  }

  function openLinkPopover() {
    const selection = editor.selection();
    if (!selection) return;
    const block = editor.blocks[selection.start.block];
    if (block?.kind === 'codeblock') return;

    const existing = doc.linkAt(editor.blocks, selection.start, selection.end);
    if (existing && selection.collapsed) {
      linkTarget = {
        start: { block: existing.block, offset: existing.start },
        end: { block: existing.block, offset: existing.end },
        existingUrl: existing.url,
      };
    } else {
      linkTarget = {
        start: selection.start,
        end: selection.end,
        existingUrl: existing?.url ?? null,
      };
    }

    const rect =
      selectionRect() ??
      editor.rangeFor(selection.start.block, selection.start.offset, selection.start.offset).getBoundingClientRect();

    hideBar();
    linkInput.value = linkTarget.existingUrl ?? '';
    linkOpenBtn.hidden = !linkTarget.existingUrl;
    linkRemoveBtn.hidden = !linkTarget.existingUrl;
    linkOpen = true;
    placeAbove(linkPop, rect);
    linkInput.focus();
    linkInput.select();
  }

  function submitLink() {
    if (!linkTarget) return;
    const raw = linkInput.value.trim();
    const { start, end } = linkTarget;
    if (!raw) {
      if (linkTarget.existingUrl) {
        editor.change('unlink', (draft) => {
          draft.blocks = doc.setLink(draft.blocks, start, end, null);
          draft.selection = { start, end };
        });
      }
      closeLinkPopover();
      return;
    }
    const url = normalizeUrl(raw);
    if (!url) return;

    const collapsed = start.block === end.block && start.offset === end.offset;
    editor.change('link', (draft) => {
      if (collapsed) {
        const inserted = doc.insertText(draft.blocks, start, raw);
        const endPos = inserted.caret;
        draft.blocks = doc.setLink(inserted.blocks, start, endPos, url);
        draft.selection = { start: endPos };
      } else {
        draft.blocks = doc.setLink(draft.blocks, start, end, url);
        draft.selection = { start, end };
      }
    });
    closeLinkPopover({ restoreFocus: false });
    editor.focus();
  }

  linkPop.querySelector('form').addEventListener('submit', (event) => {
    event.preventDefault();
    submitLink();
  });

  linkInput.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeLinkPopover();
    }
  });

  linkRemoveBtn.addEventListener('click', () => {
    if (!linkTarget) return;
    const { start, end } = linkTarget;
    editor.change('unlink', (draft) => {
      draft.blocks = doc.setLink(draft.blocks, start, end, null);
      draft.selection = { start, end };
    });
    closeLinkPopover();
  });

  linkOpenBtn.addEventListener('click', () => {
    const url = normalizeUrl(linkInput.value) ?? linkTarget?.existingUrl;
    if (url) openInBrowser(url);
    closeLinkPopover();
  });

  // --- opening links via Cmd-click ----------------------------------------------------------

  function openInBrowser(url) {
    if (native.inApp) native.call('browser.open', { url }).catch(() => {});
    else window.open(url, '_blank', 'noopener,noreferrer');
  }

  editor.root.addEventListener('click', (event) => {
    const anchor = event.target.closest?.('a[href]');
    if (!anchor) return;
    event.preventDefault();
    if (event.metaKey) {
      const href = safeHref(anchor.getAttribute('href'));
      if (href) openInBrowser(href);
    }
  });

  // --- lifecycle & visibility ---------------------------------------------------------------

  editor.on('selection', updateBar);
  editor.on('change', updateBar);
  ui.on(() => {
    if (ui.get('read')) {
      hideBar();
      closeLinkPopover({ restoreFocus: false });
    }
  });
  scroller.addEventListener('scroll', () => {
    hideBar();
    if (linkOpen) closeLinkPopover({ restoreFocus: false });
  });
  window.addEventListener('resize', hideBar);
  document.addEventListener(
    'mousedown',
    (event) => {
      if (linkOpen && !linkPop.contains(event.target)) closeLinkPopover({ restoreFocus: false });
    },
    true,
  );

  return { update: updateBar, closeLinkPopover };
}
