# Account snapshot durability

## Scope and assumptions

`account-store.js` is a single-process, single-writer JSON snapshot store. It preserves the existing account schema and owner/session/share boundaries. It does not change the separate shared-day or metrics stores. It does not enable execution, provider calls, payments, or HTTP execution mutations.

The repository deploys Node 22 on Debian Linux (`Dockerfile`) with `/opt/unstressed/data:/data` (`compose.yml`), and documents one API process and a mode-700 directory (`DEPLOYMENT.md`). This implementation assumes a local filesystem with atomic same-directory rename and working file and directory fsync. The host filesystem, mount options and physical storage/controller durability have **not** been verified by this code-only change. Filesystems that reject directory fsync fail closed. Do not use network filesystems, replicas, or a second writer. A future live driver still needs runtime storage verification and its own reviewed durable idempotency/reconciliation design.

## Commit sequence

1. Serialize transactions. Clone the old account snapshot, expire sessions/flows on the clone, run a side-effect-free callback, and clone its result before writing anything.
2. Create missing private directories and fsync each created directory and the top created directory's parent.
3. Exclusively create a random mode-600 same-directory temporary file. Write the complete snapshot and fsync the file before closing.
4. Exclusively create a mode-600 `.intent` sidecar with only version, temp filename, old-file hash (or null for absence), and new-file hash. Write/fsync/close it, then fsync the directory. No account payload or secrets are duplicated in the intent.
5. Rename the temporary snapshot over the account file and fsync the containing directory. This is the data durability boundary.
6. Remove the intent and fsync the directory. Only now resolve the transaction promise. No follow-on side effect may run before successful resolution.

Read callbacks receive copies and cannot mutate the cached authoritative state. No callback is replayed by storage recovery. All existing callers remain unchanged except that account-saving ambiguity has a truthful status-503 `account_commit_unknown` message.

## Failure outcomes

- Before intent creation starts: target is unchanged. Owned temp cleanup is best effort; an orphan temp is never automatically promoted. The transaction rejects and later writes can proceed.
- From intent creation onward: conservatively reject with `account_commit_unknown` and block all queued/new transaction callbacks in this process. This includes rename returning an error and cleanup failing after the data is durable. Never roll back a renamed snapshot or claim it is definitely unsaved.
- Reads reload the target from disk after ambiguity, rather than retaining old authorization. When an intact intent exists, target bytes must match its old or new hash. Corrupt, unreadable, or unrecognized targets fail closed. A partial intent cannot have authorized rename in this protocol: valid target reads remain available, but writes and automatic reconciliation remain blocked.
- Startup notices a pending intent before admitting a write. It never promotes a temp file or reruns the original callback.
- An exit after durable intent removal but before the response reaches the caller is the normal lost-acknowledgement case: the snapshot is durable, but the caller cannot infer its own result. Generic account transactions are **not exactly-once request APIs**. Reopen/re-read state, do not blindly resubmit. Future consequential actions need persistent scoped request keys and independent business reconciliation; a storage acknowledgement alone is not provider authority.

## Deliberate operator reconciliation

There is no HTTP recovery endpoint or automatic startup repair. `createAccountStore({file}).reconcile()` is an internal operator API. Stop the application writer first and privately back up the account file, intent and referenced temporary file. Do not print or send their contents to public logs. Use the same deployed code/UID and the configured account file path, without loading or displaying the environment's other secrets. Never operate a recovery store concurrently with the running writer.

The API reads the current snapshot, requires it to match the intent's old/new hash, fsyncs that file (if present) and its directory, removes only the exact UUID-shaped referenced temp, removes the intent, and fsyncs the directory again. It returns only:

- `committed`: the new snapshot was selected and stabilized.
- `not_committed`: the old snapshot (including initial absence) was selected and stabilized.
- `current_snapshot`: no intent remains; the visible snapshot was stabilized. This is not proof that an arbitrary caller's request succeeded or failed.
- `memory_only`: no persistent file was configured.

Inspect the relevant saved day/session/action using its normal owner-scoped interface after recovery. Reconcile the business outcome separately before deliberately resubmitting anything. No original result or external action is produced by this API. A failure keeps evidence and does not authorize replay. Re-run only reconciliation after correcting a known transient filesystem issue.

Malformed/partial intents, mismatched target hashes, or invalid JSON intentionally require a reviewed operator recovery decision from private backups. The API will not guess, remove that evidence, or resurrect old privileges. Pre-intent orphan temp files may be privately inventoried and removed while the writer is stopped, only after establishing that they are not referenced by an active intent. There is no broad directory sweep. Account and sidecar files are private backup material.

## Verification limits

`backend/test/account-store.test.js` uses real temporary filesystem directories with injected write/fsync/rename/directory-sync/unlink errors. It covers errors before and after rename, restart detection, explicit reconciliation, no callback replay/follow-on effects, safe cleanup, first-file/nested-directory creation, private read isolation, and authorization invalidation. Child-process exits at durable intent, rename and durable commit exercise process restart. These are not destructive machine power-loss tests and cannot certify the host hardware's fsync contract. Existing account, privacy, execution-disabled, and application regressions must also pass before release.

## Release and rollback gate

Pre-durability images do not inspect `.intent` and must never be started against an unresolved intent. `deploy/release.sh` now checks for intent evidence before candidate launch (leaving live service untouched), gracefully stops the live writer after isolated candidate validation, rechecks for shutdown-time intents, and backs up only quiesced data. A shutdown-time marker aborts replacement. Only the same original image labeled `io.unstressed.account-durability=1` may be resumed in this case, with storage writes blocked. A legacy original remains stopped for operator recovery.

Failed-new-image rollback first stops that writer and checks again. A pending intent or inability to quiesce/inspect blocks rollback; the script never deletes recovery evidence. Backup failure resumes the original only after the same safety check. Candidate validation retains the isolated tmpfs data store. No production operation has been performed by this change. Deployment shell tests simulate races/errors using isolated command mocks, not the live Docker daemon. Runtime filesystem verification is still required before future live execution.

These protections apply only when using the updated guard-bearing release script. Do not rerun a pre-durability commit's deployment workflow or overwrite the host script with its old copy: that would bypass the guard. Roll back an old runtime image only through the current guarded script, after the recovery checks pass. This patch does not claim to protect manual Docker commands or a deliberately downgraded deployment tool.

An interrupted deployment can leave the service stopped. Before recovery, confirm no deployment remains active and inspect the actual container and image state; do not blindly restart from stale release metadata. With known state and no pending intent, rerun the current guarded release. With pending intent or uncertain state, preserve evidence and complete protocol-aware reconciliation before restarting. Keep exactly one writer. There is deliberately no unconditional EXIT restart after a partial cutover.
