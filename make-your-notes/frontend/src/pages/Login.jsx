import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { saveAuthenticatedUser } from "../auth";

const API_URL = "http://127.0.0.1:5000/api";

function Login() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: "", password: "" });
  const [message, setMessage] = useState({ type: "", text: "" });
  const [loading, setLoading] = useState(false);

  function updateField(event) {
    setForm({ ...form, [event.target.name]: event.target.value });
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setMessage({ type: "", text: "" });
    if (!form.email.trim() || !form.password) {
      setMessage({ type: "error", text: "Please enter your email and password." });
      return;
    }
    setLoading(true);
    try {
      const response = await fetch(`${API_URL}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Login failed.");
      saveAuthenticatedUser(data.user);
      navigate("/dashboard", { replace: true });
    } catch (error) {
      setMessage({ type: "error", text: error.message.includes("fetch") ? "The backend is unavailable." : error.message });
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="form-page">
      <div className="form-card">
        <p className="eyebrow">Welcome back</p>
        <h1>Log in to your account</h1>
        <p className="form-subtitle">Enter your details below.</p>
        <form onSubmit={handleSubmit}>
          <label>Email<input type="email" name="email" value={form.email} onChange={updateField} placeholder="you@example.com" /></label>
          <label>Password<input type="password" name="password" value={form.password} onChange={updateField} placeholder="Your password" /></label>
          {message.text && <p className={`message ${message.type}`}>{message.text}</p>}
          <button className="button primary full-width" disabled={loading}>{loading ? "Logging in..." : "Login"}</button>
        </form>
        <p className="form-footer">Need an account? <Link to="/register">Register here</Link></p>
      </div>
    </section>
  );
}

export default Login;
