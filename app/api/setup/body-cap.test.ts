// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// BOTH doors of the setup surface, in one file — because the finding is that
// they are one door written twice.
//
// M-7 of the 2026-08-18 scan: the body was buffered in full before any
// credential was looked at. `runSetupCall()` → `guardSetup()` is where a key is
// first read, and both routes parsed ahead of it, so a stranger could make the
// app hold an arbitrary number of bytes and then be answered 401. Fixing the
// multipart door and leaving the JSON one is the shape that produced the
// finding, so both are asserted here and a reader who adds a third door has the
// list in front of them.
//
// 🚨 The assertion is on the EFFECT and not on the status code alone:
// `runSetupCall` is mocked and COUNTED. A 400 proves the handler answered; it
// does not prove the bytes never reached the parser, and that was the whole
// point. It is the same reading `app/api/ipn/route.test.ts` takes of its log
// rows.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { ROUTE_HANDLER_BODY_LIMIT_BYTES } from "@/lib/media/rules";

const surface = vi.hoisted(() => ({ on: true, calls: 0 }));

// The two things both routes take from `dispatch.ts`, and nothing else. Mocked
// rather than stubbed around, because the real `runSetupCall()` reaches the
// database on its first line and the question here is whether it is reached at
// all.
vi.mock("@/lib/setup/dispatch", () => ({
  surfaceOffResponse: () => (surface.on ? null : new Response(null, { status: 404 })),
  runSetupCall: async () => {
    surface.calls += 1;
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  },
}));

import { POST as jsonDoor } from "./route";
import { POST as mediaDoor } from "./media/route";

const JSON_CAP = 256 * 1024;
const MEDIA_ENVELOPE_CAP = ROUTE_HANDLER_BODY_LIMIT_BYTES + 1024 * 1024;

/** A JSON call, optionally lying about how big it is. */
function jsonCall(body: string, announce?: number) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (announce !== undefined) headers["content-length"] = String(announce);
  return jsonDoor(
    new Request("https://app.example.com/api/setup", { method: "POST", body, headers }),
  );
}

/** A multipart call carrying `size` bytes as the file part. */
function mediaCall(size: number, announce?: number) {
  const form = new FormData();
  form.set("tool", "media_upload");
  form.set("env", "development");
  form.set("mode", "plan");
  form.set("input", JSON.stringify({ path: "/tmp/x.png" }));
  form.set("file", new File([new Uint8Array(size)], "x.png", { type: "image/png" }));
  const request = new Request("https://app.example.com/api/setup/media", {
    method: "POST",
    body: form,
  });
  if (announce !== undefined) request.headers.set("content-length", String(announce));
  return mediaDoor(request);
}

/** Every refusal here has to be the answer the door already gave a bad body. */
async function shapeOf(response: Response) {
  return { status: response.status, body: await response.json() };
}

beforeEach(() => {
  surface.on = true;
  surface.calls = 0;
});

describe("the JSON door", () => {
  it("lets a real call through — the cap must not break the operator's path", async () => {
    const response = await jsonCall(
      JSON.stringify({ tool: "account_create", env: "development", mode: "plan", input: {} }),
    );
    expect(response.status).toBe(200);
    expect(surface.calls).toBe(1);
  });

  it("🚨 refuses on the announced length alone, before the body is parsed (M-7)", async () => {
    // A tiny body with a huge `content-length`. If the handler read first and
    // measured what it got, this would sail through the cap — which is exactly
    // what it did before the fix, for any size at all.
    const response = await jsonCall("{}", 900 * 1024 * 1024);

    expect(await shapeOf(response)).toEqual({
      status: 400,
      body: { error: "badRequest", detail: "Body too large." },
    });
    // The point of the whole exercise: nothing downstream was reached.
    expect(surface.calls).toBe(0);
  });

  it("🚨 refuses a body that arrives oversized without announcing it (M-7)", async () => {
    const response = await jsonCall(JSON.stringify({ pad: "A".repeat(JSON_CAP) }));
    expect(response.status).toBe(400);
    expect(surface.calls).toBe(0);
  });

  it("counts BYTES, not UTF-16 units", async () => {
    // "€" is three bytes and one unit. Measuring `raw.length` would see a third
    // of the real size and let roughly 3x the cap through.
    const body = JSON.stringify({ pad: "€".repeat(JSON_CAP / 2) });
    expect(body.length).toBeLessThan(JSON_CAP);
    expect(Buffer.byteLength(body)).toBeGreaterThan(JSON_CAP);

    expect((await jsonCall(body)).status).toBe(400);
    expect(surface.calls).toBe(0);
  });

  it("🚨 answers a refusal a stranger cannot tell from the ordinary one", async () => {
    // The cap must not become an oracle. `badRequest` with a detail line is
    // what this door already answers a body it cannot parse, so an outsider
    // sizing bodies learns nothing they could not learn by posting garbage.
    const oversized = await shapeOf(await jsonCall("{}", 900 * 1024 * 1024));
    const garbage = await shapeOf(await jsonCall("not json at all"));
    expect(oversized.status).toBe(garbage.status);
    expect((oversized.body as { error: string }).error).toBe(
      (garbage.body as { error: string }).error,
    );
  });

  it("🚨 the switched-off 404 still comes FIRST", async () => {
    // While the surface is off it must look exactly like a route that was never
    // built. A 400 about a body size would say out loud that something here
    // reads bodies — the same argument `surfaceOffResponse()` makes.
    surface.on = false;
    const response = await jsonCall("{}", 900 * 1024 * 1024);
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
    expect(surface.calls).toBe(0);
  });

  it("still answers a malformed body the way it always did", async () => {
    const response = await jsonCall("{oops");
    expect(await shapeOf(response)).toEqual({
      status: 400,
      body: { error: "badRequest", detail: "Body must be JSON." },
    });
  });

  it("still refuses a JSON array — the shape check survived the rewrite", async () => {
    const response = await jsonCall("[1,2,3]");
    expect(await shapeOf(response)).toEqual({
      status: 400,
      body: { error: "badRequest", detail: "Body must be a JSON object." },
    });
  });
});

describe("the multipart door", () => {
  it("lets a real upload through", async () => {
    const response = await mediaCall(2048);
    expect(response.status).toBe(200);
    expect(surface.calls).toBe(1);
  });

  it("🚨 refuses on the announced length alone, before formData() (M-7)", async () => {
    // A two-kilobyte form claiming to be 900 MB. Before the fix `formData()`
    // ran first and this was simply parsed.
    const response = await mediaCall(2048, 900 * 1024 * 1024);

    expect(await shapeOf(response)).toEqual({
      status: 400,
      body: { error: "badRequest", detail: "Body too large." },
    });
    expect(surface.calls).toBe(0);
  });

  it("🚨 refuses a file over the route-handler ceiling on its real size (M-7)", async () => {
    // Announced honestly and under the envelope cap, so only the measurement of
    // what actually arrived can catch it. `refuseUpload()` would have let this
    // through: it measures against the kind's raw `maxBytes`, and `video` is
    // 2 GB for the direct-to-bucket path.
    const size = ROUTE_HANDLER_BODY_LIMIT_BYTES + 1;
    expect(size).toBeLessThan(MEDIA_ENVELOPE_CAP);

    const response = await mediaCall(size);
    expect(response.status).toBe(400);
    expect(surface.calls).toBe(0);
  });

  it("🚨 the switched-off 404 still comes FIRST here too", async () => {
    surface.on = false;
    const response = await mediaCall(2048, 900 * 1024 * 1024);
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
    expect(surface.calls).toBe(0);
  });

  it("still answers a body that is not multipart the way it always did", async () => {
    const response = await mediaDoor(
      new Request("https://app.example.com/api/setup/media", {
        method: "POST",
        body: "plain text",
        headers: { "content-type": "text/plain" },
      }),
    );
    expect(await shapeOf(response)).toEqual({
      status: 400,
      body: { error: "badRequest", detail: "Body must be multipart/form-data." },
    });
  });

  it("still demands the file part", async () => {
    const form = new FormData();
    form.set("tool", "media_upload");
    const response = await mediaDoor(
      new Request("https://app.example.com/api/setup/media", { method: "POST", body: form }),
    );
    expect(response.status).toBe(400);
    expect(surface.calls).toBe(0);
  });
});
