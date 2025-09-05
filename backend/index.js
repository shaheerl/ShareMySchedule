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

dotenv.config();

const prisma = new PrismaClient();
const app = express();

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

app.post("/schedules/upload", auth, upload.single("file"), async (req, res) => {
  try {
    const { term } = req.body; // "Fall" | "Winter" | "Summer"
    if (!req.file) return res.status(400).json({ error: "No file" });
    if (!["Fall", "Winter", "Summer"].includes(term)) {
      return res.status(400).json({ error: "Invalid term" });
    }

    // store upload record
    await prisma.upload.create({
      data: { userId: req.user.sub, term, filename: req.file.filename },
    });

    // send file to OCR service
    const form = new FormData();
    form.append("file", fs.createReadStream(req.file.path), req.file.originalname);

    const ocrRes = await fetch("http://localhost:6000/ocr", { method: "POST", body: form });
    const ocrData = await ocrRes.json(); // { extracted_text }

    const text = (ocrData?.extracted_text || "").replace(/\r/g, "");

    // SUPER SIMPLE heuristic parse (you’ll improve later):
    // Look for lines like "EECS 3482", durations, day letters, start times
    const lines = text.split("\n").map(l => l.trim()).filter(Boolean);

    // naive course code regex and time/duration hints
    const guess = [];
    for (const line of lines) {
      const code = line.match(/[A-Z]{2,}[\s/]*\d{3,4}/)?.[0]?.replace(/\s+/g, " ");
      const days = line.match(/\b(M|T|W|R|F){1,5}\b/)?.[0] || "";
      const start = line.match(/\b([01]?\d|2[0-3]):?[0-5]\d\b/)?.[0] || "";
      if (code && start) {
        guess.push({
          term,
          courseCode: code,
          section: "",
          type: "",
          days: days || "",
          startTime: start.includes(":") ? start : start.replace(/(\d{1,2})(\d{2})/, "$1:$2"),
          duration: 80,
          room: ""
        });
      }
    }

    return res.json({
      message: "OCR complete",
      rawText: text,
      guesses: guess, // array for manual page
      term
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Upload/OCR failed" });
  }
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
  const { items } = req.body;
  if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: "No items" });

  const terms = Array.from(new Set(items.map(i => i.term)));
  await prisma.schedule.deleteMany({ where: { userId: req.user.sub, term: { in: terms } } });

  const data = items.map(i => ({
    userId: req.user.sub,
    term: i.term,
    courseCode: i.courseCode,
    section: i.section,
    type: i.type,
    days: i.days,
    startTime: i.startTime,
    duration: i.duration ? Number(i.duration) : null,
    room: i.room
  }));

  await prisma.schedule.createMany({ data });
  res.json({ ok: true });
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
