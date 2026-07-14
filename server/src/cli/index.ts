#!/usr/bin/env tsx
import "../env.js";
import path from "node:path";
import { argFor, hasFlag } from "./util.js";
import { runInit } from "./init.js";

const sub = process.argv[2];

async function main(): Promise<void> {
  if (sub === "init") {
    if (hasFlag("--help") || hasFlag("-h")) {
      printHelp();
      return;
    }
    const cwd = path.resolve(argFor("--cwd") ?? process.cwd());
    await runInit(cwd);
    return;
  }

  if (sub === "help" || sub === "--help" || sub === "-h") {
    printHelp();
    return;
  }

  console.error(`Unknown command: ${sub}`);
  printHelp();
  process.exit(1);
}

function printHelp(): void {
  console.log(`oms — ohmyself project wiring CLI

Usage:
  oms init [options]     Scaffold .oms/ + MCP configs for this folder

Options:
  --name <name>          Project display name (default: folder name)
  --slug <slug>          URL-safe slug (default: derived from name)
  --mode hosted|local    hosted = remote MCP + token; local = fs vault + stdio
  --token <oms_…>        Personal access token (or set OMS_TOKEN)
  --mcp-url <url>        MCP endpoint (default: https://www.ohmyself.ai/mcp)
  --space <space-id>     Company space for X-Brain-Space header
  --scope secret|private|public   Scope hint for token (default: secret)
  --vault <path>         Local vault dir for --mode local (default: ./vault)
  --client cursor,claude,codex   Clients to configure (default: cursor,claude)
  --cwd <path>           Target directory (default: process.cwd())
  --ohmyself-root <path> Path to ohmyself monorepo (auto-detected for local)
  --force                Overwrite existing .oms/ and merge .cursor/mcp.json

Examples:
  oms init
  oms init --token "$OMS_TOKEN"
  oms init --mode local --vault ./brain
  oms init --space <bonds-space-id> --client cursor
`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
