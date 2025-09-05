import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";

export default function EditCourse() {
  const { id } = useParams();
  const nav = useNavigate();
  const token = localStorage.getItem("accessToken");
  const [item, setItem] = useState(null);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    // quick fetch-all then pick one (to keep backend minimal)
    fetch("http://localhost:5000/schedules", { headers: { Authorization: `Bearer ${token}` }})
      .then(r => r.json()).then(d => setItem(d.schedules.find(x => x.id === id))).catch(()=>{});
  }, [id, token]);

  const save = async () => {
    const res = await fetch(`http://localhost:5000/schedules/${id}`, {
      method: "PUT",
      headers: { "Content-Type":"application/json", Authorization:`Bearer ${token}` },
      body: JSON.stringify(item)
    });
    const data = await res.json();
    if (!res.ok) { setMsg(data.error || "Failed"); return; }
    nav("/my-schedule");
  };

  if (!item) return <p>Loading…</p>;

  return (
    <div>
      <h2>Edit Course</h2>
      {["courseCode","section","type","days","startTime","duration","room"].map(k => (
        <div key={k}>
          <label>{k}</label>
          <input value={item[k] ?? ""} onChange={e => setItem({ ...item, [k]: e.target.value })} />
        </div>
      ))}
      <button onClick={save}>Save</button>
      {msg && <p style={{ color:"red" }}>{msg}</p>}
    </div>
  );
}
