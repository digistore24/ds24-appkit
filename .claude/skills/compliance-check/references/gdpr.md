<!-- Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA — SPDX-License-Identifier: MIT -->
# GDPR — the per-check detail

Detail for the `compliance-check` skill: the privacy policy (check 3 ·
`pages`), the data-subject rights (check 6 · `rights`) and the evidence pack
(check 7 · `evidence`). The decision path, the finding format and the report
stay in `SKILL.md`; this file is what you work from once one of those checks
runs.

## The privacy policy — Art. 13 GDPR

**Draft it from `docs/data-protection.md`, not from a checklist and not from a
generator.** That file was read out of the code. A generic policy will miss what
this app actually does, and the misses are not obvious:

- **IP addresses are processed** — in memory, fifteen minutes, to stop password
  guessing (§4). Nothing is stored, and processing without storing is still
  processing. Legitimate interest in securing the service is the basis that fits.
- **`ipn_events` holds the complete raw webhook body**, buyer data and all, for
  60 days (§3).
- **`email_changes` can hold a stranger's address** — a mistyped target — for up
  to 24 hours (§2).
- **Operator notes are personal data** (§3). The app never shows them to the
  customer; that is tone, not an exemption.
- **The AI company is the operator's choice**, not a fixed name (§5, §8).
  `node run.mjs ai-check` says which one. Naming the wrong one is worse than
  naming none.
- **Nothing about the person is sent to the assistant** — no name, address,
  balance or purchase (§8). Worth saying, because customers ask. ⚠️ **Only
  where there is no companion.** With one switched on that sentence is false,
  and it is false in a legal document — write the bullet below instead of this
  one, or write both, scoped: *"the assistant is sent nothing about you; the
  coach is sent what you submit to it"*.
- **A companion is sent what the customer wrote**, plus the fields its entry
  names (§8a) — and possibly to a **different company** than the assistant's,
  because the two are separate tasks in `config/ai-models.json`.
  `node run.mjs ai-check` names both. **An app with no companion gets no such
  paragraph at all** — the shipped state is `"enabled": false`, and a policy
  describing a feature the app does not have is as wrong as one that omits a
  feature it does.
- **Operator access to an account is recorded** and the customer may be told
  (§12).

If the app has grown since that file was written, **update it first**. A privacy
policy is only as true as the list it was drafted from.

## Data-subject rights — what a person may demand

| Right | Art. | Where | Verify by |
|---|---|---|---|
| Information | 15 | member's own download; `node run.mjs data-export --email …` | run the command |
| — and it covers learning performance | 15 | `activity_results` in BOTH exports (`docs/data-protection.md` §8b) | where `modules/activity/` exists (0.9.0+): the export carries an `activityResults` section. Older clone: not applicable, not a finding |
| Rectification | 16 | `/dashboard/account`, and the Operator's user page | open the page |
| Erasure | 17 | account deletion, both self-service and Operator | read the dialog text |
| Restriction | 18 | blocking the account | — |
| Portability | 20 | the same JSON | run the command |
| Objection | 21 | only bites once something runs on legitimate interest | — |
| No automated decision | 22 | ⚠️ the core makes none. **With `community` installed the app makes TWO.** (1) Enough reports silence a member's writing with nobody deciding, weighted by tenure and purchases when `weighting` is on. (2) The `newMember` grace limits a new account holding no purchased access for a configured window — 🚨 it ships **ON**, and unlike (1) it needs **no report**, so it reaches people nobody has complained about. Both: writing only, never reading; nothing stored; a human lifts either (a moderator's audited tap, or the operator's protect list) | `docs/data-protection.md` §15 and §14g — and `node run.mjs module list` says whether it applies to THIS app |

**A companion's turns need nothing extra here, and that is worth saying rather
than assuming.** They are rows in `chat_messages` under a `conversation_id`, not
a table of their own — so they are already in **both** exports and already go
with the account on the cascade that was there before. Verify it the same way as
everything else in this table: `node run.mjs data-export --email …` and
`npm run test -- lib/privacy/export.test.ts`. The parity guard is what would
catch a *separate* table reaching one export and not the other, which is the
failure a second table would have introduced.

**The two exports must not drift.** The member's own download omits the raw
webhook bodies (they can carry a third party's data and nobody is in between to
redact them, Art. 15(4)); everything else is identical, and
`lib/privacy/export.test.ts` fails the build if one grows a table the other
lacks. If the user has added a table, that test is what catches it — run it.

**The deletion carve-out has to be in the privacy policy, in plain words.**
Orders and `ai_usage` survive with the member link removed, because § 147 AO and
§ 257 HGB require them and Art. 17(3)(b) exempts exactly that. "We delete
everything" is a promise the app does not keep and did not need to make.

**The genuinely open question** (`docs/data-protection.md` §6): nothing deletes
an order once its retention period has actually run out. Correct in year one,
wrong by year eleven. Put it in the report as a decision the user has to make,
not as a bug.

**One month** to answer (Art. 12(3)), extendable by two with reasons.

## The evidence pack — Art. 5(2), accountability

| File | What | Derive from |
|---|---|---|
| `verarbeitungsverzeichnis.md` | record of processing (Art. 30) | `docs/data-protection.md` + `config/ai-models.json` + the mail and host setup |
| `tom.md` | technical and organisational measures (Art. 32) | the real ones: scrypt hashes, SHA-512 IPN signature, `lib/rate-limit.ts`, `requireOwner()`, `readOnly`/scopes as the API-key boundary, no IP storage |
| `loeschkonzept.md` | deletion concept | the windows in `lib/cron/jobs.ts`; the proof is `node run.mjs cron --list` |
| `avv-register.md` | processor agreements (Art. 28) | recipients from `docs/data-protection.md` §5, with the AI company actually in use |
| `ki-register.md` | AI systems, role, risk class, Art. 50 measures | check 4 — **one row per surface**: the assistant and any companion are two systems, possibly on two companies |
| `ki-kompetenz.md` | AI literacy measures (Art. 4) | ask the user what they did |
| `datenpanne.md` | breach procedure (Art. 33/34) | write it now, not during one |

Two things to get right:

- **The record of processing is not optional for a SaaS.** The Art. 30(5)
  exemption falls away as soon as processing is regular, which it is by
  definition here.
- **`datenpanne.md` has a clock in it: 72 hours** to the supervisory authority.
  A procedure written during an incident is a procedure written badly. Name who
  decides, who they call, and what gets written down.
