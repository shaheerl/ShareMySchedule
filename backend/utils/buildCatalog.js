import fs from "fs";
import * as cheerio from "cheerio";

// normalize text
const txt = (el) =>
  el ? el.text().replace(/\u00a0/g, " ").trim().replace(/\s+/g, " ") : "";

// parse "3482 3.00 A" → { number, credits, letter }
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

function parseFacultyHtml(filePath) {
  const html = fs.readFileSync(filePath, "utf-8");
  const $ = cheerio.load(html);

  const results = [];
  let currentCourse = null;

  const rows = $("tr").toArray();
  for (const tr of rows) {
    const tds = $(tr).find("td");

    // Course header
    if (
      tds.length >= 4 &&
      $(tds[0]).hasClass("bodytext") &&
      $(tds[1]).hasClass("bodytext") &&
      $(tds[2]).hasClass("bodytext") &&
      $(tds[3]).hasClass("bodytext") &&
      $(tds[3]).attr("colspan")
    ) {
      const faculty = txt($(tds[0]).find("strong"));
      const subject = txt($(tds[1]).find("strong"));
      const term = txt($(tds[2]).find("strong")).match(/[FWS]/)?.[0] || "";
      const name = txt($(tds[3]).find("strong"));
      currentCourse = {
        faculty,
        subject,
        term,
        name,
        sections: [],
      };
      continue;
    }

    // Detail rows (smallbodytext)
    if (tds.length >= 8 && $(tds[1]).hasClass("smallbodytext")) {
      const { number, credits, letter } = parseCourseIdCell(txt($(tds[1])));
      if (!number || !credits || !letter || !currentCourse) continue;

      const type = txt($(tds[2])).toUpperCase();
      const meetNum = txt($(tds[3]));
      const catNo = txt($(tds[4]));
      const instructor = txt($(tds[7]));
      const notes = txt($(tds[8]));
      const meetings = parseTimeTable($, tds[5]);

      // find or create section
      let section = currentCourse.sections.find(
        (s) => s.letter === letter && s.term === currentCourse.term
      );
      if (!section) {
        section = {
          term: currentCourse.term,
          letter,
          instructor,
          offerings: [],
        };
        currentCourse.sections.push(section);
      }

      // skip cancelled labs/tutorials
      if (/cancelled/i.test(catNo)) continue;

      // add offering
      section.offerings.push({
        type,
        number: meetNum,
        notes,
        meetings,
      });

      // ensure course is in results
      if (
        !results.find(
          (c) =>
            c.faculty === currentCourse.faculty &&
            c.subject === currentCourse.subject &&
            c.number === number &&
            c.credits === credits
        )
      ) {
        results.push({
          faculty: currentCourse.faculty,
          subject: currentCourse.subject,
          number,
          credits,
          name: currentCourse.name,
          sections: currentCourse.sections,
        });
      }
    }
  }

  return results;
}

async function run() {
  const dir = "catalog";
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".html"));

  let allCourses = [];
  for (const file of files) {
    console.log(`Parsing ${file}...`);
    const courses = parseFacultyHtml(`${dir}/${file}`);
    allCourses = allCourses.concat(courses);
  }

  // Preview first 10
  console.log("Sample parsed courses:");
  for (const c of allCourses.slice(0, 10)) {
    console.log(
      ` • ${c.faculty}/${c.subject} ${c.number} ${c.credits} - ${c.name} (${c.sections.length} sections)`
    );
  }

  const outPath = `${dir}/catalog.json`;
  fs.writeFileSync(outPath, JSON.stringify(allCourses, null, 2), "utf-8");
  console.log(`✅ Saved ${allCourses.length} courses into ${outPath}`);
}

run();
