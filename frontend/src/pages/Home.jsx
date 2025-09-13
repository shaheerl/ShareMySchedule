import React, { useEffect, useState } from "react";
import { apiGet } from "../api";

export default function Home() {
  const [stats, setStats] = useState(null);
  const [nextRefresh, setNextRefresh] = useState(null);
  const [countdown, setCountdown] = useState("");

  // fetch stats on load
  useEffect(() => {
    apiGet("/stats").then(setStats).catch(() => {});
  }, []);

  // compute next refresh date (every other Sunday after lastRefresh)
  useEffect(() => {
    if (!stats?.lastRefresh) return;

    const last = new Date(stats.lastRefresh + " 00:00:00");
    const next = new Date(last);
    next.setDate(last.getDate() + 14); // every 2 weeks

    setNextRefresh(next);

    const interval = setInterval(() => {
      const now = new Date();
      const diff = next - now;

      if (diff <= 0) {
        setCountdown("Refreshing soon!");
        return;
      }

      const d = Math.floor(diff / (1000 * 60 * 60 * 24));
      const h = Math.floor((diff / (1000 * 60 * 60)) % 24);
      const m = Math.floor((diff / (1000 * 60)) % 60);
      const s = Math.floor((diff / 1000) % 60);

      setCountdown(`${d}d ${h}h ${m}m ${s}s`);
    }, 1000);

    return () => clearInterval(interval);
  }, [stats]);

  return (
    <div>
      <h2>Welcome to ShareMySchedule!</h2>
      <p>Find classmates who share your courses and connect with them!</p>

      {stats ? (
        <div style={{ marginTop: 20 }}>
          <p>
            <strong>Total Users:</strong> {stats.userCount}
          </p>
          <p>
            <strong>Last Data Refresh:</strong> {stats.lastRefresh}
          </p>
          <p>
            <strong>Next Data Refresh:</strong>{" "}
            {nextRefresh ? nextRefresh.toLocaleString() : "Loading..."}
          </p>
          <p>
            <strong>Countdown:</strong> {countdown}
          </p>
        </div>
      ) : (
        <p>Loading stats...</p>
      )}

      <div style={{ marginTop: 30 }}>
        <h3>How to Use the Site</h3>
        <p>
          Watch this short video guide (coming soon):
        </p>
        <div style={{ border: "1px solid #ccc", padding: 10 }}>
          <em>YouTube video will appear here</em>
        </div>
      </div>
    </div>
  );
}
