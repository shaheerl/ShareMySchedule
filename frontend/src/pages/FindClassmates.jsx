import React, { useState } from "react";
import { apiGet } from "../api";

const tabs = ["F", "W", "S"];

export default function FindClassmates() {
  const [term, setTerm] = useState("F");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  const runSearch = async () => {
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const data = await apiGet(`/classmates?term=${term}`);
      setResult(data);
    } catch (e) {
      setError(e.message || "Failed to search");
    } finally {
      setLoading(false);
    }
  };

  const byCourseCount = result?.buckets?.byCourseCount || {};
  const exactCourses = result?.buckets?.exactCourses || [];

  return (
    <div>
      <h2>Find Classmates</h2>

      {/* Term tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        {tabs.map((t) => (
          <button
            key={t}
            onClick={() => setTerm(t)}
            style={{
              padding: "6px 12px",
              border: "1px solid #333",
              background: term === t ? "#e6f2ff" : "white",
              cursor: "pointer",
            }}
          >
            {t === "F" ? "Fall" : t === "W" ? "Winter" : "Summer"}
          </button>
        ))}
      </div>

      <button onClick={runSearch} disabled={loading}>
        {loading ? "Searching..." : "Find classmates"}
      </button>

      {error && <p style={{ color: "red", marginTop: 10 }}>{error}</p>}

      {result && (
        <div style={{ marginTop: 16 }}>
          <p>
            Your {result.term} courses:{" "}
            <strong>{(result.myCourses || []).join(", ") || "—"}</strong>
          </p>

          {/* Buckets by shared course count */}
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
            {Object.keys(byCourseCount)
              .sort((a, b) => Number(a) - Number(b))
              .map((k) => (
                <div key={k} style={{ border: "1px solid #ddd", borderRadius: 6, padding: 10 }}>
                  <h4 style={{ margin: "0 0 8px" }}>
                    Share {k} course{k === "1" ? "" : "s"}
                  </h4>
                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                    {byCourseCount[k].map((email) => (
                      <li key={email} style={{ fontFamily: "monospace" }}>
                        {email}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
          </div>

          {/* Exact course set match */}
          <div style={{ marginTop: 20 }}>
            <h4>Exact course set match</h4>
            {exactCourses.length === 0 ? (
              <p>None</p>
            ) : (
              <ul style={{ paddingLeft: 18 }}>
                {exactCourses.map((email) => (
                  <li key={email} style={{ fontFamily: "monospace" }}>
                    {email}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Advanced: per-user details (sections/labs) */}
          <div style={{ marginTop: 20 }}>
            <h4>Details (sections & labs)</h4>
            {(result.detailed || []).map((d) => (
              <div key={d.email} style={{ border: "1px solid #eee", marginBottom: 10, padding: 10, borderRadius: 6 }}>
                <div style={{ fontFamily: "monospace", marginBottom: 4 }}>{d.email}</div>
                <div>Shared courses: <strong>{d.sharedCourseCount}</strong> ({d.sharedCourseCodes.join(", ")})</div>
                <div>Same sections: <strong>{d.sameSectionCount}</strong></div>
                <div>Lab matches: <strong>{d.labMatchCount}</strong></div>
                <div>All courses match: <strong>{d.allCoursesMatch ? "Yes" : "No"}</strong></div>
                <div>All labs match: <strong>{d.allLabsMatch ? "Yes" : "No"}</strong></div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
