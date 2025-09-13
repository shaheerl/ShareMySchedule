import React, { useState } from "react";
import { apiPost } from "../api";

export default function ConnectModal({ toUser, me, onClose }) {
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

      // 👇 after success, trigger parent reload
      if (onClose) onClose(true); // pass a flag to signal refresh
    } catch (e) {
      setError(e.message || "Failed to send");
    }
  };

  return (
    <div style={styles.backdrop}>
      <div style={styles.modal}>
        {!sent ? (
          <>
            <h3 style={{ marginTop: 0 }}>
              Connect with {toUser.email}
            </h3>
            <p>Here is what they'll SUI:</p>
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

              {/* Shared courses message */}
              <div>
                You and {me?.name || "this student"} share{" "}
                {toUser?.sharedCourseCount ?? 0} courses together!
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
                disabled={!me?.preferredPlatform || !message.trim()}
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
