import { useEffect, useState } from "react";

import { MAX_NOTE_PAGES } from "../noteContent";
import RichNoteEditor from "./RichNoteEditor";
import PaintCanvas from "./PaintCanvas";

export default function MultiPageNoteEditor({ pages, onChange }) {
  const [activePageId, setActivePageId] = useState(pages[0]?.id);
  const activePage = pages.find((page) => page.id === activePageId) || pages[0];

  useEffect(() => {
    if (!pages.some((page) => page.id === activePageId)) {
      setActivePageId(pages[0]?.id);
    }
  }, [activePageId, pages]);

  function updatePage(pageId, changes) {
    onChange(pages.map((page) => page.id === pageId ? { ...page, ...changes } : page));
  }

  function addPage() {
    if (pages.length >= MAX_NOTE_PAGES) return;
    const page = {
      id: `page-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      heading: `Page ${pages.length + 1}`,
      html: "<p><br></p>",
      drawing: "",
      showText: true,
      showDrawing: true,
    };
    onChange([...pages, page]);
    setActivePageId(page.id);
  }

  function removePage() {
    if (pages.length <= 1) return;
    const pageIndex = pages.findIndex((page) => page.id === activePage.id);
    const nextPages = pages.filter((page) => page.id !== activePage.id);
    onChange(nextPages);
    setActivePageId(nextPages[Math.max(0, pageIndex - 1)].id);
  }

  if (!activePage) return null;

  return <div className="multipage-note-editor">
    <aside className="note-page-sidebar" aria-label="Note pages">
      <div className="note-pages-heading"><strong>Pages</strong><span>{pages.length}/{MAX_NOTE_PAGES}</span></div>
      <nav className="note-page-list">
        {pages.map((page, index) => <button
          type="button"
          className={`note-page-tab${page.id === activePage.id ? " active" : ""}`}
          key={page.id}
          onClick={() => setActivePageId(page.id)}
          title={page.heading}
        ><span>{String(index + 1).padStart(2, "0")}</span>{page.heading || `Page ${index + 1}`}</button>)}
      </nav>
      <button type="button" className="add-note-page" onClick={addPage} disabled={pages.length >= MAX_NOTE_PAGES}>＋ Add page</button>
    </aside>
    <section className="note-page-workspace" aria-label={`Editing ${activePage.heading}`}>
      <div className="note-page-heading-row">
        <input
          className="note-page-heading-input"
          aria-label="Page heading"
          maxLength="200"
          value={activePage.heading}
          onChange={(event) => updatePage(activePage.id, { heading: event.target.value })}
          placeholder="Page heading"
          required
        />
        <button type="button" className="remove-note-page" onClick={removePage} disabled={pages.length <= 1}>Remove page</button>
      </div>
      <div className="note-page-sections" role="group" aria-label="Page sections">
        <span>Page sections</span>
        <button
          type="button"
          aria-pressed={activePage.showText !== false}
          onClick={() => updatePage(activePage.id, { showText: activePage.showText === false })}
          disabled={activePage.showText !== false && activePage.showDrawing === false}
        >{activePage.showText === false ? "＋ Add text" : "− Remove text"}</button>
        <button
          type="button"
          aria-pressed={activePage.showDrawing !== false}
          onClick={() => updatePage(activePage.id, { showDrawing: activePage.showDrawing === false })}
          disabled={activePage.showDrawing !== false && activePage.showText === false}
        >{activePage.showDrawing === false ? "＋ Add canvas" : "− Remove canvas"}</button>
        <small>Hidden sections keep their content and can be added back.</small>
      </div>
      {activePage.showText !== false && <RichNoteEditor
        key={activePage.id}
        value={activePage.html}
        onChange={(html) => updatePage(activePage.id, { html })}
      />}
      {activePage.showDrawing !== false && <PaintCanvas
        key={`drawing-${activePage.id}`}
        value={activePage.drawing || ""}
        onChange={(drawing) => updatePage(activePage.id, { drawing })}
      />}
    </section>
  </div>;
}
