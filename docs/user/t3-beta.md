# Using Beta

Launch `/Applications/Beta.app`. Beta stores its own data under `~/.t3-beta` and uses a separate desktop identity. The upstream T3 Code apps use their original data. Quit the old custom T3 Beta app before opening Beta; they intentionally share the same Beta data and single-instance lock. Project folders themselves are shared: an agent working in an existing project can still change that project’s files.

The one-way Alpha import copies projects, chat history, attachments and provider settings through an online SQLite backup. It detaches provider continuations, pending approvals and client login sessions in the copy. An imported chat keeps its identity in Brain. The first time you use a provider in Beta, it establishes its own connection and pulls the shared history. The visible history stays available in Beta. Later Alpha activity does not sync automatically.

Beta opens with a pale pink interface. The first launch saves your previous appearance selection locally before applying it once. Later changes in **Settings → Appearance** persist.

## General chat and routing

Open **General chat** at the top of the sidebar. This is one durable conversation in a dedicated Beta workspace, available independently of your coding projects. Your existing model picker and shared Brain history work here. Ask ordinary questions, request web research, or ask to continue work in an existing Beta chat.

General consults the open-source [Laya decision model](https://github.com/NandhaKishorM/laya) locally. Laya selects a project and then an existing chat; your selected provider answers questions and uses Beta's browser tools. A confident handoff forwards the exact saved question, opens the destination and uses that chat's provider and permission mode. The question and handoff receipt remain in General. Returning to General does not replay old navigation. Follow-ups that need this conversation's context should stay here.

Laya is advisory: a selected-option probability of at least 0.75 is required at both selection stages. Uncertain, oversized or unavailable decisions stay in General. Large destination sets first separate ordinary chat and web requests from project work. Every project candidate is then considered in groups of at most 20 options, and the group winners are compared. An uncertain winning path or a 20-second selection timeout keeps the request here. Busy or archived destinations and questions with attachments or inline context cannot be handed off. Browser access depends on the selected provider and connected client; unavailable browser tools must be reported rather than claimed as a completed search. This feature routes between chats inside Beta; it does not control other Mac apps.

To prepare the local runtime once, from this Beta checkout run `node scripts/beta-laya-setup.mjs`. It uses an existing Python 3.11, creates an isolated environment under `~/.t3-beta/laya`, installs pinned Laya 0.4.11 and downloads its multilingual checkpoint. It does not install Python or alter provider credentials. Use `--python /path/to/python` or `--home-dir /path/to/beta-home` for another installed Python or an isolated Beta home. Opening General chat warms a scoped Laya child service on loopback port 8772, authenticated with a private local token; the child stops with that backend. Other chats do not load Laya into memory. Inference uses the installed checkpoint cache offline; downloads happen only during setup. The first General request may take longer while weights load. Ordinary General answers remain available if it fails.

## Share context between sessions

Open **Bus + Brain** in the sidebar. Choose the source and destination, enter a message, and queue the request. Review the exact text, then approve delivery or reject it. Approval appends an attributed message to the destination chat without starting its agent. Delivered context reaches that agent on its next explicit user turn.

Agents can discover sessions, read bounded history, check their inbox and relay context through `beta_sessions_list`, `beta_session_read`, `beta_session_inbox` and `beta_session_send`. Their sender identity comes from their authenticated session. Agent relays use the internal automatic-delivery policy and can wake the destination; the recorded actor identifies automatic approval. Human requests queued in the panel retain its review step. Requests and delivery receipts survive restart; **Retry delivery** reconciles a failed or uncertain append without adding it twice. This internal policy does not approve requests in the separate Brain agent mailbox.

## Change models within a chat

Choose another model in the composer at any point in the chat, including while a reply is running. The running reply finishes; your next message uses the chosen model in the same Brain session. A new provider establishes a connection once. Returning to a compatible provider resumes its saved connection rather than discarding it on each switch.

Conversation events continuously update the local Brain session store. Before each turn the selected provider pulls the shared context it has not seen. Messages, attachment references, plans and tool activity remain in that store. A model's context window is finite: the prompt reports omitted records, and `beta_session_memory` can search and page the retained history during a task. Native hidden reasoning and another provider's runtime state cannot be transferred between models.

If a native continuation expires and its adapter recovers with a different connection, Beta pulls the full available Brain context again while retaining the same conversation. A failed sync keeps the saved conversation and reports the error instead of silently switching with stale memory.

## Creative work with ARTsie

Open **ARTsie** in Beta’s sidebar to browse the 13 installed creative apps, import copies into Inbox, manage Projects and Exports, and inspect agent tools. The panel follows your Beta appearance settings. Native editors and Finder open on the machine hosting Beta, including when you access Beta remotely. Import pickers also appear on that host.

Start ARTsie.app on that machine before connecting. Beta reuses its running service and editing sessions; closing the panel leaves them running. PhotoCraft and FilmCraft support a separate visible agent window. Headless documents remain separate from ordinary desktop windows.

The panel does not configure provider MCP connections. Use ARTsie’s existing `config/mcp.json` in the provider client to enable editing tools for a chat. The provider controls model access and approvals; the panel itself does not send files to a model.

## Use the local Brain

The Brain tab searches your local knowledge and shows its source dates and collection/domain labels. Documents load in pages. A disconnected Brain produces an error in this panel and does not prevent ordinary chat.

Agents use the read-only `beta_brain_read` tool. The desktop backend reads the existing Brain token; it does not expose it to the renderer or models. The live session store is separate from indexed document snapshots and the agent mailbox. It lives locally under `~/.faheems-brain`; keep it with your Beta data backups. Fresh Brain MCP processes can discover and read it through `brain_session_list` and `brain_session_read`; an already running Brain MCP service needs a restart to load those new tools. Beta’s current-session `beta_session_memory` reads the same store directly and does not require that restart. Provider continuation bookmarks remain private to the backend.

The Brain agent mailbox addresses Claude, Codex or Grok rather than a specific session. Inbound requests are displayed verbatim and require your explicit decision. Approving records the decision; it does not execute the request. This mailbox is separate from Beta’s internal session bus.

## Recovery and updates

Quit and reopen Beta to recover persisted conversations and bus requests. A failed provider handoff reports the error so you can select a working provider. Upstream automatic desktop updates are disabled for this fork, preventing an upstream release from replacing the local changes.

The app is a local development build with an ad-hoc signature, not an official upstream release. Build provenance is stored beside it. It has focused persistence, approval, cancellation and handoff checks, but no software can guarantee that it will never fail. Keep backups of project files as well as the Beta data directory.
