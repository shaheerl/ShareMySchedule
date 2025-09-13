// scripts/seedDummyData.js
import { PrismaClient, Term } from "@prisma/client";
import bcrypt from "bcrypt";
import fs from "fs";
import path from "path";

const prisma = new PrismaClient();

// ------- config you can tweak -------
const TOTAL_USERS = 200;
const COURSES_PER_TERM = 5; // "full load" per term
const CATALOG_PATH = path.join(process.cwd(), "catalog", "catalog.json");
const PASSWORD = "abc"; // seed password for all dummy users
// -----------------------------------

/**
 * Catalog expectation (lightweight):
 *   An array of objects with at least: { subject: "EECS", number: "3482", name: "..." }
 * We'll build courseCode as `${subject} ${number}`.
 */
function loadCatalog() {
  const raw = fs.readFileSync(CATALOG_PATH, "utf-8");
  const arr = JSON.parse(raw);
  // normalize minimal structure & filter obvious junk
  const items = arr
    .filter((c) => c && c.subject && c.number)
    .map((c) => ({
      subject: String(c.subject).toUpperCase().trim(),
      number: String(c.number).trim(),
      name: c.name || "",
    }));

  const bySubject = new Map();
  for (const c of items) {
    const list = bySubject.get(c.subject) || [];
    list.push(c);
    bySubject.set(c.subject, list);
  }

  const all = items;
  const eecsOnly = items.filter((c) => c.subject === "EECS");
  const nonEecsOnly = items.filter((c) => c.subject !== "EECS");

  if (all.length === 0) throw new Error("Catalog appears empty.");
  if (eecsOnly.length === 0) console.warn("[seed] No EECS courses found in catalog.");
  if (nonEecsOnly.length === 0) console.warn("[seed] No NON-EECS courses found in catalog.");

  return { all, eecsOnly, nonEecsOnly, bySubject };
}

// --- deterministic-ish fake names ---
const FIRST_PARTS = [
  "Ari", "Rin", "Tae", "Milo", "Zae", "Ira", "Noa", "Ava", "Kai", "Eli",
  "Sora", "Nika", "Ren", "Jae", "Lumi", "Asha", "Nora", "Evan", "Zara", "Ivy",
];
const LAST_PARTS = [
  "Stone", "Vale", "River", "Woods", "Crescent", "Haven", "Blake", "Shore",
  "North", "Ash", "Khan", "Singh", "Ali", "Rahman", "Kaur", "Green", "Miller",
  "Brown", "Lopez", "Patel",
];

function uniqueName(i) {
  const f = FIRST_PARTS[i % FIRST_PARTS.length];
  const l = LAST_PARTS[(i * 7) % LAST_PARTS.length];
  return `${f} ${l}${Math.floor(i / (FIRST_PARTS.length * LAST_PARTS.length)) || ""}`.trim();
}

const emailFor = (n) => `seed${String(n).padStart(3, "0")}@my.yorku.ca`;

// --- meeting/time generation helpers ---
const LECT_DAY_CHOICES = ["MWF", "TR", "MW", "TR", "MWF", "TR"];
const LECT_STARTS = ["08:30", "10:00", "11:30", "13:00", "14:30", "16:00", "17:30"];
const ROOMS = ["CLH 110", "LAS 1001", "LAS 1002", "ACW 102", "CB 120", "LSB 105", "LSB 106", "DB 001"];
const SECTIONS = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"].map((c) => c);

function pickOne(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function lectDuration(days) {
  if (days === "MWF") return 50;
  return 80;
}

function makeLectureRow(userId, term, courseCode) {
  const days = pickOne(LECT_DAY_CHOICES);
  const startTime = pickOne(LECT_STARTS);
  const duration = lectDuration(days);
  const room = pickOne(ROOMS);
  const section = pickOne(SECTIONS);
  return {
    userId,
    term,
    courseCode,
    section,
    type: "LECT",
    days,
    startTime,
    duration,
    room,
  };
}

function maybeLabRow(userId, term, courseCode) {
  const chance = courseCode.startsWith("EECS") ? 0.55 : 0.35;
  if (Math.random() > chance) return null;

  const labDays = pickOne(["M", "T", "W", "R", "F"]);
  const labStart = pickOne(["09:30", "11:30", "13:30", "15:30", "17:30"]);
  const room = pickOne(ROOMS);
  const section = String(Math.floor(Math.random() * 20) + 1).padStart(2, "0");
  return {
    userId,
    term,
    courseCode,
    section,
    type: "LAB",
    days: labDays,
    startTime: labStart,
    duration: 110,
    room,
  };
}

// --- degree/major/year ---
const DEGREES = ["BSc", "HBSc", "BA", "BEng", "MSc", "MA", "PhD"];
const MAJORS = [
  "Computer Science", "Software Engineering", "Information Technology", "Psychology",
  "Mathematics", "Statistics", "Biology", "Chemistry", "Economics", "Business Administration",
];
function randomProfile() {
  return {
    degree: pickOne(DEGREES),
    major: pickOne(MAJORS),
    yearOfStudy: String(Math.floor(Math.random() * 5) + 1), // "1".."5"
  };
}

// --- EECS quotas ---
function eecsTargetForUser(i) {
  const r = Math.random();
  if (r < 0.10) return 5;         // 10% → 5 EECS
  if (r < 0.30) return 3;         // 20% → 3 EECS
  if (r < 0.90) return 1 + Math.floor(Math.random() * 2); // 60% → 1–2 EECS
  return 0;                       // 10% → 0 EECS
}

function chooseCourseCodes(catalog, wantEecsCount, totalNeeded) {
  const chosen = new Set();

  const eecs = [...catalog.eecsOnly];
  while (wantEecsCount > 0 && eecs.length) {
    const idx = Math.floor(Math.random() * eecs.length);
    const c = eecs.splice(idx, 1)[0];
    chosen.add(`${c.subject} ${c.number}`);
    wantEecsCount--;
  }

  const pool = [...catalog.nonEecsOnly];
  while (chosen.size < totalNeeded && pool.length) {
    const idx = Math.floor(Math.random() * pool.length);
    const c = pool.splice(idx, 1)[0];
    chosen.add(`${c.subject} ${c.number}`);
  }

  const backup = [...catalog.all];
  while (chosen.size < totalNeeded && backup.length) {
    const idx = Math.floor(Math.random() * backup.length);
    const c = backup.splice(idx, 1)[0];
    chosen.add(`${c.subject} ${c.number}`);
  }

  return Array.from(chosen);
}

async function upsertUser(i) {
  const email = emailFor(i);
  const name = uniqueName(i - 1);
  const { degree, major, yearOfStudy } = randomProfile();
  const passwordHash = await bcrypt.hash(PASSWORD, 10);

  // give each user a preferred platform + handle
  const platform = pickOne(["DISCORD", "INSTAGRAM"]);
  const discordHandle =
    platform === "DISCORD" ? `${name.split(" ")[0]}#${1000 + i}` : null;
  const instagramHandle =
    platform === "INSTAGRAM" ? name.toLowerCase().replace(" ", "_") : null;

  const user = await prisma.user.upsert({
    where: { email },
    update: {
      name,
      degree,
      major,
      yearOfStudy,
      university: "York University",
      emailVerifiedAt: new Date(),
      preferredPlatform: platform,
      discordHandle,
      instagramHandle,
    },
    create: {
      email,
      name,
      passwordHash,
      degree,
      major,
      yearOfStudy,
      university: "York University",
      emailVerifiedAt: new Date(),
      preferredPlatform: platform,
      discordHandle,
      instagramHandle,
    },
    select: { id: true, email: true },
  });

  return user;
}

async function createSchedulesForUser(userId, catalog, i) {
  const totalNeeded = COURSES_PER_TERM * 2;
  const wantEECS = eecsTargetForUser(i);
  const codes = chooseCourseCodes(catalog, wantEECS, totalNeeded);

  const shuffled = codes.sort(() => Math.random() - 0.5);
  const fallCodes = shuffled.slice(0, COURSES_PER_TERM);
  const winterCodes = shuffled.slice(COURSES_PER_TERM, COURSES_PER_TERM * 2);

  const rows = [];

  for (const code of fallCodes) {
    rows.push(makeLectureRow(userId, Term.F, code));
    const lab = maybeLabRow(userId, Term.F, code);
    if (lab) rows.push(lab);
  }
  for (const code of winterCodes) {
    rows.push(makeLectureRow(userId, Term.W, code));
    const lab = maybeLabRow(userId, Term.W, code);
    if (lab) rows.push(lab);
  }

  await prisma.schedule.deleteMany({ where: { userId } });
  if (rows.length) await prisma.schedule.createMany({ data: rows });

  const eecsCount = fallCodes.concat(winterCodes).filter((c) => c.startsWith("EECS")).length;
  return { totalCourses: fallCodes.length + winterCodes.length, eecsCount, totalRows: rows.length };
}

async function main() {
  const catalog = loadCatalog();
  console.log(`[seed] Catalog loaded: ${catalog.all.length} courses (${catalog.eecsOnly.length} EECS).`);

  const results = [];
  for (let i = 1; i <= TOTAL_USERS; i++) {
    const u = await upsertUser(i);
    const stats = await createSchedulesForUser(u.id, catalog, i);
    results.push({
      email: u.email,
      courses: stats.totalCourses,
      eecs: stats.eecsCount,
      rows: stats.totalRows,
    });
    if (i % 20 === 0) console.log(`[seed] Created ${i}/${TOTAL_USERS}`);
  }

  console.log("\nDone! Summary (first 15 shown):");
  console.table(results.slice(0, 15));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
