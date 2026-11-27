# Write On

A macOS Markdown writing app built around inline alternatives, ghosted text, an Overflow scratchpad, AI suggestions, The Lab, and WYSIWYG rich formatting backed by plain `.md` files.

## Language

**Block**:
A top-level structural unit of a document — a paragraph, heading, bullet item, numbered item, block quote, code block, or blank line.
_Avoid_: Node, line, element

**Run**:
A contiguous span of text inside a block sharing the same inline marks, alternative group membership, and ghost state.
_Avoid_: Span, segment, token

**Inline Mark**:
A visual text style applied to a run — bold, italic, strikethrough, inline code, or link — rendered directly in the editor and serialized to standard Markdown on save.
_Avoid_: Tag, decoration, format

**Alternative Group**:
A word, sentence, or paragraph that holds multiple competing versions (`variants`) with one active version shown in place.
_Avoid_: Variant set, slot, choice

**Ghost**:
Text dimmed in the editor and excluded from clean Markdown export while remaining recoverable in place.
_Avoid_: Deleted text, hidden text, strikeout

**Overflow**:
A document's side scratchpad of stashed fragments, saved in the same `.md` file below `<!-- overflow -->`.
_Avoid_: Clipboard, drafts, sidebar notes
