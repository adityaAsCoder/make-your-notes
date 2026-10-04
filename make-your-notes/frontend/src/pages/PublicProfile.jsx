import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { getAuthenticatedUser } from "../auth";
import FollowButton from "./FollowButton";
import { plainTextFromContent } from "../noteContent";

const API_URL = "http://127.0.0.1:5000/api";

function PublicProfile() {
  const { username } = useParams();
  const [searchParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`${API_URL}/public/users/${encodeURIComponent(username)}`)
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Profile not found.");
        setData(result);
      })
      .catch((requestError) => setError(requestError.message));
  }, [username]);

  if (error) return <main className="public-page"><div className="public-error panel"><h1>Profile unavailable</h1><p>{error}</p><Link className="button primary" to="/explore">Back to Explore</Link></div></main>;
  if (!data) return <main className="public-page"><p className="eyebrow">Public profile</p><h1>Loading...</h1></main>;
  const user = data.user;
  const skills = (user.skills || "").split(",").map((skill) => skill.trim()).filter(Boolean);
  const currentUser = getAuthenticatedUser();
  const tab = searchParams.get("tab") || "overview";
  function updateFollow(isFollowing) {
    setData((current) => ({ ...current, user: { ...current.user, is_following: isFollowing, followers_count: current.user.followers_count + (isFollowing ? 1 : -1) } }));
  }

  const tabs = [["overview", "Overview"], ["notes", "Notes"], ["code", "Code"], ["followers", "Followers"], ["following", "Following"]];
  const content = tab === "notes" ? <ExplorePublicItems title="Public notes" items={data.notes} type="note" /> : tab === "code" ? <ExplorePublicItems title="Public Code Spaces" items={data.code_spaces} type="code" /> : tab === "followers" ? <Link className="button secondary" to={`/user/${user.username}/followers`}>View followers</Link> : tab === "following" ? <Link className="button secondary" to={`/user/${user.username}/following`}>View following</Link> : <><ExplorePublicItems title="Public notes" items={data.notes.slice(0, 3)} type="note" /><ExplorePublicItems title="Public Code Spaces" items={data.code_spaces.slice(0, 3)} type="code" /></>;
  return <main className="public-page"><div className="public-brand"><Link className="brand" to="/">make<span>YourNotes</span></Link><Link to="/explore">Explore</Link></div><section className="public-profile-header">{user.profile_picture ? <img className="profile-large-avatar" src={user.profile_picture} alt={`${user.name} profile`} /> : <span className="profile-large-avatar">{(user.name || "U").slice(0, 1).toUpperCase()}</span>}<div><p className="eyebrow">Public profile</p><h1>{user.name}</h1><p className="profile-username">@{user.username}</p><p>{user.bio || "Learning and sharing on makeYourNotes."}</p><div className="profile-follow-stats"><Link to={`/user/${user.username}/followers`}><strong>{user.followers_count}</strong> followers</Link><Link to={`/user/${user.username}/following`}><strong>{user.following_count}</strong> following</Link><span><strong>{user.public_notes_count}</strong> notes</span><span><strong>{user.public_code_count}</strong> code</span><span><strong>{user.likes_received}</strong> likes</span>{Number(currentUser?.id) === Number(user.id) ? <Link className="button secondary" to="/profile">Edit profile</Link> : <FollowButton userId={user.id} initialFollowing={user.is_following} onChange={updateFollow} />}</div></div></section><nav className="profile-tabs">{tabs.map(([key, label]) => <Link className={tab === key ? "active" : ""} key={key} to={`/user/${user.username}${key === "overview" ? "" : `?tab=${key}`}`}>{label}</Link>)}</nav><div className="public-profile-info"><div><span>College / University</span><strong>{user.college || "Not specified"}</strong></div><div><span>Course</span><strong>{user.course || "Not specified"}</strong></div><div><span>Skills</span><strong>{skills.length ? skills.join(" · ") : "Not specified"}</strong></div><div><span>Social links</span><strong className="public-social-links">{user.github ? <a href={user.github} target="_blank" rel="noreferrer">GitHub</a> : null}{user.linkedin ? <a href={user.linkedin} target="_blank" rel="noreferrer">LinkedIn</a> : null}{!user.github && !user.linkedin && "Not specified"}</strong></div></div><div className="public-profile-content">{content}</div></main>;
}

function ExplorePublicItems({ title, items, type }) {
  return <section className="explore-section"><h2>{title}</h2><div className="explore-grid">{items.map((item) => <article className="explore-card panel" key={item.id}><p className="explore-card-label">{type === "note" ? item.subject || "Study note" : item.language}</p><h3>{item.title}</h3><p>{type === "note" ? plainTextFromContent(item.content) : (item.description || item.code)}</p><small className="public-card-meta">{new Date(item.updated_at || item.created_at).toLocaleDateString()} · ♥ {item.likes || 0} · 🔖 {item.bookmarks || 0}{type === "note" ? ` · ${item.comments || 0} comments` : ""}</small><Link to={`/public/${type}/${item.id}`}>View public {type} →</Link></article>)}</div>{!items.length && <Empty text="No public content yet." />}</section>;
}

function Empty({ text }) { return <p className="explore-empty">{text}</p>; }

export default PublicProfile;
