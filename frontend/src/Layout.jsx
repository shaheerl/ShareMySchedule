import React from "react";
import { Outlet, useNavigate } from "react-router-dom";

export default function Layout() {
  const nav = useNavigate();

  const signOut = () => {
    localStorage.removeItem("accessToken");
    localStorage.removeItem("refreshToken");
    nav("/signin");
  };

  return (
    <div style={styles.container}>
      {/* Sidebar */}
      <div style={styles.sidebar}>
        <h3>Menu</h3>
        <ul style={styles.menu}>
          <li onClick={() => nav("/home")}>Home</li>
          <li onClick={() => nav("/my-schedule")}>My Schedule</li>
          <li onClick={() => nav("/find-friends")}>Find Friends</li>
          <li onClick={() => nav("/account-settings")}>Account Settings</li>
        </ul>
      </div>

      {/* Main area */}
      <div style={styles.main}>
        <div style={styles.topBar}>
          <h1>ShareMySchedule</h1>
          <button style={styles.signOutBtn} onClick={signOut}>
            Sign Out
          </button>
        </div>
        <div style={styles.content}>
          <Outlet /> {/* This is where page content goes */}
        </div>
      </div>
    </div>
  );
}

const styles = {
  container: { display: "flex", height: "100vh" },
  sidebar: {
    width: "200px",
    background: "#f4f4f4",
    padding: "20px",
    borderRight: "1px solid #ddd",
  },
  menu: { listStyle: "none", padding: 0, lineHeight: "2em", cursor: "pointer" },
  main: { flex: 1, display: "flex", flexDirection: "column" },
  topBar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "10px 20px",
    borderBottom: "1px solid #ddd",
  },
  signOutBtn: {
    padding: "6px 12px",
    border: "1px solid #333",
    cursor: "pointer",
    background: "white",
  },
  content: { padding: "20px" },
};
