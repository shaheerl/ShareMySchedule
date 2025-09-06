import React, { useEffect, useState } from "react";
import { apiGet, apiPost } from "../api";
import { useNavigate } from "react-router-dom";

export default function MySchedule() {
  const nav = useNavigate();
  const [schedules, setSchedules] = useState([]);

  const load = () =>
    apiGet("/schedules")
      .then((r) => setSchedules(r.schedules))
      .catch(() => setSchedules([]));

  useEffect(() => {
    load();
  }, []);

  const handleDelete = async (id) => {
    if (!window.confirm("Are you sure you want to delete this course?")) return;
    try {
      await apiPost(`/schedules/${id}/delete`, {}); // we'll wire backend below
      load();
    } catch (err) {
      console.error("Delete failed", err);
    }
  };

  const hasAny = schedules.length > 0;

  // Group schedules by term+courseCode
  const grouped = schedules.reduce((acc, s) => {
    const key = `${s.term}-${s.courseCode}`;
    if (!acc[key]) acc[key] = [];
    acc[key].push(s);
    return acc;
  }, {});

  // Sort inside each group: LECT → TUT → LAB → others
  const sortType = (t) =>
    t === "LECT" ? 1 : t === "TUT" ? 2 : t === "LAB" ? 3 : 4;

  return (
    <div>
      <h2>My Schedule</h2>
      {!hasAny && <p>Add your schedule now!</p>}

      <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
        <button onClick={() => nav("/manual-entry")}>Select courses</button>
      </div>

      {Object.entries(grouped).map(([key, rows]) => {
        const [term, courseCode] = key.split("-");
        const sorted = [...rows].sort((a, b) => sortType(a.type) - sortType(b.type));

        return (
          <div
            key={key}
            style={{
              marginBottom: "20px",
              padding: "12px",
              border: "1px solid #ccc",
              borderRadius: "6px",
            }}
          >
            <h3>
              {courseCode} (Term {term})
            </h3>
            <table
              style={{ width: "100%", borderCollapse: "collapse", marginTop: "8px" }}
            >
              <thead>
                <tr style={{ background: "#f0f0f0" }}>
                  <th>Type</th>
                  <th>Section</th>
                  <th>Days</th>
                  <th>Start</th>
                  <th>Duration</th>
                  <th>Room</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((s) => (
                  <tr key={s.id}>
                    <td>{s.type}</td>
                    <td>{s.section}</td>
                    <td>{s.days}</td>
                    <td>{s.startTime}</td>
                    <td>{s.duration ?? ""}</td>
                    <td>{s.room}</td>
                    <td>
                      <button
                        onClick={() => handleDelete(s.id)}
                        style={{
                          background: "red",
                          color: "white",
                          border: "none",
                          padding: "4px 8px",
                          cursor: "pointer",
                        }}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}
