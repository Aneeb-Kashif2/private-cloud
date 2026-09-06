import { buildApp } from "./app.js";
const app = await buildApp();
try { await app.listen({ port: app.config.PORT, host: "0.0.0.0" }); } catch (error) { app.log.error(error); process.exit(1); }

// Let in-flight uploads finish before Docker stops the process.
let shuttingDown = false;
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.close().then(() => process.exit(0), error => {
      app.log.error(error);
      process.exit(1);
    });
  });
}
