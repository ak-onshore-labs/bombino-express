/**
 * BIA's modules: the parts of what BIA knows and can do, switched on per
 * release with BIA_MODULES so a module that is still being built never
 * reaches customers.
 *
 *   general     rates, tracking, pickup checks, the identity document on file,
 *               how-to answers, reaching our team. Always on.
 *   orders      the customer's own orders and shipments (BIA 2.0).
 *   onboarding  choosing an account and signing up (R2).
 *   documents   identity numbers, uploads and their checks (R2).
 *   booking     the Create Shipment form (R3).
 *
 * Explaining an error the customer has just seen doesn't belong to a module:
 * it comes from the error catalog through the screen context, and works
 * whichever modules are on.
 */

import type { BiaSurface } from "./biaScreen.js";

export const BIA_MODULES = ["orders", "onboarding", "documents", "booking"] as const;

export type BiaModule = (typeof BIA_MODULES)[number];

/** A tool or prompt section belongs to a module, or to the always-on core. */
export type BiaModuleOrGeneral = BiaModule | "general";

/** What is on when BIA_MODULES is not set: what customers have today. */
export const DEFAULT_BIA_MODULES: readonly BiaModule[] = ["orders"];

/**
 * The modules a screen is about. A screen not listed here, or listed with
 * none, is a general one (home, help, tracking, rates): every enabled module
 * applies there.
 */
export const SURFACE_MODULES: Partial<Record<BiaSurface, readonly BiaModule[]>> = {
  orders: ["orders"],
  order: ["orders"],
  guest_profile: ["orders"],
  signup: ["onboarding", "documents"],
  documents: ["documents"],
  create: ["booking"],
};

export function isBiaModule(value: unknown): value is BiaModule {
  return typeof value === "string" && (BIA_MODULES as readonly string[]).includes(value);
}

/**
 * BIA_MODULES as written in the environment: a comma-separated list, e.g.
 * "orders,onboarding". Unknown names are ignored. Unset or empty means the
 * default, so a deploy that forgets it gets what customers already have.
 */
export function parseBiaModules(raw: string | undefined | null): BiaModule[] {
  if (!raw || !raw.trim()) return [...DEFAULT_BIA_MODULES];
  const wanted = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(isBiaModule);
  return BIA_MODULES.filter((m) => wanted.includes(m));
}

/**
 * The modules that apply to one turn: those enabled, narrowed to the screen's
 * own when it has any. Orders stay in on every screen, since a customer on the
 * booking form can still ask where their last parcel is.
 */
export function modulesForScreen(surface: BiaSurface | null | undefined, enabled: readonly BiaModule[]): BiaModule[] {
  const own = surface ? SURFACE_MODULES[surface] : undefined;
  if (!own || own.length === 0) return [...enabled];
  return enabled.filter((m) => m === "orders" || own.includes(m));
}
