import React, { useState, useEffect } from "react";
import { apiGet } from "../api";
import { DEGREES } from "../data/degrees";
import { MAJORS } from "../data/majors";

export default function AccountSettings() {
  const token = localStorage.getItem("accessToken");
  const [user, setUser] = useState(null);
  const [form, setForm] = useState({});
  const [changed, setChanged] = useState(false);
  const [msg, setMsg] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [oldPwd, setOldPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");

  useEffect(() => {
    apiGet("/auth/me", token)
      .then((res) => {
        setUser(res.user);
        const [firstName = "", lastName = ""] =
          res.user?.name?.split(" ") || [];
        setForm({
          firstName,
          lastName,
          degree: res.user?.degree || "",
          major: res.user?.major || "",
          yearOfStudy: res.user?.yearOfStudy || "",
          preferredPlatform: res.user?.preferredPlatform || "",
          discordHandle: res.user?.discordHandle || "",
          instagramHandle: res.user?.instagramHandle || "",
        });
      })
      .catch(() => setMsg("Error fetching account info"));
  }, [token]);

  const updateForm = (key, val) => {
    setForm({ ...form, [key]: val });
    setChanged(true);
  };

  const saveChanges = async () => {
    try {
      const res = await fetch("http://localhost:5000/account", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setUser(data.user);
      setChanged(false);
      setMsg("Changes saved.");
    } catch (err) {
      setMsg(err.message);
    }
  };

  const changePassword = async () => {
    if (newPwd !== confirmPwd) {
      setMsg("Passwords do not match.");
      return;
    }
    try {
      const res = await fetch("http://localhost:5000/account/change-password", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ oldPassword: oldPwd, newPassword: newPwd }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setMsg("Password updated successfully.");
      setOldPwd("");
      setNewPwd("");
      setConfirmPwd("");
      setShowPwd(false);
    } catch (err) {
      setMsg(err.message);
    }
  };

  return (
    <div style={styles.wrap}>
      <h2>Account Settings</h2>
      {msg && <p style={{ color: "blue" }}>{msg}</p>}

      <label>Email (username)</label>
      <input value={user?.email || ""} disabled style={{ background: "#eee" }} />

      <label>First Name</label>
      <input
        value={form.firstName}
        onChange={(e) => updateForm("firstName", e.target.value)}
      />

      <label>Last Name</label>
      <input
        value={form.lastName}
        onChange={(e) => updateForm("lastName", e.target.value)}
      />

      <label>Degree</label>
      <select
        value={form.degree}
        onChange={(e) => updateForm("degree", e.target.value)}
      >
        <option value="">-- Select Degree --</option>
        {DEGREES.map((d) => (
          <option key={d.code} value={d.code}>
            {d.label}
          </option>
        ))}
      </select>

      <label>Major</label>
      <select
        value={form.major}
        onChange={(e) => updateForm("major", e.target.value)}
      >
        <option value="">-- Select Major --</option>
        {MAJORS.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>

      <label>Year of Study</label>
      <input
        value={form.yearOfStudy}
        onChange={(e) => updateForm("yearOfStudy", e.target.value)}
      />

      <label>Preferred Connecting Platform</label>
      <select
        value={form.preferredPlatform || ""}
        onChange={(e) => updateForm("preferredPlatform", e.target.value)}
      >
        <option value="">-- Select --</option>
        <option value="DISCORD">Discord</option>
        <option value="INSTAGRAM">Instagram</option>
      </select>

      {form.preferredPlatform === "DISCORD" && (
        <>
          <label>Discord Handle</label>
          <input
            value={form.discordHandle || ""}
            onChange={(e) => updateForm("discordHandle", e.target.value)}
          />
        </>
      )}

      {form.preferredPlatform === "INSTAGRAM" && (
        <>
          <label>Instagram Handle</label>
          <input
            value={form.instagramHandle || ""}
            onChange={(e) => updateForm("instagramHandle", e.target.value)}
          />
        </>
      )}

      <button disabled={!changed} onClick={saveChanges}>
        Save Changes
      </button>

      <hr />

      <button onClick={() => setShowPwd(!showPwd)}>Change Password</button>
      {showPwd && (
        <div style={styles.pwdBox}>
          <label>Old Password</label>
          <input
            type="password"
            value={oldPwd}
            onChange={(e) => setOldPwd(e.target.value)}
          />
          <label>New Password</label>
          <input
            type="password"
            value={newPwd}
            onChange={(e) => setNewPwd(e.target.value)}
          />
          <label>Confirm New Password</label>
          <input
            type="password"
            value={confirmPwd}
            onChange={(e) => setConfirmPwd(e.target.value)}
          />
          <button onClick={changePassword}>Save Password</button>
        </div>
      )}
    </div>
  );
}

const styles = {
  wrap: {
    maxWidth: 500,
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  pwdBox: {
    marginTop: 10,
    padding: 10,
    border: "1px solid #ccc",
    borderRadius: 4,
  },
};
