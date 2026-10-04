import { Link, Navigate, Route, Routes, useLocation } from "react-router-dom";

import { getAuthenticatedUser } from "./auth";
import DashboardHome from "./pages/DashboardHome";
import DashboardLayout from "./pages/Dashboard";
import CodeSpace from "./pages/CodeSpace";
import Bookmarks from "./pages/Bookmarks";
import Notifications from "./pages/Notifications";
import Explore from "./pages/Explore";
import Home from "./pages/Home";
import Login from "./pages/Login";
import Placeholder from "./pages/Placeholder";
import Notes from "./pages/Notes";
import NotePage from "./pages/NotePage";
import Profile from "./pages/Profile";
import PublicProfile from "./pages/PublicProfile";
import PublicContent from "./pages/PublicContent";
import Register from "./pages/Register";
import FollowList from "./pages/FollowList";

function ProtectedDashboard() {
  return getAuthenticatedUser() ? <DashboardLayout /> : <Navigate to="/login" replace />;
}

function App() {
  useLocation();
  const isAuthenticated = Boolean(getAuthenticatedUser());

  return (
    <>
      {!isAuthenticated && (
        <header className="site-header">
          <Link className="brand" to="/">
            make<span>YourNotes</span>
          </Link>
          <nav>
            <Link to="/register">Register</Link>
            <Link className="nav-login" to="/login">Login</Link>
          </nav>
        </header>
      )}
      <main>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/explore" element={<Explore />} />
          <Route path="/user/:username" element={<PublicProfile />} />
          <Route path="/user/:username/followers" element={<FollowList type="followers" />} />
          <Route path="/user/:username/following" element={<FollowList type="following" />} />
          <Route path="/register" element={<Register />} />
          <Route path="/login" element={<Login />} />
          <Route path="/dashboard" element={<ProtectedDashboard />}>
            <Route index element={<DashboardHome />} />
            <Route path="profile" element={<Profile />} />
            <Route path="notes" element={<Notes />} />
            <Route path="code" element={<CodeSpace />} />
            <Route path="settings" element={<Placeholder title="Settings" />} />
          </Route>
          <Route path="/profile" element={<ProtectedDashboard />}>
            <Route index element={<Profile />} />
          </Route>
          <Route path="/bookmarks" element={<ProtectedDashboard />}>
            <Route index element={<Bookmarks />} />
          </Route>
          <Route path="/notifications" element={<ProtectedDashboard />}>
            <Route index element={<Notifications />} />
          </Route>
          <Route path="/notes" element={<ProtectedDashboard />}>
            <Route index element={<Notes />} />
            <Route path="create" element={<NotePage mode="create" />} />
            <Route path=":id" element={<NotePage />} />
            <Route path=":id/edit" element={<NotePage mode="edit" />} />
          </Route>
          <Route path="/code" element={<ProtectedDashboard />}>
            <Route index element={<CodeSpace />} />
            <Route path="create" element={<CodeSpace />} />
            <Route path=":id" element={<CodeSpace />} />
            <Route path=":id/edit" element={<CodeSpace />} />
          </Route>
          <Route path="/public/notes/:id" element={<PublicContent type="note" />} />
          <Route path="/public/note/:id" element={<PublicContent type="note" />} />
          <Route path="/public/code/:id" element={<PublicContent type="code" />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </>
  );
}

export default App;
