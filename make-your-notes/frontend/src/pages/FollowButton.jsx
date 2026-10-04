import { useState } from "react";
import { getAuthenticatedUser } from "../auth";

const API_URL = "http://127.0.0.1:5000/api";

export default function FollowButton({ userId, initialFollowing = false, onChange }) {
  const currentUser = getAuthenticatedUser();
  const [following, setFollowing] = useState(initialFollowing);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  if (!currentUser || Number(currentUser.id) === Number(userId)) return null;

  async function toggle(event) {
    event.preventDefault();
    event.stopPropagation();
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`${API_URL}/users/${userId}/follow`, {
        method: following ? "DELETE" : "POST",
        headers: { "X-User-Id": String(currentUser.id) },
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to update follow status.");
      const next = !following;
      setFollowing(next);
      onChange?.(next);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }

  return <span className="follow-control"><button className={`button ${following ? "secondary" : "primary"} follow-button`} onClick={toggle} disabled={loading}>{loading ? "Saving..." : following ? "Following" : "Follow"}</button>{error && <small className="follow-error">{error}</small>}</span>;
}
