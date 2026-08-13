// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The course's arithmetic, one case at a time.
//
// This is the file `coreExport` carries into a companion repo, so these
// assertions are the contract two applications share — a mobile app computing
// "is week three open" differently from the web app is the failure a shared
// pure layer exists to prevent.
import { describe, expect, it } from "vitest";

import {
  COURSES_ERROR_CODES,
  COURSE_ROW_ORIGINS,
  COURSE_SHAPES,
  COURSE_SLOTS,
  COURSE_SLOT_IDS,
  DIGEST_JOB_ID,
  MAX_REPLY_CHARS,
  MAX_SUBMISSION_CHARS,
  blockDeletable,
  digestKey,
  isCourseSlotId,
  isUnlocked,
  learnerLabel,
  replyProblem,
  slotUploadProblem,
  mayOperatorWrite,
  nextUnit,
  unitTextProblem,
  MAX_UNIT_BODY_CHARS,
  MAX_UNIT_TITLE_CHARS,
  positionAvailability,
  progress,
  rowWritable,
  slugAvailability,
  slugProblem,
  submissionProblem,
  unlockedAt,
  type UnitRef,
} from "./rules";

const DAY = 86_400_000;
const START = new Date("2026-03-01T00:00:00Z");

describe("unlocking", () => {
  it("🚨 a self-study course is never locked, whatever the data says", () => {
    // Config wins over data. A stray `releaseAfterDays` left in a content file
    // must not lock a course the vendor sells as self-paced.
    expect(unlockedAt(28, START, "self-study")).toBeNull();
    expect(isUnlocked(28, START, "self-study", START)).toBe(true);
  });

  it("a drip course with all-zero blocks behaves as self-study", () => {
    // The other direction of the same rule: the degenerate case is legal, so
    // shape 1 needs no code of its own.
    expect(unlockedAt(0, START, "drip")).toBeNull();
    expect(isUnlocked(0, START, "drip", START)).toBe(true);
  });

  it("opens a week relative to the PURCHASE, not the calendar", () => {
    const opensAt = unlockedAt(7, START, "drip");
    expect(opensAt?.getTime()).toBe(START.getTime() + 7 * DAY);

    // A second learner who bought a month later is on their own clock.
    const later = new Date(START.getTime() + 30 * DAY);
    expect(unlockedAt(7, later, "drip")?.getTime()).toBe(later.getTime() + 7 * DAY);
  });

  it("🚨 week ten is not reachable on day one", () => {
    // The failure `docs/courses.md` says to write down before building: a
    // programme that renders week ten early has failed at the thing it was
    // bought for.
    expect(isUnlocked(63, START, "drip", START)).toBe(false);
    expect(isUnlocked(63, START, "drip", new Date(START.getTime() + 62 * DAY))).toBe(false);
    expect(isUnlocked(63, START, "drip", new Date(START.getTime() + 63 * DAY))).toBe(true);
  });

  it("🚨 locks everything for a learner with no active grant", () => {
    // `null` means no ACTIVE grant — a suspended one (missed payment) is not
    // active. Rendering week one there would tell somebody whose payment failed
    // that they are back at the start.
    expect(isUnlocked(0, null, "drip", START)).toBe(false);
    expect(isUnlocked(7, null, "workshop", new Date("2099-01-01"))).toBe(false);
  });

  it("a workshop unlocks exactly like a drip", () => {
    // Shape 3 contains shape 2's unlocking — stated in the doc, and now
    // literally rather than by restatement.
    for (const days of [0, 7, 63]) {
      expect(isUnlocked(days, START, "workshop", START)).toBe(
        isUnlocked(days, START, "drip", START),
      );
    }
  });

  it("knows exactly three shapes", () => {
    expect([...COURSE_SHAPES]).toEqual(["self-study", "drip", "workshop"]);
  });
});

describe("progress", () => {
  it("counts what is done against what there is", () => {
    expect(progress(0, 20)).toBe(0);
    expect(progress(5, 20)).toBe(25);
    expect(progress(20, 20)).toBe(100);
  });

  it("does not divide by zero, and does not exceed 100", () => {
    // A course with no lessons is 0, not NaN — the page renders it before the
    // content has been applied.
    expect(progress(0, 0)).toBe(0);
    expect(progress(3, 0)).toBe(0);
    // More completions than units happens for real: a lesson gets removed from
    // the content files and the completions on its slug stay.
    expect(progress(25, 20)).toBe(100);
  });
});

describe("the next step", () => {
  // The title defaults off the slug, so the ordering tests below stay about
  // ordering. Where the title itself is the subject, it is passed in.
  const unit = (
    slug: string,
    block: number,
    pos: number,
    unlocked = true,
    title = `Titel ${slug}`,
  ): UnitRef => ({
    slug,
    title,
    blockPosition: block,
    position: pos,
    unlocked,
  });

  it("is the first uncompleted lesson in block-then-unit order", () => {
    const units = [unit("b", 1, 2), unit("a", 1, 1), unit("c", 2, 1)];
    expect(nextUnit(units, new Set())?.slug).toBe("a");
    expect(nextUnit(units, new Set(["a"]))?.slug).toBe("b");
    expect(nextUnit(units, new Set(["a", "b"]))?.slug).toBe("c");
  });

  it("🚨 never points at a locked lesson", () => {
    const units = [unit("open", 1, 1), unit("locked", 2, 1, false)];
    expect(nextUnit(units, new Set(["open"]))?.slug).toBe("open");
  });

  it("falls back to the first open lesson when everything is done", () => {
    // Rather than null: a finished course whose "next step" card vanishes reads
    // as broken.
    const units = [unit("a", 1, 1), unit("b", 1, 2)];
    expect(nextUnit(units, new Set(["a", "b"]))?.slug).toBe("a");
  });

  it("is null only when nothing is open at all", () => {
    // A real state: a fresh drip learner on day zero with week one at
    // `releaseAfterDays: 7`.
    expect(nextUnit([unit("a", 1, 1, false)], new Set())).toBeNull();
    expect(nextUnit([], new Set())).toBeNull();
  });

  // 🚨 The answer is SHOWN, not only followed. Reported 2026-08-12: the card
  // read "Weiter geht es mit: was-dich-erwartet" — the placeholder is called
  // `{title}` and was fed the slug. Asserting on `.slug` alone, as every test
  // above does, cannot see that.
  it("carries the lesson's title, not only its address", () => {
    const units = [
      unit("was-dich-erwartet", 1, 1, true, "Was dich erwartet"),
      unit("die-erste-kennzahl", 1, 2, true, "Die erste Kennzahl"),
    ];
    expect(nextUnit(units, new Set())?.title).toBe("Was dich erwartet");
    expect(nextUnit(units, new Set(["was-dich-erwartet"]))?.title).toBe("Die erste Kennzahl");
  });

  it("does not reorder the caller's array", () => {
    const units = [unit("b", 1, 2), unit("a", 1, 1)];
    nextUnit(units, new Set());
    expect(units.map((u) => u.slug)).toEqual(["b", "a"]);
  });
});

describe("the slug grammar", () => {
  it("accepts what a route and a Subject Key can both be", () => {
    for (const slug of ["wehen-atmung", "woche-7", "a", "knoten-fuer-anfaenger"]) {
      expect(slugProblem(slug), slug).toBeNull();
    }
  });

  it("🚨 refuses non-ASCII, because the slug becomes a url", () => {
    // `lib/content-source/anchors.ts` refuses a non-ASCII url outright, so the
    // deep link would scroll nowhere. Refusing it here means the applier says
    // so about a content FILE, which is a sentence somebody can act on.
    expect(slugProblem("knoten-für-anfänger")).toMatch(/not a slug/);
  });

  it("refuses the shapes that break a route", () => {
    for (const slug of ["", "Wehen-Atmung", "wehen atmung", "-wehen", "wehen-", "wehen--atmung"]) {
      expect(slugProblem(slug), JSON.stringify(slug)).not.toBeNull();
    }
  });

  it("refuses one nobody would read", () => {
    expect(slugProblem("a".repeat(81))).toMatch(/longer than 80/);
  });
});

describe("the ceilings", () => {
  it("caps a hand-in at something a person could plausibly write", () => {
    expect(MAX_SUBMISSION_CHARS).toBeGreaterThan(1_000);
    expect(MAX_SUBMISSION_CHARS).toBeLessThan(100_000);
  });
});

describe("where a row came from", () => {
  it("knows exactly two origins", () => {
    expect([...COURSE_ROW_ORIGINS]).toEqual(["content", "operator"]);
  });

  it("lets the operator's surface write its own rows and nobody else's", () => {
    expect(mayOperatorWrite("operator")).toBe(true);
    expect(mayOperatorWrite("content")).toBe(false);
  });

  it("🚨 refuses a value that is in neither constant", () => {
    // The reason the signature is `string`: the value comes out of a `text`
    // column, so the case worth testing is the one the type system would have
    // hidden. A migration somebody wrote by hand, a row from an older shape of
    // this module, a typo in a manual UPDATE — all land here, and all of them
    // mean "not the operator's row".
    for (const value of ["", "Operator", "applier", "content ", "unknown"]) {
      expect(mayOperatorWrite(value), JSON.stringify(value)).toBe(false);
    }
  });
});

describe("the refusal codes", () => {
  it("🚨 every code carries the module's name, because `errors` is shared", () => {
    // `i18n/request.ts` merges a module's texts INTO the core's `errors`
    // namespace rather than replacing it, so a code without the prefix is a
    // claim on a key the core may already hold — and the module's sentence
    // would then answer every core refusal of that name, in every app that
    // installs this module. `notFound` was exactly that case.
    //
    // Deliberately a check on the FORM and not on the six values: a test that
    // listed them would be a second copy of the list, agreeing with the first
    // by hand and saying nothing about the seventh code somebody adds.
    expect(COURSES_ERROR_CODES.length).toBeGreaterThan(0);
    for (const code of COURSES_ERROR_CODES) {
      expect(
        code,
        `"${code}" would claim a key in the core's shared \`errors\` namespace — see i18n/request.ts`,
      ).toMatch(/^courses[A-Z]/);
    }
  });
});

describe("what the operator's surface may write", () => {
  const FREE = { claimedByContent: false, takenByRow: false };

  describe("a slug", () => {
    it("accepts one nothing else holds", () => {
      expect(slugAvailability("woche-3", FREE)).toBeNull();
    });

    it("refuses one that is not a slug at all", () => {
      // The same grammar `check.mjs` and the applier apply — an operator's own
      // lesson is a route segment and a Subject Key exactly as a file's is.
      expect(slugAvailability("Woche 3", FREE)).toBe("coursesSlugMalformed");
      expect(slugAvailability("", FREE)).toBe("coursesSlugMalformed");
      expect(slugAvailability("knoten-für-anfänger", FREE)).toBe("coursesSlugMalformed");
    });

    it("🚨 refuses one a content file names, even with no row behind it", () => {
      // The whole reason the surface reads the tree rather than the table. A
      // file that has never been applied still owns its slug: this is the
      // normal state between "written" and "content-apply", and in a fresh PROD
      // it is the state of every file. Answering "free" here creates an
      // operator row that makes tomorrow's `content-apply` refuse ITS WHOLE RUN.
      expect(slugAvailability("woche-3", { claimedByContent: true, takenByRow: false })).toBe(
        "coursesSlugClaimedByContent",
      );
    });

    it("refuses one a row holds whose file is gone", () => {
      // The other direction, and why the table is asked at all: a `content` row
      // whose file was deleted keeps its slug, and nothing in the tree says so.
      expect(slugAvailability("woche-3", { claimedByContent: false, takenByRow: true })).toBe(
        "coursesSlugTaken",
      );
    });

    it("🚨 names the FILE when both are true, never the row", () => {
      // The order is load-bearing, not cosmetic. Both refusals are correct;
      // only one of them tells the operator where to go and fix it, and only
      // one of them is still true after somebody deletes the row.
      expect(slugAvailability("woche-3", { claimedByContent: true, takenByRow: true })).toBe(
        "coursesSlugClaimedByContent",
      );
    });

    it("checks the grammar before either claim", () => {
      expect(slugAvailability("Woche 3", { claimedByContent: true, takenByRow: true })).toBe(
        "coursesSlugMalformed",
      );
    });
  });

  describe("a position", () => {
    it("accepts a free one", () => {
      expect(positionAvailability(3, [1, 2])).toBeNull();
      expect(positionAvailability(1, [])).toBeNull();
    });

    it("refuses one already in the scope", () => {
      expect(positionAvailability(2, [1, 2, 3])).toBe("coursesPositionTaken");
    });

    it("🚨 counts a content row's position as taken", () => {
      // A `content` row is untouchable and its position is still occupied.
      // Letting the operator sit on it produces two rows on position 2, which
      // renders in whatever order the database returns — an order nobody chose.
      // The database cannot hold this: both position indexes are ordinary, not
      // unique, because a unique one would turn the applier against itself as
      // soon as two environments are applied to different depths.
      expect(positionAvailability(2, [2])).toBe("coursesPositionTaken");
    });
  });

  describe("deleting a block", () => {
    it("allows an empty one", () => {
      expect(blockDeletable(0)).toBeNull();
    });

    it("🚨 refuses one that still holds lessons", () => {
      // `on delete cascade` is in the schema and is deliberately NOT the answer
      // here: it answers `module remove --drop-data`, which is a decision made
      // once and in writing. A click is not that.
      expect(blockDeletable(1)).toBe("coursesBlockNotEmpty");
      expect(blockDeletable(3)).toBe("coursesBlockNotEmpty");
    });
  });

  describe("writing a row at all", () => {
    it("lets the operator's own row through", () => {
      expect(rowWritable("operator")).toBeNull();
    });

    it("🚨 refuses a row a content file owns", () => {
      expect(rowWritable("content")).toBe("coursesContentRowLocked");
    });

    it("🚨 refuses an origin nobody planned for", () => {
      // Same direction as `mayOperatorWrite()`: an unknown origin is somebody
      // else's row. The safe answer for a surface that is about to write.
      for (const value of ["", "Operator", "applier", "operator "]) {
        expect(rowWritable(value), JSON.stringify(value)).toBe("coursesContentRowLocked");
      }
    });
  });

  describe("attaching a file to a slot", () => {
    const OK = {
      origin: "operator",
      mime: "image/png",
      bytes: 1_000,
      ceilingBytes: 10_485_760,
    };

    it("lets a picture into the cover slot", () => {
      expect(slotUploadProblem("cover", OK)).toBeNull();
    });

    it("🚨 refuses a PDF in the subtitle slot — the finding this exists for", () => {
      // `text/vtt` and `application/pdf` are the SAME kind in
      // `config/media.json`, so a door described by its kind alone takes both.
      // This is the assertion that says the slot is narrower than its kind.
      expect(
        slotUploadProblem("subtitle", { ...OK, mime: "application/pdf" }),
      ).toBe("coursesSlotNotAttachable");
    });

    it("🚨 and refuses a subtitle in the worksheet slot — the same mistake mirrored", () => {
      expect(slotUploadProblem("worksheet", { ...OK, mime: "text/vtt" })).toBe(
        "coursesSlotNotAttachable",
      );
    });

    it("lets each slot have what it is for — the three refusals are not vacuous", () => {
      for (const slot of COURSE_SLOT_IDS) {
        for (const mime of COURSE_SLOTS[slot].mimeTypes) {
          expect(slotUploadProblem(slot, { ...OK, mime }), `${slot} ← ${mime}`).toBeNull();
        }
      }
    });

    it("is case- and whitespace-insensitive about the type, because headers are", () => {
      expect(slotUploadProblem("subtitle", { ...OK, mime: " TEXT/VTT " })).toBeNull();
    });

    it("asks nothing about the type when nobody has decided one", () => {
      // What both shipped callers pass, and why: `File.type` is the operating
      // system's guess — on Windows a good `.vtt` arrives as `text/plain`, and
      // the pipeline's alias table accepts it from the BYTES. A refusal here
      // would undo that.
      expect(slotUploadProblem("subtitle", { ...OK, mime: null })).toBeNull();
      // The other refusals still hold with no type in hand.
      expect(slotUploadProblem("subtitle", { ...OK, mime: null, origin: "content" })).toBe(
        "coursesContentRowLocked",
      );
      expect(slotUploadProblem("subtitle", { ...OK, mime: null, bytes: 99_999_999 })).toBe(
        "coursesUploadTooLarge",
      );
    });

    it("refuses a slot name nobody declared", () => {
      // The name arrives as a string from a form. An unknown one is not an
      // empty slot to fill, it is a request for a column that does not exist.
      expect(slotUploadProblem("banner", OK)).toBe("coursesSlotNotAttachable");
      expect(isCourseSlotId("banner")).toBe(false);
    });

    it("🚨 refuses a content row before it looks at the file at all", () => {
      // Order, not merely outcome: a locked row is locked whatever was picked,
      // and the sentence the operator needs names the FILE, not the format.
      expect(
        slotUploadProblem("subtitle", { ...OK, origin: "content", mime: "application/pdf" }),
      ).toBe("coursesContentRowLocked");
      expect(
        slotUploadProblem("cover", { ...OK, origin: "content", bytes: 99_999_999 }),
      ).toBe("coursesContentRowLocked");
    });

    it("refuses a file over the ceiling it was handed", () => {
      expect(slotUploadProblem("cover", { ...OK, bytes: 10_485_761 })).toBe(
        "coursesUploadTooLarge",
      );
      // Exactly the ceiling goes through: the number the form shows is what it
      // promises, not one less.
      expect(slotUploadProblem("cover", { ...OK, bytes: 10_485_760 })).toBeNull();
    });

    it("🚨 judges the video slot against the ceiling it is GIVEN, never the kind's", () => {
      // The measured finding: a Server Action body stops at 10 MB whatever the
      // kind allows, and a rule that read the kind's number would wave through
      // 40 MB that Next drops before the action runs — with no message anybody
      // can catch or translate. The kind's own number has since moved (video is
      // 2 GB for the direct-to-bucket path), which is why the ceiling is handed
      // IN: the same rule serves a slot that travels through the app and one
      // that does not, and neither of them gets to guess which it is.
      const video = { ...OK, mime: "video/mp4", bytes: 40 * 1024 * 1024 };
      expect(slotUploadProblem("video", { ...video, ceilingBytes: 10 * 1024 * 1024 })).toBe(
        "coursesUploadTooLarge",
      );
      expect(slotUploadProblem("video", { ...video, ceilingBytes: 50 * 1024 * 1024 })).toBeNull();
    });
  });

  it("🚨 every code these rules return has a text to render", () => {
    // The rules hand back codes, never sentences (`CLAUDE.md` → Languages), so
    // a code outside the union is a key `i18n/messages.test.ts` never checks —
    // and the operator would read the literal string at the moment something
    // went wrong.
    const returned = [
      slugAvailability("Woche 3", FREE),
      slugAvailability("x", { claimedByContent: true, takenByRow: false }),
      slugAvailability("x", { claimedByContent: false, takenByRow: true }),
      positionAvailability(1, [1]),
      blockDeletable(1),
      rowWritable("content"),
      slotUploadProblem("subtitle", {
        origin: "operator",
        mime: "application/pdf",
        bytes: 1,
        ceilingBytes: 10,
      }),
      slotUploadProblem("cover", {
        origin: "operator",
        mime: "image/png",
        bytes: 11,
        ceilingBytes: 10,
      }),
    ];
    expect(returned.filter((code) => code === null)).toEqual([]);
    for (const code of returned) {
      expect(COURSES_ERROR_CODES as readonly string[]).toContain(code);
    }
  });
});

describe("what a member may hand in", () => {
  const OK = {
    shape: "workshop",
    taskPrompt: "Write down what you noticed this week.",
    alreadyReplied: false,
    body: "I noticed three things.",
  } as const;

  it("lets a real hand-in through", () => {
    expect(submissionProblem(OK)).toBeNull();
  });

  it("refuses one on a drip course", () => {
    // Hand-ins are shape 3 and nothing else — `docs/courses.md` describes them
    // exclusively under *the accompanied workshop*. A drip course paces content;
    // it asks nobody for anything.
    expect(submissionProblem({ ...OK, shape: "drip" })).toBe("coursesShapeForbidsSubmission");
    expect(submissionProblem({ ...OK, shape: "self-study" })).toBe(
      "coursesShapeForbidsSubmission",
    );
  });

  it("refuses one on a lesson that asks for nothing", () => {
    // `coursesNotFound`, and the reason it is not a fifth code is above the
    // function: the action addresses a hand-in surface, and this lesson has none.
    expect(submissionProblem({ ...OK, taskPrompt: null })).toBe("coursesNotFound");
  });

  it("refuses one that has already been answered", () => {
    expect(submissionProblem({ ...OK, alreadyReplied: true })).toBe("coursesAlreadyReplied");
  });

  it("refuses an empty one", () => {
    expect(submissionProblem({ ...OK, body: "" })).toBe("coursesSubmissionEmpty");
  });

  it("🚨 counts whitespace as empty, because the store trims too", () => {
    // The one case a length check on the RAW text gets wrong: twelve spaces are
    // twelve characters and no hand-in at all. The action stores `body.trim()`,
    // so a rule that judged the untrimmed string would accept a row it then
    // wrote as empty — refusing the notNull column's whole purpose.
    for (const body of ["   ", "\n\n", " \t \r\n "]) {
      expect(submissionProblem({ ...OK, body }), JSON.stringify(body)).toBe(
        "coursesSubmissionEmpty",
      );
    }
  });

  it("refuses one nobody could have written", () => {
    expect(submissionProblem({ ...OK, body: "a".repeat(MAX_SUBMISSION_CHARS + 1) })).toBe(
      "coursesSubmissionTooLong",
    );
  });

  it("🚨 lets exactly the ceiling through, and one more character not", () => {
    // The number the form shows is what it promises. `maxLength` on the field
    // is the same number, so an off-by-one here is a form that refuses what it
    // let somebody type.
    expect(submissionProblem({ ...OK, body: "a".repeat(MAX_SUBMISSION_CHARS) })).toBeNull();
    expect(submissionProblem({ ...OK, body: "a".repeat(MAX_SUBMISSION_CHARS + 1) })).toBe(
      "coursesSubmissionTooLong",
    );
    // And the ceiling is measured on the TRIMMED text — padding is not content.
    expect(
      submissionProblem({ ...OK, body: `  ${"a".repeat(MAX_SUBMISSION_CHARS)}  ` }),
    ).toBeNull();
  });

  describe("when two conditions are broken at once", () => {
    it("🚨 says 'this course takes none' before 'this lesson asks none'", () => {
      // The earlier reason wins. Told the lesson does not exist, an operator
      // looking at a drip course with prompts in its content files would go
      // hunting for a missing row; the truth is the course's shape.
      expect(submissionProblem({ ...OK, shape: "drip", taskPrompt: null })).toBe(
        "coursesShapeForbidsSubmission",
      );
    });

    it("🚨 says 'already answered' before 'too long'", () => {
      // The reason `alreadyReplied` sits above the text checks: "too long"
      // sends somebody away to shorten a text that no length would have got
      // through. A refusal that asks for work which cannot help is the worse
      // one, however precise it is.
      expect(
        submissionProblem({
          ...OK,
          alreadyReplied: true,
          body: "a".repeat(MAX_SUBMISSION_CHARS + 1),
        }),
      ).toBe("coursesAlreadyReplied");
      expect(submissionProblem({ ...OK, alreadyReplied: true, body: "  " })).toBe(
        "coursesAlreadyReplied",
      );
    });

    it("says 'no such surface' before anything about the text", () => {
      expect(submissionProblem({ ...OK, taskPrompt: null, body: "" })).toBe("coursesNotFound");
    });
  });

  it("🚨 hands back codes the message files carry", () => {
    // Same claim the operator's refusals make above: a code outside the union
    // is a key `i18n/messages.test.ts` never checks, and the member would read
    // the literal string at the moment something went wrong.
    const returned = [
      submissionProblem({ ...OK, shape: "drip" }),
      submissionProblem({ ...OK, taskPrompt: null }),
      submissionProblem({ ...OK, alreadyReplied: true }),
      submissionProblem({ ...OK, body: " " }),
      submissionProblem({ ...OK, body: "a".repeat(MAX_SUBMISSION_CHARS + 1) }),
    ];
    expect(returned.filter((code) => code === null)).toEqual([]);
    expect(new Set(returned).size, "each branch has its own code").toBe(5);
    for (const code of returned) {
      expect(COURSES_ERROR_CODES as readonly string[]).toContain(code);
    }
  });
});

describe("what the operator may write back", () => {
  it("takes a reply that says something", () => {
    expect(replyProblem("Well spotted — try the second grip next.")).toBeNull();
  });

  it("🚨 refuses an empty one, and whitespace is empty", () => {
    // Not a formality. There is no action in this module that sets `replied_at`
    // back to null, and an empty reply is the silent way to the same place: a
    // frozen hand-in whose answer nobody can read.
    expect(replyProblem("")).toBe("coursesReplyEmpty");
    expect(replyProblem("   ")).toBe("coursesReplyEmpty");
    expect(replyProblem("\r\n \t")).toBe("coursesReplyEmpty");
  });

  it("refuses one past the ceiling, and lets exactly the ceiling through", () => {
    expect(replyProblem("a".repeat(MAX_REPLY_CHARS))).toBeNull();
    expect(replyProblem("a".repeat(MAX_REPLY_CHARS + 1))).toBe("coursesReplyTooLong");
    // Measured on the TRIMMED text — padding is not content, exactly as the
    // hand-in's ceiling is measured.
    expect(replyProblem(`  ${"a".repeat(MAX_REPLY_CHARS)}  `)).toBeNull();
  });

  it("🚨 hands back codes the message files carry", () => {
    const returned = [replyProblem(""), replyProblem("a".repeat(MAX_REPLY_CHARS + 1))];
    expect(new Set(returned).size, "each branch has its own code").toBe(2);
    for (const code of returned) {
      expect(COURSES_ERROR_CODES as readonly string[]).toContain(code);
    }
  });

  it("is two decisions that happen to share a number", () => {
    // Stated as a measurement rather than as a comment: if somebody ever folds
    // the two constants into one, this still passes — but the sentence above
    // `MAX_REPLY_CHARS` is what a reader is pointed at, and the constants have
    // to remain two names.
    expect(MAX_REPLY_CHARS).toBe(20_000);
    expect(MAX_SUBMISSION_CHARS).toBe(20_000);
  });
});

describe("naming the person who handed something in", () => {
  const ID = "0f2a1b3c-4d5e-6f70-8192-a3b4c5d6e7f8";
  const PLACEHOLDER = "Member";

  it("takes the name on the account first", () => {
    expect(
      learnerLabel({ name: "Ada Lovelace", email: "ada@example.com", memberId: ID, placeholderLabel: PLACEHOLDER }),
    ).toBe("Ada Lovelace");
  });

  it("falls back to the address, and never shows it beside a name", () => {
    // The magic-link sign-up sets no name at all, so this is the ordinary case
    // on a fresh app rather than an edge.
    expect(
      learnerLabel({ name: null, email: "ada@example.com", memberId: ID, placeholderLabel: PLACEHOLDER }),
    ).toBe("ada@example.com");
    expect(
      learnerLabel({ name: "  ", email: "ada@example.com", memberId: ID, placeholderLabel: PLACEHOLDER }),
    ).toBe("ada@example.com");
  });

  it("🚨 falls back to the placeholder when there is neither", () => {
    // Reachable rather than theoretical: `users.email` is nullable
    // (`db/schema-core.ts`), and an account created by an operator by hand can
    // hold neither.
    expect(
      learnerLabel({ name: null, email: null, memberId: ID, placeholderLabel: PLACEHOLDER }),
    ).toBe("Member a3b4c5d6e7f8");
  });

  it("uses the last twelve characters of the id, and only those", () => {
    const label = learnerLabel({
      name: null,
      email: null,
      memberId: ID,
      placeholderLabel: PLACEHOLDER,
    });
    expect(label.endsWith("a3b4c5d6e7f8")).toBe(true);
    // Nothing of the front of the id travels — a prefix is equally random
    // today and would stop being so if ids ever gained a structured one.
    expect(label).not.toContain("0f2a");
  });

  it("is never blank, even for a name made of characters that render as nothing", () => {
    expect(
      learnerLabel({ name: "​​", email: null, memberId: ID, placeholderLabel: PLACEHOLDER }),
    ).toBe("Member a3b4c5d6e7f8");
    expect(
      learnerLabel({ name: null, email: "﻿", memberId: ID, placeholderLabel: PLACEHOLDER }),
    ).toBe("Member a3b4c5d6e7f8");
  });

  it("survives an id with no alphanumerics at all", () => {
    expect(
      learnerLabel({ name: null, email: null, memberId: "---", placeholderLabel: PLACEHOLDER }),
    ).toBe("Member ?");
  });

  it("takes the translated word rather than inventing one", () => {
    // The reason this is a parameter: `rules.ts` is below the delivery layer
    // and a sentence born there is a sentence in one language for ever.
    expect(
      learnerLabel({ name: null, email: null, memberId: ID, placeholderLabel: "Mitglied" }),
    ).toBe("Mitglied a3b4c5d6e7f8");
  });
});

describe("digestKey", () => {
  it("names the job and the UTC calendar day", () => {
    expect(digestKey(new Date("2026-08-09T12:00:00Z"))).toBe("courses-digest:2026-08-09");
    expect(digestKey(new Date("2026-08-09T12:00:00Z")).startsWith(`${DIGEST_JOB_ID}:`)).toBe(true);
  });

  it("🚨 gives two runs of the same UTC day the SAME key", () => {
    // The whole point of the marker: the scheduler's second attempt at one
    // window must not mail again. 00:05Z and 23:55Z are the same day.
    expect(digestKey(new Date("2026-08-09T00:05:00Z"))).toBe(
      digestKey(new Date("2026-08-09T23:55:00Z")),
    );
  });

  it("🚨 gives the next day a DIFFERENT key", () => {
    // The other half, and the one whose absence is invisible: a key that never
    // changed would be claimed once and the channel would go quiet for ever.
    expect(digestKey(new Date("2026-08-09T23:59:59.999Z"))).not.toBe(
      digestKey(new Date("2026-08-10T00:00:00.000Z")),
    );
    expect(digestKey(new Date("2026-08-10T00:00:00.000Z"))).toBe("courses-digest:2026-08-10");
  });

  it("crosses the boundary on UTC, not on a local zone", () => {
    // 2026-08-09T23:30Z is already the 10th in Europe/Berlin (UTC+2 in August).
    // The key says the 9th, and that is the decision: the window is named in one
    // zone everywhere, so two app instances in two zones claim one key.
    expect(digestKey(new Date("2026-08-09T23:30:00Z"))).toBe("courses-digest:2026-08-09");
  });

  it("produces a key claimSend() will accept", () => {
    // The grammar in `lib/notify/sent-once.ts`, restated here rather than
    // imported: this file is `coreExport` and its tests travel with it.
    const key = digestKey(new Date("2026-12-31T23:59:59Z"));
    expect(key).toMatch(/^[a-z0-9][a-z0-9-]*(:[a-z0-9-]+)*$/);
    expect(key.length).toBeLessThanOrEqual(120);
  });
});

describe("unitTextProblem — the operator's own text has a ceiling too", () => {
  // ⚠️ There was none until 2026-08-13. `courses_units.body` is an unbounded
  // `text` and the admin form only trimmed, while the member's hand-in on the
  // other side of the same lesson has had `MAX_SUBMISSION_CHARS` since it was
  // built — the wrong way round, because a body is turned into React elements on
  // EVERY request and a hand-in is read once.
  it("passes ordinary text", () => {
    expect(unitTextProblem({ title: "Was dich erwartet", body: "Ein Absatz." })).toBeNull();
    expect(unitTextProblem({ title: "Ohne Text", body: null })).toBeNull();
  });

  it("refuses a body past the ceiling", () => {
    expect(unitTextProblem({ title: "x", body: "a".repeat(MAX_UNIT_BODY_CHARS + 1) })).toBe(
      "coursesUnitTextTooLong",
    );
  });

  it("refuses a title past the ceiling", () => {
    expect(unitTextProblem({ title: "a".repeat(MAX_UNIT_TITLE_CHARS + 1) })).toBe(
      "coursesUnitTextTooLong",
    );
  });

  // Exactly the ceiling goes through — the number the form shows is the number
  // it accepts, the same boundary `submissionProblem()` keeps.
  it("lets exactly the ceiling through", () => {
    expect(unitTextProblem({ title: "x", body: "a".repeat(MAX_UNIT_BODY_CHARS) })).toBeNull();
    expect(unitTextProblem({ title: "a".repeat(MAX_UNIT_TITLE_CHARS) })).toBeNull();
  });
});
