/**
 * "Can I send this?" (BIA 3.0, package 3.4), answered only from Bombino's own
 * lists in content/bia/restricted/ (see the README there for the format).
 *
 * An item on a list gets its rule, word for word. Anything else — an item not
 * listed, a country with no file yet, no files at all — gets "check with our
 * team" and the contact button. Never a guess: customs rules change, differ
 * by destination and by carrier, and a confident wrong "yes" costs a customer
 * a seized parcel.
 *
 * Files are read on demand and kept for a minute, so a list dropped into the
 * folder goes live without a restart.
 */

import fs from "node:fs";
import path from "node:path";
import type { BiaTool, SupportChatContext, ToolOutcome } from "./supportTypes.js";
import { countryName } from "../shared/biaScreen.js";
import { BOOKABLE_ORIGIN } from "../shared/corridor.js";

export interface RestrictedRow {
  item: string;
  aliases: string[];
  rule: string;
}

const DEFAULT_DIR = path.resolve(process.cwd(), "content", "bia", "restricted");
let listDir = DEFAULT_DIR;
const CACHE_MS = 60_000;
const cache = new Map<string, { at: number; rows: RestrictedRow[] | null }>();

/** Where the lists are read from. Tests point it at a folder of their own. */
export function setRestrictedDir(dir: string | null): void {
  listDir = dir ?? DEFAULT_DIR;
  cache.clear();
}

/** The rows of a list's one table: Item | Also called | Rule. */
export function parseRestrictedTable(markdown: string): RestrictedRow[] {
  const rows: RestrictedRow[] = [];
  for (const line of markdown.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) continue;
    const cells = trimmed.replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
    if (cells.length !== 3) continue;
    const [item, also, rule] = cells;
    if (/^:?-{2,}:?$/.test(item)) continue; // the separator row
    if (item.toLowerCase() === "item" && rule.toLowerCase() === "rule") continue; // the header
    if (!item || !rule) continue;
    rows.push({ item, aliases: also.split(",").map((a) => a.trim()).filter(Boolean), rule });
  }
  return rows;
}

/** One list's rows; null when there is no file, or it has no rows. */
function loadList(name: string): RestrictedRow[] | null {
  // A country code or ALL, nothing else: the name becomes part of a path.
  if (!/^([A-Z]{2}|ALL)$/.test(name)) return null;
  const hit = cache.get(name);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.rows;
  let rows: RestrictedRow[] | null = null;
  try {
    const parsed = parseRestrictedTable(fs.readFileSync(path.join(listDir, `${name}.md`), "utf8"));
    rows = parsed.length > 0 ? parsed : null;
  } catch {
    rows = null;
  }
  cache.set(name, { at: Date.now(), rows });
  return rows;
}

/** "Batteries" and "battery", "mangoes" and "mango", read as one word. */
function stem(word: string): string {
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && /(s|x|z|ch|sh|o)es$/.test(word)) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map(stem);
}

/** Whether a row's name, or any of its other names, appears in the question as whole words. */
export function rowMatches(query: string, row: RestrictedRow): boolean {
  const q = ` ${words(query).join(" ")} `;
  return [row.item, ...row.aliases].some((term) => {
    const t = words(term).join(" ");
    return t.length > 0 && q.includes(` ${t} `);
  });
}

// ─── Countries ───────────────────────────────────────────────────────────────

/** Everyday names Intl doesn't give. */
const COUNTRY_ALIASES: Record<string, string> = {
  usa: "US",
  america: "US",
  "united states of america": "US",
  uk: "GB",
  britain: "GB",
  "great britain": "GB",
  england: "GB",
  scotland: "GB",
  wales: "GB",
  uae: "AE",
  emirates: "AE",
  dubai: "AE",
  "abu dhabi": "AE",
};

let byName: Map<string, string> | null = null;

function countryCodeFor(raw: string): string | null {
  const text = raw.trim();
  if (/^[A-Za-z]{2}$/.test(text)) {
    const code = text.toUpperCase();
    return countryName(code) ? code : null;
  }
  const key = text.toLowerCase().replace(/[^a-z ]+/g, " ").replace(/\s+/g, " ").trim();
  if (COUNTRY_ALIASES[key]) return COUNTRY_ALIASES[key];
  if (!byName) {
    byName = new Map();
    const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    for (const a of letters) {
      for (const b of letters) {
        const name = countryName(a + b);
        if (name) byName.set(name.toLowerCase(), a + b);
      }
    }
  }
  return byName.get(key) ?? null;
}

// ─── can_i_ship ──────────────────────────────────────────────────────────────

const MAX_MATCHES = 3;

const NO_GUESSING =
  "Don't guess whether it's allowed, and don't answer from general customs knowledge: say our team will confirm before they book, and end with the contact button.";

export function executeCanIShip(args: { item?: unknown; country?: unknown }, context: SupportChatContext): ToolOutcome {
  const item = typeof args.item === "string" ? args.item.trim().slice(0, 120) : "";
  if (!item) return { content: "Ask what they want to send." };

  const named = typeof args.country === "string" && args.country.trim() ? countryCodeFor(args.country) : null;
  const code = named ?? context.screen?.destination ?? null;
  if (!code) {
    return {
      content:
        typeof args.country === "string" && args.country.trim()
          ? "That isn't a country this can look up. Ask which country they're sending to."
          : "Ask which country they're sending to; the rules differ by destination.",
    };
  }
  if (code === BOOKABLE_ORIGIN) {
    return { content: "Bombino ships from India to other countries, so there's no list for sending within India. Ask where abroad it's going." };
  }
  const country = countryName(code) ?? code;

  const everywhere = loadList("ALL");
  const forCountry = loadList(code);
  const found = [
    ...(forCountry ?? []).filter((row) => rowMatches(item, row)).map((row) => ({ row, scope: country })),
    ...(everywhere ?? []).filter((row) => rowMatches(item, row)).map((row) => ({ row, scope: "every destination" })),
  ].slice(0, MAX_MATCHES);

  if (found.length > 0) {
    return {
      content: [
        `Bombino's list (${country}):`,
        ...found.map(({ row, scope }) => `- ${row.item} (${scope}): ${row.rule}`),
        "Give them the rule as written; add nothing about customs of your own. If their item may not be what the list means, or the rule depends on details they haven't given, say our team can confirm.",
        "TAP_CONTACT_US",
      ].join("\n"),
    };
  }

  const why = forCountry
    ? `Bombino's list for ${country} doesn't mention "${item}".`
    : `There's no list of restricted items for ${country} yet.`;
  return { content: `${why}\n${NO_GUESSING}\nTAP_CONTACT_US` };
}

export const RESTRICTED_TOOLS: readonly BiaTool[] = [
  {
    module: "booking",
    definition: {
      type: "function",
      function: {
        name: "can_i_ship",
        description:
          "Whether an item can be sent to a country, from Bombino's own lists only. Pass the item as they said it, and the country if they named one (the booking form's destination is used otherwise).",
        parameters: {
          type: "object",
          properties: {
            item: { type: "string", description: "What they want to send, in their words." },
            country: { type: "string", description: "The destination country, by name or two-letter code." },
          },
          required: ["item"],
        },
      },
    },
    run: async (args, context) => executeCanIShip(args, context),
  },
];
