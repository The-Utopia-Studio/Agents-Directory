# Scorer audit (Phase 1 — read only)

Open architectural question: mechanicalResults live in the server file store, not Convex — whether to move them remains undecided.

Date: 2026-08-07  
Repo: The-Utopia-Studio/Agents-Directory  

Scope: how agent “scores” and check results are computed, stored, and displayed. Citations are file path + line numbers. Where something was not found in the codebase, this report says **not found**.

There are three separate systems that use “score” or “check” language. The UI numbers **33.3** and **25** with “passed / failed” come from system **1** only.

| # | System | What it produces |
|---|--------|------------------|
| 1 | Mechanical check score | `mechanicalCheckScore` (e.g. 33.3, 25) + `passed` / `failed` arrays |
| 2 | Hosted runtime validation | Failures-only list with `message`; no percentage |
| 3 | Convex governed eval | `normalizedScore` from rubric criteria; separate `guardrailResults` |

---

## A. WHERE IT LIVES

### A1. Every file that computes, stores, reads, or renders a score or check result

**Mechanical check score (system 1) — compute**

- `server/src/eval/scoreMechanicalOutput.js` — style runners + aggregate formula (`scoreMechanicalOutput`, `compareMechanicalScores`)
- `server/src/eval/sourceGrounding.js` — source-grounding check runners (`runSourceGroundingChecks`)
- `server/src/eval/scoreGoldenCase.js` — loads golden canned output + artifact checks, calls `scoreMechanicalOutput`
- `server/src/eval/compareExperiments.js` — coverage vs quality experiment wrappers; sets `mechanicalCheckScoreDelta` to `null` when coverage / non-comparable
- `server/src/eval/runCompare.js` — HTTP-facing score/compare orchestration; persists records
- `server/src/eval/historicalArtifacts.js` — loads declared `checks:` from fixture SKILL.md
- `server/src/eval/goldenCases.js` — golden case inputs + `sourceGroundingRules`
- `server/src/eval/mechanicalInventory.js` — inventory of scoreable versions/cases

**Mechanical check score — store / read**

- `server/src/eval/mechanicalResults.js` — builds and appends `mechanicalResults` records
- `server/src/core/store.js` — `mechanicalResults` listed in `IMMUTABLE_COLLECTIONS` (lines 10–15)
- `server/src/core/loopService.js` — `mechanicalScore`, `mechanicalCompare`, `mechanicalComparePreview`, `listMechanicalResults` (lines 937–1041)
- `server/src/http/routes.js` — routes for inventory / score / compare / results (lines 92–98, 171–178)
- `api.js` — client wrappers (lines 158–169)

**Mechanical check score — render**

- `app.js` — mechanical UI: hydrate from store/localStorage, cards, pass/fail counts, delta tiles (approx. lines 1550–2069+)
- `docs/ui-audit-2026-08-04.md` — documents observed UI values 33.3 / 25 with pass·fail meta (lines 17–24)

**Hosted runtime checks (system 2) — compute / surface**

- `server/src/invoke/runtimeArtifacts.js` — `validateRuntimeArtifactOutput` (failures with `message`, from ~line 469)
- `server/src/invoke/index.js` — attaches `checkResults` on invoke
- `server/src/core/loopService.js` — maps failures to response `checkFailures` / trace status (lines 458–545)
- `server/src/core/traceSafety.js` — `sanitizeCheckResults` strips non-structural fields including messages (lines 82–106)
- `app.js` — run-result banner for `checks_failed` (lines 1457–1460)

**Convex governed eval (system 3)**

- `convex/evalResults.ts` — `recordEvalResult` computes `normalizedScore` (lines 42–128)
- `convex/evalSets.ts` — rubric + guardrail definitions on an eval set
- `convex/lib/validators.ts` — `rubricCriterion`, `rubricCriterionResult`, `guardrailResult` (lines 241–263)
- `convex/schema.ts` — `evalResults` / `evalSets` / `evalCases` tables (lines 176–220)
- `convex/fleet.ts` — averages latest `normalizedScore` values (lines 28–31)
- `convex/reviews.ts` — failed guardrail blocks promotion (lines 137–148)

**Other “score” surfaces (not the 33.3/25 mechanical cards)**

- `app.js` — legacy `evalHistory` score display / form (e.g. lines 485, 598, 1009, 1212); fleet strip intentionally omits legacy scores (line 909)
- `server/src/core/loopService.js` — `fleetHealth` averages `evalHistory[].score` (lines 1044–1066)
- `server/src/core/types.js` — `Trace.score`, `EvalRecord.score`, `CheckResult` typedefs (lines 15, 48, 107–123)
- `server/src/verify/heuristicVerifier.js` / `llmVerifier.js` — proposal verdicts vs agent guardrail *prose*; not mechanicalCheckScore
- Seed / fixture agent records in `app.js` with hand-entered evalHistory scores (e.g. lines 26–27, 56, 74, 124)

**Tests / fixtures that exercise mechanical scoring**

- `server/test/golden-mechanical.test.js`
- `server/test/mechanical-compare.test.js`
- `server/src/eval-artifacts/biocraft/biocraft-singleshot-v{5,6,7}/SKILL.md`
- `server/src/eval-artifacts/golden/a7-mira-okonkwo-v1/*`
- Live artifact check lists: `server/src/artifacts/biocraft/SKILL.md`, `server/src/artifacts/biocraft-gapfill/SKILL.md`

### A2. Server-side vs client-side

| Concern | Where it runs |
|---------|----------------|
| Arithmetic for `mechanicalCheckScore` | Server: `scoreMechanicalOutput.js` |
| Persist / list mechanical results | Server file store via loop service |
| Comparability (`checkSetsDiffer`, delta `null`) | Server: `compareExperiments.js`; client also reconstructs coverage delta as `null` in `app.js` `reconstructMechPayloadFromStored` (lines 1667–1671) |
| Render of cards / pass·fail / “not comparable” | Client: `app.js` |
| Runtime check execution on invoke | Server: `runtimeArtifacts.js` |
| Convex `normalizedScore` | Convex mutations (`evalResults.ts`) |
| localStorage last mechanical payload | Client: `app.js` `saveMechLastResult` / `loadMechLastResultLocal` (lines 1550–1572) |

### A3. Where check definitions live

**Mechanical / runtime declared checks:** repo artifacts — YAML frontmatter `checks:` lists in SKILL.md files, loaded by `historicalArtifacts.js` (`frontmatterList(..., "checks")` at lines 124–155) and by live `runtimeArtifacts.js` snapshots. Examples:

- `server/src/eval-artifacts/biocraft/biocraft-singleshot-v5/SKILL.md` lines 23–26
- `server/src/eval-artifacts/biocraft/biocraft-singleshot-v6/SKILL.md` lines 23–28
- Live: `server/src/artifacts/biocraft/SKILL.md` lines 25–32

**Source-grounding rules (extra checks on golden scoring):** hard-coded in `server/src/eval/goldenCases.js` (`MIRA_RELATIONSHIP_RULES`, lines 18–40; A10 extras lines 90–102).

**Check runner implementations:** hard-coded in source (`scoreMechanicalOutput.js`, `sourceGrounding.js`, `runtimeArtifacts.js`).

**Convex:** `evalSets.rubric` and `evalSets.guardrails` are Convex-stored definitions for system 3. They are **not** the mechanical `checks:` lists that produce 33.3 / 25.

**Artifact frontmatter `guardrails:`** (prose strings in SKILL.md, e.g. v5 lines 12–22) are **not** executed by `scoreMechanicalOutput.js` (no `guardrail` reference in that file).

---

## B. THE ARITHMETIC — this is the core question

### B4. Exact formula (as in code)

From `server/src/eval/scoreMechanicalOutput.js` lines 415–429:

```javascript
const passed = checkResults
  .filter((r) => r.status === "pass")
  .map((r) => r.checkId);
const failed = checkResults
  .filter((r) => r.status === "fail")
  .map((r) => r.checkId);
const notScoreable = checkResults
  .filter((r) => r.status === "not_scoreable")
  .map((r) => r.checkId);

const scoreableCount = passed.length + failed.length;
const mechanicalCheckScore =
  scoreableCount === 0
    ? null
    : Math.round((passed.length / scoreableCount) * 1000) / 10;
```

**Convex system 3** (separate): `convex/evalResults.ts` line 110:

```javascript
const normalizedScore = (earnedMaximum / applicableMaximum) * 100;
```

### B5. Denominator

For mechanical scores: **runtime** `scoreableCount = passed.length + failed.length` (line 425).  
`not_scoreable` rows are **excluded** from the denominator.  
Not a fixed constant of 100 or 10; 100 is only the scale after multiplying the pass rate (`* 1000) / 10` ≈ one decimal percent).

Displayed “passed N · failed M” in `app.js` uses `passed.length` and `failed.length` (lines 1873, 1892), which match that denominator’s two parts when `notScoreable` is empty.

### B6. Weights

**not found** in the mechanical path. No weight fields in `scoreMechanicalOutput.js`. Every scoreable pass/fail counts equally (1 / `scoreableCount`).

Convex rubric criteria have per-criterion `maxScore` (`validators.ts` lines 241–246), which weights system-3 `normalizedScore` — different system.

### B7. The “33.3 with 2 passed / 6 failed” pairing

**That pairing does not reconcile and is not what the fixture produces.**

Recomputed from the real golden fixture `a7-mira-okonkwo-v1` canned-bad output via `compareGoldenCannedVersions` (same path as production scoring):

| Version | `passed.length` | `failed.length` | `scoreableCount` | Formula | `mechanicalCheckScore` |
|---------|-----------------|-----------------|------------------|---------|------------------------|
| `biocraft-singleshot-v5` | **2** | **4** | 6 | `Math.round((2/6)*1000)/10` | **33.3** |
| `biocraft-singleshot-v6` | **2** | **6** | 8 | `Math.round((2/8)*1000)/10` | **25** |

Step-by-step for **33.3** (v5):

1. Style + source-grounding results yield 6 scoreable rows (0 `not_scoreable`).
2. Passes: `about_hook_max_200_characters`, `generated_sections_have_no_delimiter_separated_keyword_run`.
3. Fails: `about_closing_has_cta`, `source_preserves_intern_near_helix`, `source_no_founding_verb_near_dextrum`, `source_preserves_founding_near_northline`.
4. `scoreableCount = 2 + 4 = 6`.
5. `(2 / 6) * 100 = 33.333…` → `Math.round(333.333…)/10 = 33.3`.

If the UI showed **2 passed · 6 failed** next to **33.3**, that would be a **mislabeled pairing** (mixing v5’s score with v6’s fail count). Documented correctly in `docs/ui-audit-2026-08-04.md` lines 21–23: 33.3 with passed 2 · failed 4; 25 with passed 2 · failed 6.

No Convex / DB row was queried for this audit; the numbers above are from executing the same scoring functions against the committed fixture bytes.

### B8. Same for 25

Step-by-step for **25** (v6, same canned output):

1. Declared style set is larger (adds em-dash + AI-cliché; keyword-run id differs).
2. Passes: `about_hook_max_200_characters`, `about_has_no_delimiter_separated_keyword_run`.
3. Fails (6): `about_closing_has_cta`, `draft_has_no_em_dash`, `draft_has_no_ai_cliche_phrase`, plus the same three `source_*` fails.
4. `scoreableCount = 2 + 6 = 8`.
5. `(2 / 8) * 100 = 25` → `Math.round(250)/10 = 25`.

**Reconciles** when paired with 2 passed / 6 failed.

---

## C. GUARDRAILS VS SCORED CHECKS

### C9. Are guardrail results mixed into the same computation as scored checks?

**Mechanical path (system 1):**  
Artifact frontmatter `guardrails:` are **not** run and **not** averaged.  
**Source-grounding checks** (`family: "source-grounding"`) **are** mixed into the **same** `checkResults` array and the **same** pass-rate average as style checks (`scoreMechanicalOutput.js` lines 414–429). So binary grounding fails lower the percentage the same way style fails do.

**Convex path (system 3):**  
Guardrails are a **separate** array `guardrailResults` on `evalResults` (`schema.ts` lines 207; `evalResults.ts` lines 74–108). Rubric criterion scores alone feed `normalizedScore`; guardrails are not added into `earnedMaximum`.

**Directory agent `guardrails[]` / SKILL.md prose guardrails:** used as labels / verifier context; **not found** as inputs to `mechanicalCheckScore`.

### C10. Code path where a guardrail failure changes the score rather than blocking?

**Convex:** failed guardrail sets `eligibleForPromotion` false (`evalResults.ts` lines 107–124) and blocks promotion in `reviews.ts` (lines 144–148). It does **not** change `normalizedScore` arithmetic (line 110 uses only rubric totals).

**Mechanical:** no guardrail execution path in `scoreMechanicalOutput.js`. Source-grounding failures **do** change the score (they are scored checks, not promotion gates).

**Runtime invoke:** failed checks set status `checks_failed` / trace `fail` (`loopService.js` lines 532–534, 473–475) but **do not** compute `mechanicalCheckScore` on that path.

---

## D. WHAT EACH CHECK RETURNS

### D11. Shape of a single check result

**Mechanical scoring (`passResult` / `failResult` / not_scoreable)** — `scoreMechanicalOutput.js` lines 119–125, 180–187, 369–374:

- Always: `checkId`, `family`, `status` (`"pass"` | `"fail"` | `"not_scoreable"`)
- Optional structural facts: `sectionFound`, `hookChars`, `limit`, `reason` (for not_scoreable), `historicalImplementation`, etc.
- **No** boolean `passed` field; status string instead.
- **No** dedicated human-readable `why` / `message` on the mechanical score path.

**Source-grounding** — `sourceGrounding.js` ~286–307+: `checkId`, `family`, `status`, plus facts (`anchorPresent`, `near`, …). No `why` sentence.

**Runtime validation failures** — `runtimeArtifacts.js` ~501–508: `checkId`, `message`, structural facts. Failures-only array (passes omitted).

**Convex guardrail result** — `validators.ts` lines 259–263: `{ guardrailId, passed, evidenceId? }`.

**Convex criterion result** — lines 248–257: `{ criterionId, result: { kind: "score", score } | { kind: "n/a" } }`.

**JSDoc `CheckResult`** in `types.js` lines 107–123 documents structural facts for traces; does not include `status`, `family`, or `message`.

### D12. Is failure reason text stored, or generated at render time?

- **Mechanical persist** (`mechanicalResults.js` lines 47–78): stores `checkId`, `family`, `status`, and a fixed allowlist of structural keys including `reason` (machine codes like `about_section_missing` / `no_registered_runner`). **Does not** store a human sentence `message` / `why`.
- **Mechanical UI** (`app.js` `renderMechanicalScoreResult` / check table ~2023–2027, 1955–1971): renders `status` (and “historical”); **does not** render a why sentence from stored facts.
- **Runtime response** includes `message` for the caller (`loopService.js` 540–543), but **trace sanitization drops messages** (`traceSafety.js` lines 101–102: “messages, excerpts, matched text — is dropped”).
- **Convex guardrailResult:** boolean only; no why field in the validator.

---

## E. PERSISTENCE AND VERSIONING

### E13. Where is a score run persisted? Convex table name and schema

**Mechanical scores:** **not** in Convex. Append-only collection `"mechanicalResults"` in the **server file store** (`mechanicalResults.js` lines 7, 86–88; `store.js` IMMUTABLE_COLLECTIONS).

Record fields built in `buildMechanicalResultRecord` (`mechanicalResults.js` lines 35–83):

- `agentId`, `goldenCaseId`, `artifactVersion`, `artifactDigest`, `artifactDigestAlgorithm`, `outputSource`, `passed`, `failed`, `notScoreable`, `mechanicalCheckScore`, `scoreableCount`, `checkResults[]`, optional `comparedTo`, `label`, `ts`

**Convex `evalResults`** (`schema.ts` lines 198–220): governed rubric runs — `criterionResults`, `earnedMaximum`, `applicableMaximum`, `normalizedScore`, `guardrailResults`, `eligibleForPromotion`, `evaluatedAt`, etc. Separate product path; comments in mechanical UI say mechanical scores are “not written to evalHistory” / do not feed fleet health (`app.js` line 1792).

### E14. Does a stored score record carry check-set version, prompt digest, timestamp, live vs canned?

| Field | Mechanical `mechanicalResults` | Notes |
|-------|--------------------------------|-------|
| Check-set version as `checkSetVersion` | **not found** | Has `artifactVersion` (string like `biocraft-singleshot-v5`); check ids live inside that artifact’s frontmatter, not a separate version field |
| Prompt / artifact digest | **yes** — `artifactDigest` (+ algorithm) | lines 38–40 |
| Timestamp | **yes** — `ts` ISO string | line 82 |
| Live vs canned | **yes** — `outputSource` (`"canned"` \| `"live"`, or `"canned:check_coverage"` etc. when compare-persisted) | lines 41, `runCompare.js` ~358 |

### E15. Survive reload / navigate away?

- Server: append-only `mechanicalResults` survive process restarts as long as the store files do.
- Client: `hydrateMechLastResultUI` (`app.js` 1756–1784) loads localStorage first, then prefers fresher server rows via `DirectoryAPI.mechanicalResults`.
- Empty state if neither has data (lines 1762–1765). Scores are **not** recomputed on render; they are **shown from last stored/cached payload**. Fresh computation requires pressing a score/compare button (or equivalent API).

### E16. “Not comparable — check set changed” logic

**Server:** `comparabilityForVersions` in `compareExperiments.js` lines 50–63:

- Loads left/right historical artifacts.
- `checkSetsEqual` sorts and compares the **declared `checks` id arrays** (lines 38–43).
- If unequal: `checkSetsDiffer: true`, `note: "Not comparable — check set changed between these versions"`.
- Coverage experiment always sets `mechanicalCheckScoreDelta: null` (lines 93–95).

**Client reconstruction** for stored coverage pairs: `app.js` lines 1648–1671 compares sorted `checkResults[].checkId` lists; if they differ, sets `checkSetNote` and `mechanicalCheckScoreDelta: null`.

**Render:** `renderMechQualityRefusedTile` (`app.js` 1928–1936) shows Quality delta “—” and reason `"not comparable (check set changed)"` when `checkSetsDiffer` or `mechanicalCheckScoreDelta === null`.

**Also:** release/reimport copy in `convex/reimports.ts` / `reimportSpec.ts` states ratings across artifact versions are “not comparable” — prose for releases, not the mechanical delta function.

**Compares:** declared check **id lists** (or reconstructed checkResult ids), **not** a `checkSetVersion` field (**not found**).

---

## F. HONESTY FAILURES

### F17. Raw null / undefined / NaN / placeholder reaching the UI as a real number

- `mechanicalCheckScore == null` → displayed as `"—"` (`app.js` 1871, 1889), not as `0`.
- `mechanicalCheckScoreDelta == null` → delta chip `"—"` (1918); refused tile uses “—” plus reason text (1928–1935). Does **not** currently print the string `"refused (null)"` in `app.js` (that wording appears in the older UI audit doc as a problem description: `docs/ui-audit-2026-08-04.md` line 42).
- `scoreableCount === 0` → `mechanicalCheckScore` is `null` (server), not `NaN`.
- **Convex / loop fleet `avg` defaults to `0` when there are no scores** (`convex/fleet.ts` 29–31; `loopService.js` 1049) — zero can look like a measured average.
- Legacy evalHistory: only shows numeric score when `typeof … === "number"` (e.g. `app.js` 485, 1009).

### F18. Score displayed without indicating canned vs live

- Headline cards **do** show `output source: canned|live` when `src` is truthy (`app.js` 1874, 1893).
- Caption lines also include canned/live phrasing (`mechOutputSourceLabel`, `renderMechExperimentCaption`).
- If `outputSource` / provenance were missing on a side object, the output-source meta line is omitted (`src?…` conditional) while the numeric score can still render — possible honesty gap for incomplete records.

### F19. Silent defaults / `|| 0`

- `app.js` 1873, 1892: `passed ${side.passed?.length||0} · failed ${side.failed?.length||0}` — missing arrays become **0 passed / 0 failed**.
- `loopService.js` fleetHealth: `avg = … : 0` when no numeric scores (1049).
- `convex/fleet.ts`: `avg = … : 0` when no eval results (29–31).
- `mechanicalResults.js` 42–44: `score.passed || []` (and failed/notScoreable) when building records — empty array substitution at persist time.
- Runtime `validateRuntimeArtifactOutput`: `artifact?.snapshot?.checks || []` (`runtimeArtifacts.js` 471) — empty checks → no style failures from declarations.

---

## WHAT I WOULD CHANGE

1. The headline number is a 0–100 pass-rate percentage whose denominator is “scoreable checks this run,” so the same canned output yields 33.3 under v5 and 25 under v6 purely because the check set grew — easy to misread as quality.
2. Source-grounding failures are averaged into the same percentage as style checks, so “guardrail-like” binary grounding gates silently deduct from the displayed score.
3. Pass/fail meta can be mentally paired with the wrong card (33.3 vs 2/6); the UI does not show the denominator `scoreableCount` next to the percentage.
4. Mechanical check results store status and structural facts but no durable human-readable `why`, so a prompt-optimisation loop cannot consume failure text from stored scores.
5. There is no `checkSetVersion` field; comparability depends on sorting check id lists, and coverage still shows two percentage scores while forcing quality delta to null.
6. `passed?.length||0` / `failed?.length||0` can paint “0 · 0” when data is missing instead of an explicit unchecked state.
7. Fleet health averages (`0` when empty) can present absence of governed scores as a numeric zero.
8. Runtime `message` text is generated for the invoke response but stripped before trace persistence, so failure prose does not survive as evidence.
9. Three parallel score/check systems (mechanical %, runtime failures, Convex normalizedScore) share vocabulary, which is what makes reconciliation hard even when one formula is simple.
10. Mechanical results live only in the server file store, not Convex, so “what’s in the database” depends on which authority the reader means.

---

*Phase 1 complete. Stopping here pending explicit approval before any Phase 2 work.*
