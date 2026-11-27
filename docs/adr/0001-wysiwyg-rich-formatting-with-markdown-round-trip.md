# Rendered WYSIWYG Formatting with Standard Markdown Round-Trip

We will render inline marks (bold, italic, strikethrough, inline code, links) and rich blocks (bullet lists, numbered lists, block quotes, fenced code blocks) directly as WYSIWYG formatting in the editor — matching how Write_On already hides `# ` markers on headings — while serializing to and parsing from standard Markdown `.md` files on disk.

## Considered Options

- **Rendered WYSIWYG (chosen):** Keeps the distraction-free writing surface consistent with Write_On's existing heading treatment and supports standard formatting shortcuts and a floating selection toolbar without cluttering prose with raw syntax characters.
- **Visible raw Markdown syntax:** Simpler parser/serializer, but inconsistent with Write_On's hidden-`#` headings and visually noisier when combined with inline alternative underlines and ghosted text.

## Consequences

- `web/src/doc/format.js` expands from flat plain-text runs (`{ text, vid?, ghost? }`) and 3 block kinds (`p`, `h`, `blank`) to runs with inline marks and additional block kinds (`ul`, `ol`, `blockquote`, `codeblock`).
- Opening external `.md` files requires a Markdown parser/serializer that round-trips supported constructs cleanly without corrupting unsupported syntax.
