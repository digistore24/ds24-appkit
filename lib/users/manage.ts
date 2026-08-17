// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// User management — database layer.
//
// Every writing function checks the rules from ./rules.ts FIRST and throws a
// UserError carrying a reason code if they refuse. The server actions
// (app/dashboard/admin/users/actions.ts) catch it and translate the code into
// the user's language.
//
// Note: these functions do NOT assume the caller is authorized — they check it
// themselves against the actor they are given. The actions still call
// requireOwner() on top of that (belt and braces).
import { db } from "@/db";
import { setupAudit, users } from "@/db/schema";
import { and, asc, count, eq, ilike, isNotNull, isNull, or, type SQL } from "drizzle-orm";
import { requireActiveUser } from "@/lib/authz";
import type { Role } from "@/lib/roles";
import { escapeLikeFragment } from "@/lib/sql-like";
import { USERS_PAGE_SIZE, type UserFilter } from "./list-filter";
import { MODULES } from "@/lib/modules/registry";
import {
  canCreateUser,
  canChangeRole,
  canDeleteUser,
  canDeleteOwnAccount,
  canBlockUser,
  canChangeEmail,
  canSendLoginLink,
  normalizeEmail,
  UserError,
  type Actor,
} from "./rules";

export interface UserRow {
  id: string;
  email: string | null;
  name: string | null;
  role: string;
  createdAt: Date;
  blockedAt: Date | null;
}

/** The columns the UI needs — in one place, not repeated in every query. */
const USER_COLUMNS = {
  id: users.id,
  email: users.email,
  name: users.name,
  role: users.role,
  createdAt: users.createdAt,
  blockedAt: users.blockedAt,
} as const;

/**
 * All users, oldest first.
 *
 * ⚠️ **Unpaged, and its remaining callers are the ones that need every row**:
 * the purchases screen's "attach to which account" dropdown and the setup
 * surface's `user_list`. The SCREEN stopped using it — a customer list is the
 * one table here that grows with sales — and asks `listUsersPage()` instead.
 */
export async function listUsers(): Promise<UserRow[]> {
  return db.select(USER_COLUMNS).from(users).orderBy(asc(users.createdAt));
}

/** What the paged list answers with — the shape `listOrders()` already uses. */
export interface UserPage {
  rows: UserRow[];
  /** How many match the filter, ignoring the page. */
  total: number;
  page: number;
  hasMore: boolean;
}

/**
 * The filter as a `where` clause.
 *
 * 🚨 **The search covers the address AND the name**, because an operator
 * looking somebody up has whichever of the two the customer gave them on the
 * phone. `escapeLikeFragment()` is not optional: a pasted `%` would otherwise
 * match every row and quietly answer a different question
 * (`lib/sql-like.ts` carries the argument).
 *
 * `undefined` when nothing is narrowed — drizzle drops the clause entirely
 * rather than adding a `where true`.
 */
function userWhere(filter: UserFilter): SQL | undefined {
  const clauses: SQL[] = [];

  if (filter.query) {
    const pattern = `%${escapeLikeFragment(filter.query)}%`;
    // A member who signed in by magic link has NO name (`users.name` is null),
    // so `or()` rather than a concatenation: comparing `email || ' ' || name`
    // would be null for exactly those rows and match nothing.
    clauses.push(or(ilike(users.email, pattern), ilike(users.name, pattern))!);
  }
  if (filter.role) clauses.push(eq(users.role, filter.role));
  if (filter.blocked === "blocked") clauses.push(isNotNull(users.blockedAt));
  if (filter.blocked === "active") clauses.push(isNull(users.blockedAt));

  return clauses.length === 0 ? undefined : and(...clauses);
}

/**
 * One page of users, narrowed by what the operator typed.
 *
 * Two statements rather than one windowed query, exactly as `listOrders()`
 * does it: the count is over the same `where` and the rows carry `limit + 1`
 * so "is there a next page" needs no second count.
 *
 * ⚠️ **`users.id` joins the ordering.** `createdAt` alone is not unique — the
 * seed writes two accounts in the same millisecond, and an import writes
 * hundreds — and an unstable sort under `OFFSET` shows a row twice on page two
 * while another never appears at all.
 */
export async function listUsersPage(filter: UserFilter): Promise<UserPage> {
  const where = userWhere(filter);
  const offset = (filter.page - 1) * USERS_PAGE_SIZE;

  const [rows, [counted]] = await Promise.all([
    db
      .select(USER_COLUMNS)
      .from(users)
      .where(where)
      .orderBy(asc(users.createdAt), asc(users.id))
      .limit(USERS_PAGE_SIZE + 1)
      .offset(offset),
    db.select({ n: count() }).from(users).where(where),
  ]);

  return {
    rows: rows.slice(0, USERS_PAGE_SIZE),
    total: Number(counted?.n ?? 0),
    page: filter.page,
    hasMore: rows.length > USERS_PAGE_SIZE,
  };
}

/** Number of admins — the basis for the "last admin" rule. */
export async function countOwners(): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(users)
    .where(eq(users.role, "owner"));
  return Number(row?.n ?? 0);
}

/** One user, or null. For checks where "does not exist" is a normal outcome. */
export async function findUser(id: string): Promise<UserRow | null> {
  const [row] = await db.select(USER_COLUMNS).from(users).where(eq(users.id, id));
  return row ?? null;
}

async function requireUser(id: string): Promise<UserRow> {
  const row = await findUser(id);
  if (!row) throw new UserError("userNotFound");
  return row;
}

/**
 * Creates a user (or updates the role if the email already exists). The user
 * then signs in the normal way, via a magic link.
 *
 * 🚨 **An address that already exists makes this an UPDATE, and updating a role
 * is `setUserRole()`'s question — so it is answered by `setUserRole()`'s rule.**
 * Without that second check this door went around both safeguards the role
 * rules exist for: `canCreateUser()` asks only whether the actor is an owner,
 * so an owner typing an address that was already taken could demote themselves
 * (`selfDemote`) or demote the LAST remaining owner (`lastOwnerRole`) — leaving
 * an app nobody can administer, with no support desk that could let them back
 * in. It happened silently in both directions: the admin form reports
 * "created" for a row it only updated, and `user_upsert` (lib/setup/tools.ts)
 * defaults `role` to "member", so an upsert naming the sole owner and omitting
 * the field was enough. That is AD-92's chain pointed the other way — not
 * "make somebody an owner" but "remove the owner" — and the two-act protocol
 * does not close it, for the reason lib/setup/rules.ts already gives.
 */
export async function createUser(
  actor: Actor,
  input: { email: unknown; role: Role; name?: string | null },
): Promise<UserRow> {
  const denial = canCreateUser(actor);
  if (denial) throw new UserError(denial);

  const email = normalizeEmail(input.email);
  if (!email) throw new UserError("invalidEmail");

  // The lookup before the upsert. Same shape as `setUserRole()`: read the
  // target, count the owners, ask the rule.
  //
  // ⚠️ The count is only paid for when the address is really taken AND the role
  // really moves. `canChangeRole()` answers `null` for `target.role === newRole`
  // anyway, so the second condition is exactly equivalent — but the count is an
  // ARGUMENT, and an argument is evaluated before the function it is passed to.
  // Asking eagerly would put a `count(*)` on every genuine create.
  const [existing] = await db
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (existing && existing.role !== input.role) {
    const roleDenial = canChangeRole(
      actor,
      existing,
      input.role,
      await countOwners(),
    );
    if (roleDenial) throw new UserError(roleDenial);
  }

  const [row] = await db
    .insert(users)
    .values({ email, role: input.role, name: input.name ?? null })
    .onConflictDoUpdate({
      target: users.email,
      set: { role: input.role },
    })
    .returning(USER_COLUMNS);
  return row;
}

/** Sets a user's role. */
export async function setUserRole(
  actor: Actor,
  targetId: string,
  newRole: Role,
): Promise<void> {
  const target = await requireUser(targetId);
  const denial = canChangeRole(actor, target, newRole, await countOwners());
  if (denial) throw new UserError(denial);
  if (target.role === newRole) return;
  await db.update(users).set({ role: newRole }).where(eq(users.id, targetId));
}

/**
 * Blocks a user (`blocked = true`) or lifts the block.
 *
 * Blocked means: no new sign-in (auth.ts) and the end of the running session
 * on the next page load (lib/users/blocked.ts). The account's data is kept —
 * that is what separates blocking from deleting.
 */
export async function setUserBlocked(
  actor: Actor,
  targetId: string,
  blocked: boolean,
): Promise<void> {
  const target = await requireUser(targetId);
  const denial = canBlockUser(actor, target, await countOwners(), blocked);
  if (denial) throw new UserError(denial);
  if (Boolean(target.blockedAt) === blocked) return;
  await db
    .update(users)
    .set({ blockedAt: blocked ? new Date() : null })
    .where(eq(users.id, targetId));

  // Blocking stops unattended card charges too.
  //
  // A blocked Member is redirected out of /dashboard by `requireActiveUser()`,
  // so the auto top-up off switch on their billing page becomes unreachable —
  // and the Operator has no control of their own. Leaving the account armed
  // would keep charging the card of somebody who has just been locked out, with
  // nobody able to stop it. The MANDATE is kept: blocking is reversible, and an
  // unblocked Member should not have to buy again to get back what they had.
  if (blocked) {
    const { disarmAutoReload } = await import("@/lib/tokens/account");
    await disarmAutoReload({ memberId: targetId }).catch((err) => {
      // Never fail the block over this — locking the account out is the more
      // important half and must not be undone by a token-table error.
      console.error("[users] could not disarm auto top-up on block:", err);
    });
  }
}

/**
 * Sets a user's email address.
 *
 * `emailVerified` is reset in the process: what had been verified was the OLD
 * address. The new one proves itself with the next sign-in link.
 *
 * Uniqueness is enforced by the unique index on `users.email` — which is why
 * this does not ask "does it already exist?" beforehand: between the question
 * and the write, a second admin could hand out the same address. The index
 * decides; the conflict is caught.
 */
export async function setUserEmail(
  actor: Actor,
  targetId: string,
  input: unknown,
): Promise<string> {
  const target = await requireUser(targetId);
  const denial = canChangeEmail(actor);
  if (denial) throw new UserError(denial);

  const email = normalizeEmail(input);
  if (!email) throw new UserError("invalidEmail");
  if (email === target.email) return email;

  try {
    await db
      .update(users)
      .set({ email, emailVerified: null })
      .where(eq(users.id, targetId));
  } catch (error) {
    if (isUniqueViolation(error)) throw new UserError("emailTaken");
    throw error;
  }
  return email;
}

/**
 * A member renames THEMSELVES. The one write the API's `PATCH /api/v1/me`
 * does — the id comes from the authenticated key (or session), never from the
 * request, which is what keeps this IDOR-free by construction. The name is
 * already normalized (`checkDisplayName` in rules.ts); `null` clears it.
 *
 * Deliberately no Actor and no denial ladder: unlike every function above,
 * this one acts on the caller's own row, and there is nothing to refuse — a
 * person may always rename themselves.
 */
export async function setOwnName(memberId: string, name: string | null): Promise<void> {
  await db.update(users).set({ name }).where(eq(users.id, memberId));
}

/**
 * Checks whether an admin may send this user a sign-in link, and returns the
 * destination address. The sending itself happens in the server action — it
 * goes through Auth.js (signIn) so that exactly the same token mechanism
 * applies as for a normal sign-in.
 */
export async function loginLinkTarget(
  actor: Actor,
  targetId: string,
): Promise<string> {
  const target = await requireUser(targetId);
  const denial = canSendLoginLink(actor, target);
  if (denial) throw new UserError(denial);
  return target.email as string;
}

/**
 * Deletes a user. Sessions and accounts hang off it via ON DELETE CASCADE
 * (see db/schema.ts) and go with it.
 */
export async function deleteUser(actor: Actor, targetId: string): Promise<void> {
  const target = await requireUser(targetId);
  const denial = canDeleteUser(actor, target, await countOwners());
  if (denial) throw new UserError(denial);
  // The objects, before the row. A foreign key cascade reaches the database and
  // not the bucket, and `media.ownerId` is `set null` — so without this the row
  // survives orphaned and NOTHING left in the database can ever find the file
  // again. This is the button an operator presses when a customer writes in
  // asking to be deleted; `deleteOwnAccount()` below has done it since it was
  // written, and this path was missed.
  const { deleteOwnedMedia } = await import("@/lib/media/manage");
  await deleteOwnedMedia(targetId);

  await deleteAccountRow(targetId);
}

/**
 * The row itself, with everything that has to happen in the SAME transaction.
 *
 * Both deletion paths — the operator's button above and the member's own
 * self-service below — go through here, because "what leaves with a person" is
 * one answer and two copies of it would drift the first time a table is added.
 *
 * What is here rather than in a cascade: anything a member WROTE whose row has
 * to outlive the account. A cascade removes rows keyed by the member; it cannot
 * help where the row must survive and only the words must go — a post that is
 * one turn in a conversation other people are still having, a message that is
 * one half of a correspondence whose other participant keeps their own side
 * (FR-203). For those the foreign keys are `set null` and the text is taken out
 * explicitly, in the same transaction as the delete, so there is no window
 * where the account is gone and the words are not.
 *
 * Each installed module answers that for its own tables — see the loop below.
 * This function names none of them, and that is the point: adding a module must
 * not mean remembering to edit this file.
 */
async function deleteAccountRow(memberId: string): Promise<void> {
  await db.transaction(async (tx) => {
    // Every installed module scrubs what this member wrote, in the SAME
    // transaction and before the row goes — so there is no window where the
    // account is gone and the words are not.
    //
    // 🚨 Not gated on anything. A module that is installed but switched off
    // still holds every row written while it was on; the manifest refuses a
    // module that declares tables without `erase: true`, so a module holding
    // rows about a person cannot reach this loop without a way to erase them.
    // With no module installed `MODULES` is empty and this is a bare
    // `DELETE FROM users` — which is the right answer for an app that holds
    // nothing but the core's own tables.
    for (const mod of MODULES) await mod.eraseFor?.(tx, memberId);

    // 🚨 The setup trail, and it is the core's own case of exactly what the
    // loop above does for a module: the ACT stays and the PROSE goes.
    //
    // `setup_audit.reason` is a sentence an operator wrote ABOUT this member —
    // why they were granted a plan by hand, why one was ended. It is one of the
    // two named exceptions to "identifiers and numbers, never payload"
    // (`docs/data-protection.md` → *The setup surface*), it is in both Art. 15
    // exports, and § 14g's rule therefore reaches it: *what is emptied is the
    // TEXT; the ACT stays*. `subject_member_id` is `set null`, so the row
    // survives the delete with its link removed — but the words would have
    // survived with it, for the twenty-four months this trail is kept.
    //
    // ⚠️ It runs BEFORE the delete, in the same transaction, because the
    // foreign key is what makes these rows findable at all: after
    // `delete from users` the link is null and nothing can tell whose sentence
    // this was. `target` is deliberately left alone — an address in a record
    // that outlives the account is the footing `orders.buyer_email` already
    // keeps, and the operator's trail would otherwise say an act happened to
    // nobody.
    await tx
      .update(setupAudit)
      .set({ reason: null })
      .where(eq(setupAudit.subjectMemberId, memberId));

    await tx.delete(users).where(eq(users.id, memberId));
  });
}

/**
 * Deletes the SIGNED-IN member's own account — the Art. 17 self-service path.
 *
 * ── It takes no id, and must never start taking one ───────────────────────
 * The account deleted is always the session's own, the same guarantee
 * `spendTokens()` gives. A Server Action is an HTTP endpoint of its own, so an
 * id arriving in a `FormData` would let anybody delete anybody — the most
 * destructive IDOR this app could have, and an irreversible one. That is also
 * why this does not simply call `deleteUser(actor, actorId)`: that function
 * refuses self-deletion by design, and "fixing" it to allow the case would
 * remove the guard that stops an Operator wiping themselves off their own user
 * list.
 *
 * ── What survives, and why the caller has to say so ───────────────────────
 * `db/schema*.ts` decides this, not this function. Going with the account
 * (`cascade`): sessions, OAuth links, chat transcripts, API keys, grants,
 * pending address changes, consent records, the impersonation rows that name
 * this member, and their community profile — the name they chose and what they
 * wrote about themselves is their own description of themselves, with nothing
 * behind it that outlives them. Staying with the member link set to `null`: `orders`,
 * `subscriptions`, `token_ledger`, `ai_usage` — accounting records that
 * § 147 AO and § 257 HGB require to be kept and that Art. 17(3)(b) exempts from
 * erasure while that obligation runs.
 *
 * **Deleting them on request would be the violation, not the remedy.** The
 * dialog has to name this before the button is pressed; a person who believed
 * "delete" meant "everything" was not informed.
 *
 * ── The one thing a cascade cannot do ─────────────────────────────────────
 * Uploaded files live in object storage, not in Postgres. A foreign key with
 * `on delete cascade` removes the ROW describing a file and leaves the file
 * itself sitting in the bucket for ever — at which point the app has told
 * somebody their data is gone while still holding it, and nothing left in the
 * database can find it to finish the job. So the objects are removed FIRST,
 * and a failure there stops the deletion rather than proceeding without them.
 */
export async function deleteOwnAccount(): Promise<void> {
  const session = await requireActiveUser();

  const actor: Actor = {
    id: session.user.id,
    role: session.user.role,
  };

  const denial = canDeleteOwnAccount(actor, await countOwners());
  if (denial) throw new UserError(denial);

  // Before the row goes. Imported here rather than at the top of the file so
  // that the media layer — and the environment reading it does — is only
  // touched by installations that reach this line.
  const { deleteOwnedMedia } = await import("@/lib/media/manage");
  await deleteOwnedMedia(actor.id);

  await deleteAccountRow(actor.id);
}

/**
 * Does this error violate a unique index? Postgres reports that as SQLSTATE
 * 23505 — the code is stable, the error message is not (it depends on the
 * server's language).
 */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: string }).code === "23505"
  );
}
