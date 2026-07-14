export type BrainMode = "hosted" | "local";

export type InitClient = "cursor" | "claude" | "codex";

export interface McpSnippetOpts {
  mode: BrainMode;
  mcpUrl: string;
  token?: string;
  spaceId?: string;
  scope: string;
  vaultDir: string;
  ohmyselfRoot?: string;
}

function authHeaders(token: string, spaceId?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
  };
  if (spaceId) headers["X-Brain-Space"] = spaceId;
  return headers;
}

function localStdioCommand(opts: McpSnippetOpts): { command: string; args: string[] } {
  if (opts.ohmyselfRoot) {
    return {
      command: "tsx",
      args: [`${opts.ohmyselfRoot}/server/src/mcp/stdio.ts`],
    };
  }
  return {
    command: "pnpm",
    args: ["--filter", "@ohmyself/server", "mcp"],
  };
}

export function cursorMcpConfig(opts: McpSnippetOpts): Record<string, unknown> {
  if (opts.mode === "local") {
    const cwd = process.cwd();
    const vault = pathIsAbsolute(opts.vaultDir) ? opts.vaultDir : `${cwd}/${opts.vaultDir}`;
    const { command, args } = localStdioCommand(opts);
    return {
      mcpServers: {
        ohmyself: {
          command,
          args,
          env: {
            VAULT_BACKEND: "fs",
            FS_VAULT_DIR: vault,
            OHMYSELF_USER_ID: "local",
            OHMYSELF_SCOPE: opts.scope,
          },
        },
      },
    };
  }

  const token = opts.token ?? "oms_your_token_here";
  return {
    mcpServers: {
      ohmyself: {
        url: opts.mcpUrl,
        headers: authHeaders(token, opts.spaceId),
      },
    },
  };
}

export function claudeDesktopConfig(opts: McpSnippetOpts): Record<string, unknown> {
  if (opts.mode === "local") {
    const cwd = process.cwd();
    const vault = pathIsAbsolute(opts.vaultDir) ? opts.vaultDir : `${cwd}/${opts.vaultDir}`;
    const { command, args } = localStdioCommand(opts);
    return {
      mcpServers: {
        ohmyself: {
          command,
          args,
          env: {
            VAULT_BACKEND: "fs",
            FS_VAULT_DIR: vault,
            OHMYSELF_USER_ID: "local",
            OHMYSELF_SCOPE: opts.scope,
          },
        },
      },
    };
  }

  const token = opts.token ?? "oms_your_token_here";
  return {
    mcpServers: {
      ohmyself: {
        command: "npx",
        args: ["-y", "mcp-remote", opts.mcpUrl, "--header", `Authorization: Bearer ${token}`],
      },
    },
  };
}

export function codexMcpConfig(opts: McpSnippetOpts): Record<string, unknown> {
  // Codex uses ~/.codex/config.toml — we emit a TOML fragment in init.ts
  return cursorMcpConfig(opts);
}

function pathIsAbsolute(p: string): boolean {
  return p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p);
}
