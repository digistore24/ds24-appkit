// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

"use client";

// The community's client pieces: starting a thread, writing a reply, and the
// author's own menu on a post.
//
// ⚠️ **Nothing here decides anything.** Every gate this file appears to apply
// — the composer disabled while a member has no display name, the author menu
// shown only on one's own post — is cosmetics on top of a refusal the server
// makes again on every submit. A hidden button is not a permission.
//
// ⚠️ **A post is never rendered here.** `components/community/post-body.tsx`
// is the one renderer of member-written text, and a structural test keeps it
// that way (`lib/community/render-safety.test.ts`).

import * as React from "react";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useLocale, useTranslations, useFormatter } from "next-intl";
import { ImagePlus, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";

import {
  COMMUNITY_PROFILE_HREF,
  MAX_DISCUSSION_TITLE_LENGTH,
  MAX_IMAGE_ALT_LENGTH,
  MAX_POST_LENGTH,
  contentState,
  displayNameFor,
  postVisibleTo,
  type PostImage,
  type PostImagePolicy,
  POST_IMAGE_MIME_TYPES,
} from "@/modules/community/lib/rules";
import { formatBytes } from "@/lib/media/rules";
import { cn } from "@/lib/utils";
import { useActionToast } from "@/hooks/use-action-toast";
import { Figure } from "@/components/ui/figure";
import { MediaUpload } from "@/components/ui/media-upload";
import { PostBody } from "@/modules/community/components/post-body";
import { ReportButton } from "@/modules/community/components/report-button";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { RemovePostButton } from "./moderation/ui";
import {
  addPostAction,
  deletePostAction,
  editPostAction,
  startDiscussionAction,
  type ActionState,
} from "./actions";
import { EMPTY_ACTION_STATE } from "@/lib/action-state";

// The community's state is WIDER than the core's — `startDiscussion` hands
// back the new `postId` so the page can scroll to it. The value is still the
// shared one; only the type it is read at is the module's own.
const EMPTY: ActionState = EMPTY_ACTION_STATE;


/**
 * Submit without handing the form to React.
 *
 * The same reasoning as `app/dashboard/admin/community/ui.tsx`, and it matters
 * more here: React resets a `<form action={…}>` once the action returns,
 * refusal included — so a member whose thousand-word post was refused for
 * being a thousand and one would watch it disappear. Dispatching from
 * `onSubmit` inside a transition keeps the form the browser's, and what the
 * member wrote stays on screen.
 */
function useFormSubmit(action: (formData: FormData) => void) {
  const [pending, start] = useTransition();
  return {
    pending,
    onSubmit(event: React.FormEvent<HTMLFormElement>) {
      event.preventDefault();
      const formData = new FormData(event.currentTarget);
      start(() => action(formData));
    },
  };
}

/**
 * The picture fields under a composer — one field per picture, each with its own
 * description.
 *
 * ⚠️ **This is why `<MediaUpload multiple>` was not built**, and the reason is
 * the alternative text rather than the file input. Every picture needs its OWN
 * sentence saying what it shows (`Figure` takes `alt` or `decorative`, and
 * "decorative" is a claim about the picture nobody here can make), so a single
 * `multiple` input would have needed a description field per selected file
 * anyway — which means knowing what was selected, which is state the shared
 * component deliberately does not publish. N fields, each `name="images"`, gives
 * the browser's own repeated-field semantics: `formData.getAll("images")` in DOM
 * order beside `getAll("imageAlt")` in the same order. Plain HTML, and
 * `components/ui/media-upload.test.ts` keeps its "exactly one raw file input in
 * this app" claim untouched — this renders the shared component N times rather
 * than a second door.
 *
 * The slots appear one at a time, up to `policy.max`: four empty file pickers
 * under a reply box is a form that looks like paperwork.
 *
 * 🚨 **`policy.max === 0` renders nothing**, which is the operator's "this
 * community is text". The server refuses a picture in that state as well — a
 * missing form control is never the guard.
 */
function PostImageFields({
  policy,
  resetKey,
  onBlocked,
}: {
  policy: PostImagePolicy;
  /** A fresh object after every success — empties the fields. */
  resetKey: object | null;
  /** True while any of the fields holds something submitting would refuse. */
  onBlocked: (blocked: boolean) => void;
}) {
  const t = useTranslations("community");
  const locale = useLocale();
  const [slots, setSlots] = useState(1);
  // One flag per slot, in a REF rather than in state — nothing here renders it.
  // The submit button is disabled from the PARENT's state, which `onBlocked`
  // drives, so keeping a copy in state would be a second re-render per keystroke
  // of the file picker for a value this component never reads back.
  //
  // An array and not a boolean: the aggregate has to be "is ANY slot blocked",
  // so a slot that goes back to fine must not leave the button disabled — which
  // one shared boolean would do the moment there are two pictures.
  const blocked = React.useRef<boolean[]>([]);

  // A successful post empties the fields — and takes the extra slots away with
  // them, so the next reply starts as small as the first one did.
  useEffect(() => {
    if (!resetKey) return;
    setSlots(1);
    blocked.current = [];
  }, [resetKey]);

  if (policy.max <= 0) return null;

  const report = (index: number, value: boolean) => {
    blocked.current[index] = value;
    onBlocked(blocked.current.some(Boolean));
  };

  return (
    <div className="grid gap-3">
      {Array.from({ length: Math.min(slots, policy.max) }, (_, index) => (
        <MediaUpload
          key={index}
          id={`post-image-${index}`}
          // The SAME name on every field. That is what makes them a list on the
          // server, and it is why the alt field below shares its name too: the
          // two arrive as parallel arrays in the order they are rendered.
          name="images"
          label={t("postImageLabel", { number: index + 1 })}
          mimeTypes={POST_IMAGE_MIME_TYPES}
          ceilingBytes={policy.ceilingBytes}
          tooLargeTitle={t("postImageTooLargeTitle")}
          tooLarge={(picked) =>
            t("postImageTooLarge", {
              size: formatBytes(picked, locale),
              max: policy.maxLabel,
            })
          }
          hint={t("postImageHint", { max: policy.maxLabel })}
          resetKey={resetKey}
          onBlocked={(value) => report(index, value)}
        >
          {/* The description, in the field's own block — `MediaUpload`'s
              `children` slot exists for exactly this (its own comment names a
              cover's alt-text field). NOT `required`: an empty slot must stay
              submittable, because somebody may add one and change their mind,
              and a browser cannot tell "no picture here" from "no description
              yet". The server pairs them by index, drops the empty ones and
              refuses a picture without a description with a sentence
              (`communityImageAltInvalid`). */}
          <Label htmlFor={`post-image-alt-${index}`} className="mt-1 text-xs font-normal">
            {t("postImageAltLabel")}
          </Label>
          <Input
            id={`post-image-alt-${index}`}
            name="imageAlt"
            maxLength={MAX_IMAGE_ALT_LENGTH}
            placeholder={t("postImageAltPlaceholder")}
          />
        </MediaUpload>
      ))}

      {slots < policy.max && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="justify-self-start"
          onClick={() => setSlots((current) => current + 1)}
        >
          <ImagePlus aria-hidden />
          {t("postImageAdd")}
        </Button>
      )}
    </div>
  );
}

/** The one sentence a member who has not named themselves needs. */
function NameFirst() {
  const t = useTranslations("community");
  return (
    <Callout variant="info" title={t("nameFirstTitle")}>
      <p>
        {t("nameFirstBody")}{" "}
        <Link
          href={COMMUNITY_PROFILE_HREF}
          className="underline underline-offset-2"
        >
          {t("nameFirstLink")}
        </Link>
      </p>
    </Callout>
  );
}

export function StartDiscussionDialog({
  groupId,
  canParticipate,
  imagePolicy,
}: {
  groupId: string;
  canParticipate: boolean;
  /** What the picture fields may offer — see `PostImageFields`. */
  imagePolicy: PostImagePolicy;
}) {
  const t = useTranslations("community");
  const tCommon = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [state, action] = useActionState(startDiscussionAction, EMPTY);
  const { onSubmit, pending } = useFormSubmit(action);

  // Only errors reach a toast here: success navigates to the new thread, which
  // is feedback enough and arrives on the page they land on.
  useActionToast(state);

  if (!canParticipate) return <NameFirst />;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus aria-hidden />
          {t("startDiscussion")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={onSubmit} key={open ? "open" : "closed"}>
          <input type="hidden" name="groupId" value={groupId} />
          <DialogHeader>
            <DialogTitle>{t("startDiscussionTitle")}</DialogTitle>
            <DialogDescription>
              {t("startDiscussionDescription")}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="title">{t("fieldTitle")}</Label>
              <Input
                id="title"
                name="title"
                required
                maxLength={MAX_DISCUSSION_TITLE_LENGTH}
                placeholder={t("fieldTitlePlaceholder")}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="content">{t("fieldFirstPost")}</Label>
              <Textarea
                id="content"
                name="content"
                required
                rows={5}
                maxLength={MAX_POST_LENGTH}
                placeholder={t("fieldFirstPostPlaceholder")}
              />
            </div>
            {/* A thread's first post is a post, so it takes pictures on the same
                terms as a reply. The `key` on the form already remounts this
                whole block when the dialog opens, which is what empties the
                fields — hence no `resetKey` of its own. */}
            <PostImageFields policy={imagePolicy} resetKey={null} onBlocked={setBlocked} />
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {tCommon("cancel")}
              </Button>
            </DialogClose>
            <Button type="submit" disabled={pending || blocked}>
              {t("startDiscussionSubmit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The one composer, in both homes.
 *
 * ⚠️ **Exactly one of `discussionId` and `subjectKey` is given**, and that is
 * the only difference between a room's thread and an embedded discussion: the
 * first names a row, the second names a declaration. The action decides from
 * the field that arrived, re-derives access either way, and never takes an
 * access level from this form (`lib/community/embeds.ts` rule 1).
 *
 * That "exactly one" is a **discriminated union, not a runtime check**, and the
 * difference matters here. This file is `"use client"`, so a `throw` in this
 * body runs while the HOST page renders — a lesson page would lose its content
 * because of the discussion hanging under it, which is the very thing
 * `EmbeddedDiscussion` refuses to do for the redirect case. The union makes the
 * same mistake a `tsc` error instead, at no runtime cost, the way the embed
 * registry makes a bad plan key a failing test rather than a broken lesson: for
 * a contract between two files in one repo, the build IS write time.
 */
export function PostComposer({
  discussionId,
  subjectKey,
  canParticipate,
  locked,
  imagePolicy,
  onSending,
  onSent,
}: ({ discussionId: string; subjectKey?: never } | { subjectKey: string; discussionId?: never }) & {
  canParticipate: boolean;
  locked: boolean;
  /** What the picture fields may offer — see `PostImageFields`. */
  imagePolicy: PostImagePolicy;
  /**
   * The member pressed send — called with what they wrote, BEFORE the server
   * has answered. `LiveDiscussion` uses it to show the post immediately
   * (NFR-37); a caller that does not care may leave it out.
   */
  onSending?: (content: string) => void;
  /**
   * The server answered: the new post's id, or `null` when it refused. The
   * pair is what makes an optimistic post safe — the id lets the poll that
   * delivers the same post upsert it instead of showing it twice, and `null`
   * takes the placeholder back.
   */
  onSent?: (postId: string | null) => void;
}) {
  const t = useTranslations("community");
  const [content, setContent] = useState("");
  // True while a picked picture is over the ceiling: submitting would spend a
  // posting allowance on a refusal.
  const [blocked, setBlocked] = useState(false);
  const [state, action] = useActionState(addPostAction, EMPTY);
  const { onSubmit: dispatch, pending } = useFormSubmit(action);

  // Whether the state below belongs to a submit of ours. `useActionState`
  // hands back its initial value at mount, and reporting THAT as a result
  // would take back an optimistic post nobody had sent.
  const awaiting = useRef(false);

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    awaiting.current = true;
    onSending?.(new FormData(event.currentTarget).get("content") as string);
    dispatch(event);
  };

  useActionToast(state);
  // Cleared only when the post actually landed. A refusal leaves it — the
  // whole reason this form is not `<form action={…}>`, and the half of NFR-37
  // that matters most: a thousand-word post refused for being a thousand and
  // one must not vanish.
  useEffect(() => {
    if (state.ok) setContent("");
  }, [state]);

  useEffect(() => {
    if (!awaiting.current) return;
    if (!state.ok && !state.error) return;
    awaiting.current = false;
    onSent?.(state.ok ? (state.postId ?? null) : null);
  }, [state, onSent]);

  // ⚠️ **A lock that arrives while somebody is typing keeps their text.** This
  // used to `return` the callout instead of the form, which unmounts the
  // `<Textarea>` and takes whatever they had written with it — a member four
  // paragraphs into a reply lost all four the moment a moderator locked the
  // thread, because the live channel flips this prop mid-view. That is the
  // anti-pattern FR-197 names, and `live-discussion.tsx` already refuses it for
  // the `stopped` path; the lock path was the half that had been missed.
  // The notice goes ABOVE the form and the controls go disabled instead, so the
  // words stay on screen and stay copyable.
  if (!canParticipate) return <NameFirst />;

  return (
    <form onSubmit={onSubmit} className="grid gap-2">
      {locked && (
        <Callout variant="info" title={t("lockedTitle")}>
          <p>{t("lockedBody")}</p>
        </Callout>
      )}
      {subjectKey ? (
        <input type="hidden" name="subjectKey" value={subjectKey} />
      ) : (
        <input type="hidden" name="discussionId" value={discussionId} />
      )}
      <Label htmlFor="reply">{t("replyLabel")}</Label>
      <Textarea
        id="reply"
        name="content"
        required
        rows={4}
        maxLength={MAX_POST_LENGTH}
        value={content}
        onChange={(event) => setContent(event.target.value)}
        placeholder={t("replyPlaceholder")}
        readOnly={locked}
      />

      {/* ⚠️ **Not hidden while the thread is locked**, for the same reason the
          textarea is not: unmounting these fields would throw away a picture
          somebody had already picked, and the lock arrives mid-view from the live
          channel. The submit button goes disabled instead, which keeps the
          selection and keeps the words. `resetKey` is the action's own state
          object — a fresh one per call, so the identity is the signal
          (`media-upload.tsx` says why a value would only work once). */}
      <PostImageFields
        policy={imagePolicy}
        resetKey={state.ok ? state : null}
        onBlocked={setBlocked}
      />

      <div className="flex justify-end">
        {/* `disabled` while pending is the only thing between a double click
            and two identical posts — there is no idempotency key here, and a
            post is not a thing to de-duplicate afterwards. */}
        <Button type="submit" disabled={pending || locked || blocked}>
          {t("replySubmit")}
        </Button>
      </div>
    </form>
  );
}

export interface PostView {
  id: string;
  authorId: string | null;
  content: string;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
  deletedBy: "author" | "moderator" | "system" | null;
  /**
   * The automatic lock, as an ISO string.
   *
   * ⚠️ **It travels, where `removedReason` deliberately does not**, and the
   * difference is what the field IS. A removal reason is prose a moderator
   * wrote about a member; this is a bare timestamp saying the post is off the
   * page, which is a fact every reader of the thread can already see from the
   * tombstone. Without it the browser cannot tell `autoHidden` from `visible`
   * and would render the words the server just took away.
   */
  hiddenAt: string | null;
  authorProfileName: string | null;
  authorAccountName: string | null;
  /**
   * The pictures the author attached — already-minted addresses, never ids.
   *
   * The server's `PostImage` (`lib/manage.ts`) unchanged: it is JSON-safe by
   * construction, so `wirePost()` passes it through and this is the same shape.
   * Empty for a post that is not visible, and empty on the optimistic copy of
   * one's own send until the poll delivers the real row.
   */
  images: PostImage[];
}

/**
 * The pictures on one post — **beside the words, never inside them.**
 *
 * 🚨 **This is the line `docs/community.md:570` and `render-safety.test.ts` are
 * about, and it is satisfied rather than relaxed.**
 * `modules/community/components/post-body.tsx` stays the one renderer of
 * member-written TEXT and still renders plain text, line breaks and
 * scheme-whitelisted links and nothing else: no HTML, no markdown, no image
 * syntax, no `dangerouslySetInnerHTML`. A picture here is a rendered ELEMENT
 * that the server put on the page after asking `mayAccess()` — it is not a URL a
 * member typed and it is not something this app fetches on their behalf, which
 * is the SSRF-plus-tracking-pixel rule that doc states. Nothing about that rule
 * changes, and nothing in `post-body.tsx` had to.
 *
 * `Figure` supplies the rest: the compile-time "say what it shows or say it shows
 * nothing", the `<img srcset>` for bucket media, the plate that survives dark
 * mode. `alt` is what the member wrote; the `decorative` branch exists for a row
 * that predates the description being required, and is the courses unit page's
 * shape rather than a second opinion.
 */
function PostImages({ images }: { images: PostImage[] }) {
  if (images.length === 0) return null;
  return (
    <ul className="mt-3 grid gap-2 sm:grid-cols-2">
      {images.map((image) => (
        <li key={image.mediaId}>
          {image.alt ? (
            <Figure
              src={image.src}
              srcSet={image.srcSet}
              alt={image.alt}
              // Nominal where the picture was stored before its size was
              // measured — `Figure` needs two numbers to reserve the space, and
              // the class below is what decides what the reader actually sees.
              width={image.width ?? 1280}
              height={image.height ?? 720}
              // `sizes`, because a post sits in a column and the pictures sit two
              // to a row inside it: without this a browser assumes `100vw` and
              // fetches a candidate two steps too wide, which is the whole thing
              // the variants exist to avoid.
              sizes="(min-width: 640px) 20rem, 90vw"
              unoptimized
              className="max-h-80 w-full object-cover"
            />
          ) : (
            <Figure
              src={image.src}
              srcSet={image.srcSet}
              decorative
              width={image.width ?? 1280}
              height={image.height ?? 720}
              sizes="(min-width: 640px) 20rem, 90vw"
              unoptimized
              className="max-h-80 w-full object-cover"
            />
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * One thread's posts.
 *
 * ⚠️ **What a deleted post renders is decided by `contentState()` and nothing
 * else** — no renderer reads `deletedAt` or `deletedBy` itself, so the three
 * deletions cannot start reading differently per surface. The words of a
 * hidden post never reach this component: `postsFor()` blanks them server-side
 * (`content: ""`), so there is nothing here to leak into a tooltip, a title
 * attribute or the page's own payload.
 */
export function PostList({
  posts,
  discussionId,
  memberId,
  canModerate = false,
  onChanged,
  empty,
}: {
  posts: PostView[];
  discussionId: string;
  memberId: string;
  /**
   * May the viewer moderate THIS room? Cosmetics — the server re-reads the
   * authority from the database on every act (AD-63), so a rendered button is
   * not a permission and a missing one is not a guard.
   */
  canModerate?: boolean;
  /**
   * What to draw when there is nothing in the list.
   *
   * ⚠️ **The list owns this, and it owns it because it is the only thing that
   * knows.** A server render cannot: an embedded discussion starts empty and
   * fills itself from the live channel, so an empty state drawn upstream either
   * never appears (it was gated on the view not breathing, which a default
   * embed never satisfies) or never leaves (it sits under the first arriving
   * post). Both had shipped. The words come from the host, so they stay in the
   * host page's language and its subject.
   */
  empty?: React.ReactNode;
  /**
   * An edit or a deletion of this member's own post succeeded.
   *
   * `LiveDiscussion` wires this to an immediate poll, so the member sees their
   * own change at once rather than at the next interval. It is the same path
   * everything else arrives on — a deletion rides the answer as row-state
   * (AD-70), so there is nothing here to apply by hand.
   */
  onChanged?: () => void;
}) {
  const t = useTranslations("community");
  const tCommon = useTranslations("common");
  const format = useFormatter();

  const [editId, setEditId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const [editState, editAction] = useActionState(editPostAction, EMPTY);
  const [deleteState, deleteAction] = useActionState(deletePostAction, EMPTY);
  const { onSubmit: onEditSubmit, pending: editing } =
    useFormSubmit(editAction);
  const [, startAction] = useTransition();

  useActionToast(editState);
  useActionToast(deleteState);

  useEffect(() => {
    if (!editState.ok) return;
    setEditId(null);
    onChanged?.();
  }, [editState, onChanged]);
  useEffect(() => {
    if (!deleteState.ok) return;
    setDeleteId(null);
    onChanged?.();
  }, [deleteState, onChanged]);

  const placeholderLabel = t("memberPlaceholder");
  const toEdit = posts.find((post) => post.id === editId) ?? null;
  const toDelete = posts.find((post) => post.id === deleteId) ?? null;

  // The empty state is drawn here rather than upstream because this is the one
  // place that knows the list AFTER the live channel has run — see the `empty`
  // prop. A host that hands in nothing gets nothing, which is right for a room
  // thread: a discussion is created with its first post, so it cannot be empty.
  if (posts.length === 0) return <>{empty ?? null}</>;

  return (
    <>
      <ol className="grid gap-4">
        {posts.map((post) => {
          const state = contentState({
            deletedAt: post.deletedAt ? new Date(post.deletedAt) : null,
            deletedBy: post.deletedBy,
            hiddenAt: post.hiddenAt ? new Date(post.hiddenAt) : null,
          });
          // 🚨 **A locked post is not there for anybody but its author.** The
          // server already withheld its words; this drops the row entirely, so
          // no stub sits in the thread announcing that something was taken
          // down. The cost is named where the rule is
          // (`postVisibleTo()`): replies below it read as answers to nothing.
          const shown = postVisibleTo(state, post.authorId, memberId);
          if (shown === "omit") return null;

          const mine =
            post.authorId === memberId &&
            (state === "visible" || state === "autoHidden");
          // A moderator's control appears on somebody ELSE's visible post.
          // Their own goes through the author menu, which already has delete —
          // a moderator removing their own post with a reason would put a
          // strange row in the trail.
          const moderatable = canModerate && !mine && state === "visible";

          return (
            <li key={post.id} className="bg-card rounded-xl border p-4">
              <div className="mb-2 flex items-start justify-between gap-2">
                <div className="text-muted-foreground flex flex-wrap items-baseline gap-x-2 text-sm">
                  {/* A tombstoned post has no author to name — the row's author
                      link is gone, deliberately, and inventing a name for it
                      would be worse than the honest blank. Everybody else's
                      name is a LINK to their community profile: that page is
                      what a member has when they want to know who they are
                      talking to, and a post is the only place they meet a
                      name. It shows nothing from billing and never the
                      address (`memberWithProfile()` does not select it). */}
                  {state === "accountDeleted" || !post.authorId ? (
                    <span className="text-foreground font-medium">
                      {t("formerMember")}
                    </span>
                  ) : (
                    <Link
                      href={`/dashboard/community/members/${encodeURIComponent(post.authorId)}`}
                      className="text-foreground font-medium hover:underline"
                    >
                      {displayNameFor({
                        profileName: post.authorProfileName,
                        accountName: post.authorAccountName,
                        memberId: post.authorId,
                        placeholderLabel,
                      })}
                    </Link>
                  )}
                  <time dateTime={post.createdAt}>
                    {format.dateTime(new Date(post.createdAt), {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </time>
                  {post.editedAt && state === "visible" && (
                    // Disclosed on purpose: a reply that answers a sentence
                    // which has since changed reads as a non-sequitur.
                    <span>· {t("edited")}</span>
                  )}
                </div>

                {/* Reportable by anybody who can read it, except its author —
                    the core refuses one's own content with its own sentence,
                    and hiding the control for it saves the round trip. */}
                {state === "visible" && !mine && (
                  <ReportButton postId={post.id} />
                )}

                {moderatable && <RemovePostButton postId={post.id} />}

                {mine && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={tCommon("actions")}
                      >
                        <MoreHorizontal aria-hidden />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => setEditId(post.id)}>
                        <Pencil aria-hidden />
                        {t("editPost")}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        variant="destructive"
                        onSelect={() => setDeleteId(post.id)}
                      >
                        <Trash2 aria-hidden />
                        {t("deletePost")}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>

              {shown === "words" ? (
                <>
                  {/* The author, and only the author, is told their own post is
                      being looked at. Not "you were reported N times": a count
                      is the queue's business, and a number here would be a
                      running score of how close somebody is to being silenced. */}
                  {state === "autoHidden" && (
                    <Callout variant="warning" className="mb-3">
                      {t("state_autoHiddenMine")}
                    </Callout>
                  )}
                  <PostBody content={post.content} />
                  <PostImages images={post.images} />
                </>
              ) : (
                <p className={cn("text-muted-foreground text-sm italic")}>
                  {/* Three states, three sentences. "The author deleted this"
                      and "a moderator removed this" are not the same thing to
                      whoever is reading the thread. */}
                  {t(`state_${state}`)}
                </p>
              )}
            </li>
          );
        })}
      </ol>

      <Dialog
        open={toEdit !== null}
        onOpenChange={(next) => !next && setEditId(null)}
      >
        <DialogContent>
          {toEdit && (
            <form onSubmit={onEditSubmit} key={toEdit.id}>
              <input type="hidden" name="postId" value={toEdit.id} />
              <input type="hidden" name="discussionId" value={discussionId} />
              <DialogHeader>
                <DialogTitle>{t("editPost")}</DialogTitle>
                <DialogDescription>
                  {t("editPostDescription")}
                </DialogDescription>
              </DialogHeader>
              <div className="py-4">
                <Textarea
                  name="content"
                  required
                  rows={6}
                  maxLength={MAX_POST_LENGTH}
                  defaultValue={toEdit.content}
                />
              </div>
              <DialogFooter>
                <DialogClose asChild>
                  <Button type="button" variant="outline">
                    {tCommon("cancel")}
                  </Button>
                </DialogClose>
                <Button type="submit" disabled={editing}>
                  {t("editPostSubmit")}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={toDelete !== null}
        onOpenChange={(next) => !next && setDeleteId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deletePostTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("deletePostConfirm")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (!toDelete) return;
                const formData = new FormData();
                formData.set("postId", toDelete.id);
                formData.set("discussionId", discussionId);
                startAction(() => deleteAction(formData));
              }}
            >
              {t("deletePost")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
