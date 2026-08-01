// Shared shapes for the loop, as JSDoc typedefs. No runtime code — these
// document the contracts every adapter and route agrees on. Keeping them
// in one place is what lets providers stay swappable.

/**
 * @typedef {Object} Trace  A single agent run.
 * @property {string} id
 * @property {string} agentId
 * @property {"ok"|"fail"|"error"} status
 * @property {number} [score]           0–100, if scored at run time
 * @property {number} [latencyMs]
 * @property {number} [costUsd]
 * @property {"real"|"mock"|"demo"|"imported"} [source]
 * @property {string} [provider]
 * @property {string} [modelId]
 * @property {number} [inputTokens]
 * @property {number} [outputTokens]
 * @property {number} [totalTokens]
 * @property {string} [agentVersion]    mutable label only; not an approved Convex agentVersionId
 * @property {string} [artifactDigest]  SHA-256 of server-owned runtime artifact bytes
 * @property {"sha256"} [artifactDigestAlgorithm]
 * @property {string} [outputDigest]    SHA-256 of output; output text is never stored
 * @property {"sha256"} [outputDigestAlgorithm]
 * @property {string} ts                ISO timestamp
 * @property {Object} [metadata]
 */

/**
 * @typedef {Object} TraceFeedback  One human rating of one persisted run.
 * @property {string} id
 * @property {string} agentId
 * @property {string} traceId
 * @property {1|2|3|4|5} rating
 * @property {string} [notes]  Reviewer judgement of the agent, not run payload.
 * @property {string} createdAt
 */

/**
 * @typedef {Object} EvalRecord  One human/automated evaluation, append-only.
 * @property {string} date
 * @property {"Performing well"|"Needs improvement"|"Under review"} status
 * @property {number|null} score
 * @property {string} notes
 * @property {string} [knownIssues]
 * @property {string} [by]
 * @property {string} [traceUrl]
 */

/**
 * @typedef {Object} Proposal  A proposed improvement awaiting human review.
 * @property {string} id
 * @property {string} source            e.g. "GEPA", "heuristic"
 * @property {string} summary
 * @property {string} detail
 * @property {string} [diff]            prompt/skill diff, when the optimizer returns one
 * @property {number} [expectedGain]    estimated points on the target metric
 * @property {"proposed"|"approved"|"rejected"} status
 * @property {string} date
 * @property {Object} [evidence]        traces/signals the proposal was derived from
 */

/**
 * @typedef {Object} GoldenCase  A pass/fail eval contract from a real artefact.
 * @property {string} input       trigger / input
 * @property {string} expected    expected output
 * @property {string} rule        pass/fail rule
 * @property {string} [source]    source artefact (path / url)
 */

/**
 * @typedef {Object} FailureClass  A named failure mode with an acceptable rate.
 * @property {string} class
 * @property {string} acceptableRate
 * @property {string} guardrail
 */

/**
 * Autonomy ladder (from SPF's eval-first spec). Promotion only via eval result,
 * not vibe. The loop's auto-apply policy keys off this per agent.
 *   L0 assist only · L1 suggest+confirm · L2 act narrow+audit ·
 *   L3 act broad+exception queue · L4 autonomous
 * @typedef {"L0"|"L1"|"L2"|"L3"|"L4"} AutonomyLevel
 */

/**
 * @typedef {Object} Agent  Mirror of the directory record (four pillars).
 * @property {string} id
 * @property {string} name
 * @property {string} objective
 * @property {string} [prompt]          export/display text only; runtimes never execute it
 * @property {string} version
 * @property {string[]} [skills]
 * @property {string[]} [tools]
 * @property {string[]} [context]
 * @property {AutonomyLevel} [autonomyLevel]
 * @property {GoldenCase[]} [goldenCases]      the scorable eval set
 * @property {FailureClass[]} [failureClasses]
 * @property {{target?:number, actual?:number}} [costPerOutcome]  USD to the cent
 */

/**
 * LoopContract — every loop must state one, or it's busywork (SPF doctrine).
 * @typedef {Object} LoopContract
 * @property {string} goal              one measurable outcome
 * @property {string} doneWhen          explicit exit condition
 * @property {number} maxIterations     hard cap (default 3–5)
 * @property {string[]} forbiddenMoves  must-nots; children inherit these
 * @property {string[]} artifacts       what gets written back
 * @property {"taste"|"money"|"irreversible"|"none"} humanGate
 */

/**
 * Invocation — HOW you actually use an agent. The directory owns the agent
 * definition; platforms are interchangeable runtimes. Three tiers:
 *   link    — open where it lives (Claude project, Cursor workspace) + deep link
 *   prompt  — portable: export the definition as a prompt / SKILL.md, paste anywhere
 *   http | mock | runtime — the server can run it and record a trace
 *   mcp — configuration stub; prepared handoff only until wired
 * @typedef {Object} Invocation
 * @property {"link"|"prompt"|"http"|"mcp"|"runtime"|"mock"} type
 * @property {"single-shot"} [mode]
 * @property {string} [url]      deep link (link) or endpoint (http)
 * @property {string} [artifact] descriptive server-owned artifact pointer
 */

/**
 * @typedef {"hosted-run"|"download-install"|"prepared-handoff"|"approval-queue"} UsabilityMode
 * Agent-level UI capabilities. Separate from the scalar Invocation adapter.
 */

/**
 * Invoker — runs an agent where it lives and returns output. Adapters per tier.
 * @typedef {Object} Invoker
 * @property {string} name
 * @property {"single-shot"} [mode]
 * @property {boolean} serverRun  can the server invoke it now?
 * @property {() => boolean} [isConfigured]
 * @property {(agent:Agent) => Promise<boolean>} [canInvoke]
 * @property {(agent:Agent) => string|null} [artifactDigest]
 * @property {(agent:Agent) => "sha256"|null} [artifactDigestAlgorithm]
 * @property {(agent:Agent, inputs:Object) => Promise<{output:string, artifactDigest?:string, artifactDigestAlgorithm?:"sha256", costUsd?:number, provider?:string, modelId?:string, inputTokens?:number, outputTokens?:number, totalTokens?:number, latencyMs?:number}>} invoke
 */

/**
 * @typedef {Object} Learning  Append-only note when a loop learns or stops.
 * @property {string} id
 * @property {string} date
 * @property {string} loop
 * @property {string} [agentId]
 * @property {string} title
 * @property {string} context
 * @property {string} learning
 * @property {string} [doNot]
 */

/**
 * ObservabilityProvider — every adapter implements this interface.
 * @typedef {Object} ObservabilityProvider
 * @property {string} name
 * @property {() => Promise<{ok:boolean, detail?:string}>} health
 * @property {(t:Trace) => Promise<Trace>} recordTrace
 * @property {(agentId:string, opts?:{limit?:number}) => Promise<Trace[]>} listTraces
 * @property {(agentId:string, opts?:{limit?:number}) => Promise<Trace[]>} getFailingTraces
 */

/**
 * Optimizer — every self-improvement adapter implements this interface.
 * @typedef {Object} Optimizer
 * @property {string} name
 * @property {() => Promise<{ok:boolean, detail?:string}>} health
 * @property {(agent:Agent, traces:Trace[], latestEval?:EvalRecord) => Promise<Proposal>} propose
 */

/**
 * @typedef {Object} MemoryItem  A single piece of context/memory.
 * @property {string} id
 * @property {string} content
 * @property {number} [score]           relevance, on search results
 * @property {Object} [metadata]
 * @property {string} [ts]
 */

/**
 * MemoryProvider — the Context pillar. Every memory backend implements this.
 * `namespace` scopes memory (e.g. "agent:A2" or "fellow:sarah").
 * @typedef {Object} MemoryProvider
 * @property {string} name
 * @property {() => Promise<{ok:boolean, detail?:string}>} health
 * @property {(namespace:string, item:{content:string, metadata?:Object, id?:string}) => Promise<MemoryItem>} ingest
 * @property {(namespace:string, query:string, opts?:{limit?:number}) => Promise<MemoryItem[]>} search
 */

export {}; // module marker
