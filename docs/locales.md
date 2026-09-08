<!-- Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA — SPDX-License-Identifier: MIT -->

# Languages — what the app speaks, how one is chosen, how to add or remove one

`CLAUDE.md` → *Languages* carries the refusals. This file carries the mechanics:
where the list is, how a visitor's language is picked, how text is written, and
the two recipes.

## The list

**The languages are `LOCALES` in `i18n/config.ts`, and nowhere else.** The app
ships with `de`, `en`, `es` and `fr`; the texts live in one
`messages/<code>.json` per language, plus one `modules/<id>/messages/<code>.json`
per installed module.

Read the list from `LOCALES` — never count the files, and never write a pair
like `["de", "en"]` into a loop. A hand-written list is how a language quietly
stops being checked: `scripts/modules/messages.test.ts` walked `["de", "en"]`
for a year, and the day the app spoke four, the two newest catalogues were never
opened and the test stayed green.

## How a visitor's language is chosen

Three sources, in this order, and only a language in `LOCALES` can win:

1. **The cookie** `NEXT_LOCALE` — the visitor's own choice, set by the switcher
   in the sidebar. A cookie naming a language the app no longer speaks is
   ignored.
2. **The browser** — `Accept-Language`, honouring its quality weights and
   ignoring regions (`de-AT` counts as `de`). The first language on the
   visitor's list that the app speaks wins.
3. **`DEFAULT_LOCALE`** — when the browser asks for none of ours: **English if
   the app speaks it, otherwise the first language in `LOCALES`.** It is derived
   from the list, never written by hand (`fallbackLocaleFor()` in
   `i18n/config.ts`).

The same `DEFAULT_LOCALE` is what a mail, a legal page, a checkout or the
operator's own notifications fall back to when the locale they were given is
not one of ours. To change the fallback, change the list: put the language you
want first, or add English.

**There is no language prefix in the URL** — `/plans` stays `/plans`. So a page
never has to know which language it is rendered in, and a link a customer
shares works for whoever opens it. The wiring is `i18n/` and nowhere else.

The language of **operator mail** — a job has no cookie — is the `locale` in
`config/notifications.json`, one of the codes in `LOCALES`.

## Writing text

**No visible text in the code.** Every sentence, label, placeholder and error
message lives in *every* `messages/<code>.json`. `i18n/messages.test.ts` breaks
the build when one language is missing a key, a placeholder or an error code,
and it renders every message, so an ICU plural whose braces no longer balance
fails the build instead of putting its own key on a page.

```tsx
// Server component (client components: useTranslations)
const t = await getTranslations("users");
<h1>{t("title")}</h1>

// Text with markup (e.g. <code>) — don't stitch it together:
t.rich("hint", { code: (chunks) => <code>{chunks}</code> })
```

**Finding a key: grep, never the catalogue.** `messages/de.json` is a file
sessions read whole, 25 times in 11 field runs, to find one key. The key is a
grep away — `grep -n '"title"' messages/de.json` — and the catalogue's shape is
already known: one object per namespace, one string per key, the same keys in
every `messages/<code>.json`. Read the catalogue only to add to it, and then
the namespace, not the file.

- **Dates and prices are formatted, never spelled by hand.**
  `useFormatter().dateTime(…)` or `formatPrice(def, locale)`, never
  `toLocaleDateString("de-DE")`.
- **A price is only *written* differently, never converted.** What gets billed is
  what is on file at Digistore24, and a conversion in the app would put a number in
  front of the customer that the checkout then contradicts.
- **Identifiers in the code are English**, and only what the customer SEES is
  translated: `createUserAction`, `emailPlaceholder`, `selfDelete`. The message
  keys are English too — the German text lives behind them, never in them.
- **Error messages never come into being deep in the code.** Rule and database
  layers return *codes* (`lib/users/rules.ts` → `"selfDelete"`); only the Server
  Action translates them (`app/dashboard/admin/users/actions.ts`). A sentence born
  in `lib/` is always in exactly one language.

**Every language addresses the reader informally** — German `du`, Spanish `tú`,
French `tu`, and English's implicit one. That is a decision, not an accident, and
it is written down because it is invisible in any single string and expensive to
reverse once half a catalogue has drifted the other way. The German is the
original voice and it says `du` in 132 sentences against `Sie` in four, so a
`vous` in the French would be a different product speaking rather than a
translation. French commerce leans towards `vous` and somebody will propose it;
the answer is that these apps are sold to their buyers, not to their buyers'
procurement departments. A new language follows the same rule.

**Not translated, deliberately:** product names, plan features and descriptions from
`config/digistore-products.json` — that is your product copy, and at Digistore24 the
same text is on file. Likewise the app name (`lib/app.ts`) and the terminal output of
the scripts under `scripts/`.

## Adding a language `<code>`

1. `messages/<code>.json` — copy `de.json` and translate every string. The same
   for `modules/<id>/messages/<code>.json` in every installed module.
2. `<code>` in `LOCALES` and its name in `LOCALE_LABELS` (`i18n/config.ts`).
3. The import and the entry in `i18n/static-messages.ts`.
4. `title.<code>` in every `modules/<id>/module.json`.
5. The language's word for a machine in `NAMES_A_MACHINE` (`lib/ai/disclosure.mjs`).
6. `content/legal/<slug>.<code>.md` for every legal page in `content/legal/`.
7. `<code>` in `productIds` of every product in `config/digistore-products.json`,
   then `node run.mjs ds24-sync` — one Digistore24 product per language.
8. The currency an operator in that language is most likely billed in —
   `CURRENCY_BY_LOCALE` in `lib/ai/pricing.mjs`, `EUR` or `USD`. A suggestion
   `ai-check` prints, never a rule; but a language with no row there used to be
   silently `USD`, which is how this step went unnamed for as long as the table
   was a set of the euro languages.

`npm run test` holds steps 1 to 4, 6 and 8; `node run.mjs legal-check` reads 5
and 6. The same list is the header of `i18n/config.ts`.

## Removing a language `<code>`

1. Delete `messages/<code>.json` and every `modules/<id>/messages/<code>.json`.
2. Remove `<code>` from `LOCALES` and `LOCALE_LABELS` (`i18n/config.ts`).
3. Remove the import and the entry from `i18n/static-messages.ts`.
4. Remove `title.<code>` from every `modules/<id>/module.json`.
5. Remove the entry from `NAMES_A_MACHINE` (`lib/ai/disclosure.mjs`).
6. Delete `content/legal/<slug>.<code>.md`.
7. Remove `<code>` from `productIds` in `config/digistore-products.json`. A product
   that already exists at Digistore24 is deactivated **there**, by hand —
   removing its id here does not unpublish it.
8. Remove the row from `CURRENCY_BY_LOCALE` in `lib/ai/pricing.mjs`.
9. If `config/notifications.json` names `<code>`, set its `locale` to a language
   the app still speaks.

`npm run test` holds steps 1 to 4, 6 and 8. A visitor whose cookie still names the
removed language is treated as a first-time visitor and gets the browser's
choice. If you removed English, `DEFAULT_LOCALE` is now the first language in
`LOCALES` — order the list accordingly.
