import React, { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { apiPost } from "../api";

export default function ResendVerification() {
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState("");

  const onResend = async (e) => {
    e.preventDefault();
    setMsg("");
    try {
      const res = await apiPost("/auth/resend-verification", { email });
      setMsg(res.message || "Verification email sent (if account exists).");
    } catch (err) {
      setMsg(err.message || "Error sending verification email");
    }
  };

  return (
    <div style={styles.wrap}>
      <h2>Resend Verification</h2>
      <form onSubmit={onResend} style={styles.form}>
        <label>Email used to register</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="yourname@my.yorku.ca"
        />
        <button type="submit">Send</button>
      </form>

      {msg && <p style={styles.msg}>{msg}</p>}

      <div style={{ marginTop: 12 }}>
        <Link to="/signin">Sign In</Link> |{" "}
        <Link to="/register">Create Account</Link>
      </div>
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
