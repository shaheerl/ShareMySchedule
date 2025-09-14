import React from "react";
import { useNavigate } from "react-router-dom";

export default function Verified() {
  const nav = useNavigate();

  return (
    <div style={{ maxWidth: 500, margin: "40px auto", textAlign: "center" }}>
      <h2>🎉 Email Verified</h2>
      <p>Your email has been successfully verified. You can now sign in.</p>
      <button onClick={() => nav("/signin")} style={{ marginTop: 20 }}>
        Go to Sign In
      </button>
    </div>
  );
}
