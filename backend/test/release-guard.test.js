import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const next=`ghcr.io/teckedd-code2save/unstressed:${'a'.repeat(40)}`,previous=`ghcr.io/teckedd-code2save/unstressed:${'b'.repeat(40)}`;
async function release(t,scenario){
 const dir=await fs.mkdtemp(join(tmpdir(),'release-guard-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));await fs.mkdir(join(dir,'data'));await fs.mkdir(join(dir,'bin'));await fs.writeFile(join(dir,'.env'),'placeholder');await fs.writeFile(join(dir,'data','accounts.json'),'{}');
 if(scenario==='preflight')await fs.symlink('missing',join(dir,'data','accounts.json.intent'));
 const script=(await fs.readFile(new URL('../../deploy/release.sh',import.meta.url),'utf8')).replaceAll('/opt/unstressed',dir);await fs.writeFile(join(dir,'release.sh'),script);
 const probe=await fs.readFile(new URL('../src/probe-account-filesystem.js',import.meta.url),'utf8');if(scenario!=='probe_missing')await fs.writeFile(join(dir,'probe-account-filesystem.js'),scenario==='probe_corrupt'?'untrusted':probe);
 const mock=`#!/usr/bin/env bash
set -eu
name=$(basename "$0")
echo "$name $* image=\${UNSTRESSED_IMAGE:-}" >> "$ROOT/events"
case "$name" in
 docker)
  case "$1 $2" in
   'image inspect') if [[ "$*" == *--format* && "$SCENARIO" == shutdown_aware ]]; then echo 1; fi;;
   'ps -a') if [[ -f "$ROOT/running" && "$SCENARIO" == rollback_lookup_error ]]; then exit 1; fi; if [[ -f "$ROOT/running" && "$SCENARIO" == rollback_absent ]]; then exit 0; fi; [[ "$SCENARIO" != discovery_fail ]] || exit 1; if [[ "$SCENARIO" != first_install ]]; then echo unstressed-web; fi;;
   'inspect unstressed-web') [[ "$SCENARIO" != inspect_fail ]] || exit 1; if [[ "$*" == *--format* ]]; then echo "$PREVIOUS"; fi;;
   'stop --time')
     count=$(cat "$ROOT/stops" 2>/dev/null || echo 0); count=$((count+1)); if [[ "$SCENARIO" == stop_fail || "$SCENARIO" == rollback_stop_fail && "$count" == 2 ]]; then exit 1; fi; echo "$count" > "$ROOT/stops"
     if [[ "$SCENARIO" == shutdown* && "$count" == 1 || "$SCENARIO" == rollback_intent && "$count" == 2 ]]; then echo '{}' > "$ROOT/data/accounts.json.intent"; fi;;
   'run -d') if [[ "$SCENARIO" == probe_changed_after_check ]]; then echo changed > "$ROOT/probe-account-filesystem.js"; fi;;
   'run --rm') cat > "$ROOT/probe-stdin"; [[ "$SCENARIO" != probe_fail ]] || exit 1;;
   'compose -f') echo "$UNSTRESSED_IMAGE" > "$ROOT/running";;
  esac;;
 curl) if [[ "$*" == *13001* && "$SCENARIO" == candidate_fail ]]; then exit 1; fi
   if [[ "$*" == *13000* && "$SCENARIO" == rollback* && "$(cat "$ROOT/running")" == "$NEXT" ]]; then exit 1; fi;;
 tar) if [[ "$SCENARIO" == backup_fail ]]; then exit 1; fi; /bin/tar "$@";;
 find) [[ "$SCENARIO" != find_fail ]] || exit 1; /usr/bin/find "$@";;
 ss|sleep) :;;
esac
`;
 for(const name of ['docker','curl','tar','ss','sleep','find']){await fs.writeFile(join(dir,'bin',name),mock,{mode:0o755});}
 const child=spawnSync('bash',[join(dir,'release.sh'),next],{encoding:'utf8',env:{...process.env,PATH:`${join(dir,'bin')}:${process.env.PATH}`,ROOT:dir,SCENARIO:scenario,PREVIOUS:scenario==='rollback_digest'?`ghcr.io/teckedd-code2save/unstressed@sha256:${'c'.repeat(64)}`:previous,NEXT:next}});return {...child,events:await fs.readFile(join(dir,'events'),'utf8'),dir};
}
test('release preflight preserves live writer when pending intent is a dangling symlink',async t=>{const r=await release(t,'preflight');assert.equal(r.status,1);assert.doesNotMatch(r.events,/docker (stop|compose|start|run)/);assert.match(r.stdout,/live service untouched/);});
test('candidate failure preserves live writer and candidate storage isolation',async t=>{const r=await release(t,'candidate_fail');assert.equal(r.status,1);assert.doesNotMatch(r.events,/docker (stop|compose|start)/);assert.match(r.events,/--tmpfs \/data:size=16m/);assert.doesNotMatch(r.events,/--volume| -v /);});
test('normal cutover stops writer before backup and replacement',async t=>{const r=await release(t,'normal');assert.equal(r.status,0,r.stderr);assert.ok(r.events.indexOf('docker stop')<r.events.indexOf('tar -czf'));assert.ok(r.events.indexOf('tar -czf')<r.events.indexOf('docker compose'));assert.equal(await fs.readFile(join(r.dir,'current-image.txt'),'utf8'),`${next}\n`);});
test('intent appearing at shutdown blocks legacy restart and any replacement',async t=>{const r=await release(t,'shutdown_legacy');assert.equal(r.status,1);assert.doesNotMatch(r.events,/docker (compose|start)|tar -czf/);assert.match(r.stderr,/Original writer left stopped/);});
test('intent appearing at shutdown may resume only the same protocol-aware writer',async t=>{const r=await release(t,'shutdown_aware');assert.equal(r.status,1);assert.match(r.events,/docker start unstressed-web/);assert.doesNotMatch(r.events,/docker compose|tar -czf/);});
test('backup failure restores same original writer without cutover',async t=>{const r=await release(t,'backup_fail');assert.equal(r.status,1);assert.match(r.events,/docker start unstressed-web/);assert.doesNotMatch(r.events,/docker compose/);});
test('failed-new-image shutdown intent blocks rollback',async t=>{const r=await release(t,'rollback_intent');assert.equal(r.status,1);assert.match(r.stderr,/Rollback blocked/);assert.equal((r.events.match(/docker stop/g)||[]).length,2);assert.equal((r.events.match(/docker compose/g)||[]).length,1);});
test('failed image without intent is quiesced before rollback',async t=>{const r=await release(t,'rollback_safe');assert.equal(r.status,1);assert.equal((r.events.match(/docker compose/g)||[]).length,2);const rollback=r.events.lastIndexOf('docker compose');assert.ok(r.events.lastIndexOf('docker stop')<rollback);assert.match(r.events.slice(rollback),new RegExp(`image=${previous}`));});

test('Docker inspection failure never proceeds with unknown live writer',async t=>{const r=await release(t,'inspect_fail');assert.equal(r.status,1);assert.doesNotMatch(r.events,/docker (stop|start|compose|run)/);assert.match(r.stdout,/Cannot inspect live writer/);});
test('intent inspection error fails closed with live writer untouched',async t=>{const r=await release(t,'find_fail');assert.equal(r.status,1);assert.doesNotMatch(r.events,/docker (stop|start|compose|run)/);assert.match(r.stderr,/Cannot inspect account/);});
test('failed initial stop blocks backup and replacement',async t=>{const r=await release(t,'stop_fail');assert.equal(r.status,1);assert.doesNotMatch(r.events,/docker (start|compose)|tar -czf/);});
test('failed new-writer stop blocks rollback rather than assuming absence',async t=>{const r=await release(t,'rollback_stop_fail');assert.equal(r.status,1);assert.equal((r.events.match(/docker compose/g)||[]).length,1);assert.match(r.stderr,/Cannot quiesce failed writer/);});

test('Docker discovery failure leaves live writer untouched',async t=>{const r=await release(t,'discovery_fail');assert.equal(r.status,1);assert.doesNotMatch(r.events,/docker (stop|start|compose|run)/);assert.match(r.stdout,/Cannot determine live writer/);});
test('confirmed first install backs up before starting and does not invent a previous writer',async t=>{const r=await release(t,'first_install');assert.equal(r.status,0,r.stderr);assert.doesNotMatch(r.events,/docker (stop|start)/);assert.ok(r.events.indexOf('tar -czf')<r.events.indexOf('docker compose'));});

test('failed release safely preserves an existing immutable digest rollback',async t=>{const r=await release(t,'rollback_digest');assert.equal(r.status,1);assert.equal((r.events.match(/docker compose/g)||[]).length,2);assert.match(r.events.slice(r.events.lastIndexOf('docker compose')),/image=ghcr.io\/teckedd-code2save\/unstressed@sha256:c{64}/);});

test('confirmed failed-container absence permits safe rollback without a fictitious stop',async t=>{const r=await release(t,'rollback_absent');assert.equal(r.status,1);assert.equal((r.events.match(/docker compose/g)||[]).length,2);assert.equal((r.events.match(/docker stop/g)||[]).length,1);});
test('failed-container discovery error blocks rollback',async t=>{const r=await release(t,'rollback_lookup_error');assert.equal(r.status,1);assert.equal((r.events.match(/docker compose/g)||[]).length,1);assert.match(r.stderr,/Cannot determine failed writer state/);});

test('runtime filesystem probe uses exact image and restricted real-volume namespace before stopping writer',async t=>{const r=await release(t,'normal');assert.equal(r.status,0,r.stderr);const line=r.events.split('\n').find(x=>x.startsWith('docker run --rm'));assert.ok(line);assert.match(line,/--network none --user node/);assert.match(line,/--read-only --cap-drop ALL --security-opt no-new-privileges:true --no-healthcheck/);assert.match(line,/--mount type=bind,src=.*\/data,dst=\/data/);assert.ok(line.includes(`--entrypoint node ${next} --input-type=module -`));assert.doesNotMatch(line,/--env-file| -p |--privileged|--env /);assert.ok(r.events.indexOf(line)<r.events.indexOf('docker stop'));});
test('unsupported runtime filesystem aborts before any live stop or backup and cleans probe container',async t=>{const r=await release(t,'probe_fail');assert.equal(r.status,1);assert.doesNotMatch(r.events,/docker (stop|start|compose)|tar -czf/);assert.match(r.stderr,/probe failed; live service untouched/);assert.match(r.events,/docker rm -f unstressed-candidate-[a-f0-9]+ unstressed-fsync-probe-/);});

test('legacy target without probe module executes trusted captured source through stdin',async t=>{const r=await release(t,'legacy_probe_absent');assert.equal(r.status,0,r.stderr);assert.equal(await fs.readFile(join(r.dir,'probe-stdin'),'utf8'),await fs.readFile(new URL('../src/probe-account-filesystem.js',import.meta.url),'utf8'));const line=r.events.split('\n').find(x=>x.startsWith('docker run --rm'));assert.match(line,/--interactive/);assert.doesNotMatch(line,/src\/probe-account-filesystem.js/);});
for(const scenario of ['probe_missing','probe_corrupt'])test(`${scenario} aborts before live changes or candidate launch`,async t=>{const r=await release(t,scenario);assert.equal(r.status,1);assert.doesNotMatch(r.events,/docker (stop|start|compose|run)|tar -czf/);assert.match(r.stderr,/live service untouched/);});
test('guard pins exact trusted probe bytes and deploy workflow transfers the source with current script',async()=>{const script=await fs.readFile(new URL('../../deploy/release.sh',import.meta.url),'utf8'),probe=await fs.readFile(new URL('../src/probe-account-filesystem.js',import.meta.url));assert.match(script,new RegExp(`probe_sha256=${createHash('sha256').update(probe).digest('hex')}`));const workflow=await fs.readFile(new URL('../../.github/workflows/deploy.yml',import.meta.url),'utf8');assert.match(workflow,/scp[^\n]+compose.yml deploy\/release.sh backend\/src\/probe-account-filesystem.js/);assert.ok(workflow.indexOf('backend/src/probe-account-filesystem.js')<workflow.indexOf('bash /opt/unstressed/release.sh'));});

test('probe executes captured verified bytes even if a subsequent transfer changes source path',async t=>{const r=await release(t,'probe_changed_after_check');assert.equal(r.status,0,r.stderr);assert.equal(await fs.readFile(join(r.dir,'probe-account-filesystem.js'),'utf8'),'changed\n');assert.equal(await fs.readFile(join(r.dir,'probe-stdin'),'utf8'),await fs.readFile(new URL('../src/probe-account-filesystem.js',import.meta.url),'utf8'));});
