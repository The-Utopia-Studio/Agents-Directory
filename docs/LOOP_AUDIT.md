# Loop & Scorer Audit (read-only)

**Date:** 2026-08-10  
**Scope:** Agents Directory loop + mechanical scorer (Daedalus / Vercel front-end + Railway `server/`).  
**Method:** Code and tests only. No production mutations. Live Railway volume attachment was not inspected from this workspace — marked **not found** where the repo cannot prove it.

---

## Verdict on the Phase 2 claim

**Phase 2 is right about the field:** `checkSetVersion` is the scoring artifact’s `artifactVersion` string (e.g. `biocraft-singleshot-v6`), not a separate check-set versioning scheme.

**It is not quite true that “the loop can never demonstrate one candidate is better.”** The `output_quality` experiment stamps both sides with the **ruler** version before the gate, so a comparable grounding delta is possible. What *is* true:

1. Comparing two ordinary single-version score records (each stamped with its own artifact version) always fails the gate when versions differ — **even if check ids were identical**.
2. The **self-improving loop never uses that delta** to decide ship/hold/approve. Maker/checker/human gate run on heuristic signals, not mechanical score deltas. Approval does not apply the change to the live artifact.

So the decorative risk is real, but the failure mode is “loop does not consume the scorer’s comparable path,” not solely “comparability always refuses.”

---

## A. The comparability gate

### A1. Two real scores, same agent, different artifact versions — comparable or refused?

**Setup run locally (temp file store, 2026-08-10):** canned scores for A7 golden case `a7-mira-okonkwo-v1` against `biocraft-singleshot-v5` and `biocraft-singleshot-v6`, persisted via `runMechanicalScore` → `mechanicalResults`.

| Side | `artifactVersion` | `checkSetVersion` | `mechanicalCheckScore` (grounding) | scoreable grounding | style pass rate | declared style checks |
|------|-------------------|-------------------|------------------------------------|---------------------|-----------------|------------------------|
| left | `biocraft-singleshot-v5` | `biocraft-singleshot-v5` | `0` | 3 | 66.7 | 3 |
| right | `biocraft-singleshot-v6` | `biocraft-singleshot-v6` | `0` | 3 | 40 | 5 |

Declared check lists differ (`historicalArtifacts` / frontmatter):

- v5: `about_hook_max_200_characters`, `generated_sections_have_no_delimiter_separated_keyword_run`, `about_closing_has_cta`
- v6: `about_hook_max_200_characters`, `about_has_no_delimiter_separated_keyword_run`, `about_closing_has_cta`, `draft_has_no_em_dash`, `draft_has_no_ai_cliche_phrase`

**Delta on those two single-version records** (via `groundingScoreDelta`):

```json
{
  "comparable": false,
  "reason": "check set changed: 6 checks → 8 checks",
  "leftCheckCount": 6,
  "rightCheckCount": 8,
  "leftCheckSetVersion": "biocraft-singleshot-v5",
  "rightCheckSetVersion": "biocraft-singleshot-v6"
}
```

(Counts are **scoreable check ids** = declared style checks + golden-case source-grounding rules, not declared style alone.)

**Code path:**

1. Stamp: `runCompare.js` `scoreWith` sets `checkSetVersion: scoringArtifact.artifactVersion` (lines 40–41).
2. Persist: `mechanicalResults.js` `buildMechanicalResultRecord` copies `score.checkSetVersion || score.artifactVersion` (line 147).
3. Gate: `compareExperiments.js` `groundingScoreDelta` (lines 67–90) requires **same sorted scoreable check ids** *and* **same `checkSetVersion` string** (fallback `artifactVersion`).

**Same checks, different stamps (hypothetical):** cloning one score’s `checkResults` and setting `checkSetVersion` to v5 vs v6 still returned `comparable: false` with reason `check set changed: 8 checks → 8 checks`. So the version-string half of the gate alone refuses.

**Contrast — `output_quality` with `rulerVersion=v6`, canned:** both sides get `checkSetVersion: biocraft-singleshot-v6`; `scoreDelta.comparable === true`, `value: 100` in this fixture run. Path: `runOutputQualityCompare` scores both with the ruler (`runCompare.js` 295–314) → `buildOutputQualityResult` overwrites versions to the ruler (`compareExperiments.js` 204–214) → `groundingScoreDelta`. Flagged `answersDidImprovementHelp: false` / `findingKind: "plumbing_verification"` because output was canned (`compareExperiments.js` 216–232; test `mechanical-compare.test.js` 95–114).

**`check_coverage` v5 vs v6:** always `scoreDelta.comparable: false` (coverage experiment, not quality). Test: `mechanical-compare.test.js` 76–93.

### A2. What exactly does the gate compare?

| Layer | Function | Compares |
|-------|----------|----------|
| Preview / “do check sets differ?” | `comparabilityForVersions` (`compareExperiments.js` 120–138) | Sorted **declared check id lists** from loaded artifacts (`checkSetsEqual`, lines 41–46). Not `checkSetVersion`. |
| Numeric quality/coverage delta | `groundingScoreDelta` (`compareExperiments.js` 67–112) | (1) sorted **scoreable** check ids from `checkResults`; (2) **`checkSetVersion` strings** (or `artifactVersion` fallback); (3) both sides’ `byCategory.grounding.passRate` numbers. |
| Client restore of stored pairs | `app.js` ~1816–1830 | For reconstructed `output_quality`, primarily **`checkSetVersion` string equality**; reason text may mention check counts. |

It does **not** compare a separate check-set hash or independent check-set id (**not found**).

### A3. Identifier for the check set independent of the prompt artifact?

**not found** in the mechanical scorer path: no check-set hash, no `CHECK_SET_*` constant, no id distinct from `artifactVersion`.

What exists instead:

- Declared checks live in artifact frontmatter `checks:` and are loaded as `artifact.checks` (`historicalArtifacts.js` ~155, 219).
- Golden-case source-grounding rules are separate, keyed on the case (`goldenCases.js` `sourceGroundingRules`).
- `output_quality` uses an explicit **`rulerVersion`** (another artifact version whose checks score both outputs) — still an artifact version string, not a check-set identity (`runCompare.js` 230–238; `compareExperiments.js` 194–198, 204–212).

---

## B. Guardrails

### B4. Are artifact frontmatter `guardrails:` executed anywhere, or only declared?

**Declared and loaded; not executed by the mechanical scorer.**

- Frontmatter lists are parsed into artifact snapshots (`runtimeArtifacts.js` 108–133; `historicalArtifacts.js` 153).
- Load requires guardrails + success criteria to be present or load warns/fails (`runtimeArtifacts.js` 113–115).
- `scoreMechanicalOutput.js`: **no** `guardrail` references (**not found**). It runs `declaredChecks` (style) + `sourceGroundingRules` (grounding) only (lines 554–574).
- Live invoke validation `validateRuntimeArtifactOutput` runs **registered `checks:` detectors**, not prose guardrails (`runtimeArtifacts.js` 469+).
- Heuristic verifier only does a crude regex “may conflict with a guardrail” against `agent.guardrails` prose (`heuristicVerifier.js` 31–40, 49–50) — advisory `hold`, not execution of frontmatter rules.
- Convex path is separate: `evalResults.guardrailResults` + promotion block (`convex/evalResults.ts` 107–124; `convex/reviews.ts` 143–148). That is the governed eval product, not SKILL.md frontmatter runners.

### B5. Is a grounding failure capable of blocking, or only a count?

**Mechanical / Railway loop:** reduces the grounding pass rate (headline `mechanicalCheckScore`); does not hard-block promotion.

- Failures land in `failed` / `byCategory.grounding.failed`; severity `"high"` on fail (`scoreMechanicalOutput.js` 131–134, 576–591).
- Live run with failed checks → HTTP/result status `checks_failed`, trace `status: "fail"` with `failureReason` = check ids (`loopService.js` 458–534). That feeds maker evidence; it does not refuse `approveImprovement`.
- `approveImprovement` does not inspect grounding results (`loopService.js` 734–786).

**Convex governed release:** failed guardrail results block promotion (`convex/reviews.ts` 143–148) and clear `eligibleForPromotion` (`convex/evalResults.ts` 121–124). That path is **eval-set guardrails**, not mechanical source-grounding checks.

### B6. Where would a hard-block on guardrail failure have to live?

For the **Railway proposal inbox** to refuse approval regardless of score: inside `approveImprovement` in `server/src/core/loopService.js` (and/or the approve route at `routes.js` 153–159) before status flips to `approved` — **not found** today.

For **Convex release:** already lives in `convex/reviews.ts` 143–148 (and eligibility in `convex/evalResults.ts` 121–124). Extending that pattern to mechanical grounding would mean teaching that release path to read mechanical/grounding evidence — it does not today.

---

## C. The loop as it stands

### C7. Actual sequence (file paths)

| Stage | What happens | Path |
|-------|----------------|------|
| **Trigger** | Manual: `POST /api/loop/run` (Clerk identity), `POST /api/loop/research`, `POST /api/agents/:id/goal`, or `POST /api/agents/:id/improvements`. Optional scheduler if `LOOP_ENABLED=true` and `LOOP_INTERVAL_MS > 0`. | `server/src/http/routes.js` 105–116, 148–151; `server/src/http/server.js` 86–91 |
| **Discover** | `runResearch` → triage agents with low/`Needs improvement` evals → `researchQueue` | `server/src/loop/engine.js` 53–76; `server/src/loop/policy.js` `selectForTriage` 12–18 |
| **Improve (maker)** | `runCycle` / `runGoal` → `svc.runImprovement` → `collectImprovementEvidence` → `optimizer.propose` → validate → write `proposedImprovements` on agent | `engine.js` 78–136 / 149–228; `loopService.js` 577–731; default maker `improve/heuristicOptimizer.js` |
| **Score / verify (checker)** | `verifier.assess` per proposal; attach verdict; reject → learning; else leave pending | `engine.js` 27–30, 109–120; default `verify/heuristicVerifier.js` |
| **Write result** | Proposals on agent record; research item status; `loopRuns` / `learnings` append | `loopService.js` `writeProposals` via `proposals.js`; `engine.js` 141–146, 41–47 |
| **Human approve** | `POST .../improvements/:pid/approve` with Clerk **approver** role → marks proposal `approved`, builds copyable `patch`; **does not write SKILL.md / release version** | `routes.js` 153–159; `loopService.js` 734–786 |

**Mechanical score/compare** is a parallel maintainer path (`mechanicalScore` / `mechanicalCompare` in `loopService.js` 951–1008; routes 171–179). It is **not** called from `runCycle` / `runGoal` (**not found** in `server/src/loop/`).

### C8. Real vs stub / fixture

| Piece | Status |
|-------|--------|
| Loop engine (`runCycle` / `runGoal` / research queue / learnings) | **Real** offline workflow |
| Heuristic optimizer | **Real but limited**: keyword defect catalogue; refuses without defect signals; not a model (`heuristicOptimizer.js`) |
| GEPA optimizer | **Stub/refuse**: always throws until external contract emits `changes[]` (`gepaAdapter.js` 24–37); factory falls back to heuristic if misconfigured (`improve/index.js` 20–24) |
| Heuristic verifier | **Real but shallow**: thresholds on `expectedGain`, failing-trace count, crude guardrail regex (`heuristicVerifier.js`) |
| LLM verifier | **Port**: needs `VERIFIER_ENDPOINT`; else factory falls back (`verify/index.js`, `llmVerifier.js`) |
| Mechanical scorer + experiments | **Real** for A7 (and golden A10 helpers); canned fixtures + optional live generation |
| Canned `output_quality` deltas | **Plumbing only** — explicitly not “improvement helped” (`compareExperiments.js` 228–232) |
| Seed `evalHistory` (e.g. A2 score 58) | **Fixture** driving triage (`seed.js` 32) |
| Golden Mira outputs | **Synthetic fixtures** (`eval-artifacts/golden/…`) |
| `approveImprovement` | **Real review stamp**; apply-to-artifact is **not implemented** (comment: “ready-to-commit”, lines 774–783) |
| Convex hosted-run evidence | **Best-effort side write**; service evidence `eligibleForPromotion: false` (`evidence.ts` 54–58; `loopService.js` 124+) |

### C9. Where does a candidate live between proposal and approval?

**Stored record on the agent** in the file store: `agent.proposedImprovements[]` (legacy single `proposedImprovement` normalized in `server/src/core/proposals.js` 16–27). Status `"proposed"` until approve/reject/verifier-reject.

**Not** a GitHub PR, **not** an in-memory-only object after `store.put`, **not** an automatic artifact file write. Approved proposals gain a `patch` string for a human to commit (`loopService.js` 774–776).

### C10. Is `LOOP_AUTOAPPLY` closed? Any other apply-without-human path?

**Closed:**

- Boot throws if `LOOP_AUTOAPPLY` is set to anything other than `"false"` (`config.js` 27–30).
- `config.loop.autoApply` hard-coded `false` (line 117).
- `shouldAutoApply()` always returns `false` (`policy.js` 26–28).
- `runGoal` stops at human gate on ship/hold; never applies (`engine.js` 210–225).
- Test: `server/test/loop-engine.test.js` 42–53.

**Other paths that change catalogue state without “approve improvement”:**

- Allowlisted `PUT /api/agents/:id` can edit catalogue fields including `guardrails` / `successCriteria` with Clerk identity — **not** `version` / `prompt` / proposals (`agentPutAllowlist.js` 6–55; `routes.js` 118–121). That is not auto-apply of a loop proposal; it is a separate mutate path.
- Manual `logEval` can append scores that later triage the loop (`routes.js` 138–141) — human-gated by identity, not an auto-apply of proposals.
- **not found:** any code path that writes runtime `SKILL.md` or bumps live artifact digest from an approved proposal.

---

## D. Evidence and eligibility

### D11. Do score records carry `outputSource`? Can canned influence promotion?

**Yes — `outputSource` is `"live" | "canned"`** on mechanical records (`mechanicalResults.js` 117–148; required for “modern” records at 203–204).

| Use | Canned allowed? |
|-----|-----------------|
| Persist / UI restore | Yes |
| `answersDidImprovementHelp` | **Only live** `output_quality` (`compareExperiments.js` 228) |
| Maker defect signals from `mechanicalResults.failed` | **No filter on `outputSource`** (`loopService.js` 590–596) — canned failures **can** seed proposals |
| Convex service hosted-run evidence | `eligibleForPromotion: false` (`evidence.ts` 54–58) |
| `approveImprovement` | Does not read mechanical scores / `outputSource` at all |

So canned is **not** structurally excluded from the Railway maker inbox; it **is** labeled non-finding for quality deltas and excluded from Convex promotion eligibility on the service evidence path.

### D12. Golden case set?

| Location | Count | Train / held-out |
|----------|-------|------------------|
| `server/src/eval/goldenCases.js` `GOLDEN_CASES_BY_AGENT` | **A7: 1** (`a7-mira-okonkwo-v1`); **A10: 1** (`a10-mira-okonkwo-v1`) | **not found** — no train/held-out split |
| Fixtures under `server/src/eval-artifacts/golden/` | canned-bad / canned-improved / source per case | same |
| Seed / UI `agent.goldenCases[]` | Directory metadata pointing at those cases (`seed.js`; `app.js`) | display/seed only |
| Mechanical UI default | A7 case only wired in inventory/score APIs (`loopService.js` 942–943, 952–953) | — |

---

## E. Storage

### E13. `mechanicalResults` — who reads/writes; release dependency?

**Store:** append-only file collection in `DATA_DIR` (`store.js` `IMMUTABLE_COLLECTIONS` includes `"mechanicalResults"` lines 10–16; `mechanicalResults.js` 7–16, 169–175). **Not Convex.**

| Direction | Callers |
|-----------|---------|
| **Write** | `runMechanicalScore` / `runMechanicalCompare` when `store` passed (`runCompare.js` 153–164, 348–403); exposed via `loopService.mechanicalScore` / `mechanicalCompare` |
| **Read** | `listMechanicalResults` API; UI hydrate (`app.js`); **maker** `collectImprovementEvidence` (`loopService.js` 578–596) |

**Release / approval dependency:** Railway `approveImprovement` does **not** require or consult `mechanicalResults` (**not found**). Convex promotion uses `evalResults.guardrailResults`, not `mechanicalResults` (**not found**). Mechanical scores explicitly do not write `evalHistory` / fleet health (`runCompare.js` 47–48, 138–139).

### E14. Railway `DATA_DIR` / volume — holding across deploys?

**In repo (code + docs):**

- On Railway, boot **fails closed** unless `DATA_DIR === /data` and that path exists and is writable (`dataDir.js` 25–47, 58–108; `config.js` 32–42; `server.js` 23–26).
- Docs require attaching a volume at `/data` (`docs/DEPLOYMENT.md` 59–93).
- Application **cannot prove** the path is a Railway volume vs ephemeral disk that happens to exist (`dataDir.js` 19–23; `DEPLOYMENT.md` 65–67).

**Live production mount status for The-Utopia-Studio / Daedalus Railway service:** **not found** in this repository (no deploy logs, no Railway API snapshot in-tree). Older `docs/RAILWAY_DEPLOY_AUDIT.md` (2026-07-27) noted volume was not encoded in `railway.json` and must be attached in the UI — that documents process, not current attachment.

**How to verify outside this audit:** Railway service logs should show `dataDir=/data (Railway volume required)` on boot (`server.js` 75–78); redeploy and confirm `mechanicalResults` / traces still present.

---

## Cross-cutting: does the loop use comparable deltas?

**No.** `server/src/loop/` has **no** references to `groundingScoreDelta`, `scoreDelta`, `comparable`, or `mechanicalResults`. The scorer can produce a comparable live `output_quality` delta; the loop engine never consumes it when proposing, verifying, or approving.

---

## WHAT I WOULD FIX FIRST

1. Wire the loop’s “is this better?” decision to live `output_quality` under one ruler (and refuse promotion evidence from canned), because today comparable mechanical deltas exist but never gate proposals.  
2. Stop stamping `checkSetVersion` with the generating artifact version when the scoring check set is the ruler / shared set — or introduce a real check-set id (hash of check ids) — because same-ruler singles still look incomparable if left stamped as v5 vs v6.  
3. Filter maker `mechanicalResults` defect signals by `outputSource === "live"` (and/or experiment), because canned plumbing failures can currently spawn Approve-button proposals.  
4. Decide and implement the hard promotion gate for grounding/guardrail failure on the Railway approve path (Convex already blocks eval-set guardrails; Railway approval does not).  
5. Confirm the live Railway volume is attached and accumulating (`DATA_DIR=/data` after redeploy); without durable evidence the rest of the loop cannot be evaluated over time.  
6. Expand beyond one synthetic golden case per agent and define a held-out set before treating deltas as release evidence.  
7. Either upgrade GEPA to emit validated `changes[]` or stop advertising it as a drop-in optimizer — `propose` currently always refuses.  
8. Make `approveImprovement` either apply an immutable candidate artifact under human attestation or clearly product-label it as “patch clipboard only,” so “approved” cannot be mistaken for shipped.
`)