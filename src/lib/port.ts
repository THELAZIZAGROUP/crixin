import { createServer } from "node:net";

/** Find a free TCP port to bind on 127.0.0.1. */
export async function findFreePort(preferred = 0): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(preferred, "127.0.0.1", () => {
      const addr = server.address();
      if (addr && typeof addr === "object") {
        const port = addr.port;
        server.close(() => resolve(port));
      } else {
        reject(new Error("could not determine free port"));
      }
    });
  });
}
