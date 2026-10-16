# VoxDeck — a voice presenter you can interrupt

A six-slide talk — **"Building Reliable Voice AI Agents: Real-Time Interaction, Grounding, Safety and Evaluation"** — presented live by a speech-to-speech AI. Ask a question out loud; the presenter calls a real `navigate_to_slide` tool, the slide changes, and it explains the slide in a couple of sentences. Talk over it and it stops, drops everything the old answer still owned, and answers the new question.

Built on the **OpenAI Realtime API (GA)** over **browser WebRTC**, with a **live voice evaluation suite** that speaks synthesized audio into the same model and session configuration and scores what happens.

> Educational prototype. It makes no clinical, regulatory or production-readiness claims.

---

## Quick start

```bash
npm install                 # Node ≥ 20.19, npm workspaces
cp .env.example .env        # then set OPENAI_API_KEY=sk-...   (never put it in .env.example)
npm run dev                 # server :3001 + client :5173
```

Open **http://localhost:5173** in Chrome → **Start presenter** → allow the microphone → ask a question (or tap an example chip). Press **D** for diagnostics.

| Command | What it does |
|---|---|
| `npm run dev` | Express (tsx watch) + Vite, `/api` proxied to `:3001` |
| `npm test` | Vitest — unit, integration and deterministic scenario traces (no API key) |
| `npm run typecheck` / `npm run lint` / `npm run check` | `tsc` for all four workspaces · ESLint · all three |
| `npm run eval:voice` | **Live voice evaluation** against the real Realtime API (needs a key; ~6 min; a few cents) |
| `npm run build` · `npm run check:bundle` | Production client build · scan the bundle for API keys |
| `npm start` | Single-port production mode on `:3001` (set `CLIENT_ORIGIN=http://localhost:3001`) |

> **Use headphones for the demo.** With laptop speakers or a noisy room, the microphone can pick up the presenter's voice or background speech and treat it as an interruption (see *Known limitations*).

### Environment variables

| Variable | Default | Notes |
|---|---|---|
| `OPENAI_API_KEY` | — | **Server only.** Never sent to the browser. If unset the UI loads and explains the problem on connect. |
| `OPENAI_REALTIME_MODEL` | `gpt-realtime` | Any Realtime speech-to-speech model. |
| `OPENAI_REALTIME_VOICE` | `marin` | |
| `OPENAI_TRANSCRIPTION_MODEL` | `gpt-4o-mini-transcribe` | Live captions of the user's speech. |
| `OPENAI_TURN_DETECTION` | `server_vad` | silence timer; or `semantic_vad`. Both keep barge-in on. Chosen by the *Turn detection A/B* below. |
| `OPENAI_VAD_EAGERNESS` | `auto` | semantic VAD only: `low` · `medium` · `high` · `auto` (= medium). |
| `OPENAI_VAD_SILENCE_MS` | `500` | server VAD only. |
| `CLIENT_SECRET_TTL_SECONDS` | `120` | Lifetime of the ephemeral browser credential (10–7200). |
| `PORT` · `CLIENT_ORIGIN` | `3001` · `http://localhost:5173` | CORS allows exactly `CLIENT_ORIGIN`. |
| `EVAL_JUDGE_MODEL` | `gpt-4.1-mini` | Eval harness only: the LLM judge for semantic criteria. |

---

## Architecture

```
Browser (React)                       Express                         OpenAI
Start ─ POST /api/realtime/session ──▶ Zod-validate ─ build session ─ POST /v1/realtime/client_secrets
        { currentSlide, clientSessionId }   (prompt, tool, VAD,              ◀── ek_… (TTL 120 s)
                                            barge-in fixed here)
getUserMedia ║ (in parallel with minting)
RTCPeerConnection + "oai-events" ─ SDP ─────────────────────────────▶ POST /v1/realtime/calls (Bearer ek_…)
mic ════════════════════════ WebRTC audio ══════════════════════════▶ VAD → gpt-realtime
speaker ◀══════════════════════════════════════════════════════════  streamed voice
PresenterController ◀── server events ──  response.done { function_call navigate_to_slide }
  ├─ Zod-validate → deck.goTo(n)        (React state = what is on screen)
  ├─ function_call_output (slide content + sources) + response.create ──▶ explanation continues
  └─ DiagnosticsRecorder (local event log, timings, no secrets/transcripts)
```

```
shared/   presentation.ts (6 slides: id, title, summary, concepts, example[illustrative?], notes, keywords, sources, diagram)
          instructions.ts (deck → system prompt + conversation/grounding policy) · tools.ts · schemas.ts (Zod)
          grounding.ts (deterministic audit: numbers/citations not in the deck)
server/   config/env.ts · services/realtimeSession.ts (buildSessionConfig, client-secret minting, error mapping)
          routes/ (health, session) · app.ts (helmet CSP, exact-origin CORS, rate limit, safe errors)
client/   lib/presenterController.ts ★ (event → action state machine) · lib/diagnostics.ts · lib/realtimeConnection.ts
          hooks/useVoicePresenter.ts · components/ (stage, diagrams, side panel, control bar, diagnostics panel)
evals/    scenarios.ts (A–J) · harness/ (live session, synthetic caller, LLM judge) · run.ts (CLI + reports)
```

### What the deterministic code owns (and what it leaves to the model)

The model handles language, routing judgment and explanation. Code owns only the invariants a prompt cannot guarantee:

| Invariant | Mechanism |
|---|---|
| The screen is the source of truth | Every slide change goes through `deck.goTo`; the model learns the result from `function_call_output` and `[deck]` notes on manual navigation. |
| Never claim a navigation that didn't happen | `ok: true` is returned only after `goTo` succeeds; a throwing handler returns `ok: false` and the model is asked to say so. |
| Nothing from an interrupted answer is applied | Responses active or playing at barge-in are marked stale: their transcript deltas, tool calls and deferred navigations are dropped. Calls are executed from `response.done` only when `status === "completed"` (the `…arguments.done` event also fires for cancelled responses). |
| Exactly one output per function call | Separate *accepted* and *answered* call-id sets; cancelled calls are closed with `ok: false` **without** `response.create` so the model never talks over the user. |
| No dangling silence after a race | A `response.create` rejected with `conversation_already_has_active_response` is retried once that response ends — unless the user spoke in between. |
| One navigation per turn | `parallel_tool_calls: false`. |

**Barge-in** is the API's own behaviour, not a UI trick: `turn_detection.interrupt_response: true` makes the server cancel the in-flight response on user speech, and over WebRTC it truncates the unplayed audio so the model's history matches what was heard. The manual **Interrupt** button (Esc) sends `response.cancel` then `output_audio_buffer.clear`, in the order the reference specifies.

### Conversation and grounding policy (in the prompt)

- 1–3 short sentences; explain, don't read the slide; occasional follow-up invitation.
- **Spoken cue before switching slides** (≤ 6 words, e.g. "Let's look at tool calling."), then the tool call in the same turn. In live runs this puts first audio ~0.5 s after end-of-turn instead of after the full tool round-trip (~2 s).
- Follow-ups stay on the slide; greetings/off-topic never navigate; vague requests use the latest topic or get **one short clarifying question**.
- The deck (6 slides, inlined) is the trusted knowledge source — no RAG infrastructure for static content. General knowledge must be flagged; **no invented statistics, studies or citations**; only listed sources may be cited (shown on each slide); illustrative examples are labelled as such.
- A deterministic **grounding audit** flags numbers or citation phrasing absent from the deck. It marks the transcript bubble and logs to diagnostics; it is a heuristic for review, not a gate.

### Diagnostics (press **D**)

Local only — no audio, no transcripts, no keys. Shows connect time (with phase breakdown: mint ‖ mic, SDP, data channel), **turn → first audio** (approximate: VAD `speech_stopped` or typed question → `output_audio_buffer.started` as received; excludes VAD's own wait and the jitter buffer), tool calls/failures, slide changes, interruptions (voice/button), cancelled responses, grounding flags, server errors, reconnects, and a timestamped event log carrying both the client session id (also in server logs) and the Realtime session id. **Copy JSON** exports it.

---

## Evaluation

### 1. Deterministic tests — `npm test`

Unit, integration and **scenario traces** (`client/test/scenarios.test.ts`) that replay exact Realtime event orderings through the production controller: interruption *before*, *during* (deferred transition) and *after* navigation; `response.done(completed)` racing `speech_started`; rapid consecutive turns with duplicate delivery; malformed tool arguments; connection loss and recovery. These validate client logic only — not audio, VAD or model behaviour.

### 2. Live voice evaluation — `npm run eval:voice`

Following the idea that voice agents should be evaluated **in voice**, the harness:

- **Speaks** each caller line as synthesized audio (`gpt-4o-mini-tts`, cached on disk so reruns use identical input audio) and streams it in real time as 100 ms microphone frames, with continuous silence between turns — so server VAD decides when turns end, exactly as with a person.
- Uses the **production** `buildSessionConfig()` (same prompt, tool, VAD, barge-in) and the **production** `PresenterController` (same tool dispatch, stale-response guards, diagnostics).
- Differs in transport: Node has no browser WebRTC, so it uses the Realtime **WebSocket** and therefore performs the documented WebSocket client duties itself — a real-time playback clock and `conversation.item.truncate` with `audio_end_ms` on barge-in.
- Scores **deterministic checks** (navigation, no overlapping responses, no stale navigation, exactly-once tool outputs, grounding audit, latency) and **LLM-judge checks** for semantic criteria (labelled `[judge]`; `--no-judge` to disable).
- Writes `evals/results/<timestamp>.{json,md}` with per-check failure reasons, the event timeline, timings and ASR word error rate. Exits non-zero on failure (CI-ready). `--repeat=N` reports pass *rates*; `--persona=rushed` changes the caller; `--eagerness=` / `--vad=server` A/B turn detection.

| ID | Scenario | Pass criteria (abridged) |
|---|---|---|
| A | "How does the agent use tools?" | → slide 3; audio answer; judge: explains propose/validate/execute; no ungrounded numbers |
| B | …then "Why do we need that?" | no navigation in turn 2; still slide 3; judge: answer refers back to tool calling |
| C | On slide 3: "Actually, explain interruption handling." | → slide 4; judge: covers cancel + truncate/stale actions |
| D | Interrupt after ~1.5 s of a slide-2 explanation | barge-in detected; server stops the old stream ≤ 1.5 s; cancelled promptly; final slide 4; no stale navigation; judge: new intent handled |
| E | After greeting: "Can you explain that better?" | no navigation; judge: clarifies or re-explains the slide on screen |
| F | "What's the weather in Boston tomorrow?" | no navigation; no numbers; judge: acknowledges it's out of scope, no forecast |
| G | Two questions ~0.4 s apart | final slide 6; no overlapping responses; no stale navigation; exactly-once outputs; judge: answers the latest |
| H | Navigation handler forced to throw | slide unchanged; `ok:false` returned; judge: no false success claim |
| I | Socket killed mid-session, then reconnect | error state shown; new Realtime session; navigation works after reconnect |
| J | "What % of voice agents fail? Which study?" | grounding audit clean; judge: no invented statistic or study |
| K | "So can you explain how the agent handles…" *(1 s pause)* "…being interrupted while it's talking?" | no response starts during the pause; final slide 4 — measures the turn-detection trade-off |

#### Results (this machine, 2026-10-16, `gpt-realtime` / `marin`, clear caller, judge `gpt-4.1-mini`, one run per scenario per setting)

| Run | A–J pass | Caller stops → first audio (median / p90) | VAD end-of-turn → first audio (median / p90) | Barge-in → cancelled (median) |
|---|---|---|---|---|
| semantic VAD `auto` (previous default) | **10/10** | 2,426 ms / 4,754 ms | 533 ms / 701 ms | 42 ms |
| semantic VAD `high` | **10/10** | 2,086 ms / 3,318 ms | 463 ms / 668 ms | 81 ms |
| **server VAD, 500 ms silence (default now)** | **10/10** | **1,304 ms / 1,395 ms** | 510 ms / 594 ms | 6 ms |

Scenario **K** (mid-thought pause, tracking): **0/6 strict passes across all three settings** — every configuration started answering the fragment during the 1 s pause — but **6/6 recovered** via barge-in and ended on the right slide. Caveat: synthesized speech reads the fragment with sentence-final intonation, which is harder on semantic VAD than a real mid-thought pause would be.

#### Turn detection A/B — what the data says

- **The model is not the bottleneck.** From the server's end-of-turn event to first audio is ~0.5 s in every setting. The cue-before-tool prompt keeps it there even when a slide change is needed.
- **End-of-turn detection is.** Semantic VAD waited 1–4 s after some clearly finished questions (the same cached audio for "How does the agent use tools?" took ≈2.8 s every run at `auto`).
- **server_vad halves the median and removes the long tail** with no loss in A–J. Its cost is visible too: in D it split "Wait, explain interruption handling instead" at the comma, and ASR WER rose from 0.00 to 0.06. Barge-in recovers those splits, but users with long pauses would feel it.
- **Decision:** `server_vad` (500 ms) is the default; `OPENAI_TURN_DETECTION=semantic_vad` restores the previous behaviour. Re-run `npm run eval:voice -- --vad=semantic` with real recorded callers before treating this as settled.

Other measurements: the browser connect went from 4.3 s to 2.8 s after opening the mic in parallel with credential minting (one sample each; mint 813 ms ‖ mic 198 ms, SDP 964 ms, data channel 1,044 ms). ASR word error on synthetic callers: 0.00–0.06.

---

## Manual checklist (browser, real microphone)

| | Check | How |
|---|---|---|
| ☐ | Start | `npm run dev`; `/api/health` shows `openaiConfigured: true` |
| ☐ | Session | Start presenter → Connecting → Listening; greeting heard |
| ☐ | Voice Q&A | Ask by voice; answer heard; transcript shows both sides |
| ☐ | Navigation | tools → 3 · interruption → 4 · grounding → 5 · evaluation → 6 (toast shows the tool's reason) |
| ☐ | Follow-up | "Why does that matter?" stays on the slide |
| ☐ | Barge-in | Talk over an answer: audio stops ≈ immediately, bubble tagged *interrupted*, diagnostics shows `interrupt.auto` + cancelled response |
| ☐ | Controls | Prev/next/dots/outline/←→; mute (M); Interrupt (Esc); diagnostics (D) |
| ☐ | Failures | Deny mic · disconnect network · blank key · invalid key → clear message + Reconnect |
| ☐ | Secrets | `npm run build && npm run check:bundle`; Network tab shows only `ek_…` credentials |

---

## Two-minute demo

1. **(0:00)** "A presentation that presents itself — and can be interrupted." Headphones on, **Start presenter**, press **D** to show diagnostics alongside.
2. **(0:15)** Ask *"How does the agent use tools?"* — it says a short cue, the slide moves to 3, it explains. Point at `tool.call → nav.executed → tool.result ok` and the turn → audio time.
3. **(0:40)** Follow-up *"Why do we need that?"* — no navigation; context kept.
4. **(0:55)** Ask about slide 2, then cut in: *"Wait — explain interruption handling instead."* Audio stops, the bubble is tagged *interrupted*, `interrupt.auto` and a `cancelled` response appear, it lands on slide 4.
5. **(1:20)** *"What percentage of voice agents fail in production?"* — it says the deck has no such figure instead of inventing one. Point at the sources line on each slide.
6. **(1:35)** Show `evals/results/*.md`: ten scenarios spoken into the live model, the VAD A/B table, and scenario K as an honest open issue.
7. **(1:55)** "The model handles language; code owns the invariants; the eval decides the settings."

---

## Known limitations

- **False barge-ins from the room.** In a live browser test with laptop speakers, short sounds were transcribed as "Yeah." / "Goodbye." and interrupted the presenter. Interruption is the API's server-side VAD; the client cannot un-cancel a response. Mitigations: headphones (recommended), `server_vad` with a higher threshold, or a confirmed-barge-in design (`interrupt_response: false` and cancel client-side only once speech is long enough) — the latter trades interruption latency for robustness and is not implemented.
- **Turn-end latency is dominated by VAD**, not the model. The `server_vad` default trades some robustness to mid-sentence pauses for ~1 s lower median latency; scenario K documents that neither setting waits out a 1 s pause on synthetic speech.
- Live eval runs are single samples by default and model behaviour is stochastic; use `--repeat` before drawing conclusions. The LLM judge can itself be wrong; its reasons are recorded for review.
- The eval harness uses the WebSocket transport; the WebRTC path is covered by the browser checklist and diagnostics, not by the harness.
- Latency numbers are wall-clock approximations from one machine and network.
- `next_sentence` transitions wait for the current audio buffer (≤ 2.5 s), a proxy for a sentence boundary.
- The grounding audit is a heuristic (numbers, citation phrasing); it does not verify meaning.
- Desktop-first (≥ 1024 px). Per-process rate limiter. No persistence by design.
