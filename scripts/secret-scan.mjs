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
 * Exit status: 0 clean, 1 findings, 2 configuration or usage error.
 */
import { createHash } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createInterface } from "node:readline";
import { resolve } from "node:path";
import { URL, fileURLToPath } from "node:url";

export const maxWaiverDays = 180;
const maxFileBytes = 1_500_000;
const skippedPaths = [
  /(^|\/)pnpm-lock\.yaml$/,
  /\.(png|jpe?g|gif|ico|woff2?|pdf|zip)$/i,
];

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

function trackedFiles(root) {
  return execFileSync("git", ["ls-files", "-z"], {
    cwd: root,
    maxBuffer: 64 * 1024 * 1024,
  })
    .toString()
    .split("\0")
    .filter(Boolean);
}

export function scanTree(root) {
  const findings = [];
  for (const path of trackedFiles(root)) {
    if (skippedPaths.some((pattern) => pattern.test(path))) continue;
    const full = resolve(root, path);
    if (!existsSync(full)) continue;
    const stat = statSync(full);
    if (!stat.isFile() || stat.size > maxFileBytes) continue;
    const buffer = readFileSync(full);
    if (isBinary(buffer)) continue;
    findings.push(...scanText(path, buffer.toString("utf8")));
  }
  return findings;
}

/**
 * History reachable from HEAD by default, so another open branch's commits never fail this one. Pass
 * `--all` for a full audit of every ref.
 */
export async function scanHistory(root, refs = ["HEAD"]) {
  const findings = [];
  const child = spawn(
    "git",
    [
      "log",
      ...refs,
      "--no-color",
      "--no-renames",
      "-p",
      "--format=commit %H",
      "-U0",
    ],
    { cwd: root, stdio: ["ignore", "pipe", "ignore"] },
  );
  let commit = "";
  let path = "";
  let line = 0;
  const reader = createInterface({ input: child.stdout, crlfDelay: Infinity });
  for await (const text of reader) {
    if (text.startsWith("commit ")) {
      commit = text.slice(7, 19);
    } else if (text.startsWith("+++ ")) {
      path = text.startsWith("+++ b/") ? text.slice(6) : "";
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
  await new Promise((done) => child.on("close", done));
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

async function main() {
  const args = process.argv.slice(2);
  const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
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
  const all = scanTree(root);
  if (history)
    all.push(
      ...(await scanHistory(
        root,
        args.includes("--all") ? ["--all"] : ["HEAD"],
      )),
    );
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
  console.error(
    `Secret scan (${history ? "tree and history" : "tree"}): ${unmatched.length} finding(s), ` +
      `${waivers.size - unused.length} waived, ${unused.length} unused waiver(s). No matched value is printed.`,
  );
  process.exit(unmatched.length > 0 || unused.length > 0 ? 1 : 0);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main();
