import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import FollowButton from "./FollowButton";
import { plainTextFromContent } from "../noteContent";

const API_URL = "http://127.0.0.1:5000/api";
const emptyData = { notes: [], code_spaces: [], users: [], subjects: [], languages: [], tags: [] };

function Explore() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState(searchParams.get("q") || "");
  const [data, setData] = useState(emptyData);
  const [pagination, setPagination] = useState({});
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);

  const params = {
    q: searchParams.get("q") || "",
    subject: searchParams.get("subject") || "",
    tag: searchParams.get("tag") || "",
    language: searchParams.get("language") || "",
    sort: searchParams.get("sort") || "newest",
  };
  const page = Number(searchParams.get("page") || 1);

  useEffect(() => {
    setQuery(params.q);
    setLoading(true);
    setStatus("");
    const requestParams = new URLSearchParams({ ...params, page: String(page), limit: "20" });
    fetch(`${API_URL}/explore?${requestParams}`)
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error("Explore is temporarily unavailable.");
        setData((current) => page === 1 ? result : {
          ...result,
          notes: [...current.notes, ...result.notes],
          code_spaces: [...current.code_spaces, ...result.code_spaces],
          users: [...current.users, ...result.users],
        });
        setPagination(result.pagination || {});
      })
      .catch(() => setStatus("Explore is temporarily unavailable. Please try again."))
      .finally(() => setLoading(false));
  }, [searchParams]);

  function updateParam(name, value) {
    const next = Object.fromEntries(searchParams.entries());
    if (value) next[name] = value;
    else delete next[name];
    delete next.page;
    setSearchParams(next);
  }

  function search(event) {
    event.preventDefault();
    updateParam("q", query.trim());
  }

  const hasMore = pagination.notes_has_more || pagination.code_spaces_has_more || pagination.users_has_more;

  return <main className="explore-page">
    <section className="explore-hero"><p className="eyebrow">Discover and learn</p><h1>Explore the community</h1><p className="dashboard-intro">Find public notes, code spaces, and learners sharing what they know.</p><form className="explore-search" onSubmit={search}><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search notes, subjects, tags, code, or usernames" aria-label="Search Explore" /><button className="button primary">Search</button></form></section>
    <div className="explore-filters">
      <select value={params.subject} onChange={(event) => updateParam("subject", event.target.value)}><option value="">All subjects</option>{data.subjects.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}</select>
      <select value={params.tag} onChange={(event) => updateParam("tag", event.target.value)}><option value="">All tags</option>{data.tags.map((tag) => <option key={tag}>{tag}</option>)}</select>
      <select value={params.language} onChange={(event) => updateParam("language", event.target.value)}><option value="">All languages</option>{data.languages.map((language) => <option key={language}>{language}</option>)}</select>
      <select value={params.sort} onChange={(event) => updateParam("sort", event.target.value)}><option value="newest">Newest</option><option value="updated">Recently updated</option><option value="oldest">Oldest</option><option value="alphabetical">Alphabetical</option></select>
    </div>
    {status && <p className="message error">{status}</p>}
    {params.q && <p className="explore-results">Results for “{params.q}”</p>}
    {loading && page === 1 ? <p className="explore-empty">Loading Explore...</p> : <>
      <ExploreSection title="Public notes"><div className="explore-grid">{data.notes.map((note) => { const content = plainTextFromContent(note.content); return <article className="explore-card panel" key={note.id}><div className="explore-author">{note.profile_picture ? <img src={note.profile_picture} alt="" /> : <span className="avatar">{(note.author_name || "U").slice(0, 1).toUpperCase()}</span>}<span>{note.author_name || "User"}</span></div><p className="explore-card-label">{note.subject || "Study note"}</p><h3>{note.title}</h3><p>{content.slice(0, 150)}{content.length > 150 ? "..." : ""}</p><div><span>{note.tags.slice(0, 3).map((tag) => `#${tag}`).join(" ")}</span><Link to={`/public/notes/${note.id}`}>View →</Link></div></article>; })}</div>{!data.notes.length && <Empty text="No public notes found." />}</ExploreSection>
      <ExploreSection title="Public Code Spaces"><div className="explore-grid">{data.code_spaces.map((space) => <article className="explore-card panel" key={space.id}><p className="explore-card-label">{space.language}</p><h3>{space.title}</h3><p>{space.description || "A public learning project."}</p><div><span>{space.author_name || "User"}</span><Link to={`/public/code/${space.id}`}>View →</Link></div></article>)}</div>{!data.code_spaces.length && <Empty text="No public Code Spaces found." />}</ExploreSection>
      <ExploreSection title="Users"><div className="user-list">{data.users.map((user) => <div className="explore-user" key={user.username}><Link className="explore-user-main" to={`/user/${user.username}`}>{user.profile_picture ? <img className="avatar" src={user.profile_picture} alt="" /> : <span className="avatar">{(user.name || "U").slice(0, 1).toUpperCase()}</span>}<span><strong>{user.name}</strong><small>@{user.username} · {user.bio || user.skills || "Learner"} · {user.followers_count} followers</small></span></Link><FollowButton userId={user.id} initialFollowing={user.is_following} onChange={(isFollowing) => setData((current) => ({ ...current, users: current.users.map((entry) => entry.id === user.id ? { ...entry, is_following: isFollowing, followers_count: entry.followers_count + (isFollowing ? 1 : -1) } : entry) }))} /></div>)}</div>{!data.users.length && <Empty text="No users found." />}</ExploreSection>
      {hasMore && <button className="button secondary" onClick={() => setSearchParams({ ...Object.fromEntries(searchParams.entries()), page: String(page + 1) })}>Load more</button>}
    </>}
  </main>;
}

function ExploreSection({ title, children }) { return <section className="explore-section"><div className="explore-section-heading"><h2>{title}</h2></div>{children}</section>; }
function Empty({ text }) { return <p className="explore-empty">{text}</p>; }

export default Explore;
