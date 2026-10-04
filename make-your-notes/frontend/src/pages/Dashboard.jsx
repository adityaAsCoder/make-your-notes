import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";

import { clearAuthenticatedUser, getAuthenticatedUser } from "../auth";

const navItems = [
  { label: "Dashboard", path: "/dashboard", icon: "grid" },
  { label: "My Notes", path: "/dashboard/notes", icon: "note" },
  { label: "Code Space", path: "/dashboard/code", icon: "code" },
  { label: "Explore", path: "/explore", icon: "explore" },
  { label: "Bookmarks", path: "/bookmarks", icon: "bookmark" },
  { label: "Profile", path: "/profile", icon: "user" },
  { label: "Settings", path: "/dashboard/settings", icon: "settings" },
];

function Icon({ name }) {
  const paths = {
    grid: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
    note: "M6 3h9l3 3v15H6zM15 3v4h4M9 12h6M9 16h6",
    code: "m8 8-4 4 4 4m8-8 4 4-4 4m-3-13-2 18",
    explore: "M11 19a8 8 0 1 1 5.7-2.3L21 21m-10-5a5 5 0 1 0 0-10 5 5 0 0 0 0 10",
    bookmark: "M6 4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18l-6-4-6 4z",
    user: "M20 21a8 8 0 0 0-16 0M12 13a4 4 0 1 0 0-8 4 4 0 0 0 0 8",
    settings: "M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zm8-3.5 2 1.2-2 3.4-2.2-.7a8 8 0 0 1-1.7 1l-.3 2.3h-4l-.3-2.3a8 8 0 0 1-1.7-1l-2.2.7-2-3.4L5.6 12 5 10l-1.4-1.6 2-3.4 2.2.7a8 8 0 0 1 1.7-1L9.8 2h4l.3 2.3a8 8 0 0 1 1.7 1l2.2-.7 2 3.4L18.6 10z",
  };

  return <svg className="nav-icon" viewBox="0 0 24 24" aria-hidden="true"><path d={paths[name]} /></svg>;
}

function DashboardLayout() {
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const user = getAuthenticatedUser() || {};
  const initials = (user.name || "User").slice(0, 1).toUpperCase();

  function handleLogout() {
    clearAuthenticatedUser();
    navigate("/login", { replace: true });
  }

  async function loadNotifications() {
    const headers = { "X-User-Id": String(user.id || "") };
    const [listResponse, countResponse] = await Promise.all([
      fetch("http://127.0.0.1:5000/api/notifications?limit=5", { headers }),
      fetch("http://127.0.0.1:5000/api/notifications/unread-count", { headers }),
    ]);
    if (listResponse.ok) setNotifications((await listResponse.json()).notifications);
    if (countResponse.ok) setUnreadCount((await countResponse.json()).count);
  }

  useEffect(() => { loadNotifications().catch(() => {}); }, [user.id]);

  async function markNotificationRead(id) {
    const response = await fetch(`http://127.0.0.1:5000/api/notifications/${id}/read`, { method: "PUT", headers: { "X-User-Id": String(user.id) } });
    if (response.ok) {
      setNotifications(notifications.map((item) => item.id === id ? { ...item, is_read: 1 } : item));
      setUnreadCount(Math.max(0, unreadCount - 1));
    }
  }

  return (
    <div className="dashboard-shell">
      <aside className="dashboard-sidebar">
        <Link className="dashboard-brand" to="/dashboard">
          <span className="brand-mark">M</span>
          <span>make<span>YourNotes</span></span>
        </Link>
        <p className="sidebar-label">Workspace</p>
        <nav className="sidebar-nav" aria-label="Dashboard navigation">
          {navItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === "/dashboard"}
              className={({ isActive }) => `sidebar-link${isActive ? " active" : ""}`}
            >
              <Icon name={item.icon} />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          <p>Keep learning, one idea at a time.</p>
        </div>
      </aside>

      <div className="dashboard-main">
        <header className="dashboard-navbar">
          <div className="mobile-brand"><span className="brand-mark">M</span> makeYourNotes</div>
          <label className="dashboard-search">
            <span aria-hidden="true">⌕</span>
            <input type="search" placeholder="Search your workspace" aria-label="Search your workspace" />
            <kbd>⌘ K</kbd>
          </label>
          <div className="navbar-actions">
            <div className="notification-menu"><button className="icon-button notification-button" aria-label="Notifications" onClick={() => setNotificationOpen(!notificationOpen)}><span>♢</span>{unreadCount > 0 && <b>{unreadCount}</b>}</button>{notificationOpen && <div className="notification-dropdown"><div className="notification-dropdown-heading"><strong>Notifications</strong><Link to="/notifications" onClick={() => setNotificationOpen(false)}>View all</Link></div>{notifications.length ? notifications.map((item) => <button className={`notification-item${item.is_read ? "" : " unread"}`} key={item.id} onClick={() => markNotificationRead(item.id)}><strong>{item.message}</strong><small>{new Date(item.created_at).toLocaleString()}</small></button>) : <p className="explore-empty">No notifications yet.</p>}</div>}</div>
            <div className="profile-menu">
              <button className="profile-trigger" onClick={() => setMenuOpen(!menuOpen)} aria-expanded={menuOpen}>
                {user.profile_picture ? <img className="avatar" src={user.profile_picture} alt="" /> : <span className="avatar">{initials}</span>}
                <span className="profile-trigger-name">{user.name || "Student"}</span>
                <span className="chevron">⌄</span>
              </button>
              {menuOpen && <div className="profile-dropdown">
                <Link to="/profile" onClick={() => setMenuOpen(false)}>View profile</Link>
                <button onClick={handleLogout}>Log out</button>
              </div>}
            </div>
            <button className="logout-button" onClick={handleLogout}>Log out</button>
          </div>
        </header>
        <main className="dashboard-content"><Outlet /></main>
      </div>
    </div>
  );
}

export default DashboardLayout;
