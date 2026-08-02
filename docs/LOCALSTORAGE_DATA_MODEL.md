# localStorage Data Model Audit

Reference for porting the Agents Directory front-end store to Convex.  
Source of truth: `app.js` (seed, `persist` / `hydrate`, forms). No code was changed for this audit.

**Scope:** browser `localStorage` only. The optional `server/` file store is a *separate* persistence layer and is noted only where it overlaps agent fields.

---

## 1. localStorage keys

| Key | Written by | Purpose |
|-----|------------|---------|
| `utopia_agents_dir_v2` | `persist()` / `hydrate()` / `resetData()` | **Primary app blob** — agents, requests, ID counters |
| `directory_api_base` | Manual / deploy docs (`api.js` *reads* it) | Optional override for loop API base URL (not part of catalog data) |

There is **no** `v1` key in current code. The `_v2` suffix marks the four-pillar schema break (flat eval fields → `evalHistory`, `integrations` → `tools`, etc.).

**Not persisted** (in-memory `state` only): `view`, `subTab`, `agent`, `catFilter`, `statusFilter`, `modal`, `editingAgent`, `pendingRequestId`.

---

## 2. Top-level blob shape

```ts
{
  agents: Agent[],
  requests: Request[],
  nextAgentNum: number,       // starting point for the next "A{n}" mint
  nextReqNum: number,         // next id suffix for "R{n}"
  reservedAgentIds: string[]  // agent ids observed as known to the loop service (collision mitigation, not a reservation)
}
```

Serialized with `JSON.stringify` / deserialized with `JSON.parse`. No migrations, schema version field, or field defaults on load — whatever was saved is what you get.

---

## 3. `persist()` and `hydrate()`

```js
const STORE_KEY = "utopia_agents_dir_v2";

function persist() {
  try {
    localStorage.setItem(
      STORE_KEY,
      JSON.stringify({ agents, requests, nextAgentNum, nextReqNum, reservedAgentIds })
    );
  } catch (e) {}
}

function hydrate() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY));
    if (s && Array.isArray(s.agents)) {
      agents = s.agents;
      requests = s.requests;
      nextAgentNum = s.nextAgentNum;
      nextReqNum = s.nextReqNum;
      reservedAgentIds = Array.isArray(s.reservedAgentIds) ? s.reservedAgentIds : [];
      // (server-owned display-field migrations elided — see app.js)
      return;
    }
  } catch (e) {}
  agents = JSON.parse(JSON.stringify(SEED_AGENTS));
  requests = JSON.parse(JSON.stringify(SEED_REQUESTS));
  nextAgentNum = agents.length + 1;
  nextReqNum = requests.length + 1;
  persist();
}
```

| Concern | Behavior |
|---------|----------|
| Load success | Requires `s.agents` to be an array; then assigns the stored fields (`reservedAgentIds` defaults to `[]` when absent) |
| Load miss / corrupt | Deep-clones `SEED_AGENTS` / `SEED_REQUESTS`, sets counters to `length + 1`, then `persist()` |
| Reset | `resetData()` removes the key, then `hydrate()` (re-seeds) |
| Quota / private mode | `persist` swallows errors — silent no-op |

There is **no** function named `load()`; hydration is `hydrate()`.

---

## 4. Relationships

```
Request.shippedAgentId  ──optional──▶  Agent.id
state.pendingRequestId  ──session──▶  Request.id   (not in localStorage)
Agent.evalHistory[]     ──embedded──▶  EvalRecord   (not a top-level collection)
Agent.changelog[]       ──embedded──▶  ChangelogEntry
Agent.proposedImprovement ──embedded──▶ Proposal | null
```

| Relationship | How it works |
|--------------|--------------|
| Request → Agent | On successful “Ship as agent”, `saveNewAgent()` sets `request.status = "Shipped"` and `request.shippedAgentId = "A{n}"` for the new agent |
| Agent → Request | No back-pointer on the agent |
| Evals | Always nested under `agent.evalHistory`; UI “current eval” = last array element (`latestEval`) |
| IDs | Requests: `"R" + nextReqNum++`. Agents: `mintAgentId()` — the floor is derived from every id observed as taken (local agents plus `reservedAgentIds`), so a stale counter cannot reissue an id already in use |
| Reserved agent IDs | `refreshReservedAgentIds()` reads `GET /api/agents` and caches the ids the loop service currently knows about. Agent ids are one namespace: a browser-minted `A8` would resolve against the service's A8 record, so evals and proposals would land on someone else's agent. **This is a temporary collision mitigation, not an atomic reservation** — `GET /api/agents` observes known ids, it does not reserve one. When the loop service is reachable and responds before minting, the browser avoids ids currently known to it; `saveNewAgent()` re-observes the set immediately before minting and refuses if the service does not answer. Convex becomes the sole allocator in Phase 5 |

---

## 5. Agent

Evals are **not** a separate localStorage structure; they live on the agent.

### 5.1 Field catalog

Legend for **Origin**:
- **Original** — present in pre–four-pillar catalog (`main` before `541e249`)
- **Four-pillar** — added by the four-pillar / loop rebuild
- **Replaced** — original field removed or reshaped

| Field | Type | Required? | Origin | Notes |
|-------|------|-----------|--------|-------|
| `id` | `string` | yes (system) | Original | `"A1"`, `"A2"`, … |
| `name` | `string` | yes (form) | Original | max 40 in UI |
| `tagline` | `string` | yes (form) | Original | max 120 in UI |
| `description` | `string` | no | Original | often `""` in seed |
| `platform` | `string` | yes (form) | Original | enum: Claude, Cursor, Manus, ChatGPT, n8n, Custom, Other |
| `status` | `string` | yes (form) | Original | Experimental, Active, Under Review, Deprecated |
| `category` | `string` | yes (form) | Original | see CATEGORIES |
| `owner` | `string` | yes (form) | Original | |
| `initials` | `string` | yes (derived) | Original | from `owner` via `getInitials` |
| `when` | `string` | yes (form) | Original | “When to use” |
| `sop` | `string` | yes (form) | Original | multiline steps |
| `inputs` | `string[]` | no | Original | |
| `outputs` | `string[]` | no | Original | |
| `accessUrl` | `string` | no | Original | |
| `repoUrl` | `string` | no | Original | |
| `model` | `string` | no | Four-pillar | e.g. `"Claude Opus 4.x"` |
| `version` | `string` | no (defaults `"1.0"`) | Four-pillar | bumped on approve / edit |
| `objective` | `string` | yes (form) | Four-pillar · **Goals** | |
| `successCriteria` | `string[]` | no | Four-pillar · **Goals** | |
| `guardrails` | `string[]` | no | Four-pillar · **Goals** | |
| `autonomyLevel` | `"L0"\|"L1"\|"L2"\|"L3"\|"L4"` | no (form defaults L1) | Four-pillar · **Goals** | only A2 seed sets explicitly |
| `goldenCases` | `GoldenCase[]` | no | Four-pillar · **Goals** | seed-only; **not in add/edit form** |
| `failureClasses` | `FailureClass[]` | no | Four-pillar · **Goals** | seed-only; **not in form** |
| `costPerOutcome` | `{ target?: number, actual?: number }` | no | Four-pillar · **Goals** | seed-only (A2); **not in form** |
| `skills` | `string[]` | no | Four-pillar · **Skills** | |
| `tools` | `string[]` | no | Four-pillar · **Tools** | replaces `integrations` |
| `context` | `string[]` | no | Four-pillar · **Context** | declared knowledge labels (not live memory rows) |
| `evalHistory` | `EvalRecord[]` | yes (system, may be `[]`) | Four-pillar | replaces flat eval fields |
| `changelog` | `ChangelogEntry[]` | yes (system) | Four-pillar | |
| `proposedImprovement` | `Proposal \| null` | yes (system) | Four-pillar | loop hook |

### 5.2 Removed / replaced original fields

| Old field | Type | What happened |
|-----------|------|----------------|
| `evalStatus` | `string` | → derived from `latestEval(a).status` or `"Not evaluated"` |
| `evalNotes` | `string` | → `evalHistory[].notes` |
| `knownIssues` | `string` (top-level) | → `evalHistory[].knownIssues` |
| `lastReviewed` | `string` | → `evalHistory[].date` |
| `integrations` | `string[]` | → `tools[]` (same idea: Slack, Figma, …) |

### 5.3 Nested: EvalRecord (`evalHistory[]`)

| Field | Type | Required? | Notes |
|-------|------|-----------|-------|
| `date` | `string` | yes | ISO date `YYYY-MM-DD` when logged via UI |
| `status` | `string` | yes | Performing well / Needs improvement / Under review (form); seed uses same |
| `score` | `number \| null` | no | clamped 0–100; `null` if blank/NaN |
| `notes` | `string` | yes (form) | |
| `knownIssues` | `string` | no | |
| `by` | `string` | no | reviewer name |
| `traceUrl` | `string` | no | |

### 5.4 Nested: ChangelogEntry (`changelog[]`)

| Field | Type | Required? |
|-------|------|-----------|
| `version` | `string` | yes |
| `date` | `string` | yes |
| `note` | `string` | yes |

### 5.5 Nested: Proposal (`proposedImprovement`)

| Field | Type | Required? | Origin |
|-------|------|-----------|--------|
| `source` | `string` | yes | Four-pillar |
| `date` | `string` | yes | |
| `status` | `"proposed" \| "approved" \| "rejected"` | yes | UI mostly uses `"proposed"` then clears |
| `summary` | `string` | yes | |
| `detail` | `string` | yes | |
| `id` | `string` | no | server proposals may include |
| `diff` | `string` | no | GEPA |
| `expectedGain` | `number` | no | |
| `evidence` | `object` | no | |
| `verdict` | `Verdict` | no | attached by server checker; UI can display |

**Verdict** (when present):

| Field | Type |
|-------|------|
| `verdict` | `"ship" \| "hold" \| "reject"` |
| `confidence` | `number` |
| `reasons` | `string[]` |
| `by` | `string` |

### 5.6 Nested: GoldenCase / FailureClass (seed / display only)

**GoldenCase**

| Field | Type | Required? |
|-------|------|-----------|
| `input` | `string` | yes |
| `expected` | `string` | yes |
| `rule` | `string` | yes |
| `source` | `string` | no |

**FailureClass**

| Field | Type | Required? |
|-------|------|-----------|
| `class` | `string` | yes |
| `acceptableRate` | `string` | yes |
| `guardrail` | `string` | yes |

### 5.7 Example agent (seed `A2` — Bio Generator)

Fully populated four-pillar example, including the only seeded `proposedImprovement`:

```json
{
  "id": "A2",
  "name": "Bio Generator",
  "tagline": "Creates SEO-optimized LinkedIn bios with CTA language. Tries to learn the fellow's voice over time.",
  "description": "",
  "platform": "Claude",
  "status": "Active",
  "category": "Personal Branding",
  "owner": "Sarah",
  "initials": "SA",
  "model": "Claude Sonnet 4.x",
  "version": "1.0",
  "objective": "Produce three on-voice bio options a fellow would ship with light edits, not a rewrite.",
  "successCriteria": [
    "Fellow ships one of the three variants",
    "CTA judged 'on-brand, not pushy'",
    "Voice-match rated ≥4/5 by owner"
  ],
  "guardrails": [
    "No aggressive/salesy CTAs",
    "Match the fellow's register — never default to corporate boilerplate"
  ],
  "autonomyLevel": "L1",
  "goldenCases": [
    {
      "input": "Founder bio, casual voice, 2 sample sentences",
      "expected": "3 variants, first-person, ≤1 CTA, no buzzwords",
      "rule": "voice-match ≥4/5 AND no banned buzzword",
      "source": "fellow:sarah/bio-v1"
    },
    {
      "input": "No voice samples provided",
      "expected": "Agent asks for 2 anchor sentences before generating",
      "rule": "must not generate without anchors",
      "source": "incident 2026-07-08"
    }
  ],
  "failureClasses": [
    {
      "class": "voice mismatch",
      "acceptableRate": "<10%",
      "guardrail": "require ≥2 voice-anchor sentences"
    },
    {
      "class": "aggressive CTA",
      "acceptableRate": "0%",
      "guardrail": "score CTA against confident-not-pushy rubric"
    }
  ],
  "costPerOutcome": { "target": 0.03 },
  "when": "When a fellow needs a new or refreshed LinkedIn bio.",
  "sop": "1. Gather the fellow's current bio, role, and goals\n2. Open Bio Generator project in Claude\n3. Provide context and ask for bio options\n4. Iterate on tone and voice match",
  "inputs": ["Fellow's current bio", "Role description", "Target audience"],
  "outputs": ["3 bio variations", "SEO keyword suggestions"],
  "skills": ["copywriting", "seo-writing", "value-prop-statements"],
  "tools": [],
  "context": ["Fellow's current bio", "Studio voice glossary"],
  "accessUrl": "",
  "repoUrl": "",
  "evalHistory": [
    {
      "date": "2026-07-08",
      "status": "Needs improvement",
      "score": 58,
      "notes": "CTAs sometimes too aggressive. Voice matching inconsistent without enough examples.",
      "knownIssues": "Tends toward generic corporate language without strong examples.",
      "by": "Sarah",
      "traceUrl": ""
    }
  ],
  "changelog": [
    { "version": "1.0", "date": "2026-06-30", "note": "Initial build." }
  ],
  "proposedImprovement": {
    "source": "GEPA (stub)",
    "date": "2026-07-15",
    "status": "proposed",
    "summary": "Add a voice-anchoring step + a CTA-tone rubric to the prompt.",
    "detail": "Traces show failures cluster when no example bio is supplied. Proposed: (1) require ≥2 of the fellow's own sentences as voice anchors before generating; (2) score each CTA against a 'confident-not-pushy' rubric and regenerate any that fail. Est. +18 pts on voice-match in offline eval."
  }
}
```

Simpler original-shaped agent with goals/skills filled but no golden cases: seed `A1` (LinkedIn Auditor).

---

## 6. Request

### 6.1 Field catalog

| Field | Type | Required? | Origin | Notes |
|-------|------|-----------|--------|-------|
| `id` | `string` | yes (system) | Original | `"R1"`, … |
| `title` | `string` | yes (form) | Original | |
| `desc` | `string` | yes (form) | Original | |
| `requestedBy` | `string` | yes (form) | Original | |
| `date` | `string` | yes (system) | Original | **Display locale string**, e.g. `"Jul 15, 2026"` — not ISO |
| `priority` | `string` | yes | Original | Nice to have / Important / Urgent |
| `status` | `string` | yes | Original | Requested / Approved / In Progress / Shipped / Declined |
| `notes` | `string` | no | Original | |
| `assignee` | `string` | no | Original (triage) | seed always includes `""` or a name |
| `shippedAgentId` | `string \| null` | no | Four-pillar | FK → `Agent.id` when shipped |

### 6.2 Example request (seed `R2`)

```json
{
  "id": "R2",
  "title": "Onboarding Agent",
  "desc": "Guide new fellows through their first 2 weeks — checklist, introductions, setup tasks.",
  "requestedBy": "Sarah",
  "date": "Jul 14, 2026",
  "priority": "Urgent",
  "status": "In Progress",
  "assignee": "Haia",
  "notes": "Deciding whether this is a workflow or an agent.",
  "shippedAgentId": null
}
```

---

## 7. Form → stored transformations

### 7.1 Agent (`readAgentForm` → `saveNewAgent` / `saveEditAgent`)

| Form control | Transform | Stored field |
|--------------|-----------|--------------|
| `#f-name` | `.trim()` | `name` |
| `#f-tagline` | `.trim()` | `tagline` |
| `#f-desc` | `.trim()` | `description` |
| `#f-objective` | `.trim()` | `objective` |
| `#f-success` | `parseLines` — split on `\n`, strip leading `-`/`•`/digits/`.,` trim, drop empties | `successCriteria[]` |
| `#f-guardrails` | `parseLines` | `guardrails[]` |
| `#f-autonomy` | select value | `autonomyLevel` |
| `#f-platform` / `#f-status` / `#f-category` | select | same |
| `#f-owner` | `.trim()` | `owner` |
| (derived) | `getInitials(owner)` | `initials` |
| `#f-model` / `#f-version` | `.trim()` | `model` / `version` |
| `#f-when` / `#f-sop` | `.trim()` | `when` / `sop` |
| `#f-inputs` / `#f-outputs` / `#f-skills` / `#f-tools` / `#f-context` | `parseCSV` — split `,`, trim, drop empties | `string[]` |
| `#f-access` / `#f-repo` | `.trim()` | `accessUrl` / `repoUrl` |

**Required for save** (`validAgent`): `name`, `tagline`, `objective`, `when`, `sop`, `category`, `owner`.

**On create only**, system merges:

```js
{
  id: mintAgentId(),   // above every id observed as taken; see §4
  initials: getInitials(f.owner),
  version: f.version || "1.0",
  evalHistory: [],
  changelog: [{ version, date: today ISO, note: "Registered in directory." }],
  proposedImprovement: null,
  ...formFields
}
```

**On edit:** `Object.assign(agent, form, { initials })`. Preserves `evalHistory`, `changelog`, `proposedImprovement`, and any seed-only fields (`goldenCases`, …) because they are not in the form payload. If `version` changes, appends a changelog row.

**Not editable in UI (survive only if already on the object):** `goldenCases`, `failureClasses`, `costPerOutcome`, `id`, `evalHistory` (except via eval modal), `proposedImprovement` (except via loop actions).

### 7.2 Request create

| Form | Transform | Stored |
|------|-----------|--------|
| `#r-title` | trim | `title` |
| `#r-desc` | trim | `desc` |
| `#r-name` | trim | `requestedBy` |
| `#r-priority` | select | `priority` |
| (system) | `toLocaleDateString("en-US", { month:"short", day:"numeric", year:"numeric" })` | `date` |
| (system) | | `status: "Requested"`, `notes: ""`, `assignee: ""`, `shippedAgentId: null` |

### 7.3 Request triage

Direct assign: `status`, `priority`, `assignee` (trim), `notes` (trim). Does not touch `shippedAgentId`.

### 7.4 Eval log (`saveEval`)

| Form | Transform | Stored on new `evalHistory` entry |
|------|-----------|-----------------------------------|
| `#e-status` | select | `status` |
| `#e-score` | `parseInt`; NaN → `null`; else clamp 0–100 | `score` |
| `#e-by` | trim | `by` |
| `#e-trace` | trim | `traceUrl` |
| `#e-notes` | trim (required) | `notes` |
| `#e-issues` | trim | `knownIssues` |
| `#e-date` | if present in DOM; else today ISO | `date` |

Note: current eval modal HTML does **not** render `#e-date`; date always falls back to today ISO.

### 7.5 Ship request → agent prefills

`shipRequestAsAgent` opens add-agent modal with:

- `name` = `title` with trailing `" Agent"` stripped  
- `tagline` = `desc.slice(0, 120)`  
- `description` = full `desc`  
- `owner` = `assignee` or `""`  
- empty goals/SOP/skills/tools/context arrays  

On save, request gets `status: "Shipped"` and `shippedAgentId` pointing at the new agent id.

### 7.6 Propose / approve / reject (mutates agent in place)

| Action | localStorage effect |
|--------|---------------------|
| Propose (offline) | Sets templated `proposedImprovement` |
| Propose (API) | Copies `source`, `date`, `status`, `summary`, `detail` from API (drops `diff` / `verdict` / `evidence` unless later synced) |
| Approve (offline) | `bumpVersion`, push changelog, clear proposal |
| Approve (API) | Sets `version` (+ optional `changelog` from API), clears proposal |
| Reject | Sets `proposedImprovement = null` |

---

## 8. What is *not* in localStorage

These exist on the **server file store** (or API only) when `server/` is running — they are **not** written by `persist()`:

- Traces  
- Loop runs / learnings / research queue  
- Live memory documents (Supermemory / Activeloop / local memory namespace)  
- Separate agent copies on the server (may diverge from the browser blob)

A8 is now in `SEED_AGENTS` and is inserted on hydrate when missing, so the catalogue card and prepared-handoff briefing affordance appear. Hand-entered fields on other browser-owned records remain visible only in the browser that entered them until Convex owns the catalog. The `reservedAgentIds` mechanism (§4) only *mitigates* id collisions while the service is reachable; it is not an allocator and does not guarantee uniqueness. Convex becomes the sole id allocator in Phase 5.

Convex port of the **directory UI** should treat `utopia_agents_dir_v2` as the migration source; plan a second phase for loop server collections.

---

## 9. Convex porting notes (from this audit)

1. **Two top-level tables** map cleanly: `agents`, `requests`. Consider `evals` as a child table keyed by `agentId` if you want indexing — today they are embedded arrays.  
2. **Embedded arrays** (`evalHistory`, `changelog`, `goldenCases`, …) are fine as Convex document fields or separate tables; UI assumes latest eval = last history entry.  
3. **ID strategy:** replace `"A"+n` / `"R"+n` + counters with Convex `_id` (or keep string ids as a field for continuity). Browser-minted ids deliberately stay in the `A<n>` shape Convex's `nextDisplayId` matches (`^A(\d+)$`) and are minted above the ids currently observed from the loop service, so no identifier needs renaming during the migration. `reservedAgentIds` is an observation cache, not catalog data and not a reservation — drop it in Phase 5, when Convex becomes the sole id allocator.
4. **Normalize dates:** request `date` is locale display text; eval/changelog dates are ISO — pick one convention.  
5. **Schema gaps:** `goldenCases` / `failureClasses` / `costPerOutcome` are in seed + detail UI but not in forms — decide if Convex should expose editors.  
6. **`directory_api_base`** is config, not catalog data.  
7. **No migration path** from old flat-eval objects; anyone with ancient in-memory-only data never had localStorage. Current key is already `v2`.

---

## 10. Quick origin summary

| Bucket | Fields |
|--------|--------|
| **Original catalog** | `id`, `name`, `tagline`, `description`, `platform`, `status`, `category`, `owner`, `initials`, `when`, `sop`, `inputs`, `outputs`, `accessUrl`, `repoUrl`; request core fields; (removed) `evalStatus`, `evalNotes`, `knownIssues`, `lastReviewed`, `integrations` |
| **Four-pillar Goals** | `objective`, `successCriteria`, `guardrails`, `autonomyLevel`, `goldenCases`, `failureClasses`, `costPerOutcome` |
| **Four-pillar Skills / Tools / Context** | `skills`, `tools`, `context` |
| **Four-pillar loop / versioning** | `model`, `version`, `evalHistory`, `changelog`, `proposedImprovement`; request `shippedAgentId` |
