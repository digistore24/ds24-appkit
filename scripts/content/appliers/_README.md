# This app's own appliers

An **applier** is how content that lives in this repo gets into a database —
DEV, STAGING or PROD. `node run.mjs content-apply` runs every `.mjs` file in
this folder, in alphabetical order, inside a transaction.

One file per piece of content, and each of them exports two functions:

```js
// scripts/content/appliers/course.mjs
export async function apply(sql, { mediaIdFor }) {
  // upsert your rows by slug — never a bare insert, so a re-run asserts the
  // content instead of duplicating it. Returns how many rows it wrote.
}

export async function present(sql) {
  // read-only: how many of those rows are there right now? This is what
  // `node run.mjs content-check` asks of an environment.
}
```

Files starting with `_` and anything that is not `.mjs` are ignored, so a
shared helper lives here as `_helper.mjs` — and this file is not an applier.

**The folder itself ships with the app, empty.** That is deliberate: an empty
folder means *this app declares no content*, and `content-apply` says so and
exits 0. A folder that **cannot be read** is a different answer — the run
refuses and names the path it tried, because content that cannot be applied is
content that will not exist in PROD.

The full convention — upserting, `mediaIdFor()`, partitioning a table, and the
go-live step against PROD — is in [`docs/content.md`](../../../docs/content.md).
