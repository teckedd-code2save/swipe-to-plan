import "dotenv/config";
import { createApp } from "./app.js";
import { createQlooClient } from "./qloo.js";

let prisma = null;
if (process.env.DATABASE_URL) {
  const { PrismaClient } = await import("@prisma/client");
  prisma = new PrismaClient();
}
const app = createApp({ provider: createQlooClient(), prisma });
const port = Number(process.env.PORT || 4000);
const server = app.listen(port, process.env.HOST || "127.0.0.1", () => console.log(`Swipe2Plan on port ${port}`));
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => server.close(async () => { await prisma?.$disconnect(); process.exit(0); }));
