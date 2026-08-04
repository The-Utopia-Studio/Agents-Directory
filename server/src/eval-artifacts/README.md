# Eval artifacts

Committed, digest-verified historical baselines for mechanical-check
comparison. The digest is the contract: load hashes bytes and refuses on
mismatch.

## Historical SKILL.md fixtures

| Version | Path | Declared sha256 |
|---------|------|-----------------|
| biocraft-singleshot-v5 | `biocraft/biocraft-singleshot-v5/SKILL.md` | `c5cc1a587a10deb6fb1b2ee73fed0c31fcad96fa12ed58bc5907544e408df92b` |
| biocraft-singleshot-v6 | `biocraft/biocraft-singleshot-v6/SKILL.md` | `a8c08f4e98cd88f018764754eda760a20113e6fcf8a3362a192254b6bca81a10` |

Runtime load path: read these files → SHA-256 → refuse if ≠ declared digest.

Dev-time verification: `verifyHistoricalFixtureAgainstGit()` in
`server/src/eval/historicalArtifacts.js` runs `git show` against the pinned
SHA and asserts the same digest. Adding a baseline is a deliberate commit of
bytes + digest + pin — not a build-time side effect.

The live runnable artifact remains `server/src/artifacts/*/SKILL.md`.

## Golden cases

Synthetic fellow material under `golden/`. Never real LinkedIn profiles.
See `server/src/eval/goldenCases.js`.
