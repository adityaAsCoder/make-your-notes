import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { getAuthenticatedUser } from "../auth";
import ShareDialog from "./ShareDialog";
import MultiPageNoteEditor from "./MultiPageNoteEditor";
import { emptyNotePage, MAX_NOTE_CONTENT_BYTES, MAX_NOTE_PAGES, noteContentBytes, notePagesFromContent, plainTextFromContent, plainTextFromPages, sanitizeNoteHtml, storedContentFromPages } from "../noteContent";

const API_URL = "http://127.0.0.1:5000/api";
const blank = { title: "", subject: "", tags: "", pages: [emptyNotePage()], content: "", visibility: "private" };

function NotePage({ mode = "view" }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const user = getAuthenticatedUser();
  const headers = { "X-User-Id": String(user?.id || "") };
  const [note, setNote] = useState(blank);
  const [status, setStatus] = useState({ type: "", text: "" });
  const [loading, setLoading] = useState(Boolean(id));
  const [showShare, setShowShare] = useState(false);

  useEffect(() => {
    if (!id) return;
    fetch(`${API_URL}/notes/${id}`, { headers }).then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to load note.");
      setNote({ ...data.note, pages: notePagesFromContent(data.note.content), tags: data.note.tags.join(", ") });
    }).catch((error) => setStatus({ type: "error", text: error.message })).finally(() => setLoading(false));
  }, [id]);

  async function save(event) {
    event.preventDefault();
    const content = storedContentFromPages(note.pages);
    if (!note.pages.length || note.pages.length > MAX_NOTE_PAGES || note.pages.some((page) => !page.heading.trim())) {
      setStatus({ type: "error", text: `Give every page a heading. Notes can contain up to ${MAX_NOTE_PAGES} pages.` });
      return;
    }
    if (noteContentBytes(content) > MAX_NOTE_CONTENT_BYTES) {
      setStatus({ type: "error", text: "This note is too large to save. Reduce the drawing detail or remove some drawings." });
      return;
    }
    if (!plainTextFromPages(note.pages).trim()) {
      setStatus({ type: "error", text: "Write some content before saving your note." });
      return;
    }
    try {
      const { pages, ...noteFields } = note;
      const response = await fetch(`${API_URL}/notes${id ? `/${id}` : ""}`, {
        method: id ? "PUT" : "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ ...noteFields, content }),
      });
      const data = await response.json();
      if (!response.ok) { setStatus({ type: "error", text: data.error || "Unable to save note." }); return; }
      navigate(id ? `/notes/${id}` : "/notes");
    } catch {
      setStatus({ type: "error", text: "The backend is unavailable. Please try again." });
    }
  }

  async function copy() {
    await navigator.clipboard.writeText(plainTextFromContent(note.content));
    setStatus({ type: "success", text: "Note content copied to your clipboard." });
  }

  async function remove() {
    if (!window.confirm("Delete this note?")) return;
    const response = await fetch(`${API_URL}/notes/${id}`, { method: "DELETE", headers });
    const data = await response.json();
    if (!response.ok) { setStatus({ type: "error", text: data.error || "Unable to delete note." }); return; }
    navigate("/notes");
  }

  if (loading) return <section className="simple-page"><p className="eyebrow">Notes</p><h1>Loading note...</h1></section>;
  if (status.type === "error" && id && !note.title) return <section className="simple-page"><p className="message error">{status.text}</p><Link className="button secondary" to="/notes">Back to notes</Link></section>;
  if (mode === "edit" || mode === "create") return <NoteForm note={note} setNote={setNote} save={save} cancel={() => navigate(id ? `/notes/${id}` : "/notes")} status={status} />;

  return <section className="note-detail-page"><div className="note-detail-header"><div><p className="eyebrow">{note.subject || "Study note"} · {note.visibility}</p><h1>{note.title}</h1><p className="dashboard-intro">{notePagesFromContent(note.content).length} pages</p></div><div className="actions"><Link className="button secondary" to={`/notes/${id}/edit`}>Edit</Link><button className="button secondary" onClick={copy}>Copy</button><button className="button secondary" onClick={() => setShowShare(true)}>Share</button><button className="button secondary" onClick={remove}>Delete</button></div></div>{status.text && <p className={`message ${status.type}`}>{status.text}</p>}<div className="panel note-detail-content"><div className="note-tags">{note.tags.split(",").map((tag) => tag.trim()).filter(Boolean).map((tag) => <span key={tag}>#{tag}</span>)}</div>{notePagesFromContent(note.content).map((page, index) => <section className="rendered-note-page" key={page.id}><p className="rendered-note-page-kicker">Page {index + 1}</p><h2>{page.heading}</h2>{page.showText !== false && <div className="rendered-note-content" dangerouslySetInnerHTML={{ __html: sanitizeNoteHtml(page.html) }} />}{page.showDrawing !== false && page.drawing && <img className="rendered-note-drawing" src={page.drawing} alt={`Drawing on ${page.heading}`} />}</section>)}<small>Created {new Date(note.created_at).toLocaleDateString()} · Updated {new Date(note.updated_at).toLocaleDateString()}</small></div>{showShare && <ShareDialog type="note" id={note.id} visibility={note.visibility} onClose={(message) => { setShowShare(false); if (message) setStatus({ type: "success", text: message }); }} />}</section>;
}

function NoteForm({ note, setNote, save, cancel, status }) {
  const update = (event) => setNote({ ...note, [event.target.name]: event.target.value });
  return <section className="note-editor-page"><p className="eyebrow">{note.title ? "Edit note" : "New note"}</p><h1>{note.title ? "Update your note" : "Create a note"}</h1>{status.text && <p className={`message ${status.type}`}>{status.text}</p>}<form className="note-form panel" onSubmit={save}><div className="note-form-grid"><label className="note-title-field">Title<input name="title" required maxLength="200" value={note.title} onChange={update} /></label><label>Subject<input name="subject" maxLength="100" value={note.subject} onChange={update} /></label><label>Tags <span className="field-note">Comma separated</span><input name="tags" maxLength="500" value={note.tags} onChange={update} /></label><label>Visibility<select name="visibility" value={note.visibility === "shared" ? "public" : note.visibility} onChange={update}><option value="private">Private</option><option value="public">Public</option></select></label><div className="wide-field"><span className="note-content-label">Your notes</span><MultiPageNoteEditor pages={note.pages} onChange={(pages) => setNote({ ...note, pages })} /></div></div><div className="profile-form-actions"><button type="button" className="button secondary" onClick={cancel}>Cancel</button><button className="button primary">Save note</button></div></form></section>;
}

export default NotePage;
