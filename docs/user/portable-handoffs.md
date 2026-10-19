# Context in portable handoffs

T3 Code transfers conversation context when you switch providers, continue through a portable
restart, or use a fork that the provider cannot resume itself.

Short conversations transfer intact. For longer conversations, T3 Code favors recent requests and
answers, the original request, and relevant activity such as command outcomes. Selected messages
keep their full text, order, and user or assistant role, including partial work from failed or
interrupted turns. Your new request stays separate and is never shortened to make history fit.

Codex receives historical messages directly when its installed version supports that operation.
Other providers receive the same selection as attributed conversation context. A handoff does not
copy the outgoing provider's reasoning, tool-call state, or attachments.

The handoff includes references to omitted history. The agent can use T3 Code's thread-reading tool
to retrieve saved messages and activity, including the remainder of a long item. For an important
constraint, you can still repeat it in your next message. A handoff is a budgeted selection, not an
agent-written summary.

## Local Brain context in this fork

Switch models or providers from the composer without creating another chat. A running reply
finishes on its original model; the next turn uses your selection. Compatible provider conversations
resume through T3's private continuation records.

Alpha mirrors public messages, plans and tool activity into the local Brain at
`~/.faheems-brain/sessions.sqlite`, isolated by T3 environment and thread. On a switch, the next
model receives a bounded digest of recent messages and files plus relevant retrieved context.
The complete public artifact log remains available through `t3_brain_memory`; `t3_rag` retrieves
matching history. Provider continuations are excluded from this shared log.

Use `/rag <question>` for session keyword retrieval combined with Graphify, or `/graphify <question>`
for graph traversal. These are app commands and work with every provider. Agents can also use
`t3_brain_read` for the knowledge desk's read-only tools. Historical text remains data, not permission
to repeat commands or act on agent mailbox requests.

Graphify runs locally through `~/.graphify-venv/bin/graphify`. If the curated Brain graph at
`~/.faheems-brain/graph/brain-graph.json` exists, it is used. Otherwise Alpha creates a bounded graph
of the current session's latest 400 messages; its edges record message order, not inferred semantic
relationships. Missing Graphify, no matches and query failures are reported separately; session
retrieval remains available. No graph-building model or document upload runs automatically.

The server owns retrieval, so typed commands also work from mobile and remote clients. The web
and desktop slash menus offer both commands. Brain data stays on the server's machine; selected
context is sent to the provider you choose, like ordinary chat context. This fork's source changes
require rebuilding the app or server; installing the official upstream release does not include them.

## Context limits

A handoff must leave room for existing provider context, your request and attachments, instructions,
tools, and subsequent work. If even its retrieval references cannot fit, T3 Code reports an error
instead of shortening your request. Compact the target conversation or select a larger-context
model before trying again.

Server operators can set `T3CODE_CONTEXT_HANDOFF_TOKEN_CAP` to change the initial history allowance
(default 16,000; clamped to 1,024–64,000). This is an upper bound, not a provider context-window
guarantee. Text accounting conservatively charges one token per UTF-8 byte, including attribution
and JSON escaping. Imported history has a separate 64,000-byte ceiling; your current input and
attachment payloads do not consume that ceiling.

T3 Code uses available capacity information for your selected model and options, together with
provider context telemetry. Starting a fresh provider conversation clears prior usage, while keeping
known model capacity. Changing models or context-window options discards stale usage and compaction
thresholds.

When no capacity information is available, T3 Code assumes a 128,000-token window. It reserves at
least 16,000 tokens, or a quarter of the window when larger, for instructions, tools, and subsequent
work. Images reserve an estimated 8,192 tokens each, independent of their file size; other
attachments reserve 4,096 each for their references. Existing context is estimated from saved
activity when usage telemetry is unavailable. Known smaller windows still constrain the handoff.
These are fallback estimates, not exact token counts. Image resolution, custom models, and hidden
native context can differ, so the provider may still reject an input.
