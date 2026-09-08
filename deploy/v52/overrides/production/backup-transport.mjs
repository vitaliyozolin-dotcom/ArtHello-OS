import { request as httpRequest } from "node:http";

const SOCKET_PATH = "/var/lib/arthello-v52-backup-control/control.sock";
const MAX_BYTES = 128_000;

// This Node service binding alone can reach the fixed Unix socket. The worker
// receives no host paths, secrets, Docker socket or arbitrary network target.
export function createBackupTransport({ socketPath = SOCKET_PATH, timeoutMs = 8_000 } = {}) {
  return async function backupTransport(request) {
    let target;
    try { target = new URL(request.url); } catch { return unavailable(); }
    if (target.origin !== "http://backup.internal" || target.username || target.password || target.search || target.hash
      || !((request.method === "GET" && target.pathname === "/status") || (request.method === "POST" && target.pathname === "/create"))) {
      return Response.json({ error: "Действие не разрешено" }, { status: 403 });
    }
    return new Promise((resolve) => {
      let finished = false;
      const finish = (response) => { if (!finished) { finished = true; resolve(response); } };
      const upstream = httpRequest({ socketPath, path: target.pathname, method: request.method, headers: { host: "backup.internal", "content-length": "0" } }, (response) => {
        const chunks = [];
        let size = 0;
        response.on("data", (chunk) => {
          size += chunk.length;
          if (size > MAX_BYTES) { response.destroy(); finish(unavailable()); }
          else chunks.push(chunk);
        });
        response.on("error", () => finish(unavailable()));
        response.on("end", () => {
          try {
            const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            const status = response.statusCode;
            if (![200, 202, 409, 503].includes(status)) return finish(unavailable());
            finish(Response.json(payload, { status, headers: { "cache-control": "no-store" } }));
          } catch { finish(unavailable()); }
        });
      });
      const timer = setTimeout(() => { upstream.destroy(); finish(unavailable()); }, timeoutMs);
      upstream.on("close", () => clearTimeout(timer));
      upstream.on("error", () => finish(unavailable()));
      upstream.end();
    });
  };
}

function unavailable() { return Response.json({ error: "Сервис резервных копий временно недоступен" }, { status: 503 }); }
