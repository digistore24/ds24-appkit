// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

// The container rung's first decision — whether there is anything in this tree
// for its scanner to read — and what each of its three answers says.
//
// ⚠️ **No Docker.** `vitest.config.ts` puts this file inside `npm run test` and
// therefore inside `make check`, and `security-check` must never become a gate
// (NFR-64). `dockerUsable()` and `capture()` are replaced below; what the rung
// does against a real Trivy is proven by running the command on a machine that
// has one. What lives here is the walk and the sentences.
//
// ── Why this file exists ────────────────────────────────────────────────────
//
// Until 2026-09-15 the rung asked for Docker and the image BEFORE it looked in
// the tree, and on a fresh app — which holds nothing Trivy's misconfig scanner
// reads; the shipped `docker-compose.yml` is not a target — that printed
// `⏭ NOT ASKED — Blind to: the repository's own container and infrastructure
// files` on every machine without them. A tester read it as a gap. The rung
// reads the tree first now, and the test at the foot of this file reads the
// SOURCE to make sure that order stays: a rung that walks the tree after asking
// for Docker passes every behavioural test below when Docker is mocked present.
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { blankComments } from "../../lib/source-text.mjs";

/** The machine this test decides. */
const machine = {
  dockerAnswers: true,
  images: "aquasec/trivy:latest\n",
  report: null as object | null,
  calls: [] as string[][],
  dockerAsked: 0,
};

vi.mock("../../db/driver.mjs", () => ({
  dockerUsable: async () => {
    machine.dockerAsked += 1;
    return machine.dockerAnswers;
  },
}));

vi.mock("../../lib/proc.mjs", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    capture: async (_command: string, args: string[]) => {
      machine.calls.push(args);
      if (args[0] === "images") return { code: 0, stdout: machine.images, stderr: "", timedOut: false };
      return {
        code: 0,
        stdout: machine.report ? JSON.stringify(machine.report) : "",
        stderr: machine.report ? "" : "FATAL something went wrong",
        timedOut: false,
      };
    },
  };
});

const { container, scopeFiles, isScopeName, sniffsAsManifest, nameList, blindTo, nothingInScope } =
  await import("./container.mjs");

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = blankComments(readFileSync(path.join(HERE, "container.mjs"), "utf8"));

let root = "";

function plant(file: string, content = "") {
  const full = path.join(root, file);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, content);
}

const K8S = "apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: web\n";
const COMPOSE = "services:\n  db:\n    image: postgres:16\n";

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "ds24-container-scope-"));
  machine.dockerAnswers = true;
  machine.images = "aquasec/trivy:latest\n";
  machine.report = null;
  machine.calls = [];
  machine.dockerAsked = 0;
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("scopeFiles — what Trivy's misconfig scanner would read in this tree", () => {
  it("finds the files by name and by content, and nothing else", () => {
    plant("Dockerfile", "FROM node:22\n");
    plant("api.Dockerfile", "FROM node:22\n");
    plant("Dockerfile.dev", "FROM node:22\n");
    plant("infra/main.tf", 'resource "x" "y" {}\n');
    plant("infra/vars.tf.json", "{}\n");
    plant("infra/site.bicep", "");
    plant("chart/Chart.yaml", "apiVersion: v2\nname: app\n");
    plant("k8s/deploy.yaml", K8S);
    plant("k8s/deploy.json", '{\n  "apiVersion": "v1",\n  "kind": "Service"\n}\n');
    plant("cfn/stack.yml", "AWSTemplateFormatVersion: '2010-09-09'\nResources: {}\n");
    // Not in scope — measured: Trivy reads no Compose file, and the rest is the app.
    plant("docker-compose.yml", COMPOSE);
    plant("compose.yaml", COMPOSE);
    plant("package.json", '{ "name": "app", "version": "1.0.0" }\n');
    plant("tsconfig.json", '{ "compilerOptions": { "kind": "x" } }\n');
    plant(".github/workflows/ci.yml", "on: push\njobs: {}\n");
    // Not this repository's — the walk never enters these.
    plant("node_modules/dep/Dockerfile", "FROM scratch\n");
    plant(".next/k8s.yaml", K8S);
    plant(".dev/Dockerfile", "");
    plant(".git/Dockerfile", "");

    expect(scopeFiles(root)).toEqual([
      "Dockerfile",
      "Dockerfile.dev",
      "api.Dockerfile",
      "cfn/stack.yml",
      "chart/Chart.yaml",
      "infra/main.tf",
      "infra/site.bicep",
      "infra/vars.tf.json",
      "k8s/deploy.json",
      "k8s/deploy.yaml",
    ]);
  });

  it("is empty for a tree shaped like a fresh app", () => {
    plant("docker-compose.yml", COMPOSE);
    plant("package.json", '{ "name": "app" }\n');
    plant("drizzle/meta/_journal.json", '{ "version": "7", "entries": [] }\n');
    plant("messages/de.json", '{ "kind": "x" }\n');
    expect(scopeFiles(root)).toEqual([]);
  });

  it("tells a manifest from a config by BOTH keys, in either spelling", () => {
    expect(sniffsAsManifest(K8S)).toBe(true);
    expect(sniffsAsManifest('{"apiVersion":"v1","kind":"Pod"}')).toBe(false); // one line, no key at line start
    expect(sniffsAsManifest('{\n"apiVersion": "v1",\n"kind": "Pod"\n}')).toBe(true);
    expect(sniffsAsManifest("kind: something\n")).toBe(false);
    expect(sniffsAsManifest(COMPOSE)).toBe(false);
    expect(sniffsAsManifest("AWSTemplateFormatVersion: 2010-09-09\n")).toBe(true);
  });

  it("names Dockerfiles in their three spellings and no Compose file", () => {
    for (const name of ["Dockerfile", "Dockerfile.prod", "web.Dockerfile", "a.tf", "a.tf.json", "a.bicep", "Chart.yaml"]) {
      expect(isScopeName(name), name).toBe(true);
    }
    for (const name of ["docker-compose.yml", "compose.yaml", "Dockerfile-notes.md", "chart.yaml", "package.json"]) {
      expect(isScopeName(name), name).toBe(false);
    }
  });

  it("names a handful and counts the rest", () => {
    expect(nameList(["a", "b"])).toBe("a, b");
    expect(nameList(["a", "b", "c", "d", "e", "f", "g"])).toBe("a, b, c, d, e and 2 more");
    expect(blindTo(["Dockerfile"])).toBe("Dockerfile — 1 container/infrastructure file(s) in this tree, unread");
  });
});

describe("the rung's three answers", () => {
  it("✓ on a tree with nothing to read — and Docker is never asked", async () => {
    plant("docker-compose.yml", COMPOSE);
    plant("package.json", "{}\n");
    const result = await container.run({ root, argv: [] });
    expect(result.state).toBe("clean");
    expect(result.findings).toEqual([]);
    expect(result.evidence).toContain("docker-compose.yml");
    expect(result.evidence).toContain("Docker was not asked");
    expect(result.evidence).toContain("Dockerfile*");
    expect(machine.dockerAsked).toBe(0);
    expect(machine.calls).toEqual([]);
    expect(result).toEqual(nothingInScope());
  });

  it("⏭ when a Dockerfile lies here and the daemon does not answer — Blind to: names it", async () => {
    plant("Dockerfile", "FROM node:22\n");
    machine.dockerAnswers = false;
    const result = await container.run({ root, argv: [] });
    expect(result.state).toBe("skipped");
    expect(result.reason).toContain("docker info");
    expect(result.reason).toContain("start Docker Desktop");
    expect(result.covers).toBe("Dockerfile — 1 container/infrastructure file(s) in this tree, unread");
    expect(machine.calls).toEqual([]);
  });

  it("⏭ when Docker answers and the image is not here — a different sentence, the same Blind to:", async () => {
    plant("Dockerfile", "FROM node:22\n");
    plant("infra/main.tf", "");
    machine.images = "";
    const result = await container.run({ root, argv: [] });
    expect(result.state).toBe("skipped");
    expect(result.reason).toMatch(/^Docker answered, but the aquasec\/trivy image is not on this machine/);
    expect(result.covers).toBe(
      "Dockerfile, infra/main.tf — 2 container/infrastructure file(s) in this tree, unread",
    );
    // `images` was asked; `run` was not.
    expect(machine.calls.map((args) => args[0])).toEqual(["images"]);
  });

  it("⏭ when the image is here and writes no report — still Blind to: the files", async () => {
    plant("Dockerfile", "FROM node:22\n");
    const result = await container.run({ root, argv: [] });
    expect(result.state).toBe("skipped");
    expect(result.reason).toContain("wrote no report Trivy would recognise: FATAL something went wrong");
    expect(result.covers).toContain("Dockerfile");
  });

  it("the scan, with the tree's files in its evidence", async () => {
    plant("Dockerfile", "FROM node:22\nUSER root\n");
    machine.report = {
      SchemaVersion: 2,
      Results: [
        {
          Target: "/repo/Dockerfile",
          Class: "config",
          Type: "dockerfile",
          Misconfigurations: [
            {
              AVDID: "AVD-DS-0002",
              Title: "Image user should not be 'root'",
              Severity: "HIGH",
              Description: "Running as root is a risk.",
              Resolution: "Add USER to the Dockerfile.",
              CauseMetadata: { StartLine: 2 },
            },
          ],
        },
        { Target: "package-lock.json", Class: "lang-pkgs", Type: "npm" },
      ],
    };
    const result = await container.run({ root, argv: [] });
    expect(result.state).toBe("found");
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({ severity: "high", where: "Dockerfile:2", id: "AVD-DS-0002" });
    expect(result.evidence).toContain("1 configuration file(s) in scope");
    expect(result.evidence).toContain("this tree holds 1: Dockerfile");
    // The mount is read-only and offline, as the header promises.
    const run = machine.calls.find((args) => args[0] === "run")!;
    expect(run).toContain("none");
    expect(run.some((arg) => arg.endsWith(":/repo:ro"))).toBe(true);
  });
});

describe("the order is in the source, not only in the mocks", () => {
  it("🚨 walks the tree before it asks the daemon", () => {
    // With Docker mocked as present, a rung that asks first and walks second
    // passes everything above except the `dockerAsked === 0` assertion — and a
    // later edit that moves the walk down would only ever fail that one line. So
    // the order is read out of the source as well.
    const walk = SOURCE.indexOf("scopeFiles(cwd)");
    const daemon = SOURCE.indexOf("dockerUsable()");
    expect(walk).toBeGreaterThan(-1);
    expect(daemon).toBeGreaterThan(-1);
    expect(walk).toBeLessThan(daemon);
  });

  it("returns before Docker when the walk found nothing", () => {
    expect(SOURCE).toMatch(/if \(files\.length === 0\) return nothingInScope\(\);/);
  });
});
