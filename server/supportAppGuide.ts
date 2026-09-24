/**
 * How to do anything in the app (get_app_help): where a screen, button or
 * setting is, and what a feature does. Answered from content/bia/app-guide.md,
 * which is written for customers and kept with the features it describes, so a
 * new feature is a new section there rather than new code here.
 *
 * BIA only guides. Every answer in the guide is what the customer does
 * themselves; the buttons it offers only open a screen.
 *
 * The file is re-read at most once a minute, like the restricted-items lists,
 * so an edit is live without a restart. The deploy must ship `content/`.
 */

import fs from "node:fs";
import path from "node:path";
import type { BiaTool, SupportChatContext, ToolOutcome } from "./supportTypes.js";

const DEFAULT_FILE = path.resolve(process.cwd(), "content", "bia", "app-guide.md");
const CACHE_MS = 60_000;
/** Sections handed to the model for one question. */
const MAX_SECTIONS = 2;

export interface GuideSection {
  title: string;
  /** "Asked as:" phrases, lower-cased. */
  askedAs: string[];
  /** BIA button tokens to offer with it. */
  buttons: string[];
  body: string;
}

/** The guide's sections: every `## ` heading with its lines, up to the next one. */
export function parseAppGuide(text: string): GuideSection[] {
  const sections: GuideSection[] = [];
  const parts = text.replace(/\r\n/g, "\n").split(/^## /m).slice(1);
  for (const part of parts) {
    const [titleLine, ...rest] = part.split("\n");
    const title = titleLine.trim();
    if (!title) continue;
    let askedAs: string[] = [];
    let buttons: string[] = [];
    const bodyLines: string[] = [];
    for (const line of rest) {
      const asked = line.match(/^Asked as:\s*(.*)$/i);
      const btn = line.match(/^Buttons:\s*(.*)$/i);
      if (asked) askedAs = asked[1].split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
      else if (btn) buttons = btn[1].split(/[\s,]+/).filter((t) => /^TAP_[A-Z_]+(?::\S+)?$/.test(t));
      else bodyLines.push(line);
    }
    const body = bodyLines.join("\n").trim();
    if (body) sections.push({ title, askedAs, buttons, body });
  }
  return sections;
}

const STOP_WORDS = new Set(
  "a an the i me my we our you your it its is are am was be do does did can could how what where when why which who to of in on at for from with and or this that there here get go app please want need".split(" ")
);

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/[\s-]+/)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w));
}

/**
 * The sections that fit a question, best first. A whole "Asked as" phrase in
 * the question counts most; single words in common count a little. A second
 * section comes along only when it fits nearly as well as the first.
 */
export function matchAppGuide(sections: readonly GuideSection[], question: string, max = MAX_SECTIONS): GuideSection[] {
  const q = ` ${question.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").replace(/\s+/g, " ")} `;
  const qWords = new Set(words(question));
  const scored = sections
    .map((s) => {
      let score = 0;
      for (const phrase of s.askedAs) {
        const p = phrase.replace(/[^a-z0-9\s-]/g, " ").replace(/\s+/g, " ").trim();
        if (p && q.includes(` ${p} `)) score += 3 + p.split(" ").length;
      }
      const keywords = new Set([...words(s.title), ...s.askedAs.flatMap(words)]);
      for (const w of Array.from(qWords)) if (keywords.has(w)) score += 1;
      return { s, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  if (scored.length === 0) return [];
  const best = scored[0].score;
  return scored
    .filter((x, i) => i === 0 || x.score >= best * 0.6)
    .slice(0, max)
    .map((x) => x.s);
}

let cache: { file: string; at: number; sections: GuideSection[] } | null = null;

function loadGuide(file: string): GuideSection[] | null {
  if (cache && cache.file === file && Date.now() - cache.at < CACHE_MS) return cache.sections;
  try {
    const sections = parseAppGuide(fs.readFileSync(file, "utf8"));
    cache = { file, at: Date.now(), sections };
    return sections;
  } catch {
    return null;
  }
}

export function executeGetAppHelp(
  args: { question?: unknown },
  _context: SupportChatContext,
  file: string = DEFAULT_FILE
): ToolOutcome {
  const question = typeof args.question === "string" ? args.question.trim().slice(0, 300) : "";
  const sections = loadGuide(file);
  if (!sections || sections.length === 0) {
    return {
      content: "The app guide couldn't be read just now. Say you can't look that up right now, and offer our team.\nTAP_CONTACT_US",
    };
  }
  const found = question ? matchAppGuide(sections, question) : [];
  if (found.length === 0) {
    return {
      content: [
        "Nothing in the app guide matches that. It covers: " + sections.map((s) => s.title).join("; ") + ".",
        "If one of these is what they mean, call get_app_help again with it. Otherwise say you're not sure where that is in the app, and offer our team. Never invent a screen, button or setting.",
        "TAP_CONTACT_US",
      ].join("\n"),
    };
  }
  const lines = found.flatMap((s) => [`## ${s.title}`, s.body, ""]);
  lines.push(
    "Important: answer from this in two to four short sentences or steps, naming the screen and the button as written. It describes what they do themselves: never say you'll do it, and never add screens, buttons or settings that aren't here."
  );
  const buttons = Array.from(new Set(found.flatMap((s) => s.buttons)));
  if (buttons.length > 0) lines.push(...buttons);
  return { content: lines.join("\n") };
}

export const APP_GUIDE_TOOLS: readonly BiaTool[] = [
  {
    module: "general",
    definition: {
      type: "function",
      function: {
        name: "get_app_help",
        description:
          "How to do something in the Bombino app, where a screen, button or setting is, or what a feature does (signing in, profile, notifications, labels, exporting orders, WhatsApp messages, reminders, anything on a screen). Pass their question in their words.",
        parameters: {
          type: "object",
          properties: {
            question: { type: "string", description: "What they want to do or find, in their words." },
          },
          required: ["question"],
        },
      },
    },
    run: async (args, context) => executeGetAppHelp(args, context),
  },
];
