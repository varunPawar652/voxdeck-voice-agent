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

export type DiagramConfig =
  | {
      kind: 'evolution';
      stages: { label: string; era: string; capability: string }[];
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
      kind: 'memory-tiers';
      tiers: { label: string; scope: string; example: string }[];
      pipeline: string[];
    }
  | {
      kind: 'orchestration';
      orchestrator: string;
      workers: { label: string; task: string }[];
      aggregator: string;
      patterns: string[];
    }
  | {
      kind: 'production';
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
  example: { label: string; text: string };
  speakerNotes: string;
  keywords: string[];
  diagram: DiagramConfig;
}

export const PRESENTATION_TITLE = 'How AI Agents Work: From LLMs to Autonomous Systems';

export const slides: readonly Slide[] = [
  {
    id: 'evolution',
    number: 1,
    eyebrow: 'Foundations',
    title: 'From Chatbots to AI Agents',
    summary:
      'Each generation added one capability: understanding language, then taking actions, then pursuing goals across many steps without a human driving each one.',
    keyConcepts: [
      { term: 'Goal-directed', detail: 'Given an outcome, not a script.' },
      { term: 'Action-taking', detail: 'Changes the world through tools and APIs.' },
      { term: 'Iterative', detail: 'Observes results and decides the next step.' },
    ],
    example: {
      label: 'Same request, four eras: "I want a refund for order 1042."',
      text: 'A rule bot links the FAQ. An LLM explains the policy. A tool-using assistant looks up the order. An agent checks eligibility, issues the refund, and emails the receipt.',
    },
    speakerNotes:
      'Frame the talk: the shift is from systems that answer to systems that act. Rule-based bots matched intents to scripts. LLM chat brought fluent language but no ability to act. Function calling let assistants hit APIs on request. Agents wrap the model in a loop so it can plan, act, observe, and repeat until a goal is met. Use the refund example to make the difference concrete.',
    keywords: [
      'evolution', 'history', 'chatbot', 'chatbots', 'difference', 'what is an agent', 'definition',
      'llm vs agent', 'autonomous', 'autonomy', 'introduction', 'overview', 'rule-based', 'generations',
    ],
    diagram: {
      kind: 'evolution',
      stages: [
        { label: 'Rule-based bot', era: '2016', capability: 'Matches intents to scripts' },
        { label: 'LLM chat', era: '2022', capability: 'Understands and writes language' },
        { label: 'Tool-using assistant', era: '2023', capability: 'Calls APIs when asked' },
        { label: 'Autonomous agent', era: '2024+', capability: 'Plans, acts, observes, repeats' },
      ],
    },
  },
  {
    id: 'architecture',
    number: 2,
    eyebrow: 'Architecture',
    title: 'Anatomy of an AI Agent',
    summary:
      'An agent is an LLM inside a control loop. The model decides; ordinary code runs the loop, executes actions, enforces limits, and decides when to stop.',
    keyConcepts: [
      { term: 'Reasoning core', detail: 'The LLM chooses the next action from context.' },
      { term: 'Control loop', detail: 'Observe → think → act, until done or out of budget.' },
      { term: 'Stopping rules', detail: 'Goal reached, step limit, or a human hand-off.' },
    ],
    example: {
      label: 'A coding agent fixing a failing test',
      text: 'Reads the failing output (observe), suspects an off-by-one (think), edits the file and reruns tests (act), reads the new result (observe) — and stops when tests are green or after 10 attempts.',
    },
    speakerNotes:
      'Explain that the model itself is stateless and only predicts the next output. The agent is the system around it: instructions define the role, tools provide actions, memory provides context, and a loop controller feeds observations back in. Emphasize that stopping conditions and budgets are a design decision, not something the model handles on its own. Walk through the coding-agent loop.',
    keywords: [
      'architecture', 'anatomy', 'components', 'loop', 'agent loop', 'react', 'reason', 'plan', 'planning',
      'observe', 'control loop', 'how does an agent work', 'structure', 'design', 'stopping', 'budget',
    ],
    diagram: {
      kind: 'agent-loop',
      core: 'LLM',
      steps: [
        { label: 'Observe', detail: 'Read input & tool results' },
        { label: 'Think', detail: 'Choose next action' },
        { label: 'Act', detail: 'Call a tool or answer' },
      ],
      modules: ['Instructions', 'Tools', 'Memory', 'Guardrails'],
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
      text: 'When you ask about tool calling, the voice model emits navigate_to_slide({ slide_number: 3 }). The browser validates it with Zod, changes the slide, and sends the result back so the model keeps talking.',
    },
    speakerNotes:
      'Walk through the round trip: the developer registers tools with names, descriptions, and parameter schemas. The model decides a tool is needed and returns a function call with a call id and JSON arguments. The application validates the arguments, executes the real API, and sends a function_call_output with the same call id. The model then uses that result in its answer. Point out the meta example: this deck itself is driven by a navigate_to_slide tool. Mention least privilege — only expose the tools the task needs.',
    keywords: [
      'tools', 'tool', 'tool use', 'tool calling', 'function calling', 'functions', 'api', 'apis',
      'json schema', 'arguments', 'actions', 'integration', 'call', 'execute', 'plugins', 'mcp',
    ],
    diagram: {
      kind: 'tool-sequence',
      lanes: ['User', 'LLM', 'Your app', 'External API'],
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
    id: 'memory',
    number: 4,
    eyebrow: 'Context',
    title: 'Memory, Context & Retrieval',
    summary:
      'The context window is the agent\'s working memory — finite and expensive. Retrieval-augmented generation (RAG) fetches only the most relevant knowledge at the moment it is needed.',
    keyConcepts: [
      { term: 'Working memory', detail: 'Whatever fits in the current context window.' },
      { term: 'Long-term memory', detail: 'External stores the agent queries on demand.' },
      { term: 'RAG', detail: 'Retrieve relevant chunks, then answer grounded in them.' },
    ],
    example: {
      label: '"Can I return opened headphones?"',
      text: 'The support agent embeds the question, retrieves the three closest policy passages from 2,000 documents, and answers citing section 4.2 — instead of guessing from training data.',
    },
    speakerNotes:
      'Explain three tiers: the context window holds the current conversation and instructions; short-term memory keeps session history, often summarized to save tokens; long-term memory lives outside the model in a database or vector store. RAG is the pipeline that bridges them: split documents into chunks, embed them, search by similarity, optionally rerank, then inject the best chunks into the prompt. Stress that retrieval quality — not model size — usually limits answer quality.',
    keywords: [
      'memory', 'context', 'context window', 'rag', 'retrieval', 'retrieval augmented generation',
      'vector', 'vector database', 'embeddings', 'embedding', 'knowledge', 'documents', 'search', 'tokens',
      'long-term', 'short-term', 'chunking',
    ],
    diagram: {
      kind: 'memory-tiers',
      tiers: [
        { label: 'Context window', scope: 'This turn', example: 'Instructions + recent messages' },
        { label: 'Session memory', scope: 'This conversation', example: 'Summaries of earlier turns' },
        { label: 'Long-term store', scope: 'Across sessions', example: 'Vector DB, SQL, user profile' },
      ],
      pipeline: ['Chunk', 'Embed', 'Search', 'Rerank', 'Inject'],
    },
  },
  {
    id: 'multi-agent',
    number: 5,
    eyebrow: 'Orchestration',
    title: 'Multi-Agent Workflows',
    summary:
      'Complex work can be split across specialized agents coordinated by an orchestrator. Specialization helps focus — but every hand-off adds latency, cost, and a chance for errors to compound.',
    keyConcepts: [
      { term: 'Orchestrator–workers', detail: 'A planner delegates sub-tasks and merges results.' },
      { term: 'Hand-offs', detail: 'Pass the right context — not the entire history.' },
      { term: 'Use sparingly', detail: 'Start with one agent; split only when it struggles.' },
    ],
    example: {
      label: 'Writing a market research brief',
      text: 'A planner splits the brief into three questions, three researcher agents search in parallel, a writer drafts the report, and a critic agent checks every claim has a citation before it ships.',
    },
    speakerNotes:
      'Describe common patterns: sequential pipelines, routers that send a request to the right specialist, orchestrator–worker fan-out, and evaluator–optimizer loops where a critic reviews output. The orchestrator owns the plan and shared state. Be candid about trade-offs: multi-agent systems are harder to debug, cost more tokens, and errors compound across hand-offs. A good rule is to begin with a single well-tooled agent and split only when distinct skills or parallelism clearly pay off.',
    keywords: [
      'multi-agent', 'multiple agents', 'multi agent', 'collaborate', 'collaboration', 'orchestration',
      'orchestrator', 'workflow', 'workflows', 'handoff', 'hand-off', 'delegation', 'crew', 'swarm',
      'parallel', 'team of agents', 'coordinator', 'planner', 'critic',
    ],
    diagram: {
      kind: 'orchestration',
      orchestrator: 'Orchestrator',
      workers: [
        { label: 'Researcher', task: 'Gathers sources' },
        { label: 'Analyst', task: 'Crunches numbers' },
        { label: 'Writer', task: 'Drafts the report' },
      ],
      aggregator: 'Critic → final answer',
      patterns: ['Pipeline', 'Router', 'Orchestrator–workers', 'Evaluator–optimizer'],
    },
  },
  {
    id: 'production',
    number: 6,
    eyebrow: 'Production',
    title: 'Safety, Evaluation & Observability',
    summary:
      'Shipping an agent is mostly about control. Constrain what it can do, measure how often it succeeds, and trace every step so failures can be explained and fixed.',
    keyConcepts: [
      { term: 'Safety', detail: 'Least-privilege tools, injection defense, human approval.' },
      { term: 'Evaluation', detail: 'Task-success suites run on every change.' },
      { term: 'Observability', detail: 'Trace each step: tokens, latency, cost, errors.' },
    ],
    example: {
      label: 'Why reliability compounds',
      text: 'A step that succeeds 95% of the time, chained ten times, completes the whole task only about 60% of the time. That is why agents need evals, retries, and checkpoints.',
    },
    speakerNotes:
      'Cover three pillars. Safety: prompt injection from retrieved content or tool output is the top risk, so give tools minimal permissions, validate arguments, and require human approval for irreversible actions like payments or deletions. Evaluation: build a golden dataset of real tasks, score task success, and use LLM-as-judge carefully alongside deterministic checks; run it as a regression suite. Observability: log a trace for each run with every model call, tool call, token count, latency, and cost. Close with the compounding reliability statistic.',
    keywords: [
      'production', 'safety', 'security', 'risk', 'risks', 'prompt injection', 'guardrails', 'evaluation',
      'evals', 'testing', 'observability', 'monitoring', 'tracing', 'logging', 'reliability', 'cost',
      'latency', 'hallucination', 'human in the loop', 'deploy', 'challenges',
    ],
    diagram: {
      kind: 'production',
      pillars: [
        { label: 'Safety', items: ['Least-privilege tools', 'Prompt-injection defense', 'Human approval gates'] },
        { label: 'Evaluation', items: ['Golden task datasets', 'Deterministic + LLM judges', 'Regression on every change'] },
        { label: 'Observability', items: ['Per-step traces', 'Tokens, latency, cost', 'Tool error rates'] },
      ],
      stat: { value: '0.95¹⁰ ≈ 60%', caption: 'end-to-end success of ten 95%-reliable steps' },
    },
  },
];

export function getSlide(number: number): Slide | undefined {
  return slides.find((slide) => slide.number === number);
}
