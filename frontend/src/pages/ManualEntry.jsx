import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

const API_BASE = process.env.REACT_APP_API_BASE_URL || "http://localhost:5000";

export default function ManualEntry() {
  const nav = useNavigate();
  const token = localStorage.getItem("accessToken");

  const [q, setQ] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [loadingSearch, setLoadingSearch] = useState(false);

  const [course, setCourse] = useState(null); // full course obj
  const [sectionKey, setSectionKey] = useState(""); // e.g. "F-A"
  const [selectedLectureId, setSelectedLectureId] = useState(""); // "LECT-01" etc.
  const [selectedLabId, setSelectedLabId] = useState(""); // "LAB-02" / "TUTR-01" / ""

  const [pendingItems, setPendingItems] = useState([]); // flattened rows that will be saved
  const [msg, setMsg] = useState("");
  const [saved, setSaved] = useState(false);

  // ---- search ----
  useEffect(() => {
    const t = setTimeout(async () => {
      if (q.trim().length < 2) {
        setSuggestions([]);
        return;
      }
      try {
        setLoadingSearch(true);
        const r = await fetch(
          `${API_BASE}/courses/search?q=${encodeURIComponent(q.trim())}`
        );
        const data = await r.json();
        setSuggestions(data.courses || []);
      } catch {
        setSuggestions([]);
      } finally {
        setLoadingSearch(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  async function loadCourse(c) {
    setMsg("");
    setQ(`${c.subject} ${c.number} — ${c.name}`);
    setSuggestions([]);
    const r = await fetch(
      `${API_BASE}/courses/${encodeURIComponent(
        c.subject
      )}/${encodeURIComponent(c.number)}`
    );
    const data = await r.json();
    setCourse(data);
    setSectionKey("");
    setSelectedLectureId("");
    setSelectedLabId("");
    setPendingItems([]);
  }

  // derived: sections (array with {term, letter, instructor, offerings})
  const sections = useMemo(() => course?.sections || [], [course]);

  // current section object
  const section = useMemo(() => {
    if (!sectionKey) return null;
    const [term, letter] = sectionKey.split("-");
    return sections.find((s) => s.term === term && s.letter === letter) || null;
  }, [sections, sectionKey]);

  const lectures = useMemo(() => {
    if (!section) return [];
    return (section.offerings || [])
      .filter((o) => o.type.toUpperCase().startsWith("LECT"))
      .map((o) => ({ id: `LECT-${o.number || "NA"}`, ...o }));
  }, [section]);

  const labOrTutr = useMemo(() => {
    if (!section) return [];
    return (section.offerings || [])
      .filter(
        (o) =>
          o.type.toUpperCase().startsWith("LAB") ||
          o.type.toUpperCase().startsWith("TUTR")
      )
      .map((o) => ({
        id: `${o.type.toUpperCase()}-${o.number || "NA"}`,
        ...o,
      }));
  }, [section]);

  function buildPending() {
    if (!course || !section) return [];

    const [term] = sectionKey.split("-");
    const courseCode = `${course.subject} ${course.number}`;
    const base = { term, courseCode, section: section.letter };

    const chosen = [];
    const chosenLect = lectures.find((l) => l.id === selectedLectureId);
    if (chosenLect) {
      for (const m of chosenLect.meetings || []) {
        chosen.push({
          ...base,
          type: "LECT",
          days: m.day || "",
          startTime: m.startTime || "",
          duration: m.duration || null,
          room: m.room || "",
        });
      }
    }
    const chosenLab = labOrTutr.find((l) => l.id === selectedLabId);
    if (chosenLab) {
      for (const m of chosenLab.meetings || []) {
        chosen.push({
          ...base,
          type: chosenLab.type.toUpperCase().startsWith("TUTR")
            ? "TUTR"
            : "LAB",
          days: m.day || "",
          startTime: m.startTime || "",
          duration: m.duration || null,
          room: m.room || "",
        });
      }
    }
    return chosen;
  }

  useEffect(() => {
    setPendingItems(buildPending());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [course, sectionKey, selectedLectureId, selectedLabId]);

  async function saveAll() {
    if (!pendingItems.length) {
      setMsg("Nothing to save");
      return;
    }
    try {
      const r = await fetch(`${API_BASE}/schedules/bulk`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ items: pendingItems }),
      });
      setSaved(true);
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Save failed");
      setMsg("Saved! ✅");
    } catch (e) {
      setSaved(false);
      setMsg(e.message);
    }
  }

  return (
    <div>
      <h2>Search courses</h2>

      {/* Search */}
      <div style={s.searchWrap}>
        <input
          style={s.input}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by code or name (e.g., EECS 3482, Calculas)"
        />
        {loadingSearch && <span style={{ marginLeft: 8 }}>Searching…</span>}
      </div>

      {/* Suggestions */}
      {suggestions.length > 0 && (
        <div style={s.suggestBox}>
          {suggestions.map((c) => (
            <div
              key={`${c.subject}-${c.number}`}
              style={s.suggestItem}
              onClick={() => loadCourse(c)}
            >
              <strong>
                {c.subject} {c.number}
              </strong>{" "}
              — {c.name}
            </div>
          ))}
        </div>
      )}

      {/* Course detail */}
      {course && (
        <div style={{ marginTop: 16 }}>
          <h3>
            {course.subject} {course.number} — {course.name}
          </h3>

          {/* Section select */}
          <div style={s.row}>
            <label style={s.label}>Section</label>
            <select
              style={s.select}
              value={sectionKey}
              onChange={(e) => {
                setSectionKey(e.target.value);
                setSelectedLectureId("");
                setSelectedLabId("");
              }}
            >
              <option value="">-- Choose term & section --</option>
              {sections.map((sct) => (
                <option
                  key={`${sct.term}-${sct.letter}`}
                  value={`${sct.term}-${sct.letter}`}
                >
                  {sct.term} — Section {sct.letter}{" "}
                  {sct.instructor ? `— ${sct.instructor}` : ""}
                </option>
              ))}
            </select>
          </div>

          {/* Lecture select */}
          {!!lectures.length && (
            <div style={s.row}>
              <label style={s.label}>Lecture</label>
              <select
                style={s.select}
                value={selectedLectureId}
                onChange={(e) => setSelectedLectureId(e.target.value)}
              >
                <option value="">-- Choose lecture --</option>
                {lectures.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.type} {l.number || ""}{" "}
                    {l.meetings
                      ?.map((m) => `${m.day} ${m.startTime}`)
                      .join(", ")}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Lab/Tutorial select (optional) */}
          {!!labOrTutr.length && (
            <div style={s.row}>
              <label style={s.label}>Lab/Tutorial (optional)</label>
              <select
                style={s.select}
                value={selectedLabId}
                onChange={(e) => setSelectedLabId(e.target.value)}
              >
                <option value="">-- None --</option>
                {labOrTutr.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.type} {l.number || ""} —{" "}
                    {l.meetings
                      ?.map((m) => `${m.day} ${m.startTime}`)
                      .join(", ")}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Preview rows */}
          {pendingItems.length > 0 && (
            <>
              <h4 style={{ marginTop: 12 }}>Preview</h4>
              <table border="1" cellPadding="6">
                <thead>
                  <tr>
                    <th>Term</th>
                    <th>Course</th>
                    <th>Section</th>
                    <th>Type</th>
                    <th>Day</th>
                    <th>Start</th>
                    <th>Duration</th>
                    <th>Room</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingItems.map((p, idx) => (
                    <tr key={idx}>
                      <td>{p.term}</td>
                      <td>{p.courseCode}</td>
                      <td>{p.section}</td>
                      <td>{p.type}</td>
                      <td>{p.days}</td>
                      <td>{p.startTime}</td>
                      <td>{p.duration ?? ""}</td>
                      <td>{p.room}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <button onClick={saveAll} disabled={!pendingItems.length}>
                  Save to My Schedule
                </button>
              </div>
            </>
          )}

          {msg && (
            <div style={{ marginTop: 12 }}>
              <p style={{ color: msg.includes("Saved") ? "green" : "red" }}>
                {msg}
              </p>

              {/* 👇 only show if msg is a success */}
              {msg.includes("Saved") && (
                <p> You can continue adding courses </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const s = {
  searchWrap: { display: "flex", alignItems: "center", gap: 8 },
  input: { width: 360, padding: 8 },
  suggestBox: {
    width: 520,
    background: "#fff",
    border: "1px solid #ddd",
    marginTop: 6,
    borderRadius: 4,
    maxHeight: 220,
    overflowY: "auto",
  },
  suggestItem: {
    padding: 8,
    borderBottom: "1px solid #eee",
    cursor: "pointer",
  },
  row: { display: "flex", alignItems: "center", gap: 10, marginTop: 10 },
  label: { width: 160 },
  select: { padding: 6, minWidth: 260 },
};
