import { randomUUID, randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { InputError } from './contract.js';
import { parseItinerary, buildItinerary } from './itinerary.js';

const token = () => randomBytes(24).toString('base64url');
const digest = value => createHash('sha256').update(String(value || '')).digest();
const equal = (a, b) => !!a && !!b && timingSafeEqual(digest(a), digest(b));
const fail = (message, status = 404, code = 'day_not_found') => Object.assign(new Error(message), { status, code });
const checkFields = (body, allowed) => {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !allowed.includes(key))) throw new InputError(`Supported fields: ${allowed.join(', ')}.`);
};
const profile = (input, id) => {
  checkFields(input, ['id', 'name', 'artists', 'vibes', 'spending']);
  return { ...parseItinerary({ party: { adults: 1 }, people: [input] }).people[0], id: id || input.id || randomUUID() };
};
const canonical = day => parseItinerary({ ...day.brief, people: day.members.map(({ id, name, artists, vibes, spending }) => ({ id, name, artists, vibes, ...(spending?{spending}:{}) })) });
const event = (day, type, name, detail, now) => {
  day.revision++;
  day.updatedAt = new Date(now()).toISOString();
  day.planError = null;
  day.events = [...day.events, { id: randomUUID(), revision: day.revision, type, name, detail, at: day.updatedAt }].slice(-15);
};

// Single-process storage with serialized, atomic writes. Tests use memory only.
// Persistent deployments must mount this file on a durable volume.
export function createDayStore({ file = null, now = Date.now } = {}) {
  let records = null, loading = null;
  let queue = Promise.resolve();
  const ready = async () => {
    if (records) return;
    if (!loading) loading = (async () => {
      try { records = file ? JSON.parse(await readFile(file, 'utf8')) : {}; }
      catch (error) { if (error.code !== 'ENOENT') throw error; records = {}; }
    })();
    await loading;
  };
  return {
    async read(id) { await queue; await ready(); const value = records[id]; return value && value.expiresAt > now() ? structuredClone(value) : null; },
    async transact(fn) {
      const task = queue.then(async () => {
        await ready();
        const next = structuredClone(records);
        for (const [id, day] of Object.entries(next)) if (day.expiresAt <= now()) delete next[id];
        const result = await fn(next);
        if (Object.keys(next).length > 200) throw fail('The shared-day service is full. Please try again later.', 503, 'day_unavailable');
        if (file) {
          await mkdir(dirname(file), { recursive: true, mode: 0o700 });
          const temporary = `${file}.${randomUUID()}.tmp`;
          await writeFile(temporary, JSON.stringify(next), { mode: 0o600 });
          await rename(temporary, file);
        }
        records = next;
        return structuredClone(result);
      });
      queue = task.catch(() => {});
      return task;
    },
  };
}

export function createDays({ discovery, store = createDayStore(), now = Date.now }) {
  const building = new Map();
  const access = (day, credential) => {
    if (!day || day.expiresAt <= now()) throw fail('This day has expired or could not be found.');
    if (equal(day.ownerToken, credential)) return { role: 'owner', memberId: day.members[0]?.id };
    const member = day.members.find(person => equal(person.editToken, credential));
    if (member) return { role: 'member', memberId: member.id };
    if (equal(day.inviteToken, credential)) return { role: 'guest', memberId: null };
    throw fail('This link cannot access this day.', 403, 'day_forbidden');
  };
  const requireOwner = a => { if (a.role !== 'owner') throw fail('Only the organizer can change the group or trip details.', 403, 'day_forbidden'); };
  const snapshot = (day, credential) => {
    const permission = access(day, credential);
    return {
      id: day.id, revision: day.revision, planRevision: day.planRevision, request: canonical(day),
      members: day.members.map(({ editToken, ...member }) => member),
      plan: day.plan, planError: day.planError, events: day.events,
      status: day.planRevision === day.revision ? 'ready' : day.planError ? 'error' : 'updating',
      expiresAt: new Date(day.expiresAt).toISOString(), access: permission,
      ...(permission.role === 'owner' ? { inviteToken: day.inviteToken, participantLinks: day.members.map(m => ({ id: m.id, token: m.editToken })) } : {}),
    };
  };
  function rebuild(id) {
    if (building.has(id)) return building.get(id);
    const task = (async () => {
      while (true) {
        const day = await store.read(id);
        if (!day || day.planRevision === day.revision || day.planError) return;
        const revision = day.revision;
        try {
          const plan = await buildItinerary(discovery, canonical(day));
          await store.transact(records => {
            const current = records[id];
            if (!current || current.revision !== revision) return;
            current.plan = plan; current.planRevision = revision; current.planError = null;
          });
        } catch {
          await store.transact(records => { if (records[id]?.revision === revision) records[id].planError = 'The group is saved, but the new itinerary could not be built. Retry when the service is available.'; });
        }
        // If tastes changed while Qloo was working, discard that result and use the latest group.
      }
    })().finally(() => building.delete(id));
    building.set(id, task);
    task.catch(() => {});
    return task;
  }
  const change = async (id, credential, callback) => {
    await store.transact(records => {
      const day = records[id];
      const permission = access(day, credential);
      callback(day, permission);
      canonical(day); // Validate atomically before saving or scheduling work.
    });
    rebuild(id);
    return snapshot(await store.read(id), credential);
  };
  return {
    async create(body) {
      checkFields(body, ['request']);
      const request = parseItinerary(body.request);
      const day = {
        id: randomUUID(), ownerToken: token(), inviteToken: token(), revision: 1, planRevision: 0,
        createdAt: new Date(now()).toISOString(), updatedAt: new Date(now()).toISOString(), expiresAt: now() + 7 * 86400000,
        brief: request, members: request.people.map(person => ({ ...person, id: person.id || randomUUID(), editToken: token(), joined: false, updatedAt: new Date(now()).toISOString() })),
        plan: null, planError: null, events: [],
      };
      await store.transact(records => { records[day.id] = day; });
      rebuild(day.id);
      return { ...snapshot(day, day.ownerToken), token: day.ownerToken };
    },
    async get(id, credential) { const day = await store.read(id); const result = snapshot(day, credential); if (result.status === 'updating') rebuild(id); return result; },
    async add(id, credential, body) {
      const person = profile(body);
      return change(id, credential, (day, permission) => {
        requireOwner(permission);
        if (day.members.some(p => p.id === person.id)) throw new InputError('This person is already in the day.');
        if (day.members.length >= 6) throw new InputError('This day already has six taste profiles.');
        day.members.push({ ...person, editToken: token(), joined: false, updatedAt: new Date(now()).toISOString() });
        if (day.members.length > day.brief.party.adults + day.brief.party.children) day.brief.party.adults++;
        event(day, 'person_added', person.name, `${person.name} joined the lineup. Rebalancing the day for everyone.`, now);
      });
    },
    async circle(id, credential, body) {
      checkFields(body, ['people', 'name']);
      if (!Array.isArray(body.people) || !body.people.length || body.people.length > 6 || typeof body.name !== 'string' || !body.name.trim() || body.name.length > 40) throw new InputError('Choose a named circle with one to six people.');
      const people = body.people.map(p => profile(p));
      if (new Set(people.map(p => p.id)).size !== people.length) throw new InputError('Each circle member must be unique.');
      return change(id, credential, (day, permission) => {
        requireOwner(permission);
        const additions = people.filter(p => !day.members.some(m => m.id === p.id));
        if (day.members.length + additions.length > 6) throw new InputError('A day can hold up to six taste profiles. Remove someone before bringing this circle.');
        if (!additions.length) return;
        day.members.push(...additions.map(p => ({ ...p, editToken: token(), joined: false, updatedAt: new Date(now()).toISOString() })));
        day.brief.party.adults = Math.max(day.brief.party.adults, day.members.length - day.brief.party.children);
        event(day, 'circle_added', body.name.trim(), `${body.name.trim()} is coming. Finding the shared threads for ${day.members.length} people.`, now);
      });
    },
    async join(id, credential, body) {
      checkFields(body, ['name', 'artists', 'vibes', 'spending']);
      const person = profile(body);
      const memberToken = token();
      await change(id, credential, (day, permission) => {
        if (permission.role !== 'guest') throw new InputError('You already have a place in this day. Edit your own tastes instead.');
        if (day.members.length >= 6) throw new InputError('This day already has six taste profiles. Ask the organizer for your personal link.');
        day.members.push({ ...person, editToken: memberToken, joined: true, updatedAt: new Date(now()).toISOString() });
        if (day.members.length > day.brief.party.adults + day.brief.party.children) day.brief.party.adults++;
        event(day, 'person_joined', person.name, `${person.name} joined. Their tastes now shape the same day.`, now);
      });
      return { ...snapshot(await store.read(id), memberToken), token: memberToken };
    },
    async updatePerson(id, credential, personId, body) {
      const person = profile(body, personId);
      return change(id, credential, (day, permission) => {
        if (permission.role !== 'owner' && permission.memberId !== personId) throw fail('You can only update your own tastes.', 403, 'day_forbidden');
        const member = day.members.find(p => p.id === personId);
        if (!member) throw fail('This person is no longer part of the day.');
        const changed = JSON.stringify([member.name, member.artists, member.vibes,member.spending]) !== JSON.stringify([person.name, person.artists, person.vibes,person.spending]);
        Object.assign(member, person, { joined: member.joined || permission.role === 'member', updatedAt: new Date(now()).toISOString() });
        if (changed) event(day, 'taste_changed', person.name, `${person.name} updated their tastes. Checking what fits the group now.`, now);
      });
    },
    async remove(id, credential, personId) {
      return change(id, credential, (day, permission) => {
        requireOwner(permission);
        if (day.members.length === 1 || day.members[0].id === personId) throw new InputError('Keep the organizer in this day.');
        const person = day.members.find(p => p.id === personId);
        if (!person) throw fail('This person is no longer part of the day.');
        day.members = day.members.filter(p => p.id !== personId);
        day.brief.party.adults = Math.max(1, day.brief.party.adults - 1);
        event(day, 'person_removed', person.name, `${person.name} left the lineup. Updating the group balance.`, now);
      });
    },
    async updateBrief(id, credential, body) {
      checkFields(body, ['request', 'revision']);
      const requested = parseItinerary(body.request);
      return change(id, credential, (day, permission) => {
        requireOwner(permission);
        if (body.revision !== day.revision) throw fail('The group changed while you were editing. Your changes are still here; review the latest group and retry.', 409, 'day_conflict');
        // Only trip details change here; individual tastes can never be overwritten by a stale brief/model.
        day.brief = { ...requested, people: canonical(day).people };
        event(day, 'brief_changed', 'Organizer', 'The trip details changed. Updating everyone’s day.', now);
      });
    },
    async autopilot(id,credential,body) {
      checkFields(body,['request','revision']);
      const requested=parseItinerary(body.request);
      return change(id,credential,(day,permission)=>{
        requireOwner(permission);
        if(body.revision!==day.revision)throw fail('The group changed while Autopilot was working. Try again with everyone’s latest tastes.',409,'day_conflict');
        if(day.members.some(member=>!requested.people.some(p=>p.id===member.id)))throw new InputError('Autopilot keeps everyone in this day. Remove people from the group first.');
        if(requested.people.some(p=>!p.id))throw new InputError('Autopilot participants need stable IDs.');
        // One revision and one rebuild. Existing personal links and join state survive.
        const members=requested.people.map(person=>({...day.members.find(m=>m.id===person.id),...person,editToken:day.members.find(m=>m.id===person.id)?.editToken||token(),joined:day.members.find(m=>m.id===person.id)?.joined||false,updatedAt:new Date(now()).toISOString()}));
        const organizer=day.members[0].id;
        day.members=[members.find(p=>p.id===organizer),...members.filter(p=>p.id!==organizer)];
        day.brief={...requested,people:day.members.map(({id,name,artists,vibes,spending})=>({id,name,artists,vibes,...(spending?{spending}:{})}))};
        event(day,'autopilot','Organizer','Autopilot combined the group, tastes and trip details. Finding everyone’s day.',now);
      });
    },
    async retry(id, credential) { return change(id, credential, (day, permission) => { if (permission.role === 'guest') throw fail('Join this day first.', 403, 'day_forbidden'); day.planError = null; }); },
    // For shutdown/test coordination; network work is never held inside a storage transaction.
    settled: async id => { while (building.has(id)) await building.get(id); },
  };
}
