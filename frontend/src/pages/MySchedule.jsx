import React, { useEffect, useState } from "react";
import { apiGet } from "../api";
import { useNavigate } from "react-router-dom";

export default function MySchedule() {
  const nav = useNavigate();
  const [schedules, setSchedules] = useState([]);
  const token = localStorage.getItem("accessToken");

  const load = () =>
    apiGet("/schedules", token).then(r => setSchedules(r.schedules)).catch(() => setSchedules([]));

  useEffect(() => { load(); }, []);

  const hasAny = schedules.length > 0;

  return (
    <div>
      <h2>My Schedule</h2>
      {!hasAny && <p>Add your schedule now!</p>}

      <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
        <button onClick={() => nav("/upload-schedule")}>Upload schedule</button>
        <button onClick={() => nav("/manual-entry")}>Manually enter schedule</button>
      </div>

      {hasAny && (
        <>
          <table border="1" cellPadding="6">
            <thead>
              <tr>
                <th>Term</th><th>Course</th><th>Section</th><th>Type</th>
                <th>Days</th><th>Start</th><th>Duration</th><th>Room</th><th>Edit</th>
              </tr>
            </thead>
            <tbody>
              {schedules.map(s => (
                <tr key={s.id}>
                  <td>{s.term}</td>
                  <td>{s.courseCode}</td>
                  <td>{s.section}</td>
                  <td>{s.type}</td>
                  <td>{s.days}</td>
                  <td>{s.startTime}</td>
                  <td>{s.duration ?? ""}</td>
                  <td>{s.room}</td>
                  <td><button onClick={() => nav(`/edit-course/${s.id}`)}>Edit</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
