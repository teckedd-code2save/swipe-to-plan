import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomInt } from "node:crypto";
import { publicDeck } from "./deck.js";
import { API_SCHEMA, InputError, parseRequest } from "./contract.js";
import { createDiscovery, mergeGroup } from "./plan.js";
import { buildOuting, parseOutingRequest } from "./outing.js";
import { buildItinerary, parseItinerary } from "./itinerary.js";
import { createDays } from "./days.js";
import { AGENT_TOOLS, AgentError } from "./agent.js";
import { createAccounts } from './accounts.js';

export function createApp({ provider, prisma = null, agent = null, dayStore, accounts=createAccounts(), rateLimit = true, trustProxy = process.env.TRUST_PROXY === '1' ? 1 : false, now = Date.now } = {}) {
  const app = express();
  // Production is reachable only through the one host-level Caddy proxy.
  app.set('trust proxy', trustProxy);
  const discovery = createDiscovery({ provider, now });
  const days = createDays({ discovery, store: dayStore, now });
  app.disable("x-powered-by");
  app.use(express.json({ limit: "50kb" }));
  app.use("/api", (_req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
  const hits = new Map();
  const limit = (max) => (req, res, next) => {
    if (!rateLimit) return next();
    const key = req.ip + req.path;
    const recent = (hits.get(key) ?? []).filter((t) => now() - t < 60000);
    if (recent.length >= max) return res.status(429).json({ code: "rate_limited", error: "Please wait a minute and try again." });
    if (hits.size > 5000) hits.delete(hits.keys().next().value);
    hits.set(key, [...recent, now()]); next();
  };
  const route = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
  accounts.mount(app,{route,limit,resolveLocation:provider.getLocation});
  const db = (_req, res, next) => prisma ? next() : res.status(503).json({ code: "rooms_unavailable", error: "Group rooms need a configured database. Solo discovery is available." });
  const strictFields = (body, allowed) => {
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((k) => !allowed.includes(k))) throw new InputError(`Supported fields: ${allowed.join(", ")}.`);
  };
  const findRoom = async (code) => prisma.room.findUnique({ where: { code: String(code).toUpperCase() }, include: { members: { orderBy: { createdAt: "asc" } } } });

  app.get("/api/health", (_req, res) => res.json({ ok: true, provider: provider.name, roomsConfigured: !!prisma, agentConfigured: !!agent?.configured() }));
  app.get("/api/schema", (_req, res) => res.json(API_SCHEMA));
  app.get('/api/locations',limit(60),route(async(req,res)=>{
    const query=req.query.q;if(typeof query!=='string'||query.trim().length<2||query.length>160||/[\x00-\x1f<>]/.test(query))throw new InputError('Type at least two characters of a city, town or neighborhood.');
    if(!provider.searchLocations)throw new InputError('Location search is unavailable on this server.');
    res.json({locations:await provider.searchLocations(query.trim()),source:'qloo'});
  }));
  app.get('/api/locations/:id',limit(60),route(async(req,res)=>{if(!provider.getLocation)throw new InputError('Location search is unavailable on this server.');res.json(await provider.getLocation(req.params.id));}));
  app.get("/api/deck", (_req, res) => res.json(publicDeck()));
  app.post("/api/recommend", limit(30), route(async (req, res) => res.json(await discovery.recommend(parseRequest(req.body)))));
  app.post("/api/outings", limit(30), route(async (req, res) => res.json(await buildOuting(discovery, parseOutingRequest(req.body)))));
  app.get("/api/agent/tools", (_req,res) => res.json({tools:AGENT_TOOLS,transport:{plan_day:{method:'POST',path:'/api/itineraries'}},capabilities:'/api/schema'}));
  app.post("/api/itineraries", limit(20), route(async(req,res)=>res.json(await buildItinerary(discovery,parseItinerary(req.body)))));
  app.post("/api/agent", limit(10), route(async(req,res)=>{
    strictFields(req.body,['message','context','history','circles','planContext','locationContext']);
    if(!agent)throw new AgentError('agent_not_configured');
    const interpretation=await agent.interpret(req.body);
    if(['needs_input','action','show_ui','reply'].includes(interpretation.status))return res.json(interpretation);
    const plan=await buildItinerary(discovery,interpretation.request);
    res.json({...plan,agent:{model:interpretation.model,action:'plan_day'}});
  }));
  const credential = req => (req.get('authorization') || '').replace(/^Bearer /, '');
  app.post('/api/days', limit(10), route(async (req,res) => res.status(201).json(await days.create(req.body))));
  app.get('/api/days/:id', limit(120), route(async (req,res) => res.json(await days.get(req.params.id, credential(req)))));
  app.post('/api/days/:id/members', limit(20), route(async (req,res) => res.status(201).json(await days.add(req.params.id, credential(req), req.body))));
  app.post('/api/days/:id/circle', limit(20), route(async (req,res) => res.json(await days.circle(req.params.id, credential(req), req.body))));
  app.post('/api/days/:id/join', limit(10), route(async (req,res) => res.status(201).json(await days.join(req.params.id, credential(req), req.body))));
  app.patch('/api/days/:id/members/:memberId', limit(45), route(async (req,res) => res.json(await days.updatePerson(req.params.id, credential(req), req.params.memberId, req.body))));
  app.delete('/api/days/:id/members/:memberId', limit(20), route(async (req,res) => res.json(await days.remove(req.params.id, credential(req), req.params.memberId))));
  app.patch('/api/days/:id', limit(20), route(async (req,res) => res.json(await days.updateBrief(req.params.id, credential(req), req.body))));
  app.post('/api/days/:id/retry', limit(10), route(async (req,res) => res.json(await days.retry(req.params.id, credential(req)))));
  app.post("/api/baseline", (_req, res) => res.status(410).json({ code: "comparison_retired", error: "Use /api/recommend for evidence-based discovery. Model-only comparisons have been retired." }));

  app.post("/api/rooms", db, limit(10), route(async (req, res) => {
    strictFields(req.body, ["intent", "location", "area"]);
    const request = parseRequest(req.body);
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = Array.from({ length: 5 }, () => alphabet[randomInt(alphabet.length)]).join("");
      try {
        const room = await prisma.room.create({ data: { code, intent: request.intent, area: request.location.area } });
        return res.status(201).json({ code: room.code });
      } catch (e) { if (e.code !== "P2002") throw e; }
    }
    throw new Error("room_allocation_failed");
  }));
  app.get("/api/rooms/:code", db, limit(60), route(async (req, res) => {
    const room = await findRoom(req.params.code);
    if (!room) return res.status(404).json({ code: "room_not_found", error: "Room not found." });
    res.json({ code: room.code, intent: room.intent, area: room.area, members: room.members.map(({ id, name }) => ({ id, name })) });
  }));
  app.post("/api/rooms/:code/members", db, limit(20), route(async (req, res) => {
    strictFields(req.body, ["name", "liked"]);
    const room = await findRoom(req.params.code);
    if (!room) return res.status(404).json({ code: "room_not_found", error: "Room not found." });
    if (room.members.length >= 8) throw new InputError("This room is full (8 people).");
    parseRequest({ liked: req.body.liked ?? [] });
    const name = typeof req.body.name === "string" ? req.body.name.replace(/https?:\/\/\S*/gi, "").replace(/[<>]/g, "").trim().slice(0, 24) : "";
    if (!name) throw new InputError("A name is required.");
    const member = await prisma.member.create({ data: { roomId: room.id, name, liked: [...new Set(req.body.liked ?? [])] } });
    res.status(201).json({ id: member.id });
  }));
  const groupPlan = route(async (req, res) => {
    const body = req.method === "POST" ? req.body : {};
    strictFields(body, ["constraints", "feedback", "limit"]);
    const room = await findRoom(req.params.code);
    if (!room) return res.status(404).json({ code: "room_not_found", error: "Room not found." });
    if (!room.members.length) throw new InputError("Nobody has joined yet.");
    const request = parseRequest({ ...body, intent: room.intent, area: room.area });
    const people = await Promise.all(room.members.map(async (m) => {
      const personal = parseRequest({ ...body, intent: room.intent, area: room.area, liked: m.liked });
      return { id: m.id, name: m.name, ...await discovery.person(personal) };
    }));
    const result = mergeGroup(people, request.limit);
    const insufficient = result.items.length < request.limit;
    res.json({
      version: "1.0", ...result, request, status: insufficient ? "insufficient_matches" : "ok",
      people: people.map(({ id, name, taste, provenance }) => ({ id, name, taste, provenance })),
      provenance: { provider: provider.name },
      relaxationOptions: [], // Room intent/location are fixed. Start a new room to change them.
      warnings: [
        ...(provider.name === "demo" ? ["Synthetic demo data; not real venue recommendations."] : []),
        ...(insufficient ? ["Fewer candidates met the room constraints. No constraints were relaxed; start a new room to change intent or area."] : []),
        ...(people.some((p) => p.taste.unresolved.length) ? ["Some member artists were unresolved; inspect each member's taste evidence."] : []),
      ],
    });
  });
  app.get("/api/rooms/:code/plan", db, limit(20), groupPlan);
  app.post("/api/rooms/:code/plan", db, limit(20), groupPlan);
  app.use("/api", (_req, res) => res.status(404).json({ code: "not_found", error: "Unknown API route. See /api/schema." }));
  app.use((e, _req, res, _next) => {
    if (e.type === "entity.parse.failed") return res.status(400).json({ code: "invalid_json", error: "Request body must be valid JSON." });
    if (e.type === "entity.too.large") return res.status(413).json({ code: "body_too_large", error: "Request body exceeds 50 KB." });
    const status = [400,401,403,404,409].includes(e.status) ? e.status : 503;
    res.status(status).json({ code: e.code && ["location_not_found", "location_ambiguous", "account_error", "invalid_request", "provider_unavailable", "provider_not_configured", "provider_response_invalid", "provider_auth_error", "provider_rate_limited", "agent_not_configured", "agent_unavailable", "day_not_found", "day_forbidden", "day_conflict", "day_unavailable"].includes(e.code) ? e.code : "service_unavailable", error: e.status ? e.message : "The service is temporarily unavailable. Please retry." });
  });
  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../frontend/dist");
  if (fs.existsSync(path.join(dist, "index.html"))) {
    app.use(express.static(dist));
    app.get("*", (_req, res) => res.sendFile(path.join(dist, "index.html")));
  }
  return app;
}
