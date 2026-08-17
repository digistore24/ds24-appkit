// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import { getTranslations } from "next-intl/server";

import { requireOwner } from "@/lib/authz";
import { listUsersPage } from "@/lib/users/manage";
import {
  isFiltered,
  parseUserFilter,
  type RawSearchParams,
} from "@/lib/users/list-filter";
import { isImpersonationEnabled } from "@/lib/impersonation/config";
import { PageHeader } from "@/components/page-header";
import { UserTable, CreateUserDialog } from "./ui";

export async function generateMetadata() {
  const t = await getTranslations("users");
  return { title: t("title") };
}

// User management — admins only (requireOwner as the first line).
//
// This page is part of the scaffolding: it works right away and shows what a
// protected admin feature looks like — table, search, paging, create dialog,
// confirmation before deleting, a short message after every action. You can
// extend it (invitations) or remove it entirely if your app does not need it.
//
// ⚠️ **The filter travels in the URL, and that is the whole design.** It makes
// a narrowed list something an operator can bookmark and paste into a support
// ticket, it survives a reload, and it keeps this page a server component with
// no client state to get out of step with the rows. The purchases screen is
// built the same way, down to the parameter names.
export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const session = await requireOwner();
  const filter = parseUserFilter(await searchParams);
  const [{ rows, total, hasMore }, t] = await Promise.all([
    listUsersPage(filter),
    getTranslations("users"),
  ]);

  return (
    <>
      <PageHeader
        title={t("title")}
        description={
          // 🚨 The count is the number of MATCHES, and it says which of the two
          // it is. A filtered list whose heading still claimed the whole table
          // would be the same defect as a search that silently found nothing.
          isFiltered(filter)
            ? t("descriptionFiltered", { count: total })
            : t("description", { count: total, email: session.user.email ?? "" })
        }
      >
        <CreateUserDialog />
      </PageHeader>

      {/* The switch is read here, on the server: the config module imports JSON
          that has no business in a browser bundle. It only hides the menu entry
          — the server action refuses on its own, because a Server Action is an
          HTTP endpoint of its own and a hidden menu protects nobody. */}
      <UserTable
        users={rows}
        filter={filter}
        page={filter.page}
        hasMore={hasMore}
        total={total}
        currentUserId={session.user.id}
        impersonationEnabled={isImpersonationEnabled()}
      />

      <p className="text-muted-foreground mt-4 text-sm">
        {t.rich("hint", { code: (chunks) => <code>{chunks}</code> })}
      </p>
    </>
  );
}
