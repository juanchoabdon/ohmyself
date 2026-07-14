import "./env.js";
import { createServer } from "node:http";
import { dispatch } from "./http.js";
import { handleCollabUpgrade, startCollabServer } from "./collab/index.js";
import { startScheduler } from "./scheduler.js";

const port = Number(process.env.PORT ?? 8787);

startCollabServer();

const httpServer = createServer((req, res) => dispatch(req, res));

httpServer.on("upgrade", (request, socket, head) => {
  const buf = Buffer.from(head);
  if (handleCollabUpgrade(request, socket, buf)) return;
  socket.destroy();
});

httpServer.listen(port, () => {
  console.log(`ohmyself! listening on :${port}  (REST: /v1/*, MCP: POST /mcp)`);
  // Persistent host: run the periodic sync + backfill-resume in-process.
  // Opt out with SCHEDULER=off (e.g. when running purely as a dev API).
  if (process.env.SCHEDULER !== "off") startScheduler();
});
