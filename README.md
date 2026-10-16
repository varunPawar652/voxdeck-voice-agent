# VoxDeck — The Voice-Powered Presentation Agent

A six-slide technical talk — **"How AI Agents Work: From LLMs to Autonomous Systems"** — presented live by an AI voice. Ask a question out loud; the presenter calls a real `navigate_to_slide` tool to jump to the right slide and explains it. Talk over it at any time and it stops, drops its stale state, and answers the new question.

Built on the **OpenAI Realtime API (GA)** over **browser WebRTC** — speech-to-speech, no separate STT/TTS pipeline.

---

## Quick start

```bash
# 1. Install (Node ≥ 20.19; npm workspaces)
npm install

# 2. Configure
cp .env.example .env
#    then set OPENAI_API_KEY=sk-...  (needs Realtime API access)

# 3. Run backend (:3001) and frontend (:5173) together
npm run dev
```

Open **http://localhost:5173** in Chrome, click **Start presenter**, allow the microphone, and ask a question.

| Command | What it does |
|---|---|
| `npm run dev` | Express server (tsx watch) + Vite dev server, `/api` proxied to `:3001` |
| `npm test` | Vitest — 100 unit/integration tests (no API key needed) |
| `npm run typecheck` | `tsc --noEmit` for `shared`, `server`, `client` |
| `npm run lint` | ESLint (typescript-eslint + react-hooks) |
| `npm run check` | typecheck + lint + test |
| `npm run build` | Production client build into `client/dist` |
| `npm run check:bundle` | Scans `client/dist` for anything resembling an OpenAI key (and the literal `.env` value) |
| `npm start` | Single-port production mode: Express serves the API **and** `client/dist` on `:3001` (set `CLIENT_ORIGIN=http://localhost:3001`) |

> **Headphones recommended for the demo.** Echo cancellation is on and noise reduction is `near_field`, but loud laptop speakers can still be picked up as "user speech" and interrupt the presenter.

### Environment variables

| Variable | Default | Notes |
|---|---|---|
| `OPENAI_API_KEY` | — | **Server only.** Never sent to the browser. If unset, the app loads and shows a clear error on connect. |
| `OPENAI_REALTIME_MODEL` | `gpt-realtime` | Any Realtime model, e.g. `gpt-realtime-2.1`, `gpt-realtime-mini`. |
| `OPENAI_REALTIME_VOICE` | `marin` | e.g. `cedar`, `alloy`. |
| `OPENAI_TRANSCRIPTION_MODEL` | `gpt-4o-mini-transcribe` | Live captions of the user's speech. |
| `PORT` | `3001` | Backend port. |
| `CLIENT_ORIGIN` | `http://localhost:5173` | The single origin allowed by CORS. |
| `CLIENT_SECRET_TTL_SECONDS` | `120` | Lifetime of the ephemeral credential (10–7200). |

---

## Architecture

```
 Browser (React)                                Express server                 OpenAI
 ───────────────                                ──────────────                 ──────
 Start presenter ──POST /api/realtime/session──▶ validate (Zod)
                                                 build session config ──POST /v1/realtime/client_secrets──▶
                  ◀── { clientSecret: ek_…, expiresAt } ◀───────────────────── ephemeral key (TTL 120s)
 getUserMedia (mic)
 RTCPeerConnection + "oai-events" data channel
 SDP offer ─────────────── POST /v1/realtime/calls (Bearer ek_…) ─────────────────────────────▶ Realtime session
            ◀──────────────────────────────── SDP answer ◀─────────────────────────────────────
 mic audio ═══════════════════════════════ WebRTC media ═══════════════════════════════════▶  semantic VAD
 speaker   ◀═══════════════════════════════ model voice ◀════════════════════════════════════  gpt-realtime
 PresenterController ◀──────────── server events (data channel) ◀──────────────────────────  response.done{function_call}
   ├─ validate args (Zod) → deck.goTo(n)   (React state = source of truth)
   └─ function_call_output + response.create ───────────────────────────────────────────────▶ continues speaking
```

**Session establishment:** ephemeral client secrets (one documented GA pattern, used end-to-end). The server bakes the *entire* session into the secret — instructions, the tool, VAD and barge-in, voice, transcription — so the browser can connect to that session but cannot widen it. The request body accepts only `{ currentSlide }` (`.strict()`), so a client can't smuggle in its own instructions or tools.

### Repository layout

```
shared/src/            single source of truth, imported by both sides
  presentation.ts      6 slides: id, number, title, summary, key concepts, example, speaker notes, keywords, diagram config
  schemas.ts           Zod: slide number, navigate_to_slide args, API request/response
  tools.ts             navigate_to_slide JSON-schema tool definition (test-asserted to match Zod)
  instructions.ts      compiles the deck + rules into the model's system prompt
server/src/
  config/env.ts        Zod-validated env; never echoes values
  services/realtimeSession.ts   buildSessionConfig() + client-secret minting + upstream error mapping
  routes/              /api/health, /api/realtime/session (rate-limited, no-store)
  app.ts               helmet CSP, exact-match CORS, JSON limits, error handler, optional static hosting
client/src/
  lib/presenterController.ts    ★ framework-free event → action state machine (tool dispatch, barge-in)
  lib/realtimeConnection.ts     WebRTC transport (mic, SDP exchange, data channel)
  hooks/useVoicePresenter.ts    wires deck state + controller + connection into React
  components/          Header, SlideStage, diagrams, SidePanel (status/transcript/outline), ControlBar
```

### How tool calls are made reliable

`PresenterController.handleServerEvent` is a plain class driven by Realtime server events, unit-tested with a fake clock.

| Concern | Mechanism |
|---|---|
| Dispatch from the right event | Calls execute from **`response.done`** only when `response.status === "completed"`. (`response.function_call_arguments.done` also fires for cancelled responses, so it isn't used as the trigger.) |
| Validation | `JSON.parse` guarded, then `navigateToSlideArgsSchema` (Zod). Unknown tool, malformed JSON, or out-of-range args → `{ ok:false, error }` output **plus** `response.create`, so the model recovers out loud. |
| Exactly-once | `handledCallIds` (accepted) and `answeredCallIds` (output sent) are separate sets, so a replayed `response.done` or a deferred call can't execute or answer twice. |
| Cancelled / failed responses | Their calls get an `{ ok:false }` output (no dangling `function_call` items in history), but **no** `response.create`, so the model doesn't talk over the user. |
| Stale async updates | `next_sentence` navigations wait for `output_audio_buffer.stopped` (max 2.5 s). A `navEpoch` counter, bumped by interruptions and manual navigation, voids them if the world moved on. |
| One navigation per turn | `parallel_tool_calls: false` in the session. |
| Truthful narration | The tool result carries the slide's real content, and the instructions forbid claiming a move unless `ok: true` came back. |
| Manual navigation sync | Prev/next/outline clicks inject a `system` message (`[deck] The user manually moved to slide N`) without triggering a response. |

### How barge-in works

1. **Server-side:** `turn_detection: { type: "semantic_vad", interrupt_response: true, create_response: true }`. When the user speaks, the Realtime server cancels the in-flight response. Over WebRTC it also **truncates the unplayed audio and the conversation item**, so the model's history matches what the user actually heard.
2. **Client-side** on `input_audio_buffer.speech_started` while a response is active or audio is playing: mark that response id stale (later transcript deltas and tool calls from it are ignored), cancel any pending navigation, tag the transcript bubble `interrupted`, and show the **Interrupted** state.
3. **Manual Interrupt** (button or `Esc`): `response.cancel` (when generation is still running), then `output_audio_buffer.clear` (WebRTC-only; flushes queued audio and truncates). The order follows the API reference.
4. Mic stays live during playback; `getUserMedia` uses `echoCancellation` and `noise_reduction: near_field` reduces self-interruption.

Status states map to real events: **Connecting** (session mint + SDP), **Listening** (idle / user speaking), **Thinking** (`speech_stopped` → `response.created`), **Speaking** (`output_audio_buffer.started` → `stopped`), **Interrupted** (barge-in, ~0.9 s badge), **Error**.

---

## Testing

### Automated (no API key required) — `npm test`

```
 ✓ shared/test/presentation.test.ts       slide metadata, slide-number + tool-arg validation, tool ⇄ Zod parity, instructions
 ✓ server/test/env.test.ts                config defaults, invalid values, key never echoed
 ✓ server/test/realtimeSession.test.ts    session config (GA shape, VAD, barge-in, single tool), secret minting,
                                          missing credentials (503), upstream 401/403/400/429/5xx/timeout/network/malformed
 ✓ server/test/app.test.ts                /api/health, session route validation, no-store, JSON errors, rate limit, CORS, 404
 ✓ client/test/presenterController.test.ts  tool dispatch, dedupe, malformed/invalid/unknown calls, failed responses,
                                          next_sentence deferral + timeout, the "Wait, explain tool calling instead" barge-in
                                          scenario, cancelled-response tool calls, manual interrupt event order, status lifecycle
 Test Files  5 passed (5)   Tests  100 passed (100)
```

### Manual end-to-end checklist (requires `OPENAI_API_KEY` + microphone)

| # | Check | How |
|---|---|---|
| A | App starts | `npm run dev` → both servers log ready; `curl localhost:3001/api/health` shows `openaiConfigured: true` |
| B | Real Realtime session | Click **Start presenter** → status goes Connecting → Listening; header shows "Live · Realtime"; presenter greets you |
| C | Natural voice Q&A | Ask anything; you hear `marin` answer; transcript shows both sides |
| D | Tool calling → slide 3 | "How does an AI agent use tools?" → toast "Presenter moved to slide 3" |
| E | Memory/RAG → slide 4 | "Explain memory and RAG." |
| F | Multi-agent → slide 5 | "What happens when multiple agents collaborate?" |
| G | Production safety → slide 6 | "What are the main production risks?" |
| H | Follow-up stays put | On slide 4: "What's a reranker?" → answers without a navigation event |
| I | Barge-in | While it explains slide 2, say "Wait, explain tool calling instead." → audio stops within ~½ s, bubble tagged *interrupted*, moves to slide 3, answers |
| J | Prev/next | Buttons, dots, outline, ←/→ keys |
| K | States | Watch the status card change through Listening/Thinking/Speaking/Interrupted |
| L | Failure modes | Refresh mid-session (clean restart); deny mic ("Microphone access was blocked…"); toggle Wi-Fi off ("The voice connection was lost…"); blank key ("The server has no OPENAI_API_KEY…"); bad key ("OpenAI rejected the server's API key…") |
| M | No key exposure | `npm run build && npm run check:bundle`; DevTools → Network: `/api/realtime/session` returns only `ek_…`; `/v1/realtime/calls` uses `Bearer ek_…` |

---

## Two-minute demo script

1. **(0:00) Frame it.** "VoxDeck is a presentation that presents itself. The voice is OpenAI's Realtime model over WebRTC; the slides are driven by real function calls." Click **Start presenter**. It greets you.
2. **(0:15) Routing.** Ask: *"How does an AI agent use tools?"* It jumps to slide 3. Point at the toast showing the tool's `reason`. "That was a `navigate_to_slide` call, validated with Zod in the browser, and the result fed back so it keeps talking."
3. **(0:40) Meta moment.** "This slide's example is the app itself: the model emits the call, my code validates and executes it."
4. **(0:50) Follow-up.** Ask: *"Why validate the arguments?"* It answers without moving: follow-ups don't navigate.
5. **(1:05) Barge-in.** Click slide 2 and ask *"Walk me through this loop."* Mid-sentence, say: ***"Wait — explain memory and RAG instead."*** It stops instantly, the bubble is tagged *interrupted*, it moves to slide 4 and answers. "Server VAD cancels the response and truncates unplayed audio. The client also discards anything the cancelled response still had in flight, including tool calls."
6. **(1:35) Production.** Ask: *"What would break this in production?"* It goes to slide 6 and cites the 0.95¹⁰ ≈ 60% compounding stat.
7. **(1:55) Close.** "The API key never leaves the server; the browser only ever sees a 2-minute ephemeral key."

### Three design decisions worth discussing

1. **Execute tools on `response.done`, not on `function_call_arguments.done`.** The arguments event also fires for interrupted responses. Gating on the response's final status and a stale-response set means a barge-in can never cause a "ghost" slide change. Cancelled calls still get a `function_call_output` so conversation history stays well-formed, but without `response.create`, so the model doesn't talk over the user.
2. **The server fixes the whole session inside the ephemeral secret.** Instructions, tool list, VAD, voice and TTL are minted server-side; the browser sends only `{ currentSlide }`. That keeps the real key server-only and also stops a tampered client from adding tools or rewriting the prompt. One small, testable `buildSessionConfig()` is the contract.
3. **Framework-free controller; React state is the source of truth for the screen.** All Realtime event handling lives in `PresenterController` (no React, no WebRTC), so the hardest behaviour (dedupe, deferral, interruption, epochs) is covered by deterministic unit tests with a fake clock. The model learns what's on screen only from tool results and `[deck]` notes, never by assuming.

---

## Known limitations

- **Live voice behaviour was not verified in this build environment.** No API key or microphone was available, so checks B–I and the live parts of L are untested here. Everything up to the network boundary is covered by automated tests, and the integration follows the GA docs. Run the manual checklist before the interview.
- `next_sentence` waits for the *current audio buffer* to finish (bounded at 2.5 s). It's a close proxy for a sentence boundary, not an exact one.
- The transcript shows the model's generated text. After a barge-in, a bit more text may appear than was actually spoken. (The server-side conversation is truncated correctly.)
- Speaker echo can trigger false interruptions without headphones.
- Desktop-first layout (min width 1024 px). Single user per tab; no persistence by design.
- The in-memory rate limiter is per-process, which is fine for a local demo.
