/**
 * The presentation is plain structured data. The client renders it, and the
 * server compiles it into the Realtime model's instructions, so what the
 * presenter says and what the audience sees come from one source.
 */

export const SLIDE_COUNT = 6;

export type SlideNumber = 1 | 2 | 3 | 4 | 5 | 6;

export interface KeyConcept {
  term: string;
  detail: string;
}

export interface SourceRef {
  label: string;
  url: string;
}

export type DiagramConfig =
  | {
      kind: 'evolution';
      stages: { label: string; tag: string; capability: string }[];
    }
  | {
      kind: 'agent-loop';
      core: string;
      steps: { label: string; detail: string }[];
      modules: string[];
    }
  | {
      kind: 'tool-sequence';
      lanes: string[];
      messages: { from: number; to: number; label: string; code?: string }[];
    }
  | {
      kind: 'interruption';
      userUtterance: string;
      steps: { event: string; detail: string }[];
    }
  | {
      kind: 'layers';
      tiers: { label: string; scope: string; example: string }[];
      pipelineLabel: string;
      pipeline: string[];
    }
  | {
      kind: 'pillars';
      pillars: { label: string; items: string[] }[];
      stat: { value: string; caption: string };
    };

export interface Slide {
  id: string;
  number: SlideNumber;
  title: string;
  eyebrow: string;
  summary: string;
  keyConcepts: KeyConcept[];
  /** `illustrative` examples are hypothetical and must be presented as such. */
  example: { label: string; text: string; illustrative: boolean };
  speakerNotes: string;
  keywords: string[];
  /** Only these may be cited. An empty list means the slide makes no sourced claims. */
  sources: SourceRef[];
  diagram: DiagramConfig;
}

export const PRESENTATION_TITLE = 'Building Reliable Voice AI Agents: Real-Time Interaction, Grounding, Safety and Evaluation';

export const slides: readonly Slide[] = [
  {
    id: 'why-voice',
    number: 1,
    eyebrow: 'Foundations',
    title: 'Why Voice Agents Are Different',
    summary:
      'Voice removes the safety margin of text. People expect a reply within a conversational beat, they interrupt, and every mistake is heard the moment it is made.',
    keyConcepts: [
      { term: 'Conversational timing', detail: 'Gaps between turns are typically around 200 ms.' },
      { term: 'Barge-in', detail: 'People interrupt; the agent must stop and re-plan.' },
      { term: 'Audible errors', detail: 'No scrollback — a wrong answer is heard live.' },
    ],
    example: {
      label: 'Illustrative: the same question by text and by voice',
      text: 'In chat, a three-second pause feels fine. On a call it sounds broken — and if the caller says "no, the other one" halfway through, a text-style agent keeps talking over them.',
      illustrative: true,
    },
    speakerNotes:
      'Frame the talk: a reliable voice agent is a different engineering problem from a chatbot. Turn-taking research across ten languages found that gaps between conversational turns are typically around 200 milliseconds (Stivers et al., 2009). That sets the bar: answers must start quickly, the agent must yield when interrupted, and errors cannot be quietly edited. The progression on the slide: text chat; cascaded voice pipelines (speech-to-text, then an LLM, then text-to-speech) where latency adds up at every hop; speech-to-speech models that stream audio in and out; and finally a reliable voice agent that is also grounded, interruptible and evaluated.',
    keywords: [
      'voice', 'why voice', 'introduction', 'overview', 'latency', 'response time', 'turn-taking', 'real-time',
      'realtime', 'speech', 'chatbot', 'difference', 'cascaded', 'speech-to-speech', 'pipeline',
    ],
    sources: [
      { label: 'Stivers et al. (2009), PNAS — turn-taking across 10 languages', url: 'https://www.pnas.org/doi/10.1073/pnas.0903616106' },
    ],
    diagram: {
      kind: 'evolution',
      stages: [
        { label: 'Text chatbot', tag: 'Text', capability: 'Turn-based; a pause of seconds is fine' },
        { label: 'Cascaded voice', tag: 'STT → LLM → TTS', capability: 'Latency adds up at every hop' },
        { label: 'Speech-to-speech', tag: 'Realtime', capability: 'One model streams audio in and out' },
        { label: 'Reliable voice agent', tag: 'Goal', capability: 'Grounded, interruptible, evaluated' },
      ],
    },
  },
  {
    id: 'architecture',
    number: 2,
    eyebrow: 'Architecture',
    title: 'Anatomy of a Real-Time Voice Agent',
    summary:
      'A speech-to-speech model handles listening and speaking. Ordinary code owns everything that must be deterministic: the session configuration, tool execution, what is on screen, and when an answer is stale.',
    keyConcepts: [
      { term: 'Model owns the conversation', detail: 'Understands speech, decides, speaks.' },
      { term: 'Code owns the invariants', detail: 'Validates tools, owns UI state, enforces limits.' },
      { term: 'Server-side session', detail: 'Instructions and tools are fixed before the browser connects.' },
    ],
    example: {
      label: 'This app',
      text: 'Your microphone streams to the OpenAI Realtime API over WebRTC. The model hears the question, calls navigate_to_slide, the browser validates it and changes the slide, and the model keeps talking — while the API key never leaves the server.',
      illustrative: false,
    },
    speakerNotes:
      'Walk through the loop on the diagram. Listen: voice activity detection decides when the user has finished speaking. Reason: the model decides whether to answer or call a tool. Speak: audio streams back while the agent stays interruptible. Around the model sit the parts ordinary code must own: a server-side session configuration with fixed instructions and tools, tool handlers that validate their arguments, the trusted content answers are grounded in, and a client state machine that knows whether the agent is listening, thinking, speaking or interrupted. The rule of thumb: let the model handle language and judgment, and put product invariants in deterministic code.',
    keywords: [
      'architecture', 'anatomy', 'components', 'how it works', 'put together', 'built', 'webrtc', 'loop',
      'state machine', 'session', 'design', 'structure', 'model', 'system', 'stack',
    ],
    sources: [{ label: 'OpenAI — Realtime API with WebRTC', url: 'https://developers.openai.com/api/docs/guides/voice-webrtc' }],
    diagram: {
      kind: 'agent-loop',
      core: 'Realtime model',
      steps: [
        { label: 'Listen', detail: 'VAD detects end of turn' },
        { label: 'Reason', detail: 'Answer or call a tool' },
        { label: 'Speak', detail: 'Stream audio, stay interruptible' },
      ],
      modules: ['Server-side session config', 'Validated tools', 'Trusted slide content', 'Client state machine'],
    },
  },
  {
    id: 'tools',
    number: 3,
    eyebrow: 'Capabilities',
    title: 'Tools, APIs & Function Calling',
    summary:
      'The model never executes anything itself. It emits a structured request — a function name plus JSON arguments — and your application validates it, runs it, and returns the result.',
    keyConcepts: [
      { term: 'Schema contract', detail: 'Each tool is described with a JSON Schema.' },
      { term: 'Model proposes, app executes', detail: 'Your code is the security boundary.' },
      { term: 'Validate everything', detail: 'Treat arguments as untrusted input.' },
    ],
    example: {
      label: 'This presentation is the example',
      text: 'When you ask about tool calling, the model emits navigate_to_slide({ slide_number: 3 }). The browser validates it with Zod, changes the slide, and sends the result back so the model keeps talking.',
      illustrative: false,
    },
    speakerNotes:
      'Walk through the round trip: the developer registers tools with names, descriptions and parameter schemas. The model decides a tool is needed and returns a function call with a call id and JSON arguments. The application validates the arguments, executes the real action, and sends a function_call_output with the same call id; the model then uses that result in its answer. Point out the meta example: this deck is driven by a navigate_to_slide tool. Mention least privilege — expose only the tools the task needs — and that a failed tool must be reported as failed.',
    keywords: [
      'tools', 'tool', 'tool use', 'tool calling', 'use tools', 'function calling', 'functions', 'api', 'apis',
      'json schema', 'arguments', 'actions', 'integration', 'execute', 'mcp',
    ],
    sources: [{ label: 'OpenAI — Realtime conversations: function calling', url: 'https://developers.openai.com/api/docs/guides/realtime-conversations' }],
    diagram: {
      kind: 'tool-sequence',
      lanes: ['User', 'Model', 'Your app', 'External API'],
      messages: [
        { from: 0, to: 1, label: '"Explain tool calling"' },
        { from: 1, to: 2, label: 'function_call', code: 'navigate_to_slide({ slide_number: 3 })' },
        { from: 2, to: 3, label: 'Validate → execute' },
        { from: 3, to: 2, label: 'Result' },
        { from: 2, to: 1, label: 'function_call_output', code: '{ ok: true, slide: 3 }' },
        { from: 1, to: 0, label: 'Grounded answer' },
      ],
    },
  },
  {
    id: 'interruptions',
    number: 4,
    eyebrow: 'Real-time interaction',
    title: 'Turn-Taking & Interruption Handling',
    summary:
      'Voice activity detection decides when the user has finished — and when they start talking over the agent. On an interruption the response is cancelled, unplayed audio is truncated so history matches what was heard, and actions from the old answer are dropped.',
    keyConcepts: [
      { term: 'Turn detection', detail: 'Faster end-of-turn vs. not cutting people off.' },
      { term: 'Cancel + truncate', detail: 'The model remembers only what was actually heard.' },
      { term: 'Stale-action guard', detail: 'Tool calls from a cancelled answer never run.' },
    ],
    example: {
      label: 'Try it: interrupt me',
      text: 'While I explain a slide, say "wait, explain tool calling instead." The answer stops mid-sentence, the old response\'s pending actions are discarded, and the new question is answered on the right slide.',
      illustrative: false,
    },
    speakerNotes:
      'Explain turn-taking: voice activity detection marks when speech starts and stops; semantic VAD also uses the words to judge whether the user has finished, so a pause mid-thought does not trigger a reply. Barge-in: when the user speaks while the agent is talking, the server cancels the in-progress response, and over WebRTC it truncates the audio that was never played, so the conversation history reflects only what the user actually heard. The client must then drop anything the cancelled response still owns, such as a pending slide change. The trade-off: more eager turn detection lowers latency but cuts users off; less eager detection feels patient but slower.',
    keywords: [
      'interruption', 'interruptions', 'interrupt', 'interrupting', 'barge-in', 'barge in', 'turn-taking', 'turn taking',
      'turn detection', 'vad', 'voice activity detection', 'cancel', 'truncate', 'talk over', 'stop talking', 'eagerness',
    ],
    sources: [
      { label: 'OpenAI — Realtime conversations: interruptions', url: 'https://developers.openai.com/api/docs/guides/realtime-conversations' },
      { label: 'OpenAI — Voice activity detection', url: 'https://developers.openai.com/api/docs/guides/realtime-vad' },
    ],
    diagram: {
      kind: 'interruption',
      userUtterance: '"Wait — explain tool calling instead."',
      steps: [
        { event: 'speech_started', detail: 'VAD hears the user' },
        { event: 'response cancelled', detail: 'reason: turn_detected' },
        { event: 'audio truncated', detail: 'history = what was heard' },
        { event: 'stale actions dropped', detail: 'old tool calls never run' },
        { event: 'new response', detail: 'answers the new question' },
      ],
    },
  },
  {
    id: 'grounding',
    number: 5,
    eyebrow: 'Trust',
    title: 'Grounding & Safety',
    summary:
      'A trustworthy agent answers from content it was given, labels anything extra as extra, and says it does not know instead of guessing. Tools get the least privilege they need, and a failed action is reported as failed.',
    keyConcepts: [
      { term: 'Trusted source first', detail: 'This deck is the agent\'s knowledge base.' },
      { term: 'No invented facts', detail: 'No made-up statistics, studies or citations.' },
      { term: 'Truthful tool reporting', detail: 'Never claim an action that did not happen.' },
    ],
    example: {
      label: 'Illustrative: asked for a number that is not here',
      text: 'Asked "what percentage of voice agents fail in production?", a grounded presenter says this deck does not include that figure and offers what it does cover — instead of inventing a statistic.',
      illustrative: true,
    },
    speakerNotes:
      'For six slides, retrieval infrastructure is unnecessary: the whole deck fits in the model\'s instructions, and each navigation returns the slide content as the tool result. For larger knowledge bases, retrieval-augmented generation fetches relevant passages and grounds the answer in them (Lewis et al., 2020). The habits are the same at any scale: answer from trusted content, label general knowledge as such, never invent figures or citations, treat retrieved text and tool output as untrusted input — prompt injection is the first entry in the OWASP Top 10 for LLM applications — give tools least privilege, and report tool failures honestly. This prototype is educational and makes no clinical or compliance claims.',
    keywords: [
      'grounding', 'grounded', 'hallucination', 'hallucinate', 'accuracy', 'accurate', 'facts', 'rag', 'retrieval',
      'memory', 'knowledge', 'sources', 'citation', 'safety', 'guardrails', 'prompt injection', 'trust', 'statistic',
    ],
    sources: [
      { label: 'Lewis et al. (2020) — Retrieval-Augmented Generation', url: 'https://arxiv.org/abs/2005.11401' },
      { label: 'OWASP Top 10 for LLM Applications', url: 'https://owasp.org/www-project-top-10-for-large-language-model-applications/' },
      { label: 'Synthio Labs — Building Reliable AI Agents for Life Sciences', url: 'https://synthiolabs.com/blog/building-reliable-ai-agents-for-life-sciences' },
    ],
    diagram: {
      kind: 'layers',
      tiers: [
        { label: 'Trusted content', scope: 'This deck', example: 'Slides, notes, listed sources' },
        { label: 'General knowledge', scope: 'Labeled as extra', example: '"Beyond what\'s on the slide…"' },
        { label: 'Unknown', scope: 'Say so', example: 'No invented figures or citations' },
      ],
      pipelineLabel: 'Every answer',
      pipeline: ['Retrieve', 'Ground', 'Answer', 'Check', 'Log'],
    },
  },
  {
    id: 'evaluation',
    number: 6,
    eyebrow: 'Evaluation',
    title: 'Evaluating Voice Agents in Voice',
    summary:
      'Transcript-only tests miss what callers experience: timing, interruptions and speech-recognition errors. Evaluate with scripted voice scenarios over the real audio pipeline, score them automatically, and trace every turn.',
    keyConcepts: [
      { term: 'Scenario suites', detail: 'Scripted callers, run before every change.' },
      { term: 'Voice metrics', detail: 'First-audio latency, interruption recovery, tool accuracy.' },
      { term: 'Traces', detail: 'Per-turn events with session IDs — no secrets.' },
    ],
    example: {
      label: 'This app\'s eval suite',
      text: 'Ten scripted scenarios speak synthesized audio into the live model — direct questions, follow-ups, mid-sentence interruptions, out-of-scope asks — and check navigation, timing and grounding automatically.',
      illustrative: false,
    },
    speakerNotes:
      'Text evals show whether the agent reasons correctly; voice evals show whether it works on a real call, because interruptions, timing and speech-recognition errors only appear in audio. Describe this app\'s harness: synthesized caller audio streams into the live model with the same session configuration as production, while checks score navigation, interruption handling, first-audio latency and grounding, and an LLM judge scores the answers against a rubric. Close with compounding reliability: a step that succeeds 95% of the time, chained ten times, completes only about 60% of the time end to end, which is why whole scenarios matter more than single turns.',
    keywords: [
      'evaluation', 'evaluate', 'evals', 'testing', 'test', 'metrics', 'measure', 'quality', 'observability',
      'monitoring', 'tracing', 'reliability', 'scenarios', 'benchmark', 'production', 'regression',
    ],
    sources: [{ label: 'Synthio Labs — Why We Evaluate Voice Agents in Voice', url: 'https://synthiolabs.com/blog/why-we-evaluate-voice-agents-in-voice' }],
    diagram: {
      kind: 'pillars',
      pillars: [
        { label: 'Scenario suites', items: ['Scripted synthetic callers', 'Interruptions & topic switches', 'Run before every change'] },
        { label: 'Voice metrics', items: ['Turn → first-audio latency', 'Interruption recovery', 'Tool & navigation accuracy'] },
        { label: 'Observability', items: ['Per-turn event traces', 'Session-correlated IDs', 'Grounding flags, no secrets'] },
      ],
      stat: { value: '0.95¹⁰ ≈ 60%', caption: 'end-to-end success of ten 95%-reliable steps' },
    },
  },
];

export function getSlide(number: number): Slide | undefined {
  return slides.find((slide) => slide.number === number);
}
