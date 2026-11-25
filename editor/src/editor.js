// The workspace's page editor: Tiptap (MIT) on ProseMirror (MIT), bundled into public/vendor/editor.js.
// The rest of the app only ever deals in Markdown: a page is loaded as Markdown and saved as Markdown, which is
// also what agents read and write, so nothing outside this file needs to know the editor's own format.
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TaskList, TaskItem } from "@tiptap/extension-list";
import { TableKit } from "@tiptap/extension-table";
import { Placeholder } from "@tiptap/extensions";
import { Markdown } from "@tiptap/markdown";

/** The blocks the slash menu offers, in the order shown. */
export const BLOCKS = [
  { id: "text", label: "Text", hint: "Plain paragraph", words: "text paragraph plain" },
  { id: "h1", label: "Heading 1", hint: "Big section heading", words: "heading title h1 big" },
  { id: "h2", label: "Heading 2", hint: "Medium heading", words: "heading subtitle h2" },
  { id: "h3", label: "Heading 3", hint: "Small heading", words: "heading h3 small" },
  { id: "bullets", label: "Bulleted list", hint: "A simple list", words: "bullet list unordered" },
  { id: "numbers", label: "Numbered list", hint: "Steps in order", words: "numbered ordered list steps" },
  { id: "checklist", label: "Checklist", hint: "Things to tick off", words: "check todo task checklist" },
  { id: "table", label: "Table", hint: "Rows and columns", words: "table grid columns rows" },
  { id: "quote", label: "Quote", hint: "A quotation or callout", words: "quote callout" },
  { id: "code", label: "Code", hint: "Code or exact text", words: "code monospace" },
  { id: "divider", label: "Divider", hint: "A line between sections", words: "divider line rule separator" },
];

/** Where a link to another page points: an address inside the app, which the app opens itself. */
export const pageHref = (id) => `#page/${id}`;

/**
 * Makes an editor in `element`, starting from `markdown`. `onChange` is called after every edit. `onSlash` is
 * called with what follows a "/" typed at the start of an empty line, and where it is, so the app can show a menu;
 * `onSlashEnd` when that stops. `onLink` is called the same way with what follows "[[" typed anywhere, so the app
 * can offer pages to link to; `onLinkEnd` when that stops. Returns a small handle; the editor itself is never exposed.
 */
export function createEditor(element, { markdown = "", editable = true, placeholder = "", onChange, onSlash, onSlashEnd, onLink, onLinkEnd } = {}) {
  let slashing = false;
  let linking = false;
  // "[[" and up to 60 characters of a page's name, just before the cursor.
  const linkState = (editor) => {
    const { $from, empty } = editor.state.selection;
    if (!empty) return null;
    const before = $from.parent.textBetween(0, $from.parentOffset, undefined, "\ufffc");
    const m = /\[\[([^\[\]\ufffc]{0,60})$/.exec(before);
    if (!m) return null;
    return { query: m[1].trim().toLowerCase(), from: $from.pos - m[0].length, to: $from.pos };
  };
  const checkLink = (editor) => {
    const s = editable ? linkState(editor) : null;
    if (s) {
      linking = true;
      const at = editor.view.coordsAtPos(s.to);
      onLink?.(s.query, { left: at.left, top: at.top, bottom: at.bottom });
    } else if (linking) {
      linking = false;
      onLinkEnd?.();
    }
  };
  const slashState = (editor) => {
    const { state } = editor;
    const { $from, empty } = state.selection;
    if (!empty || $from.parent.type.name !== "paragraph") return null;
    const text = $from.parent.textContent;
    if (!/^\/[\p{L}\p{N} ]{0,20}$/u.test(text) || $from.parentOffset !== text.length) return null;
    return { query: text.slice(1).trim().toLowerCase(), from: $from.start(), to: $from.end() };
  };
  const checkSlash = (editor) => {
    const s = editable ? slashState(editor) : null;
    if (s) {
      slashing = true;
      const at = editor.view.coordsAtPos(s.to);
      onSlash?.(s.query, { left: at.left, top: at.top, bottom: at.bottom });
    } else if (slashing) {
      slashing = false;
      onSlashEnd?.();
    }
  };

  const editor = new Editor({
    element,
    editable,
    extensions: [
      // Links to other pages ("#page/…") are opened by the app itself, so the editor never follows them.
      StarterKit.configure({ link: { openOnClick: false, autolink: true, defaultProtocol: "https", isAllowedUri: (url, ctx) => url.startsWith("#page/") || ctx.defaultValidate(url) } }),
      TaskList,
      TaskItem.configure({ nested: true }),
      TableKit.configure({ table: { resizable: false } }),
      Placeholder.configure({ placeholder }),
      Markdown,
    ],
    content: markdown,
    contentType: "markdown",
    onUpdate: ({ editor: e }) => {
      onChange?.();
      checkSlash(e);
      checkLink(e);
    },
    onSelectionUpdate: ({ editor: e }) => (checkSlash(e), checkLink(e)),
    onBlur: () => {
      if (slashing) (slashing = false), onSlashEnd?.();
      if (linking) (linking = false), onLinkEnd?.();
    },
  });

  return {
    /** The page as Markdown. */
    markdown: () => editor.getMarkdown(),
    /** Replaces the page with some Markdown, without counting as an edit. */
    setMarkdown: (md) => editor.commands.setContent(md ?? "", { contentType: "markdown", emitUpdate: false }),
    isEmpty: () => editor.isEmpty,
    focus: (where = "end") => editor.commands.focus(where),
    setEditable: (on) => editor.setEditable(Boolean(on)),
    destroy: () => editor.destroy(),
    /** Turns the line holding "/…" into a block from BLOCKS. */
    block(id) {
      const s = slashState(editor);
      const chain = editor.chain().focus();
      if (s) chain.deleteRange({ from: s.from, to: s.to });
      const run = {
        text: (c) => c.setParagraph(),
        h1: (c) => c.setHeading({ level: 1 }),
        h2: (c) => c.setHeading({ level: 2 }),
        h3: (c) => c.setHeading({ level: 3 }),
        bullets: (c) => c.toggleBulletList(),
        numbers: (c) => c.toggleOrderedList(),
        checklist: (c) => c.toggleTaskList(),
        table: (c) => c.insertTable({ rows: 3, cols: 3, withHeaderRow: true }),
        quote: (c) => c.toggleBlockquote(),
        code: (c) => c.toggleCodeBlock(),
        divider: (c) => c.setHorizontalRule(),
      }[id];
      (run ? run(chain) : chain).run();
      slashing = false;
      onSlashEnd?.();
    },
    /** Replaces the "[[…" being typed with a link to a page, showing its title. */
    linkPage(id, title) {
      const s = linkState(editor);
      const chain = editor.chain().focus();
      if (s) chain.deleteRange({ from: s.from, to: s.to });
      chain.insertContent({ type: "text", text: title, marks: [{ type: "link", attrs: { href: pageHref(id) } }] }).unsetMark("link").insertContent(" ").run();
      linking = false;
      onLinkEnd?.();
    },
    /** Applies simple formatting from a toolbar: bold, italic, strike, code, link. */
    format(kind, value) {
      const c = editor.chain().focus();
      if (kind === "link") return (value ? c.extendMarkRange("link").setLink({ href: value }) : c.unsetLink()).run();
      ({ bold: () => c.toggleBold(), italic: () => c.toggleItalic(), strike: () => c.toggleStrike(), code: () => c.toggleCode() })[kind]?.().run();
    },
    /** Whether a mark is on where the cursor is, for lighting toolbar buttons. */
    isActive: (kind) => editor.isActive(kind),
  };
}
