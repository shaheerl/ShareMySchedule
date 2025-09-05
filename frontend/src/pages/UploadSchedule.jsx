import React, { useState } from "react";
import { apiUpload } from "../api";
import { useNavigate } from "react-router-dom";

export default function UploadSchedule() {
  const nav = useNavigate();
  const [file, setFile] = useState(null);
  const [term, setTerm] = useState("Fall");
  const [msg, setMsg] = useState("");
  const [guesses, setGuesses] = useState([]);

  const onUpload = async () => {
    setMsg("");
    try {
      const res = await apiUpload("/schedules/upload", file, { term });
      setGuesses(res.guesses || []);
      // hand off guesses to manual entry via sessionStorage
      sessionStorage.setItem("ocr_guesses", JSON.stringify(res.guesses || []));
      sessionStorage.setItem("ocr_term", term);
      setMsg("OCR complete. Proceed to manual verification.");
    } catch (e) {
      setMsg(e.message);
    }
  };

  const proceed = () => nav("/manual-entry");

  return (
    <div>
      <h2>Upload Schedule</h2>
      <p>You can upload a screenshot like the example below. Select a term and choose a file.</p>

      <label>Term</label>{" "}
      <select value={term} onChange={(e) => setTerm(e.target.value)}>
        <option>Fall</option>
        <option>Winter</option>
        <option>Summer</option>
      </select>

      <div style={{ marginTop: 8 }}>
        <input type="file" accept="image/*,.png,.jpg,.jpeg" onChange={(e) => setFile(e.target.files?.[0] || null)} />
        <button disabled={!file} onClick={onUpload}>Upload</button>
      </div>

      <div style={{ marginTop: 12 }}>
        <button onClick={proceed}>Go to Manual Verification</button>
      </div>

      {msg && <p style={{ color: "blue" }}>{msg}</p>}

      <hr />
      <h4>How to get the screenshot (YorkU)</h4>
      <ol>
        <li>go to https://w2prod.sis.yorku.ca/Apps/WebObjects/cdm</li>
        <li>in the left hand menu, under "My Class Schedule" click on "Plot my Timetable"</li>
        <li>Sign in to Passport York if it prompts you</li>
        <li>Once signed in, continue to the "My Class Schedule" page</li>
        <li>Click on the academic session you are enrolled in to plot your class timetable</li>
        <li>Take a screenshot of the timetable or the table layout similar to the example</li>
        <li>Upload it here and click Upload</li>
      </ol>

      {/* You can place your screenshot example image in /public/example.png and show it here */}
      {/* <img src="/example.png" alt="Example timetable screenshot" width={600} /> */}
    </div>
  );
}
