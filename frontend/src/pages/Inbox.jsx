import React, { useEffect, useState } from "react";
import { apiGet, apiPut } from "../api";

export default function Inbox() {
  const [received, setReceived] = useState([]);
  const [sent, setSent] = useState([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");

  const load = async () => {
    setLoading(true);
    setMsg("");
    try {
      const data = await apiGet("/inbox");
      setReceived(data.received || []);
      setSent(data.sent || []);
    } catch (e) {
      setMsg(e.message || "Failed to load inbox");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const respond = async (id, action) => {
    try {
      await apiPut(`/connect/${id}/respond`, { action });
      await load();
    } catch (e) {
      setMsg(e.message || "Failed to respond");
    }
  };

  return (
    <div style={{ maxWidth: 900, margin: "20px auto" }}>
      <h2>Inbox</h2>
      {msg && <p style={{ color: "red" }}>{msg}</p>}
      {loading ? (
        <p>Loading…</p>
      ) : (
        <>
          {/* === RECEIVED === */}
          <section style={{ marginBottom: 20 }}>
            <h3>Received</h3>
            {received.length === 0 ? (
              <p>Nothing yet.</p>
            ) : (
              <div style={{ display: "grid", gap: 10 }}>
                {received.map((r) => (
                  <div
                    key={r.id}
                    style={{
                      border: "1px solid #eee",
                      borderRadius: 8,
                      padding: 12,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                      }}
                    >
                      <div>
                        <strong>{r.senderName || "(name hidden)"}</strong>{" "}
                        <span style={{ color: "#666" }}>• {r.platform} • {r.handle}</span>
                      </div>
                      <div style={{ color: "#666" }}>
                        {new Date(r.createdAt).toLocaleString(undefined, {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                          hour12: true,
                        })}
                      </div>
                    </div>

                    <div style={{ marginTop: 4 }}>
                      {[r.senderDegree, r.senderMajor]
                        .filter(Boolean)
                        .join(", ")}{" "}
                      {r.senderYear ? ` • Year ${r.senderYear}` : ""}
                    </div>

                    <div style={{ marginTop: 6 }}>{r.message}</div>

                    {/* Shared courses */}
                    <div style={{ marginTop: 6, color: "#444" }}>
  Shared courses: {r.sharedCourseCount ?? 0}
  {r.sharedCourseCodes?.length > 0 && (
    <span> ({r.sharedCourseCodes.join(", ")})</span>
  )}
</div>


                    <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
                      {r.status === "PENDING" ? (
                        <>
                          <button onClick={() => respond(r.id, "ACCEPTED")}>
                            Accept
                          </button>
                          <button onClick={() => respond(r.id, "DECLINED")}>
                            Decline
                          </button>
                        </>
                      ) : (
                        <span style={{ color: "#666" }}>{r.status}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* === SENT === */}
          <section>
            <h3>Sent</h3>
            {sent.length === 0 ? (
              <p>Nothing sent.</p>
            ) : (
              <div style={{ display: "grid", gap: 10 }}>
                {sent.map((r) => (
                  <div
                    key={r.id}
                    style={{
                      border: "1px solid #eee",
                      borderRadius: 8,
                      padding: 12,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                      }}
                    >
                      <div>
                        To: <strong>{r.toUser?.email}</strong>{" "}
                        <span style={{ color: "#666" }}>• {r.platform} • {r.handle}</span>
                      </div>
                      <div style={{ color: "#666" }}>
                        {new Date(r.createdAt).toLocaleString(undefined, {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                          hour12: true,
                        })}
                      </div>
                    </div>

                    <div style={{ marginTop: 6 }}>{r.message}</div>

                    {/* Shared courses */}
                    <div style={{ marginTop: 6, color: "#444" }}>
  Shared courses: {r.sharedCourseCount ?? 0}
  {r.sharedCourseCodes?.length > 0 && (
    <span> ({r.sharedCourseCodes.join(", ")})</span>
  )}
</div>


                    <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
                      {r.status === "PENDING" ? (
                        <button onClick={() => respond(r.id, "CANCELLED")}>
                          Cancel
                        </button>
                      ) : (
                        <span style={{ color: "#666" }}>{r.status}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
