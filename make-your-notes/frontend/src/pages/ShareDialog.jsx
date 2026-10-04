import { getAuthenticatedUser } from "../auth";

const API_URL = "http://127.0.0.1:5000/api";

function ShareDialog({ type, id, visibility, onClose, onMadePublic }) {
  const isPublic = visibility === "public";
  const publicUrl = `${window.location.origin}/public/${type === "note" ? "notes" : "code"}/${id}`;

  async function makePublic() {
    const user = getAuthenticatedUser();
    const response = await fetch(`${API_URL}/${type === "note" ? "notes" : "code"}/${id}/visibility`, {
      method: "PATCH",
      headers: { "X-User-Id": String(user?.id || "") },
    });
    const data = await response.json();
    if (!response.ok) {
      onClose(data.error || "Unable to make this item public.");
      return;
    }
    onMadePublic?.();
    onClose("This item is now public.");
  }

  async function copyLink() {
    await navigator.clipboard.writeText(publicUrl);
    onClose("Public link copied to your clipboard.");
  }

  return <div className="share-overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <div className="share-dialog" role="dialog" aria-modal="true" aria-labelledby="share-title">
      <button className="close-button" onClick={() => onClose()} aria-label="Close share dialog">×</button>
      <p className="eyebrow">Share {type}</p>
      <h2 id="share-title">{isPublic ? "Share this publicly" : "Make it public first"}</h2>
      <p>{isPublic ? "Anyone with this link can view this content." : "This item is currently private. Make it public to share it."}</p>
      {isPublic && <div className="share-link-row"><input readOnly value={publicUrl} aria-label="Public URL" /><button className="button primary" onClick={copyLink}>Copy link</button></div>}
      {!isPublic && <button className="button primary" onClick={makePublic}>Make public</button>}
      <button className="button secondary share-close-button" onClick={() => onClose()}>Close</button>
    </div>
  </div>;
}

export default ShareDialog;
