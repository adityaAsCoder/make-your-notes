import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { getAuthenticatedUser } from "../auth";

const API_URL = "http://127.0.0.1:5000/api";

function Notifications() {
  const user = getAuthenticatedUser();
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [status, setStatus] = useState("");

  async function load() {
    try {
      const response = await fetch(`${API_URL}/notifications?limit=50`, { headers: { "X-User-Id": String(user?.id || "") } });
      const data = await response.json();
      if (!response.ok) throw new Error("Notifications are temporarily unavailable.");
      setItems(data.notifications);
    } catch (error) {
      setStatus(error.message);
    }
  }

  useEffect(() => { load(); }, []);

  async function markRead(id) {
    const response = await fetch(`${API_URL}/notifications/${id}/read`, { method: "PUT", headers: { "X-User-Id": String(user.id) } });
    if (response.ok) setItems(items.map((item) => item.id === id ? { ...item, is_read: 1 } : item));
  }

  async function markAllRead() {
    const response = await fetch(`${API_URL}/notifications/read-all`, { method: "PUT", headers: { "X-User-Id": String(user.id) } });
    if (response.ok) setItems(items.map((item) => ({ ...item, is_read: 1 })));
  }

  async function remove(id) {
    const response = await fetch(`${API_URL}/notifications/${id}`, { method: "DELETE", headers: { "X-User-Id": String(user.id) } });
    if (response.ok) setItems(items.filter((item) => item.id !== id));
  }

  function open(item) {
    markRead(item.id);
    if (item.related_type === "note") navigate(`/public/notes/${item.related_id}`);
    if (item.related_type === "code") navigate(`/public/code/${item.related_id}`);
  }

  return <section className="notifications-page"><div className="profile-heading"><div><p className="eyebrow">Stay informed</p><h1>Notifications</h1><p className="dashboard-intro">See activity from people engaging with your public learning content.</p></div><button className="button secondary" onClick={markAllRead}>Mark all as read</button></div>{status && <p className="message error">{status}</p>}<div className="panel notification-list">{items.length ? items.map((item) => <article className={`notification-row${item.is_read ? "" : " unread"}`} key={item.id}><button onClick={() => open(item)}><strong>{item.message}</strong><small>{item.actor_name || "User"} · {new Date(item.created_at).toLocaleString()}</small></button><div><button className="text-link" onClick={() => markRead(item.id)}>Read</button><button className="text-link danger-link" onClick={() => remove(item.id)}>Delete</button></div></article>) : <p className="explore-empty">No notifications yet.</p>}</div><Link className="text-link" to="/dashboard">Back to dashboard</Link></section>;
}

export default Notifications;
