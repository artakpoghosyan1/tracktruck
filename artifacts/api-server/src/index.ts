import { createServer } from "http";
import app from "./app";
import { setupWebSocket } from "./routes/ws";
import { startSimulationEngine } from "./lib/simulation-engine";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = createServer(app);

setupWebSocket(server);
startSimulationEngine();

server.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
