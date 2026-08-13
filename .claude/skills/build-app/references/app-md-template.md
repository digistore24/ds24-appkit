<!-- Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA — SPDX-License-Identifier: MIT -->

# The `docs/app.md` template

_Read from `build-app`, step 4b: the shape of the app's own notebook. Copy it
when creating the file, and keep it, so every entry reads the same._

```markdown
# <App name> — what this app is

_What was built on top of the template. The template's own rules are in
CLAUDE.md; this file is only what came after. One entry per feature, written the
moment the feature works._

## The product

- **Sells:** <what a customer buys>
- **For:** <who>
- **Archetype:** <from step 1>
- **Content authority:** <developer | separate-author | platform — who edits
  the content after launch; decides code vs. tables, docs/content-authority.md>
- **Output artifact:** <what the customer ends up holding — the line from the
  product brief, or the answer from step 1b. "a finished sales page with a hero
  image", not "sales copy">
- **Alongside the customer:** <what the app does with them while they work — the
  line from the product brief, or the answer from step 1c. "reads each day's
  answer and replies", not "AI-supported">

## Features

### Reports — `/dashboard/reports`

- **Does:** turns a member's entries into a monthly PDF.
- **Done when:** a member sees their monthly PDF — <the sentence the user OK'd
  before building (CLAUDE.md → Adding a feature, step 0), recorded once it held>
- **Access:** `hasPlan(memberId, "basic_monthly")`
- **Data:** tables `reports`, `report_runs` (`db/schema.ts`)
- **Costs tokens:** 5 per run (`spendTokens`)
- **Tests:** `lib/reports/rules.test.ts`

## Decisions worth remembering

- <what was decided against, and why — this is the part nobody reconstructs>
- <including a "no" from step 1b or step 1c: "no pictures in the messages,
  deliberately, because …", "no AI companion, deliberately, because …" —
  otherwise either is proposed again next session>
- <Planned 2026-08-05: a feature too big for one session parks its plan here,
  named in words rather than its route — the route belongs to the finished
  entry above, which is what the greeting's reminder checks for>
```
