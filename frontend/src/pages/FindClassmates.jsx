import React, { useState } from "react";
import { apiGet } from "../api";

const tabs = ["All", "F", "W", "S"];
const termLabel = (t) => (t === "F" ? "Fall" : t === "W" ? "Winter" : t === "S" ? "Summer" : "All");

/* Convert whatever the backend sends into a friendly string:
   - Prefer an array like sharedCourseDetails: [{courseCode, section, lab}]
   - Else fall back to sharedCourseCodes: ["EECS 3482", "MATH 1013"]
*/
function makeDetailsText(detailObj) {
  if (!detailObj) return "";
  const d = detailObj.sharedCourseDetails || detailObj.matches || [];
  if (Array.isArray(d) && d.length) {
    return d
      .map((m) => {
        const code = m.courseCode || m.code || "";
        const sec = m.section ? ` ${m.section}` : "";
        const lab =
          m.lab || (Array.isArray(m.labs) && m.labs.length ? ` – Lab ${m.labs.join(", ")}` : "");
        return `${code}${sec}${lab}`;
      })
      .join(", ");
  }
  const codes = detailObj.sharedCourseCodes || [];
  if (Array.isArray(codes) && codes.length) return codes.join(", ");
  return "";
}

/* Render buckets for one term result */
function Buckets({ result }) {
  const byCourseCount = result?.buckets?.byCourseCount || {};
  const exactCourses = result?.buckets?.exactCourses || [];
  const detailed = Array.isArray(result?.detailed) ? result.detailed : [];
  const detailMap = new Map(detailed.map((d) => [d.email, d]));

  return (
    <div style={{ marginTop: 16 }}>
      <p>
        Your {termLabel(result.term)} courses:{" "}
        <strong>{(result.myCourses || []).join(", ") || "—"}</strong>
      </p>

      {/* Buckets */}
      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}>
        {Object.keys(byCourseCount)
          .sort((a, b) => Number(a) - Number(b))
          .map((k) => (
            <div key={k} style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
              <h4 style={{ margin: "0 0 8px" }}>
                Share {k} course{k === "1" ? "" : "s"}
              </h4>
              {byCourseCount[k].length === 0 ? (
                <p style={{ margin: 0, color: "#666" }}>None</p>
              ) : (
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {byCourseCount[k].map((email) => {
                    const info = detailMap.get(email);
                    const detailsText = makeDetailsText(info);
                    return (
                      <li key={email} style={{ marginBottom: 6, lineHeight: 1.4 }}>
                        <span style={{ fontFamily: "monospace" }}>{email}</span>
                        {detailsText && (
                          <span style={{ color: "#333" }}> ({detailsText})</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          ))}
      </div>

      {/* Exact course set match — only show if there are any */}
      {Array.isArray(exactCourses) && exactCourses.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <h4>Exact course set match</h4>
          <ul style={{ paddingLeft: 18, marginTop: 6 }}>
            {exactCourses.map((email) => {
              const info = detailMap.get(email);
              const detailsText = makeDetailsText(info);
              return (
                <li key={email} style={{ marginBottom: 4, lineHeight: 1.4 }}>
                  <span style={{ fontFamily: "monospace" }}>{email}</span>
                  {detailsText && <span> ({detailsText})</span>}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function FindClassmates() {
  const [tab, setTab] = useState("All");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);        // single-term
  const [allResults, setAllResults] = useState(null); // {F:res, W:res, S:res}

  const runSearch = async () => {
    setLoading(true);
    setError("");
    setResult(null);
    setAllResults(null);

    try {
      if (tab === "All") {
        const terms = ["F", "W", "S"];
        const settled = await Promise.allSettled(
          terms.map((t) => apiGet(`/classmates?term=${t}`))
        );
        const out = {};
        settled.forEach((r, i) => {
          if (r.status === "fulfilled" && r.value) out[terms[i]] = r.value;
        });
        setAllResults(out);
      } else {
        const data = await apiGet(`/classmates?term=${tab}`);
        setResult(data);
      }
    } catch (e) {
      setError(e.message || "Failed to search");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <h2>Find Classmates</h2>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        {tabs.map((t) => (
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
            {termLabel(t)}
          </button>
        ))}
      </div>

      <button onClick={runSearch} disabled={loading}>
        {loading ? "Searching..." : "Find classmates"}
      </button>

      {error && <p style={{ color: "red", marginTop: 10 }}>{error}</p>}

      {/* Single-term */}
      {result && tab !== "All" && <Buckets result={result} />}

      {/* All terms */}
      {allResults && tab === "All" && (
        <div style={{ marginTop: 16 }}>
          {["F", "W", "S"].map((t) =>
            allResults[t] ? (
              <div key={t} style={{ marginBottom: 22 }}>
                <h3 style={{ marginBottom: 8 }}>{termLabel(t)}</h3>
                <Buckets result={allResults[t]} />
              </div>
            ) : null
          )}
        </div>
      )}
    </div>
  );
}
