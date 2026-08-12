// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Building and sending one signed request to an S3-compatible bucket.
//
// ── Why this is `.mjs` ─────────────────────────────────────────────────────
// `node run.mjs media-check` proves a bucket is reachable by really writing,
// reading and deleting a throwaway object, and the scripts in this repo do not
// import TypeScript (CLAUDE.md → "Three systems"). Putting the request building
// here rather than duplicating it in the script is what makes the check worth
// anything: it proves the path the APP uses, not a second implementation that
// happens to work.
//
// `lib/media/s3.ts` is the typed `MediaStore` over this.
import { EMPTY_PAYLOAD_SHA256, sha256Hex, signRequest } from "./sigv4.mjs";

/**
 * The bucket settings, from the environment. Null when they are incomplete.
 *
 * `region` defaults to `auto` because several providers do not care what it
 * says as long as the signature and the request agree — that is what Cloudflare
 * R2 documents.
 */
export function s3SettingsFromEnv(env = process.env) {
  const endpoint = env.MEDIA_S3_ENDPOINT?.trim();
  const bucket = env.MEDIA_S3_BUCKET?.trim();
  const accessKeyId = env.MEDIA_S3_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.MEDIA_S3_SECRET_ACCESS_KEY?.trim();
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null;

  return {
    endpoint: endpoint.replace(/\/+$/, ""),
    region: env.MEDIA_S3_REGION?.trim() || "auto",
    bucket,
    accessKeyId,
    secretAccessKey,
    publicBaseUrl: env.MEDIA_S3_PUBLIC_BASE_URL?.trim().replace(/\/+$/, "") || null,
  };
}

/**
 * Where a key sits, given how this endpoint addresses its bucket.
 *
 * Buckets can be addressed as `https://bucket.host/key` or
 * `https://host/bucket/key`, providers disagree about which they prefer, and a
 * wrong guess is a 404 with no explanation attached. So it is derived rather
 * than configured: if the endpoint's host already begins with the bucket name,
 * the key is the whole path; otherwise the bucket is the first path segment.
 * R2 and Backblaze hand out an endpoint without the bucket, AWS and Spaces
 * accept either, and all of them therefore work with nothing extra to set.
 */
export function objectPath(settings, key) {
  const host = new URL(settings.endpoint).host;
  return host.startsWith(`${settings.bucket}.`) ? `/${key}` : `/${settings.bucket}/${key}`;
}

/**
 * The value `x-amz-copy-source` wants: `/<bucket>/<key>`, each path segment
 * percent-encoded.
 *
 * ⚠️ **Always bucket-prefixed, whatever `objectPath()` decided.** That function
 * answers "where does this key sit on THIS endpoint", and a virtual-hosted
 * endpoint puts the bucket in the host — but a copy source is not a path on the
 * endpoint, it is a reference into the account, and it names its bucket even
 * when the request URL does not.
 *
 * Here rather than in `s3.ts` for the reason at the top of this file: the check
 * command builds this header too, and one builder is one thing that can be
 * right in the app and wrong in the command.
 */
export function copySource(settings, key) {
  const encoded = key.split("/").map(encodeURIComponent).join("/");
  return `/${encodeURIComponent(settings.bucket)}/${encoded}`;
}

export function credentialsFor(settings) {
  return {
    accessKeyId: settings.accessKeyId,
    secretAccessKey: settings.secretAccessKey,
    region: settings.region,
    service: "s3",
  };
}

/**
 * One signed request.
 *
 * The payload hash is the real hash of what is being sent, and S3 re-computes
 * it on arrival — so a body that does not match what was signed is refused.
 * That is an integrity check we get for free, and reaching for
 * `UNSIGNED-PAYLOAD` here to save a pass over the bytes would give it away.
 *
 * ── Why `extraHeaders` exists, rather than a second `fetch` beside this one ──
 * `firstBytes()` needs one header this function did not send before: `Range`.
 * The alternative — building that request next door — was rejected for the
 * reason this file exists at all: `node run.mjs media-check` proves the path
 * the APP uses, and a second request builder is a second thing that can be
 * right here and wrong there. Extra headers are SIGNED as well as sent, so the
 * signature and the request keep agreeing; that is stricter than S3 requires
 * (only `host` and any `x-amz-*` must be signed) and it is the cheaper
 * default — a header that is sent but unsigned is one a proxy may rewrite
 * without the signature noticing.
 */
export async function sendS3(settings, method, key, body, contentType, extraHeaders) {
  const path = objectPath(settings, key);
  const headers = { host: new URL(settings.endpoint).host };
  if (contentType) headers["content-type"] = contentType;
  for (const [name, value] of Object.entries(extraHeaders ?? {})) {
    headers[name.toLowerCase()] = value;
  }

  const signed = signRequest({
    method,
    path,
    query: {},
    headers,
    payloadHash: body ? sha256Hex(body) : EMPTY_PAYLOAD_SHA256,
    credentials: credentialsFor(settings),
    now: new Date(),
  });

  return fetch(`${settings.endpoint}${path}`, {
    method,
    headers: signed.headers,
    body: body ? Buffer.from(body) : undefined,
    // A stray redirect from a misconfigured endpoint drops the Authorization
    // header and produces a 403 that reads exactly like bad credentials.
    redirect: "manual",
  });
}
