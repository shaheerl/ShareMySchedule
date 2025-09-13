import React, { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { apiPost } from "../api";

export default function Register() {
  const nav = useNavigate();
  const [firstName, setFirst] = useState("");
  const [lastName, setLast] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPass] = useState("");
  const [confirm, setConfirm] = useState("");
  const [msg, setMsg] = useState("");

  const onCreate = async (e) => {
    e.preventDefault();
    setMsg("");
    if (password !== confirm) {
      setMsg("Passwords do not match.");
      return;
    }
    try {
      const res = await apiPost("/auth/register", {
        firstName,
        lastName,
        email,
        password,
      });
      // show success + dev link (while email service not hooked up)
      setMsg(
        res.message +
          (res.devVerifyUrl ? `  Dev link: ${res.devVerifyUrl}` : "")
      );
      // Optional: navigate back to sign in
      // nav("/signin");
    } catch (err) {
      setMsg(err.message);
    }
  };

  return (
    <div style={styles.wrap}>
      <h2>Create Account</h2>
      <form onSubmit={onCreate} style={styles.form}>
        <label>First Name</label>
        <input value={firstName} onChange={(e) => setFirst(e.target.value)} />
        <label>Last Name</label>
        <input value={lastName} onChange={(e) => setLast(e.target.value)} />
        <label>Email (@my.yorku.ca)</label>
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="yourname@my.yorku.ca"
        />
        <label>Password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPass(e.target.value)}
        />
        <label>Verify Password</label>
        <input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
        <button type="submit">Create Account</button>
      </form>

      {msg && <p style={styles.msg}>{msg}</p>}
      <p style={{ marginTop: 8 }}>
        Already have an account? <Link to="/signin">Sign in</Link>
      </p>
    </div>
  );
}

const styles = {
  wrap: {
    maxWidth: 480,
    margin: "60px auto",
    padding: 20,
    border: "1px solid #ddd",
    borderRadius: 8,
  },
  form: { display: "flex", flexDirection: "column", gap: 8 },
  linkBtn: {
    marginTop: 10,
    background: "transparent",
    border: "1px solid #333",
    padding: "8px 12px",
    cursor: "pointer",
  },
  msg: { marginTop: 10, color: "#444" },
};
