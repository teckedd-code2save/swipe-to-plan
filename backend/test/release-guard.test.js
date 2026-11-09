import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const next=`ghcr.io/teckedd-code2save/unstressed:${'a'.repeat(40)}`,previous=`ghcr.io/teckedd-code2save/unstressed:${'b'.repeat(40)}`;
async function release(t,scenario,labels={}){
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
   'image inspect')
    if [[ "$*" == *io.unstressed.plan-invitations* ]]; then
      if [[ "$3" == "$NEXT" ]]; then label="$NEXT_PROTOCOL"; else label="$PREVIOUS_PROTOCOL"; fi
      [[ "$label" != ERROR ]] || exit 1
      if [[ -f "$ROOT/running" && "$SCENARIO" == rollback_label_error ]]; then exit 1; fi
      echo "$label"
    elif [[ "$*" == *--format* && "$SCENARIO" == shutdown_aware ]]; then echo 1; fi;;
   'ps -a') if [[ -f "$ROOT/running" && "$SCENARIO" == rollback_lookup_error ]]; then exit 1; fi; if [[ -f "$ROOT/running" && "$SCENARIO" == rollback_absent ]]; then exit 0; fi; [[ "$SCENARIO" != discovery_fail ]] || exit 1; if [[ "$SCENARIO" != first_install ]]; then echo unstressed-web; fi;;
   'inspect unstressed-web') [[ "$SCENARIO" != inspect_fail ]] || exit 1; if [[ "$*" == *--format* ]]; then echo "$PREVIOUS"; fi;;
   'stop --time')
     count=$(cat "$ROOT/stops" 2>/dev/null || echo 0); count=$((count+1)); if [[ "$SCENARIO" == stop_fail || "$SCENARIO" == rollback_stop_fail && "$count" == 2 ]]; then exit 1; fi; echo "$count" > "$ROOT/stops"
     if [[ "$SCENARIO" == shutdown* && "$count" == 1 || "$SCENARIO" == rollback_intent && "$count" == 2 ]]; then echo '{}' > "$ROOT/data/accounts.json.intent"; fi;;
   'run -d') if [[ "$SCENARIO" == probe_changed_after_check ]]; then echo changed > "$ROOT/probe-account-filesystem.js"; fi;;
   'run --rm') if [[ "$*" == *src/invitation-epoch.js* ]]; then
     [[ "$SCENARIO" != epoch_fail && "$SCENARIO" != rollback_epoch_fail || "$*" != *' rotate' ]] || exit 1
     [[ "$SCENARIO" != epoch_ensure_fail ]] || exit 1
     echo epoch >> "$ROOT/epoch-actions"
     exit 0
    fi; cat > "$ROOT/probe-stdin"; [[ "$SCENARIO" != probe_fail ]] || exit 1;;
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
 const child=spawnSync('bash',[join(dir,'release.sh'),next],{encoding:'utf8',env:{...process.env,PATH:`${join(dir,'bin')}:${process.env.PATH}`,ROOT:dir,SCENARIO:scenario,PREVIOUS:scenario==='rollback_digest'?`ghcr.io/teckedd-code2save/unstressed@sha256:${'c'.repeat(64)}`:previous,NEXT:next,NEXT_PROTOCOL:labels.next??'',PREVIOUS_PROTOCOL:labels.previous??''}});return {...child,events:await fs.readFile(join(dir,'events'),'utf8'),dir};
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


for(const missing of ['', '<no value>'])test('manual legacy downgrade rotates invitation epoch before legacy writer starts',async t=>{
 const r=await release(t,'normal',{previous:'1',next:missing});assert.equal(r.status,0,r.stderr);
 const helper=r.events.split('\n').find(x=>x.includes('src/invitation-epoch.js rotate'));assert.ok(helper);assert.ok(helper.includes(previous));
 assert.ok(r.events.indexOf('docker stop')<r.events.indexOf('tar -czf'));
 assert.ok(r.events.indexOf('tar -czf')<r.events.indexOf(helper));assert.ok(r.events.indexOf(helper)<r.events.indexOf('docker compose'));
 assert.equal(await fs.readFile(join(r.dir,'data','accounts.json'),'utf8'),'{}');
});
for(const labels of [{previous:'ERROR',next:'1'},{previous:'1',next:'ERROR'},{previous:'2',next:'1'},{previous:'1',next:'garbage'}])test('invitation protocol unknown or failed inspection blocks before cutover',async t=>{
 const r=await release(t,'normal',labels);assert.equal(r.status,1);assert.match(r.stderr,/invitation protocol/i);assert.doesNotMatch(r.events,/docker (stop|start|compose|run)|tar -czf/);
});
for(const labels of [{previous:'',next:'1'},{previous:'1',next:'1'}])test('invitation-aware upgrade ensures epoch after backup with restricted exact image',async t=>{
 const r=await release(t,'normal',labels);assert.equal(r.status,0,r.stderr);
 const helper=r.events.split('\n').find(x=>x.includes('src/invitation-epoch.js ensure'));assert.ok(helper);
 assert.ok(helper.includes(next));assert.match(helper,/--network none --user node/);assert.match(helper,/--read-only --cap-drop ALL --security-opt no-new-privileges:true --no-healthcheck/);assert.match(helper,/--memory 64m --pids-limit 32 --mount type=bind/);assert.doesNotMatch(helper,/--env-file| -p |--privileged/);
 assert.ok(r.events.indexOf('docker stop')<r.events.indexOf('tar -czf'));assert.ok(r.events.indexOf('tar -czf')<r.events.indexOf(helper));assert.ok(r.events.indexOf(helper)<r.events.indexOf('docker compose'));
});
test('failed first invitation-aware cutover rotates epoch before ordinary legacy rollback',async t=>{
 const r=await release(t,'rollback_safe',{next:'1'});assert.equal(r.status,1);
 const rotation=r.events.indexOf('src/invitation-epoch.js rotate');assert.ok(rotation>r.events.lastIndexOf('docker stop'));assert.ok(rotation<r.events.lastIndexOf('docker compose'));
 assert.equal((r.events.match(/docker stop/g)||[]).length,2);assert.equal((r.events.match(/docker compose/g)||[]).length,2);assert.doesNotMatch(r.events,/docker start/);
});
test('compatible invitation-aware rollback preserves existing epoch without rotation',async t=>{
 const r=await release(t,'rollback_safe',{next:'1',previous:'1'});assert.equal(r.status,1);assert.equal((r.events.match(/docker compose/g)||[]).length,2);assert.doesNotMatch(r.events,/invitation-epoch.js rotate/);assert.equal((r.events.match(/invitation-epoch.js ensure/g)||[]).length,2);
});
test('rollback label inspection error leaves failed writer stopped',async t=>{
 const r=await release(t,'rollback_label_error',{next:'1',previous:'1'});assert.equal(r.status,1);assert.match(r.stderr,/invitation protocol/i);assert.equal((r.events.match(/docker stop/g)||[]).length,2);assert.equal((r.events.match(/docker compose/g)||[]).length,1);
});
test('backup failure before invitation-aware cutover may resume original legacy writer',async t=>{
 const r=await release(t,'backup_fail',{next:'1'});assert.equal(r.status,1);assert.match(r.events,/docker start unstressed-web/);assert.doesNotMatch(r.events,/docker compose|invitation-epoch.js/);
});
for(const [scenario,labels,composes] of [['epoch_fail',{previous:'1'},0],['epoch_ensure_fail',{next:'1'},0],['rollback_epoch_fail',{next:'1'},1]])test(scenario+' leaves writer stopped without unsafe fallback',async t=>{
 const r=await release(t,scenario,labels);assert.equal(r.status,1);assert.match(r.stderr,/epoch preparation failed/);assert.equal((r.events.match(/docker compose/g)||[]).length,composes);assert.doesNotMatch(r.events,/docker start/);await assert.rejects(fs.access(join(r.dir,'current-image.txt')));
});
test('legacy-to-legacy release does not alter invitation sidecar',async t=>{
 const r=await release(t,'normal');assert.equal(r.status,0);assert.doesNotMatch(r.events,/invitation-epoch.js/);await assert.rejects(fs.access(join(r.dir,'epoch-actions')));
});
test('first aware installation ensures epoch without inventing previous writer',async t=>{
 const r=await release(t,'first_install',{next:'1'});assert.equal(r.status,0,r.stderr);assert.doesNotMatch(r.events,/docker (stop|start)/);assert.match(r.events,/invitation-epoch.js ensure/);assert.doesNotMatch(r.events,/invitation-epoch.js rotate/);
});
test('failed aware container confirmed absent still invalidates grants before legacy fallback',async t=>{
 const r=await release(t,'rollback_absent',{next:'1'});assert.equal(r.status,1);assert.equal((r.events.match(/docker stop/g)||[]).length,1);assert.equal((r.events.match(/docker compose/g)||[]).length,2);assert.ok(r.events.indexOf('invitation-epoch.js rotate')<r.events.lastIndexOf('docker compose'));
});
test('failed quiescence prevents epoch rotation and legacy fallback',async t=>{
 const r=await release(t,'rollback_stop_fail',{next:'1'});assert.equal(r.status,1);assert.equal((r.events.match(/docker compose/g)||[]).length,1);assert.doesNotMatch(r.events,/invitation-epoch.js rotate/);
});


test('initial native release explicitly overrides runtime flags in production and preflight candidate',async()=>{
 const compose=await fs.readFile(new URL('../../compose.yml',import.meta.url),'utf8');
 const script=await fs.readFile(new URL('../../deploy/release.sh',import.meta.url),'utf8');
 assert.match(compose,/    env_file:\n      - \/opt\/unstressed\/.env/);
 assert.match(compose,/    environment:\n      NATIVE_AUTH_ENABLED: "false"\n/);
 assert.doesNotMatch(compose,/NATIVE_AUTH_ENABLED:.*\$\{/,'Do not inherit or interpolate an unknown runtime flag.');
 const candidate=script.slice(script.indexOf('docker run -d --name "$candidate"'),script.indexOf('healthy()'));
 assert.match(candidate,/--env-file \.env -e NATIVE_AUTH_ENABLED=false/);
 assert.doesNotMatch(compose,/GOOGLE_OAUTH_CLIENT_(?:ID|SECRET):/,'Existing Google web auth configuration remains untouched.');
});
