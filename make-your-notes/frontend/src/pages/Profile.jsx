import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { getAuthenticatedUser, saveAuthenticatedUser } from "../auth";

const API_URL = "http://127.0.0.1:5000/api";
const emptyProfile = { name: "", username: "", email: "", bio: "", college: "", course: "", skills: "", github: "", linkedin: "", profile_picture: "" };

function Profile() {
  const navigate = useNavigate();
  const [profile, setProfile] = useState({ ...emptyProfile, ...(getAuthenticatedUser() || {}) });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(profile);
  const [pictureFile, setPictureFile] = useState(null);
  const [picturePreview, setPicturePreview] = useState("");
  const [status, setStatus] = useState({ type: "", text: "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const user = getAuthenticatedUser();

  useEffect(() => {
    if (!pictureFile) {
      setPicturePreview("");
      return undefined;
    }
    const previewUrl = URL.createObjectURL(pictureFile);
    setPicturePreview(previewUrl);
    return () => URL.revokeObjectURL(previewUrl);
  }, [pictureFile]);

  useEffect(() => {
    if (!user?.id) {
      navigate("/login", { replace: true });
      return;
    }
    fetch(`${API_URL}/profile`, { headers: { "X-User-Id": String(user.id) } })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Unable to load profile.");
        setProfile(data.profile);
        setDraft(data.profile);
      })
      .catch((error) => setStatus({ type: "error", text: error.message }))
      .finally(() => setLoading(false));
  }, [navigate, user?.id]);

  function updateField(event) {
    setDraft({ ...draft, [event.target.name]: event.target.value });
  }

  function selectPicture(event) {
    const file = event.target.files?.[0];
    if (file && !["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setStatus({ type: "error", text: "Choose a JPEG, PNG, or WebP image." });
      event.target.value = "";
      return;
    }
    if (file && file.size > 5 * 1024 * 1024) {
      setStatus({ type: "error", text: "Profile images must be 5 MB or smaller." });
      event.target.value = "";
      return;
    }
    setPictureFile(file || null);
    setStatus({ type: "", text: "" });
  }

  async function saveProfile(event) {
    event.preventDefault();
    setStatus({ type: "", text: "" });
    setSaving(true);
    try {
      let body;
      const headers = { "X-User-Id": String(user.id) };
      if (pictureFile) {
        body = new FormData();
        Object.entries(draft).forEach(([field, value]) => body.append(field, value));
        body.append("profile_picture_file", pictureFile);
      } else {
        headers["Content-Type"] = "application/json";
        body = JSON.stringify(draft);
      }
      const response = await fetch(`${API_URL}/profile`, {
        method: "PUT",
        headers,
        body,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to save profile.");
      setProfile(data.profile);
      setDraft(data.profile);
      setPictureFile(null);
      saveAuthenticatedUser({ ...user, name: data.profile.name, profile_picture: data.profile.profile_picture });
      setEditing(false);
      setStatus({ type: "success", text: data.message });
    } catch (error) {
      setStatus({ type: "error", text: error.message.includes("fetch") ? "The backend is unavailable." : error.message });
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <section className="simple-page"><p className="eyebrow">Personal space</p><h1>Loading profile...</h1></section>;

  return (
    <section className="profile-page">
      <div className="profile-heading">
        <div><p className="eyebrow">Personal space</p><h1>Your profile</h1><p className="dashboard-intro">Introduce yourself and keep your learning profile up to date.</p></div>
        {!editing && <button className="button primary" onClick={() => { setDraft(profile); setEditing(true); }}>Edit profile</button>}
      </div>
      {status.text && <p className={`message ${status.type}`}>{status.text}</p>}
      {!editing ? <ProfileView profile={profile} /> : <ProfileForm draft={draft} updateField={updateField} selectPicture={selectPicture} picturePreview={picturePreview} saving={saving} saveProfile={saveProfile} cancel={() => { setDraft(profile); setPictureFile(null); setEditing(false); }} />}
    </section>
  );
}

function ProfileView({ profile }) {
  const skills = profile.skills ? profile.skills.split(",").map((skill) => skill.trim()).filter(Boolean) : [];
  return <div className="profile-view">
    <section className="profile-hero-card">
      {profile.profile_picture ? <img className="profile-large-avatar" src={profile.profile_picture} alt={`${profile.name} profile`} /> : <span className="profile-large-avatar">{(profile.name || "U").slice(0, 1).toUpperCase()}</span>}
      <div><h2>{profile.name || "Student"}</h2><p className="profile-username">@{profile.username || "student"}</p><p>{profile.bio || "Add a short bio to tell people about yourself."}</p></div>
    </section>
    <div className="profile-sections">
      <section className="profile-info-card"><p className="panel-kicker">About</p><h3>Contact</h3><dl><dt>Email</dt><dd>{profile.email}</dd><dt>College / University</dt><dd>{profile.college || "Not added yet"}</dd></dl></section>
      <section className="profile-info-card"><p className="panel-kicker">Education</p><h3>Course</h3><p>{profile.course || "Not added yet"}</p><p className="panel-kicker profile-sub-kicker">Skills</p><div className="skill-list">{skills.length ? skills.map((skill) => <span key={skill}>{skill}</span>) : <p>Not added yet</p>}</div></section>
      <section className="profile-info-card social-card"><p className="panel-kicker">Social links</p><h3>Find me online</h3><div><a href={profile.github || "#"} target="_blank" rel="noreferrer" className={!profile.github ? "disabled-link" : ""}>GitHub <span>↗</span></a><a href={profile.linkedin || "#"} target="_blank" rel="noreferrer" className={!profile.linkedin ? "disabled-link" : ""}>LinkedIn <span>↗</span></a></div></section>
    </div>
  </div>;
}

function ProfileForm({ draft, updateField, selectPicture, picturePreview, saving, saveProfile, cancel }) {
  return <form className="profile-form" onSubmit={saveProfile}>
    <div className="profile-form-grid">
      <div className="profile-picture-upload">
        {picturePreview || draft.profile_picture ? <img className="profile-large-avatar" src={picturePreview || draft.profile_picture} alt="Profile preview" /> : <span className="profile-large-avatar">{(draft.name || "U").slice(0, 1).toUpperCase()}</span>}
        <label>Profile picture<input type="file" accept="image/jpeg,image/png,image/webp" onChange={selectPicture} /><span className="field-note">JPEG, PNG, or WebP · up to 5 MB</span></label>
      </div>
      <label>Full name<input name="name" value={draft.name} onChange={updateField} required maxLength="100" /></label>
      <label>Username<input name="username" value={draft.username} onChange={updateField} required maxLength="50" placeholder="your_username" /></label>
      <label>Email <span className="field-note">Email cannot be changed here</span><input value={draft.email} readOnly /></label>
      <label className="wide-field">Bio<textarea name="bio" value={draft.bio} onChange={updateField} rows="4" maxLength="500" placeholder="Tell us a little about yourself" /></label>
      <label>College / University<input name="college" value={draft.college} onChange={updateField} maxLength="500" /></label>
      <label>Course<input name="course" value={draft.course} onChange={updateField} maxLength="500" /></label>
      <label className="wide-field">Skills <span className="field-note">Separate skills with commas</span><input name="skills" value={draft.skills} onChange={updateField} maxLength="500" placeholder="Python, React, SQL" /></label>
      <label>GitHub profile<input name="github" value={draft.github} onChange={updateField} placeholder="https://github.com/username" /></label>
      <label>LinkedIn profile<input name="linkedin" value={draft.linkedin} onChange={updateField} placeholder="https://linkedin.com/in/username" /></label>
    </div>
    <div className="profile-form-actions"><button type="button" className="button secondary" onClick={cancel}>Cancel</button><button className="button primary" disabled={saving}>{saving ? "Saving..." : "Save changes"}</button></div>
  </form>;
}

export default Profile;
