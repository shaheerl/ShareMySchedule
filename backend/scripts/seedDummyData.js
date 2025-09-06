// scripts/seedDummyData.js
import { PrismaClient, Term } from "@prisma/client";
import bcrypt from "bcrypt";

const prisma = new PrismaClient();

// ---- helper: make deterministic "test" emails ----
const emailFor = (n) => `seed${String(n).padStart(2, "0")}@my.yorku.ca`;

// ---- YOUR baseline courses (taken from your screenshot/DB) ----
// We'll generate classmates around these.
const MY_BASE = [
  // Fall
  { term: Term.F, courseCode: "EECS 3482", section: "A", type: "LECT", days: "TR", startTime: "14:30", duration: 80, room: "LSB 106" },
  { term: Term.F, courseCode: "EECS 3482", section: "02", type: "LAB",  days: "F",  startTime: "13:30", duration: 110, room: "LAS 1002" },
  { term: Term.F, courseCode: "MATH 1013", section: "B", type: "LECT", days: "MWF", startTime: "10:30", duration: 50, room: "CLH 110" },
  { term: Term.F, courseCode: "PSYC 1010", section: "C", type: "LECT", days: "TR", startTime: "09:00", duration: 80, room: "ACW 102" },

  // Winter
  { term: Term.W, courseCode: "EECS 3221", section: "M", type: "LECT", days: "TR", startTime: "16:00", duration: 80, room: "LSB 105" },
];

// Some extra random-ish courses to mix in
const OTHER = [
  { term: Term.F, courseCode: "EECS 3311", section: "A", type: "LECT", days: "MW", startTime: "13:30", duration: 80, room: "LAS 1006" },
  { term: Term.F, courseCode: "EECS 1012", section: "D", type: "LECT", days: "TR", startTime: "11:30", duration: 80, room: "CLH 100" },
  { term: Term.W, courseCode: "MATH 1090", section: "A", type: "LECT", days: "MWF", startTime: "12:30", duration: 50, room: "CB 120" },
  { term: Term.W, courseCode: "PSYC 2020", section: "B", type: "LECT", days: "TR", startTime: "10:00", duration: 80, room: "ACW 304" },
  { term: Term.S, courseCode: "EECS 2030", section: "A", type: "LECT", days: "MW", startTime: "09:30", duration: 80, room: "LAS 1001" },
];

// tiny util
const pick = (arr, n) => {
  const copy = [...arr];
  const out = [];
  while (copy.length && out.length < n) {
    const i = Math.floor(Math.random() * copy.length);
    out.push(copy.splice(i, 1)[0]);
  }
  return out;
};

// Build schedules for a user with a certain overlap level
//  - "all" -> all MY_BASE
//  - "partial" -> 1-3 from MY_BASE + some OTHER
//  - "none" -> only OTHER
function makeScheduleProfile(kind) {
  if (kind === "all") {
    return [...MY_BASE];
  }
  if (kind === "partial") {
    const shared = pick(MY_BASE, 1 + Math.floor(Math.random() * 3)); // 1..3 shared
    const extras = pick(OTHER, 1 + Math.floor(Math.random() * 2));   // 1..2 other
    return [...shared, ...extras];
  }
  // none
  return pick(OTHER, 2 + Math.floor(Math.random() * 3)); // 2..4 others
}

async function createUserWithSchedules(i, kind) {
  const email = emailFor(i);
  const passwordHash = await bcrypt.hash("Password1!", 10);

  // upsert user
  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      name: `Seed User ${i}`,
      passwordHash,
      university: "York University",
      emailVerifiedAt: new Date(),
    },
  });

  // delete any existing schedules for this user (clean slate)
  await prisma.schedule.deleteMany({ where: { userId: user.id } });

  const rows = makeScheduleProfile(kind).map((c) => ({
    userId: user.id,
    term: c.term,
    courseCode: c.courseCode,
    section: c.section,
    type: c.type,
    days: c.days,
    startTime: c.startTime,
    duration: c.duration,
    room: c.room,
  }));

  await prisma.schedule.createMany({ data: rows });
  return { email, count: rows.length, kind };
}

async function main() {
  // Distribution:
  //  - 5 users with 100% overlap
  //  - 9 users with partial overlap
  //  - 6 users with no overlap
  const plan = [
    ...Array(5).fill("all"),
    ...Array(9).fill("partial"),
    ...Array(6).fill("none"),
  ];

  const results = [];
  for (let i = 1; i <= plan.length; i++) {
    const kind = plan[i - 1];
    const r = await createUserWithSchedules(i, kind);
    results.push(r);
    console.log(`Created ${r.email} (${r.kind}) with ${r.count} rows`);
  }

  console.log("\nDone! Summary:");
  console.table(results.map(r => ({ email: r.email, kind: r.kind, rows: r.count })));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
