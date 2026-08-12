// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { isRole, type Role } from "@/lib/roles";

// Shows a role as a badge — "Admin", "Moderator" or "User", translated.
//
// The display names live in `messages/*.json` under `roles`; the technical
// names ("owner"/"moderator"/"member") stay in the code. Whoever adds a role
// enters it in lib/roles.ts AND in both message files.
//
// One variant per role, so the three read differently at a glance: the owner
// filled (`default`), the moderator outlined (`outline`) — visibly marked,
// visibly NOT the operator — and the member muted (`secondary`).
//
// `Record<Role, …>` rather than `Record<string, …>`, and that is the whole
// point of the type: a fourth role added to `lib/roles.ts` must fail to
// compile HERE. With a string key it compiled and quietly rendered the new role
// with the member's muted variant — losing exactly the "visibly marked,
// visibly NOT the operator" distinction this map exists to carry. The sibling
// map `ROLE_ICONS` in the admin page was already written this way; this one
// was not, and it is the one carrying the signal.
const VARIANTS: Record<Role, "default" | "outline" | "secondary"> = {
  owner: "default",
  moderator: "outline",
  member: "secondary",
};

export function RoleBadge({ role }: { role?: string | null }) {
  const t = useTranslations("roles");
  if (!role) return null;

  // Unknown role: better to show the raw value than an empty space — that way
  // what is actually in the database stays visible. `users.role` is `text`
  // with no enum, so this is reachable with nothing worse than a hand-written
  // row.
  if (!isRole(role)) return <Badge variant="secondary">{role}</Badge>;

  return <Badge variant={VARIANTS[role]}>{t(role)}</Badge>;
}
