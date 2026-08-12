<!-- Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA — SPDX-License-Identifier: MIT -->
# EU AI Act and § 25 TDDDG — the per-check detail

Detail for the `compliance-check` skill: the AI Act examination (check 4 ·
`ai`) and the consent check (check 5 · `consent`). The skip conditions and the
shipped answers stay in `SKILL.md`; read the section the check sent you to.

## Art. 50(1) — the disclosure. Applicable since 2 August 2026

The notice is one line per surface — `chat.disclaimer` and
`companion.disclaimer` in both message files — rendered by
`components/ai-disclosure.tsx` above the transcript, in every variant.
`lib/ai/disclosure.test.ts` fails the build if either language stops naming it
as an AI, and `legal-check` fails when a surface is switched **on** and its
notice is missing, unreadable or no longer rendered.

**The two are not the same conversation, and the report says which is which:**

| | the assistant | a companion |
|---|---|---|
| the disclosure | above the transcript | above it too, and it has to say a model **reads what you write** — the interaction IS the customer handing over their work |
| the policy paragraph | §8 — what they typed, nothing about them | §8a — what they **produced**, plus the fields the entry names |
| the recipient | the company bound to the `chat` task | the company bound to the **`companion`** task — possibly a second one. `node run.mjs ai-check` names both, and a DPA and a third-country basis are needed per company |
| the role | provider, on the reasoning below | the same reasoning, and it carries further: the vendor's own instruction, purpose and subject |
| Art. 50(2) | a support answer is not published synthetic content | **in question** the moment it drafts something the customer publishes — `docs/compliance.md` §3.3, and the date was still moving |

One surface that is invisible to every check above: a companion somebody
hand-wrote instead of mounting `<CompanionPanel>`. `legal-check` looks for
`<AiDisclosure surface="companion" />` in `modules/companion/components/companion-panel.tsx`, so a
bespoke surface can carry its notice under the send button with everything
green. Ask.

**The rule is not "the chat carries a notice".** It is: anything in this app
that talks to a person as a machine says so, at the latest at the first
interaction, clearly. If the user has built a second AI surface — a generator, a
form assistant, an email writer — it needs its own, and that is a finding.

Do **not** lean on the "obvious to a reasonable person" exception for an
assistant with a human name and a face. That is the case the exception was
written to exclude.

## The role — provider or deployer?

`docs/compliance.md` §3.2 has the reasoning. The short version for this
template: an assistant with a name you chose, a persona in `lib/ai/prompt.ts`, a
handbook in `content/knowledge/` and a purpose you defined is **a system you
offer**, not somebody else's system you happen to use. Assume **provider** until
an advisor says otherwise — it is the larger duty set, and assuming the smaller
one is the expensive mistake.

## Art. 4 — AI literacy. In force since 2 February 2025

Documented measures, proportionate to the role. No prescribed curriculum. For a
solo operator this is short — but short is not absent, and the document is the
point. Write `docs/compliance/ki-kompetenz.md` (check 7).

## Risk class

Nothing this template ships is high-risk. If the answer to `scope` question 6
was yes, say so in the report in its own paragraph: the deadline is
2 December 2027 and the obligations are a different order of magnitude.

## § 25 TDDDG — disproving "none needed"

The shipped answer is "no consent needed"; these two greps are how to try to
disprove it:

```bash
grep -ril "gtag\|googletagmanager\|plausible\|posthog\|matomo\|mixpanel\|segment\|fbq\|hotjar\|clarity" app components lib package.json
```

**Then the one that is not an analytics tag and catches people out — an embedded
video:**

```bash
grep -rn "youtube.com\|youtube-nocookie.com\|youtu.be\|player.vimeo.com" app components
```

**A hit is not automatically a finding — look at what is around it.** An embed
built to the recipe renders exactly this URL, and reporting a correctly gated
video as a defect is how a check loses its authority. What makes it a finding is
an `<iframe>` that is rendered unconditionally: no click, no state, no
`hasConsent()` in front of it.

An unconditional `<iframe>` pointing at a video host contacts that host the moment the page
loads — before anybody has agreed to anything — and it sets identifiers on the
visitor's device. That is § 25 TDDDG with no exception for "it is only an
embed", and it is trivial to verify from the outside, which is why it gets
found. `youtube-nocookie.com` reduces what is set and does **not** remove the
contact, so it is not the fix.

The fix is a gate: a still image of your own and a button, and the iframe comes
into existence only after the click. The recipe is in
[`docs/visuals.md`](../../../../docs/visuals.md) → *A video from YouTube or Vimeo*,
and the skill that builds it is **`visuals`**. **Self-hosting the video removes
the question entirely** — a file in the app's own bucket contacts nobody and
needs no consent at all, which is worth naming before somebody writes a banner
for it.

Severity: ❌ **HIGH** on a page a signed-out visitor can reach; ⚠️ MEDIUM behind
the sign-in, where a contract-performance argument exists for some of it but not
for the identifiers.

**If both greps come back empty, the finding is: no consent banner is needed,
and adding one would be a defect.** Say it in those words. Under § 25 TDDDG a banner
where nothing touches the device asks for permission the app neither needs nor
uses, and it trains people to click past the one that will later matter. This is
the single most common thing a generator gets wrong, and the user has probably
been told the opposite.

**A purchase needs no consent either.** It runs on Art. 6(1)(b) — performance of
a contract. The thank-you page deliberately prompts for nothing.

**Where something genuinely does need consent** — an analytics tag, a marketing
mail (§ 7 UWG), a transfer beyond what the product requires:

1. Declare the purpose in `config/consent.json` (`key`, `textVersion`).
2. Write `consent.<key>.title` and `.body` in **both** message files.
   `i18n/messages.test.ts` checks it; `legal-check` reports it.
3. Ask with `<ConsentDialog>` and record with `recordConsent()`.
4. Gate the thing itself on `hasConsent(memberId, key)` — in front of the tag,
   not in front of the button that triggers it.

Three properties of that machinery are load-bearing and worth explaining to the
user rather than just using:

- **Refusing is as easy as agreeing.** Two equal buttons, no pre-ticked box, no
  grey decline link. Art. 7(1) and (4) ask whether consent was freely given.
- **A refusal is recorded** and stops the asking. Re-asking somebody who
  declined is what turns a dialog into pressure.
- **`textVersion` is the load-bearing field.** Change the wording, bump the
  version, and everyone who agreed to the old sentence correctly counts as
  unasked again. That is inconvenient and it is the honest answer.

Never build a second consent store beside `lib/consent/`.
