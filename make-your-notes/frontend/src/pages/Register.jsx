import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

const API_URL = "http://127.0.0.1:5000/api";

function Register() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: "", email: "", password: "", confirmPassword: "" });
  const [message, setMessage] = useState({ type: "", text: "" });
  const [loading, setLoading] = useState(false);

  function updateField(event) {
    setForm({ ...form, [event.target.name]: event.target.value });
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setMessage({ type: "", text: "" });
    if (Object.values(form).some((value) => !value.trim())) {
      setMessage({ type: "error", text: "Please fill in every field." });
      return;
    }
    if (form.password !== form.confirmPassword) {
      setMessage({ type: "error", text: "Passwords do not match." });
      return;
    }
    setLoading(true);
    try {
      const response = await fetch(`${API_URL}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: form.name, email: form.email, password: form.password }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Registration failed.");
      setMessage({ type: "success", text: data.message });
      setForm({ name: "", email: "", password: "", confirmPassword: "" });
    } catch (error) {
      setMessage({ type: "error", text: error.message.includes("fetch") ? "The backend is unavailable." : error.message });
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="form-page">
      <div className="form-card">
        <p className="eyebrow">Get started</p>
        <h1>Create your account</h1>
        <p className="form-subtitle">It only takes a minute.</p>
        <form onSubmit={handleSubmit}>
          <label>Name<input name="name" value={form.name} onChange={updateField} placeholder="Your name" /></label>
          <label>Email<input type="email" name="email" value={form.email} onChange={updateField} placeholder="you@example.com" /></label>
          <label>Password<input type="password" name="password" value={form.password} onChange={updateField} placeholder="At least 6 characters" /></label>
          <label>Confirm password<input type="password" name="confirmPassword" value={form.confirmPassword} onChange={updateField} placeholder="Repeat your password" /></label>
          {message.text && <p className={`message ${message.type}`}>{message.text}</p>}
          <button className="button primary full-width" disabled={loading}>{loading ? "Creating account..." : "Register"}</button>
        </form>
        <p className="form-footer">Already registered? <Link to="/login">Log in</Link>{message.type === "success" && <> or <button className="text-button" onClick={() => navigate("/login")}>continue to login</button></>}</p>
      </div>
    </section>
  );
}

export default Register;
