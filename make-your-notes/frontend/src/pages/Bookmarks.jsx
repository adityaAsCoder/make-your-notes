import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getAuthenticatedUser } from "../auth";
import { plainTextFromContent } from "../noteContent";

const API_URL = "http://127.0.0.1:5000/api";

function Bookmarks() {
  const user = getAuthenticatedUser();
  const [data, setData] = useState({ notes: [], code_spaces: [] });
  const [status, setStatus] = useState("");

  async function load() {
    try {
      const response = await fetch(`${API_URL}/bookmarks`, { headers: { "X-User-Id": String(user?.id || "") } });
      const result = await response.json();
      if (!response.ok) throw new Error("Bookmarks are temporarily unavailable.");
      setData(result);
    } catch {
      setStatus("Bookmarks are temporarily unavailable. Please try again.");
    }
  }

  useEffect(() => { load(); }, []);

  async function remove(type, id) {
    const path = type === "note" ? `notes/${id}/bookmark` : `code/${id}/bookmark`;
    const response = await fetch(`${API_URL}/${path}`, { method: "DELETE", headers: { "X-User-Id": String(user?.id || "") } });
    if (!response.ok) {
      setStatus("Unable to remove this bookmark.");
      return;
    }
    load();
  }

  return <section className="bookmarks-page"><div className="profile-heading"><div><p className="eyebrow">Saved for later</p><h1>Bookmarks</h1><p className="dashboard-intro">Keep public notes and Code Spaces close at hand.</p></div></div>{status && <p className="message error">{status}</p>}<BookmarkSection title="Notes" empty="No bookmarked notes yet."><div className="notes-grid">{data.notes.map((note) => <article className="panel note-card" key={note.id}><p className="panel-kicker">{note.subject || "Study note"}</p><h2>{note.title}</h2><p>{plainTextFromContent(note.content).slice(0, 150)}</p><small>By {note.author_name} · Updated {new Date(note.updated_at).toLocaleDateString()}</small><div className="card-actions"><Link to={`/public/notes/${note.id}`}>Open</Link><button onClick={() => remove("note", note.id)}>Remove</button></div></article>)}</div></BookmarkSection><BookmarkSection title="Code Spaces" empty="No bookmarked Code Spaces yet."><div className="code-grid">{data.code_spaces.map((space) => <article className="panel code-card" key={space.id}><span className="language-badge">{space.language}</span><h2>{space.title}</h2><p>{space.description || "Public learning project."}</p><small>By {space.author_name} · Updated {new Date(space.updated_at).toLocaleDateString()}</small><div className="card-actions"><Link to={`/public/code/${space.id}`}>Open</Link><button onClick={() => remove("code", space.id)}>Remove</button></div></article>)}</div></BookmarkSection></section>;
}

function BookmarkSection({ title, empty, children }) {
  return <section className="explore-section"><div className="explore-section-heading"><h2>{title}</h2></div>{children.props.children.length ? children : <p className="explore-empty">{empty}</p>}</section>;
}

export default Bookmarks;
