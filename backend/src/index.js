import "dotenv/config";
import {createMetrics} from './metrics.js';
import { createApp } from "./app.js";
import { createQlooClient } from "./qloo.js";
import { fileURLToPath } from "node:url";
import { createDayStore } from "./days.js";
import { createAgent } from "./agent.js";
import { createAccounts,createAccountStore } from './accounts.js';

let prisma = null;
if (process.env.DATABASE_URL) {
  const { PrismaClient } = await import("@prisma/client");
  prisma = new PrismaClient();
}
const accounts=createAccounts({store:createAccountStore({file:process.env.ACCOUNT_DATA_FILE||fileURLToPath(new URL('../data/accounts.json',import.meta.url))})});
const app = createApp({ provider: createQlooClient(), metrics:createMetrics({file:process.env.USAGE_DATA_FILE||fileURLToPath(new URL('../data/usage.json',import.meta.url))}), prisma, agent:createAgent(), accounts, dayStore:createDayStore({file:process.env.DAY_DATA_FILE || fileURLToPath(new URL("../data/days.json", import.meta.url))}) });
const port = Number(process.env.PORT || 4000);
const server = app.listen(port, process.env.HOST || "127.0.0.1", () => console.log(`Swipe2Plan on port ${port}`));
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => server.close(async () => { await prisma?.$disconnect(); process.exit(0); }));
