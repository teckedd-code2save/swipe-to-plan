#!/usr/bin/env bash
# Execute only disposable data checks in the exact just-built runtime image.
set -Eeuo pipefail
image="${1:?Pass the local built image to smoke-check}"
image_id="$(docker image inspect "$image" --format '{{.Id}}')"
[[ "$image_id" =~ ^sha256:[a-f0-9]{64}$ ]] || { echo 'Cannot resolve the exact built image.' >&2; exit 1; }
protocol="$(docker image inspect "$image_id" --format '{{index .Config.Labels "io.unstressed.plan-invitations"}}')"
[[ "$protocol" == 1 ]] || { echo 'Built image has no supported invitation protocol label.' >&2; exit 1; }
runtime_user="$(docker image inspect "$image_id" --format '{{.Config.User}}')"
[[ "$runtime_user" == node ]] || { echo 'Built image must use the expected non-root runtime user.' >&2; exit 1; }
container="unstressed-invitation-smoke-$$-$RANDOM"
trap 'docker rm -f "$container" >/dev/null 2>&1 || true' EXIT
# No host path, named volume, credentials, env file, network or service ports.
# One tmpfs lives only for this container; child CLI runs share it for the test.
timeout --kill-after=5s 45s docker run --rm --pull never --interactive --name "$container" --network none --user "$runtime_user" --init \
  --read-only --cap-drop ALL --security-opt no-new-privileges:true --no-healthcheck \
  --memory 128m --pids-limit 64 --tmpfs /data:size=16m,uid=1000,gid=1000,mode=0700 \
  --entrypoint node "$image_id" --input-type=module - <<'JS'
import assert from 'node:assert/strict';
import {readFile,readdir,stat} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {readInvitationEpoch,validInvitationEpoch} from './src/invitation-epoch.js';
assert.equal(process.getuid(),1000,'Smoke must run as the actual non-root image user.');
assert.equal(process.cwd(),'/app/backend');
const file='/data/plan-invitation-epoch.json';
const run=operation=>execFileSync(process.execPath,['src/invitation-epoch.js',operation],{stdio:'pipe',timeout:10000});
assert.equal(await readInvitationEpoch(file),null);
run('ensure');
const first=await readInvitationEpoch(file);assert.ok(validInvitationEpoch(first));
assert.equal((await stat(file)).mode&0o777,0o600);
run('ensure');assert.equal(await readInvitationEpoch(file),first);
run('rotate');const rotated=await readInvitationEpoch(file);assert.ok(validInvitationEpoch(rotated));assert.notEqual(rotated,first);
run('ensure');assert.equal(await readInvitationEpoch(file),rotated);
assert.equal(JSON.parse(await readFile(file,'utf8')).planInvitationEpoch,rotated);
assert.deepEqual(await readdir('/data'),['plan-invitation-epoch.json'],'No pending intent or temporary journal file may remain.');
JS
printf 'Built-image invitation epoch smoke passed.\n'
