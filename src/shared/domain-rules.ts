// =============================================================================
// Domain rules — where the extension is allowed to run
// =============================================================================
//
// In `shared/` because three worlds need the same answer and none may import from
// another: `content/index.ts` asks it before building any UI, the popup asks it to
// explain why the current tab is quiet, and both read the same `Settings`.
//
// Pure functions over strings. No `location`, no `chrome`, no DOM — that is what makes
// the matcher testable and what keeps the rule identical in every world that asks.
// =============================================================================

/**
 * Which way the list reads.
 *
 * Three states rather than a boolean pair, because "allowlist" and "blocklist" are
 * mutually exclusive readings of *one* list and two independent lists would let a user
 * write a contradiction the UI then has to explain. `off` is the default and keeps an
 * upgrade from changing where the extension runs.
 */
export type DomainRuleMode = "off" | "allowlist" | "blocklist";

export const DOMAIN_RULE_OPTIONS: { value: DomainRuleMode; label: string; hint: string }[] = [
  { value: "off", label: "Every site", hint: "The default — no list is consulted" },
  { value: "allowlist", label: "Only these sites", hint: "Off everywhere else" },
  { value: "blocklist", label: "Every site except these", hint: "On everywhere else" },
];

/**
 * One pattern, reduced to the part that matters.
 *
 * `subdomainOnly` is the difference between `example.com` and `*.example.com`, and it is
 * the only piece of state a pattern needs: everything else is a label comparison.
 */
interface Pattern {
  labels: string[];
  subdomainOnly: boolean;
  /** `*` on its own — matches every host, including one we could not read. */
  everything: boolean;
}

/**
 * Turn what someone typed into a host pattern, or `null` if there is nothing left.
 *
 * Deliberately forgiving about input, because the realistic gesture is pasting a URL out
 * of the address bar rather than typing a bare hostname. A scheme, a path, a port, a
 * trailing dot, `www.` typed with a leading `*`, and any amount of case and whitespace
 * all reduce to the same pattern. Being strict here would mean a list that silently does
 * not match the thing the user copied from the tab they were looking at.
 */
export function parsePattern(raw: string): Pattern | null {
  let text = raw.trim().toLowerCase();
  if (!text || text.startsWith("#")) return null; // `#` lets a list carry a comment

  if (text === "*") return { labels: [], subdomainOnly: false, everything: true };

  // A pasted URL. `new URL` is not used for the scheme-less case on purpose: `URL` reads
  // `example.com/path` as a path, not a host, so the split is done by hand.
  if (text.includes("://")) text = text.slice(text.indexOf("://") + 3);
  text = text.split("/")[0];
  // Credentials, then the port. IPv6 in brackets is left alone — it has no labels to
  // match and falls out as a literal below.
  if (text.includes("@")) text = text.slice(text.lastIndexOf("@") + 1);
  if (!text.startsWith("[")) text = text.split(":")[0];

  let subdomainOnly = false;
  if (text.startsWith("*.")) {
    subdomainOnly = true;
    text = text.slice(2);
  } else if (text.startsWith(".")) {
    // `.example.com` is how hosts files and cookie domains spell "subdomains of".
    subdomainOnly = true;
    text = text.slice(1);
  }

  // A root-relative trailing dot (`example.com.`) is the same host.
  while (text.endsWith(".")) text = text.slice(0, -1);
  if (!text) return null;

  return { labels: text.split("."), subdomainOnly, everything: false };
}

/** Do two equal-length label lists match, with `*` standing for any one whole label? */
function labelsMatch(host: string[], pattern: string[]): boolean {
  if (host.length !== pattern.length) return false;
  return pattern.every((label, index) => label === "*" || label === host[index]);
}

/**
 * Does `host` fall under `pattern`?
 *
 * The rule that makes the list behave the way people expect: **a bare domain includes its
 * subdomains.** `example.com` covers `app.example.com` and `a.b.example.com`, because
 * someone who blocks a company's site means the company's site, not one hostname of it.
 * `*.example.com` is the narrower reading — subdomains but *not* the apex — for the case
 * where that distinction is the point.
 *
 * A `*` anywhere else stands for exactly one label, so `foo.*` matches `foo.com` and
 * `foo.dev` but not `foo.co.uk`. That is the conservative choice: a `*` that swallowed
 * several labels would make `foo.*` match `foo.evil.example.com`, and a pattern in an
 * allowlist must not be able to match more than it looks like it does.
 */
export function hostMatchesPattern(host: string, pattern: Pattern): boolean {
  if (pattern.everything) return true;
  if (!host) return false;

  const labels = host.split(".");

  if (!pattern.subdomainOnly && labelsMatch(labels, pattern.labels)) return true;

  // Subdomain: strictly more labels, and the tail has to match.
  if (labels.length <= pattern.labels.length) return false;
  return labelsMatch(labels.slice(labels.length - pattern.labels.length), pattern.labels);
}

/** The first pattern in `rules` that covers `host`, or `null`. Useful for saying *why*. */
export function matchingRule(host: string, rules: readonly string[]): string | null {
  for (const raw of rules) {
    const pattern = parsePattern(raw);
    if (pattern && hostMatchesPattern(host, pattern)) return raw.trim();
  }
  return null;
}

export interface RuleVerdict {
  enabled: boolean;
  /** The pattern that decided it, when a pattern did. `null` when the mode decided. */
  rule: string | null;
}

/**
 * The whole decision, in one place, for a host.
 *
 * `host` is `location.hostname`, which is `""` for `file://` and `about:` documents. Such
 * a document has no labels, so no pattern except `*` can match it — meaning an allowlist
 * turns the extension off on local files unless `*` is listed. That is the safe direction
 * for a list whose purpose is "only these sites", and it is written down in the popup
 * rather than left to be discovered.
 */
export function evaluateHost(
  host: string,
  mode: DomainRuleMode,
  rules: readonly string[],
): RuleVerdict {
  if (mode === "off") return { enabled: true, rule: null };

  const rule = matchingRule(host, rules);
  if (mode === "allowlist") return { enabled: rule !== null, rule };
  return { enabled: rule === null, rule };
}

/**
 * Split a textarea's contents into patterns.
 *
 * Newline *and* comma, because a list pasted from anywhere else is comma-separated and
 * retyping it as lines is busywork. Blank entries and duplicates are dropped here rather
 * than at match time, so what is stored is what the list means.
 */
export function parseRuleList(text: string): string[] {
  const seen = new Set<string>();
  for (const piece of text.split(/[\n,]/)) {
    const trimmed = piece.trim();
    if (trimmed) seen.add(trimmed);
  }
  return [...seen];
}
