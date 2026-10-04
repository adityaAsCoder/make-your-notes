import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getAuthenticatedUser } from "../auth";

const API_URL = "http://127.0.0.1:5000/api";
const initial = { stats: {}, recent_notes: [], recent_code_spaces: [], recent_activity: [] };

function DashboardHome() {
  const user = getAuthenticatedUser() || {};
  const [data, setData] = useState(initial);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    fetch(`${API_URL}/dashboard`, { headers: { "X-User-Id": String(user.id || "") } })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Dashboard is unavailable.");
        setData(result);
      })
      .catch((requestError) => setError(requestError.message))
      .finally(() => setLoading(false));
  }, [user.id]);
  const firstName = (user.name || "there").split(" ")[0];
  if (loading) return <section className="dashboard-home"><p className="eyebrow">Your learning workspace</p><h1>Loading dashboard...</h1></section>;
  if (error) return <section className="dashboard-home"><p className="message error">{error}</p><button className="button secondary" onClick={() => window.location.reload()}>Retry</button></section>;
  const stats = data.stats;
  return <div className="dashboard-home">
    <section className="welcome-section"><div><p className="eyebrow">Your learning workspace</p><h1>Good to see you, {firstName}.</h1><p className="dashboard-intro">Capture what you learn, build on your ideas, and keep your progress moving forward.</p></div><div className="welcome-decoration"><span>✦</span><span>✧</span><span>•</span></div></section>
    <section className="stats-grid dashboard-stats" aria-label="Workspace statistics">{[["My notes", stats.notes, "mint"], ["Code spaces", stats.code_spaces, "lavender"], ["Followers", stats.followers, "blue"], ["Following", stats.following, "peach"], ["Likes received", stats.likes_received, "gold"], ["Bookmarks", stats.bookmarks, "mint"]].map(([label, value, color]) => <div className="stat-card" key={label}><span className={`stat-icon ${color}`}>✦</span><div><p>{label}</p><strong>{value || 0}</strong></div></div>)}</section>
    <div className="dashboard-columns dashboard-content-columns">
      <section className="panel recent-panel"><PanelHeading title="Recent notes" link="/notes" label="View all notes" />{data.recent_notes.length ? data.recent_notes.map((note) => <div className="recent-row" key={note.id}><Link to={`/notes/${note.id}`}><strong>{note.title}</strong><small>{note.subject || "Study note"} · {note.visibility}</small></Link><Link className="text-link" to={`/notes/${note.id}/edit`}>Edit</Link></div>) : <Empty text="You haven't created any notes yet." link="/notes/create" label="Create your first note" />}</section>
      <section className="panel recent-panel"><PanelHeading title="Recent Code Spaces" link="/code" label="View all code" />{data.recent_code_spaces.length ? data.recent_code_spaces.map((item) => <div className="recent-row" key={item.id}><Link to={`/code/${item.id}`}><strong>{item.title}</strong><small>{item.language} · {item.visibility}</small></Link><Link className="text-link" to={`/code/${item.id}/edit`}>Edit</Link></div>) : <Empty text="You haven't created any Code Spaces yet." link="/code/create" label="Create Code Space" />}</section>
    </div>
    <div className="dashboard-columns"><section className="panel activity-panel"><PanelHeading title="Recent activity" link="/dashboard" label="View all activity" />{data.recent_activity.length ? <div className="activity-list">{data.recent_activity.map((entry) => <div className="activity-item" key={entry.id}><span>•</span><p>{entry.description}<strong>{entry.related_type && entry.related_id && <Link to={entry.related_type === "note" ? `/public/notes/${entry.related_id}` : entry.related_type === "code" ? `/public/code/${entry.related_id}` : `/user/${entry.related_id}`}>View content</Link>}</strong></p><time>{new Date(entry.created_at).toLocaleDateString()}</time></div>)}</div> : <Empty text="No recent activity." />}</section><section className="panel quick-panel"><div className="panel-heading"><div><p className="panel-kicker">Get started</p><h2>Quick actions</h2></div></div><Link className="quick-action primary-action" to="/notes/create"><span>＋</span><div><strong>Create a note</strong><small>Write down a new idea</small></div><b>→</b></Link><Link className="quick-action" to="/code/create"><span>&lt;/&gt;</span><div><strong>Create Code Space</strong><small>Explore and build</small></div><b>→</b></Link><Link className="quick-action" to="/explore"><span>⌕</span><div><strong>Explore</strong><small>Discover public work</small></div><b>→</b></Link><Link className="quick-action" to="/profile"><span>◉</span><div><strong>View your profile</strong><small>Manage your account</small></div><b>→</b></Link></section></div>
  </div>;
}
function PanelHeading({ title, link, label }) { return <div className="panel-heading"><h2>{title}</h2><Link className="text-link" to={link}>{label}</Link></div>; }
function Empty({ text, link, label }) { return <div className="empty-state"><h3>{text}</h3>{link && <Link className="button secondary" to={link}>{label}</Link>}</div>; }
export default DashboardHome;
