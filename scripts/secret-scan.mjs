#!/usr/bin/env node
/**
 * Dependency-free secret scanner (SEC-A9, docs/security/SECRET_SCANNING.md).
 *
 * Scans the tracked working tree and, with --history, every added line in every commit. It reports the rule,
 * the file, the line and a short fingerprint of the match. **It never prints a matched value**, so a CI log
 * cannot itself leak a secret.
 *
 * A finding is waived only through `.secret-scan-allowlist.json`: each entry names the rule, the fingerprint,
 * the path, a written reason and an expiry date no more than 180 days away. An expired, malformed or
 * over-long entry fails the run, so a waiver cannot quietly become permanent. A real secret is never waived:
 * it is rotated (see the procedure in the document).
 *
 * Exit status: 0 clean, 1 findings, 2 the scan could not be completed (configuration or usage error, a failed git
 * command, a tracked file that could not be read, an incomplete history). **A scan that could not finish is never
 * reported as clean**, and its message never contains file contents, git output or a matched value.
 */
import { createHash } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  fstatSync,
  openSync,
  readFileSync,
} from "node:fs";
import { createInterface } from "node:readline";
import { resolve } from "node:path";
import { URL, fileURLToPath } from "node:url";

export const maxWaiverDays = 180;
const maxFileBytes = 1_500_000;
const skippedPaths = [
  /(^|\/)pnpm-lock\.yaml$/,
  /\.(png|jpe?g|gif|ico|woff2?|pdf|zip)$/i,
];

/** The scan could not be completed. The message is fixed text, paths and codes only: never content or git output. */
export class ScanError extends Error {
  constructor(message) {
    super(message);
    this.name = "ScanError";
  }
}

function describeFailure(error) {
  if (error?.code === "ENOENT") return "git was not found";
  if (typeof error?.status === "number") return `exit status ${error.status}`;
  if (error?.signal) return `signal ${error.signal}`;
  if (typeof error?.code === "string") return `error ${error.code}`;
  return "unknown failure";
}

function gitOutput(root, args) {
  try {
    return execFileSync("git", args, {
      cwd: root,
      maxBuffer: 256 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    // Deliberately not error.message or stderr: git output can quote paths or content.
    throw new ScanError(`git ${args[0]} failed (${describeFailure(error)})`);
  }
}

/** Words that mark a value as an obvious placeholder in the *generic* rule only. */
const placeholder =
  /(synthetic|example|sample|dummy|placeholder|change[-_ ]?(me|this)|replace|your[-_ ]|xxxx|redacted|not-a-secret|fake|test|process\.env|\$\{|<[a-z-]+>|\*{3,})|^(password|passwd|secret|token|user|port)$/i;

export const rules = [
  {
    id: "private-key",
    pattern:
      /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/g,
    generic: false,
  },
  {
    id: "aws-access-key-id",
    pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
    generic: false,
  },
  {
    id: "github-token",
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})\b/g,
    generic: false,
  },
  {
    id: "slack-token",
    pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g,
    generic: false,
  },
  {
    id: "google-api-key",
    pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g,
    generic: false,
  },
  {
    id: "stripe-live-key",
    pattern: /\b[sr]k_live_[0-9A-Za-z]{20,}\b/g,
    generic: false,
  },
  { id: "npm-token", pattern: /\bnpm_[A-Za-z0-9]{36}\b/g, generic: false },
  {
    id: "jwt",
    pattern:
      /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    generic: false,
  },
  {
    id: "url-with-password",
    pattern:
      /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqps?):\/\/[^\s:@/"'`]+:([^\s@/"'`]{8,})@/g,
    generic: true,
    group: 1,
  },
  {
    id: "secret-assignment",
    pattern:
      /(?:secret|passw(?:or)?d|token|api[_-]?key|private[_-]?key|credential)[A-Za-z0-9_]*["']?\s*[:=]\s*["']([A-Za-z0-9+/=_.-]{20,})["']/gi,
    generic: true,
    group: 1,
  },
];

export function fingerprint(rule, value) {
  return createHash("sha256")
    .update(`${rule}\u0000${value}`)
    .digest("hex")
    .slice(0, 12);
}

const repeated = (value) => /^(.)\1+$/.test(value);

/** Pure: findings in one line of text. Never includes the matched value, only its fingerprint. */
export function scanLine(line) {
  const found = [];
  if (line.length > 2000) return found;
  for (const rule of rules) {
    rule.pattern.lastIndex = 0;
    for (const match of line.matchAll(rule.pattern)) {
      const value = rule.group ? match[rule.group] : match[0];
      if (
        rule.generic &&
        (placeholder.test(value) || repeated(value) || value.length < 8)
      )
        continue;
      found.push({ rule: rule.id, fingerprint: fingerprint(rule.id, value) });
    }
  }
  return found;
}

export function parseAllowlist(text, today = new Date()) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("allowlist is not valid JSON");
  }
  if (!data || data.version !== 1 || !Array.isArray(data.waivers))
    throw new Error('allowlist must be {"version":1,"waivers":[...]}');
  const limit = new Date(today.getTime() + maxWaiverDays * 86_400_000);
  const allowed = new Set(["rule", "fingerprint", "path", "reason", "expires"]);
  const seen = new Set();
  for (const waiver of data.waivers) {
    if (
      !waiver ||
      typeof waiver !== "object" ||
      Object.keys(waiver).some((key) => !allowed.has(key))
    )
      throw new Error("allowlist entry has missing or unknown fields");
    if (
      !rules.some((r) => r.id === waiver.rule) ||
      !/^[0-9a-f]{12}$/.test(waiver.fingerprint ?? "") ||
      typeof waiver.path !== "string" ||
      waiver.path === ""
    )
      throw new Error(
        "allowlist entry needs a known rule, a fingerprint and a path",
      );
    if (typeof waiver.reason !== "string" || waiver.reason.trim().length < 20)
      throw new Error(
        "allowlist entry needs a written reason of at least 20 characters",
      );
    const expires = new Date(`${waiver.expires}T23:59:59Z`);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(waiver.expires ?? "") ||
      Number.isNaN(expires.getTime())
    )
      throw new Error("allowlist entry needs an expiry date (YYYY-MM-DD)");
    if (expires < today)
      throw new Error(`allowlist entry for ${waiver.rule} has expired`);
    if (expires > limit)
      throw new Error(
        `allowlist expiry may be at most ${maxWaiverDays} days away`,
      );
    const id = `${waiver.rule}|${waiver.fingerprint}|${waiver.path}`;
    if (seen.has(id)) throw new Error("allowlist has a duplicate entry");
    seen.add(id);
  }
  return seen;
}

function isBinary(buffer) {
  return buffer.subarray(0, 8000).includes(0);
}

export function scanText(path, text, context = {}) {
  const findings = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i += 1)
    for (const hit of scanLine(lines[i]))
      findings.push({ ...hit, path, line: i + 1, ...context });
  return findings;
}

/** Tracked entries as {mode, path}; fails on a git error, an unparseable entry or an empty list. */
function trackedEntries(root) {
  const output = gitOutput(root, ["ls-files", "-z", "-s"]).toString();
  const entries = output
    .split("\0")
    .filter(Boolean)
    .map((entry) => {
      const m = /^(\d{6}) [0-9a-f]+ \d\t([\s\S]+)$/.exec(entry);
      if (!m) throw new ScanError("git ls-files returned an unreadable entry");
      return { mode: m[1], path: m[2] };
    });
  if (entries.length === 0)
    throw new ScanError("git ls-files returned no tracked files");
  return entries;
}

const defaultIo = {
  open: (path) => openSync(path, "r"),
  fstat: (fd) => fstatSync(fd),
  read: (fd) => readFileSync(fd),
  close: (fd) => closeSync(fd),
};

/**
 * Opens once and checks the same descriptor it reads, so the file cannot change between check and read.
 * Every outcome is named: a file that cannot be read is `unreadable` (with the error code), never silently skipped.
 */
function readTrackedFile(full, io) {
  let fd;
  try {
    fd = io.open(full);
    const stat = io.fstat(fd);
    if (!stat.isFile()) return { kind: "not-regular" };
    if (stat.size > maxFileBytes) return { kind: "oversize" };
    return { kind: "read", buffer: io.read(fd) };
  } catch (error) {
    return {
      kind: "unreadable",
      code: typeof error?.code === "string" ? error.code : "UNKNOWN",
    };
  } finally {
    if (fd !== undefined) {
      try {
        io.close(fd);
      } catch {
        // closing a read-only descriptor cannot change the result
      }
    }
  }
}

/**
 * Scans tracked files. Deliberate exclusions are counted in `report.skipped` (path pattern, over the size limit,
 * binary content, symbolic link, submodule); anything else that cannot be read throws a ScanError naming the path
 * and error code, so an unreadable file can never make a scan look clean.
 */
export function scanTree(root, report = {}, io = defaultIo) {
  const findings = [];
  const unreadable = [];
  const skipped = {
    excluded: 0,
    oversize: [],
    binary: 0,
    symlink: 0,
    submodule: 0,
    notRegular: 0,
  };
  let scanned = 0;
  for (const { mode, path } of trackedEntries(root)) {
    if (mode === "120000") {
      skipped.symlink += 1;
      continue;
    }
    if (mode === "160000") {
      skipped.submodule += 1;
      continue;
    }
    if (skippedPaths.some((pattern) => pattern.test(path))) {
      skipped.excluded += 1;
      continue;
    }
    const result = readTrackedFile(resolve(root, path), io);
    if (result.kind === "unreadable") {
      unreadable.push(`${path} (${result.code})`);
    } else if (result.kind === "not-regular") {
      skipped.notRegular += 1;
    } else if (result.kind === "oversize") {
      skipped.oversize.push(path);
    } else if (isBinary(result.buffer)) {
      skipped.binary += 1;
    } else {
      scanned += 1;
      findings.push(...scanText(path, result.buffer.toString("utf8")));
    }
  }
  if (unreadable.length > 0) {
    const shown = unreadable.slice(0, 20).join(", ");
    const more =
      unreadable.length > 20 ? `, and ${unreadable.length - 20} more` : "";
    throw new ScanError(
      `${unreadable.length} tracked file(s) could not be read: ${shown}${more}`,
    );
  }
  report.scanned = scanned;
  report.skipped = skipped;
  return findings;
}

/**
 * History reachable from HEAD by default, so another open branch's commits never fail this one. Pass
 * `--all` for a full audit of every ref.
 *
 * Fails with a ScanError, never a clean result, when git cannot run, exits non-zero, is killed, prints no commits
 * at all, or the clone is shallow (a history scan of a truncated history proves nothing).
 */
export async function scanHistory(root, refs = ["HEAD"]) {
  const shallow = gitOutput(root, ["rev-parse", "--is-shallow-repository"])
    .toString()
    .trim();
  if (shallow === "true")
    throw new ScanError(
      "the history is incomplete (shallow clone); fetch the full history, for example fetch-depth: 0",
    );
  if (shallow !== "false")
    throw new ScanError("could not determine whether the history is complete");

  const findings = [];
  const child = spawn(
    "git",
    [
      "-c",
      "core.quotepath=off",
      "log",
      ...refs,
      "--no-color",
      "--no-renames",
      "-p",
      "--format=commit %H",
      "-U0",
    ],
    { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
  );
  child.stderr.resume(); // drained and discarded: git messages are never echoed
  // A spawn failure also ends in `close` with a non-zero code, which is checked below; this only stops an
  // unhandled 'error' event from crashing the process before that check runs.
  child.on("error", () => undefined);
  const closed = new Promise((done) =>
    child.on("close", (code, signal) => done({ code, signal })),
  );
  let commit = "";
  let commits = 0;
  let path = "";
  let line = 0;
  const reader = createInterface({ input: child.stdout, crlfDelay: Infinity });
  for await (const text of reader) {
    if (text.startsWith("commit ")) {
      commit = text.slice(7, 19);
      commits += 1;
    } else if (text.startsWith("+++ ")) {
      if (text.startsWith("+++ b/")) path = text.slice(6);
      else if (text.startsWith('+++ "b/')) path = text.slice(7, -1);
      else path = ""; // /dev/null: a deletion adds no lines
    } else if (text.startsWith("@@")) {
      const m = /\+(\d+)/.exec(text);
      line = m ? Number(m[1]) - 1 : 0;
    } else if (text.startsWith("+") && !text.startsWith("+++")) {
      line += 1;
      if (!path || skippedPaths.some((pattern) => pattern.test(path))) continue;
      for (const hit of scanLine(text.slice(1)))
        findings.push({ ...hit, path, line, commit });
    }
  }
  const { code, signal } = await closed;
  if (signal) throw new ScanError(`git log failed (signal ${signal})`);
  if (code !== 0) throw new ScanError(`git log failed (exit status ${code})`);
  if (commits === 0)
    throw new ScanError("git log returned no commits, so nothing was scanned");
  return findings;
}

export function applyAllowlist(findings, waivers) {
  const unmatched = [];
  const used = new Set();
  for (const finding of findings) {
    const id = `${finding.rule}|${finding.fingerprint}|${finding.path}`;
    if (waivers.has(id)) used.add(id);
    else unmatched.push(finding);
  }
  const unused = [...waivers].filter((id) => !used.has(id));
  return { unmatched, unused };
}

export function formatFinding(f) {
  const where = f.commit ? `commit ${f.commit} ` : "";
  return `${f.rule}  ${where}${f.path}:${f.line}  fingerprint ${f.fingerprint}`;
}

const knownArguments = new Set(["--history", "--all"]);

async function main() {
  const args = process.argv.slice(2);
  const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
  const unknown = args.filter((arg) => !knownArguments.has(arg));
  if (
    unknown.length > 0 ||
    (args.includes("--all") && !args.includes("--history"))
  ) {
    // A mistyped flag must not silently skip the history scan and report clean.
    console.error(
      "Secret scan usage error: accepted arguments are --history and --history --all.",
    );
    process.exit(2);
  }
  const history = args.includes("--history");
  let waivers;
  try {
    const file = resolve(root, ".secret-scan-allowlist.json");
    waivers = parseAllowlist(
      existsSync(file)
        ? readFileSync(file, "utf8")
        : '{"version":1,"waivers":[]}',
    );
  } catch (error) {
    console.error(`Secret scan configuration error: ${error.message}`);
    process.exit(2);
  }
  const report = {};
  let all;
  try {
    all = scanTree(root, report);
    if (history)
      all.push(
        ...(await scanHistory(
          root,
          args.includes("--all") ? ["--all"] : ["HEAD"],
        )),
      );
  } catch (error) {
    // Only ScanError messages are printed; anything unexpected is reported by name and code, never by message.
    const reason =
      error instanceof ScanError
        ? error.message
        : `unexpected ${error?.name ?? "error"}${typeof error?.code === "string" ? ` (${error.code})` : ""}`;
    console.error(`Secret scan could not complete: ${reason}`);
    console.error(
      "No result is reported: an incomplete scan is not a clean scan.",
    );
    process.exit(2);
  }
  // One finding per (rule, fingerprint, path) is enough to act on, whichever commit added it.
  const unique = new Map();
  for (const f of all) {
    const id = `${f.rule}|${f.fingerprint}|${f.path}`;
    if (!unique.has(id)) unique.set(id, f);
  }
  const { unmatched, unused } = applyAllowlist([...unique.values()], waivers);
  for (const f of unmatched) console.error("FINDING " + formatFinding(f));
  for (const id of unused)
    console.error(`UNUSED WAIVER ${id.split("|").join(" ")}`);
  const s = report.skipped;
  console.error(
    `Not scanned: ${s.excluded} excluded by path, ${s.oversize.length} over the size limit, ${s.binary} binary, ` +
      `${s.symlink} symbolic link, ${s.submodule} submodule, ${s.notRegular} not a regular file.`,
  );
  for (const oversize of s.oversize)
    console.error(`NOT SCANNED (over the size limit) ${oversize}`);
  console.error(
    `Secret scan (${history ? "tree and history" : "tree"}): ${report.scanned} file(s) scanned, ${unmatched.length} finding(s), ` +
      `${waivers.size - unused.length} waived, ${unused.length} unused waiver(s). No matched value is printed.`,
  );
  process.exit(unmatched.length > 0 || unused.length > 0 ? 1 : 0);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main();
