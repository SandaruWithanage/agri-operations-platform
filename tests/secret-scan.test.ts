// @vitest-environment node
import { afterAll, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  chmodSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
// @ts-expect-error plain ESM script without type declarations
import * as scanner from "../scripts/secret-scan.mjs";

const {
  scanLine,
  scanText,
  scanTree,
  scanHistory,
  parseAllowlist,
  applyAllowlist,
  formatFinding,
  fingerprint,
  maxWaiverDays,
  ScanError,
} = scanner as {
  scanLine: (line: string) => { rule: string; fingerprint: string }[];
  scanText: (
    path: string,
    text: string,
  ) => { rule: string; fingerprint: string; path: string; line: number }[];
  scanTree: (
    root: string,
    report?: {
      scanned?: number;
      skipped?: { oversize: string[]; symlink: number; excluded: number };
    },
    io?: Record<string, (...args: never[]) => unknown>,
  ) => { rule: string; path: string }[];
  scanHistory: (
    root: string,
  ) => Promise<{ rule: string; path: string; commit: string }[]>;
  parseAllowlist: (text: string, today?: Date) => Set<string>;
  applyAllowlist: (
    findings: { rule: string; fingerprint: string; path: string }[],
    waivers: Set<string>,
  ) => { unmatched: unknown[]; unused: string[] };
  formatFinding: (finding: unknown) => string;
  fingerprint: (rule: string, value: string) => string;
  maxWaiverDays: number;
  ScanError: new (message: string) => Error;
};

// Every planted secret is assembled at run time, so this file contains no literal that matches a rule
// (otherwise the scanner would flag its own tests).
const chars = (n: number, seed = "aZ3k9QmX") =>
  Array.from({ length: n }, (_, i) => seed[i % seed.length]).join("");
const planted = {
  "private-key": ["-----BEGIN ", "RSA PRIVATE KEY", "-----"].join(""),
  "aws-access-key-id":
    "AK" + "IA" + chars(16, "ABCDEFGH23456789").toUpperCase(),
  "github-token": "gh" + "p_" + chars(36),
  "slack-token": "xo" + "xb-" + chars(24, "12345abcde"),
  "google-api-key": "AI" + "za" + chars(35),
  "stripe-live-key": "sk" + "_live_" + chars(24),
  "npm-token": "np" + "m_" + chars(36),
  jwt: "ey" + "J" + chars(16) + "." + "ey" + "J" + chars(16) + "." + chars(20),
  "url-with-password":
    "postgres" +
    "ql://svc_user:" +
    chars(18, "Qw7#rT9z") +
    "@db.internal:5432/app",
  "secret-assignment": 'api_key = "' + chars(32, "q8Zx1Lm4") + '"',
} as const;

describe("secret scanner: detection", () => {
  it.each(Object.entries(planted))("detects a %s", (rule, text) => {
    const input = rule === "jwt" ? `token ${text}` : `x ${text} y`;
    const found = scanLine(input);
    expect(found.map((hit) => hit.rule)).toContain(rule);
  });

  it("never returns or prints the matched value", () => {
    for (const text of Object.values(planted)) {
      const found = scanText("a.ts", text);
      const output =
        JSON.stringify(found) + found.map(formatFinding).join("\n");
      for (const piece of text.split(/[\s:@/=]/).filter((p) => p.length >= 12))
        expect(output).not.toContain(piece);
    }
  });

  it("gives stable fingerprints that differ by value and by rule", () => {
    expect(fingerprint("jwt", "a")).toBe(fingerprint("jwt", "a"));
    expect(fingerprint("jwt", "a")).not.toBe(fingerprint("jwt", "b"));
    expect(fingerprint("jwt", "a")).not.toBe(fingerprint("npm-token", "a"));
    expect(fingerprint("jwt", "a")).toMatch(/^[0-9a-f]{12}$/);
  });

  it("ignores obvious placeholders and non-secrets in the generic rules", () => {
    for (const line of [
      "DATABASE_URL=postgresql://agri:change-this-in-local-env@localhost:5432/db",
      "postgresql://USER:PASSWORD@localhost:PORT/agri_test",
      'api_key = "synthetic-api-key-for-unit-tests-only"',
      'token: "' + "x".repeat(40) + '"',
      'password = "${process.env.DB_PASSWORD_VALUE_X}"',
      'secret: "short-value"',
      "const note = 'the secret is rotated every quarter';",
    ])
      expect(scanLine(line), line).toEqual([]);
  });

  it("flags a realistic-looking credential in a generic assignment", () => {
    const value = chars(32, "Zp4v8Rt2");
    expect(
      scanLine(`const credential = "${value}";`).map((h) => h.rule),
    ).toEqual(["secret-assignment"]);
  });

  it("does not scan absurdly long lines", () => {
    expect(scanLine(planted["github-token"] + " ".repeat(2500))).toEqual([]);
  });
});

describe("secret scanner: allowlist", () => {
  const today = new Date("2026-11-19T00:00:00Z");
  const waiver = {
    rule: "jwt",
    fingerprint: "0123456789ab",
    path: "tests/example.ts",
    reason: "Synthetic token used only by a unit test fixture.",
    expires: "2027-03-01",
  };
  const file = (waivers: unknown[]) => JSON.stringify({ version: 1, waivers });

  it("accepts a complete, unexpired, short-lived waiver", () => {
    expect(parseAllowlist(file([waiver]), today).size).toBe(1);
    expect(parseAllowlist(file([]), today).size).toBe(0);
  });

  it.each([
    ["no reason", { ...waiver, reason: "" }],
    ["a too-short reason", { ...waiver, reason: "fixture" }],
    ["an expired waiver", { ...waiver, expires: "2026-11-18" }],
    ["an expiry too far away", { ...waiver, expires: "2027-12-31" }],
    ["a bad date", { ...waiver, expires: "soon" }],
    ["an unknown rule", { ...waiver, rule: "everything" }],
    ["a bad fingerprint", { ...waiver, fingerprint: "xyz" }],
    ["a missing path", { ...waiver, path: "" }],
    ["an extra field", { ...waiver, comment: "ok" }],
  ])("rejects %s", (_label, entry) => {
    expect(() => parseAllowlist(file([entry]), today)).toThrow();
  });

  it("rejects duplicates, bad shapes and invalid JSON", () => {
    expect(() => parseAllowlist(file([waiver, waiver]), today)).toThrow();
    expect(() => parseAllowlist("{}", today)).toThrow();
    expect(() => parseAllowlist("not json", today)).toThrow();
    expect(() =>
      parseAllowlist(JSON.stringify({ version: 2, waivers: [] }), today),
    ).toThrow();
  });

  it(`caps a waiver at ${maxWaiverDays} days`, () => {
    expect(maxWaiverDays).toBe(180);
  });

  it("waives only an exact rule, fingerprint and path, and reports waivers nothing used", () => {
    const waivers = parseAllowlist(file([waiver]), today);
    const finding = {
      rule: "jwt",
      fingerprint: "0123456789ab",
      path: "tests/example.ts",
    };
    expect(applyAllowlist([finding], waivers)).toEqual({
      unmatched: [],
      unused: [],
    });
    expect(
      applyAllowlist([{ ...finding, path: "src/other.ts" }], waivers).unmatched,
    ).toHaveLength(1);
    expect(
      applyAllowlist([{ ...finding, fingerprint: "ffffffffffff" }], waivers)
        .unmatched,
    ).toHaveLength(1);
    expect(applyAllowlist([], waivers).unused).toHaveLength(1);
  });
});

// ---- real git repositories in a temporary directory -------------------------------------------------------
const scratch = mkdtempSync(join(tmpdir(), "secret-scan-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
const git = (cwd: string, ...args: string[]) =>
  execFileSync(
    "git",
    ["-c", "user.name=t", "-c", "user.email=t@example.test", ...args],
    { cwd, stdio: "pipe" },
  );
function repo(name: string) {
  const dir = join(scratch, name);
  mkdirSync(join(dir, "scripts"), { recursive: true });
  git(dir, "init", "-q");
  copyFileSync(
    resolve(__dirname, "../scripts/secret-scan.mjs"),
    join(dir, "scripts/secret-scan.mjs"),
  );
  return dir;
}
const commit = (dir: string, message: string) => {
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", message);
};
const run = (dir: string, ...args: string[]) =>
  spawnSync("node", ["scripts/secret-scan.mjs", ...args], {
    cwd: dir,
    encoding: "utf8",
  });

describe("secret scanner: tree, history and command line", () => {
  it("finds a secret in a tracked file and skips lockfiles, binaries and huge files", () => {
    const dir = repo("tree");
    const secret = planted["github-token"];
    writeFileSync(join(dir, "config.ts"), `export const t = "${secret}";\n`);
    writeFileSync(join(dir, "pnpm-lock.yaml"), `integrity: ${secret}\n`);
    writeFileSync(join(dir, "image.bin"), Buffer.from([0, 1, 2, 3]));
    writeFileSync(join(dir, "big.txt"), "a".repeat(1_600_000) + secret);
    commit(dir, "add files");
    const found = scanTree(dir);
    expect(found.map((f) => f.path)).toEqual(["config.ts"]);
  });

  it("finds a secret that was committed and then deleted (still in history)", async () => {
    const dir = repo("history");
    const secret = planted["aws-access-key-id"];
    writeFileSync(join(dir, "env.txt"), `KEY=${secret}\n`);
    commit(dir, "oops");
    writeFileSync(join(dir, "env.txt"), "KEY=\n");
    commit(dir, "remove the key");
    expect(scanTree(dir)).toEqual([]);
    const found = await scanHistory(dir);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      rule: "aws-access-key-id",
      path: "env.txt",
    });
    expect(found[0].commit).toMatch(/^[0-9a-f]{12}$/);
  });

  it("exits 0 on a clean repository", () => {
    const dir = repo("clean");
    writeFileSync(join(dir, "a.ts"), "export const x = 1;\n");
    commit(dir, "clean");
    const result = run(dir, "--history");
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("0 finding(s)");
  });

  it("reports local refs and distinct commits for all-ref history, without printing ref names", () => {
    const dir = repo("history-coverage");
    writeFileSync(join(dir, "tracked.txt"), "first\n");
    commit(dir, "first");
    execFileSync("git", ["tag", "synthetic-coverage-tag"], { cwd: dir });
    execFileSync("git", ["switch", "-c", "synthetic-coverage-branch"], {
      cwd: dir,
      stdio: "ignore",
    });
    writeFileSync(join(dir, "tracked.txt"), "second\n");
    commit(dir, "second");
    execFileSync("git", ["switch", "--detach", "HEAD~"], {
      cwd: dir,
      stdio: "ignore",
    });
    const head = run(dir, "--history");
    expect(head.status).toBe(0);
    expect(head.stderr).toContain("1 commit(s) reached from HEAD only");
    const all = run(dir, "--history", "--all");
    expect(all.status).toBe(0);
    expect(all.stderr).toContain(
      "2 commit(s) reached from 3 local ref(s) plus HEAD",
    );
    expect(all.stdout + all.stderr).not.toContain("synthetic-coverage-");
  });

  it("exits 1 on a finding, prints rule, path, line and fingerprint, and never the value", () => {
    const dir = repo("finding");
    const secret = planted["github-token"];
    writeFileSync(join(dir, "a.ts"), `\nexport const t = "${secret}";\n`);
    commit(dir, "leak");
    const result = run(dir, "--history");
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(
      /FINDING github-token {2}a\.ts:2 {2}fingerprint [0-9a-f]{12}/,
    );
    expect(result.stdout + result.stderr).not.toContain(secret);
    expect(result.stdout + result.stderr).not.toContain(secret.slice(8, 30));
  });

  it("honours a valid waiver, and fails on an unused or expired one", () => {
    const dir = repo("waiver");
    const secret = planted["github-token"];
    writeFileSync(join(dir, "a.ts"), `export const t = "${secret}";\n`);
    commit(dir, "fixture");
    const [finding] = scanText("a.ts", `export const t = "${secret}";\n`);
    const future = new Date(Date.now() + 30 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const entry = {
      rule: finding.rule,
      fingerprint: finding.fingerprint,
      path: "a.ts",
      reason: "Synthetic fixture token used by a unit test only.",
      expires: future,
    };
    const write = (waivers: unknown[]) =>
      writeFileSync(
        join(dir, ".secret-scan-allowlist.json"),
        JSON.stringify({ version: 1, waivers }),
      );
    write([entry]);
    expect(run(dir).status).toBe(0);
    write([{ ...entry, fingerprint: "ffffffffffff" }]);
    const unused = run(dir);
    expect(unused.status).toBe(1);
    expect(unused.stderr).toContain("UNUSED WAIVER");
    write([{ ...entry, expires: "2020-01-01" }]);
    const expired = run(dir);
    expect(expired.status).toBe(2);
    expect(expired.stderr).toContain("expired");
    writeFileSync(join(dir, ".secret-scan-allowlist.json"), "not json");
    expect(run(dir).status).toBe(2);
  });

  it("is clean on this repository's tracked files", () => {
    expect(scanTree(resolve(__dirname, ".."))).toEqual([]);
  });
});

// ---- failures must never read as a clean scan (owner review of PR #112) -----------------------------------
const realGit = execFileSync("sh", ["-c", "command -v git"], {
  encoding: "utf8",
}).trim();

/** A directory holding a stand-in `git` that behaves as MODE says, and otherwise runs the real one. */
function fakeGit(name: string, behaviour: string) {
  const dir = join(scratch, name);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "git");
  writeFileSync(
    file,
    `#!/bin/sh\n${behaviour.replaceAll("REALGIT", realGit)}\n`,
  );
  chmodSync(file, 0o755);
  return dir;
}
const runWith = (cwd: string, path: string, ...args: string[]) =>
  spawnSync("node", ["scripts/secret-scan.mjs", ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, PATH: `${path}:${process.env.PATH}` },
  });
const output = (r: { stdout: string; stderr: string }) => r.stdout + r.stderr;
const planted2 = planted["github-token"];

function cleanRepo(name: string) {
  const dir = repo(name);
  writeFileSync(join(dir, "a.ts"), "export const x = 1;\n");
  commit(dir, "one");
  writeFileSync(join(dir, "a.ts"), "export const x = 2;\n");
  commit(dir, "two");
  return dir;
}

describe("secret scanner: failures never read as clean", () => {
  it("fails when git ls-files exits non-zero, and echoes none of git's output", () => {
    const dir = cleanRepo("fail-ls");
    const path = fakeGit(
      "fake-ls",
      `case "$1" in ls-files) echo "boom ${planted2}" >&2; exit 3;; esac\nexec REALGIT "$@"`,
    );
    const result = runWith(dir, path);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("git ls-files failed (exit status 3)");
    expect(output(result)).not.toContain(planted2);
    expect(output(result)).not.toContain("0 finding(s)");
  });

  it("fails when git cannot be found at all", () => {
    const dir = cleanRepo("no-git");
    const result = spawnSync(process.execPath, ["scripts/secret-scan.mjs"], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, PATH: "/nonexistent" },
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("git was not found");
  });

  it("fails when git ls-files lists nothing, and outside a repository", () => {
    const empty = repo("empty");
    expect(() => scanTree(empty)).toThrow(ScanError);
    expect(runWith(empty, "/nonexistent").status).toBe(2);
    const outside = join(scratch, "not-a-repo");
    mkdirSync(join(outside, "scripts"), { recursive: true });
    copyFileSync(
      resolve(__dirname, "../scripts/secret-scan.mjs"),
      join(outside, "scripts/secret-scan.mjs"),
    );
    const result = run(outside);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("could not complete");
  });

  it("fails when git log exits non-zero even after printing a clean-looking history", () => {
    const dir = cleanRepo("fail-log");
    const path = fakeGit(
      "fake-log",
      `case "$*" in *" log "*|"log "*|*"-c core.quotepath=off log"*) echo "commit 0123456789abcdef"; echo "boom ${planted2}" >&2; exit 4;; esac\nexec REALGIT "$@"`,
    );
    const result = runWith(dir, path, "--history");
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("git log failed (exit status 4)");
    expect(output(result)).not.toContain(planted2);
  });

  it("reports no coverage when a ref moves during an all-ref scan", () => {
    const dir = cleanRepo("moving-ref");
    git(dir, "branch", "synthetic-moving-ref", "HEAD~");
    const path = fakeGit(
      "fake-moving-ref",
      `case "$*" in
        *"core.quotepath=off log"*)
          REALGIT "$@" || exit $?
          exec REALGIT branch -f synthetic-moving-ref HEAD
          ;;
      esac
      exec REALGIT "$@"`,
    );
    const result = runWith(dir, path, "--history", "--all");
    expect(result.status).toBe(2);
    expect(result.stderr).toContain(
      "local refs changed during the history scan",
    );
    expect(output(result)).not.toContain("History coverage:");
    expect(output(result)).not.toContain("synthetic-moving-ref");
  });

  it("fails when git log succeeds but returns no commits", () => {
    const dir = cleanRepo("empty-log");
    const path = fakeGit(
      "fake-empty-log",
      `case "$*" in *"core.quotepath=off log"*) exit 0;; esac\nexec REALGIT "$@"`,
    );
    const result = runWith(dir, path, "--history");
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("returned no commits");
  });

  it("fails on a bad ref and on a history with no commits, in the library too", async () => {
    const dir = cleanRepo("bad-ref");
    await expect(
      scanHistory(dir, ["refs/heads/does-not-exist"]),
    ).rejects.toThrow(ScanError);
    const unborn = repo("unborn");
    writeFileSync(join(unborn, "a.ts"), "export const x = 1;\n");
    git(unborn, "add", "-A");
    await expect(scanHistory(unborn)).rejects.toThrow(ScanError);
  });

  it("refuses a shallow clone, whose truncated history proves nothing", () => {
    const source = cleanRepo("shallow-source");
    const clone = join(scratch, "shallow-clone");
    execFileSync(
      "git",
      ["clone", "-q", "--depth", "1", `file://${source}`, clone],
      { stdio: "pipe" },
    );
    mkdirSync(join(clone, "scripts"), { recursive: true });
    copyFileSync(
      resolve(__dirname, "../scripts/secret-scan.mjs"),
      join(clone, "scripts/secret-scan.mjs"),
    );
    const result = run(clone, "--history");
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("shallow clone");
    expect(run(clone).status).toBe(0); // the tree scan alone does not depend on history
  });

  it("rejects an unknown argument instead of silently skipping the history scan", () => {
    const dir = cleanRepo("args");
    for (const args of [["--histroy"], ["--all"], ["--history", "--al"]]) {
      const result = run(dir, ...args);
      expect(result.status).toBe(2);
      expect(result.stderr).toContain("usage error");
    }
  });

  it("names a tracked file that cannot be opened, with its error code and no content", () => {
    const dir = repo("unreadable");
    writeFileSync(join(dir, "ok.ts"), "export const x = 1;\n");
    writeFileSync(join(dir, "locked.ts"), `export const t = "${planted2}";\n`);
    commit(dir, "files");
    const failing = {
      open: (p: string) => {
        if (p.endsWith("locked.ts"))
          throw Object.assign(new Error(`EACCES ${planted2}`), {
            code: "EACCES",
          });
        return 3;
      },
      fstat: () => ({ isFile: () => true, size: 10 }),
      read: () => Buffer.from("export const x = 1;\n"),
      close: () => undefined,
    };
    let message = "";
    try {
      scanTree(dir, {}, failing as never);
    } catch (error) {
      expect(error).toBeInstanceOf(ScanError);
      message = (error as Error).message;
    }
    expect(message).toContain("locked.ts (EACCES)");
    expect(message).toContain("1 tracked file(s) could not be read");
    expect(message).not.toContain(planted2);
  });

  it("treats other read failures (I/O error, read error) the same way", () => {
    const dir = repo("io-errors");
    writeFileSync(join(dir, "a.ts"), "export const x = 1;\n");
    commit(dir, "file");
    const base = {
      open: () => 3,
      fstat: () => ({ isFile: () => true, size: 10 }),
      read: () => Buffer.from(""),
      close: () => undefined,
    };
    expect(() =>
      scanTree(dir, {}, {
        ...base,
        read: () => {
          throw Object.assign(new Error("x"), { code: "EIO" });
        },
      } as never),
    ).toThrow(/a\.ts \(EIO\)/);
    expect(() =>
      scanTree(dir, {}, {
        ...base,
        fstat: () => {
          throw new Error("no code");
        },
      } as never),
    ).toThrow(/a\.ts \(UNKNOWN\)/);
  });

  it("fails on a tracked file that is missing from the working tree", () => {
    const dir = repo("missing");
    writeFileSync(join(dir, "a.ts"), "export const x = 1;\n");
    writeFileSync(join(dir, "b.ts"), "export const y = 1;\n");
    commit(dir, "files");
    rmSync(join(dir, "b.ts"));
    expect(() => scanTree(dir)).toThrow(/b\.ts \(ENOENT\)/);
    const result = run(dir);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("could not complete");
  });

  it.skipIf(process.getuid?.() === 0)(
    "fails on a real permission error (not run as root)",
    () => {
      const dir = repo("eacces");
      writeFileSync(
        join(dir, "locked.ts"),
        `export const t = "${planted2}";\n`,
      );
      commit(dir, "locked");
      chmodSync(join(dir, "locked.ts"), 0o000);
      const result = run(dir);
      chmodSync(join(dir, "locked.ts"), 0o644);
      expect(result.status).toBe(2);
      expect(result.stderr).toContain("locked.ts (EACCES)");
      expect(output(result)).not.toContain(planted2);
    },
  );

  it("does not treat deliberate exclusions as failures, and reports them", () => {
    const dir = repo("deliberate");
    writeFileSync(join(dir, "ok.ts"), "export const x = 1;\n");
    writeFileSync(join(dir, "pnpm-lock.yaml"), `integrity: ${planted2}\n`);
    writeFileSync(join(dir, "big.txt"), "a".repeat(1_600_000));
    writeFileSync(join(dir, "image.bin"), Buffer.from([0, 1, 2, 3]));
    symlinkSync("does-not-exist", join(dir, "dangling"));
    commit(dir, "files");
    const report: {
      scanned?: number;
      skipped?: { oversize: string[]; symlink: number; excluded: number };
    } = {};
    expect(scanTree(dir, report)).toEqual([]);
    expect(report.scanned).toBe(2); // ok.ts and the scanner copy that repo() tracks
    expect(report.skipped).toMatchObject({
      oversize: ["big.txt"],
      symlink: 1,
      excluded: 1,
    });
    const result = run(dir);
    expect(result.status).toBe(0);
    expect(result.stderr).toContain(
      "NOT SCANNED (over the size limit) big.txt",
    );
    expect(result.stderr).toContain(
      "1 excluded by path, 1 over the size limit",
    );
  });

  it("never prints a secret value in any failure or finding message", () => {
    const dir = repo("no-leak");
    writeFileSync(join(dir, "a.ts"), `export const t = "${planted2}";\n`);
    commit(dir, "leak");
    rmSync(join(dir, "a.ts"));
    for (const result of [
      run(dir),
      run(dir, "--history"),
      run(dir, "--nope"),
    ]) {
      expect(output(result)).not.toContain(planted2);
      expect(output(result)).not.toContain(planted2.slice(8, 30));
    }
  });
});
