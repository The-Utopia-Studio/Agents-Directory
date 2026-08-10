// Open a loop-improvement PR on The-Utopia-Studio/utopia-agents.
// Uses GITHUB_LOOP_TOKEN only — never GITHUB_SKILLS_TOKEN, never a fallback.
// Never merges. Never pushes to main. Never force-pushes.

export const LOOP_PR_REPO = "The-Utopia-Studio/utopia-agents";
export const LOOP_PR_LABEL = "agents-directory-loop";

/** Agent id → single skill file path inside utopia-agents (one file per PR). */
export const AGENT_SKILL_FILE_PATHS = Object.freeze({
  A7: "biocraft/SKILL.md",
  A10: "con-linkedin-audit/SKILL.md",
});

export class LoopPullRequestError extends Error {
  constructor(message, { status = 502, code = "loop_pr_failed" } = {}) {
    super(message);
    this.name = "LoopPullRequestError";
    this.status = status;
    this.code = code;
  }
}

export function loopTokenFromEnv(env = process.env) {
  const token = String(env.GITHUB_LOOP_TOKEN || "").trim();
  if (!token) {
    throw new LoopPullRequestError(
      "GITHUB_LOOP_TOKEN is missing — cannot open a loop PR. Proposal stays proposed.",
      { status: 503, code: "loop_token_missing" },
    );
  }
  // Hard refusal: skills token must never be consulted here.
  if (env.GITHUB_SKILLS_TOKEN && token === String(env.GITHUB_SKILLS_TOKEN).trim()) {
    throw new LoopPullRequestError(
      "GITHUB_LOOP_TOKEN must not be the same secret as GITHUB_SKILLS_TOKEN.",
      { status: 500, code: "loop_token_collision" },
    );
  }
  return token;
}

export function skillFilePathForAgent(agentId) {
  const path = AGENT_SKILL_FILE_PATHS[agentId];
  if (!path) {
    throw new LoopPullRequestError(
      `No utopia-agents skill path mapped for agent ${agentId}.`,
      { status: 400, code: "loop_pr_unmapped_agent" },
    );
  }
  return path;
}

export function branchNameForProposal(agentId, proposalId) {
  const slug =
    agentId === "A7"
      ? "biocraft"
      : agentId === "A10"
        ? "con-linkedin-audit"
        : String(agentId || "agent")
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "") || "agent";
  const id = String(proposalId || "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  if (!id) {
    throw new LoopPullRequestError("Proposal id required for branch name.", {
      status: 400,
      code: "loop_pr_bad_id",
    });
  }
  return `loop/${slug}-${id}`;
}

/**
 * Apply the single proposal change to skill markdown. One contiguous
 * current → proposed replace; refuse if current is missing or ambiguous.
 */
export function applyProposalChangeToSkill(content, change) {
  const current = change?.current;
  const proposed = change?.proposed;
  if (typeof current !== "string" || typeof proposed !== "string") {
    throw new LoopPullRequestError(
      "Proposal change is missing current/proposed text.",
      { status: 400, code: "loop_pr_bad_change" },
    );
  }
  if (!current) {
    throw new LoopPullRequestError(
      "Proposal change.current is empty — refusing to invent a patch.",
      { status: 400, code: "loop_pr_empty_current" },
    );
  }
  const first = content.indexOf(current);
  if (first < 0) {
    throw new LoopPullRequestError(
      "Proposal current text was not found in the pinned skill file — refusing to open a mismatched PR.",
      { status: 409, code: "loop_pr_current_mismatch" },
    );
  }
  const second = content.indexOf(current, first + current.length);
  if (second >= 0) {
    throw new LoopPullRequestError(
      "Proposal current text matches more than once in the skill file — refusing an ambiguous PR.",
      { status: 409, code: "loop_pr_current_ambiguous" },
    );
  }
  return content.slice(0, first) + proposed + content.slice(first + current.length);
}

function categoryPassRate(score, category) {
  const rate = score?.byCategory?.[category]?.passRate;
  return typeof rate === "number" && Number.isFinite(rate) ? rate : null;
}

function categoryCounts(score, category) {
  const rows = (score?.checkResults || []).filter(
    (row) => (row.category || row.family) === category,
  );
  const passed = rows.filter((row) => row.passed === true || row.status === "pass").length;
  const failed = rows.filter((row) => row.passed === false || row.status === "fail").length;
  return { total: rows.length, passed, failed };
}

export function buildLoopPrBody({
  agent,
  proposal,
  promotionGate,
  incumbentScore,
  candidateScore,
}) {
  const change = proposal?.changes?.[0] || {};
  const gate = promotionGate || proposal?.promotionGate || {};
  const delta = gate.scoreDelta || {};
  const incG = categoryPassRate(incumbentScore, "grounding");
  const canG = categoryPassRate(candidateScore, "grounding");
  const incS = categoryPassRate(incumbentScore, "style");
  const canS = categoryPassRate(candidateScore, "style");
  const gCountsInc = categoryCounts(incumbentScore, "grounding");
  const gCountsCan = categoryCounts(candidateScore, "grounding");
  const sCountsInc = categoryCounts(incumbentScore, "style");
  const sCountsCan = categoryCounts(candidateScore, "style");
  const coverage = candidateScore?.guardrailGate?.coverage;
  const checkSetId = incumbentScore?.checkSetId || candidateScore?.checkSetId || "(missing)";
  const sameCheckSet =
    Boolean(incumbentScore?.checkSetId) &&
    incumbentScore?.checkSetId === candidateScore?.checkSetId;

  const lines = [
    `## Loop improvement — ${agent?.name || agent?.id || "agent"}`,
    "",
    "Opened by Agents Directory on human approval. **Do not merge automatically.** A human merges; pinned SHA bump is tracked separately.",
    "",
    "### Defect the maker responded to",
    change.rationale || proposal?.summary || "(none recorded)",
    "",
    "### Artifact versions",
    `- Incumbent: \`${gate.incumbentArtifactVersion || incumbentScore?.artifactVersion || "?"}\``,
    `- Candidate: \`${gate.candidateArtifactVersion || candidateScore?.artifactVersion || "?"}\``,
    "",
    "### Check set",
    `- checkSetId: \`${checkSetId}\``,
    `- Same checkSetId on both sides: **${sameCheckSet ? "yes" : "no"}**`,
    "",
    "### Grounding delta (separate from style)",
    `- Incumbent grounding pass rate: ${incG == null ? "n/a" : `${incG}%`} (${gCountsInc.passed}/${gCountsInc.total} checks)`,
    `- Candidate grounding pass rate: ${canG == null ? "n/a" : `${canG}%`} (${gCountsCan.passed}/${gCountsCan.total} checks)`,
    `- Delta: ${delta.comparable ? `${delta.value}` : `not comparable (${delta.reason || "?"})`}`,
    "",
    "### Style delta (separate from grounding)",
    `- Incumbent style pass rate: ${incS == null ? "n/a" : `${incS}%`} (${sCountsInc.passed}/${sCountsInc.total} checks)`,
    `- Candidate style pass rate: ${canS == null ? "n/a" : `${canS}%`} (${sCountsCan.passed}/${sCountsCan.total} checks)`,
    `- Style delta (pp): ${
      incS == null || canS == null ? "n/a" : String(canS - incS)
    }`,
    "",
    "### Guardrail gate",
    `- Passed: **${candidateScore?.guardrailGate?.passed === true ? "yes" : "no"}**`,
    `- Coverage: ${coverage?.summary || "(none)"}`,
    "",
    "### Output source (must be live)",
    `- Incumbent: \`${incumbentScore?.outputSource || "?"}\``,
    `- Candidate: \`${candidateScore?.outputSource || "?"}\``,
    "",
    "### Stored score records",
    `- Incumbent id: \`${incumbentScore?.id || "(unknown)"}\``,
    `- Candidate id: \`${candidateScore?.id || "(unknown)"}\``,
    "",
    "### Change",
    `- Surface: \`${change.surface || "?"}\``,
    `- Target: \`${change.target || "?"}\``,
    "",
    "<details><summary>Current → proposed</summary>",
    "",
    "```diff",
    `--- current`,
    String(change.current || ""),
    `+++ proposed`,
    String(change.proposed || ""),
    "```",
    "",
    "</details>",
  ];
  return lines.join("\n");
}

export function buildLoopPrTitle(agent, proposal) {
  const name = agent?.name || agent?.id || "Agent";
  const summary = String(proposal?.summary || proposal?.changes?.[0]?.rationale || "improvement")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 72);
  return `${name}: ${summary}`;
}

async function githubJson(token, path, { method = "GET", body, fetchImpl = fetch } = {}) {
  const res = await fetchImpl(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "agents-directory-loop",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { message: text.slice(0, 200) };
  }
  return { res, json };
}

/**
 * Create (or reuse) a PR for an approved loop proposal.
 * Caller must keep the proposal proposed until this resolves successfully.
 */
export async function openLoopPullRequest({
  agent,
  proposal,
  promotionGate,
  incumbentScore,
  candidateScore,
  token = null,
  fetchImpl = fetch,
  env = process.env,
} = {}) {
  // Idempotent: never open a second PR for the same proposal.
  if (proposal?.loopPr?.number && proposal?.loopPr?.url) {
    return {
      reused: true,
      number: proposal.loopPr.number,
      url: proposal.loopPr.url,
      branch: proposal.loopPr.branch || null,
    };
  }

  const auth = token || loopTokenFromEnv(env);
  const agentId = agent?.id;
  const filePath = skillFilePathForAgent(agentId);
  const branch = branchNameForProposal(agentId, proposal?.id);
  const change = proposal?.changes?.[0];
  if (!change) {
    throw new LoopPullRequestError("Proposal has no changes[] to commit.", {
      status: 400,
      code: "loop_pr_no_change",
    });
  }

  const [owner, repo] = LOOP_PR_REPO.split("/");

  const repoMeta = await githubJson(auth, `/repos/${owner}/${repo}`, { fetchImpl });
  if (!repoMeta.res.ok) {
    throw new LoopPullRequestError(
      `GitHub repo lookup failed (${repoMeta.res.status}): ${repoMeta.json?.message || "unknown"}. Proposal stays proposed.`,
      { status: 502, code: "loop_pr_repo" },
    );
  }
  const defaultBranch = repoMeta.json.default_branch || "main";

  // Reuse an open PR on this branch if a prior attempt created it.
  const existing = await githubJson(
    auth,
    `/repos/${owner}/${repo}/pulls?state=open&head=${encodeURIComponent(`${owner}:${branch}`)}`,
    { fetchImpl },
  );
  if (existing.res.ok && Array.isArray(existing.json) && existing.json[0]?.number) {
    const pr = existing.json[0];
    return {
      reused: true,
      number: pr.number,
      url: pr.html_url,
      branch,
    };
  }

  const ref = await githubJson(
    auth,
    `/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(defaultBranch)}`,
    { fetchImpl },
  );
  if (!ref.res.ok) {
    throw new LoopPullRequestError(
      `Cannot read default branch ${defaultBranch} (${ref.res.status}). Proposal stays proposed.`,
      { status: 502, code: "loop_pr_ref" },
    );
  }
  const baseSha = ref.json?.object?.sha;
  if (!baseSha) {
    throw new LoopPullRequestError("Default branch SHA missing.", {
      status: 502,
      code: "loop_pr_ref",
    });
  }

  const file = await githubJson(
    auth,
    `/repos/${owner}/${repo}/contents/${filePath}?ref=${encodeURIComponent(defaultBranch)}`,
    { fetchImpl },
  );
  if (!file.res.ok) {
    throw new LoopPullRequestError(
      `Cannot read ${filePath} on ${defaultBranch} (${file.res.status}). Proposal stays proposed.`,
      { status: 502, code: "loop_pr_file" },
    );
  }
  const remoteSha = file.json?.sha;
  const remoteContent = Buffer.from(file.json?.content || "", "base64").toString("utf8");
  const nextContent = applyProposalChangeToSkill(remoteContent, change);
  if (nextContent === remoteContent) {
    throw new LoopPullRequestError(
      "Applied change produced no diff — refusing an empty PR.",
      { status: 409, code: "loop_pr_empty_diff" },
    );
  }

  const createRef = await githubJson(auth, `/repos/${owner}/${repo}/git/refs`, {
    method: "POST",
    body: { ref: `refs/heads/${branch}`, sha: baseSha },
    fetchImpl,
  });
  if (!createRef.res.ok) {
    // Branch may already exist from a failed prior attempt without an open PR.
    if (createRef.res.status !== 422) {
      throw new LoopPullRequestError(
        `Cannot create branch ${branch} (${createRef.res.status}): ${createRef.json?.message || "unknown"}. Proposal stays proposed.`,
        { status: 502, code: "loop_pr_branch" },
      );
    }
  }

  const putFile = await githubJson(auth, `/repos/${owner}/${repo}/contents/${filePath}`, {
    method: "PUT",
    body: {
      message: buildLoopPrTitle(agent, proposal),
      content: Buffer.from(nextContent, "utf8").toString("base64"),
      branch,
      sha: remoteSha,
    },
    fetchImpl,
  });
  if (!putFile.res.ok) {
    throw new LoopPullRequestError(
      `Cannot commit skill change on ${branch} (${putFile.res.status}): ${putFile.json?.message || "unknown"}. Proposal stays proposed.`,
      { status: 502, code: "loop_pr_commit" },
    );
  }

  const pr = await githubJson(auth, `/repos/${owner}/${repo}/pulls`, {
    method: "POST",
    body: {
      title: buildLoopPrTitle(agent, proposal),
      head: branch,
      base: defaultBranch,
      body: buildLoopPrBody({
        agent,
        proposal,
        promotionGate,
        incumbentScore,
        candidateScore,
      }),
      maintainer_can_modify: true,
    },
    fetchImpl,
  });
  if (!pr.res.ok) {
    throw new LoopPullRequestError(
      `Cannot open pull request (${pr.res.status}): ${pr.json?.message || "unknown"}. Proposal stays proposed.`,
      { status: 502, code: "loop_pr_create" },
    );
  }

  const number = pr.json.number;
  const url = pr.json.html_url;
  if (!number || !url) {
    throw new LoopPullRequestError(
      "GitHub returned a PR response without number/url — treating as failure so approval cannot lie.",
      { status: 502, code: "loop_pr_incomplete" },
    );
  }

  // Label best-effort; PR existence is what matters for approval.
  await githubJson(auth, `/repos/${owner}/${repo}/issues/${number}/labels`, {
    method: "POST",
    body: { labels: [LOOP_PR_LABEL] },
    fetchImpl,
  }).catch(() => null);

  return { reused: false, number, url, branch };
}
