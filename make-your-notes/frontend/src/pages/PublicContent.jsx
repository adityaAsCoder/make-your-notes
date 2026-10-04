import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getAuthenticatedUser } from "../auth";
import { notePagesFromContent, sanitizeNoteHtml } from "../noteContent";

const API_URL = "http://127.0.0.1:5000/api";

function PublicContent({ type }) {
  const { id } = useParams();
  const [item, setItem] = useState(null);
  const [error, setError] = useState("");
  const [community, setCommunity] = useState({ likes: 0, liked: false, bookmarked: false, comments: [] });
  const [comment, setComment] = useState("");
  const [communityStatus, setCommunityStatus] = useState("");
  const isNote = type === "note";
  const user = getAuthenticatedUser();
  const headers = { "X-User-Id": String(user?.id || "") };

  useEffect(() => {
    fetch(`${API_URL}/public/${isNote ? "notes" : "code"}/${id}`)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "This shared item is unavailable.");
        setItem(isNote ? data.note : data.code_space);
        const communityResponse = await fetch(`${API_URL}/public/${isNote ? "notes" : "code"}/${id}/community`, { headers });
        if (communityResponse.ok) {
          const communityData = await communityResponse.json();
          setCommunity((current) => ({ ...current, ...communityData }));
        }
      })
      .catch((requestError) => setError(requestError.message));
  }, [id, isNote]);

  if (error) {
    return <main className="public-page"><div className="public-error panel"><div className="empty-icon">!</div><h1>Content unavailable</h1><p>{error}</p><Link className="button primary" to="/">Go to makeYourNotes</Link></div></main>;
  }
  if (!item) return <main className="public-page"><p className="eyebrow">Shared learning content</p><h1>Loading...</h1></main>;

  async function toggle(path, activeKey) {
    if (!user) { setCommunityStatus("Please log in to use this feature."); return; }
    const base = isNote ? "notes" : "code";
    const response = await fetch(`${API_URL}/${base}/${id}/${path}`, { method: community[activeKey] ? "DELETE" : "POST", headers });
    const data = await response.json();
    if (!response.ok) { setCommunityStatus(data.error || "Unable to update this note."); return; }
    setCommunity({ ...community, [activeKey]: data[activeKey] || false, likes: path === "like" ? community.likes + (data.liked ? 1 : -1) : community.likes });
  }

  async function addComment(event) {
    event.preventDefault();
    if (!user) { setCommunityStatus("Please log in to comment."); return; }
    const response = await fetch(`${API_URL}/${isNote ? "notes" : "code"}/${id}/comments`, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ content: comment }) });
    const data = await response.json();
    if (!response.ok) { setCommunityStatus(data.error || "Unable to add comment."); return; }
    setComment("");
    const latest = await fetch(`${API_URL}/public/${isNote ? "notes" : "code"}/${id}/community`, { headers });
    if (latest.ok) setCommunity(await latest.json());
  }

  async function removeComment(commentId) {
    const response = await fetch(`${API_URL}/comments/${commentId}`, { method: "DELETE", headers });
    if (response.ok) setCommunity({ ...community, comments: community.comments.filter((entry) => entry.id !== commentId) });
  }

  async function copyCode() {
    await navigator.clipboard.writeText(item.code);
    setCommunityStatus("Code copied!");
  }

  return <main className="public-page">
    <div className="public-brand"><Link className="brand" to="/">make<span>YourNotes</span></Link><span>Public link</span></div>
    <article className="public-content">
      <p className="eyebrow">{isNote ? item.subject || "Study note" : `${item.language} code space`}</p>
      <h1>{item.title}</h1>
      <p className="public-description">{isNote ? `${notePagesFromContent(item.content).length} pages` : item.description || "Shared code space"}</p>
      <p className="public-description">By {item.author_name || "User"}</p>
      {isNote && <div className="note-tags">{item.tags.map((tag) => <span key={tag}>#{tag}</span>)}</div>}
      {isNote ? <div className="public-note-pages">{notePagesFromContent(item.content).map((page, index) => <section className="rendered-note-page" key={page.id}><p className="rendered-note-page-kicker">Page {index + 1}</p><h2>{page.heading}</h2>{page.showText !== false && <div className="rendered-note-content" dangerouslySetInnerHTML={{ __html: sanitizeNoteHtml(page.html) }} />}{page.showDrawing !== false && page.drawing && <img className="rendered-note-drawing" src={page.drawing} alt={`Drawing on ${page.heading}`} />}</section>)}</div> : <><pre className="code-viewer"><code>{item.code}</code></pre><button className="button secondary" onClick={copyCode}>Copy code</button></>}
      <small>Created {new Date(item.created_at).toLocaleDateString()} · Updated {new Date(item.updated_at).toLocaleDateString()}</small>
      <section className="community-panel"><div className="community-actions"><button onClick={() => toggle("like", "liked")}>{community.liked ? "♥ Liked" : "♡ Like"} · {community.likes} Likes</button><button onClick={() => toggle("bookmark", "bookmarked")}>🔖 {community.bookmarked ? "Bookmarked" : "Bookmark"}</button></div>{communityStatus && <p className="message error">{communityStatus}</p>}<h2>Comments ({community.comments.length})</h2>{community.comments.length ? community.comments.map((entry) => <div className="comment" key={entry.id}>{entry.profile_picture ? <img className="comment-avatar" src={entry.profile_picture} alt="" /> : <span className="comment-avatar">{(entry.name || "U").slice(0, 1).toUpperCase()}</span>}<div><strong>{entry.name} <small>@{entry.username} · {new Date(entry.created_at).toLocaleDateString()}</small></strong><p>{entry.content}</p>{user?.id === entry.user_id && <button onClick={() => removeComment(entry.id)}>Delete</button>}</div></div>) : <p className="explore-empty">No comments yet. Be the first to comment.</p>}{user ? <form className="comment-form" onSubmit={addComment}><textarea value={comment} onChange={(event) => setComment(event.target.value)} maxLength="2000" placeholder="Write a comment..." required /><button className="button primary">Post comment</button></form> : <p className="explore-empty">Please log in to comment.</p>}</section>
    </article>
  </main>;
}

export default PublicContent;
