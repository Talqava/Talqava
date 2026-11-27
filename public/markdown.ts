// A small Markdown renderer that builds DOM nodes directly, so text from the
// model or the web can never be interpreted as HTML.

function el(tag, children = [], attrs = {}) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  node.append(...children);
  return node;
}

const INLINE = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\s][^*\n]*\*)|(\[[^\]\n]+\]\([^)\s]+\))|(https?:\/\/[^\s<>)\]]+)/g;

function link(text, href) {
  // A link to another of Talqava's own documents (a guide, a policy) is opened by the reader showing it; elsewhere it goes nowhere.
  if (/^(\.\.?\/)*[\w./-]+\.md(#[\w-]*)?$|^(\.\.\/)+LICENSE$/.test(href)) return el("a", [text], { href: "#", "data-doc": href, class: "doclink" });
  if (!/^(https?:|mailto:)/i.test(href)) return document.createTextNode(text);
  return el("a", [text], { href, target: "_blank", rel: "noopener noreferrer" });
}

export function inline(text) {
  const out = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    if (match.index > last) out.push(text.slice(last, match.index));
    const token = match[0];
    if (match[1]) out.push(el("code", [token.slice(1, -1)]));
    else if (match[2]) out.push(el("strong", inline(token.slice(2, -2))));
    else if (match[3]) out.push(el("em", inline(token.slice(1, -1))));
    else if (match[4]) {
      const parts = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
      out.push(link(parts[1], parts[2]));
    } else out.push(link(token, token));
    last = match.index + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const cells = (line) => line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());

export function renderMarkdown(source) {
  const root = document.createDocumentFragment();
  const lines = source.replace(/\r/g, "").split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const fence = /^\s*```/.test(line);
    if (fence) {
      const code = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i++]);
      i++;
      root.append(el("pre", [el("code", [code.join("\n")])]));
      continue;
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      root.append(el(`h${Math.min(heading[1].length, 3)}`, inline(heading[2])));
      i++;
      continue;
    }
    if (/^\s*([-*_])\s*(\1\s*){2,}$/.test(line)) {
      root.append(el("hr"));
      i++;
      continue;
    }
    if (line.includes("|") && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] || "")) {
      const head = el("tr", cells(line).map((c) => el("th", inline(c))));
      const body = [];
      i += 2;
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
        body.push(el("tr", cells(lines[i++]).map((c) => el("td", inline(c)))));
      }
      root.append(el("table", [el("thead", [head]), el("tbody", body)]));
      continue;
    }
    const item = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (item) {
      const ordered = /\d/.test(item[1]);
      const items = [];
      while (i < lines.length) {
        const next = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(lines[i]);
        if (next) items.push(next[2]);
        else if (/^\s{2,}\S/.test(lines[i]) && items.length) items[items.length - 1] += ` ${lines[i].trim()}`;
        else break;
        i++;
      }
      root.append(el(ordered ? "ol" : "ul", items.map((text) => el("li", inline(text)))));
      continue;
    }
    if (/^\s*>/.test(line)) {
      const quote = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) quote.push(lines[i++].replace(/^\s*>\s?/, ""));
      root.append(el("blockquote", inline(quote.join(" "))));
      continue;
    }
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^\s*(```|#{1,4}\s|>|([-*+]|\d+[.)])\s)/.test(lines[i])) para.push(lines[i++]);
    if (!para.length) para.push(lines[i++]); // always move forward
    const p = el("p");
    para.forEach((text, n) => {
      if (n) p.append(el("br"));
      p.append(...inline(text));
    });
    root.append(p);
  }
  return root;
}
