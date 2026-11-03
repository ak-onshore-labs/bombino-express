// Bumps build.json to the next build, right after a deploy. build.json always
// holds the upcoming build; commits are prefixed with it ("[81.261013.10] ...")
// by the local prepare-commit-msg hook (docs/builds/BUILDS.md).
//
//   total   every deploy ever, +1 each time (counted from Railway's history
//           of bombino-staging: 80 good deploys up to 13 Oct 2026)
//   date    the deploy's day, India time
//   number  which deploy that day: +1 on the same day, back to 1 on a new one
//   major   the "V1", changed by hand for a big release
//
// The app shows it as "Bombino Express V1 (Build 81.261013.10)"
// (client/src/lib/buildInfo.ts).
//
//   npm run build:next
//
// Then add the row for the build just deployed to docs/builds/BUILDS.md.

import { readFileSync, writeFileSync } from "fs";

const FILE = new URL("../build.json", import.meta.url);

// Today in India time, as YYYY-MM-DD.
const today = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kolkata",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());

const current = JSON.parse(readFileSync(FILE, "utf-8"));
const next = {
  major: current.major,
  total: current.total + 1,
  date: today,
  number: current.date === today ? current.number + 1 : 1,
};

writeFileSync(FILE, `${JSON.stringify(next, null, 2)}\n`);

const [y, m, d] = today.split("-");
console.log(`V${next.major} (Build ${next.total}.${y.slice(2)}${m}${d}.${next.number})`);
