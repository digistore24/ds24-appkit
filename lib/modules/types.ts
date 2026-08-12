// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// What a module offers the SERVER — the contract `modules/<id>/module.ts`
// implements and the generated `lib/modules/registry.ts` collects.
//
// Hand-written, not generated: the generator produces the LIST, this file
// produces the shape. A type nobody wrote by hand is a contract nobody agreed
// to.
//
// ── Everything here is optional except the id ──────────────────────────────
// A module that only adds pages implements nothing at all. What is NOT optional
// is the pairing: `scripts/modules/manifest.mjs` refuses a manifest that
// declares `tables` without `erase: true`, so a module holding rows about a
// person cannot ship without the one method that erases them. The type says
// "optional"; the manifest says "not for you".
import type { db } from "@/db";
import type { ModulePrivacy } from "./privacy";

/**
 * The slice of a transaction a module's erasure is handed.
 *
 * Deliberately narrow — `update` and nothing else. A module scrubs what a
 * member WROTE; it does not delete rows out from under the cascade
 * `db/schema*.ts` already describes, and it never gets to touch a table that is
 * not its own. The same shape `scrubCommunityContentFor()` already takes.
 */
export interface ModuleEraseTx {
  update: typeof db.update;
}

/** Who the shell is being drawn for. */
export interface ModuleViewer {
  readonly memberId: string;
  readonly role: string;
  /**
   * Is an operator signed in AS this member right now?
   *
   * 🚨 Here rather than in any module, because it is a property of the VIEWER
   * and a module that got only `{ memberId, role }` could not tell — the two
   * are identical in an impersonated session, which is the whole point of one.
   *
   * A module that shows something the operator must not read while inside
   * somebody's account answers `{}` on this. The community's private-message
   * surfaces are the shipped case: impersonation is defensible because it is
   * RECORDED, and the record says an operator was in an account, not what they
   * read — reading somebody's mail leaves no second trace, so the capability is
   * removed rather than logged.
   */
  readonly impersonating: boolean;
}

/** What a module wants the sidebar to show this viewer. */
export interface ModuleShellState {
  /** Feature keys its nav entries hide behind, resolved for this viewer. */
  readonly features?: Readonly<Record<string, boolean>>;
  /** Hrefs with something new waiting — the sidebar's unread dot. */
  readonly badges?: readonly string[];
}

export interface ModuleEntry {
  /** The folder name under `modules/`, and the id in `config/modules.json`. */
  readonly id: string;

  /**
   * What the sidebar should show this viewer — resolved on the SERVER, handed
   * to the client shell as booleans.
   *
   * ⚠️ **Runs on every protected page load, so it answers cheaply or not at
   * all.** A module that is switched off returns `{}` on its first line and
   * touches no database: a feature that ships off has to cost nothing, or
   * "off" is only a word. That is the property `app/dashboard/layout.tsx`
   * guards for the community today, and it is the one to preserve rather than
   * the shape of the code around it.
   *
   * ⚠️ And a feature switched ON that this installation cannot RUN is not the
   * same question as one switched off. The shipped answer differs per entry —
   * a diagnosis page keeps its entry for the operator, a page that refuses in
   * that state must lose it — so a module decides this per feature key rather
   * than returning one boolean for itself.
   */
  shellState?(viewer: ModuleViewer): Promise<ModuleShellState>;

  /**
   * What this module answers about one person in the member's own download.
   *
   * 🚨 The manifest refuses a module that declares `tables` without a complete
   * `privacy` block, so a module holding rows about a person cannot ship
   * without this. See `lib/modules/privacy.ts` for what neither half may do —
   * chiefly: consult whether the module is switched on.
   */
  privacy?: ModulePrivacy;

  /**
   * Erase what this module holds about one member, inside the account
   * deletion's own transaction.
   *
   * 🚨 Runs whether or not the module is switched ON. An app that ran a module
   * and later disabled it still holds every row written while it was on, and an
   * erasure request is about the DATA rather than about which features are
   * currently enabled — the ruling `lib/users/manage.ts` already applies to the
   * community and `lib/privacy/export.ts` applies from the other end.
   *
   * A cascade is not a substitute: a cascade removes rows keyed by the member,
   * and what needs scrubbing is what they WROTE where the row itself must
   * survive (a post other people replied to, a moderation act that records who
   * decided what).
   */
  eraseFor?(tx: ModuleEraseTx, memberId: string): Promise<void>;
}
