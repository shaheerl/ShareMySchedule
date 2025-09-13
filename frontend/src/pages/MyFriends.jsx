import React, { useEffect, useState } from "react";
import { apiGet, apiDelete } from "../api";

const TABS = ["All", "F", "W", "S"];
const label = (t) =>
  t === "F" ? "Fall" : t === "W" ? "Winter" : t === "S" ? "Summer" : "All";

export default function MyFriends() {
  const [friends, setFriends] = useState([]);
  const [msg, setMsg] = useState("");
  const [tab, setTab] = useState("All");
  const [confirmRemove, setConfirmRemove] = useState(null);

  const load = async () => {
    try {
      const data = await apiGet("/friends");
      setFriends(data.friends || []);
    } catch (e) {
      setMsg(e.message || "Failed to load friends");
    }
  };

  useEffect(() => {
    load();
  }, []);

  const removeFriend = async (id) => {
    try {
      await apiDelete(`/friends/${id}`);
      setConfirmRemove(null);
      await load();
    } catch (e) {
      setMsg(e.message || "Failed to remove friend");
    }
  };

  // filter + sort by tab
  let visibleFriends =
    tab === "All"
      ? [...friends]
      : friends.filter((f) => f.sharedByTerm && f.sharedByTerm[tab]);

  if (tab === "All") {
    visibleFriends.sort((a, b) => b.sharedCourseCount - a.sharedCourseCount);
  } else {
    visibleFriends.sort(
      (a, b) =>
        (b.sharedByTerm?.[tab]?.length || 0) -
        (a.sharedByTerm?.[tab]?.length || 0)
    );
  }

  return (
    <div>
      <h2>My Friends</h2>
      {msg && <p style={{ color: "red" }}>{msg}</p>}

      {/* Term tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: "6px 12px",
              border: "1px solid #333",
              background: tab === t ? "#e6f2ff" : "white",
              cursor: "pointer",
            }}
          >
            {label(t)}
          </button>
        ))}
      </div>

      {visibleFriends.length === 0 ? (
        <p>No friends yet.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0 }}>
          {visibleFriends.map((f) => (
            <li
              key={f.id}
              style={{
                border: "1px solid #ddd",
                borderRadius: 6,
                padding: 10,
                marginBottom: 10,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <div>
                  <strong>{f.name || f.email}</strong>
                  {f.preferredPlatform && (
                    <span style={{ marginLeft: 6, color: "#555" }}>
                      • {f.preferredPlatform}
                      {f.handle ? ` (${f.handle})` : ""}
                    </span>
                  )}
                </div>
                {confirmRemove === f.id ? (
                  <span>
                    Remove this friend?{" "}
                    <button onClick={() => removeFriend(f.id)}>Yes</button>{" "}
                    <button onClick={() => setConfirmRemove(null)}>No</button>
                  </span>
                ) : (
                  <button onClick={() => setConfirmRemove(f.id)}>Remove</button>
                )}
              </div>

              {/* Shared courses */}
              {tab === "All" ? (
                <>
                  <div style={{ marginTop: 6 }}>
                    Total shared courses:{" "}
                    <strong>{f.sharedCourseCount}</strong>
                  </div>
                  {f.sharedByTerm && (
                    <div style={{ marginTop: 6 }}>
                      {Object.entries(f.sharedByTerm).map(([term, codes]) => (
                        <div key={term}>
                          {label(term)}: {codes.join(", ")}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <div style={{ marginTop: 6 }}>
                  Total shared courses in {label(tab)}:{" "}
                  <strong>{f.sharedByTerm?.[tab]?.length || 0}</strong>
                  {f.sharedByTerm?.[tab]?.length > 0 && (
                    <div>{f.sharedByTerm[tab].join(", ")}</div>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
