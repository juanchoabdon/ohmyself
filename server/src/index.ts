import "./env.js";
import { createServer } from "node:http";
import { dispatch } from "./http.js";

const port = Number(process.env.PORT ?? 8787);

const httpServer = createServer((req, res) => dispatch(req, res));

httpServer.listen(port, () => {
  console.log(`ohmyself! listening on :${port}  (REST: /v1/*, MCP: POST /mcp)`);
});
