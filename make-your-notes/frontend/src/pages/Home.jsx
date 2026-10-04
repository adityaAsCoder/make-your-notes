import { Link } from "react-router-dom";

function Home() {
  return (
    <section className="hero page-width">
      <div className="hero-copy">
        <p className="eyebrow">A simple place to begin</p>
        <h1>Your account, <em>your way.</em></h1>
        <p className="intro">
          Create an account and sign in securely. This small learning project
          connects a React frontend to a Flask API and MySQL database.
        </p>
        <div className="actions">
          <Link className="button primary" to="/register">Create an account</Link>
          <Link className="button secondary" to="/login">Log in</Link>
        </div>
      </div>
      <div className="hero-card">
        <div className="orb" />
        <p>Simple. Secure. Yours.</p>
        <span>Your password is hashed before it reaches the database.</span>
      </div>
    </section>
  );
}

export default Home;
