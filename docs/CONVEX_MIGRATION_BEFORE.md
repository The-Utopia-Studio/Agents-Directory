# Convex Migration — Before Audit

Pre-migration snapshot of how the **prototype** derives and displays data from localStorage.  
Code under audit: `app.js` (current `main`). The prototype is unchanged by this migration work.

> **Note on `docs/LOCALSTORAGE_DATA_MODEL.md`:** that file is no longer in the repo. Shapes below were re-verified directly against `app.js` seed data, `persist` / `hydrate`, and form writers on 2026-07-27. They match what that audit documented.

---

## 1. localStorage shapes (confirmed)

### Key

| Key | Value |
|-----|--------|
| `utopia_agents_dir_v2` | `{ agents, requests, nextAgentNum, nextReqNum }` |
| `directory_api_base` | Optional API base URL (config only; not catalog data) |

### Blob

```ts
{
  agents: Agent[],
  requests: Request[],
  nextAgentNum: number,
  nextReqNum: number
}
```

`persist()` JSON-stringifies that object. `hydrate()` is the loader (there is no `load()`). On miss/corrupt data it deep-clones `SEED_AGENTS` / `SEED_REQUESTS` and sets counters to `length + 1`.

### Agent (stored)

Identity / catalog: `id`, `name`, `tagline`, `description?`, `platform`, `status`, `category`, `owner`, `initials`, `model?`, `version?`, `when`, `sop`, `inputs[]`, `outputs[]`, `accessUrl?`, `repoUrl?`

Goals: `objective`, `successCriteria[]`, `guardrails[]`, optional `autonomyLevel`, `goldenCases[]`, `failureClasses[]`, `costPerOutcome`

Pillars: `skills: string[]`, `tools: string[]`, `context: string[]`

Loop: `evalHistory: EvalRecord[]`, `changelog[]`, `proposedImprovement: Proposal | null`

### EvalRecord (embedded in `evalHistory`)

`date`, `status`, `score: number | null`, `notes`, `knownIssues?`, `by?`, `traceUrl?`

### Request (stored)

`id`, `title`, `desc`, `requestedBy`, `date` (**locale display string**, e.g. `"Jul 15, 2026"`), `priority`, `status`, `notes`, `assignee`, `shippedAgentId: string | null` → `Agent.id`

### Relationships

- `Request.shippedAgentId` → `Agent.id` (optional)
- Evals are **not** a top-level collection — nested under the agent
- `state.pendingRequestId` is **in-memory only** (not persisted)

---

## 2. Derived / computed UI values

None of these are stored in localStorage. They must be reproduced in Convex (as queries and/or denormalized fields).

### 2.1 Fleet-health strip (`fleetHealth()` → `renderHealthStrip()`)

| Strip label | Returned field | Formula |
|-------------|----------------|---------|
| Fleet health · avg eval score | `avg` | Among agents with a latest eval **and** a numeric `score`, round(mean). If no numeric scores → `0` |
| Eval coverage | `coverage` | `round(evaluated / total * 100)` where `evaluated` = agents with non-empty `evalHistory` (any latest eval), `total` = `agents.length` |
| Need review · weak · stale · unevaluated | `needsReview` | Count of agents matching the need-review predicate (below) |
| Improvements · awaiting approval | `proposals` | Count where `proposedImprovement?.status === "proposed"` |

Also returned but only used in the coverage subtitle: `evaluated`, `total`.

### 2.2 Need-review predicate (“weak · stale · unevaluated”)

An agent **needs review** if **any** of:

| Label (UI copy) | Condition in code |
|-----------------|-------------------|
| **Unevaluated** | No latest eval (`evalHistory` empty / missing) |
| **Weak** | Latest eval `status === "Needs improvement"` **OR** `score < 70` |
| **Stale** | `daysSince(latestEval.date) > 30` |

Important JS quirks to preserve:

- `score < 70` is true when `score` is `null` (`null` coerces to `0`). So a logged eval with a blank score still counts as weak.
- `daysSince` uses `Math.floor((Date.now() - date) / 86400000)`; invalid dates → `Infinity` (also “stale”).
- The UI does **not** tag individual cards as weak/stale — only the aggregate count uses that language.

### 2.3 Latest-eval score & status on cards

Per card / detail header:

```js
const e = latestEval(a); // last element of evalHistory, or null
agentEvalStatus(a) → e ? e.status : "Not evaluated"
// display: (e.score is number ? `${e.score} · ` : "") + status
```

Also on detail: `Last reviewed: formatDate(e.date)` when `e` exists.

### 2.4 Other derived display (for parity)

| UI | Derivation |
|----|------------|
| Card / detail version | `a.version \|\| "1.0"` |
| Initials avatar | Stored on agent, but written as `getInitials(owner)` on save |
| Sub-tab request badge | Count where `status` ∉ `{Declined, Shipped}` |
| Improvement pending pill | `proposedImprovement?.status === "proposed"` |
| Request “→ shipped as …” | `shippedAgentId` truthy |

---

## 3. Category (and status) filter chips

**Not** from the fixed `CATEGORIES` enum.

```js
const cats = ["All", ...new Set(agents.map(a => a.category))];
const stats = ["All", ...new Set(agents.map(a => a.status))];
```

- Chips = **"All" + distinct values present on agents in the store**, insertion order of first occurrence.
- The fixed `CATEGORIES` / `STATUS_OPTIONS` arrays are used only in the **add/edit form** `<select>`s.
- Filtering: exact match on `a.category` / `a.status` when chip ≠ `"All"`.

**Convex implication:** `getActiveCategories` (and, for parity, active statuses) must be derived from agents present — not the static enum.

---

## 4. Requests view grouping

```js
const groups = {
  "In Progress": [],
  "Approved": [],
  "Requested": [],
  "Shipped": [],
  "Declined": [],
};
requests.forEach(r => { if (groups[r.status]) groups[r.status].push(r); });
```

| Section | Statuses | Empty behavior |
|---------|----------|----------------|
| Active (no divider) | In Progress → Approved → Requested | Group omitted if empty (`grp` returns `""`) |
| **RESOLVED** divider | Shipped → Declined | Entire resolved block omitted if both empty; each group omitted if empty |

Within a group, order = order of `requests` array (no secondary sort). Unknown statuses are dropped.

---

## 5. Implications for Convex (carry into Phase 2)

1. Evals as their own table enable fleet-health / staleness without loading every agent’s full history — denormalize latest onto the agent for cards.
2. Preserve need-review semantics: unevaluated **or** status Needs improvement **or** score `< 70` (including null) **or** review older than 30 days.
3. Category chips = categories that have ≥1 agent.
4. Request sections stay a fixed status order, not a free-form group-by.
5. Normalize request `date` to ISO in storage; format for display at render time.
