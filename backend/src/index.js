import "dotenv/config";
import {createMetrics} from './metrics.js';
import { createApp } from "./app.js";
import { createQlooClient } from "./qloo.js";
import { fileURLToPath } from "node:url";
import { createDayStore } from "./days.js";
import { createAgent } from "./agent.js";
import { createAccounts,createAccountStore } from './accounts.js';
import {createRouteBudget} from './route-budget.js';
import { createRouteActions } from './route-actions.js';

let prisma = null;
if (process.env.DATABASE_URL) {
  const { PrismaClient } = await import("@prisma/client");
  prisma = new PrismaClient();
}
const accounts=createAccounts({store:createAccountStore({file:process.env.ACCOUNT_DATA_FILE||fileURLToPath(new URL('../data/accounts.json',import.meta.url))})});
const app = createApp({ provider: createQlooClient(), routeActions:createRouteActions({enabled:process.env.ROUTE_ESTIMATES_ENABLED==='1',provider:process.env.ROUTE_ESTIMATE_PROVIDER,displayContext:'osm',mapboxToken:process.env.MAPBOX_DIRECTIONS_TOKEN,budget:createRouteBudget({file:process.env.ROUTE_REQUEST_BUDGET_FILE,dailyLimit:process.env.ROUTE_REQUESTS_PER_UTC_DAY})}), metrics:createMetrics({file:process.env.USAGE_DATA_FILE||fileURLToPath(new URL('../data/usage.json',import.meta.url))}), prisma, agent:createAgent(), accounts, dayStore:createDayStore({file:process.env.DAY_DATA_FILE || fileURLToPath(new URL("../data/days.json", import.meta.url))}) });
const port = Number(process.env.PORT || 4000);
const server = app.listen(port, process.env.HOST || "127.0.0.1", () => console.log(`Swipe2Plan on port ${port}`));
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => server.close(async () => { await prisma?.$disconnect(); process.exit(0); }));
