export const MAX_NOTE_PAGES = 50;
export const MAX_NOTE_CONTENT_BYTES = 12 * 1024 * 1024;
export const MAX_PAGE_DRAWING_LENGTH = "data:image/png;base64,".length + 4 * Math.ceil((2 * 1024 * 1024) / 3);

const CONTENT_FORMAT = "makeYourNotes-rich-v1";
const BLOCK_TAGS = new Set(["P", "H2", "H3", "UL", "OL", "LI", "BLOCKQUOTE", "DIV"]);
const INLINE_TAGS = new Set(["BR", "STRONG", "B", "EM", "I", "U", "S", "MARK", "SPAN"]);
const DROP_TAGS = new Set(["SCRIPT", "STYLE", "IFRAME", "OBJECT", "SVG", "TEMPLATE"]);

function newPageId() {
  return `page-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function validDrawing(value) {
  return typeof value === "string"
    && value.length <= MAX_PAGE_DRAWING_LENGTH
    && /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value);
}

export function emptyNotePage(index = 0) {
  return { id: newPageId(), heading: `Page ${index + 1}`, html: "<p><br></p>", drawing: "", showText: true, showDrawing: true };
}

function plainTextFromHtml(html) {
  const parsed = new DOMParser().parseFromString(String(html || ""), "text/html");
  return parsed.body.textContent || "";
}

function legacyHtmlFromContent(content) {
  const text = String(content || "");
  if (text.trimStart().startsWith("<")) return sanitizeNoteHtml(text);
  return text.split(/\r?\n/).map((line) => (
    `<p>${line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") || "<br>"}</p>`
  )).join("") || "<p><br></p>";
}

export function sanitizeNoteHtml(html) {
  const parsed = new DOMParser().parseFromString(String(html || ""), "text/html");
  const output = document.createElement("div");

  function copySafeNode(source, parent) {
    if (source.nodeType === Node.TEXT_NODE) {
      parent.append(document.createTextNode(source.textContent || ""));
      return;
    }
    if (source.nodeType !== Node.ELEMENT_NODE || DROP_TAGS.has(source.tagName)) return;

    let tag = source.tagName;
    if (tag === "SPAN" && source.getAttribute("style")?.includes("background-color")) tag = "MARK";
    if (!BLOCK_TAGS.has(tag) && !INLINE_TAGS.has(tag)) {
      Array.from(source.childNodes).forEach((child) => copySafeNode(child, parent));
      return;
    }
    const safeElement = document.createElement(tag.toLowerCase());
    Array.from(source.childNodes).forEach((child) => copySafeNode(child, safeElement));
    parent.append(safeElement);
  }

  Array.from(parsed.body.childNodes).forEach((child) => copySafeNode(child, output));
  return output.innerHTML;
}

export function notePagesFromContent(content) {
  try {
    const stored = JSON.parse(String(content || ""));
    if (stored?.format === CONTENT_FORMAT) {
      if (Array.isArray(stored.pages) && stored.pages.length) {
        return stored.pages.slice(0, MAX_NOTE_PAGES).map((page, index) => ({
          id: String(page.id || `saved-page-${index + 1}`),
          heading: String(page.heading || `Page ${index + 1}`).slice(0, 200),
          html: sanitizeNoteHtml(page.html || ""),
          drawing: validDrawing(page.drawing) ? page.drawing : "",
          showText: page.showText !== false,
          showDrawing: page.showDrawing !== false,
        }));
      }
      if (typeof stored.html === "string") {
        return [{ id: "page-1", heading: "Page 1", html: sanitizeNoteHtml(stored.html) }];
      }
    }
  } catch {
    // Existing notes may contain plain text or legacy HTML.
  }
  return [{ id: "page-1", heading: "Page 1", html: legacyHtmlFromContent(content) }];
}

export function storedContentFromPages(pages) {
  return JSON.stringify({
    format: CONTENT_FORMAT,
    pages: pages.slice(0, MAX_NOTE_PAGES).map((page, index) => ({
      id: String(page.id || `page-${index + 1}`),
      heading: String(page.heading || `Page ${index + 1}`).trim().slice(0, 200),
      html: sanitizeNoteHtml(page.html),
      drawing: validDrawing(page.drawing) ? page.drawing : "",
      showText: page.showText !== false,
      showDrawing: page.showDrawing !== false,
    })),
  });
}

export function noteContentBytes(content) {
  return new TextEncoder().encode(content).length;
}

export function plainTextFromContent(content) {
  return notePagesFromContent(content)
    .map((page) => `${page.heading}\n${page.showText ? plainTextFromHtml(page.html) : ""}${page.showDrawing && page.drawing ? "\nDrawing" : ""}`.trim())
    .filter(Boolean)
    .join("\n\n");
}

export function plainTextFromPages(pages) {
  return pages.map((page) => `${page.showText !== false ? plainTextFromHtml(page.html) : ""}${page.showDrawing !== false && page.drawing ? "\nDrawing" : ""}`).join("\n");
}
