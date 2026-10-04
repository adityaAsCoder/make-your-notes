import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getAuthenticatedUser } from "../auth";
import FollowButton from "./FollowButton";

const API_URL = "http://127.0.0.1:5000/api";

function FollowList({ type }) {
  const { username } = useParams();
  const [users, setUsers] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    fetch(`${API_URL}/public/users/${encodeURIComponent(username)}`)
      .then(async (response) => {
        const profile = await response.json();
        if (!response.ok) throw new Error(profile.error || "Profile not found.");
        const endpoint = type === "followers" ? profile.user.id : profile.user.id;
        const list = await fetch(`${API_URL}/users/${endpoint}/${type}`, { headers: { "X-User-Id": String(getAuthenticatedUser()?.id || "") } });
        const result = await list.json();
        if (!list.ok) throw new Error(result.error || "Follow list unavailable.");
        setUsers(result.users);
      })
      .catch((requestError) => setError(requestError.message));
  }, [username, type]);
  if (error) return <main className="public-page"><div className="public-error panel"><h1>Unable to load list</h1><p>{error}</p><Link to={`/user/${username}`}>Back to profile</Link></div></main>;
  if (!users) return <main className="public-page"><p className="eyebrow">Community</p><h1>Loading...</h1></main>;
  return <main className="public-page follow-list-page"><div className="public-brand"><Link className="brand" to="/">make<span>YourNotes</span></Link><Link to={`/user/${username}`}>Back to profile</Link></div><p className="eyebrow">Community</p><h1>{type === "followers" ? "Followers" : "Following"}</h1><div className="follow-user-list">{users.map((user) => <article className="follow-user-card panel" key={user.id}><Link className="follow-user-main" to={`/user/${user.username}`}>{user.profile_picture ? <img className="avatar" src={user.profile_picture} alt="" /> : <span className="avatar">{(user.name || "U").slice(0, 1).toUpperCase()}</span>}<span><strong>{user.name || user.username}</strong><small>@{user.username}</small><em>{user.bio || "Learner"} · {user.followers_count} followers</em></span></Link><FollowButton userId={user.id} initialFollowing={user.is_following} /></article>)}</div>{!users.length && <p className="explore-empty">No users found.</p>}</main>;
}
export default FollowList;
