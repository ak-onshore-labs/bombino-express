/**
 * The receiver's endpoints: parcels coming to the number this session proved.
 *
 * A receiver signs in like anyone else (phone + OTP) and is a guest unless the
 * number has an account. Either way the phone they proved is what these routes
 * answer to, and it comes from the session only: a phone in a request would
 * let a caller name someone else's number and be shown their parcels.
 *
 * Read-only by design. The receiver can watch a parcel; everything that changes
 * one (cancel, pay, labels, handover) stays with whoever booked it.
 */

import type { Express, Request, Response } from "express";
import { asyncRoutes } from "../routeGuards.js";
import { OWNER_PROFILES, ownerFrom } from "../sessionOwner.js";
import { getUserContactsByIds } from "../ordersDb.js";
import { isIndianMobile, toIndianMobile } from "../../shared/contact.js";
import { findReceivingParcel, listReceivingParcels, type ReceivingViewer } from "../receivingDb.js";

/**
 * The number this session proved, and its account if it has one. An account's
 * phone is the one on its row; a guest's is the one their ref was minted
 * against. Null for anyone who has not proved a number.
 */
export async function receivingViewerFrom(req: Request): Promise<ReceivingViewer | null> {
  const owner = ownerFrom(req, OWNER_PROFILES.receiving);
  if (!owner) return null;

  let phone: string | null = owner.phone;
  if (owner.kind === "account") {
    const account = (await getUserContactsByIds([owner.userId])).get(owner.userId);
    phone = account?.phone ?? null;
  }
  const ten = phone ? toIndianMobile(phone) : "";
  if (!isIndianMobile(ten)) return null;
  return { phone: ten, userId: owner.kind === "account" ? owner.userId : null };
}

export function registerReceivingRoutes(app: Express): void {
  const routes = asyncRoutes(app);

  routes.get("/api/receiving", async (req: Request, res: Response) => {
    const viewer = await receivingViewerFrom(req);
    if (!viewer) {
      res.status(401).json({ message: "Sign in with your phone number to see parcels coming to you." });
      return;
    }
    const parcels = await listReceivingParcels(viewer);
    if (!parcels) {
      res.status(502).json({ message: "Could not load your incoming parcels. Please try again." });
      return;
    }
    res.json({ parcels });
  });

  routes.get("/api/receiving/:orderNo", async (req: Request, res: Response) => {
    const viewer = await receivingViewerFrom(req);
    if (!viewer) {
      res.status(401).json({ message: "Sign in with your phone number to see parcels coming to you." });
      return;
    }
    const detail = await findReceivingParcel(viewer, String(req.params.orderNo ?? "").trim());
    if (!detail) {
      res.status(404).json({ message: "We could not find that parcel for your number." });
      return;
    }
    res.json(detail);
  });
}
