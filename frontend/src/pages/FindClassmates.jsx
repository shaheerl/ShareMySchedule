import React, { useState, useEffect } from "react";
import { apiGet, apiPost } from "../api";

const tabs = ["All", "F", "W", "S"];
const termLabel = (t) =>
  t === "F" ? "Fall" : t === "W" ? "Winter" : t === "S" ? "Summer" : "All";

/* Convert backend details into text */
function makeDetailsText(detailObj) {
  if (!detailObj) return "";
  const d = detailObj.sharedCourseDetails || detailObj.matches || [];
  if (Array.isArray(d) && d.length) {
    return d
      .map((m) => {
        const code = m.courseCode || m.code || "";
        const sec = m.section ? ` ${m.section}` : "";
        const lab =
          m.lab ||
          (Array.isArray(m.labs) && m.labs.length
            ? ` – Lab ${m.labs.join(", ")}` : "");
        return `${code}${sec}${lab}`;
      })
      .join(", ");
  }
  const codes = detailObj.sharedCourseCodes || [];
  if (Array.isArray(codes) && codes.length) return codes.join(", ");
  return "";
}

/* === Connect Modal (inline) === */
function ConnectModal({ toUser, me, onClose }) {
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  if (!toUser) return null;

  const doSend = async () => {
    try {
      await apiPost("/connect", {
        toUserId: toUser.userId,
        platform: me?.preferredPlatform,
        message,
      });
      setSent(true);
      onClose?.(true); // close + refresh parent results
    } catch (e) {
      setError(e.message || "Failed to send");
    }
  };

  const shared = toUser?.sharedCourseCount ?? 0;

  return (
    <div style={styles.backdrop}>
      <div style={styles.modal}>
        {!sent ? (
          <>
            <h3 style={{ marginTop: 0 }}>Connect with {toUser.email}</h3>

            <p>Here is what they'll see:</p>
            <div style={styles.preview}>
              {/* Sender's name */}
              <div>{me?.name || "(Your name not set)"}</div>

              {/* Degree + Major */}
              <div>
                {[me?.degree, me?.major].filter(Boolean).join(", ") ||
                  "(Degree/Major not set)"}
              </div>

              {/* Year of study (optional) */}
              {me?.yearOfStudy && <div>Year {me.yearOfStudy}</div>}

              {/* Platform + handle */}
              <div>
                Platform:{" "}
                <strong>
                  {me?.preferredPlatform || "(not set)"}
                  {me?.preferredPlatform === "DISCORD" && me?.discordHandle
                    ? ` (${me.discordHandle})`
                    : ""}
                  {me?.preferredPlatform === "INSTAGRAM" && me?.instagramHandle
                    ? ` (${me.instagramHandle})`
                    : ""}
                </strong>
              </div>

              {/* Empty line */}
              <div style={{ margin: "8px 0" }} />

              {/* Shared courses */}
              <div>
                You and {me?.name || "this student"} share {shared}{" "}
                course{shared === 1 ? "" : "s"} together!
              </div>
            </div>

            <textarea
              rows={3}
              maxLength={200}
              placeholder="Add a short message (max 200 chars)"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              style={{ width: "100%", marginTop: 10 }}
            />
            <div style={{ fontSize: 12, textAlign: "right" }}>
              {message.length}/200
            </div>

            {error && <p style={{ color: "red" }}>{error}</p>}

            <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
              <button
                onClick={doSend}
                disabled={!me?.preferredPlatform}
              >
                Send
              </button>
              <button onClick={() => onClose(false)}>Cancel</button>
            </div>
          </>
        ) : (
          <>
            <h3>Your connection request has been sent!</h3>
            <div style={{ textAlign: "right" }}>
              <button onClick={() => onClose(true)}>Close</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* Render buckets for one term result */
function Buckets({ result, onConnect }) {
  const byCourseCount = result?.buckets?.byCourseCount || {};
  const exactCourses = result?.buckets?.exactCourses || [];
  const detailed = Array.isArray(result?.detailed) ? result.detailed : [];
  const detailMap = new Map(detailed.map((d) => [d.email, d]));

  if(detailed.length === 0) {
    return <p style={{ marginTop: 16, color: "#666" }}>No classmates found.</p>;
  }

  return (
    <div style={{ marginTop: 16 }}>

      <div
        style={{
          display: "grid",
          gap: 12,
          gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
        }}
      >
        {Object.keys(byCourseCount)
          .sort((a, b) => Number(a) - Number(b))
          .map((k) => (
            <div
              key={k}
              style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12 }}
            >
              <h4 style={{ margin: "0 0 8px" }}>
                Share {k} course{k === "1" ? "" : "s"}
              </h4>
              {byCourseCount[k].length === 0 ? (
                <p style={{ margin: 0, color: "#666" }}>None</p>
              ) : (
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {byCourseCount[k].map((email) => {
                    const info = detailMap.get(email);
                    console.log("Detail info:", info); // 👈 debug log
                    const detailsText = makeDetailsText(info);
                    return (
                      <li key={email} style={{ marginBottom: 6, lineHeight: 1.4 }}>
                        <span style={{ fontFamily: "monospace" }}>{email}</span>
                        {detailsText && <span> ({detailsText})</span>}
                        {info?.userId && (
                          <button
                            style={{ marginLeft: 8 }}
                            onClick={() => onConnect(info)} // 👈 pass full info
                          >
                            Connect
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          ))}
      </div>

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
                  {info?.userId && (
                    <button
                      style={{ marginLeft: 8 }}
                      onClick={() => onConnect(info)} // 👈 pass full info
                    >
                      Connect
                    </button>
                  )}
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
  const [result, setResult] = useState(null);
  const [allResults, setAllResults] = useState(null);

  const [me, setMe] = useState(null);
  const [connectTarget, setConnectTarget] = useState(null);

  useEffect(() => {
    apiGet("/auth/me").then((d) => setMe(d.user)).catch(() => {});
  }, []);

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

      {result && tab !== "All" && (
        <Buckets result={result} onConnect={setConnectTarget} />
      )}
      {allResults && tab === "All" && (
        <div style={{ marginTop: 16 }}>
          {["F", "W", "S"].map(
            (t) =>
              allResults[t] && (
                <div key={t} style={{ marginBottom: 22 }}>
                  <h3 style={{ marginBottom: 8 }}>{termLabel(t)}</h3>
                  <Buckets result={allResults[t]} onConnect={setConnectTarget} />
                </div>
              )
          )}
        </div>
      )}

      {connectTarget && me && (
        <ConnectModal
          toUser={connectTarget}
          me={me}
          onClose={(shouldRefresh) => {
            setConnectTarget(null);
            if (shouldRefresh) {
              runSearch(); // refresh after send
            }
          }}
        />
      )}
    </div>
  );
}

const styles = {
  backdrop: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.4)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
  },
  modal: {
    width: "min(600px, 95vw)",
    background: "#fff",
    borderRadius: 10,
    padding: 16,
    boxShadow: "0 4px 20px rgba(0,0,0,0.2)",
  },
  preview: {
    border: "1px solid #eee",
    borderRadius: 6,
    padding: 8,
    background: "#fafafa",
    marginBottom: 8,
  },
};
