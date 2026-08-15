// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The two facts, and the four ways a probe can lie about them.
//
// Pure: the store and the queries arrive as `OpsProbes`, so every branch below
// is reached by handing this file a world rather than by stubbing a module.
// That matters more than usual here — most of these branches ARE somebody's
// production app on a bad morning, and a test that can only reach them through
// a mocked import stops reaching them the day an import moves.
//
// 🚨 **The needle every case shares: a probe that throws must never produce
// `ok`.** It is the single failure this file exists to prevent, so it is
// asserted per component AND once over the whole evaluator, in both directions —
// a version that returned `unchecked` for everything would pass the first half
// and fail the second.

import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  IPN_ACTIVE_DAYS,
  IPN_SILENCE_DAYS,
  defaultProbes,
  operationalState,
  type OpsProbes,
} from "./health";
import { IPN_LOG_RETENTION_DAYS } from "@/lib/digistore/ipn-log";

const NOW = new Date("2026-08-10T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY_MS);

/** A healthy app: an S3 store that answers, one product, one recent sale, one IPN. */
function healthy(overrides: Partial<OpsProbes> = {}): OpsProbes {
  return {
    mediaProblems: () => [],
    mediaDriver: () => "s3",
    mediaEnabled: () => true,
    headObject: async () => null,
    localStoreWritable: async () => {},
    sellingProducts: () => 1,
    recentOrderCount: async () => 3,
    latestIpnAt: async () => daysAgo(1),
    ...overrides,
  };
}

// Eleven of the sixteen tests below hand a probe something that throws — that is
// what `operationalState()` is FOR, and each one logs on its way to a state. The
// log is the behaviour under test, not an accident, so it is silenced here for
// the whole file: an UNEXPECTED error then stands out instead of drowning in it.
beforeEach(() => {
  const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
  onTestFinished(() => quiet.mockRestore());
});

describe("operationalState — the media probe", () => {
  it("is ok when the store answers, and reports the driver and a duration", async () => {
    const state = await operationalState({ now: NOW }, healthy());
    expect(state.media).toMatchObject({ state: "ok", driver: "s3", code: "answered" });
    expect(typeof state.media.ms).toBe("number");
    expect(state.checkedAt).toBe(NOW.toISOString());
  });

  it("does not ask the store at all when the configuration is broken", async () => {
    const headObject = vi.fn(async () => null);
    const state = await operationalState(
      { now: NOW },
      healthy({ mediaProblems: () => ["MEDIA_S3_ENDPOINT carries a path"], headObject }),
    );
    expect(state.media).toMatchObject({ state: "finding", code: "misconfigured" });
    // The point of asking the configuration first: this answer costs nothing
    // and says something a round trip could not.
    expect(headObject).not.toHaveBeenCalled();
  });

  it("treats an unknown MEDIA_DRIVER as misconfigured rather than throwing", async () => {
    const state = await operationalState(
      { now: NOW },
      healthy({
        mediaDriver: () => {
          throw new Error('MEDIA_DRIVER="sftp" is not a driver');
        },
      }),
    );
    expect(state.media).toMatchObject({ state: "finding", code: "misconfigured" });
  });

  it("🚨 a store that throws is a finding — never ok", async () => {
    const state = await operationalState(
      { now: NOW },
      healthy({
        headObject: async () => {
          throw new Error("getaddrinfo ENOTFOUND fra1.example.com");
        },
      }),
    );
    expect(state.media.state).toBe("finding");
    expect(state.media.code).toBe("unreachable");
  });

  it("tells a timeout apart from a refusal", async () => {
    // Two different fixes: one is a firewall, the other is a wrong endpoint.
    const timeout = Object.assign(new Error("The operation was aborted"), {
      name: "TimeoutError",
    });
    const state = await operationalState(
      { now: NOW },
      healthy({
        headObject: async () => {
          throw timeout;
        },
      }),
    );
    expect(state.media.code).toBe("timedOut");
  });

  it("🚨 probes the DIRECTORY on the local driver, never head()", async () => {
    // `lib/media/local.ts`'s head() returns null on ANY error, so it cannot tell
    // "not there" from "the disk is gone" — the one distinction this exists for.
    const headObject = vi.fn(async () => null);
    const ok = await operationalState({ now: NOW }, healthy({ mediaDriver: () => "local", headObject }));
    expect(ok.media).toMatchObject({ state: "ok", driver: "local", code: "answered" });
    expect(headObject).not.toHaveBeenCalled();

    const gone = await operationalState(
      { now: NOW },
      healthy({
        mediaDriver: () => "local",
        localStoreWritable: async () => {
          throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
        },
      }),
    );
    expect(gone.media).toMatchObject({ state: "finding", code: "localDirUnwritable" });
  });

  it("🚨 media switched OFF is ok, and nothing is asked — not a finding to mail about", async () => {
    // `lib/env-guard.ts` deliberately lets `MEDIA_DRIVER=local` START in PROD
    // while media are off. Without this branch such an app answered
    // `localDirUnwritable`, `collectFindings()` raised it to HIGH and
    // `ops-watchdog` MAILED — about a subsystem the operator switched off.
    // Same shape as the IPN probe's `noProducts`, and for the same reason.
    const headObject = vi.fn(async () => null);
    const localStoreWritable = vi.fn(async () => {});
    const mediaProblems = vi.fn((): string[] => []);

    const off = await operationalState(
      { now: NOW },
      healthy({ mediaEnabled: () => false, mediaDriver: () => "local", headObject, localStoreWritable, mediaProblems }),
    );
    expect(off.media).toMatchObject({ state: "ok", code: "disabled" });
    // Nothing was ASKED — the switch is read before the store is touched, so a
    // broken configuration behind a closed switch cannot produce a finding.
    expect(headObject).not.toHaveBeenCalled();
    expect(localStoreWritable).not.toHaveBeenCalled();
    expect(mediaProblems).not.toHaveBeenCalled();

    // The needle: with the switch ON, the very same probes ARE a finding. Without
    // this half the branch above would pass against a probe that answers `ok`
    // unconditionally.
    const on = await operationalState(
      { now: NOW },
      healthy({
        mediaEnabled: () => true,
        mediaDriver: () => "local",
        localStoreWritable: async () => {
          throw Object.assign(new Error("EACCES"), { code: "EACCES" });
        },
      }),
    );
    expect(on.media).toMatchObject({ state: "finding", code: "localDirUnwritable" });
  });

  it("🚨 never puts a caught error's words into its answer", async () => {
    // A driver error carries the bucket URL; a Postgres error carries the
    // query's parameters. `code` is a closed union for exactly that reason.
    const state = await operationalState(
      { now: NOW },
      healthy({
        headObject: async () => {
          throw new Error("HEAD https://secret-bucket.fra1.example.com/x failed (403)");
        },
      }),
    );
    expect(JSON.stringify(state)).not.toContain("secret-bucket");
  });
});

describe("defaultProbes.localStoreWritable — 'not there' is not 'not writable'", () => {
  // The injected probes above cannot reach this: it is the DEFAULT probe, and
  // the defect lived in it. `lib/media/local.ts` creates the media directory on
  // the FIRST `put()`, so every app that has never stored a file answered
  // ENOENT — which this probe reported as `localDirUnwritable`, i.e. a HIGH
  // finding mailed to the operator of a perfectly healthy new app.
  const tmp = () => mkdtempSync(join(tmpdir(), "ds24-media-probe-"));

  it("passes when the directory is absent but its parent can create it", async () => {
    const parent = tmp();
    process.env.MEDIA_LOCAL_DIR = join(parent, "not-created-yet");
    await expect(defaultProbes.localStoreWritable()).resolves.toBeUndefined();
    rmSync(parent, { recursive: true, force: true });
  });

  it("🚨 still refuses when neither the directory nor its parent exists", async () => {
    // The needle. Without it the branch above would pass against a probe that
    // swallows every error, which is exactly the shape that turns a guard silent.
    const parent = tmp();
    process.env.MEDIA_LOCAL_DIR = join(parent, "gone", "deeper");
    rmSync(parent, { recursive: true, force: true });
    await expect(defaultProbes.localStoreWritable()).rejects.toThrow();
  });

  it("passes on a directory that is really there", async () => {
    const dir = tmp();
    process.env.MEDIA_LOCAL_DIR = dir;
    await expect(defaultProbes.localStoreWritable()).resolves.toBeUndefined();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("operationalState — the IPN probe", () => {
  it("asks nothing when this app sells nothing here", async () => {
    const recentOrderCount = vi.fn(async () => 0);
    const latestIpnAt = vi.fn(async () => null);
    const state = await operationalState(
      { now: NOW },
      healthy({ sellingProducts: () => 0, recentOrderCount, latestIpnAt }),
    );
    expect(state.ipn).toMatchObject({ state: "ok", code: "noProducts", sells: false });
    expect(recentOrderCount).not.toHaveBeenCalled();
    expect(latestIpnAt).not.toHaveBeenCalled();
  });

  it("asks nothing about the log when nothing has been bought recently", async () => {
    const latestIpnAt = vi.fn(async () => null);
    const state = await operationalState(
      { now: NOW },
      healthy({ recentOrderCount: async () => 0, latestIpnAt }),
    );
    expect(state.ipn).toMatchObject({
      state: "ok",
      code: "noRecentSales",
      sells: true,
      ordersRecent: 0,
    });
    expect(latestIpnAt).not.toHaveBeenCalled();
  });

  it("counts orders from exactly IPN_ACTIVE_DAYS ago", async () => {
    const seen: Date[] = [];
    await operationalState(
      { now: NOW },
      healthy({
        recentOrderCount: async (since) => {
          seen.push(since);
          return 1;
        },
      }),
    );
    expect(seen[0].toISOString()).toBe(daysAgo(IPN_ACTIVE_DAYS).toISOString());
  });

  it("is ok inside the silence window and a finding one day past it", async () => {
    // Both directions of the threshold — a rule asserted on one side only is a
    // rule that survives being inverted.
    const inside = await operationalState(
      { now: NOW },
      healthy({ latestIpnAt: async () => daysAgo(IPN_SILENCE_DAYS) }),
    );
    expect(inside.ipn).toMatchObject({ state: "ok", code: "recent", silentDays: IPN_SILENCE_DAYS });

    const past = await operationalState(
      { now: NOW },
      healthy({ latestIpnAt: async () => daysAgo(IPN_SILENCE_DAYS + 1) }),
    );
    expect(past.ipn).toMatchObject({
      state: "finding",
      code: "silent",
      silentDays: IPN_SILENCE_DAYS + 1,
    });
    expect(past.ipn.lastEventAt).toBe(daysAgo(IPN_SILENCE_DAYS + 1).toISOString());
  });

  it("🚨 an EMPTY log under recent orders is a finding, not 'never'", async () => {
    // `prune-ipn-log` deletes past IPN_LOG_RETENTION_DAYS, so an empty table on
    // an app that sold this week means at LEAST that long without a
    // notification. Reporting it as unknown would be the silence this epic ends.
    const state = await operationalState({ now: NOW }, healthy({ latestIpnAt: async () => null }));
    expect(state.ipn).toMatchObject({
      state: "finding",
      code: "emptyLog",
      sells: true,
      lastEventAt: null,
    });
    // The window travels with the answer so a reader can judge it without this file.
    expect(state.ipn.logRetentionDays).toBe(IPN_LOG_RETENTION_DAYS);
  });

  it("🚨 a database that does not answer is unchecked — never ok", async () => {
    for (const broken of [
      healthy({
        recentOrderCount: async () => {
          throw new Error("ECONNREFUSED 10.0.0.5:5432 (select … where created_at > $1)");
        },
      }),
      healthy({
        latestIpnAt: async () => {
          throw new Error("ECONNREFUSED");
        },
      }),
    ]) {
      const state = await operationalState({ now: NOW }, broken);
      expect(state.ipn.state).toBe("unchecked");
      expect(state.ipn.code).toBe("dbUnreachable");
    }
  });

  it("🚨 never puts a caught Postgres error's words into its answer", async () => {
    const state = await operationalState(
      { now: NOW },
      healthy({
        latestIpnAt: async () => {
          throw new Error('select … where email = $1 -- "buyer@example.com"');
        },
      }),
    );
    expect(JSON.stringify(state)).not.toContain("buyer@example.com");
  });
});

describe("operationalState — the two are independent", () => {
  it("a database that is down leaves the media answer intact, and vice versa", async () => {
    const dbDown = await operationalState(
      { now: NOW },
      healthy({
        latestIpnAt: async () => {
          throw new Error("ECONNREFUSED");
        },
      }),
    );
    expect(dbDown.ipn.state).toBe("unchecked");
    expect(dbDown.media.state).toBe("ok");

    const storeDown = await operationalState(
      { now: NOW },
      healthy({
        headObject: async () => {
          throw new Error("ENOTFOUND");
        },
      }),
    );
    expect(storeDown.media.state).toBe("finding");
    expect(storeDown.ipn.state).toBe("ok");
  });

  it("🚨 the needle: everything throwing produces no `ok` at all — and a healthy app does", async () => {
    // The second half is the negative control. Without it this passes against an
    // evaluator that answers `unchecked` unconditionally, which is the shape a
    // nervous "fix" produces and which reads as caution while measuring nothing.
    const everythingBroken = await operationalState({ now: NOW }, {
      mediaProblems: () => {
        throw new Error("boom");
      },
      mediaDriver: () => {
        throw new Error("boom");
      },
      mediaEnabled: () => {
        throw new Error("boom");
      },
      headObject: async () => {
        throw new Error("boom");
      },
      localStoreWritable: async () => {
        throw new Error("boom");
      },
      sellingProducts: () => {
        throw new Error("boom");
      },
      recentOrderCount: async () => {
        throw new Error("boom");
      },
      latestIpnAt: async () => {
        throw new Error("boom");
      },
    });
    expect(everythingBroken.media.state).not.toBe("ok");
    expect(everythingBroken.ipn.state).not.toBe("ok");

    const fine = await operationalState({ now: NOW }, healthy());
    expect(fine.media.state).toBe("ok");
    expect(fine.ipn.state).toBe("ok");
  });
});
