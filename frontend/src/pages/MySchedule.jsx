import React, { useEffect, useMemo, useState } from "react";
import { apiGet } from "../api";
import { useNavigate } from "react-router-dom";

const TABS = ["All", "F", "W", "S"];
const label = (t) =>
  t === "F" ? "Fall" : t === "W" ? "Winter" : t === "S" ? "Summer" : "All";

// sort: LECT → TUT → LAB (then by start time)
const typeRank = (t) =>
  t === "LECT" ? 0 : t === "TUT" ? 1 : t === "LAB" ? 2 : 3;

export default function MySchedule() {
  const nav = useNavigate();
  const [schedules, setSchedules] = useState([]);
  const [tab, setTab] = useState("All");
  const [confirmDelete, setConfirmDelete] = useState(null); // track which course is confirming delete
  const [expanded, setExpanded] = useState({}); // track expanded/collapsed state
  const token = localStorage.getItem("accessToken");

  const load = () =>
    apiGet("/schedules", token)
      .then((r) => setSchedules(Array.isArray(r.schedules) ? r.schedules : []))
      .catch(() => setSchedules([]));

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(
    () => (tab === "All" ? schedules : schedules.filter((s) => s.term === tab)),
    [schedules, tab]
  );

  // group by term, then by courseCode
  const byTerm = useMemo(() => {
    const m = new Map();
    for (const row of filtered) {
      if (!m.has(row.term)) m.set(row.term, new Map());
      const courses = m.get(row.term);
      if (!courses.has(row.courseCode)) courses.set(row.courseCode, []);
      courses.get(row.courseCode).push(row);
    }
    // sort each course's rows
    for (const [, courses] of m) {
      for (const [code, rows] of courses) {
        rows.sort((a, b) => {
          const tr = typeRank(a.type) - typeRank(b.type);
          if (tr !== 0) return tr;
          return (a.startTime || "").localeCompare(b.startTime || "");
        });
        courses.set(code, rows);
      }
    }
    return m;
  }, [filtered]);

  const hasAny = schedules.length > 0;

  const doDelete = async (code) => {
    try {
      await fetch(
        `${
          process.env.REACT_APP_API_BASE_URL || "http://localhost:5000"
        }/schedules/code/${encodeURIComponent(code)}`,
        {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${localStorage.getItem("accessToken")}`,
          },
        }
      );
      setConfirmDelete(null);
      await load();
    } catch {
      setConfirmDelete(null);
    }
  };

  const toggleExpand = (code) => {
    setExpanded((prev) => ({
      ...prev,
      [code]: !prev[code],
    }));
  };

  const expandAll = () => {
    const allCodes = {};
    for (const [, courses] of byTerm) {
      for (const code of courses.keys()) {
        allCodes[code] = true;
      }
    }
    setExpanded(allCodes);
  };

  const collapseAll = () => {
    setExpanded({});
  };

  return (
    <div>
      <h2>My Schedule</h2>

      {/* Tabs */}
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

      {!hasAny && <p>Add your schedule now!</p>}

      <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
        <button onClick={() => nav("/manual-entry")}>Select courses</button>
        {hasAny && (
          <>
            <button onClick={expandAll}>Expand All</button>
            <button onClick={collapseAll}>Collapse All</button>
          </>
        )}
      </div>

      {/* Term sections */}
      {[...byTerm.keys()]
        .sort((a, b) => "FWS".indexOf(a) - "FWS".indexOf(b))
        .map((termKey) => {
          const courses = byTerm.get(termKey);
          return (
            <div key={termKey} style={{ marginBottom: 18 }}>
              {tab === "All" && (
                <h3 style={{ marginBottom: 8 }}>{label(termKey)}</h3>
              )}
              {[...courses.keys()].map((code) => (
                <div
                  key={code}
                  style={{
                    marginBottom: 10,
                    border: "1px solid #ddd",
                    borderRadius: 6,
                  }}
                >
                  <div
                    style={{
                      padding: "8px 10px",
                      background: "#fafafa",
                      borderBottom: "1px solid #eee",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 8 }}
                    >
                      <button
                        onClick={() => toggleExpand(code)}
                        style={{
                          border: "none",
                          background: "none",
                          cursor: "pointer",
                          fontSize: "16px",
                        }}
                      >
                        {expanded[code] ? "▼" : "▶"}
                      </button>
                      {(() => {
                        const rows = courses.get(code);
                        const lect =
                          rows.find((r) => r.type === "LECT") || rows[0];
                        return (
                          <strong>
                            {code} {lect?.section ? `- ${lect.section}` : ""} 
                          </strong>
                        );
                      })()}
                    </div>

                    {confirmDelete === code ? (
                      <span>
                        Delete this course?{" "}
                        <button onClick={() => doDelete(code)}>Yes</button>{" "}
                        <button onClick={() => setConfirmDelete(null)}>
                          No
                        </button>
                      </span>
                    ) : (
                      <button onClick={() => setConfirmDelete(code)}>
                        Delete
                      </button>
                    )}
                  </div>

                  {expanded[code] && (
                    <table border="0" cellPadding="6" style={{ width: "100%" }}>
                      <thead>
                        <tr style={{ textAlign: "left" }}>
                          <th>Type</th>
                          <th>Section</th>
                          <th>Days</th>
                          <th>Start</th>
                          <th>Duration</th>
                          <th>Room</th>
                        </tr>
                      </thead>
                      <tbody>
                        {courses.get(code).map((s) => (
                          <tr key={s.id}>
                            <td>{s.type}</td>
                            <td>{s.section}</td>
                            <td>{s.days}</td>
                            <td>{s.startTime}</td>
                            <td>{s.duration ?? ""}</td>
                            <td>{s.room}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              ))}
            </div>
          );
        })}
    </div>
  );
}
