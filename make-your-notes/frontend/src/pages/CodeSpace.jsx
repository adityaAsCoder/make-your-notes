import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { getAuthenticatedUser } from "../auth";
import ShareDialog from "./ShareDialog";

const API_URL = "http://127.0.0.1:5000/api";
const languages = ["Java", "Python", "JavaScript", "Dart", "C", "C++"];
const blank = { title: "", description: "", language: "Python", code: "", visibility: "private" };

function CodeSpace() {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const user = getAuthenticatedUser();
  const headers = { "X-User-Id": String(user?.id || "") };
  const [items, setItems] = useState([]);
  const [item, setItem] = useState(null);
  const [draft, setDraft] = useState(blank);
  const [status, setStatus] = useState({ type: "", text: "" });
  const [loading, setLoading] = useState(true);
  const [shareItem, setShareItem] = useState(null);
  const editing = Boolean(id);

  useEffect(() => {
    const url = id ? `${API_URL}/code/${id}` : `${API_URL}/code`;
    fetch(url, { headers }).then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to load code spaces.");
      if (id) { setItem(data.code_space); setDraft(data.code_space); } else setItems(data.code_spaces);
    }).catch((error) => setStatus({ type: "error", text: error.message })).finally(() => setLoading(false));
  }, [id, location.pathname]);

  function setField(event) { setDraft({ ...draft, [event.target.name]: event.target.value }); }
  async function save(event) {
    event.preventDefault();
    try {
      const response = await fetch(`${API_URL}/code${id ? `/${id}` : ""}`, {
        method: id ? "PUT" : "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify(draft),
      });
      const data = await response.json();
      if (!response.ok) { setStatus({ type: "error", text: data.error || "Unable to save code space." }); return; }
      navigate(id ? `/code/${id}` : `/code/${data.id}`);
    } catch {
      setStatus({ type: "error", text: "The backend is unavailable. Please try again." });
    }
  }
  async function remove(codeId = id) {
    if (!window.confirm("Delete this code space?")) return;
    const response = await fetch(`${API_URL}/code/${codeId}`, { method: "DELETE", headers });
    const data = await response.json();
    if (!response.ok) { setStatus({ type: "error", text: data.error || "Unable to delete code space." }); return; }
    navigate("/code");
  }
  async function copy(code) {
    await navigator.clipboard.writeText(code);
    setStatus({ type: "success", text: "Code copied to your clipboard." });
  }

  if (loading) return <section className="simple-page"><p className="eyebrow">Code Space</p><h1>Loading...</h1></section>;
  if (id && !item && status.type === "error") return <section className="simple-page"><p className="message error">{status.text}</p><Link className="button secondary" to="/code">Back to Code Space</Link></section>;

  if (location.pathname.endsWith("/edit") || location.pathname.endsWith("/create")) return <CodeEditor draft={draft} setField={setField} save={save} cancel={() => navigate(id ? `/code/${id}` : "/code")} status={status} editing={editing} />;
  if (!id) return <section className="code-page"><div className="code-heading"><div><p className="eyebrow">Your coding workspace</p><h1>Code Space</h1><p className="dashboard-intro">Save code experiments and learning projects in one place.</p></div><Link className="button primary" to="/code/create">＋ Create code space</Link></div>{status.text && <p className={`message ${status.type}`}>{status.text}</p>}{!items.length ? <div className="panel code-empty"><div className="empty-icon">&lt;/&gt;</div><h3>No code spaces yet</h3><p>Save your first code snippet and keep building.</p><Link className="button primary" to="/code/create">Create your first code space</Link></div> : <div className="code-grid">{items.map((space) => <article className="panel code-card" key={space.id}><div className="code-card-top"><span className="language-badge">{space.language}</span><span className={`visibility-badge ${space.visibility}`}>{space.visibility}</span></div><h2>{space.title}</h2><p>{space.description || "No description provided."}</p><time>Updated {new Date(space.updated_at).toLocaleDateString()}</time><div className="code-card-actions"><Link to={`/code/${space.id}`}>Open</Link><Link to={`/code/${space.id}/edit`}>Edit</Link><button onClick={() => copy(space.code)}>Copy</button><button onClick={() => remove(space.id)}>Delete</button><button onClick={() => setShareItem(space)}>Share</button></div></article>)}</div>}{shareItem && <ShareDialog type="code" id={shareItem.id} visibility={shareItem.visibility} onMadePublic={() => { setShareItem({ ...shareItem, visibility: "public" }); const nextItems = items.map((entry) => entry.id === shareItem.id ? { ...entry, visibility: "public" } : entry); setItems(nextItems); }} onClose={(message) => { setShareItem(null); if (message) setStatus({ type: "success", text: message }); }} />}</section>;
  return <section className="code-detail"><div className="code-detail-header"><div><p className="eyebrow">{item.language} · {item.visibility}</p><h1>{item.title}</h1><p className="dashboard-intro">{item.description}</p></div><div className="actions"><Link className="button secondary" to={`/code/${id}/edit`}>Edit</Link><button className="button secondary" onClick={() => copy(item.code)}>Copy</button><button className="button secondary" onClick={() => setShareItem(item)}>Share</button><button className="button secondary" onClick={() => remove()}>Delete</button></div></div>{status.text && <p className={`message ${status.type}`}>{status.text}</p>}<pre className="code-viewer"><code>{item.code}</code></pre>{shareItem && <ShareDialog type="code" id={item.id} visibility={item.visibility} onMadePublic={() => { setItem({ ...item, visibility: "public" }); setShareItem({ ...item, visibility: "public" }); }} onClose={(message) => { setShareItem(null); if (message) setStatus({ type: "success", text: message }); }} />}</section>;
}

function CodeEditor({ draft, setField, save, cancel, status, editing }) {
  const codeRef = useRef(null);

  function handleCodeKeyDown(event) {
    const textarea = event.currentTarget;
    const { selectionStart, selectionEnd, value } = textarea;
    const pairs = { "(": ")", "[": "]", "{": "}", '"': '"', "'": "'", "`": "`" };
    const closingBrackets = new Set(Object.values(pairs).filter((character) => character !== '"' && character !== "'" && character !== "`"));

    if (event.key === "Tab") {
      event.preventDefault();
      const indentation = "  ";
      const nextValue = `${value.slice(0, selectionStart)}${indentation}${value.slice(selectionEnd)}`;
      setField({ target: { name: "code", value: nextValue } });
      requestAnimationFrame(() => {
        textarea.selectionStart = selectionStart + indentation.length;
        textarea.selectionEnd = selectionStart + indentation.length;
      });
      return;
    }

    if (event.key === "Backspace" && selectionStart === selectionEnd) {
      const previousCharacter = value[selectionStart - 1];
      const nextCharacter = value[selectionStart];
      if (pairs[previousCharacter] === nextCharacter) {
        event.preventDefault();
        const nextValue = `${value.slice(0, selectionStart - 1)}${value.slice(selectionStart + 1)}`;
        setField({ target: { name: "code", value: nextValue } });
        requestAnimationFrame(() => {
          textarea.selectionStart = selectionStart - 1;
          textarea.selectionEnd = selectionStart - 1;
        });
        return;
      }
    }

    if (event.key === "Enter" && selectionStart === selectionEnd) {
      event.preventDefault();
      const lineStart = value.lastIndexOf("\n", selectionStart - 1) + 1;
      const currentLine = value.slice(lineStart, selectionStart);
      const indentation = currentLine.match(/^\s*/)?.[0] || "";
      const previousCharacter = value[selectionStart - 1];
      const nextCharacter = value[selectionStart];
      const extraIndent = ["{", "[", "("].includes(previousCharacter) ? "  " : "";
      const closingIndent = closingBrackets.has(nextCharacter) && extraIndent ? indentation : indentation + extraIndent;
      const insertedText = `\n${closingIndent}`;
      const nextValue = `${value.slice(0, selectionStart)}${insertedText}${value.slice(selectionEnd)}`;
      setField({ target: { name: "code", value: nextValue } });
      requestAnimationFrame(() => {
        textarea.selectionStart = selectionStart + insertedText.length;
        textarea.selectionEnd = selectionStart + insertedText.length;
      });
      return;
    }

    if (pairs[event.key] && selectionStart === selectionEnd) {
      const closingCharacter = pairs[event.key];
      if (closingCharacter === event.key && value[selectionStart] === closingCharacter) {
        event.preventDefault();
        requestAnimationFrame(() => {
          textarea.selectionStart = selectionStart + 1;
          textarea.selectionEnd = selectionStart + 1;
        });
        return;
      }

      event.preventDefault();
      const nextValue = `${value.slice(0, selectionStart)}${event.key}${closingCharacter}${value.slice(selectionEnd)}`;
      setField({ target: { name: "code", value: nextValue } });
      requestAnimationFrame(() => {
        textarea.selectionStart = selectionStart + 1;
        textarea.selectionEnd = selectionStart + 1;
      });
    }
  }

  return <section className="code-editor-page"><div className="code-editor-heading"><div><p className="eyebrow">{editing ? "Edit workspace" : "New workspace"}</p><h1>{editing ? "Edit code space" : "Create code space"}</h1></div></div>{status.text && <p className={`message ${status.type}`}>{status.text}</p>}<form className="code-editor panel" onSubmit={save}><div className="code-editor-fields"><label>Title<input name="title" value={draft.title} onChange={setField} required maxLength="200" placeholder="My learning project" /></label><label>Language<select name="language" value={draft.language} onChange={setField}>{languages.map((language) => <option key={language}>{language}</option>)}</select></label><label className="wide-field">Description<textarea name="description" value={draft.description} onChange={setField} rows="2" maxLength="1000" placeholder="What are you working on?" /></label><label>Visibility<select name="visibility" value={draft.visibility} onChange={setField}>  <option value="private">Private</option><option value="public">Public</option></select></label></div><label className="code-label">Code<textarea ref={codeRef} className="code-input" name="code" value={draft.code} onChange={setField} onKeyDown={handleCodeKeyDown} required maxLength="100000" spellCheck="false" placeholder="// Start writing your code here..." /></label><div className="profile-form-actions"><button type="button" className="button secondary" onClick={cancel}>Cancel</button><button className="button primary">Save code space</button></div></form></section>;
}

export default CodeSpace;
