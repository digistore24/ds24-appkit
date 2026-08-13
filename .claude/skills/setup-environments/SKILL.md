---
name: setup-environments
description: Sets an environment up from here — creates accounts, hands out plans, uploads media and creates community rooms in DEV, STAGING or PROD through the app's own setup surface rather than a shell holding a production connection string. Use this when the user says "create an owner account on production", "the live app is empty", "my rooms only exist locally", "give this customer access", "put this file on staging", or when go-live needs the live database filled. Not for code, config files or the .env — those travel with git.
requires: 0.20.0
---

# Setting an environment up

Code travels with a deploy. **Rows do not.** The owner account, the community
rooms, the courses — each lives only in the database it was made in. This skill
is how you put them where they belong, without a production connection string in
anybody's shell.

The full reference is **[`docs/setup-mcp.md`](../../../docs/setup-mcp.md)**. Read
it before step 3 if you are about to touch production.

---

## Step 0 — is it already there?

```bash
node run.mjs setup-check
```

That answers three things at once: whether the surface is switched on in this
checkout, which environments this machine can reach, and — with `--live` — what
each of them actually says.

- **"the surface is off"** and you only need DEV → step 1.
- **environments listed with keys** → you are set up; go to step 3.
- **"no key yet"** → step 2.

⚠️ If it says the surface is **on**, note that this is not the shipped state.
That is fine while you are working; it is worth knowing before a deploy.

## Step 1 — switch it on (a deploy, deliberately)

```json
// config/setup.json
{ "enabled": true }
```

There is no runtime toggle. Switching it on is a deploy and so is switching it
off — a switch that lived in the database would be one that whoever reached the
database could turn.

⚠️ **Any unknown key or wrong type in that file switches the whole surface off.**
The failure mode here is an open write endpoint on a production database, so
every doubt falls towards closed. `setup-check` says which key it choked on.

## Step 2 — a key for this environment

Signed in as an owner, open **`/dashboard/admin/setup-keys`** and mint one. It is
shown exactly once. Put it in `.env`:

```bash
SETUP_KEY=ds24setup_…            # this machine's environment
SETUP_KEY_STAGING=ds24setup_…
SETUP_KEY_PROD=ds24setup_…
```

🚨 **Never in a file git tracks.** The MCP wiring ships with the template and
carries the command and nothing else.

**A fresh production database has no owner**, so there is nobody to sign in as.
That case has its own command:

```bash
node run.mjs setup-bootstrap --email you@example.com --apply
```

It creates the first owner and one short-lived key, writes the key into `.env`
without printing it — so it never reaches this transcript — and refuses once an
owner exists. Mint a proper key on the page straight after.

⚠️ **No browser here?** Then that refusal used to be the end of the road, and
`content-check` with it. On a machine that already has `DATABASE_URL` — a local
install, most often — mint one from the command line instead:

```bash
node run.mjs setup-key --apply          # dry run without --apply
```

It mints for an owner who already **exists** (creating the first one stays the
bootstrap's job), writes it into `.env` and prints nothing. `--email` picks the
owner when there is more than one; it refuses to guess. It hands you no
privilege you did not have: whoever holds the connection string can already do
everything this surface does. On a deployed environment you do not hold it, and
the admin page is still the way. (Needs template 0.27.0.)

## Step 3 — do the work

Ask for what you need in plain words. The tools are enumerated: if something is
not a listed tool, it cannot be done here.

| To do this | Tool |
|---|---|
| see what an environment is made of | `list_modules`, `list_environment` |
| see who exists | `user_list` — optionally by role |
| create or update an account | `user_upsert` |
| give somebody a plan by hand | `grant_by_hand` — needs a written reason |
| end a manual grant | `grant_revoke` — **irreversible**, needs a reason |
| put a file in the media store | `media_upload` — give a **path**, not the bytes |
| ask whether the content is there | `content_presence` — each owner answers for its own rows |
| see what publishing would do | `content_publish`, mode `plan` — writes nothing *(needs template 0.24.0)* |
| publish this repo's content there | `content_publish`, mode `apply` *(needs template 0.24.0)* |
| publish it **including the big media** | `node run.mjs content-publish --env <env> --apply` — the COMMAND, not a tool *(needs template 0.24.0)* |
| place ONE declared media file there | `content_media_url`, then `content_media_confirm` — the command above drives them in the right order; you do not call them by hand *(needs template 0.24.0)* |
| see what this surface has done there | `list_acts` |
| see the course an environment holds | `courses_outline` *(the module contributes it)* |
| create a community room | `community_group_upsert` *(the module contributes it)* |
| see the rooms it already has | `community_group_list` *(the module contributes it)* |

**That is the whole surface**, which is what makes the sentence above the table
worth anything — the last three are there only where their module is, and **a
module that is not installed contributes nothing**, the same statement
`node run.mjs module list` makes about its commands.

Every tool is safe to repeat: the second run reports **found** instead of
**created**.

**`content_publish` is one tool in two modes.** In `plan` it reports what each
applier would create and change and what the media store is missing, inside a
read-only transaction the database enforces. In `apply` it publishes: the media
rows the manifest declares, then the files the image carries, then every applier
in its own transaction. Two things worth repeating back to the user when you show
them a plan: an applier reported as *"does not say what it would change"* is
**not** an applier with nothing to do, and a plan that lists no appliers at all
is a defect rather than an empty app — the tool refuses with the reason instead
in that case.

When you have applied, say four things and do not skip the last two:

1. **what committed** — the tool reports it per applier, with the row counts;
2. **the exit condition**, which the answer names for you:
   `node run.mjs content-check --env <env>`. Green there means the rows and files
   are *present*, **not** that the page renders — that is somebody opening one
   real content page with a real slug;
3. 🚨 **whether it was PARTIAL.** A run whose third applier threw, or that ran
   out of its 25-second budget, reports the appliers it never reached and is
   recorded as `contentPublishPartial`. Do not report that as done. Say what
   landed, say what did not, and offer to run it again — every applier upserts,
   so a retry asserts rather than duplicates;
4. **that the staged media did not travel.** Anything in `.data/content-media/`
   is on the user's machine and not in the deployed image, so `content_publish`
   alone cannot place it — see the next section, which is how you avoid ever
   having to say this.

### The big media: `node run.mjs content-publish`

🚨 **A course with lesson videos is not published by `content_publish` alone.**
Those files are staged in `.data/content-media/`, which travels with no deploy
and is in no image, so the tool cannot see them — and every lesson pointing at
one would then hit `mediaIdFor(): no media row`.

Run the command instead. It does the whole flow in the right order and uses the
two tools you would otherwise have to drive by hand:

```bash
node run.mjs content-publish --env prod            # a dry run — what it would do
node run.mjs content-publish --env prod --apply
```

Four things to tell the user about it, because each one surprises somebody:

- **It needs `APP_URL_PROD` and `SETUP_KEY_PROD` and nothing else.** No bucket
  keys, no `DATABASE_URL`. That is the whole point: the bytes go from their
  machine straight to that environment's bucket over an address the app minted.
- **It refuses before it writes anything** when a declared file is on neither
  local leg, and it names **every** missing file, not the first. The fix is
  `node run.mjs content-media-sync` — that is what fills the staged leg and
  records the `sha256`/`bytes` the flow needs.
- **Running it twice is the same as running it once** — a file already there
  with the declared length is reported as *found* and not uploaded again.
- **In DEV it usually cannot upload at all**, and it says so with the reason: the
  local media driver has no address anything but the app can reach. Locally, use
  `node run.mjs content-media-sync --apply`.

The shell path (`node run.mjs content-apply` + `content-media-sync`) is still
there and is not deprecated — it is what an operator uses whose setup surface is
switched off ([`docs/content.md`](../../../docs/content.md)).

### Outside DEV, every change is two steps

Ask for a **plan** first — it says exactly what would change, against the real
database — then apply it with the token the plan returned.

> ⚠️ **Tell the user what this does and does not buy.** It stops a stale plan
> and a mistyped flag. It does **not** stop you calling both steps in a row,
> because that is what you do. If they want a human in the loop for production,
> the honest answer is to keep the surface off there and use the pages.
>
> Two more things the word "confirmation" invites people to believe and which it
> does not carry: it does not mean a **human** agreed, and it does not mean the
> plan you showed them a minute ago is **still true**. The token is spent on
> entry and binds this call at this moment — so a publish that takes four
> minutes is fine, and an agent that thinks for three minutes between the plan
> and the apply is correctly refused.
>
> 🚨 **"This call" includes the FILE at `media_upload`**, which is the one tool
> whose act is the payload rather than something its input names: its `path`
> points at a file on the user's machine that the app never opens. So a plan and
> an apply carrying different bytes under the same `path` is refused — it used
> to store the second file and report success. If the user edits the picture
> between the two steps, plan again; the refusal does not spend the token.

## Step 4 — say what you did

```bash
node run.mjs setup-check --live
```

Every act — applied, planned or refused — is one row in the record, readable on
**`/dashboard/admin/setup-audit`**. An audit trail nobody reads is not a
control; if you switched this on for production, say so and point at the page.

---

## What you cannot do here, and must not work around

Each of these is a decision, not a gap. If the user asks for one, say which it
is and offer the real path.

| Asked for | The answer |
|---|---|
| "just run this SQL" | No SQL tool exists. One general tool would make every other control decoration. |
| "change this lesson's text on production" | Not authored here, and no tool of this surface writes a lesson. Blocks and lessons belong to the **applier**, which writes them from `content/course/*.json` in the repo, keyed by slug, on every run — one writer per row class. `content_publish` *triggers* that applier inside the running app; it never becomes a second author, and a lesson typed through a tool would be silently overwritten by the next publish. **The real path:** edit the file, then `node run.mjs content-publish --env prod --apply`. What this surface does with content is read it (`courses_outline`), count it (`content_presence`) and carry bytes into the store (`media_upload`, `content_media_url`). |
| "add a column" | Schema travels with the code, in `drizzle/`, reviewed, applied by the deploy hook. |
| "make me an owner on production" | Refused outside DEV. Promotion is a human act on `/dashboard/admin/users` — see below. |
| "delete this member" | Erasure has its own paths: the member's own account page, or `node run.mjs data-export` for a request. |
| "show me their messages" | Private conversations have no reader outside the participants, anywhere in this app. |
| "who is in this room?" | There is no roster by design — presence in a plan-gated room is purchase information. |
| "change the .env on prod" | Not this surface. Secrets go through the host's secret management. |

**Why `owner` is refused outside DEV, in one sentence you can repeat:** you read
text other people wrote — community posts, a member's name, a support mail — and
any of it can carry instructions; during such a call the key is valid, the tool
is allowed and the record is written, so every control says yes. The one
irreversible escalation is therefore not in the surface at all.

---

## When it does not work

| Symptom | What it is |
|---|---|
| the tools do not appear at all | your program's trust gate — Claude Code asks for approval, Codex ignores `.codex/` until the project is trusted, Antigravity asks once for the workspace and then per tool (an unruled MCP tool defaults to *Ask*). OpenCode has no gate. |
| `404`, empty body | the surface is off *there*, or that app predates it. Switching it on is a deploy. |
| `envMismatch` | you addressed one environment and the app says it is another. Believe the app; check its `APP_ENV`. |
| `401` | unknown, revoked or expired key, or its owner is no longer an owner. All four answer the same 401 on purpose. |
| `confirmationRequired` | outside DEV: ask for a plan first. |

Next: **`go-live`** if this was the production fill, or **`community`** if you
just created rooms and want to know what else that module needs.
