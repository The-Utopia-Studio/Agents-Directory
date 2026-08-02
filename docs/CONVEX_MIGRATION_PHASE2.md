# Convex Migration Phase 2 — Read-only export

Phase 2 inventories what exists. It does not choose canonical records, repair
legacy data, or write Convex. Phase 2.5 starts only after a human approves a
completed manifest.

## Export each browser separately

`utopia_agents_dir_v2` is local to one browser profile and cannot be exported
centrally.

1. Open the Agents Directory in the browser/profile being inventoried.
2. Make sure the loop service is reachable if its Railway/file-store snapshot
   should be included. A missing service does not prevent the browser snapshot;
   it is recorded as a source issue with a category (`unauthorised`,
   `unavailable`, `server-error`, `not-attempted`) rather than a relayed server
   error. On a deployed service the export is authenticated: it answers `401`
   until `API_TOKEN` is configured, and the token is never placed in the page.
3. Click **Migration readiness**.
4. Review every row and its reasons.
5. Click **Download review JSON**.
6. Store the file outside the repository. If it must temporarily live inside
   this checkout, use `migration-output/`, which is gitignored.
7. Repeat for every browser profile/device that may hold catalogue data.

The exporter calls `localStorage.getItem` only. It never calls `setItem`,
`removeItem`, a service write route, or a Convex mutation.

## Export shape

```text
{
  schemaVersion,
  generatedAt,
  sources: {
    browserLocalStorage,
    railwayFileStore
  },
  records: {
    agents,
    versions,
    evals,
    proposals,
    reviewHistory,
    requests,
    evidence
  },
  readiness: {
    summary,
    byType,
    sourceIssues
  },
  redactions
}
```

Each `records.<type>[]` entry contains `source`, `sourcePath`, `sourceId`,
the sanitized source `data`, and `readiness: { status, reasons[] }`.

## Privacy boundary

The downloaded file is metadata-only. The exporter removes raw run input,
output, prompts/responses, pasted/source material, JWT/API/access tokens, and
authorization fields recursively. Feedback/eval notes and known-issue prose are
represented only by presence and length metadata. Golden-case input, expected
output, and source are withheld. Source records are not modified. Token
*counts* remain metadata and may be included.

No artifact bytes or prompt text move. A repo-owned artifact reference appears
only when the server loaded real bytes and computed the real SHA-256 at boot.

## Readiness meanings

- `ready` — every governed field checked for that record type is present,
  references resolve within the export, provenance is explicit, and no
  ambiguity was found.
- `blocked` — importing would require inventing a required field/provenance,
  accepting an unsupported legacy shape, importing ineligible evidence, or
  resolving an unknown reference.
- `needs-review` — the schema permits omission (for example a draft artifact)
  or multiple stores contain the same ID and a human must choose authority.

Evidence is always blocked from Phase 2.5 because evidence migration is
explicitly deferred to Phase 6. Demo/mock, unversioned, raw-payload-bearing, and
unprovenanced evidence receives additional reasons.

The report does not infer `runner`, contracts, display IDs, artifact schemes,
digests, actors, or evidence source.
