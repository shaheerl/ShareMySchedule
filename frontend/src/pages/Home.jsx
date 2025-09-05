import React, { useEffect, useState } from "react";
import { apiGet } from "../api";

export default function Home() {
  const [user, setUser] = useState(null);
  const token = localStorage.getItem("accessToken");

  useEffect(() => {
    if (token) {
      apiGet("/auth/me", token).then((res) => setUser(res.user)).catch(() => {});
    }
  }, [token]);

  return (
    <div>
      <h2>Welcome {user ? user.name : "..."}</h2>
      <p>This is your homepage.</p>
    </div>
  );
}
