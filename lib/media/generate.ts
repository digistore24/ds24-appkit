// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// Asking a model for a picture and putting it away.
//
// This is the one file that knows about both the AI layer and the store, and
// that is deliberate: `lib/ai/` must not grow a dependency on a bucket, and
// `lib/media/` must not grow one on a provider. Each half stays testable
// without the other, and this is the seam.
//
//   const [hero] = await generateImage({
//     prompt: "a quiet kitchen table at sunrise, warm light, no people",
//     alt: "A kitchen table in early morning light",
//     visibility: "public",
//   });
//
// ── Where the alternative text comes from, honestly ────────────────────────
// **From the caller, and it is required.** No image API returns a description
// of what it drew — they return pixels, and OpenAI additionally returns the
// prompt it rewrote yours into, which is a prompt and not a description. So the
// text that a blind reader hears is written by whoever asked for the picture,
// who is the only party that knows what it is FOR.
//
// The guarantee the app makes is therefore about the type rather than about the
// model: a generated row cannot exist without alternative text, because this
// function cannot be called without it. That closes the same hole
// `components/ui/figure.tsx` closes at the other end.
//
// The provider's rewritten prompt is kept in `media.prompt` — it is the
// difference between "why does this not look like what I asked for" and an
// answer.
//
// ── Charging for it ────────────────────────────────────────────────────────
// This function does NOT charge tokens, and that is not an omission. Charging
// belongs where the price is known and a person is present — the Server Action
// — in the order `check → work → charge` that `template/CLAUDE.md` sets out.
// Doing it here would put a debit inside a library that a cron job might call.
import { MAX_IMAGES_PER_CALL, runImageTask } from "@/lib/ai/run";
import type { MediaVisibility } from "./rules";
import { planProblem } from "./config";
import { createMedia } from "./manage";
import { MediaError } from "./rules";
import type { MediaRow } from "@/db/schema-media";

export interface GenerateImageInput {
  /** What to draw. Reaches the provider verbatim and is recorded. */
  prompt: string;
  /**
   * What the picture shows, for somebody who cannot see it.
   *
   * Required, and not defaulted from the prompt. A prompt reads
   * "photorealistic, 8k, cinematic lighting, trending" and is a set of
   * instructions to a machine; alternative text is a sentence for a person.
   * Silently using one as the other would produce technically-present
   * accessibility that is worse than none, because nothing would then report
   * it as missing.
   */
  alt: string;
  /** Who it belongs to, when it belongs to somebody. */
  ownerId?: string | null;
  /** Product imagery is `public`; a customer's own picture is `owner`. */
  visibility?: MediaVisibility;
  /** Required when `visibility` is `entitled`. */
  requiresPlan?: string | null;
  /** How many. Each one is billed; the ceiling is {@link MAX_IMAGES_PER_CALL}. */
  n?: number;
  /** Provider-shaped, e.g. `"1024x1024"`. */
  size?: string;
  /** Recorded on the usage row, never sent to the provider. */
  memberId?: string | null;
}

/**
 * Produce one or more pictures and store them.
 *
 * Throws `ProviderError` with a typed code when the model call fails — the
 * usage row is written either way, by `runImageTask`, because a failed call is
 * exactly what an Operator needs to see when a provider is having a bad day.
 *
 * **Nothing is stored unless the whole call succeeded**, and that is worth
 * stating rather than dressing up: `runImageTask()` returns when every picture
 * has arrived, so a provider that fails on the third of four discards the two
 * that were already drawn and billed. The docstring here used to claim the
 * opposite. Keeping the survivors would mean the AI layer handing back partial
 * results, which is a different contract than the text tasks have — and `n` is
 * capped at {@link MAX_IMAGES_PER_CALL}, so the exposure is bounded.
 *
 * The failed call IS recorded (`run.ts` writes the row either way), which is
 * what an Operator needs when a provider is having a bad day.
 */
export async function generateImage(input: GenerateImageInput): Promise<MediaRow[]> {
  const alt = input.alt?.trim();
  if (!alt) throw new MediaError("altRequired");

  const visibility: MediaVisibility = input.visibility ?? "owner";
  const requiresPlan = visibility === "entitled" ? (input.requiresPlan?.trim() ?? null) : null;
  if (visibility === "entitled") {
    if (!requiresPlan) {
      throw new MediaError(
        "noAccess",
        'visibility "entitled" needs a Product Key — otherwise nobody could ever fetch it',
      );
    }
    // Checked BEFORE the model is asked. `hasPlan()` throws on an unknown key,
    // so an unchecked one would mean a picture that was paid for and then
    // stored behind a page that cannot render.
    const problem = planProblem(requiresPlan);
    if (problem) throw new MediaError("noAccess", `requiresPlan: ${problem}`);
  }

  const result = await runImageTask("image", {
    prompt: input.prompt,
    n: input.n ?? 1,
    size: input.size,
    memberId: input.memberId ?? null,
  });

  const rows: MediaRow[] = [];
  for (const image of result.images) {
    rows.push(
      await createMedia({
        ownerId: input.ownerId ?? null,
        // Nobody uploaded this — a model made it, and the bucket should say so.
        // `source: "generated"` on the row says it too; the key is what says it
        // to whoever is looking at the bucket rather than at the database, which
        // is the whole reason the namespace exists.
        namespace: "core",
        category: "generated",
        kind: "image",
        mime: image.mime,
        bytes: image.bytes,
        // No original filename: nobody typed one. The download falls back to a
        // name derived from the media type rather than exposing the storage key.
        filename: null,
        visibility,
        requiresPlan,
        alt,
        source: "generated",
        width: image.width,
        height: image.height,
        // What was actually asked for. The provider's rewrite where there is
        // one, ours where there is not.
        prompt: image.revisedPrompt ?? input.prompt,
        provider: result.provider,
        model: result.model,
      }),
    );
  }

  return rows;
}
