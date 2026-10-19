# Beta Brain continuity verification

Verified on 18 October 2026 on this Mac. This is a local development build, not an upstream release or a guarantee against future failures.

## Current artifact and activation

- Updated app: `/Applications/Beta.app`; provenance: `/Applications/Beta.build-provenance.json`.
- Source baseline: `719a76ca1dbf5490f1aa33ffb9966301e02be9a9`, with local changes.
- Identity `com.faheem.t3beta`; data `~/.t3-beta/userdata`; appearance and display name remain Beta.
- The final packaged server and client hashes match their built inputs. The final packaged backend was also launched directly with the retained Electron Node runtime against the same isolated QA home. The client includes the active-turn picker and model-change queue logic. The desktop bundle is the existing verified Beta identity build.
- Packaging retained 169 native/unpacked files unchanged and passed final-location deep strict signature verification. The previous owned artifact is recoverable at `/Applications/.Beta-build-backup-0GgDBY`.
- The running old custom app at `~/Applications/T3 Beta Local Build/T3 Beta.app` was left running. This conversation and other jobs use it. The new native GUI was not launched against that live data. Quit the old custom app after its jobs finish, then open `/Applications/Beta.app` to activate this update.

Alpha's application and original chat database were not replaced. The earlier one-way import copied 27 projects, 172 threads and 10,340 messages, with attachments and provider settings, while detaching provider continuations and client authentication in Beta's copy. Those are import-time counts, not current live inventory. Later Alpha activity does not sync.

## Executed live continuity checks

Tests used a separate temporary home, scratch Git project, and authenticated loopback browser on port 41174. No real Brain mailbox messages were sent or approved. The new shared Brain database was used, under a separate source/environment identity.

1. GPT-5.6-Sol remembered `BRAIN-LIVE-731` and returned `READY`. A fresh real Brain MCP CLI process found the exact event in `brain_session_read`, revision 17.
2. Stopped and restarted only the isolated test server. The same chat and first reply returned.
3. Codex remembered `BRAIN-RETURN-842` and completed a harmless 20-second sleep. Switched the same visible chat to Claude Sonnet 5.5. An initial attempt failed because the test server inherited an invalid API-key environment variable. Restarting that isolated server without the variable used the existing subscription login; no stored credentials were changed.
4. Claude recalled both markers and executed `beta_session_memory` during its turn. The actual provider completion receipt recorded `completed`, no tool error, one matching event, and read revision **71**. Its turn began with Brain revision 58, demonstrating a later context pull within that turn.
5. Returned to GPT-5.6-Sol. It recalled both markers and Claude's read revision 71. The original Codex native bookmark SHA-256 remained `82cbc5aa91525c786f1c0eeceeab4cf383bbfb98d40efe0f0f1a04b5cfff35e8`; the timeline reported the connection resumed.
6. Started a Codex turn with a harmless 25-second sleep. While it was running, the picker offered enabled Claude models and accepted Sonnet 5.5 without stopping Codex. Queued a follow-up for the selected provider. It remained queued through the active turn, then ran under Claude after `HELD TURN COMPLETE`. Claude recalled both markers and that latest Codex reply.
7. Claude's native conversation identity hash remained `fd671d4a1542216a` through all four observed turns, including the return from Codex. Its opaque bookmark payload may change as its native conversation advances; identity comparison uses the native conversation identifier rather than treating the entire payload as immutable.
8. After the active-turn round trip, Brain retained revision 148 and passed SQLite `quick_check`. Provider bookmarks were inspected privately and are excluded from the model-facing reader. The shared database, WAL and SHM files were verified mode 0600.

9. Launched the final packaged backend directly with the retained Electron Node runtime in the same isolated home. Claude recalled both markers and the held-turn result after restart. Switched back to Codex; the archived assistant reply at event 178 correctly returned both markers and `HELD TURN COMPLETE`. Brain reached revision 183, passed `quick_check`, and the original Codex bookmark still matched. The test browser tab had closed before the last screenshot, so that final response was verified from the retained event rather than claiming a final browser screenshot.

Scratch thread: `dd26465b-f5d9-47e1-b1a6-d2ed0934db3d`. Local QA evidence and isolated home are under `/var/folders/_p/w2nwxqhx36gdrl08tqwrp_qm0000gn/T/t3-brain-qa-8qfdjl9l`. This proves the built server/client workflow for these two installed providers; it does not establish every provider/model combination or activation in the still-running old native app.

## Executed source checks

- Server and web builds; web and server project TypeScript checks. The final server check initially found two fixtures missing a concurrently added OpenCode settings field; the fixtures were aligned with that required default, then typechecking passed and their 47 tests passed.
- 178 focused provider service, command reactor and session-bus tests, including repeated A → B → A → B cursor reuse, restart, failed sends, expiry recovery, rewind invalidation, and exact oversized-history paging.
- 14 queue and delivered-context formatting tests, including holding a selected-model change until turn completion and preserving automatic-relay actor attribution without falsely claiming human approval.
- 12 Brain transport tests and 5 Python shared-session reader tests. The Python tests cover read-only access, exact oversized-event pages, source isolation, private-bookmark exclusion and invalid paging.
- Scoped format/lint and `git diff --check` passed. Existing unrelated React lint warnings remain. No repository-wide suite was run.

The final server bundle was rebuilt at 17:37 after fixing its context receipt to stop before later messages excluded from a turn. The new regression verifies that a successful send leaves such context available for the next turn. The queue-enabled client is unchanged from the live active-turn check. Concurrent OpenCode provider-configuration changes in the shared checkout are included in the final server build; those provider combinations are outside this live validation.

Earlier Beta verification also covered the one-way import, desktop identity, updater isolation, pale pink appearance, manual session-bus review, cancellation and uncertain-delivery recovery. Those earlier checks are not a fresh live retest of every concurrent internal-bus change.

## Boundaries

Brain owns the local durable session event log and each provider's private continuation bookmark. The running provider receives unseen shared context before a turn and can pull retained history during it. Model input windows remain finite: an individual prompt is bounded and reports omitted candidate records; full archived events remain pageable. This does not transfer another provider's hidden reasoning or private tool execution state. Attachment references and saved event/tool metadata are retained; the store does not duplicate every external file's bytes.

Fresh Brain MCP CLI/stdio processes expose `brain_session_list` and `brain_session_read` over this same database and were verified live. The pre-existing HTTP Brain service was not restarted, so it still needs a restart to load that new catalog. Beta's `beta_session_memory` works directly against the shared store and was verified without that restart.

Imported history is archived lazily when used; new session events mirror continuously. The T3 event database remains a retryable outbox if a Brain write fails. Back up both Beta userdata and `~/.faheems-brain/sessions.sqlite` together. No physical power-loss test or comparative token, CPU-time, elapsed-task or peak-memory benchmark was performed. Resource bounds are not performance measurements.
