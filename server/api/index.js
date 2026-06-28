// Vercel serverless entrypoint for the ohmyself! API + MCP.
// Reuses the same request dispatcher as the standalone Node server.
// Built output (../dist) is produced by `pnpm build` (tsc) during deploy.
import { dispatch } from "../dist/http.js";

export default function handler(req, res) {
  dispatch(req, res);
}
