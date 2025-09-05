import React, { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { apiPost, apiGet } from "../api";

export default function SignIn() {
  const nav = useNavigate();
  const [username, setUsername] = useState(""); // email
  const [password, setPassword] = useState("");
  const [keepMe, setKeepMe] = useState(false);
  const [msg, setMsg] = useState("");

  const onSignIn = async (e) => {
    e.preventDefault();
    setMsg("");
    try {
      const { accessToken, refreshToken } = await apiPost("/auth/login", {
        username,
        password,
      });

      // Access token always in localStorage for simplicity
      localStorage.setItem("accessToken", accessToken);

      // Refresh token storage depends on checkbox
      if (keepMe) {
        localStorage.setItem("refreshToken", refreshToken);
      } else {
        sessionStorage.setItem("refreshToken", refreshToken);
      }

      // Optional: test call
      const me = await apiGet("/auth/me", accessToken);
      setMsg(`Welcome ${me.user?.name || ""}!`);
      nav("/home");
    } catch (err) {
      setMsg(err.message);
    }
  };

  return (
    <div style={styles.wrap}>
      <h2>Sign In</h2>
      <form onSubmit={onSignIn} style={styles.form}>
        <label>Username (Email)</label>
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="yourname@my.yorku.ca"
        />
        <label>Password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        <label style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <input
            type="checkbox"
            checked={keepMe}
            onChange={(e) => setKeepMe(e.target.checked)}
          />
          Keep me signed in
        </label>

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
  wrap: {
    maxWidth: 420,
    margin: "60px auto",
    padding: 20,
    border: "1px solid #ddd",
    borderRadius: 8,
  },
  form: { display: "flex", flexDirection: "column", gap: 8 },
  msg: { marginTop: 10, color: "#444" },
};
