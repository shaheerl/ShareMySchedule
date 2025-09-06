// backend/index.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import rateLimit from "express-rate-limit";
import { PrismaClient } from "@prisma/client";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import crypto from "crypto";
import multer from "multer";
import path from "path";
import fs from "fs";
import fetch from "node-fetch";
import { Term } from "@prisma/client";

dotenv.config();

const prisma = new PrismaClient();
const app = express();

console.log("Prisma Term enum values:", Term);


const APP_ORIGIN = process.env.APP_BASE_URL || "http://localhost:3000";

app.use(cors({ origin: APP_ORIGIN, credentials: true }));
app.use(express.json());
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

const toEnum = (t) => {
  if (!t) return null;
  const key = String(t).trim().toUpperCase();
  if (key === 'F') return Term.F;
  if (key === 'W') return Term.W;
  if (key === 'S') return Term.S;
  return null;
};

const PORT = process.env.PORT || 5000;

// ---------- helpers ----------
const signAccess = (payload) =>
  jwt.sign(payload, process.env.JWT_ACCESS_SECRET, { expiresIn: "15m" });

const signRefresh = (payload) =>
  jwt.sign(payload, process.env.JWT_REFRESH_SECRET, { expiresIn: "30d" });

const mustYorkU = (email) =>
  typeof email === "string" && email.toLowerCase().endsWith("@my.yorku.ca");

const auth = (req, res, next) => {
  const hdr = req.headers.authorization || "";
  const token = hdr.startsWith("Bearer ") ? hdr.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Unauthorized" });
  try {
    const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
};

const catalog = JSON.parse(
  fs.readFileSync("catalog/catalog.json", "utf-8")
);

const uploadDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
const upload = multer({ dest: uploadDir });

app.get("/schedules", auth, async (req, res) => {
  const schedules = await prisma.schedule.findMany({
    where: { userId: req.user.sub },
    orderBy: [{ term: "asc" }, { startTime: "asc" }],
  });
  res.json({ schedules });
});

app.post("/schedules/:id/delete", auth, async (req, res) => {
  const { id } = req.params;
  const found = await prisma.schedule.findUnique({ where: { id } });
  if (!found || found.userId !== req.user.sub) {
    return res.status(404).json({ error: "Not found" });
  }
  await prisma.schedule.delete({ where: { id } });
  return res.json({ ok: true });
});


app.get("/courses/search", (req, res) => {
  const q = (req.query.q || "").toLowerCase();
  const matches = catalog.filter(
    (c) =>
      c.name.toLowerCase().includes(q) ||
      `${c.subject} ${c.number}`.toLowerCase().includes(q)
  );
  res.json({ courses: matches.slice(0, 10) });
});

app.get("/courses/:subject/:number", (req, res) => {
  const { subject, number } = req.params;
  const course = catalog.find(
    (c) => c.subject === subject.toUpperCase() && c.number === number
  );
  if (!course) return res.status(404).json({ error: "Course not found" });
  res.json(course);
});

app.post("/schedules/bulk", auth, async (req, res) => {
  try {
    const { items } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "No items" });
    }

    // Validate + map terms first
    const normalized = items.map((i, idx) => {
      const termEnum = toEnum(i.term);
      if (!termEnum) {
        throw new Error(`Item ${idx + 1}: invalid term '${i.term}', expected F/W/S`);
      }
      if (!i.courseCode || typeof i.courseCode !== "string") {
        throw new Error(`Item ${idx + 1}: missing/invalid courseCode`);
      }
      return {
        userId: req.user.sub,
        term: termEnum,
        courseCode: i.courseCode.trim(),
        section: i.section ?? "",
        type: i.type ?? "",
        days: i.days ?? "",
        startTime: i.startTime ?? "",
        duration:
          i.duration === null || i.duration === undefined
            ? null
            : Number(i.duration),
        room: i.room ?? null,
      };
    });

    // Group by (term, courseCode)
    const groups = new Map(); // key = `${term}|${courseCode}`
    for (const row of normalized) {
      const key = `${row.term}|${row.courseCode}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    }

    // Build a transaction: delete per group, then insert per group
    const ops = [];
    for (const [key, rows] of groups.entries()) {
      const [term, courseCode] = key.split("|");
      ops.push(
        prisma.schedule.deleteMany({
          where: {
            userId: req.user.sub,
            term: term,             // already enum value
            courseCode: courseCode, // same course only
          },
        })
      );
      ops.push(prisma.schedule.createMany({ data: rows }));
    }

    const results = await prisma.$transaction(ops);

    // results contains counts interleaved: [deleted, inserted, deleted, inserted, ...]
    const deleted = results
      .filter(r => typeof r.count === "number")
      .filter((_, idx) => idx % 2 === 0) // even indices = deleteMany
      .reduce((sum, r) => sum + r.count, 0);

    const inserted = results
      .filter(r => typeof r.count === "number")
      .filter((_, idx) => idx % 2 === 1) // odd indices = createMany
      .reduce((sum, r) => sum + r.count, 0);

    return res.json({
      ok: true,
      groups: groups.size,
      deleted,
      inserted,
    });
  } catch (err) {
    console.error("bulk save error:", err);
    return res.status(400).json({ error: err.message || "Failed to save schedule" });
  }
});


app.put("/schedules/:id", auth, async (req, res) => {
  const { id } = req.params;
  const found = await prisma.schedule.findUnique({ where: { id } });
  if (!found || found.userId !== req.user.sub) return res.status(404).json({ error: "Not found" });

  const { courseCode, section, type, days, startTime, duration, room } = req.body;
  const updated = await prisma.schedule.update({
    where: { id },
    data: { courseCode, section, type, days, startTime, duration, room }
  });
  res.json({ ok: true, schedule: updated });
});




// ---------- routes ----------
app.get("/", (_, res) => res.send("ShareMySchedule backend is running 🚀"));

// Register (firstName, lastName, email, password)
app.post("/auth/register", async (req, res) => {
  try {
    const { firstName, lastName, email, password } = req.body;
    if (!email || !password || !firstName || !lastName)
      return res.status(400).json({ error: "Missing fields" });

    if (!mustYorkU(email))
      return res
        .status(400)
        .json({ error: "Please use your @my.yorku.ca email address." });

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return res.status(409).json({ error: "Email already registered" });

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        name: `${firstName} ${lastName}`.trim(),
        university: "York University",
      },
    });

    // create email verification token (24h)
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await prisma.emailVerificationToken.create({
      data: { userId: user.id, token, expiresAt },
    });

    // DEV: log verification link; prod: send via email provider
    const verifyUrl = `${process.env.API_BASE_URL}/auth/verify-email?token=${token}`;
    console.log("Verify your email:", verifyUrl);

    return res.json({
      ok: true,
      message: "Registered. Check your email for a verification link.",
      devVerifyUrl: verifyUrl, // helpful while developing
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Server error" });
  }
});

// Verify email
app.get("/auth/verify-email", async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) return res.status(400).send("Missing token");

    const rec = await prisma.emailVerificationToken.findUnique({ where: { token } });
    if (!rec || rec.expiresAt < new Date())
      return res.status(400).send("Invalid or expired token");

    await prisma.user.update({
      where: { id: rec.userId },
      data: { emailVerifiedAt: new Date() },
    });
    await prisma.emailVerificationToken.delete({ where: { token } });

    return res.send("Email verified. You can close this tab and sign in.");
  } catch {
    return res.status(500).send("Server error");
  }
});

// Login (username = email)
app.post("/auth/login", async (req, res) => {
  try {
    const { username, password } = req.body; // "username" to match your UI label
    const email = username;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(401).json({ error: "Invalid credentials" });

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: "Invalid credentials" });

    if (!user.emailVerifiedAt)
      return res.status(403).json({ error: "Please verify your email first." });

    const accessToken = signAccess({ sub: user.id, email: user.email });
    const refreshToken = signRefresh({ sub: user.id });

    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await prisma.session.create({
      data: { userId: user.id, refreshToken, expiresAt },
    });

    return res.json({ accessToken, refreshToken });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Server error" });
  }
});

// Refresh access token
app.post("/auth/refresh", async (req, res) => {
  const { refreshToken } = req.body || {};
  if (!refreshToken) return res.status(400).json({ error: "Missing token" });
  try {
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    const session = await prisma.session.findUnique({ where: { refreshToken } });
    if (!session || session.expiresAt < new Date())
      return res.status(401).json({ error: "Invalid session" });

    const accessToken = signAccess({ sub: decoded.sub });
    return res.json({ accessToken });
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
});

// Who am I (protected)
app.get("/auth/me", auth, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user.sub },
    select: { id: true, name: true, email: true, university: true, emailVerifiedAt: true },
  });
  return res.json({ user });
});

app.put("/account", auth, async (req, res) => {
  try {
    const { firstName, lastName, degree, major, yearOfStudy } = req.body;
    const user = await prisma.user.update({
      where: { id: req.user.sub },
      data: {
        name: `${firstName} ${lastName}`.trim(),
        degree,
        major,
        yearOfStudy,
      },
    });
    return res.json({ ok: true, user });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Could not update account" });
  }
});

app.post("/account/change-password", auth, async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    const user = await prisma.user.findUnique({ where: { id: req.user.sub } });
    if (!user) return res.status(404).json({ error: "User not found" });

    const valid = await bcrypt.compare(oldPassword, user.passwordHash);
    if (!valid) return res.status(400).json({ error: "Old password incorrect" });

    const newHash = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: newHash },
    });

    return res.json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Could not change password" });
  }
});

// Logout
app.post("/auth/logout", async (req, res) => {
  const { refreshToken } = req.body || {};
  if (refreshToken) {
    await prisma.session.deleteMany({ where: { refreshToken } });
  }
  return res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

// Search courses by code or name
app.get("/courses/search", async (req, res) => {
  const q = req.query.q || "";
  const courses = await prisma.course.findMany({
    where: {
      OR: [
        { code: { contains: q, mode: "insensitive" } },
        { title: { contains: q, mode: "insensitive" } },
      ],
    },
    take: 10,
  });
  res.json({ courses });
});

// Get course details (sections + meetings)
app.get("/courses/:id", async (req, res) => {
  const course = await prisma.course.findUnique({
    where: { id: req.params.id },
    include: { sessions: { include: { meetings: true } } },
  });
  if (!course) return res.status(404).json({ error: "Not found" });
  res.json({ course });
});

// GET /classmates?term=F|W|S
app.get("/classmates", auth, async (req, res) => {
  try {
    const rawTerm = (req.query.term || "").toUpperCase();
    if (!["F", "W", "S"].includes(rawTerm)) {
      return res.status(400).json({ error: "term must be F, W, or S" });
    }

    // Map to enum
    const termEnum = rawTerm === "F" ? Term.F : rawTerm === "W" ? Term.W : Term.S;

    // Get all schedules for the term, with user emails
    const rows = await prisma.schedule.findMany({
      where: { term: termEnum },
      include: { user: { select: { id: true, email: true } } },
    });

    // Build maps per user
    const perUser = new Map(); // userId -> { email, courses: Set(courseCode), lecs: Map(courseCode -> section), labs: Map(courseCode -> Set(labNumber)) }
    for (const r of rows) {
      const uid = r.userId;
      if (!perUser.has(uid)) {
        perUser.set(uid, {
          email: r.user.email,
          courses: new Set(),
          lecs: new Map(),
          labs: new Map(),
        });
      }
      const u = perUser.get(uid);

      // Distinct course list by courseCode (based primarily on LECT)
      if (r.type === "LECT") {
        u.courses.add(r.courseCode);
        u.lecs.set(r.courseCode, r.section || "");
      }

      // Track labs per course
      if (r.type === "LAB") {
        if (!u.labs.has(r.courseCode)) u.labs.set(r.courseCode, new Set());
        // Use the lab "number" (comes in via `section` in your Schedule model)
        if (r.section) u.labs.get(r.courseCode).add(r.section);
      }

      // If a course only has LAB (edge-case), still record the course
      if (!u.courses.has(r.courseCode) && (r.type !== "LECT")) {
        u.courses.add(r.courseCode);
      }
    }

    const me = perUser.get(req.user.sub);
    if (!me) return res.json({ term: rawTerm, buckets: {}, detailed: [] });

    // Compare others to me
    const myCourses = Array.from(me.courses);
    const myCourseSet = new Set(myCourses);
    const myLabs = me.labs;           // Map(courseCode -> Set(labNumbers))
    const myLecs = me.lecs;           // Map(courseCode -> section)

    const detailed = [];

    for (const [otherId, other] of perUser.entries()) {
      if (otherId === req.user.sub) continue;

      const otherCourses = Array.from(other.courses);
      const otherCourseSet = new Set(otherCourses);

      // Shared courses (courseCode match only)
      const sharedCourseCodes = myCourses.filter(c => otherCourseSet.has(c));
      const sharedCourseCount = sharedCourseCodes.length;

      if (sharedCourseCount === 0) continue; // skip non-matches

      // Same section count (LECT section match)
      let sameSectionCount = 0;
      for (const c of sharedCourseCodes) {
        const mySec = myLecs.get(c) || "";
        const oSec = other.lecs.get(c) || "";
        if (mySec && oSec && mySec === oSec) sameSectionCount++;
      }

      // Lab overlaps per shared course
      let labMatchCount = 0;
      const labMatchesByCourse = {};
      for (const c of sharedCourseCodes) {
        const mine = myLabs.get(c) || new Set();
        const theirs = other.labs.get(c) || new Set();
        if (mine.size && theirs.size) {
          const overlap = Array.from(mine).filter(x => theirs.has(x));
          if (overlap.length > 0) {
            labMatchCount += overlap.length;
            labMatchesByCourse[c] = overlap;
          }
        }
      }

      // Exact course set match (ignoring labs)
      const allCoursesMatch =
        myCourses.length === otherCourses.length &&
        myCourses.every((c) => otherCourseSet.has(c));

      // All labs match (for courses we both take)
      let allLabsMatch = true;
      for (const c of sharedCourseCodes) {
        const mine = myLabs.get(c) || new Set();
        const theirs = other.labs.get(c) || new Set();
        // consider "all labs match" only if both have labs for the course
        if (mine.size || theirs.size) {
          if (mine.size !== theirs.size) { allLabsMatch = false; break; }
          for (const lab of mine) if (!theirs.has(lab)) { allLabsMatch = false; break; }
          if (!allLabsMatch) break;
        }
      }

      detailed.push({
        email: other.email,
        sharedCourseCount,
        sharedCourseCodes,
        sameSectionCount,
        labMatchCount,
        labMatchesByCourse,
        allCoursesMatch,
        allLabsMatch,
      });
    }

    // Buckets for 1,2,3,... courses and exact matches
    const byCourseCount = {};
    for (const d of detailed) {
      const k = String(d.sharedCourseCount);
      if (!byCourseCount[k]) byCourseCount[k] = [];
      byCourseCount[k].push(d.email);
    }

    const exactCourses = detailed
      .filter(d => d.allCoursesMatch)
      .map(d => d.email);

    res.json({
      term: rawTerm,
      myCourses,
      buckets: { byCourseCount, exactCourses },
      detailed, // keep for richer UI
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to compute classmates" });
  }
});

