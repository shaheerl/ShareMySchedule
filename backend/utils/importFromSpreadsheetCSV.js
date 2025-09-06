import fs from "fs";
import path from "path";
import { parse } from "csv-parse/sync";

const CATALOG_DIR = path.join(process.cwd(), "catalog");
const OUT = path.join(CATALOG_DIR, "catalog.json");

/* ---------------------- string hygiene ---------------------- */
const stripWeird = (s) =>
  (s ?? "")
    .toString()
    .replace(/ï¿½/g, " ")
    .replace(/\uFFFD/g, " ")
    .replace(/\u00FF/g, " ")
    .replace(/\u00A0/g, " ")
    .replace(/[\u200B-\u200D\u2060\uFEFF\u00AD]/g, " ")
    .replace(/[\u0000-\u001F\u007F]/g, " ");
const norm = (s) => stripWeird(s).replace(/\s+/g, " ").trim();
const upper = (s) => norm(s).toUpperCase();
const isEmpty = (v) => norm(v) === "";

/* normalize header keys once */
function normalizeHeaders(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) out[norm(k)] = v;
  return out;
}
function get(row, primary, aliases = []) {
  const keys = [primary, ...aliases].map(norm);
  for (const k of keys) if (k in row) return row[k];
  return undefined;
}

/* ---------------------- type helpers ------------------------ */
const TYPE_MAP = {
  LECT: "LECT",
  LAB: "LAB",
  TUT: "TUTR", // normalize "TUT" -> "TUTR"
  TUTR: "TUTR",
};
const cleanType = (v) => {
  const raw = upper(v).replace(/[^A-Z]/g, "");
  return TYPE_MAP[raw] || raw; // pass through BLEN, ONLN, SEMR, etc.
};
const cleanOfferingNumber = (v) => norm(v).replace(/\D+/g, "");
const cleanNotes = (v) => norm(v);
const cleanInstructor = (v) => norm(v);
const cleanRoom = (v) => norm(v);
const cleanCampus = (v) => norm(v);
const cleanDay = (v) => upper(v);
function cleanTime(v) {
  const t = norm(v);
  const m = t.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return t;
  const hh = String(parseInt(m[1], 10)).padStart(2, "0");
  return `${hh}:${m[2]}`;
}

/* ---------------------- term ------------------------ */
const pickTerm = (raw) => {
  const t = upper(raw).split(/\s+/)[0];
  return ["F", "W", "S", "Y", "LB", "WL"].includes(t) ? t : "";
};

/* ------------------ row detection ------------------- */
const looksLikePrimaryOfferingHeader = (row) => {
  // Full header: Course ID has number/credits/section pattern
  const id = norm(get(row, "Course ID", ["CourseId", "Course Id"]));
  const type = cleanType(get(row, "Type"));
  return (
    !!id &&
    /(\d{3,4})\D+(\d\.\d{2})\D+([A-Z]+)/.test(id) &&
    type.length > 0
  );
};

// Secondary header: NO Course ID, but a Type + Meet/Cat.No. number present (typical for LAB/TUTR lines)
const looksLikeSecondaryOfferingHeader = (row) => {
  const id = norm(get(row, "Course ID", ["CourseId", "Course Id"]));
  if (id && /(\d{3,4})\D+(\d\.\d{2})\D+([A-Z]+)/.test(id)) return false; // that's primary
  const type = cleanType(get(row, "Type"));
  if (!type) return false;
  const num =
    cleanOfferingNumber(get(row, "Meet")) ||
    cleanOfferingNumber(get(row, "Cat.No.", ["Cat No.", "CatNo"]));
  return !!type && !!num;
};

const parseCourseIdCell = (c3) => {
  const s = norm(c3);
  const m = s.match(/(?<num>\d{3,4})\D+(?<cred>\d\.\d{2})\D+(?<sect>[A-Z]+)/);
  return m
    ? { number: m.groups.num, credits: m.groups.cred, section: m.groups.sect }
    : null;
};

const isMeetingRow = (row) => {
  const day = cleanDay(get(row, "Day"));
  const time = cleanTime(get(row, "Time"));
  return /^(M|T|W|R|F)$/.test(day) && /^\d{1,2}:\d{2}$/.test(time);
};

const isCancelled = (row) => {
  const joined = [
    get(row, "Notes/Additional Fees"),
    get(row, "Cat.No.", ["Cat No.", "CatNo"]),
    get(row, "Room"),
    get(row, "Instructors"),
    get(row, "Type"),
  ]
    .map((x) => stripWeird(x))
    .join(" ");
  return /cancelled/i.test(joined);
};

/* ----------------- structure helpers ---------------- */
function getOrCreateSection(course, term, letter) {
  let s = course.sections.find((x) => x.term === term && x.letter === letter);
  if (!s) {
    s = { term, letter, instructor: "", offerings: [] };
    course.sections.push(s);
  }
  return s;
}
function findOffering(section, type, number) {
  const nType = cleanType(type);
  const nNumber = cleanOfferingNumber(number);
  return section.offerings.find((x) => x.type === nType && x.number === nNumber);
}
function createOffering(section, type, number, notes) {
  const nType = cleanType(type);
  const nNumber = cleanOfferingNumber(number);
  const off = {
    type: nType,
    number: nNumber || "",
    notes: cleanNotes(notes),
    meetings: [],
  };
  section.offerings.push(off);
  return off;
}

/* -------------------- main parser -------------------- */
function parseOneCsvFile(fullPath, courseMap) {
  const raw = fs.readFileSync(fullPath, "latin1");
  let rows = parse(raw, {
    columns: true,
    relax_column_count: true,
    skip_empty_lines: true,
  });
  rows = rows.map(normalizeHeaders);

  let curFaculty = "";
  let curDept = "";
  let curTerm = "";
  let curCourseName = "";

  let curNumber = "";
  let curCredits = "";
  let curSectionLetter = "";

  // "currentOffering" is the offering (LECT/LAB/TUTR/…) we last opened
  let currentOffering = null;

  for (const row0 of rows) {
    if (Object.values(row0).every((v) => isEmpty(v))) continue;

    const row = Object.fromEntries(Object.entries(row0).map(([k, v]) => [k, stripWeird(v)]));

    const fac = norm(get(row, "Fac"));
    const dept = norm(get(row, "Dept"));
    const termRaw = norm(get(row, "Term"));
    if (!isEmpty(fac) && !isEmpty(dept)) {
      curFaculty = fac;
      curDept = dept;
    }
    if (!isEmpty(termRaw)) {
      curTerm = pickTerm(termRaw);
    }

    // Title rows: Course name lives in "Course ID" when it does NOT match the numeric pattern
    const idCell = norm(get(row, "Course ID"));
    if (!isEmpty(idCell) && !/(\d{3,4})\D+\d\.\d{2}\D+[A-Z]+/.test(idCell)) {
      curCourseName = idCell;
      continue;
    }
    if (!isEmpty(get(row, "Course Name"))) {
      curCourseName = norm(get(row, "Course Name"));
    }

    /* -------- primary offering header (has Course ID pattern) -------- */
    if (looksLikePrimaryOfferingHeader(row)) {
      // Skip cancelled offerings entirely
      if (isCancelled(row)) {
        currentOffering = null;
        continue;
      }

      const parsedId = parseCourseIdCell(get(row, "Course ID"));
      if (!parsedId || isEmpty(curFaculty) || isEmpty(curDept)) continue;

      curNumber = parsedId.number;
      curCredits = parsedId.credits;
      curSectionLetter = parsedId.section;

      const type = cleanType(get(row, "Type"));
      const number =
        cleanOfferingNumber(get(row, "Meet")) ||
        cleanOfferingNumber(get(row, "Cat.No.", ["Cat No.", "CatNo"]));
      const notes = cleanNotes(get(row, "Notes/Additional Fees"));
      const headerInstructor = cleanInstructor(get(row, "Instructors"));

      const courseKey = `${curFaculty}/${curDept} ${curNumber}`;
      if (!courseMap.has(courseKey)) {
        courseMap.set(courseKey, {
          faculty: curFaculty,
          subject: curDept,
          number: curNumber,
          credits: curCredits,
          name: curCourseName || "",
          sections: [],
        });
      } else {
        const c = courseMap.get(courseKey);
        if (!c.name && curCourseName) c.name = curCourseName;
        if (!c.credits && curCredits) c.credits = curCredits;
      }
      const course = courseMap.get(courseKey);
      if (!curTerm) continue;

      const section = getOrCreateSection(course, curTerm, curSectionLetter);
      if (!section.instructor && headerInstructor) section.instructor = headerInstructor;

      // Open (or get) this offering in the flat list
      currentOffering = findOffering(section, type, number) || createOffering(section, type, number, notes);

      // If header row includes meeting info, attach it
      if (isMeetingRow(row)) {
        const day = cleanDay(get(row, "Day"));
        const start = cleanTime(get(row, "Time"));
        const room = cleanRoom(get(row, "Room"));
        const campus = cleanCampus(get(row, "Campus"));
        const dur = Number(get(row, "Dur")) || null;
        currentOffering.meetings.push({
          day,
          startTime: start,
          duration: dur,
          campus,
          room,
        });
      }
      continue;
    }

    /* -------- secondary offering header (Type + Meet/Cat.No., no Course ID) -------- */
    if (looksLikeSecondaryOfferingHeader(row)) {
      // Skip cancelled offerings entirely
      if (isCancelled(row)) {
        currentOffering = null;
        continue;
      }

      if (!curFaculty || !curDept || !curNumber || !curSectionLetter || !curTerm) {
        // not enough context to anchor this lab/tutorial/etc
        continue;
      }

      const type = cleanType(get(row, "Type"));
      const number =
        cleanOfferingNumber(get(row, "Meet")) ||
        cleanOfferingNumber(get(row, "Cat.No.", ["Cat No.", "CatNo"]));
      const notes = cleanNotes(get(row, "Notes/Additional Fees"));
      const headerInstructor = cleanInstructor(get(row, "Instructors"));

      const courseKey = `${curFaculty}/${curDept} ${curNumber}`;
      const course = courseMap.get(courseKey);
      if (!course) continue;

      const section = getOrCreateSection(course, curTerm, curSectionLetter);
      if (!section.instructor && headerInstructor) section.instructor = headerInstructor;

      // Open (or get) this offering as its own entry
      currentOffering = findOffering(section, type, number) || createOffering(section, type, number, notes);

      // If this header includes meeting info on the same line, attach it
      if (isMeetingRow(row)) {
        const day = cleanDay(get(row, "Day"));
        const start = cleanTime(get(row, "Time"));
        const room = cleanRoom(get(row, "Room"));
        const campus = cleanCampus(get(row, "Campus"));
        const dur = Number(get(row, "Dur")) || null;
        currentOffering.meetings.push({
          day,
          startTime: start,
          duration: dur,
          campus,
          room,
        });
      }
      continue;
    }

    /* -------- meeting-only row -------- */
    if (isMeetingRow(row)) {
      if (!currentOffering) continue; // must follow an offering header

      const rowInstructor = cleanInstructor(get(row, "Instructors"));

      const courseKey = `${curFaculty}/${curDept} ${curNumber}`;
      const course = courseMap.get(courseKey);
      if (!course) continue;
      const section = getOrCreateSection(course, curTerm, curSectionLetter);
      if (rowInstructor && !section.instructor) section.instructor = rowInstructor;

      const day = cleanDay(get(row, "Day"));
      const start = cleanTime(get(row, "Time"));
      const room = cleanRoom(get(row, "Room"));
      const campus = cleanCampus(get(row, "Campus"));
      const dur = Number(get(row, "Dur")) || null;

      currentOffering.meetings.push({
        day,
        startTime: start,
        duration: dur,
        campus,
        room,
      });
      continue;
    }

    // ignore any explicitly cancelled row that didn't match earlier guards
    if (isCancelled(row)) {
      currentOffering = null;
      continue;
    }
  }

  // ---- prune: remove offerings with no meetings (covers cancelled/empty ones of ANY type) ----
  for (const course of courseMap.values()) {
    for (const section of course.sections) {
      section.offerings = section.offerings.filter((o) => (o.meetings || []).length > 0);
    }
  }
}

/* --------------------- runner ---------------------- */
function main() {
  if (!fs.existsSync(CATALOG_DIR)) {
    console.error("catalog/ folder not found");
    process.exit(1);
  }

  const files = fs
    .readdirSync(CATALOG_DIR)
    .filter((f) => f.toLowerCase().endsWith(".csv"))
    .map((f) => path.join(CATALOG_DIR, f));

  if (files.length === 0) {
    console.error("No CSV files found in catalog/");
    process.exit(1);
  }

  const courseMap = new Map();
  for (const file of files) {
    console.log("Parsing", path.basename(file));
    parseOneCsvFile(file, courseMap);
  }

  const catalog = Array.from(courseMap.values()).map((c) => ({
    faculty: c.faculty,
    subject: c.subject,
    number: c.number,
    credits: c.credits,
    name: c.name || "",
    code: `${c.faculty}${c.subject}${c.number}${c.credits}`.replace(/\s+/g, ""),
    sections: c.sections,
  }));

  fs.writeFileSync(OUT, JSON.stringify(catalog, null, 2), "utf-8");
  console.log(`✅ Wrote ${catalog.length} courses to ${OUT}`);
}

main();
