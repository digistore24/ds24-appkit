// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Checks the media layer — where files go, whether that place answers, and what
// this app will and will not accept.
//
//   node run.mjs media-check
//
// Four jobs, and the second is the one nothing else can do for you:
//
//  1. **The driver.** Which store this machine is set to, and — the question
//     that actually bites — whether it is one that survives a redeploy.
//  2. **A real round trip.** It writes a throwaway object, reads it back,
//     compares the bytes and deletes it. Credentials that look right and a
//     bucket that does not exist are indistinguishable until something tries,
//     and "tries" is the whole point of this command. It signs through
//     `lib/media/s3-request.mjs`, which is the same code the app uses — a check
//     with its own second implementation proves that the second implementation
//     works.
//  3. **The rules.** What may be uploaded, by whom, how large, and how long a
//     private address stays valid. Printed because the numbers are a product
//     decision somebody made once and nobody remembers.
//  4. **Delivery.** Whether public files reach visitors without touching the
//     app at all, which is the difference between a bucket and a bottleneck.
//
// Plain Node, no bundler, no TypeScript, no dependency — it has to run on
// Linux, macOS and in a Git Bash on Windows (CLAUDE.md, "Three systems").
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

import { copySource, objectPath, s3SettingsFromEnv, sendS3 } from "../../lib/media/s3-request.mjs";
import { refusedTypes } from "../../lib/media/strip-rules.mjs";
import "../lib/env.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

let failed = false;

function ok(line) {
  console.log(`  ✓ ${line}`);
}
function warn(line) {
  console.log(`  ! ${line}`);
}
function bad(line) {
  console.log(`  ✗ ${line}`);
  failed = true;
}

function mb(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(bytes % (1024 * 1024) === 0 ? 0 : 1)} MB`;
}

function duration(seconds) {
  if (seconds >= 3600) return `${Math.round(seconds / 3600)} h`;
  if (seconds >= 60) return `${Math.round(seconds / 60)} min`;
  return `${seconds} s`;
}

async function readConfig() {
  try {
    return JSON.parse(await readFile(join(ROOT, "config/media.json"), "utf8"));
  } catch (error) {
    bad(`config/media.json could not be read: ${error.message}`);
    return null;
  }
}

/** Is this a real environment, where a local disk is not storage? */
function isRealEnvironment(value) {
  const v = (value ?? "").trim().toLowerCase();
  return !(v === "" || v === "development" || v === "dev" || v === "local");
}

async function checkLocal() {
  const dir = resolve(ROOT, process.env.MEDIA_LOCAL_DIR?.trim() || ".data/media");
  const key = `.media-check/${randomUUID()}.txt`;
  const target = join(dir, key);
  const payload = Buffer.from(`media-check ${new Date().toISOString()}\n`);

  try {
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, payload);
    const back = await readFile(target);
    if (!back.equals(payload)) {
      bad("wrote a file and read something else back");
      return;
    }
    await rm(target, { force: true });
    ok(`wrote, read and deleted a test file in ${dir}`);
  } catch (error) {
    bad(`cannot write to ${dir}: ${error.message}`);
  }

  // 🚨 Spoken, never silent. The CORS question belongs to a bucket and there is
  // none here, so it cannot be answered — and a check that simply does not run
  // reads exactly like a check that passed. This driver has no direct path at
  // all (`createUploadUrl()` answers null), which is the honest thing to say.
  warn(
    "no bucket, so the direct-to-bucket path and its CORS rule are NOT checked — " +
      "on this driver there is no address a browser could write to",
  );
}

async function checkS3() {
  const settings = s3SettingsFromEnv();
  if (!settings) {
    bad(
      "MEDIA_DRIVER=s3, but the bucket is not configured. Needs " +
        "MEDIA_S3_ENDPOINT, MEDIA_S3_BUCKET, MEDIA_S3_ACCESS_KEY_ID and " +
        "MEDIA_S3_SECRET_ACCESS_KEY — see .env.example",
    );
    return null;
  }

  // An endpoint carrying a path segment produces `/bucket/bucket/key` while the
  // signature covers `/bucket/key` — a 403 on everything, with nothing anywhere
  // saying why. Caught here because it is a one-line mistake in a `.env`.
  try {
    const url = new URL(settings.endpoint);
    if (url.pathname !== "/" && url.pathname !== "") {
      bad(
        `MEDIA_S3_ENDPOINT is "${settings.endpoint}" — it must be an ORIGIN with no ` +
          `path. The bucket name goes in MEDIA_S3_BUCKET, and a path here is signed ` +
          `differently from the one the request uses, so everything answers 403.`,
      );
      return settings;
    }
  } catch {
    bad(`MEDIA_S3_ENDPOINT is not a URL: "${settings.endpoint}"`);
    return null;
  }

  ok(`bucket "${settings.bucket}" at ${settings.endpoint}`);

  // ── The region, and why it is a sentence rather than a value in brackets ───
  // This line used to read `(region auto)` and count as information.
  // `MEDIA_S3_REGION` defaults to `auto` (`lib/media/s3-request.mjs`) because
  // that is what Cloudflare R2 documents — and for a provider that VALIDATES
  // the string, which AWS, Wasabi and Backblaze B2 all do, an unset region is a
  // 403 on the first upload: after the customer chose the file, after it
  // travelled, with `SignatureDoesNotMatch` as the only clue and the credentials
  // as the obvious suspect.
  //
  // 🚨 **It is said HERE and not in `lib/env-guard.ts`, deliberately.** The app
  // cannot tell which provider it is talking to — `objectPath()` infers the
  // ADDRESSING STYLE from the host and nothing infers the vendor — so a start-up
  // refusal would have to guess, and a wrong guess refuses a working R2 setup.
  // This command writes, reads, copies and deletes a real object, so a wrong
  // region already surfaces here as a failure; what was missing was the
  // sentence that tells somebody where to look. Same argument `mediaProblem()`
  // makes for an app that takes no media at all.
  //
  // ⚠️ It is a `!` and not a `✗` on purpose: `auto` is CORRECT on two of the
  // providers this app carries, so failing the command on it would refuse a
  // working R2 setup — the same wrong direction the start-up guard would take,
  // one command further out.
  if (process.env.MEDIA_S3_REGION?.trim()) {
    ok(`region "${settings.region}", as set in MEDIA_S3_REGION`);
  } else {
    warn(
      `MEDIA_S3_REGION is not set, so the signature says "auto". That is correct for ` +
        `Cloudflare R2 and for MinIO; AWS S3, Wasabi and Backblaze B2 VALIDATE it and answer ` +
        `403 without it. The round trip below is what settles it for your provider — if it is ` +
        `green, "auto" is fine here; set the region anyway before go-live if your provider ` +
        `documents one (docs/DEPLOY.md lists it as required for everything except R2).`,
    );
  }

  const key = `.media-check/${randomUUID()}.txt`;
  const payload = Buffer.from(`media-check ${new Date().toISOString()}\n`);

  let written = false;
  let copied = null;
  try {
    const put = await sendS3(settings, "PUT", key, payload, "text/plain");
    if (!put.ok) {
      const body = (await put.text()).slice(0, 300);
      bad(`writing failed (HTTP ${put.status}) ${body}`);
      // The provider's own error code is the useful part, so it is printed
      // above rather than swallowed. `SignatureDoesNotMatch` means the
      // credentials or the clock; `NoSuchBucket` means the name or the region.
      return settings;
    }
    written = true;
    ok("wrote a test object");

    const get = await sendS3(settings, "GET", key);
    if (!get.ok) {
      bad(`reading it back failed (HTTP ${get.status})`);
    } else {
      const back = Buffer.from(await get.arrayBuffer());
      if (back.equals(payload)) ok("read it back, byte for byte");
      else bad("read it back and the bytes differ");
    }

    // ── The server-side copy ──────────────────────────────────────────────
    // Not a nicety on this list: it is the step that makes the direct-to-bucket
    // path's checks a promise instead of a snapshot. The browser writes to a
    // staging key, the app measures and sniffs THAT object and then copies it
    // onto the delivery key, so a presigned address that is replayed later
    // reaches a key nothing serves. A provider that refuses `CopyObject` breaks
    // that path and nothing else here would notice.
    copied = `${key}.copy`;
    const copy = await sendS3(settings, "PUT", copied, undefined, "text/plain", {
      "x-amz-copy-source": copySource(settings, key),
      "x-amz-metadata-directive": "REPLACE",
    });
    // A CopyObject can fail with a 200 and the outcome in the body — the app
    // checks for that too, and a check that did not would report a working
    // path on a provider where it is broken.
    const copyBody = copy.ok ? await copy.text() : "";
    if (!copy.ok) {
      copied = null;
      bad(
        `the bucket refused a server-side copy (HTTP ${copy.status}). The direct-to-bucket ` +
          `upload path needs it — the confirm step copies the object it checked onto the ` +
          `key it serves.`,
      );
    } else if (/<Error[\s>]/.test(copyBody)) {
      bad(`the bucket answered 200 to a copy and failed in the body: ${copyBody.slice(0, 200)}`);
    } else {
      ok("copied it server-side, which is what the direct upload path confirms with");
    }
  } catch (error) {
    bad(`the bucket is not reachable: ${error.message}`);
  } finally {
    for (const doomed of [written ? key : null, copied]) {
      if (!doomed) continue;
      try {
        const del = await sendS3(settings, "DELETE", doomed);
        if (del.ok || del.status === 404) ok(`deleted ${doomed === key ? "it" : "the copy"} again`);
        else bad(`could not delete the test object (HTTP ${del.status}) — key ${doomed}`);
      } catch (error) {
        bad(`could not delete the test object: ${error.message} — key ${doomed}`);
      }
    }
  }

  await checkCors(settings);
  return settings;
}

/**
 * Does the bucket let a BROWSER write to it from this app's address?
 *
 * The direct-to-bucket path is three steps and the first two happen in the
 * browser, so a missing CORS rule is refused by the browser before the request
 * is sent — no log line here, no request at the bucket, and an error in the
 * console that names neither. It is the one failure of that path nothing else
 * in this repo can see.
 *
 * 🚨 **A warning, never a failure, and the exit code does not move.** The rule
 * belongs to the bucket, not to this repo: it is set in a provider's dashboard
 * or with their CLI, and plenty of apps never use the direct path at all. A
 * gate here would be a gate on somebody else's configuration, and a gate in the
 * way is one that eventually gets removed — taking the intent with it.
 */
async function checkCors(settings) {
  const origin = (process.env.APP_URL || "").trim().replace(/\/+$/, "");
  if (!origin || !/^https?:\/\//.test(origin)) {
    warn("APP_URL is not set, so the bucket's CORS rule cannot be checked");
    return;
  }

  try {
    // A preflight, exactly as a browser would send it before a presigned PUT.
    // Unsigned on purpose: CORS is answered before authorisation, and signing
    // it would test a different question.
    const response = await fetch(`${settings.endpoint}${objectPath(settings, ".media-check/cors")}`, {
      method: "OPTIONS",
      headers: {
        origin,
        "access-control-request-method": "PUT",
        "access-control-request-headers": "content-type",
      },
      redirect: "manual",
    });
    const allowed = response.headers.get("access-control-allow-origin");
    if (allowed === origin || allowed === "*") {
      if (allowed === "*") {
        warn(`the bucket allows uploads from ANY origin ("*") — narrow it to ${origin}`);
      } else {
        ok(`the bucket accepts browser uploads from ${origin}`);
      }
      return;
    }
    warn(
      `the bucket does not answer a browser upload from ${origin}` +
        (allowed ? ` (it allows "${allowed}")` : "") +
        " — the direct-to-bucket path will fail in the browser with no useful error. " +
        "docs/visuals.md has the rule to paste.",
    );
  } catch (error) {
    warn(`could not ask the bucket about CORS: ${error.message}`);
  }
}

async function main() {
  const config = await readConfig();
  const driver = (process.env.MEDIA_DRIVER ?? "").trim().toLowerCase() || "local";
  const realEnvironment = isRealEnvironment(process.env.APP_ENV);
  const mediaOff = config?.enabled === false;

  console.log("\nWhere files go\n");

  if (mediaOff) {
    // The app is allowed to start without a bucket in this state
    // (`lib/env-guard.ts`), which is why this command has to be the one that
    // says it — otherwise switching media on later is a change nothing checks.
    warn(
      'config/media.json has "enabled": false, so this app accepts and serves ' +
        "no files. That is why it may deploy without a bucket. The moment you " +
        "set it to true, the storage below has to be real.",
    );
  }

  if (driver === "local") {
    if (realEnvironment && !mediaOff) {
      // The single most consequential thing this command can say.
      bad(
        `APP_ENV=${process.env.APP_ENV} with MEDIA_DRIVER unset or "local". ` +
          "Files would go on this machine's disk: the next redeploy loses them " +
          "all, and a second instance cannot see what the first one wrote — so " +
          "a customer's picture is there about half the time and nobody can " +
          "reproduce it. The app refuses to start like this. Book a bucket " +
          "(the `setup-hosting` skill does it) and set MEDIA_DRIVER=s3.",
      );
    } else {
      ok("driver: local disk — fine for development, and only for development");
      if (!mediaOff) {
        warn("before going online this has to become a bucket, or the app will not start");
      }
    }
    await checkLocal();
  } else if (driver === "s3") {
    ok("driver: object storage — survives a redeploy and a second instance");
    const settings = await checkS3();

    console.log("\nHow visitors get them\n");
    if (settings?.publicBaseUrl) {
      ok(
        `public files: straight from ${settings.publicBaseUrl} — no request ` +
          "reaches your app",
      );
    } else {
      warn(
        "MEDIA_S3_PUBLIC_BASE_URL is not set, so even public files are served " +
          "through a signed address. That works. Setting it (a CDN or a custom " +
          "domain on the bucket) makes product images cacheable and cheaper.",
      );
    }
    ok(
      "private files: the page decides who may see them, then the bucket " +
        "serves the bytes. Your app never carries them",
    );
  } else {
    bad(`MEDIA_DRIVER="${driver}" is not a driver. Use "s3", or "local" in development.`);
  }

  if (!config) {
    console.log("");
    process.exit(1);
  }

  console.log("\nWhat may go in\n");

  const kinds = config.kinds ?? {};
  // The types that SURVIVE `refusedTypes()`, not the ones written in the file.
  // This command used to print the raw list, so an operator who had added
  // `image/gif` was told it was accepted while every upload of one was refused
  // — the app and the command disagreeing about the same config, which is what
  // `lib/media/strip-rules.mjs` now exists to prevent.
  const refused = [];
  const accepted = {};
  for (const [kind, rule] of Object.entries(kinds)) {
    if (kind.startsWith("_")) continue;
    const declared = rule.mimeTypes ?? [];
    const dropped = refusedTypes(kind, declared);
    for (const entry of dropped) refused.push({ kind, ...entry });
    accepted[kind] = declared.filter((mime) => !dropped.some((d) => d.mime === mime));
    console.log(
      `  ${kind.padEnd(6)} up to ${mb(rule.maxBytes).padStart(8)}   ` +
        `address valid ${duration(rule.signedUrlSeconds).padStart(6)}   ` +
        `${accepted[kind].join(", ")}`,
    );
  }

  // Said here rather than left to be discovered by a refused upload. It is NOT
  // fatal and must not become so: the app keeps running and keeps delivering
  // what is already stored — only uploads of this type are refused.
  for (const { kind, mime, why } of refused) {
    warn(
      `config/media.json lists "${mime}" under kinds.${kind}, and it is NOT accepted: ` +
        `${why}. Uploads of it are refused; files already stored are unaffected.`,
    );
  }

  console.log("");
  // The DECLARED types, not the accepted ones — the same choice
  // `mediaConfigProblems()` makes and for the same reason. Checking against the
  // accepted list would report `image/gif` a second time, as "belongs to no
  // kind", and send the operator to add it back to a kind — the opposite of
  // the fix, and marked fatal where the real answer is the warning above.
  const known = new Set(
    Object.entries(kinds)
      .filter(([k]) => !k.startsWith("_"))
      .flatMap(([, rule]) => rule.mimeTypes ?? []),
  );
  for (const [role, list] of Object.entries(config.mayUpload ?? {})) {
    if (role.startsWith("_")) continue;
    console.log(`  ${role.padEnd(6)} may upload: ${list.join(", ")}`);
    for (const mime of list) {
      if (!known.has(mime)) {
        bad(
          `mayUpload.${role} allows "${mime}", which belongs to no kind — ` +
            "nobody could ever upload it",
        );
      }
    }
  }

  // The honest limit, stated every time rather than left in a document.
  console.log("");
  warn(
    "through the app an upload stops well below the ceilings above — at 10 MB " +
      "from a form on one of your pages (a Server Action body) and at 50 MB " +
      "through /api/media and /api/v1/media (what a route handler of this app " +
      "buffers). Past that the browser writes straight to the bucket " +
      "(/api/media/upload-url → PUT → /api/media/confirm), and the ceilings " +
      "above are that path's. Pictures always take the first route: location " +
      "data comes off them, and that needs the bytes in the app. " +
      "docs/visuals.md walks all three.",
  );
  warn(
    "location and camera data are stripped from uploaded IMAGES. Video keeps " +
      "whatever the recording device wrote (docs/data-protection.md).",
  );

  console.log("");
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(`\n✗ media-check failed: ${error.message}\n`);
  process.exit(1);
});
