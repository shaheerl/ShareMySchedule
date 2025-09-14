import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import rateLimit from "express-rate-limit";
import { PrismaClient, Term } from "@prisma/client";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import crypto from "crypto";
import multer from "multer";
import path from "path";
import fs from "fs";
import nodemailer from "nodemailer";
import { v4 as uuidv4 } from "uuid";

// Load env
dotenv.config();

// --- Instantiate ---
const prisma = new PrismaClient();
const app = express();
const PORT = process.env.PORT || 5000;
const APP_ORIGIN = process.env.APP_BASE_URL || "http://localhost:3000";

// --- CORS ---
const allowedOrigins = [
  "http://localhost:3000",
  "https://sharemyschedule.ca",
  "https://www.sharemyschedule.ca",
];

app.use(
  cors({
    origin(origin, cb) {
      if (!origin || allowedOrigins.includes(origin)) {
        return cb(null, true);
      }
      console.warn(`[CORS] Blocked origin: ${origin}`);
      return cb(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);

app.use(express.json());

// --- Rate limiting ---
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

// --- Helpers ---
const signAccess = (payload) =>
  jwt.sign(payload, process.env.JWT_ACCESS_SECRET, { expiresIn: "15m" });
const signRefresh = (payload) =>
  jwt.sign(payload, process.env.JWT_REFRESH_SECRET, { expiresIn: "30d" });
const mustYorkU = (email) =>
  typeof email === "string" && email.toLowerCase().endsWith("@my.yorku.ca");

const auth = (req, res, next) => {
  const hdr = req.headers.authorization || "";
  const token = hdr.startsWith("Bearer ") ? hdr.slice(7) : null;
  if (!token) {
    console.warn("[AUTH][GET/POST/etc] Missing Bearer token");
    return res.status(401).json({ error: "Unauthorized" });
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
    req.user = decoded;
    next();
  } catch (e) {
    console.warn("[AUTH] Invalid token:", e.message);
    return res.status(401).json({ error: "Invalid token" });
  }
};

const toEnum = (t) => {
  if (!t) return null;
  const key = String(t).trim().toUpperCase();
  if (key === "F") return Term.F;
  if (key === "W") return Term.W;
  if (key === "S") return Term.S;
  return null;
};

// --- Mailer (Gmail app password) ---
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

async function sendVerificationEmail(to, token) {
  const verifyUrl = `${process.env.APP_BASE_URL}/verify?token=${token}`;
  console.log(`[MAIL] Sending verification email → ${to}`);
  await transporter.sendMail({
    from: `"ShareMySchedule" <${process.env.EMAIL_FROM}>`,
    to,
    subject: "Verify your ShareMySchedule account",
    text: `Click the link to verify: ${verifyUrl}`,
    html: `<p>Click below to verify your account:</p>
           <p><a href="${verifyUrl}">${verifyUrl}</a></p>
           <p>This link expires in 24 hours.</p>`,
  });
  console.log("[MAIL] Email dispatched OK");
}

// --- File catalog (for one of your /courses/search endpoints) ---
const catalog = JSON.parse(
  fs.readFileSync("catalog/catalog.json", "utf-8")
);

// --- Uploads ---
const uploadDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
const upload = multer({ dest: uploadDir });

// --- Health ---
app.get("/health", (_req, res) => {
  console.log("[GET] /health");
  res.json({ ok: true, ts: new Date().toISOString() });
});

// --- Root ---
app.get("/", (_req, res) => {
  console.log("[GET] /");
  res.send("ShareMySchedule backend is running 🚀");
});

// ============ AUTH ============

// Register
app.post("/auth/register", async (req, res) => {
  try {
    const { firstName, lastName, email, password } = req.body;
    console.log("[POST /auth/register] Incoming:", { firstName, lastName, email });

    if (!email || !password || !firstName || !lastName) {
      console.log("❌ Missing fields");
      return res.status(400).json({ error: "Missing fields" });
    }

    if (!mustYorkU(email)) {
      console.log("❌ Non-YorkU email");
      return res.status(400).json({ error: "Please use your @my.yorku.ca email address." });
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      console.log("❌ Email already registered:", email);
      return res.status(409).json({ error: "Email already registered" });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        name: `${firstName} ${lastName}`.trim(),
        university: "York University",
      },
    });
    console.log("✅ User created:", user.id);

    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await prisma.emailVerificationToken.create({
      data: { userId: user.id, token, expiresAt },
    });
    console.log("✅ Verification token created");

    const verifyUrl = `${process.env.APP_BASE_URL}/verify?token=${token}`;
    await transporter.sendMail({
      from: process.env.EMAIL_FROM,
      to: email,
      subject: "Verify your ShareMySchedule account",
      html: `<p>Click below to verify:</p><a href="${verifyUrl}">${verifyUrl}</a>`,
    });
    console.log("📧 Verification email sent to", email);

    return res.json({
      ok: true,
      message: "Registered. Check your email for a verification link.",
    });
  } catch (e) {
    console.error("❌ Register error:", e);
    return res.status(500).json({ error: "Server error" });
  }
});


// Verify email (frontend links to /verify?token=...)
app.get("/auth/verify-email", async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) return res.status(400).send("Invalid token");

    const record = await prisma.emailVerificationToken.findUnique({
      where: { token },
      include: { user: true },
    });

    if (!record || record.expiresAt < new Date()) {
      return res.status(400).send("Token invalid or expired.");
    }

    await prisma.user.update({
      where: { id: record.userId },
      data: { emailVerifiedAt: true },
    });

    await prisma.emailVerificationToken.delete({ where: { token } });

    console.log("[AUTH] Email verified for:", record.user.email);

    // 🔽 redirect to new Verified page
    return res.redirect(`${process.env.APP_BASE_URL}/verified`);
  } catch (e) {
    console.error(e);
    res.status(500).send("Server error");
  }
});


app.post("/auth/resend-verification", async (req, res) => {
  try {
    const { email } = req.body;
    console.log("[POST] /auth/resend-verification", email);
    if (!email) return res.status(400).json({ error: "Email required" });

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      console.log("[AUTH] Resend attempted for unknown:", email);
      return res.json({ message: "If this email exists, a new link was sent." });
    }

    if (user.emailVerifiedAt) {
      console.log("[AUTH] Already verified:", email);
      return res.json({ message: "This email is already verified." });
    }

    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await prisma.emailVerificationToken.upsert({
      where: { userId: user.id },
      update: { token, expiresAt },
      create: { userId: user.id, token, expiresAt },
    });
    console.log("✅ New verification token created for:", email);

    await sendVerificationEmail(email, token);

    return res.json({ message: "Verification email resent." });
  } catch (e) {
    console.error("[AUTH] Resend error:", e);
    return res.status(500).json({ error: "Server error" });
  }
});



// Login
app.post("/auth/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    console.log("[POST /auth/login] Attempt:", username);

    const user = await prisma.user.findUnique({ where: { email: username } });
    if (!user) {
      console.log("❌ No such user:", username);
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      console.log("❌ Wrong password for", username);
      return res.status(401).json({ error: "Invalid credentials" });
    }

    if (!user.emailVerifiedAt) {
      console.log("❌ Email not verified for", username);
      return res.status(403).json({ error: "Please verify your email first." });
    }

    const accessToken = signAccess({ sub: user.id, email: user.email });
    const refreshToken = signRefresh({ sub: user.id });
    await prisma.session.create({
      data: { userId: user.id, refreshToken, expiresAt: new Date(Date.now() + 30*24*60*60*1000) },
    });

    console.log("✅ Login success:", username);
    return res.json({ accessToken, refreshToken });
  } catch (e) {
    console.error("❌ Login error:", e);
    return res.status(500).json({ error: "Server error" });
  }
});

// Refresh access token
app.post("/auth/refresh", async (req, res) => {
  console.log("[POST] /auth/refresh");
  const { refreshToken } = req.body || {};
  if (!refreshToken) {
    console.warn("[REFRESH] Missing token");
    return res.status(400).json({ error: "Missing token" });
  }
  try {
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    const session = await prisma.session.findUnique({ where: { refreshToken } });
    if (!session || session.expiresAt < new Date()) {
      console.warn("[REFRESH] Invalid or expired session");
      return res.status(401).json({ error: "Invalid session" });
    }
    const accessToken = signAccess({ sub: decoded.sub });
    console.log("[REFRESH] OK for user:", decoded.sub);
    return res.json({ accessToken });
  } catch (e) {
    console.warn("[REFRESH] Invalid token:", e.message);
    return res.status(401).json({ error: "Invalid token" });
  }
});

// Who am I
app.get("/auth/me", auth, async (req, res) => {
  console.log("[GET] /auth/me user:", req.user?.sub);
  const user = await prisma.user.findUnique({
    where: { id: req.user.sub },
    select: {
      id: true,
      name: true,
      email: true,
      university: true,
      emailVerifiedAt: true,
      degree: true,
      major: true,
      yearOfStudy: true,
      preferredPlatform: true,
      discordHandle: true,
      instagramHandle: true,
    },
  });
  return res.json({ user });
});

// Update account
app.put("/account", auth, async (req, res) => {
  console.log("[PUT] /account user:", req.user?.sub, "keys:", Object.keys(req.body || {}));
  try {
    const {
      firstName,
      lastName,
      degree,
      major,
      yearOfStudy,
      preferredPlatform,
      discordHandle,
      instagramHandle,
    } = req.body;
    const user = await prisma.user.update({
      where: { id: req.user.sub },
      data: {
        name: `${firstName} ${lastName}`.trim(),
        degree,
        major,
        yearOfStudy,
        preferredPlatform,
        discordHandle,
        instagramHandle,
      },
    });
    console.log("[ACCOUNT] Updated user:", req.user.sub);
    return res.json({ ok: true, user });
  } catch (e) {
    console.error("[ACCOUNT] Update error:", e);
    return res.status(500).json({ error: "Could not update account" });
  }
});

// Change password
app.post("/account/change-password", auth, async (req, res) => {
  console.log("[POST] /account/change-password user:", req.user?.sub);
  try {
    const { oldPassword, newPassword } = req.body;
    const user = await prisma.user.findUnique({ where: { id: req.user.sub } });
    if (!user) return res.status(404).json({ error: "User not found" });

    const valid = await bcrypt.compare(oldPassword, user.passwordHash);
    if (!valid) {
      console.warn("[PWD] Old password mismatch for user:", req.user.sub);
      return res.status(400).json({ error: "Old password incorrect" });
    }

    const newHash = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: newHash },
    });

    console.log("[PWD] Password updated for user:", req.user.sub);
    return res.json({ ok: true });
  } catch (e) {
    console.error("[PWD] Error:", e);
    return res.status(500).json({ error: "Could not change password" });
  }
});

// Logout
app.post("/auth/logout", async (req, res) => {
  const { refreshToken } = req.body || {};
  console.log("[POST] /auth/logout token:", refreshToken ? refreshToken.slice(0, 8) + "..." : "(none)");
  if (refreshToken) {
    await prisma.session.deleteMany({ where: { refreshToken } });
  }
  return res.json({ ok: true });
});

// ============ SCHEDULES ============

// Get schedules
app.get("/schedules", auth, async (req, res) => {
  console.log("[GET] /schedules user:", req.user?.sub);
  const schedules = await prisma.schedule.findMany({
    where: { userId: req.user.sub },
    orderBy: [{ term: "asc" }, { startTime: "asc" }],
  });
  console.log("[GET] /schedules count:", schedules.length);
  res.json({ schedules });
});

// Delete by schedule id (single row)
app.post("/schedules/:id/delete", auth, async (req, res) => {
  console.log("[POST] /schedules/:id/delete", req.params.id);
  const { id } = req.params;
  const found = await prisma.schedule.findUnique({ where: { id } });
  if (!found || found.userId !== req.user.sub) {
    console.warn("[DELETE] Not found or forbidden");
    return res.status(404).json({ error: "Not found" });
  }
  await prisma.schedule.delete({ where: { id } });
  console.log("[DELETE] Deleted schedule row:", id);
  return res.json({ ok: true });
});

// Delete all rows for a courseCode (any term)
app.delete("/schedules/code/:courseCode", auth, async (req, res) => {
  console.log("[DELETE] /schedules/code/:courseCode", req.params.courseCode);
  const { courseCode } = req.params;
  const deleted = await prisma.schedule.deleteMany({
    where: { userId: req.user.sub, courseCode },
  });
  console.log("[DELETE] count:", deleted.count);
  res.json({ ok: true, deleted: deleted.count });
});

// Bulk upsert (grouped by term + course)
app.post("/schedules/bulk", auth, async (req, res) => {
  console.log("[POST] /schedules/bulk user:", req.user?.sub);
  try {
    const { items } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      console.warn("[BULK] No items");
      return res.status(400).json({ error: "No items" });
    }

    const normalized = items.map((i, idx) => {
      const termEnum = toEnum(i.term);
      if (!termEnum) throw new Error(`Item ${idx + 1}: invalid term '${i.term}', expected F/W/S`);
      if (!i.courseCode || typeof i.courseCode !== "string")
        throw new Error(`Item ${idx + 1}: missing/invalid courseCode`);
      return {
        userId: req.user.sub,
        term: termEnum,
        courseCode: i.courseCode.trim(),
        section: i.section ?? "",
        type: i.type ?? "",
        days: i.days ?? "",
        startTime: i.startTime ?? "",
        duration: i.duration == null ? null : Number(i.duration),
        room: i.room ?? null,
      };
    });

    const groups = new Map(); // key = `${term}|${courseCode}`
    for (const row of normalized) {
      const key = `${row.term}|${row.courseCode}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    }

    const ops = [];
    for (const [key, rows] of groups.entries()) {
      const [term, courseCode] = key.split("|");
      ops.push(
        prisma.schedule.deleteMany({
          where: { userId: req.user.sub, term, courseCode },
        })
      );
      ops.push(prisma.schedule.createMany({ data: rows }));
    }

    const results = await prisma.$transaction(ops);
    const deleted = results
      .filter((r, idx) => idx % 2 === 0 && typeof r.count === "number")
      .reduce((sum, r) => sum + r.count, 0);
    const inserted = results
      .filter((r, idx) => idx % 2 === 1 && typeof r.count === "number")
      .reduce((sum, r) => sum + r.count, 0);

    console.log("[BULK] groups:", groups.size, "deleted:", deleted, "inserted:", inserted);
    return res.json({ ok: true, groups: groups.size, deleted, inserted });
  } catch (err) {
    console.error("[BULK] Error:", err);
    return res.status(400).json({ error: err.message || "Failed to save schedule" });
  }
});

// Update one row
app.put("/schedules/:id", auth, async (req, res) => {
  console.log("[PUT] /schedules/:id", req.params.id);
  const { id } = req.params;
  const found = await prisma.schedule.findUnique({ where: { id } });
  if (!found || found.userId !== req.user.sub) {
    console.warn("[PUT] Not found or forbidden");
    return res.status(404).json({ error: "Not found" });
  }

  const { courseCode, section, type, days, startTime, duration, room } = req.body;
  const updated = await prisma.schedule.update({
    where: { id },
    data: { courseCode, section, type, days, startTime, duration, room },
  });
  console.log("[PUT] Updated schedule:", id);
  res.json({ ok: true, schedule: updated });
});

// ============ COURSES ============

// Search (static catalog.json)
app.get("/courses/search", (req, res) => {
  const q = (req.query.q || "").toLowerCase();
  console.log("[GET] /courses/search (catalog) q:", q);
  const matches = catalog.filter(
    (c) =>
      c.name.toLowerCase().includes(q) ||
      `${c.subject} ${c.number}`.toLowerCase().includes(q)
  );
  res.json({ courses: matches.slice(0, 10) });
});

// Course details from catalog
app.get("/courses/:subject/:number", (req, res) => {
  const { subject, number } = req.params;
  console.log("[GET] /courses/:subject/:number", subject, number);
  const course = catalog.find(
    (c) => c.subject === subject.toUpperCase() && c.number === number
  );
  if (!course) return res.status(404).json({ error: "Course not found" });
  res.json(course);
});

// (Second) Search via Prisma (kept for compatibility; order means catalog route above usually handles)
app.get("/courses/search", async (req, res) => {
  const q = req.query.q || "";
  console.log("[GET] /courses/search (db) q:", q);
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

// Extra Prisma-based course detail (kept)
app.get("/courses/:id", async (req, res) => {
  const id = req.params.id;
  console.log("[GET] /courses/:id", id);
  const course = await prisma.course.findUnique({
    where: { id },
    include: { sessions: { include: { meetings: true } } },
  });
  if (!course) return res.status(404).json({ error: "Not found" });
  res.json({ course });
});

// ============ CLASSMATES / CONNECTIONS / FRIENDS ============

// Classmates
app.get("/classmates", auth, async (req, res) => {
  try {
    const rawTerm = (req.query.term || "").toUpperCase();
    console.log("[GET] /classmates term:", rawTerm);
    if (!["F", "W", "S"].includes(rawTerm)) {
      return res.status(400).json({ error: "term must be F, W, or S" });
    }

    // Friend exclusions
    const friendships = await prisma.friendship.findMany({
      where: { OR: [{ user1Id: req.user.sub }, { user2Id: req.user.sub }] },
    });
    const friendIds = friendships.map((f) =>
      f.user1Id === req.user.sub ? f.user2Id : f.user1Id
    );

    // Pending request exclusions
    const sentReqs = await prisma.connectionRequest.findMany({
      where: { fromUserId: req.user.sub, status: "PENDING" },
      select: { toUserId: true },
    });
    const receivedReqs = await prisma.connectionRequest.findMany({
      where: { toUserId: req.user.sub, status: "PENDING" },
      select: { fromUserId: true },
    });
    const sentIds = sentReqs.map((r) => r.toUserId);
    const receivedIds = receivedReqs.map((r) => r.fromUserId);

    const excludeIds = [...friendIds, ...sentIds, ...receivedIds];

    const termEnum = rawTerm === "F" ? Term.F : rawTerm === "W" ? Term.W : Term.S;
    const rows = await prisma.schedule.findMany({
      where: { term: termEnum, NOT: { userId: { in: excludeIds } } },
      include: { user: { select: { id: true, email: true } } },
    });
    console.log("[CLASSMATES] rows:", rows.length, "excludeIds:", excludeIds.length);

    // build per-user sets
    const perUser = new Map();
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
      if (r.type === "LECT") {
        u.courses.add(r.courseCode);
        u.lecs.set(r.courseCode, r.section || "");
      }
      if (r.type === "LAB") {
        if (!u.labs.has(r.courseCode)) u.labs.set(r.courseCode, new Set());
        if (r.section) u.labs.get(r.courseCode).add(r.section);
      }
      if (!u.courses.has(r.courseCode) && r.type !== "LECT") {
        u.courses.add(r.courseCode);
      }
    }

    const me = perUser.get(req.user.sub);
    if (!me) {
      console.log("[CLASSMATES] no schedule for current user");
      return res.json({ term: rawTerm, buckets: {}, detailed: [] });
    }

    const myCourses = Array.from(me.courses);
    const myLabs = me.labs;
    const myLecs = me.lecs;

    const detailed = [];
    for (const [otherId, other] of perUser.entries()) {
      if (otherId === req.user.sub) continue;

      const otherCourses = Array.from(other.courses);
      const otherCourseSet = new Set(otherCourses);

      const sharedCourseCodes = myCourses.filter((c) => otherCourseSet.has(c));
      const sharedCourseCount = sharedCourseCodes.length;
      if (sharedCourseCount === 0) continue;

      let sameSectionCount = 0;
      for (const c of sharedCourseCodes) {
        const mySec = myLecs.get(c) || "";
        const oSec = other.lecs.get(c) || "";
        if (mySec && oSec && mySec === oSec) sameSectionCount++;
      }

      let labMatchCount = 0;
      const labMatchesByCourse = {};
      for (const c of sharedCourseCodes) {
        const mine = myLabs.get(c) || new Set();
        const theirs = other.labs.get(c) || new Set();
        if (mine.size && theirs.size) {
          const overlap = Array.from(mine).filter((x) => theirs.has(x));
          if (overlap.length > 0) {
            labMatchCount += overlap.length;
            labMatchesByCourse[c] = overlap;
          }
        }
      }

      const allCoursesMatch =
        myCourses.length === otherCourses.length &&
        myCourses.every((c) => otherCourseSet.has(c));

      let allLabsMatch = true;
      for (const c of sharedCourseCodes) {
        const mine = myLabs.get(c) || new Set();
        const theirs = other.labs.get(c) || new Set();
        if (mine.size || theirs.size) {
          if (mine.size !== theirs.size) {
            allLabsMatch = false;
            break;
          }
          for (const lab of mine) if (!theirs.has(lab)) { allLabsMatch = false; break; }
          if (!allLabsMatch) break;
        }
      }

      detailed.push({
        email: other.email,
        userId: otherId,
        sharedCourseCount,
        sharedCourseCodes,
        sameSectionCount,
        labMatchCount,
        labMatchesByCourse,
        allCoursesMatch,
        allLabsMatch,
      });
    }

    const byCourseCount = {};
    for (const d of detailed) {
      const k = String(d.sharedCourseCount);
      if (!byCourseCount[k]) byCourseCount[k] = [];
      byCourseCount[k].push(d.email);
    }
    const exactCourses = detailed.filter((d) => d.allCoursesMatch).map((d) => d.email);

    console.log("[CLASSMATES] detailed:", detailed.length);
    res.json({ term: rawTerm, myCourses, buckets: { byCourseCount, exactCourses }, detailed });
  } catch (e) {
    console.error("[CLASSMATES] Error:", e);
    res.status(500).json({ error: "Failed to compute classmates" });
  }
});

// Send connection request
app.post("/connect", auth, async (req, res) => {
  const { toUserId, platform, message } = req.body || {};
  console.log("[POST] /connect → to:", toUserId, "platform:", platform);
  const me = await prisma.user.findUnique({ where: { id: req.user.sub } });

  if (!toUserId || !platform)
    return res.status(400).json({ error: "Missing fields" });
  if (toUserId === me.id)
    return res.status(400).json({ error: "Cannot connect to yourself" });
  if (message && message.length > 200)
    return res.status(400).json({ error: "Message too long" });

  const handle = platform === "DISCORD" ? me.discordHandle : me.instagramHandle;
  if (!handle)
    return res.status(400).json({ error: "Set your handle in Account Settings first" });

  const row = await prisma.connectionRequest.create({
    data: {
      fromUserId: me.id,
      toUserId,
      platform,
      handle,
      message: message || "",
      senderName: me.name,
      senderDegree: me.degree,
      senderMajor: me.major,
      senderYear: me.yearOfStudy,
    },
  });
  console.log("[CONNECT] Request created:", row.id);
  res.json(row);
});

// Inbox
app.get("/inbox", auth, async (req, res) => {
  console.log("[GET] /inbox user:", req.user?.sub);
  try {
    const myCourseRows = await prisma.schedule.findMany({
      where: { userId: req.user.sub },
      select: { courseCode: true },
    });
    const myCourseSet = new Set(
      myCourseRows.map((c) => (c.courseCode || "").trim().toUpperCase())
    );

    const received = await prisma.connectionRequest.findMany({
      where: { toUserId: req.user.sub, NOT: { status: "CANCELLED" } },
      orderBy: { createdAt: "desc" },
      include: { fromUser: { select: { id: true, email: true } } },
    });

    const sent = await prisma.connectionRequest.findMany({
      where: { fromUserId: req.user.sub, NOT: { status: "CANCELLED" } },
      orderBy: { createdAt: "desc" },
      include: { toUser: { select: { id: true, email: true } } },
    });

    const getSharedForOther = async (otherUserId) => {
      const otherRows = await prisma.schedule.findMany({
        where: { userId: otherUserId },
        select: { courseCode: true },
      });
      const otherSet = new Set(
        otherRows.map((c) => (c.courseCode || "").trim().toUpperCase())
      );
      const shared = [...otherSet].filter((code) => myCourseSet.has(code));
      return { sharedCourseCount: shared.length, sharedCourseCodes: shared };
    };

    const receivedWithShared = await Promise.all(
      received.map(async (r) => {
        const shared = await getSharedForOther(r.fromUser.id);
        return { ...r, ...shared };
      })
    );

    const sentWithShared = await Promise.all(
      sent.map(async (r) => {
        const shared = await getSharedForOther(r.toUser.id);
        return { ...r, ...shared };
      })
    );

    console.log("[INBOX] received:", received.length, "sent:", sent.length);
    res.json({ received: receivedWithShared, sent: sentWithShared });
  } catch (e) {
    console.error("[INBOX] Error:", e);
    res.status(500).json({ error: "Failed to load inbox" });
  }
});

// Unread count
app.get("/inbox/unread-count", auth, async (req, res) => {
  const count = await prisma.connectionRequest.count({
    where: { toUserId: req.user.sub, status: "PENDING" },
  });
  console.log("[GET] /inbox/unread-count →", count);
  res.json({ count });
});

// Respond to a request
app.put("/connect/:id/respond", auth, async (req, res) => {
  const { action } = req.body;
  const id = req.params.id;
  console.log("[PUT] /connect/:id/respond", id, "action:", action);

  const row = await prisma.connectionRequest.findUnique({ where: { id } });
  if (!row) return res.status(404).json({ error: "Not found" });

  if (action === "CANCELLED" && row.fromUserId !== req.user.sub)
    return res.status(403).json({ error: "Forbidden" });
  if (["ACCEPTED", "DECLINED"].includes(action) && row.toUserId !== req.user.sub)
    return res.status(403).json({ error: "Forbidden" });

  const updated = await prisma.connectionRequest.update({
    where: { id: row.id },
    data: { status: action },
  });

  if (action === "ACCEPTED") {
    const [a, b] = [row.fromUserId, row.toUserId].sort();
    await prisma.friendship.upsert({
      where: { user1Id_user2Id: { user1Id: a, user2Id: b } },
      update: {},
      create: { user1Id: a, user2Id: b },
    });
    console.log("[RESPOND] Friendship created between:", a, b);
  } else {
    console.log("[RESPOND] Status set to", action);
  }

  res.json(updated);
});

// Friends list
app.get("/friends", auth, async (req, res) => {
  console.log("[GET] /friends user:", req.user?.sub);
  try {
    const myCourses = await prisma.schedule.findMany({
      where: { userId: req.user.sub },
      select: { courseCode: true, term: true },
    });
    const myByTerm = myCourses.reduce((acc, row) => {
      if (!acc[row.term]) acc[row.term] = new Set();
      acc[row.term].add(row.courseCode);
      return acc;
    }, {});

    const friendships = await prisma.friendship.findMany({
      where: { OR: [{ user1Id: req.user.sub }, { user2Id: req.user.sub }] },
      include: {
        user1: {
          select: {
            id: true, name: true, email: true,
            preferredPlatform: true, discordHandle: true, instagramHandle: true,
          },
        },
        user2: {
          select: {
            id: true, name: true, email: true,
            preferredPlatform: true, discordHandle: true, instagramHandle: true,
          },
        },
      },
    });

    const friends = await Promise.all(
      friendships.map(async (fs) => {
        const friend = fs.user1Id === req.user.sub ? fs.user2 : fs.user1;
        const friendCourses = await prisma.schedule.findMany({
          where: { userId: friend.id },
          select: { courseCode: true, term: true },
        });
        const friendByTerm = friendCourses.reduce((acc, row) => {
          if (!acc[row.term]) acc[row.term] = new Set();
          acc[row.term].add(row.courseCode);
          return acc;
        }, {});

        const sharedByTerm = {};
        for (const term of Object.keys(myByTerm)) {
          const shared = [...(friendByTerm[term] || [])].filter((c) =>
            myByTerm[term].has(c)
          );
          if (shared.length > 0) sharedByTerm[term] = shared;
        }

        const sharedCourseCodes = Object.values(sharedByTerm).flat();

        let handle = null;
        if (friend.preferredPlatform === "DISCORD") handle = friend.discordHandle;
        else if (friend.preferredPlatform === "INSTAGRAM") handle = friend.instagramHandle;

        return {
          id: friend.id,
          name: friend.name,
          email: friend.email,
          preferredPlatform: friend.preferredPlatform,
          handle,
          sharedCourseCount: sharedCourseCodes.length,
          sharedCourseCodes,
          sharedByTerm,
        };
      })
    );

    friends.sort((a, b) => b.sharedCourseCount - a.sharedCourseCount);
    console.log("[FRIENDS] count:", friends.length);
    res.json({ friends });
  } catch (e) {
    console.error("[FRIENDS] Error:", e);
    res.status(500).json({ error: "Failed to load friends" });
  }
});

// Remove friend
app.delete("/friends/:friendId", auth, async (req, res) => {
  const userId = req.user.sub;
  const friendId = req.params.friendId;
  const [a, b] = [userId, friendId].sort();
  console.log("[DELETE] /friends/:friendId", "pair:", a, b);
  await prisma.friendship.delete({
    where: { user1Id_user2Id: { user1Id: a, user2Id: b } },
  });
  res.json({ ok: true });
});

// Stats
app.get("/stats", async (_req, res) => {
  try {
    const userCount = await prisma.user.count();
    const courseCount = await prisma.course.count();
    console.log("[GET] /stats users:", userCount, "courses:", courseCount);
    res.json({
      userCount,
      courseCount,
      lastRefresh: "Sep 5, 2025", // static for now
    });
  } catch (e) {
    console.error("[STATS] Error:", e);
    res.status(500).json({ error: "Failed to fetch stats" });
  }
});

// --- Start server last ---
app.listen(PORT, () => {
  console.log("==================================================");
  console.log(`Server running on http://localhost:${PORT}`);
  console.log("APP_BASE_URL:", process.env.APP_BASE_URL);
  console.log("Allowed Origins:", allowedOrigins.join(", "));
  console.log("==================================================");
});
