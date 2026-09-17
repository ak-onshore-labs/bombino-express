import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express, { type NextFunction, type Request, type Response } from "express";

// Without the wrapper Express 4 drops the rejection: the request hangs until
// the client gives up and the process takes an unhandledRejection. That is not
// asserted here — a route that does it would fail the runner on its own — but
// it is what these tests exist to prevent.

// No database: these routes never reach one.
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
const { asyncRoute, asyncRoutes } = await import("./routeGuards.js");

let server: Server;
let base = "";

before(async () => {
  const app = express();

  app.get(
    "/wrapped",
    asyncRoute(async () => {
      throw new Error("ITD said no");
    })
  );

  const routes = asyncRoutes(app);
  routes.get("/router/throws", async () => {
    throw new Error("Razorpay said no");
  });
  routes.get("/router/answers", async (_req: Request, res: Response) => {
    res.json({ ok: true });
  });
  routes.post("/router/guarded", (_req, _res, next) => next(), async (_req, res) => {
    res.status(201).json({ made: true });
  });

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ message: err.message });
  });

  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server.close();
});

test("a wrapped handler's rejection reaches the error middleware", async () => {
  const res = await fetch(`${base}/wrapped`);
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { message: "ITD said no" });
});

test("every route the router mounts is wrapped, without saying so each time", async () => {
  const res = await fetch(`${base}/router/throws`);
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { message: "Razorpay said no" });
});

test("a handler that answers is untouched", async () => {
  const res = await fetch(`${base}/router/answers`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
});

test("middleware in front of the handler still runs in order", async () => {
  const res = await fetch(`${base}/router/guarded`, { method: "POST" });
  assert.equal(res.status, 201);
  assert.deepEqual(await res.json(), { made: true });
});
