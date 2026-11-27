// Keyboard shortcuts. All app shortcuts use Command (⌘) on macOS; the native menu bar
// registers the same equivalents and dispatches through `perform()`.

/** `feature`: using it turns the tools on, out of read mode. */
export const SHORTCUTS = [
  { keys: '⌘B', command: 'bold', label: 'Bold', mod: 'Cmd+B' },
  { keys: '⌘I', command: 'italic', label: 'Italic', mod: 'Cmd+I' },
  { keys: '⌘⇧X', command: 'strikethrough', label: 'Strikethrough', mod: 'Cmd+Shift+X' },
  { keys: '⌘⇧C', command: 'code', label: 'Inline code', mod: 'Cmd+Shift+C' },
  { keys: '⌘⌥⇧C', command: 'codeblock', label: 'Code block', mod: 'Cmd+Alt+Shift+C' },
  { keys: '⌘⇧9', command: 'blockquote', label: 'Block quote', mod: 'Cmd+Shift+9' },
  { keys: '⌘K', command: 'link', label: 'Link', mod: 'Cmd+K' },
  { keys: '⌘⇧R', command: 'read', label: 'Read mode: just the text', mod: 'Cmd+Shift+R' },
  { keys: '⌘⇧A', command: 'alternatives', label: 'Alternatives for the selection or word', feature: true, mod: 'Cmd+Shift+A' },
  { keys: '⌘⇧G', command: 'ai-alternatives', label: 'AI alternatives for the selection or word', feature: true, mod: 'Cmd+Shift+G' },
  { keys: '⌘/', command: 'ghost', label: 'Ghost it, or revive it', feature: true, mod: 'Cmd+/' },
  { keys: '⌘⇧E', command: 'stash', label: 'Stash in Overflow', feature: true, mod: 'Cmd+Shift+E' },
  { keys: '⌘⇧D', command: 'overflow', label: 'Overflow panel', feature: true, mod: 'Cmd+Shift+D' },
  { keys: '⌘U', command: 'source', label: 'The piece as Markdown, and its file', feature: true, mod: 'Cmd+U' },
  { keys: '⌘S', command: 'save', label: 'Save', mod: 'Cmd+S' },
  { keys: '⌘O', command: 'open', label: 'Open', mod: 'Cmd+O' },
];

const FEATURES = new Set(SHORTCUTS.filter((shortcut) => shortcut.feature).map((shortcut) => shortcut.command));

const CODES = { '/': 'Slash', '9': 'Digit9' };

function parse(mod) {
  const parts = mod.split('+');
  const key = parts[parts.length - 1].toLowerCase();
  return {
    shift: parts.includes('Shift'),
    alt: parts.includes('Alt'),
    key,
    code: CODES[key] ?? (/^\d$/.test(key) ? `Digit${key}` : `Key${key.toUpperCase()}`),
  };
}

export function initShortcuts({ ui, commands }) {
  const table = SHORTCUTS.map((shortcut) => ({ ...shortcut, ...parse(shortcut.mod) }));
  const pressed = (event, wanted) => event.key.toLowerCase() === wanted.key || event.code === wanted.code;

  window.addEventListener(
    'keydown',
    (event) => {
      if (event.ctrlKey) return;

      // Undo and redo are the document's, with Command, wherever the focus is,
      // except in a field that keeps a history of its own. (Overflow shares document history.)
      if (event.metaKey && !event.altKey && pressed(event, { key: 'z', code: 'KeyZ' })) {
        if (event.target.closest?.('textarea, input') && !event.target.closest('#overflow')) return;
        event.preventDefault();
        commands.run(event.shiftKey ? 'redo' : 'undo');
        return;
      }

      if (!event.metaKey) return;
      // Do not hijack typing shortcuts inside inputs like the link popover.
      if (event.target.closest?.('#linkpop')) return;

      const shortcut = table.find((entry) => entry.shift === event.shiftKey && entry.alt === event.altKey && pressed(event, entry));
      if (!shortcut) return;
      event.preventDefault();
      event.stopPropagation();
      perform(shortcut.command);
    },
    true,
  );

  /** Runs a command as its shortcut would. The menu bar comes this way too. */
  function perform(command) {
    commands.run(command);
    if (FEATURES.has(command)) ui.set({ read: false });
  }

  return { perform };
}
