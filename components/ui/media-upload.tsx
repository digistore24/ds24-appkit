// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

"use client";

// The one place in this app where somebody picks a file.
//
// ── Why a component and not a field ────────────────────────────────────────
// A file input is four decisions wearing one tag: what the picker filters on,
// what happens to the field after a successful submit, what a too-large file
// gets told before anything is sent, and — since the direct-to-bucket path
// exists — whether the bytes travel in the form at all. There were two copies
// of the first three (a lesson's media slots, a member's profile picture) and
// they had already drifted: one refused an oversized file and named the number,
// the other did neither, and the class literal was the only thing byte-identical
// between them. A third surface would have been a third arrangement.
//
// ── Why it is text-free ────────────────────────────────────────────────────
// No file under `components/ui/` imports `next-intl`, and that is the house
// form rather than an accident: a core building block with message keys of its
// own forces every caller to look for its sentences in a second namespace, and
// a MODULE cannot write into the core's namespace at all except by the rules of
// `scripts/modules/messages.test.ts`. So every visible sentence arrives as a
// prop, and every formatted number arrives already formatted — `formatBytes()`
// is the CALLER's call, exactly as `<MediaDownload>` takes `size` as a string.
//
// ── Why it knows no number ─────────────────────────────────────────────────
// Because there are two ceilings and neither belongs here. `slotCeilingBytes()`
// is what a Server Action body carries (10 MB); `kinds[kind].maxBytes` is what
// the direct path takes (2 GB for a video). A component with a number of its own
// would be a third copy, and at least one of three copies is wrong.
//
// ── Why the reset lives in here ────────────────────────────────────────────
// A file input is UNCONTROLLED, and a `useActionState` re-render does not empty
// one. Without the reset, the next click on the same form uploads the same file
// again: a second object in the bucket and an hourly rate-limit slot spent on a
// file that is already attached. Both callers carried their own copy of that
// effect; now there is one, driven by `resetKey`.
import * as React from "react";

import { Callout } from "@/components/ui/callout";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * The `file:`-pseudo-element classes that make a file input look like the kit.
 *
 * One literal, because it was two identical ones. Kept out of the JSX so the
 * static test can assert the exact string rather than a fragment of it.
 */
export const MEDIA_UPLOAD_FILE_CLASSES =
  "file:text-foreground file:mr-3 file:border-0 file:bg-transparent file:text-sm";

/** What the caller's `mint()` answers: an address, or a sentence saying why not. */
export type MediaUploadMint =
  | { ok: true; ticketId: string; url: string }
  | { ok: false; message: React.ReactNode };

/** What the caller's `confirm()` answers: the handle the form carries, or a sentence. */
export type MediaUploadConfirm =
  | { ok: true; handle: string }
  | { ok: false; message: React.ReactNode };

/**
 * The direct-to-bucket path, as three things the CALLER owns.
 *
 * 🚨 **No URL, no route and no Server Action is named in this file, and that is
 * a security property rather than tidiness.** `POST /api/media/upload-url` pins
 * `visibility: "owner"`; a lesson video needs `entitled` plus the course's own
 * Product Key, which only a Server Action with `requireOwner()` in front of it
 * may decide. If this component knew an endpoint, a core building block would be
 * co-deciding who may see a row — and `CLAUDE.md` → *Media* says the sentence
 * this boundary protects: "a form may never choose `public` or `entitled`".
 * As a pair of callbacks it cannot choose anything.
 *
 * ⚠️ **It never cleans up.** A ticket nobody redeems leaves an object and a row,
 * and `prune-abandoned-uploads` (Story 8.1) removes both, daily and by row. A
 * browser that tried would be a browser deciding what to delete from a bucket.
 */
export interface MediaUploadDirect {
  /** Ask for a short-lived address to write to. */
  mint: (file: File) => Promise<MediaUploadMint>;
  /** Say the bytes landed, and get back the handle the form should carry. */
  confirm: (ticketId: string) => Promise<MediaUploadConfirm>;
  /** The name of the hidden field the handle lands in. */
  handleName: string;
  /** The sentence beside the bar. Built by the caller from the percentage. */
  progress: (percent: number) => React.ReactNode;
  /** Shown once the bytes are in and the form holds the handle. */
  ready: React.ReactNode;
  /** When the browser could not reach the bucket at all — no server said why. */
  transportFailed: React.ReactNode;
}

export interface MediaUploadProps {
  /** The field's own id; the label points at it. */
  id: string;
  /**
   * The form field name.
   *
   * ⚠️ Deliberately NOT rendered when `direct` is set: on that path the bytes
   * must not travel in the form at all — the hidden handle does. A named file
   * input there would post the whole file to a Server Action whose body limit
   * is the very thing the direct path exists to get past.
   */
  name: string;
  label: React.ReactNode;
  /** The media types the picker filters on. */
  mimeTypes: readonly string[];
  /**
   * Extra picker entries, by extension.
   *
   * The media types alone are not enough for a subtitle: many Windows machines
   * have no registry entry for `.vtt`, so a file picker filtering on `text/vtt`
   * shows the operator an empty folder. The extension makes it selectable —
   * **what the file IS is still decided from its bytes, on the server.**
   */
  extensions?: readonly string[];
  /** The limit that really applies to THIS door, in bytes. */
  ceilingBytes: number;
  /** The refusal sentence, built by the caller from the size that was picked. */
  tooLarge: (pickedBytes: number) => React.ReactNode;
  /** Its bold first line. Omitted gives a single-line callout, which is legal. */
  tooLargeTitle?: React.ReactNode;
  /** A permanent line under the field — never a message after a failed attempt. */
  hint?: React.ReactNode;
  disabled?: boolean;
  /**
   * A fresh object after every success — that is what empties the field.
   *
   * A prop rather than a look at the action's state, because a core building
   * block that knows the return shape of THIS app's Server Actions is one that
   * has to change whenever that shape does.
   *
   * 🚨 **`object | null` and not `unknown`, and the type is the whole guard.**
   * The effect below hangs on this value and React compares dependencies with
   * `Object.is`, so a signal that carries a VALUE only works once: both callers
   * passed `state.ok` — the same sentence after every successful upload — and
   * the field kept its file from the SECOND upload onwards, which is the exact
   * damage this component's header names as its reason to exist. A string
   * cannot be assigned here any more, so the mistake is a typecheck failure
   * rather than a behaviour nobody sees. Pass the state OBJECT
   * (`state.ok ? state : null`): `useActionState` returns a fresh one per call,
   * which is the same reason `hooks/use-action-toast.ts` compares identities.
   */
  resetKey?: object | null;
  /** Told whenever submitting would be pointless: too large, or still uploading. */
  onBlocked?: (blocked: boolean) => void;
  direct?: MediaUploadDirect;
  className?: string;
  /** Rendered in the same block under the field — a cover's alt-text field. */
  children?: React.ReactNode;
}

/**
 * Write the bytes straight to the bucket, reporting progress.
 *
 * ⚠️ **`XMLHttpRequest`, not `fetch`, and the reason is the progress bar.**
 * `fetch()` reports nothing about a request body going out — upload streaming
 * needs a `ReadableStream` body with `duplex: "half"`, which is one browser and
 * HTTP/2 only. A two-gigabyte upload with no percentage is a surface that looks
 * as though it has stopped, which is the thing this bar exists to prevent, so
 * the older API is the one that can keep the promise.
 *
 * The `content-type` header is sent but NOT signed — `lib/media/sigv4.mjs`
 * signs `host` alone — which is why the bucket's CORS rule lists it under
 * `AllowedHeaders` (`docs/visuals.md`). What the file really is gets decided
 * from its first bytes at confirm time either way.
 */
function putToBucket(
  url: string,
  file: File,
  onProgress: (percent: number) => void,
): Promise<boolean> {
  return new Promise((resolve) => {
    const request = new XMLHttpRequest();
    request.open("PUT", url);
    request.setRequestHeader("content-type", file.type || "application/octet-stream");
    request.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
      }
    };
    // 2xx and nothing else. A redirect is not a stored object — the confirm
    // step would then find nothing and the operator would read "that ticket is
    // not valid" instead of the sentence about the transport.
    request.onload = () => resolve(request.status >= 200 && request.status < 300);
    request.onerror = () => resolve(false);
    request.onabort = () => resolve(false);
    request.ontimeout = () => resolve(false);
    request.send(file);
  });
}

export function MediaUpload({
  id,
  name,
  label,
  mimeTypes,
  extensions,
  ceilingBytes,
  tooLarge,
  tooLargeTitle,
  hint,
  disabled,
  resetKey,
  onBlocked,
  direct,
  className,
  children,
}: MediaUploadProps) {
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [refused, setRefused] = React.useState<React.ReactNode>(null);
  const [failed, setFailed] = React.useState<React.ReactNode>(null);
  const [percent, setPercent] = React.useState<number | null>(null);
  const [handle, setHandle] = React.useState<string | null>(null);

  // See the file header: an uncontrolled input survives a re-render with its
  // file still in it, and the next submit would upload the same bytes again.
  //
  // ⚠️ **The handle is deliberately NOT cleared here.** On the direct path the
  // success signal and the reset signal are the same one — the caller's
  // `confirm()` sets its state before it hands the handle back — so a
  // `setHandle(null)` in this effect wiped the id it had just been given, one
  // commit later: the hidden field stayed `""` for ever and the "it is in"
  // callout flashed for a frame. The handle has its own end: `onChange` clears
  // it the moment another file is picked, which is the only moment at which it
  // stops describing what the form carries.
  React.useEffect(() => {
    if (!resetKey) return;
    if (fileRef.current) fileRef.current.value = "";
    setRefused(null);
    setFailed(null);
    setPercent(null);
    onBlocked?.(false);
    // `onBlocked` is deliberately not a dependency: callers pass an inline
    // closure, and depending on it would empty the field on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  const labelId = `${id}-label`;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const busy = percent !== null;

  /**
   * Hand the field back after a failed attempt on the direct path.
   *
   * 🚨 **The selection is EMPTIED, and that is the opposite of what it looks
   * like.** Choosing the same file again fires no `change` event in Chromium or
   * WebKit — the value did not alter — and the direct path has no upload button
   * on purpose (the confirm step fills the column itself), so `change` is the
   * only trigger there is. Keeping the selection would therefore mean "pick a
   * DIFFERENT file, or reload the page", after a transfer that may have run for
   * twenty minutes — while the caller's own sentence says "check your
   * connection and choose it again". Emptying the field is what makes that
   * sentence true. The ticket, if one was written, is the sweep's problem and
   * not the browser's (`prune-abandoned-uploads`).
   */
  function releaseAfterFailure(message: React.ReactNode) {
    if (fileRef.current) fileRef.current.value = "";
    setFailed(message);
    setPercent(null);
    setHandle(null);
    onBlocked?.(false);
  }

  async function travel(file: File) {
    if (!direct) return;
    setFailed(null);
    setPercent(0);
    onBlocked?.(true);

    const minted = await direct.mint(file);
    if (!minted.ok) {
      releaseAfterFailure(minted.message);
      return;
    }

    const delivered = await putToBucket(minted.url, file, setPercent);
    if (!delivered) {
      releaseAfterFailure(direct.transportFailed);
      return;
    }

    const confirmed = await direct.confirm(minted.ticketId);
    if (!confirmed.ok) {
      releaseAfterFailure(confirmed.message);
      return;
    }

    setHandle(confirmed.handle);
    setPercent(null);
    onBlocked?.(false);
  }

  function onChange(event: React.ChangeEvent<HTMLInputElement>) {
    const picked = event.target.files?.[0] ?? null;
    setFailed(null);
    setHandle(null);

    // ── The refusal, and it covers BOTH paths for DIFFERENT reasons ─────────
    //
    //  · Through the app: a Server Action body is capped in `next.config.ts`
    //    and Next refuses while it DECODES the payload — before the action
    //    exists — so an oversized file produces an unhandled rejection with no
    //    number in it and nothing anybody can translate. Refusing here is what
    //    turns that into a sentence.
    //
    //  · Straight to the bucket: a presigned `PUT` cannot enforce a size at all
    //    (`lib/media/sigv4.mjs` signs `host` and nothing else), so the app
    //    refuses AFTERWARDS, at the length `head()` reports, and removes the
    //    object. Refusing here spares somebody twenty minutes of uploading
    //    three gigabytes in order to read "too large".
    //
    // Neither replaces the server's check. A check in a browser is not a check.
    if (picked && picked.size > ceilingBytes) {
      setRefused(tooLarge(picked.size));
      setPercent(null);
      onBlocked?.(true);
      return;
    }

    setRefused(null);
    if (picked && direct) {
      void travel(picked);
      return;
    }
    onBlocked?.(false);
  }

  return (
    <div className={cn("grid gap-2", className)}>
      <Label id={labelId} htmlFor={id}>
        {label}
      </Label>

      <Input
        ref={fileRef}
        id={id}
        // See the prop's own comment: on the direct path the form carries an
        // id, never the bytes.
        name={direct ? undefined : name}
        type="file"
        disabled={disabled || busy}
        accept={[...mimeTypes, ...(extensions ?? [])].join(",")}
        className={MEDIA_UPLOAD_FILE_CLASSES}
        onChange={onChange}
        // The number and the refusal belong TO this field, not merely beside
        // it. Without the two attributes somebody arriving by keyboard hears
        // "Video, choose file" and nothing of the limit the sentence under the
        // field is explaining — and `components/ui/input.tsx` carries
        // `aria-invalid:border-destructive` for a state nothing ever set.
        aria-invalid={refused !== null || undefined}
        aria-describedby={
          [hint ? hintId : null, refused !== null ? errorId : null].filter(Boolean).join(" ") ||
          undefined
        }
      />

      {/* Always present while `direct` is set, empty until the bytes have
          landed — not conditional on the handle. A field that appears only on
          success would make "nothing was uploaded" and "the field is missing"
          the same thing on the server, and it is the shape the static test can
          see: `useEffect` and an async upload do not run under
          `renderToStaticMarkup`, but this does. */}
      {direct && (
        <input type="hidden" name={direct.handleName} value={handle ?? ""} readOnly />
      )}

      {children}

      {hint && (
        <p id={hintId} className="text-muted-foreground text-xs">
          {hint}
        </p>
      )}

      {direct && percent !== null && (
        // `role="presentation"` overrides `Callout`'s own `role="status"`, and
        // it has to: `onprogress` fires dozens to hundreds of times on a
        // two-gigabyte upload, and inside a live region every one of them is a
        // spoken "1 % uploaded — leave this window open", "2 % uploaded — …".
        // The `role="progressbar"` below carries the semantics properly, on a
        // node a screen reader polls rather than one that interrupts.
        <Callout variant="info" hideIcon role="presentation">
          <div className="flex flex-col gap-2">
            <span className="text-xs tabular-nums">{direct.progress(percent)}</span>
            {/* No `<progress>` in the kit, and its native colours come from the
                browser rather than from a token — so a bar built from two divs
                and the accent token, which is the one that follows both modes.
                Named by the field's own label, so the component stays text-free
                and a screen reader still gets a sentence. */}
            <div
              role="progressbar"
              aria-labelledby={labelId}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
              className="bg-muted h-1.5 w-full overflow-hidden rounded-full"
            >
              <div className="bg-primary h-full transition-all" style={{ width: `${percent}%` }} />
            </div>
          </div>
        </Callout>
      )}

      {direct && handle !== null && percent === null && (
        <Callout variant="success" hideIcon>
          {direct.ready}
        </Callout>
      )}

      {refused !== null && (
        // `role="alert"` — the one message on this surface that really stops
        // somebody. `Callout` sets `role="status"` for things that sit in the
        // page flow and says in its own header to override it from outside for
        // anything genuinely interrupting; a refusal that also disables the
        // submit button is that.
        <Callout id={errorId} variant="danger" title={tooLargeTitle} role="alert">
          {refused}
        </Callout>
      )}
      {failed !== null && (
        <Callout variant="danger" role="alert">
          {failed}
        </Callout>
      )}
    </div>
  );
}
