import fs from "fs";
import * as cheerio from "cheerio";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// normalize text
const txt = (el) =>
  el ? el.text().replace(/\u00a0/g, " ").trim().replace(/\s+/g, " ") : "";

// parse course id cell "3482 3.00 A" → { number, credits, letter }
function parseCourseIdCell(raw) {
  const m = raw.match(/(\d{4})\s+(\d\.\d{2})\s+([A-Z])/i);
  if (!m) return { number: "", credits: "", letter: "" };
  return { number: m[1], credits: m[2], letter: m[3] };
}

// parse nested time table
function parseTimeTable($, td) {
  const meetings = [];
  $(td)
    .find("table tr")
    .each((_, tr) => {
      const tds = $(tr).find("td.smallbodytext");
      if (!tds.length) return;
      const day = txt($(tds[0]));
      const start = txt($(tds[1]));
      const dur = parseInt(txt($(tds[2])) || "0", 10);
      const campus = txt($(tds[3]));
      const room = txt($(tds[4]));
      if (day || start || dur || campus || room) {
        meetings.push({ day, startTime: start, duration: dur, campus, room });
      }
    });
  return meetings;
}

async function run() {
  const htmlPath = "catalog/LassondeSchoolOfEngineering.html";
  const html = fs.readFileSync(htmlPath, "utf-8");
  const $ = cheerio.load(html);

  let currentCourse = null;
  let currentSection = null;

  let courseCount = 0,
    sectionCount = 0,
    offeringCount = 0,
    meetingCount = 0;

  $("tr").each((_, tr) => {
    const tds = $(tr).find("td");

    // Header row (new course)
    if (
      tds.length >= 4 &&
      $(tds[0]).hasClass("bodytext") &&
      $(tds[1]).hasClass("bodytext") &&
      $(tds[2]).hasClass("bodytext") &&
      $(tds[3]).attr("colspan")
    ) {
      const faculty = txt($(tds[0]).find("strong"));
      const subject = txt($(tds[1]).find("strong"));
      const term = txt($(tds[2]).find("strong")).replace(/[^FWS]/g, "");
      const name = txt($(tds[3]).find("strong"));

      currentCourse = { faculty, subject, term, name };
      currentSection = null;
      return;
    }

    // Detail rows (lect/lab/tutr)
    if (tds.length >= 8 && $(tds[0]).attr("colspan") === "3") {
      const courseIdCell = txt($(tds[1]));
      const { number, credits, letter } = parseCourseIdCell(courseIdCell);

      const type = txt($(tds[3])).toUpperCase(); // "LECT", "LAB", "TUTR"
      const meetNum = txt($(tds[4]));
      const catNo = txt($(tds[5]));
      const instructor = txt($(tds[7]));
      const notes = txt($(tds[8]));

      if (type.startsWith("LECT")) {
        currentSection = { number, credits, letter, instructor };
        currentCourse = { ...currentCourse, number, credits };

        // Save course & section
        (async () => {
          const code = `${currentCourse.faculty}${currentCourse.subject}${number}${credits}`;
          const course = await prisma.course.upsert({
            where: { code },
            update: { name: currentCourse.name },
            create: {
              faculty: currentCourse.faculty,
              subject: currentCourse.subject,
              number,
              credits,
              name: currentCourse.name,
              code,
            },
          });
          courseCount++;

          let section = await prisma.section.findFirst({
            where: { courseId: course.id, term: currentCourse.term, letter },
          });
          if (!section) {
            section = await prisma.section.create({
              data: {
                courseId: course.id,
                term: currentCourse.term,
                letter,
                instructor,
              },
            });
            sectionCount++;
          }

          // LECT offering
          const meetings = parseTimeTable($, tds[6]);
          const off = await prisma.offering.create({
            data: {
              sectionId: section.id,
              type: "LECT",
              number: meetNum,
              notes,
            },
          });
          offeringCount++;
          for (const m of meetings) {
            await prisma.meeting.create({
              data: {
                offeringId: off.id,
                day: m.day,
                startTime: m.startTime,
                duration: m.duration,
                campus: m.campus,
                room: m.room,
              },
            });
            meetingCount++;
          }
        })();
      } else if (type.startsWith("LAB") || type.startsWith("TUTR")) {
        if (!currentSection) return;
        if (/cancelled/i.test(catNo)) return;

        (async () => {
          const code = `${currentCourse.faculty}${currentCourse.subject}${currentSection.number}${currentSection.credits}`;
          const course = await prisma.course.findUnique({ where: { code } });
          if (!course) return;

          const section = await prisma.section.findFirst({
            where: {
              courseId: course.id,
              term: currentCourse.term,
              letter: currentSection.letter,
            },
          });
          if (!section) return;

          const meetings = parseTimeTable($, tds[6]);
          const off = await prisma.offering.create({
            data: {
              sectionId: section.id,
              type: type.startsWith("LAB") ? "LAB" : "TUTR",
              number: meetNum,
              notes,
            },
          });
          offeringCount++;
          for (const m of meetings) {
            await prisma.meeting.create({
              data: {
                offeringId: off.id,
                day: m.day,
                startTime: m.startTime,
                duration: m.duration,
                campus: m.campus,
                room: m.room,
              },
            });
            meetingCount++;
          }
        })();
      }
    }
  });

  console.log(
    `Done. Courses: ${courseCount}, Sections: ${sectionCount}, Offerings: ${offeringCount}, Meetings: ${meetingCount}`
  );
}

run()
  .catch((e) => console.error(e))
  .finally(() => prisma.$disconnect());
