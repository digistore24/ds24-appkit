// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Handing one item out — the API's door.
//
// The same pipeline as the browser's `/api/media/[id]` (`lib/media/deliver.ts`),
// with the same refusal semantics: 404 for missing AND forbidden (no oracle
// for which ids exist), 503 for a broken store, 307 to a signed URL on the
// cloud driver. Only the who-question differs — the viewer is the key's
// member, already proven by the guard.
import { guardApi } from "@/modules/api/api/guard";
import { deliverMedia } from "@/lib/media/deliver";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const g = await guardApi(request);
  if (!g.ok) return g.response;

  const { id } = await context.params;
  return deliverMedia({
    id,
    download: new URL(request.url).searchParams.has("download"),
    viewerFor: async () => ({ memberId: g.memberId, role: g.role }),
  });
}
