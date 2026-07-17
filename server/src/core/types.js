// Shared shapes for the loop, as JSDoc typedefs. No runtime code — these
// document the contracts every adapter and route agrees on. Keeping them
// in one place is what lets providers stay swappable.

/**
 * @typedef {Object} Trace  A single agent run.
 * @property {string} id
 * @property {string} agentId
 * @property {string} [input]
 * @property {string} [output]
 * @property {"ok"|"fail"|"error"} status
 * @property {number} [score]           0–100, if scored at run time
 * @property {number} [latencyMs]
 * @property {number} [costUsd]
 * @property {string} [failureReason]   short tag — what the optimizer clusters on
 * @property {string} ts                ISO timestamp
 * @property {Object} [metadata]
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
 * @typedef {Object} Agent  Mirror of the directory record (four pillars).
 * @property {string} id
 * @property {string} name
 * @property {string} objective
 * @property {string} [prompt]          current system prompt, if tracked here
 * @property {string} version
 * @property {string[]} [skills]
 * @property {string[]} [tools]
 * @property {string[]} [context]
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
