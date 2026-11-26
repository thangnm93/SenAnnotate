// =============================================================================
// Package the extension for testers
// =============================================================================
//
// Produces `senannotate-<version>.zip` containing the unpacked extension plus the
// tester guide, ready to hand over for `chrome://extensions` → Load unpacked — and,
// beside it, `senannotate-mcp-<version>.mjs`, the agent's MCP server.
//
// Uses the system `zip`, which is present on macOS and Linux — not worth a
// dependency for one command.
// =============================================================================

import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist");
const STAGING = join(ROOT, ".pack");

if (!existsSync(join(DIST, "manifest.json"))) {
  console.error("dist/ is missing or incomplete — run `npm run build` first.");
  process.exit(1);
}

const { version } = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const name = `senannotate-${version}`;
const archive = join(ROOT, `${name}.zip`);
const payload = join(STAGING, name);

rmSync(STAGING, { recursive: true, force: true });
rmSync(archive, { force: true });
mkdirSync(payload, { recursive: true });

// Copy the built extension, then drop the guide in beside it so the person who
// unzips it sees the instructions without having to be sent them separately.
execFileSync("cp", ["-R", `${DIST}/.`, payload]);
copyFileSync(join(ROOT, "TESTER-GUIDE.md"), join(payload, "TESTER-GUIDE.md"));

execFileSync("zip", ["-qr", archive, name], { cwd: STAGING });
rmSync(STAGING, { recursive: true, force: true });

// The MCP server ships beside the zip, never inside it: the zip is what the Web Store
// receives, and a Node program in an extension package is code the extension never runs
// and a reviewer has to ask about. One file, so a release asset rather than a second zip.
const mcpSource = join(ROOT, "dist-mcp", "senannotate-mcp.mjs");
const mcpTarget = join(ROOT, `senannotate-mcp-${version}.mjs`);
if (!existsSync(mcpSource)) {
  console.error("dist-mcp/senannotate-mcp.mjs is missing — run `npm run build` first.");
  process.exit(1);
}
copyFileSync(mcpSource, mcpTarget);

console.log(`\npacked → ${archive}`);
console.log(`         ${mcpTarget}`);
console.log("Send this to testers along with TESTER-GUIDE.md's install steps.\n");
