import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const script=new URL('../../deploy/smoke-invitation-epoch.sh',import.meta.url),imageId=`sha256:${'a'.repeat(64)}`;
async function smoke(t,scenario='pass'){
 const dir=await fs.mkdtemp(join(tmpdir(),'image-smoke-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));await fs.mkdir(join(dir,'bin'));
 const mock=`#!/usr/bin/env bash
set -eu
printf '%s\\n' "$*" >> "$ROOT/events"
case "$1" in
 image)
  [[ "$SCENARIO" != inspect_fail ]] || exit 1
  case "$*" in
   *'.Id'*) if [[ "$SCENARIO" == invalid_id ]]; then echo bad; else echo "$EXACT_ID"; fi;;
   *'plan-invitations'*) if [[ "$SCENARIO" == bad_label ]]; then echo 0; else echo 1; fi;;
   *'.Config.User'*) if [[ "$SCENARIO" == root_user ]]; then echo root; else echo node; fi;;
  esac;;
 run) cat > "$ROOT/input.mjs"; [[ "$SCENARIO" != run_fail ]] || exit 1;;
 rm) :;;
 *) exit 1;;
esac
`;
 await fs.writeFile(join(dir,'bin','docker'),mock,{mode:0o755});if(scenario==='timeout')await fs.writeFile(join(dir,'bin','timeout'),'#!/usr/bin/env bash\nset -eu\n[[ "$1" == --kill-after=5s && "$2" == 45s ]] || exit 2\nshift 2\n"$@"\nexit 124\n',{mode:0o755});const result=spawnSync('bash',[script.pathname,'unstressed-check'],{encoding:'utf8',env:{...process.env,PATH:`${join(dir,'bin')}:${process.env.PATH}`,ROOT:dir,EXACT_ID:imageId,SCENARIO:scenario}});
 return {...result,dir,events:await fs.readFile(join(dir,'events'),'utf8').catch(()=>''),source:await fs.readFile(join(dir,'input.mjs'),'utf8').catch(()=>'')};
}
test('built-image smoke pins runtime identity and allows only disposable tmpfs data',async t=>{
 const r=await smoke(t);assert.equal(r.status,0,r.stderr);const run=r.events.split('\n').find(line=>line.startsWith('run '));assert.ok(run);assert.ok(run.includes(`--entrypoint node ${imageId} --input-type=module -`));assert.match(run,/--pull never/);assert.match(run,/--network none --user node/);assert.match(run,/--read-only --cap-drop ALL --security-opt no-new-privileges:true --no-healthcheck/);assert.match(run,/--tmpfs \/data:size=16m,uid=1000,gid=1000,mode=0700/);assert.match(run,/--memory 128m --pids-limit 64/);assert.doesNotMatch(run,/--mount|--volume| -v |--env| -e |--publish| -p |--privileged|--network host/);assert.match(r.events,/rm -f unstressed-invitation-smoke-/);assert.ok(r.events.indexOf('.Config.User')<r.events.indexOf('run '));
});
for(const scenario of ['inspect_fail','invalid_id','bad_label','root_user'])test(`${scenario} rejects smoke before starting a container`,async t=>{const r=await smoke(t,scenario);assert.notEqual(r.status,0);assert.doesNotMatch(r.events,/(^|\n)run /);});
test('runtime-helper failure propagates and container cleanup still runs',async t=>{const r=await smoke(t,'run_fail');assert.notEqual(r.status,0);assert.match(r.events,/rm -f unstressed-invitation-smoke-/);assert.doesNotMatch(r.stdout,/smoke passed/);});
test('simulated timeout after container start propagates status and cleans its named container',async t=>{const r=await smoke(t,'timeout');assert.equal(r.status,124);assert.match(r.events,/(^|\n)run /);assert.match(r.events,/rm -f unstressed-invitation-smoke-/);assert.doesNotMatch(r.stdout,/smoke passed/);});
test('embedded smoke invokes packaged CLI and checks ensure, rotate, runtime user and journal cleanup',async t=>{
 const r=await smoke(t);assert.equal(spawnSync(process.execPath,['--check','--input-type=module'],{input:r.source,encoding:'utf8'}).status,0);assert.match(r.source,/getuid\(\),1000/);assert.match(r.source,/execFileSync\(process.execPath,\['src\/invitation-epoch.js',operation\]/);assert.deepEqual([...r.source.matchAll(/run\('(ensure|rotate)'\)/g)].map(match=>match[1]),['ensure','ensure','rotate','ensure']);assert.match(r.source,/assert.equal\(await readInvitationEpoch\(file\),first\)/);assert.match(r.source,/assert.notEqual\(rotated,first\)/);assert.match(r.source,/0o600/);assert.match(r.source,/readdir\('\/data'\)/);assert.match(r.source,/validInvitationEpoch/);assert.doesNotMatch(r.source,/process.env|accounts\.json|fetch\(/);
});
test('CI and deployment run smoke on the built image before publish or release; Docker test stage includes needed fixtures',async()=>{
 const ignore=await fs.readFile(new URL('../../.dockerignore',import.meta.url),'utf8');assert.match(ignore,/!\.github\/workflows\/ci.yml/);
 const ci=await fs.readFile(new URL('../../.github/workflows/ci.yml',import.meta.url),'utf8'),deploy=await fs.readFile(new URL('../../.github/workflows/deploy.yml',import.meta.url),'utf8'),dockerfile=await fs.readFile(new URL('../../Dockerfile',import.meta.url),'utf8');
 assert.match(ci,/bash deploy\/smoke-invitation-epoch.sh unstressed-check/);assert.ok(ci.indexOf('docker build -t unstressed-check')<ci.indexOf('bash deploy/smoke-invitation-epoch.sh'));
 const smokeAt=deploy.indexOf('bash deploy/smoke-invitation-epoch.sh');assert.ok(smokeAt>deploy.indexOf('docker build --pull'));assert.ok(smokeAt<deploy.indexOf('docker/login-action@v3'));assert.ok(smokeAt<deploy.indexOf('docker push'));assert.ok(smokeAt<deploy.indexOf('Configure SSH'));assert.match(deploy,/bash deploy\/smoke-invitation-epoch.sh "ghcr.io\/teckedd-code2save\/unstressed:\$GITHUB_SHA"/);
 assert.match(dockerfile,/COPY deploy\/smoke-invitation-epoch.sh \/build\/deploy\/smoke-invitation-epoch.sh/);assert.match(dockerfile,/COPY \.github\/workflows\/ci.yml \/build\/\.github\/workflows\/ci.yml/);assert.match(dockerfile,/COPY Dockerfile \/build\/Dockerfile/);assert.match(dockerfile,/COPY \.dockerignore \/build\/\.dockerignore/);
});
