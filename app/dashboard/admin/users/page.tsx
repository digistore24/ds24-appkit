// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import { getTranslations } from "next-intl/server";

import { requireOwner } from "@/lib/authz";
import { listUsers } from "@/lib/users/manage";
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
// protected admin feature looks like — table, create dialog, confirmation
// before deleting, a short message after every action. You can extend it
// (search, invitations) or remove it entirely if your app does not need it.
export default async function AdminUsersPage() {
  const session = await requireOwner();
  const users = await listUsers();
  const t = await getTranslations("users");

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("description", {
          count: users.length,
          email: session.user.email ?? "",
        })}
      >
        <CreateUserDialog />
      </PageHeader>

      {/* The switch is read here, on the server: the config module imports JSON
          that has no business in a browser bundle. It only hides the menu entry
          — the server action refuses on its own, because a Server Action is an
          HTTP endpoint of its own and a hidden menu protects nobody. */}
      <UserTable
        users={users}
        currentUserId={session.user.id}
        impersonationEnabled={isImpersonationEnabled()}
      />

      <p className="text-muted-foreground mt-4 text-sm">
        {t.rich("hint", { code: (chunks) => <code>{chunks}</code> })}
      </p>
    </>
  );
}
