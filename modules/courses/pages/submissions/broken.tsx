// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The diagnosis both pages of this section show when the course is switched ON
// and its config does not hold.
//
// ⚠️ **Switched OFF and BROKEN are different states and get different answers.**
// Off is `notFound()` before any session work — off beats operator, and there is
// no admin preview of a switched-off module. Broken is a mistake somebody has to
// fix, and the operator is the only person who can: `gate.ts` deliberately lets
// that state through to the pages rather than rewriting it away with the kill
// switch, and `modules/community/gate.ts` carries the post-mortem for a gate
// that did not.
//
// It is a component rather than two copies because this section has two pages
// and the sentence has to be the same on both. `../page.tsx` and
// `../../admin/page.tsx` each still carry their own — they predate this file and
// folding them in is a change to pages the vendor may already have edited.

import { Callout } from "@/components/ui/callout";
import { PageHeader } from "@/components/page-header";

export function BrokenCourseNotice({
  title,
  calloutTitle,
  intro,
  problems,
}: {
  title: string;
  calloutTitle: string;
  intro: string;
  problems: readonly string[];
}) {
  return (
    <>
      <PageHeader title={title} />
      <Callout variant="warning" title={calloutTitle}>
        <p>{intro}</p>
        <ul className="mt-2 list-disc pl-5">
          {problems.map((problem) => (
            <li key={problem}>
              <code>{problem}</code>
            </li>
          ))}
        </ul>
      </Callout>
    </>
  );
}
