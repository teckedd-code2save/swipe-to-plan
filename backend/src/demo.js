// Deliberately no dotenv, Prisma or live provider. Safe local fixture demo.
import { createApp } from "./app.js";
import { createDemoProvider } from "./demo-provider.js";
const port = Number(process.env.PORT || 4000);
const server = createApp({ provider: createDemoProvider() }).listen(port, "127.0.0.1", () => console.log(`Synthetic demo: http://127.0.0.1:${port} (no credentials or external API calls)`));
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => server.close());
