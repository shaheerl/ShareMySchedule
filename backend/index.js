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
  if (key === "F") return Term.F;
  if (key === "W") return Term.W;
  if (key === "S") return Term.S;
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

const catalog = JSON.parse(fs.readFileSync("catalog/catalog.json", "utf-8"));

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

// Delete all schedules for a given courseCode for the logged-in user
app.delete("/schedules/code/:courseCode", auth, async (req, res) => {
  const { courseCode } = req.params;
  const deleted = await prisma.schedule.deleteMany({
    where: { userId: req.user.sub, courseCode },
  });
  res.json({ ok: true, deleted: deleted.count });
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
        throw new Error(
          `Item ${idx + 1}: invalid term '${i.term}', expected F/W/S`
        );
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
            term: term, // already enum value
            courseCode: courseCode, // same course only
          },
        })
      );
      ops.push(prisma.schedule.createMany({ data: rows }));
    }

    const results = await prisma.$transaction(ops);

    // results contains counts interleaved: [deleted, inserted, deleted, inserted, ...]
    const deleted = results
      .filter((r) => typeof r.count === "number")
      .filter((_, idx) => idx % 2 === 0) // even indices = deleteMany
      .reduce((sum, r) => sum + r.count, 0);

    const inserted = results
      .filter((r) => typeof r.count === "number")
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
    return res
      .status(400)
      .json({ error: err.message || "Failed to save schedule" });
  }
});

app.put("/schedules/:id", auth, async (req, res) => {
  const { id } = req.params;
  const found = await prisma.schedule.findUnique({ where: { id } });
  if (!found || found.userId !== req.user.sub)
    return res.status(404).json({ error: "Not found" });

  const { courseCode, section, type, days, startTime, duration, room } =
    req.body;
  const updated = await prisma.schedule.update({
    where: { id },
    data: { courseCode, section, type, days, startTime, duration, room },
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
    if (existing)
      return res.status(409).json({ error: "Email already registered" });

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

    const rec = await prisma.emailVerificationToken.findUnique({
      where: { token },
    });
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
    const session = await prisma.session.findUnique({
      where: { refreshToken },
    });
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

app.put("/account", auth, async (req, res) => {
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
    if (!valid)
      return res.status(400).json({ error: "Old password incorrect" });

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

    // === Exclusions: friends + sent/received requests ===
    // Find friend IDs
    const friendships = await prisma.friendship.findMany({
      where: {
        OR: [{ user1Id: req.user.sub }, { user2Id: req.user.sub }],
      },
    });
    const friendIds = friendships.map((f) =>
      f.user1Id === req.user.sub ? f.user2Id : f.user1Id
    );

    // Find users I have already sent requests to
    const sentReqs = await prisma.connectionRequest.findMany({
      where: { fromUserId: req.user.sub, status: "PENDING" },
      select: { toUserId: true },
    });
    const sentIds = sentReqs.map((r) => r.toUserId);

    // Find users who already sent me a request (pending)
    const receivedReqs = await prisma.connectionRequest.findMany({
      where: { toUserId: req.user.sub, status: "PENDING" },
      select: { fromUserId: true },
    });
    const receivedIds = receivedReqs.map((r) => r.fromUserId);

    // Combine exclusions
    const excludeIds = [...friendIds, ...sentIds, ...receivedIds];
    // === Courses ===
    const termEnum =
      rawTerm === "F" ? Term.F : rawTerm === "W" ? Term.W : Term.S;

    const rows = await prisma.schedule.findMany({
      where: {
        term: termEnum,
        NOT: { userId: { in: excludeIds } }, // exclude friends + requests
      },
      include: { user: { select: { id: true, email: true } } },
    });

    // Build maps per user
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
    if (!me) return res.json({ term: rawTerm, buckets: {}, detailed: [] });

    const myCourses = Array.from(me.courses);
    const myCourseSet = new Set(myCourses);
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
          for (const lab of mine)
            if (!theirs.has(lab)) {
              allLabsMatch = false;
              break;
            }
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

    const exactCourses = detailed
      .filter((d) => d.allCoursesMatch)
      .map((d) => d.email);

    res.json({
      term: rawTerm,
      myCourses,
      buckets: { byCourseCount, exactCourses },
      detailed,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to compute classmates" });
  }
});

// Send connection request
app.post("/connect", auth, async (req, res) => {
  const { toUserId, platform, message } = req.body;
  const me = await prisma.user.findUnique({ where: { id: req.user.sub } });

  if (!toUserId || !platform)
    return res.status(400).json({ error: "Missing fields" });
  if (toUserId === me.id)
    return res.status(400).json({ error: "Cannot connect to yourself" });
  if (message && message.length > 200)
    return res.status(400).json({ error: "Message too long" });

  const handle = platform === "DISCORD" ? me.discordHandle : me.instagramHandle;
  if (!handle)
    return res
      .status(400)
      .json({ error: "Set your handle in Account Settings first" });

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
  res.json(row);
});

// Inbox list
// Inbox list
// Inbox list
// Inbox list
app.get("/inbox", auth, async (req, res) => {
  try {
    // My unique courses (deduped)
    const myCourseRows = await prisma.schedule.findMany({
      where: { userId: req.user.sub },
      select: { courseCode: true },
    });
    const myCourseSet = new Set(
      myCourseRows.map((c) => (c.courseCode || "").trim().toUpperCase())
    );

    // Received requests (exclude cancelled)
    const received = await prisma.connectionRequest.findMany({
      where: { toUserId: req.user.sub, NOT: { status: "CANCELLED" } },
      orderBy: { createdAt: "desc" },
      include: {
        fromUser: { select: { id: true, email: true } },
      },
    });

    // Sent requests (exclude cancelled)
    const sent = await prisma.connectionRequest.findMany({
      where: { fromUserId: req.user.sub, NOT: { status: "CANCELLED" } },
      orderBy: { createdAt: "desc" },
      include: {
        toUser: { select: { id: true, email: true } },
      },
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

    res.json({ received: receivedWithShared, sent: sentWithShared });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to load inbox" });
  }
});

// Unread count (pending requests)
app.get("/inbox/unread-count", auth, async (req, res) => {
  const count = await prisma.connectionRequest.count({
    where: { toUserId: req.user.sub, status: "PENDING" },
  });
  res.json({ count });
});

// Respond (accept/decline/cancel)
app.put("/connect/:id/respond", auth, async (req, res) => {
  const { action } = req.body;
  const row = await prisma.connectionRequest.findUnique({
    where: { id: req.params.id },
  });
  if (!row) return res.status(404).json({ error: "Not found" });

  if (action === "CANCELLED" && row.fromUserId !== req.user.sub)
    return res.status(403).json({ error: "Forbidden" });
  if (
    ["ACCEPTED", "DECLINED"].includes(action) &&
    row.toUserId !== req.user.sub
  )
    return res.status(403).json({ error: "Forbidden" });

  const updated = await prisma.connectionRequest.update({
    where: { id: row.id },
    data: { status: action },
  });

  // If accepted, create friendship
  if (action === "ACCEPTED") {
    const [a, b] = [row.fromUserId, row.toUserId].sort(); // enforce consistent order
    await prisma.friendship.upsert({
      where: { user1Id_user2Id: { user1Id: a, user2Id: b } },
      update: {},
      create: { user1Id: a, user2Id: b },
    });
  }

  res.json(updated);
});

app.get("/friends", auth, async (req, res) => {
  try {
    // My courses grouped by term
    const myCourses = await prisma.schedule.findMany({
      where: { userId: req.user.sub },
      select: { courseCode: true, term: true },
    });
    const myByTerm = myCourses.reduce((acc, row) => {
      if (!acc[row.term]) acc[row.term] = new Set();
      acc[row.term].add(row.courseCode);
      return acc;
    }, {});

    // Get friendships
    const friendships = await prisma.friendship.findMany({
      where: {
        OR: [{ user1Id: req.user.sub }, { user2Id: req.user.sub }],
      },
      include: {
        user1: {
          select: {
            id: true,
            name: true,
            email: true,
            preferredPlatform: true,
            discordHandle: true,
            instagramHandle: true,
          },
        },
        user2: {
          select: {
            id: true,
            name: true,
            email: true,
            preferredPlatform: true,
            discordHandle: true,
            instagramHandle: true,
          },
        },
      },
    });

    // Build friend objects
    const friends = await Promise.all(
      friendships.map(async (fs) => {
        const friend = fs.user1Id === req.user.sub ? fs.user2 : fs.user1;

        // Friend’s courses grouped by term
        const friendCourses = await prisma.schedule.findMany({
          where: { userId: friend.id },
          select: { courseCode: true, term: true },
        });
        const friendByTerm = friendCourses.reduce((acc, row) => {
          if (!acc[row.term]) acc[row.term] = new Set();
          acc[row.term].add(row.courseCode);
          return acc;
        }, {});

        // Shared courses per term
        const sharedByTerm = {};
        for (const term of Object.keys(myByTerm)) {
          const shared = [...(friendByTerm[term] || [])].filter((c) =>
            myByTerm[term].has(c)
          );
          if (shared.length > 0) sharedByTerm[term] = shared;
        }

        // Flatten for total count
        const sharedCourseCodes = Object.values(sharedByTerm).flat();

        // Pick handle based on preferred platform
        let handle = null;
        if (friend.preferredPlatform === "DISCORD") {
          handle = friend.discordHandle;
        } else if (friend.preferredPlatform === "INSTAGRAM") {
          handle = friend.instagramHandle;
        }

        return {
          id: friend.id,
          name: friend.name,
          email: friend.email,
          preferredPlatform: friend.preferredPlatform,
          handle,
          sharedCourseCount: sharedCourseCodes.length,
          sharedCourseCodes,
          sharedByTerm, // { F: ['EECS2030'], W: ['EECS3482'] }
        };
      })
    );

    // Sort by most shared courses
    friends.sort((a, b) => b.sharedCourseCount - a.sharedCourseCount);

    res.json({ friends });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to load friends" });
  }
});


// Remove friend
app.delete("/friends/:friendId", auth, async (req, res) => {
  const userId = req.user.sub;
  const friendId = req.params.friendId;

  const [a, b] = [userId, friendId].sort();
  await prisma.friendship.delete({
    where: { user1Id_user2Id: { user1Id: a, user2Id: b } },
  });

  res.json({ ok: true });
});

app.get("/stats", async (req, res) => {
  try {
    const userCount = await prisma.user.count();
    const courseCount = await prisma.course.count();

    res.json({
      userCount,
      courseCount,
      lastRefresh: "Sep 5, 2025", // for now, static
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to fetch stats" });
  }
});
