// One legal page, whole — header, title, the text, footer.
//
// ── Why every legal page is its own STATIC route ──────────────────────────
// `app/impressum/page.tsx`, `app/datenschutz/page.tsx`, and — once
// `compliance-check` decides you need them — `app/agb/page.tsx` and
// `app/widerruf/page.tsx`. Each is three lines that call this component.
//
// The obvious alternative was one dynamic route, `app/[slug]/page.tsx`, inside
// a `(legal)` route group. It was built that way first and rejected for three
// reasons, in ascending order of weight:
//
//  1. **Parentheses in a path are a tax on every shell command** that touches
//     the tree, and this project has to be workable in a Git Bash on Windows
//     (CLAUDE.md, "Three systems"). A directory nobody can `cd` into without
//     quoting is a directory somebody will get wrong.
//  2. **`node run.mjs smoke` skips `[param]` routes**, because without a real
//     value the request is pointless. So the dynamic version made the legal
//     pages the only public pages in the app that nothing called automatically
//     — exactly the pages whose breakage nobody notices, because nobody reads
//     them until it matters.
//  3. **A root-level `[slug]` claims the whole URL space.** Static routes win,
//     so it worked — but every future top-level route would have been added
//     next to a wildcard that already answers for it.
//
// Static routes cost one three-line file each and remove all three.
//
// ── Public, and that is load-bearing ──────────────────────────────────────
// `proxy.ts` guards `/dashboard/:path*` only, so these are public by default —
// and here the default is the requirement. § 5 DDG wants the Impressum
// *easily recognisable and directly reachable*, and a privacy policy behind a
// sign-in cannot be read by the person deciding whether to sign in.
// **Never add these paths to the matcher.**
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";

import { PageHeader } from "@/components/page-header";
import { PublicHeader } from "@/components/public-header";
import { SiteFooter } from "@/components/site-footer";
import { LegalBody } from "@/components/legal-body";
import { Callout } from "@/components/ui/callout";
import { legalDocument, type LegalSlug } from "@/lib/legal/pages";
import { parse } from "@/lib/legal/markdown";
import type { Locale } from "@/i18n/config";

/** The `metadata` export each legal route re-exports. */
export async function legalMetadata(slug: LegalSlug): Promise<Metadata> {
  const t = await getTranslations("legal");
  return {
    title: t(`${slug}.title`),
    // A legal notice is for the reader, not for search — and keeping it out of
    // the index also keeps the operator's home address out of it.
    robots: { index: false, follow: true },
  };
}

export async function LegalPage({ slug }: { slug: LegalSlug }) {
  const locale = (await getLocale()) as Locale;
  const document = await legalDocument(slug, locale);

  // No file for this slug. The normal case for /agb where Digistore24 resells:
  // the purchase terms are theirs, and a 404 is the honest answer rather than
  // an empty page implying terms that do not exist.
  if (!document) notFound();

  const t = await getTranslations("legal");

  return (
    <div className="flex min-h-dvh flex-col">
      <PublicHeader />

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
        <PageHeader title={t(`${slug}.title`)} />

        <div className="mt-6 flex flex-col gap-6">
          {/* The shipped text, still in place. A Callout rather than a quiet
              note: this sits on a page that is itself a legal obligation, and
              it has to be impossible to miss on a live site. */}
          {document.placeholder && (
            <Callout variant="warning" title={t("placeholderTitle")}>
              {t("placeholderBody")}
            </Callout>
          )}

          {/* The draft compliance-check wrote, not yet reviewed by a lawyer.
              Also a warning Callout, also impossible to miss: whoever publishes
              this template gives no legal advice, and a drafted privacy policy
              that reads like a finished one would claim exactly that. The box
              goes when the operator removes the marker after the review
              (`lib/legal/markers.mjs`). */}
          {document.draft && (
            <Callout variant="warning" title={t("draftTitle")}>
              {t("draftBody")}
            </Callout>
          )}

          {/* Only worth saying when it differs from what the reader chose —
              otherwise it is a line explaining that German is in German. */}
          {document.locale !== locale && (
            <Callout variant="info">{t("otherLanguage")}</Callout>
          )}

          <LegalBody blocks={parse(document.text)} />
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
