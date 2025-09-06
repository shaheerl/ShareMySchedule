import React, { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { apiPost, apiGet } from "../api";

export default function SignIn() {
  const nav = useNavigate();
  const [username, setUsername] = useState(""); // email
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState("");

  const onSignIn = async (e) => {
    e.preventDefault();
    setMsg("");
    try {
      const { accessToken, refreshToken } = await apiPost("/auth/login", { username, password });
      // store tokens (basic localStorage for now)
      localStorage.setItem("accessToken", accessToken);
      localStorage.setItem("refreshToken", refreshToken);

      // quick test call (optional)
      const me = await apiGet("/auth/me", accessToken);
      setMsg(`Welcome ${me.user?.name || ""}!`);
        nav("/home");
      // nav("/dashboard"); // when you have it
    } catch (err) {
      setMsg(err.message);
    }
  };

  return (
    <div style={styles.wrap}>
      <h2>Sign In</h2>
      <form onSubmit={onSignIn} style={styles.form}>
        <label>Username</label>
        <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="yourname@my.yorku.ca" />
        <label>Password</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <button type="submit">Sign In</button>
      </form>

      {msg && <p style={styles.msg}>{msg}</p>}
      <p style={{ marginTop: 8 }}>
        Don’t have an account? <Link to="/register">Create one</Link>
      </p>
    </div>
  );
}

const styles = {
  wrap: { maxWidth: 420, margin: "60px auto", padding: 20, border: "1px solid #ddd", borderRadius: 8 },
  form: { display: "flex", flexDirection: "column", gap: 8 },
  linkBtn: { marginTop: 10, background: "transparent", border: "1px solid #333", padding: "8px 12px", cursor: "pointer" },
  msg: { marginTop: 10, color: "#444" },
};
