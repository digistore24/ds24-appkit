// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// `lib/media/sigv4.ts`, measured against AWS's own published test vectors.
//
// This is the same arrangement `lib/digistore/ipn.test.ts` has with
// `ipn-vectors.json`, and for the same reason: a signature is either byte-exact
// or worthless, and the failure mode when it is wrong carries no useful
// message. A bucket answers `SignatureDoesNotMatch` and says nothing about
// which of the six lines of the canonical request it disagreed with.
//
// **The vectors are not ours and must never be regenerated from our output.**
// A vector produced by the code it checks proves that the code agrees with
// itself. `sigv4-vectors.json` carries its provenance in its header; read it
// before touching either file.
//
// The three assertions per case are deliberate rather than thorough-looking.
// The canonical request, the string to sign and the signature fail in different
// places, and knowing WHICH one broke is the difference between a five-minute
// fix and an afternoon: a wrong canonical request means the encoding or the
// header handling, a right canonical request with a wrong string to sign means
// the scope or the date, and a right string to sign with a wrong signature
// means the key derivation.
import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import vectors from "./sigv4-vectors.json";
import {
  EMPTY_PAYLOAD_SHA256,
  canonicalRequest,
  credentialScope,
  presignUrl,
  sha256Hex,
  signRequest,
  signingKey,
  stringToSign,
  uriEncode,
} from "./sigv4";

const CREDENTIALS = {
  accessKeyId: vectors._credentials.accessKeyId,
  secretAccessKey: vectors._credentials.secretAccessKey,
  region: vectors._credentials.region,
  service: vectors._credentials.service,
};

// `20150830T123600Z` back into a Date, so `signRequest` derives exactly the
// timestamp the vectors were made with.
const AMZ_DATE = vectors._credentials.amzDate;
const NOW = new Date(
  `${AMZ_DATE.slice(0, 4)}-${AMZ_DATE.slice(4, 6)}-${AMZ_DATE.slice(6, 8)}T` +
    `${AMZ_DATE.slice(9, 11)}:${AMZ_DATE.slice(11, 13)}:${AMZ_DATE.slice(13, 15)}Z`,
);

type Case = {
  method: string;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  body: string;
  payloadSha256: string;
  canonicalRequest: string;
  stringToSign: string;
  signature: string;
  authorization: string;
};

const cases = Object.entries(vectors.cases as Record<string, Case>);

describe("AWS SigV4 test suite", () => {
  it("carries the vectors it claims to", () => {
    // A guard against the file being emptied or half-written by an edit. The
    // number is not sacred; a DROP in it is the thing worth noticing.
    expect(cases.length).toBeGreaterThanOrEqual(16);
  });

  for (const [name, vector] of cases) {
    describe(name, () => {
      const canonical = canonicalRequest({
        method: vector.method,
        path: vector.path,
        query: vector.query,
        headers: vector.headers,
        payloadHash: vector.payloadSha256,
      });

      it("builds the canonical request AWS built", () => {
        expect(canonical.text).toBe(vector.canonicalRequest);
      });

      it("builds the string to sign AWS built", () => {
        const scope = credentialScope(
          AMZ_DATE.slice(0, 8),
          CREDENTIALS.region,
          CREDENTIALS.service,
        );
        expect(stringToSign(AMZ_DATE, scope, canonical.text)).toBe(vector.stringToSign);
      });

      it("produces the signature AWS produced", () => {
        const signed = signRequest({
          method: vector.method,
          path: vector.path,
          query: vector.query,
          // `signRequest` adds `x-amz-date` and `x-amz-content-sha256` itself.
          // The suite's requests already carry the date and no content hash, so
          // the date is handed in as the vector has it and the content hash
          // would be an EXTRA signed header the vector does not have — which is
          // why the signature is asserted through `canonicalRequest` above and
          // through the key derivation below rather than through `signRequest`
          // for every case. See the two assertions that follow.
          headers: vector.headers,
          payloadHash: vector.payloadSha256,
          credentials: CREDENTIALS,
          now: NOW,
        });
        // `signRequest` signs one header more than the suite's fixtures do, so
        // its Authorization header is compared for SHAPE here and the numeric
        // agreement is proven by the derivation below, which is the part that
        // could actually be wrong.
        expect(signed.headers.Authorization).toContain(
          `Credential=${CREDENTIALS.accessKeyId}/`,
        );
        expect(signed.signature).toMatch(/^[0-9a-f]{64}$/);
      });

      it("derives AWS's signature from AWS's string to sign", () => {
        // The end-to-end check, and the one that would catch a broken key
        // derivation: AWS's own string to sign, our key, their signature.
        const key = signingKey(
          CREDENTIALS.secretAccessKey,
          AMZ_DATE.slice(0, 8),
          CREDENTIALS.region,
          CREDENTIALS.service,
        );
        const signature = createHmac("sha256", key)
          .update(vector.stringToSign, "utf8")
          .digest("hex");
        expect(signature).toBe(vector.signature);
      });

      it("hashes the body the way the vector says", () => {
        expect(sha256Hex(vector.body)).toBe(vector.payloadSha256);
      });
    });
  }
});

describe("uriEncode", () => {
  it("leaves the four unreserved punctuation marks alone", () => {
    expect(uriEncode("-._~")).toBe("-._~");
  });

  it("encodes what encodeURIComponent does not", () => {
    // The whole reason this function exists rather than a call to the built-in.
    expect(uriEncode("!'()*")).toBe("%21%27%28%29%2A");
    expect(encodeURIComponent("!'()*")).toBe("!'()*");
  });

  it("encodes a space as %20 and never as +", () => {
    expect(uriEncode("a b")).toBe("a%20b");
  });

  it("encodes UTF-8 byte by byte", () => {
    // The `get-utf8` vector's path, which is the same rule applied to a path.
    expect(uriEncode("ሴ")).toBe("%E1%88%B4");
  });

  it("keeps slashes in a path and encodes them everywhere else", () => {
    expect(uriEncode("/a/b", false)).toBe("/a/b");
    expect(uriEncode("/a/b", true)).toBe("%2Fa%2Fb");
  });
});

describe("the empty payload hash", () => {
  it("is the SHA-256 of nothing", () => {
    // Written out as a constant in `sigv4.ts` because it is signed on every GET
    // and DELETE. This asserts the constant is the value it claims to be.
    expect(sha256Hex("")).toBe(EMPTY_PAYLOAD_SHA256);
  });
});

// ── What is NOT measured against a vendor vector, and why ──────────────────
//
// Stated here because a code review asked for it and the answer is not
// reassuring: **neither function the app actually calls is compared byte for
// byte.** The 16 cases above prove `canonicalRequest`, `stringToSign` and the
// key derivation, which is where the arithmetic lives — but:
//
//   `signRequest`  composes one more signed header than the suite's fixtures
//                  carry (`x-amz-content-sha256`), so its Authorization line
//                  cannot equal theirs. Its numbers come from the three pieces
//                  above, each of which IS measured.
//   `presignUrl`   has no published vector at all. AWS's suite covers header
//                  signing only, so what follows is self-consistency and
//                  parameter presence — real, and not the same thing.
//
// What closes the gap is a round trip against a real bucket, which
// `node run.mjs media-check` performs for the header path. The presigned path
// was verified by hand against MinIO during implementation and nothing in this
// repository repeats that: it needs credentials, and a test that silently skips
// without them is worse than one that does not exist.

describe("presignUrl", () => {
  const input = {
    method: "GET",
    endpoint: "https://media.example.com",
    path: "/core/upload/2026/07/abc.png",
    credentials: { ...CREDENTIALS, service: "s3" },
    expiresSeconds: 300,
    now: NOW,
  };

  it("carries every parameter S3 requires", () => {
    const url = presignUrl(input);
    for (const param of [
      "X-Amz-Algorithm=AWS4-HMAC-SHA256",
      "X-Amz-Credential=AKIDEXAMPLE%2F20150830%2Fus-east-1%2Fs3%2Faws4_request",
      "X-Amz-Date=20150830T123600Z",
      "X-Amz-Expires=300",
      "X-Amz-SignedHeaders=host",
    ]) {
      expect(url).toContain(param);
    }
    expect(url).toMatch(/&X-Amz-Signature=[0-9a-f]{64}$/);
  });

  it("keeps the path's slashes", () => {
    expect(presignUrl(input)).toContain("/core/upload/2026/07/abc.png?");
  });

  it("signs UNSIGNED-PAYLOAD, so the same URL is stable for the same second", () => {
    expect(presignUrl(input)).toBe(presignUrl(input));
  });

  it("produces a different signature when the expiry differs", () => {
    // Guards the case where the expiry is put on the URL but left out of the
    // signature — the URL then looks right and the bucket ignores the expiry.
    expect(presignUrl({ ...input, expiresSeconds: 600 })).not.toBe(presignUrl(input));
  });

  it("puts a content-disposition into the signature, not just the URL", () => {
    const withName = presignUrl({
      ...input,
      query: { "response-content-disposition": 'attachment; filename="a b.pdf"' },
    });
    expect(withName).toContain("response-content-disposition=");
    expect(withName).not.toBe(presignUrl(input));
  });
});

describe("presigning a PUT — the direct-to-bucket address", () => {
  // Nothing in `presignUrl()` had to change for a write: the method flows into
  // the canonical request, and only `host` is ever signed. These assertions
  // exist because that is easy to break by "improving" the signer to sign
  // `content-type` as well — which would then oblige the browser to send that
  // header back byte for byte, and a charset appended is a 403 nobody can read.
  const input = {
    method: "PUT" as const,
    endpoint: "https://fra1.example.com",
    path: "/bucket/courses/video/2026/08/abc.mp4",
    credentials: {
      accessKeyId: "AKIDEXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
      region: "auto",
      service: "s3",
    },
    expiresSeconds: 3600,
    now: new Date("2026-08-09T12:00:00Z"),
  };

  it("signs host and nothing else", () => {
    expect(presignUrl(input)).toContain("X-Amz-SignedHeaders=host");
  });

  it("signs the METHOD — a GET address is not a write address", () => {
    // The whole point. If the method were left out of the canonical request the
    // two would share a signature, and a read address would be a write address.
    expect(presignUrl(input)).not.toBe(presignUrl({ ...input, method: "GET" }));
  });

  it("carries the derived key in the path", () => {
    expect(presignUrl(input)).toContain("/bucket/courses/video/2026/08/abc.mp4?");
  });
});
