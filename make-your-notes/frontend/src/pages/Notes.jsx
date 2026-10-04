import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { getAuthenticatedUser } from "../auth";
import ShareDialog from "./ShareDialog";
import MultiPageNoteEditor from "./MultiPageNoteEditor";
import { emptyNotePage, MAX_NOTE_CONTENT_BYTES, MAX_NOTE_PAGES, noteContentBytes, notePagesFromContent, plainTextFromPages, plainTextFromContent, storedContentFromPages } from "../noteContent";

const API_URL = "http://127.0.0.1:5000/api";
const newBlankNote = () => ({ title: "", pages: [emptyNotePage()], subject: "", tags: "", visibility: "private" });

function Notes() {
  const user = getAuthenticatedUser();
  const headers = { "X-User-Id": String(user?.id || "") };
  const [notes, setNotes] = useState([]);
  const [options, setOptions] = useState({ subjects: [], tags: [] });
  const [filters, setFilters] = useState({ search: "", subject: "", tag: "", visibility: "", sort: "newest" });
  const [draft, setDraft] = useState(newBlankNote());
  const [editingId, setEditingId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [status, setStatus] = useState({ type: "", text: "" });
  const [loading, setLoading] = useState(true);
  const [shareItem, setShareItem] = useState(null);

  async function loadNotes(nextFilters = filters) {
    setLoading(true);
    const params = new URLSearchParams(Object.entries(nextFilters).filter(([, value]) => value));
    try {
      const [notesResponse, optionsResponse] = await Promise.all([
        fetch(`${API_URL}/notes?${params}`, { headers }),
        fetch(`${API_URL}/notes/options`, { headers }),
      ]);
      const notesData = await notesResponse.json();
      const optionsData = await optionsResponse.json();
      if (!notesResponse.ok) throw new Error(notesData.error || "Unable to load notes.");
      setNotes(notesData.notes);
      if (optionsResponse.ok) setOptions(optionsData);
    } catch (error) {
      setStatus({ type: "error", text: error.message.includes("fetch") ? "The backend is unavailable." : error.message });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadNotes(); }, []);

  function updateFilter(event) {
    const nextFilters = { ...filters, [event.target.name]: event.target.value };
    setFilters(nextFilters);
    loadNotes(nextFilters);
  }

  function clearFilters() {
    const nextFilters = { search: "", subject: "", tag: "", visibility: "", sort: "newest" };
    setFilters(nextFilters);
    loadNotes(nextFilters);
  }

  function openCreate() {
    setDraft(newBlankNote());
    setEditingId(null);
    setStatus({ type: "", text: "" });
    setShowForm(true);
  }

  function openEdit(note) {
    setDraft({ ...note, pages: notePagesFromContent(note.content), tags: note.tags.join(", ") });
    setEditingId(note.id);
    setStatus({ type: "", text: "" });
    setShowForm(true);
  }

  async function saveNote(event) {
    event.preventDefault();
    setStatus({ type: "", text: "" });
    if (!draft.pages.length || draft.pages.length > MAX_NOTE_PAGES || draft.pages.some((page) => !page.heading.trim())) {
      setStatus({ type: "error", text: `Give every page a heading. Notes can contain up to ${MAX_NOTE_PAGES} pages.` });
      return;
    }
    const content = storedContentFromPages(draft.pages);
    if (noteContentBytes(content) > MAX_NOTE_CONTENT_BYTES) {
      setStatus({ type: "error", text: "This note is too large to save. Reduce the drawing detail or remove some drawings." });
      return;
    }
    if (!plainTextFromPages(draft.pages).trim()) {
      setStatus({ type: "error", text: "Write some content before saving your note." });
      return;
    }
    try {
      const { pages, ...noteFields } = draft;
      const response = await fetch(`${API_URL}/notes${editingId ? `/${editingId}` : ""}`, {
        method: editingId ? "PUT" : "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ ...noteFields, content }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to save note.");
      setShowForm(false);
      setStatus({ type: "success", text: data.message });
      loadNotes();
    } catch (error) {
      setStatus({ type: "error", text: error.message });
    }
  }

  async function removeNote(noteId) {
    if (!window.confirm("Delete this note?")) return;
    const response = await fetch(`${API_URL}/notes/${noteId}`, { method: "DELETE", headers });
    const data = await response.json();
    if (!response.ok) {
      setStatus({ type: "error", text: data.error || "Unable to delete note." });
      return;
    }
    setStatus({ type: "success", text: data.message });
    loadNotes();
  }

  async function copyNote(note) {
    await navigator.clipboard.writeText(plainTextFromContent(note.content));
    setStatus({ type: "success", text: "Note content copied to your clipboard." });
  }

  const hasFilters = useMemo(() => Object.values(filters).some((value) => value && value !== "newest"), [filters]);

  return <section className="notes-page">
    <div className="notes-heading"><div><p className="eyebrow">Your knowledge base</p><h1>My notes</h1><p className="dashboard-intro">Keep ideas organized by subject, pages, and tags.</p></div><button className="button primary" onClick={openCreate}>＋ Create note</button></div>
    {status.text && <p className={`message ${status.type}`}>{status.text}</p>}
    <div className="notes-toolbar">
      <label className="notes-search"><span>⌕</span><input name="search" value={filters.search} onChange={updateFilter} placeholder="Search notes, subjects, tags..." /></label>
      <select name="subject" value={filters.subject} onChange={updateFilter}><option value="">All subjects</option>{options.subjects.map((subject) => <option key={subject}>{subject}</option>)}</select>
      <select name="tag" value={filters.tag} onChange={updateFilter}><option value="">All tags</option>{options.tags.map((tag) => <option key={tag}>{tag}</option>)}</select>
      <select name="visibility" value={filters.visibility} onChange={updateFilter}><option value="">All visibility</option><option value="private">Private</option><option value="public">Public</option></select>
      <select name="sort" value={filters.sort} onChange={updateFilter}><option value="newest">Newest</option><option value="oldest">Oldest</option><option value="updated">Recently updated</option><option value="alphabetical">Alphabetical</option></select>
      {hasFilters && <button className="clear-filters" onClick={clearFilters}>Clear</button>}
    </div>
    {showForm && <form className="note-form panel" onSubmit={saveNote}>
      <div className="panel-heading"><div><p className="panel-kicker">{editingId ? "Update note" : "New note"}</p><h2>{editingId ? "Edit your note" : "Capture an idea"}</h2></div><button type="button" className="close-button" onClick={() => setShowForm(false)}>×</button></div>
      <div className="note-form-grid"><label className="note-title-field">Title<input required maxLength="200" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="e.g. Understanding neural networks" /></label><label>Subject<input maxLength="100" value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} placeholder="e.g. Data Science" /></label><label>Tags <span className="field-note">Comma separated</span><input maxLength="500" value={draft.tags} onChange={(e) => setDraft({ ...draft, tags: e.target.value })} placeholder="python, revision" /></label><label>Visibility<select value={draft.visibility} onChange={(e) => setDraft({ ...draft, visibility: e.target.value })}><option value="private">Private</option><option value="public">Public</option></select></label><div className="wide-field"><span className="note-content-label">Your notes</span><MultiPageNoteEditor pages={draft.pages} onChange={(pages) => setDraft({ ...draft, pages })} /></div></div>
      <div className="profile-form-actions"><button type="button" className="button secondary" onClick={() => setShowForm(false)}>Cancel</button><button className="button primary">Save note</button></div>
    </form>}
    <div className="notes-result-heading"><h2>{loading ? "Loading notes..." : `${notes.length} ${notes.length === 1 ? "note" : "notes"}`}</h2>{hasFilters && <span>Filtered results</span>}</div>
    {!loading && !notes.length ? <div className="panel notes-empty"><div className="empty-icon">⌁</div><h3>{hasFilters ? "No notes match these filters" : "Your notes will appear here"}</h3><p>{hasFilters ? "Try a different search or clear the filters." : "Create your first note to start building your knowledge base."}</p>{hasFilters ? <button className="text-link" onClick={clearFilters}>Clear filters</button> : <button className="button primary" onClick={openCreate}>Create your first note</button>}</div> : <div className="notes-grid">{notes.map((note) => <article className="note-card panel" key={note.id}><div className="note-card-top"><span className={`visibility-badge ${note.visibility}`}>{note.visibility}</span><div><Link className="card-action" to={`/notes/${note.id}`}>Open</Link><Link className="card-action" to={`/notes/${note.id}/edit`}>Edit</Link><button className="card-action" onClick={() => copyNote(note)}>Copy</button><button className="card-action" onClick={() => setShareItem(note)}>Share</button><button className="card-action danger" onClick={() => removeNote(note.id)} aria-label={`Delete ${note.title}`}>Delete</button></div></div><h3>{note.title}</h3><p className="note-card-content">{plainTextFromContent(note.content)}</p><div className="note-meta">{note.subject && <span>{note.subject}</span>}<span>{notePagesFromContent(note.content).length} pages</span></div><div className="note-tags">{note.tags.map((tag) => <span key={tag}>#{tag}</span>)}</div><time>Created {new Date(note.created_at).toLocaleDateString()} · Updated {new Date(note.updated_at).toLocaleDateString()}</time></article>)}</div>}
    {shareItem && <ShareDialog type="note" id={shareItem.id} visibility={shareItem.visibility} onMadePublic={() => { setShareItem({ ...shareItem, visibility: "public" }); loadNotes(); }} onClose={(message) => { setShareItem(null); if (message) setStatus({ type: "success", text: message }); }} />}
  </section>;
}

export default Notes;
