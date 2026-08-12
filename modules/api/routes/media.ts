// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The member's own uploads — list and upload, over HTTP.
//
// Both operations run on the same pipeline the browser uses
// (`lib/media/upload-endpoint.ts`), so web and API share one hourly ceiling
// and one set of checks. The owner is ALWAYS the key's member — there is no
// `ownerId` to send, here or anywhere.
//
// The error codes on this surface are the media domain's own
// (`lib/media/rules.ts` → `MediaErrorCode`), not `API_ERROR_CODES`: the
// envelope shape is the same (`{error, detail?}`), and inventing a second
// vocabulary for the same refusals would force the two doors apart.
import { guardApi } from "@/modules/api/api/guard";
import { apiJson } from "@/modules/api/api/rules";
import { listOwnedMedia } from "@/lib/media/manage";
import { handleUpload } from "@/lib/media/upload-endpoint";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const g = await guardApi(request);
  if (!g.ok) return g.response;

  const rows = await listOwnedMedia(g.memberId);
  return apiJson({
    media: rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      mime: row.mime,
      bytes: row.bytes,
      filename: row.filename,
      alt: row.alt,
      width: row.width,
      height: row.height,
      createdAt: row.createdAt.toISOString(),
    })),
  });
}

/** Uploading writes — write scope, then the shared pipeline decides. */
export async function POST(request: Request): Promise<Response> {
  const g = await guardApi(request, { scope: "write" });
  if (!g.ok) return g.response;

  // The role rides in on the key (`authenticate()` joins users.role), so
  // `config/media.json` → `mayUpload` holds on this door exactly as on the
  // browser's.
  return handleUpload({ memberId: g.memberId, role: g.role, request });
}
