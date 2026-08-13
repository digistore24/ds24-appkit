// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

"use client";

// The follow button — on a member's profile, and inline in the lists.
//
// ⚠️ **It shows a STATE, never a count.** "Following" or "Follow", and nothing
// beside it: no follower number on a profile, no total on a list, no aggregate
// anywhere in the app. How many people follow somebody is a fact about those
// people, and a number is the cheapest way to start describing who is in a
// paid room (`db/schema-community.ts` carries the argument).
//
// ⚠️ **Nothing here decides anything.** The server re-derives every refusal on
// every submit — a hidden button is not a permission.

import * as React from "react";
import { useActionState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { UserMinus, UserPlus } from "lucide-react";

import { useActionToast } from "@/hooks/use-action-toast";
import { Button } from "@/components/ui/button";

import type { ActionState } from "../actions";
import { setFollowAction } from "./actions";
import { EMPTY_ACTION_STATE } from "@/lib/action-state";


export function FollowButton({
  memberId,
  following,
  size = "default",
}: {
  memberId: string;
  /** Does the VIEWER follow them? There is no reader for the other direction's state. */
  following: boolean;
  size?: "default" | "sm";
}) {
  const t = useTranslations("community");
  const [state, action] = useActionState(setFollowAction, EMPTY_ACTION_STATE);
  const [pending, startAction] = useTransition();

  useActionToast(state);

  const submit = () => {
    const formData = new FormData();
    formData.set("memberId", memberId);
    formData.set("following", String(!following));
    startAction(() => action(formData));
  };

  return (
    // No confirmation dialog in either direction, deliberately: following is
    // not destructive, and unfollowing takes nothing away from anybody —
    // asking would make a one-tap decision feel like a commitment. The
    // destructive-confirmation rule is for deletions.
    <Button
      variant={following ? "outline" : "default"}
      size={size}
      disabled={pending}
      onClick={submit}
    >
      {following ? <UserMinus aria-hidden /> : <UserPlus aria-hidden />}
      {following ? t("unfollow") : t("follow")}
    </Button>
  );
}
