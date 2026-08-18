// ═══════════════════════════════════════════════════════════════════
//  Agents Inventory — Utopia Studio
//  Schema is organised around the four pillars an agent is only ever as
//  good as: GOALS · SKILLS · TOOLS · CONTEXT  (see ai-native framing).
//  Eval is an append-only HISTORY (not a single field) so fleet health
//  can be trended, and each agent carries a versioned changelog plus an
//  optional proposedImprovements — the human-in-the-loop hook that turns
//  one-shot builds into an eval → improve → approve loop.
// ═══════════════════════════════════════════════════════════════════

// ── SEED DATA ──
const SEED_AGENTS=[
  {id:"A1",name:"LinkedIn Auditor",tagline:"Scrapes and analyzes LinkedIn profiles, then suggests prioritized fixes with suggested rewrites.",description:"",platform:"Claude",status:"Active",category:"Personal Branding",owner:"Sarah",initials:"SA",model:"Claude Opus 4.x",version:"1.2",
    usabilityModes:["download-install"],
    objective:"Every audited profile leaves with a prioritized, voice-preserving set of fixes the fellow can action same-day.",
    successCriteria:["Fellow applies ≥3 of the suggested fixes","Headline rewrite accepted without edits","Turnaround under 10 minutes"],
    guardrails:["Never rewrite in a voice the fellow hasn't approved","Flag non-English profiles for human review — do not guess"],
    when:"When onboarding a new fellow or when a fellow asks for LinkedIn help.",
    sop:"1. Copy the fellow's LinkedIn profile URL\n2. Open the LinkedIn Auditor project in Claude\n3. Paste the URL and say \"audit this profile\"\n4. Review suggestions before sharing with the fellow",
    inputs:["LinkedIn profile URL"],outputs:["Prioritized list of fixes","Suggested rewrites for each section"],
    skills:["personal-branding","copywriting","writing-revision"],
    tools:["LinkedIn (scrape)"],
    context:["Fellow's existing profile","Studio personal-branding playbook"],
    accessUrl:"",repoUrl:"",
    evalHistory:[
      {date:"2026-06-18",status:"Needs improvement",score:64,notes:"Headlines strong; About-section rewrites drift from the fellow's voice.",knownIssues:"Loses voice without few-shot examples.",by:"Sarah",traceUrl:""},
      {date:"2026-07-10",status:"Performing well",score:81,notes:"Added 3 few-shot voice examples — About rewrites much closer.",knownIssues:"Struggles with non-English profiles.",by:"Sarah",traceUrl:""}
    ],
    changelog:[{version:"1.2",date:"2026-07-10",note:"Added few-shot voice examples to the prompt."}],
    proposedImprovements:[]},

  {id:"A2",name:"Bio Generator",tagline:"Creates SEO-optimized LinkedIn bios with CTA language. Tries to learn the fellow's voice over time.",description:"",platform:"Claude",status:"Active",category:"Personal Branding",owner:"Sarah",initials:"SA",model:"Claude Sonnet 4.x",version:"1.0",
    objective:"Produce three on-voice bio options a fellow would ship with light edits, not a rewrite.",
    successCriteria:["Fellow ships one of the three variants","CTA judged 'on-brand, not pushy'","Voice-match rated ≥4/5 by owner"],
    guardrails:["No aggressive/salesy CTAs","Match the fellow's register — never default to corporate boilerplate"],
    autonomyLevel:"L1",
    goldenCases:[
      {input:"Founder bio, casual voice, 2 sample sentences",expected:"3 variants, first-person, ≤1 CTA, no buzzwords",rule:"voice-match ≥4/5 AND no banned buzzword",source:"fellow:sarah/bio-v1"},
      {input:"No voice samples provided",expected:"Agent asks for 2 anchor sentences before generating",rule:"must not generate without anchors",source:"incident 2026-07-08"}
    ],
    failureClasses:[
      {class:"voice mismatch",acceptableRate:"<10%",guardrail:"require ≥2 voice-anchor sentences"},
      {class:"aggressive CTA",acceptableRate:"0%",guardrail:"score CTA against confident-not-pushy rubric"}
    ],
    costPerOutcome:{target:0.03},
    invocation:{type:"mock"},
    usabilityModes:["hosted-run","download-install"],
    when:"When a fellow needs a new or refreshed LinkedIn bio.",
    sop:"1. Gather the fellow's current bio, role, and goals\n2. Open Bio Generator project in Claude\n3. Provide context and ask for bio options\n4. Iterate on tone and voice match",
    inputs:["Fellow's current bio","Role description","Target audience"],outputs:["3 bio variations","SEO keyword suggestions"],
    skills:["copywriting","seo-writing","value-prop-statements"],
    tools:[],
    context:["Fellow's current bio","Studio voice glossary"],
    accessUrl:"",repoUrl:"",
    evalHistory:[
      {date:"2026-07-08",status:"Needs improvement",score:58,notes:"CTAs sometimes too aggressive. Voice matching inconsistent without enough examples.",knownIssues:"Tends toward generic corporate language without strong examples.",by:"Sarah",traceUrl:""}
    ],
    changelog:[{version:"1.0",date:"2026-06-30",note:"Initial build."}],
    proposedImprovements:[]},

  {id:"A3",name:"Post Suggester",tagline:"Scrapes trending topics in a fellow's field and generates draft LinkedIn posts with hooks and CTAs.",description:"",platform:"Manus",status:"Active",category:"Marketing & Content",owner:"James",initials:"JA",model:"—",version:"1.1",
    usabilityModes:["download-install"],
    objective:"Give a fellow 5–10 credible, on-trend post drafts they can edit and publish in one sitting.",
    successCriteria:["≥2 drafts published per batch","Zero factual corrections needed on published posts","Hook rated strong by owner"],
    guardrails:["Fact-check any claim before it reaches a fellow","Never surface a trend older than 14 days as 'trending'"],
    when:"Weekly content planning for fellows, or when a fellow needs post ideas fast.",
    sop:"1. Provide the fellow's industry and recent topics\n2. Run the agent in Manus\n3. Review generated drafts\n4. Edit for voice and accuracy before sharing",
    inputs:["Fellow's industry","Recent topics or news"],outputs:["5-10 draft post ideas","Hook + CTA for each"],
    skills:["social-content","copywriting","trend-research"],
    tools:["LinkedIn (scrape)","Web search"],
    context:["Fellow's industry","Recent news feed"],
    accessUrl:"",repoUrl:"",
    evalHistory:[
      {date:"2026-07-12",status:"Performing well",score:78,notes:"Good at identifying trending angles. Hooks are strong. Some posts need fact-checking.",knownIssues:"Occasionally surfaces outdated trends.",by:"James",traceUrl:""}
    ],
    changelog:[{version:"1.1",date:"2026-07-01",note:"Tightened the trend-recency window."}],
    proposedImprovements:[]},

  {id:"A4",name:"Marketing Scout",tagline:"Scrapes Slack channels and suggests marketing tasks, topics, and content opportunities for the team.",description:"",platform:"Claude",status:"Experimental",category:"Marketing & Content",owner:"Mo",initials:"MO",model:"Claude Sonnet 4.x",version:"0.3",
    usabilityModes:["download-install"],
    objective:"Surface a weekly shortlist of high-signal marketing tasks mined from internal conversation.",
    successCriteria:["≥3 suggestions actioned per week","Signal-to-noise judged acceptable by the team","No duplicate/stale suggestions"],
    guardrails:["Never surface content from private/DM channels","Cite the source thread for every suggestion"],
    when:"When planning weekly marketing sprints or looking for content inspiration from internal conversations.",
    sop:"1. Agent runs on a schedule (or manually triggered)\n2. Reviews recent Slack activity\n3. Outputs a list of suggested tasks and topics\n4. Team reviews and picks what to action",
    inputs:["Slack channel access"],outputs:["Weekly task suggestions","Topic ideas with source threads"],
    skills:["insight-synthesis","content-strategy"],
    tools:["Slack (MCP)"],
    context:["Approved Slack channels","Marketing sprint board"],
    accessUrl:"",repoUrl:"",
    evalHistory:[],
    changelog:[{version:"0.3",date:"2026-07-09",note:"Early testing build."}],
    proposedImprovements:[]},

  {id:"A5",name:"Design Agent",tagline:"Claude + MCP integrations for design-system work — component generation, asset management, and design QA.",description:"",platform:"Claude",status:"Experimental",category:"Design & Product",owner:"Aiden",initials:"AI",model:"Claude Opus 4.x",version:"0.2",
    usabilityModes:["download-install"],
    objective:"Ship design-system components and QA that match the ceramic system without a designer in the loop for the first pass.",
    successCriteria:["Generated component passes design QA checklist","Figma + code stay in sync","Designer edits < 20% of output"],
    guardrails:["Only touch approved design-system tokens","Human sign-off required before merge to main"],
    when:"When building or updating design system components, or doing design QA on new pages.",
    sop:"1. Open the Design Agent project in Claude\n2. Describe the component or design task\n3. Agent uses MCP to interact with Figma/code\n4. Review output and iterate",
    inputs:["Component description","Design system context"],outputs:["Component code","Figma updates","QA checklist"],
    skills:["design-review","design-system-design-spec","interface-craft"],
    tools:["Figma (MCP)","GitHub (MCP)"],
    context:["Ceramic design tokens","Component library"],
    accessUrl:"",repoUrl:"",
    evalHistory:[],
    changelog:[{version:"0.2",date:"2026-07-06",note:"Wiring up Figma + GitHub MCP."}],
    proposedImprovements:[]},

  {id:"A6",name:"Research Assistant",tagline:"Cursor-based agent for deep research tasks — market analysis, competitive intel, and posting reminders.",description:"",platform:"Cursor",status:"Active",category:"Research & Analysis",owner:"Hager",initials:"HA",model:"—",version:"1.0",
    usabilityModes:["download-install"],
    objective:"Turn a research brief into a structured, well-sourced findings doc a partner can walk into a call with.",
    successCriteria:["Findings doc used in the call it was made for","≥5 credible sources cited","No major source gaps flagged in review"],
    guardrails:["Cite every claim","Flag when scope exceeds the context window rather than truncating silently"],
    when:"When preparing for investment calls, doing market research, or needing competitive analysis.",
    sop:"1. Open Cursor workspace with research agent config\n2. Provide research brief or question\n3. Agent searches, synthesizes, and outputs structured findings\n4. Review and refine",
    inputs:["Research question or brief"],outputs:["Structured research doc","Key findings summary"],
    skills:["company-research","competitive-analysis","insight-synthesis"],
    tools:["Web search"],
    context:["Research brief","Prior market notes"],
    accessUrl:"",repoUrl:"",
    evalHistory:[
      {date:"2026-07-05",status:"Performing well",score:84,notes:"Strong on synthesis. Sometimes misses niche sources.",knownIssues:"Cursor context window can limit very large research scopes.",by:"Hager",traceUrl:""}
    ],
    changelog:[{version:"1.0",date:"2026-06-28",note:"Initial build."}],
    proposedImprovements:[]},

  {id:"A7",name:"Biocraft single-shot draft",tagline:"A stateless text-only draft mode inspired by /biocraft. It requires all source material up front and has no Chrome or Drive tools.",description:"This is not the full /biocraft agent. It makes one OpenAI Responses call with no conversation state, browser tools, Drive tools, or HTML rendering.",platform:"OpenAI",status:"Experimental",category:"Personal Branding",owner:"Sarah",initials:"SA",model:"gpt-5.6-terra",version:"1.0",
    objective:"Draft a LinkedIn About bio, spoken event introduction, and headline from complete source material supplied in one request.",
    successCriteria:["LinkedIn About hook is 200 characters or fewer","Full LinkedIn About text is 2,600 characters or fewer","Suggested LinkedIn headline is 220 characters or fewer","Spoken event introduction reads aloud in 20 to 30 seconds"],
    guardrails:["Never fabricate or alter a metric, achievement, employer relationship, credential, quote, role, or job title.","Distinguish employers from tools, platforms, and events. Name an entity as an employer only when the source describes it as one. Distinguish work done for a company from founding or owning that company.","Preserve qualifiers such as Intern, Participant, and Apprenticeship.","Do not use an em dash or a double hyphen as an em-dash substitute.","Do not use emoji, exclamation points, hedging, or unnecessary passive voice.","Remove AI cliche and these terms on sight: utilize, leverage, facilitate, innovative, robust, seamless, cutting-edge, unlock, elevate, passionate, synergy, game-changer, revolutionize, revolutionary.","Do not use \"it is not X, it is Y\" contrast framing.","Do not report or annotate character counts. The host validates limits; a model-generated count is not evidence.","If a supplied quote is not grounded clearly enough to attribute, omit it.","Do not add a CTA to the third-person event introduction. The required CTA belongs only in the LinkedIn About."],
    autonomyLevel:"L1",
    invocation:{type:"runtime",mode:"single-shot",artifact:"biocraft/SKILL.md"},
    usabilityModes:["hosted-run","download-install"],
    when:"When creating or updating a fellow's LinkedIn bio, spoken event introduction, or headline from complete supplied material. After drafting, check the LinkedIn About fold on a phone and refresh the bio every 2–3 months.",
    sop:"1. Gather the fellow's name, source material, achievements, mission, skills, contact preference, and exclusions before starting\n2. Paste everything into the single source-material field\n3. Run one text-only draft\n4. Review every claim before using the output\n5. Paste the About into LinkedIn and check the fold on a phone; the hook should fit before “See more”\n6. Set a reminder to refresh the bio in 2–3 months",
    inputs:["Fellow name","All source material and interview answers (required upfront)"],outputs:["Draft LinkedIn About bio","Draft spoken event introduction","Draft suggested headline"],
    skills:["biocraft","personal-branding","copywriting"],tools:[],context:["Complete fellow source material supplied up front"],
    accessUrl:"",repoUrl:"",evalHistory:[],
    changelog:[{version:"1.0",date:"2026-08-01",note:"Stateless single-shot draft mode using a server-owned SKILL.md."}],
    proposedImprovements:[]},

  {id:"A10",name:"Biocraft gap-fill",tagline:"Sarah's interview bank as batched gaps, then a text draft. Paste material; answer only what is still missing.",description:"Hosted gap-fill mode adapted from /biocraft. Call 1 returns structured gaps against a fixed question bank; Call 2 drafts three labelled text sections. No Chrome, Drive, or HTML file write.",platform:"OpenAI",status:"Experimental",category:"Personal Branding",owner:"Sarah",initials:"SA",model:"gpt-5.6-terra",version:"biocraft-gapfill-v3",
    objective:"Detect structured gaps against Sarah's fixed interview bank, then draft a LinkedIn About, spoken event introduction, and headline from pasted material plus answers.",
    successCriteria:["LinkedIn About hook is 200 characters or fewer","Full LinkedIn About text is 2,600 characters or fewer","Suggested LinkedIn headline is 220 characters or fewer","Spoken event introduction reads aloud in 20 to 30 seconds"],
    guardrails:["Never fabricate or alter a metric, achievement, employer relationship, credential, quote, role, or job title.","Distinguish employers from tools, platforms, and events. Name an entity as an employer only when the source describes it as one. Distinguish work done for a company from founding or owning that company.","Preserve qualifiers such as Intern, Participant, and Apprenticeship.","Do not use an em dash or a double hyphen as an em-dash substitute.","Do not use emoji, exclamation points, hedging, or unnecessary passive voice.","Remove AI cliche and these terms on sight: utilize, leverage, facilitate, innovative, robust, seamless, cutting-edge, unlock, elevate, passionate, synergy, game-changer, revolutionize, revolutionary.","Do not use \"it is not X, it is Y\" contrast framing.","Do not report or annotate character counts. The host validates limits; a model-generated count is not evidence.","If a supplied quote is not grounded clearly enough to attribute, omit it.","Do not add a CTA to the third-person event introduction. The required CTA belongs only in the LinkedIn About.","Honour exclusions when supplied; never invent exclusions or treat them as gaps."],
    autonomyLevel:"L1",
    invocation:{type:"runtime",mode:"gap-fill",artifact:"biocraft-gapfill/SKILL.md"},
    usabilityModes:["hosted-run","download-install"],
    when:"When creating or updating a fellow's LinkedIn bio from incomplete pasted material that may still need Sarah's interview answers. After drafting, check the LinkedIn About fold on a phone.",
    sop:"1. Paste the fellow's name and whatever source material you have (LinkedIn About/headline, pitch or venture notes)\n2. Optionally note anything that must NOT appear\n3. Run gap detection; answer only the returned questions\n4. Review every claim before using the output\n5. Paste the About into LinkedIn and check the fold on a phone",
    inputs:["Fellow name","Source material (paste)","Optional exclusions","Gap answers when requested"],outputs:["Structured gaps or draft LinkedIn About","Draft spoken event introduction","Draft suggested headline"],
    skills:["biocraft","personal-branding","copywriting"],tools:[],context:["Pasted fellow source material","Gap answers when needed"],
    accessUrl:"",repoUrl:"",evalHistory:[],
    goldenCases:[{input:"Mira Okonkwo (partial) — Intern Helix; contracted Dextrum; founded Northline; Factory=tool; Snoonu=event; omits proudest/skills/contact/mission",expected:"Preserve relationships; Factory ≠ employer; Snoonu ≠ workplace; Call-1 gaps for omitted bank items; see a10-mira-okonkwo-v1",rule:"mechanical + source-grounding (forbid-employer-frame); see eval/goldenCases.js a10-mira-okonkwo-v1",source:"synthetic/golden-a10-v1"}],
    changelog:[{version:"biocraft-gapfill-v3",date:"2026-08-05",note:"Employer-frame guardrail + source-grounding; mechanical checks retained from A7."}],
    proposedImprovements:[]},

  // A8 is prepared-handoff: the agent lives in Aiden's repo and runs in Codex.
  // Catalogue entry only — engagement terms are in the server handoff registry.
  {id:"A8",name:"UX&QA",tagline:"Independent UX and QA round against an approved non-production build.",description:"Prepared handoff to Aiden's pinned UX&QA agent. There is no hosted run and no downloadable install package in this directory — copy the engagement brief, complete its checklist, then hand over in Codex.",platform:"Codex",status:"Experimental",category:"Design & Product",owner:"Aiden Kim",initials:"AK",model:"—",version:"0.1.0",
    objective:"Run an independent UX and QA round against an approved non-production build and return a severity-ranked issue register with evidence per finding.",
    successCriteria:["Severity-ranked issue register with evidence per finding","Scenario matrix returned as executed","Results attributed to the pinned commit SHA"],
    guardrails:["Do not treat connector availability as authorisation","Do not silently rewrite \"Not reproducible\" as \"Verified\"","Product-team internal verification stays separate from independent UX/QA verification"],
    autonomyLevel:"L1",
    invocation:{type:"link"},
    usabilityModes:["prepared-handoff"],
    when:"When a build is marked Ready for QA and needs verification independent of the product team's own testing.",
    sop:"1. Copy the engagement brief from this directory\n2. Complete its 12-item setup checklist\n3. Hand over in Codex at the pinned commit\n4. Return the issue register, scenario matrix, commit SHA, rating, and build identifier",
    inputs:["Completed 12-item setup checklist","Approved non-production URL and build identifier"],outputs:["Severity-ranked issue register","Scenario matrix as executed","Rating and notes attributed to the pinned commit"],
    skills:[],tools:[],context:[],
    accessUrl:"",repoUrl:"https://github.com/The-Utopia-Studio/ux-qa-agent",evalHistory:[],
    changelog:[{version:"0.1.0",date:"2026-08-02",note:"Registered as a prepared handoff against a pinned commit."}],
    proposedImprovements:[]}
];

const SEED_REQUESTS=[
  {id:"R1",title:"Pitch Deck Agent",desc:"Help fellows build investor-ready pitch decks from meeting notes and strategy docs.",requestedBy:"Ollie",date:"Jul 15, 2026",priority:"Important",status:"Approved",assignee:"",notes:"",shippedAgentId:null},
  {id:"R2",title:"Onboarding Agent",desc:"Guide new fellows through their first 2 weeks — checklist, introductions, setup tasks.",requestedBy:"Sarah",date:"Jul 14, 2026",priority:"Urgent",status:"In Progress",assignee:"Haia",notes:"Deciding whether this is a workflow or an agent.",shippedAgentId:null},
  {id:"R3",title:"Competitive Intel Agent",desc:"Automated competitor tracking — pull updates from news, LinkedIn, and filings.",requestedBy:"Hager",date:"Jul 12, 2026",priority:"Nice to have",status:"Requested",assignee:"",notes:"",shippedAgentId:null},
  {id:"R4",title:"Email Drafter",desc:"Draft outreach emails for fellows based on their ICP and messaging framework.",requestedBy:"James",date:"Jul 10, 2026",priority:"Important",status:"Requested",assignee:"",notes:"",shippedAgentId:null},
  {id:"R5",title:"Meeting Notes Agent",desc:"Summarize Granola meeting notes into structured action items and follow-ups.",requestedBy:"Mo",date:"Jul 8, 2026",priority:"Nice to have",status:"Declined",assignee:"",notes:"Granola already handles this well. Revisit if quality drops.",shippedAgentId:null}
];

// ── STATE (Convex is the only catalogue source) ──
let agents=[],requests=[];
let requestReadState="signed-out";
// Kept only so the read-only migration export can inspect an old browser blob.
// No catalogue field is rendered from it and no code writes it.
const LEGACY_STORE_KEY="utopia_agents_dir_v2";
let migrationReview=null;
// The map is an index over the complete Convex view model. It never contains
// browser-local records and is never persisted.
let governedPilotById=new Map();

function displayedAgents(){
  return [...agents];
}

// ── WRITE LOCK (Convex-read view) ──
// Catalog and hand-entered evaluation writes are refused while this view
// renders Convex. Railway-only evidence and loop collections remain live.
// A proposal is the one bounded agent-field exception: it may live temporarily
// on Railway's agent row and is read back explicitly from Railway. A signed
// approver can record a review decision there; no Railway catalog version moves.
//
// There is deliberately no `local` state and no fallback catalogue.
//   pending     → Convex read is in flight
//   convex      → governed directory is available
//   unavailable → explicit failure + Retry
let catalogSource="pending";
let catalogFailureReason="The governed directory could not be loaded.";
const WRITE_LOCK_REASON="Convex is the catalog source. Browser catalogue writes and fallbacks have been removed.";
const WRITE_LOCK_PENDING_REASON="Waiting for the governed Convex directory.";
const EVAL_LOCK_REASON="Manual eval logging stays locked during the pilot because an ungoverned score would affect fleet health and triage without a governed eval case or evidence link.";
const EVAL_LOCK_BADGE="Not evaluated · logging locked (pilot)";
const APPROVAL_LOCK_REASON="Sign in with the release approver role to record this review decision. Approval does not edit the artifact or release a version.";
const AUTOMATION_LIVE_NOTE="Run automations stays available under the catalog lock: the cycle stamps reversible proposals and Railway queue/learnings/loop-run records only. Auto-apply is dead, so it never bumps a catalog version. A separately configured Railway scheduler sits outside this UI lock.";
function writesLocked(){return true}
function authState(){
  const auth=typeof window!=="undefined"?window.DirectoryAuth:null;
  return auth&&typeof auth.getState==="function"?auth.getState():{status:"unavailable",detail:"Clerk sign-in is unavailable in this browser."};
}
function authCanWrite(){return authState().status==="signed-in"}
function authWriteReason(){
  const auth=authState();
  if(auth.status==="signed-out")return"Sign in to register, edit, or request.";
  if(auth.status==="initializing")return"Checking sign-in before enabling catalog changes…";
  return auth.detail||"Sign-in is unavailable. Retry before attempting a catalog change.";
}
function catalogActionReason(){return authCanWrite()?writeLockReason():authWriteReason()}
function convexReadActive(){return catalogSource==="convex"}
function catalogPending(){return catalogSource==="pending"}
function writeLockReason(){return catalogPending()?WRITE_LOCK_PENDING_REASON:WRITE_LOCK_REASON}
function setCatalogSource(source){
  if(source!=="pending"&&source!=="convex"&&source!=="unavailable")return;
  catalogSource=source;
}
function renderWriteLockBanner(){
  if(catalogPending()){
    return `<div class="write-lock-banner"><strong>Waiting for the Convex catalog read.</strong> ${escHtml(WRITE_LOCK_PENDING_REASON)}</div>`;
  }
  if(catalogSource==="unavailable")return"";
  return `<div class="write-lock-banner"><strong>Convex is the catalogue authority.</strong> Signed-in registration, edits and requests write there directly; browser-storage fallbacks are removed. Runs, trace feedback, loop proposals, review decisions, queue and learnings remain live in the loop service; manual eval logging remains locked. ${escHtml(AUTOMATION_LIVE_NOTE)}</div>`;
}
function lockedControl(label,reason,cls,opts){
  const classes=cls||"btn";
  const showReason=!(opts&&opts.showReason===false);
  // Uppercase section titles must not restyle the reason into a shouted sentence.
  const reasonHtml=showReason
    ?`<span class="locked-control-reason">${escHtml(reason)}</span>`
    :"";
  return `<span class="locked-control"><button class="${classes}" disabled aria-disabled="true" title="${escAttr(reason)}" aria-label="${escAttr(label+'. '+reason)}">${escHtml(label)}</button>${reasonHtml}</span>`;
}
function convexWritesAvailable(){return convexReadActive()&&window.ConvexDirectory&&window.ConvexDirectory.enabled}
function writeActionButton(label,onclick,cls){
  const classes=`btn${cls?" "+cls:""}`;
  if(!authCanWrite()){
    const auth=authState();
    if(auth.status==="signed-out")return `<span class="auth-action"><button class="${classes}" onclick="beginDirectorySignIn()">Sign in to register, edit, or request</button><span class="locked-control-reason">${escHtml(authWriteReason())}</span></span>`;
    return lockedControl(label,authWriteReason(),classes);
  }
  if(!convexWritesAvailable())return lockedControl(label,writeLockReason(),classes);
  return `<button class="${classes}" onclick="${onclick}">${escHtml(label)}</button>`;
}
function refuseLockedWrite(){toast(catalogActionReason());return false}
function beginDirectorySignIn(){
  const auth=typeof window!=="undefined"?window.DirectoryAuth:null;
  if(!auth||typeof auth.signIn!=="function"){toast("Sign-in is unavailable in this browser.");return}
  void auth.signIn();
}
function retryDirectorySignIn(){
  const auth=typeof window!=="undefined"?window.DirectoryAuth:null;
  if(!auth||typeof auth.retry!=="function"){toast("Sign-in retry is unavailable in this browser.");return}
  void auth.retry();
}
function renderAuthSurface(){
  const root=document.getElementById("auth-root");if(!root)return;
  const auth=authState();
  if(auth.status==="signed-in"){
    root.innerHTML=`<div class="auth-state auth-state-signed-in"><span>Signed in${auth.user&&auth.user.name?` as ${escHtml(auth.user.name)}`:""}.</span><button class="btn btn-sm" onclick="window.DirectoryAuth&&DirectoryAuth.signOut()">Sign out</button></div>`;
    return;
  }
  if(auth.status==="signed-out"){
    root.innerHTML=`<div class="auth-state auth-state-signed-out"><span>${escHtml(auth.detail)}</span><button class="btn btn-sm btn-primary" onclick="beginDirectorySignIn()">Sign in</button></div>`;
    return;
  }
  if(auth.status==="initializing"){
    root.innerHTML=`<div class="auth-state auth-state-checking"><span>${escHtml(auth.detail)}</span></div>`;
    return;
  }
  root.innerHTML=`<div class="auth-state auth-state-unavailable"><span><strong>Sign-in unavailable.</strong> ${escHtml(auth.detail)}</span><button class="btn btn-sm" onclick="retryDirectorySignIn()">Retry sign-in</button></div>`;
}
// ── END WRITE LOCK ──

// One proposal is one defect with one change, so the approve/reject decision a
// reviewer makes matches exactly what the row shows. Records written before the
// split carry a single `proposedImprovement`; read them as a one-element list.
function proposalsOf(a){
  if(!a)return[];
  if(Array.isArray(a.proposedImprovements))return a.proposedImprovements;
  return a.proposedImprovement?[a.proposedImprovement]:[];
}
function pendingProposalsOf(a){return proposalsOf(a).filter(p=>p&&p.status==="proposed")}
function autoRejectedProposalsOf(a){return proposalsOf(a).filter(p=>p&&p.status==="rejected"&&p.autoRejection&&p.autoRejection.by==="verifier")}
function approvedProposalsOf(a){return proposalsOf(a).filter(p=>p&&p.status==="approved")}

function applyRailwayProposalOverlay(serviceAgents){
  if(!convexReadActive()||!Array.isArray(serviceAgents))return false;
  const byId=new Map(serviceAgents.filter(Boolean).map(agent=>[agent.id,agent]));
  governedPilotById=new Map([...governedPilotById].map(([id,governed])=>{
    const railway=byId.get(id);
    return [id,{
      ...governed,
      // Never inherit a browser-local proposal into a governed record. The
      // panel is either a current loop-service read or absent.
      proposedImprovements:railway?proposalsOf(railway):[],
      proposedImprovement:null,
      latestProposalAttempt:railway?.latestProposalAttempt||null,
      railwayProposalRead:true,
    }];
  }));
  agents=[...governedPilotById.values()].sort((a,b)=>String(a.id).localeCompare(String(b.id),undefined,{numeric:true}));
  if(state&&state.agent&&governedPilotById.has(state.agent.id)){
    state.agent=governedPilotById.get(state.agent.id);
  }
  return true;
}
async function loadRailwayProposalOverlay({renderAfter=true}={}){
  if(!convexReadActive()||!(window.DirectoryAPI&&DirectoryAPI.enabled))return false;
  try{
    const result=await DirectoryAPI.listAgents();
    applyRailwayProposalOverlay(result&&result.agents);
    if(renderAfter)render();
    return true;
  }catch(_error){
    // Convex catalog remains usable. Absence of a successful Railway read must
    // not be presented as a loop-service proposal.
    applyRailwayProposalOverlay([]);
    if(renderAfter)render();
    return false;
  }
}
function setRailwayProposals(agentId,proposals){
  const governed=governedPilotById.get(agentId);
  if(!governed)return false;
  const updated={...governed,proposedImprovements:Array.isArray(proposals)?proposals:[],proposedImprovement:null,railwayProposalRead:true};
  governedPilotById.set(agentId,updated);
  agents=agents.map(agent=>agent.id===agentId?updated:agent);
  if(state.agent&&state.agent.id===agentId)state.agent=updated;
  return true;
}

async function loadGovernedDirectoryPilot(){
  if(!(window.ConvexDirectory&&ConvexDirectory.enabled)){
    agents=[];requests=[];
    governedPilotById=new Map();
    catalogFailureReason="The governed directory is not configured on this deployment.";
    setCatalogSource("unavailable");
    render();
    return false;
  }
  try{
    const result=await ConvexDirectory.read();
    const succeeded=Boolean(result&&result.succeeded);
    if(!succeeded||!Array.isArray(result.agents))throw new Error("Convex directory read failed");
    agents=result.agents.map(agent=>({...agent,proposedImprovements:[],proposedImprovement:null,railwayProposalRead:false}));
    governedPilotById=new Map(
      agents.filter(agent=>agent&&agent.governedInConvex===true).map(agent=>[agent.id,agent]),
    );
    setCatalogSource("convex");
    await loadRailwayProposalOverlay({renderAfter:false});
    render();
    return true;
  }catch(_error){
    agents=[];requests=[];
    governedPilotById=new Map();
    catalogFailureReason="The governed directory could not be loaded.";
    setCatalogSource("unavailable");
    render();
    return false;
  }
}
async function loadConvexRequests(){
  if(!authCanWrite()){
    requests=[];requestReadState="signed-out";return false;
  }
  if(!(window.ConvexDirectory&&ConvexDirectory.enabled)){
    requests=[];requestReadState="unavailable";return false;
  }
  requestReadState="loading";
  try{
    requests=await ConvexDirectory.listRequests();
    requestReadState="ready";
    return true;
  }catch(_error){
    requests=[];requestReadState="unavailable";
    return false;
  }
}
function retryGovernedDirectory(){
  setCatalogSource("pending");
  render();
  void loadGovernedDirectoryPilot();
}

const CATEGORIES=["Personal Branding","Marketing & Content","Design & Product","Research & Analysis","Operations & Workflow","Investment & DD","Other"];
const PLATFORMS=["Claude","Codex","Cursor","Manus","ChatGPT","OpenAI","n8n","Custom","Other"];
const STATUS_OPTIONS=["Experimental","Active","Under Review","Deprecated"];
const EVAL_OPTIONS=["Not evaluated","Performing well","Needs improvement","Under review"];
const REQ_STATUSES=["Requested","Approved","In Progress","Shipped","Declined"];
const PRIORITIES=["Nice to have","Important","Urgent"];

let state={view:"list",subTab:"agents",agent:null,catFilter:"All",statusFilter:"All",modal:null,editingAgent:null};

// ── HELPERS ──
function statusClass(s){return{Active:"pill-active",Experimental:"pill-experimental",Deprecated:"pill-deprecated","Under Review":"pill-amber"}[s]||"pill-neutral"}
function evalClass(s){return{"Performing well":"pill-green","Needs improvement":"pill-amber","Under review":"pill-blue"}[s]||"pill-grey"}
function platformIcon(p){return{Claude:"◈",Cursor:"▣",Manus:"◉",ChatGPT:"◎",OpenAI:"◎"}[p]||"◇"}
function reqStatusClass(s){return{Requested:"pill-neutral",Approved:"pill-blue","In Progress":"pill-purple",Shipped:"pill-green",Declined:"pill-grey"}[s]||"pill-neutral"}
function priorityClass(p){return{Urgent:"pill-amber",Important:"pill-neutral","Nice to have":"pill-grey"}[p]||"pill-grey"}
function getInitials(name){return name.split(" ").map(w=>w[0]).join("").toUpperCase().slice(0,2)}
function autonomyLabel(l){return{L0:"assist only",L1:"suggest + confirm",L2:"act narrow + audit",L3:"act broad",L4:"autonomous"}[l]||"suggest + confirm"}
function escHtml(s){return s?String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"):""}
function escAttr(s){return escHtml(s)}
/** First 8 hex chars; copy button copies the full value. Full digest stays in Governed Identity only. */
function digestChip(full,opts){
  const value=String(full||"").trim();
  if(!value)return`<code>—</code>`;
  const short=value.slice(0,8);
  const algo=(opts&&opts.algo)||"sha256";
  const label=opts&&opts.label?`${escHtml(opts.label)} `:"";
  return`<span class="digest-chip">${label}<span class="digest-chip-algo">${escHtml(algo)}</span> <code title="${escAttr(value)}">${escHtml(short)}</code> <button type="button" class="btn-ghost btn-xs digest-copy" onclick="copyText(${JSON.stringify(value)},'Digest copied')" title="Copy full digest" aria-label="Copy full digest">⧉</button></span>`;
}
/** Commits: 7 chars + copy; full value only where a key-value block keeps it. */
function commitChip(full){
  const value=String(full||"").trim();
  if(!value)return`<code>—</code>`;
  return`<span class="digest-chip"><code title="${escAttr(value)}">${escHtml(value.slice(0,7))}</code> <button type="button" class="btn-ghost btn-xs digest-copy" onclick="copyText(${JSON.stringify(value)},'Commit SHA copied')" title="Copy full commit SHA" aria-label="Copy full commit SHA">⧉</button></span>`;
}
/**
 * Never string-prefix "v" onto an artifact id. Bare semver → v1.0; artifact
 * names ending in -vN → vN; otherwise omit a version token from the eyebrow.
 */
function shortVersionLabel(version){
  const v=String(version||"").trim();
  if(!v)return"";
  const artifactTail=v.match(/-v(\d+)$/i);
  if(artifactTail)return`v${artifactTail[1]}`;
  if(/^\d+(\.\d+)*$/.test(v))return`v${v}`;
  return"";
}
function isArtifactVersionId(version){
  const v=String(version||"").trim();
  return Boolean(v)&&!/^\d+(\.\d+)*$/.test(v);
}
function detailEyebrow(a){
  const short=shortVersionLabel(a.version);
  const model=a.model?` · ${escHtml(a.model)}`:"";
  return`Agent ${escHtml(a.id)}${short?` · ${escHtml(short)}`:""}${model}`;
}
function toast(msg){const t=document.createElement("div");t.className="toast";t.textContent=msg;document.body.appendChild(t);setTimeout(()=>t.remove(),2500)}
function renderProposalChanges(changes){
  if(!Array.isArray(changes)||!changes.length)return`<div class="loop-contract-error">This legacy record has no structured changes and cannot be approved. Reject it, then run Propose improvement again.</div>`;
  return`<div class="loop-changes">${changes.map((c,i)=>`
    <div class="loop-change">
      <div class="loop-change-head"><span class="loop-change-index">Change ${i+1}</span><span class="pill pill-xs pill-blue">${escHtml(c.surface)}</span></div>
      <div class="loop-change-target"><span>Target</span><code>${escHtml(c.target)}</code></div>
      <div class="loop-change-field"><span>Current</span><p>${escHtml(c.current)}</p></div>
      <div class="loop-change-field"><span>Proposed</span><p>${escHtml(c.proposed)}</p></div>
      <div class="loop-change-field"><span>Why</span><p>${escHtml(c.rationale)}</p></div>
      <div class="loop-change-evidence"><span>Evidence</span>${(c.evidence||[]).map(id=>`<code>${escHtml(id)}</code>`).join("")}</div>
    </div>`).join("")}</div>`;
}
function formatDate(d){if(!d)return"";const dt=new Date(d);return isNaN(dt)?escHtml(d):dt.toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}
function parseCSV(s){return s?s.split(",").map(x=>x.trim()).filter(Boolean):[]}
function parseLines(s){return s?s.split("\n").map(x=>x.replace(/^\s*[-•\d.]+\s*/,"").trim()).filter(Boolean):[]}

// eval helpers (history is the source of truth)
function latestEval(a){return a.evalHistory&&a.evalHistory.length?a.evalHistory[a.evalHistory.length-1]:null}
function agentEvalStatus(a){const e=latestEval(a);return e?e.status:"Not evaluated"}
function evalStatusBadgeLabel(a){
  const e=latestEval(a);
  if(e)return typeof e.score==="number"?`${e.score} · ${e.status}`:e.status;
  // Pilot lock: badge carries the claim; full reason lives in the Why? disclosure.
  if(isReadOnlyRecord(a))return EVAL_LOCK_BADGE;
  return"Not evaluated";
}
function renderEvalLockWhy(a){
  if(!(isReadOnlyRecord(a)&&!latestEval(a)))return"";
  return`<details class="eval-lock-why"><summary>Why?</summary><p>${escHtml(EVAL_LOCK_REASON)}</p></details>`;
}
function bumpVersion(v){const m=String(v||"0.0").match(/^(\d+)\.(\d+)/);if(!m)return"1.0";return m[1]+"."+(parseInt(m[2],10)+1)}

// ── MODAL FORMS ──
function agentFormHtml(agent){
  const isEdit=!!agent;
  const a=agent||{name:"",tagline:"",description:"",platform:"Claude",status:"Experimental",category:"",owner:"",model:"",version:"0.1.0",objective:"",successCriteria:[],guardrails:[],when:"",sop:"",inputs:[],outputs:[],skills:[],tools:[],context:[],runner:"none",usabilityModes:["download-install"],accessUrl:"",repoUrl:""};
  const cur=latestEval(a)||{};
  return `
  <div class="modal-header">
    <div><h2>${isEdit?"Edit Agent":"Add Agent"}</h2><p>${isEdit?"Update this agent's spec":"Register a new agent — think in goals, skills, tools, context"}</p></div>
    <button class="modal-close" onclick="closeModal()">&times;</button>
  </div>
  <div class="modal-body">
    <div class="form-section">
      <div class="form-section-title">Identity</div>
      <div class="form-group"><label>Name<span class="req">*</span></label><input type="text" id="f-name" value="${escHtml(a.name)}" placeholder="e.g. LinkedIn Auditor" maxlength="40"><div class="hint">Short, memorable. Max 40 characters.</div></div>
      <div class="form-group"><label>Tagline<span class="req">*</span></label><input type="text" id="f-tagline" value="${escHtml(a.tagline)}" placeholder="One sentence: what it does and for whom" maxlength="120"><div class="hint">Max 120 characters.</div></div>
      <div class="form-group"><label>Description</label><textarea id="f-desc" rows="2" placeholder="What it does, how it works, why it exists">${escHtml(a.description||"")}</textarea></div>
    </div>

    <div class="form-section pillar-goals">
      <div class="form-section-title">① Goals — what good looks like</div>
      <div class="form-group"><label>Objective<span class="req">*</span></label><textarea id="f-objective" rows="2" placeholder="The single outcome this agent exists to produce">${escHtml(a.objective||"")}</textarea></div>
      <div class="form-row">
        <div class="form-group"><label>Success criteria</label><textarea id="f-success" rows="3" placeholder="One measurable signal per line">${escHtml((a.successCriteria||[]).join("\n"))}</textarea><div class="hint">One per line. How you'll know it worked.</div></div>
        <div class="form-group"><label>Guardrails</label><textarea id="f-guardrails" rows="3" placeholder="One constraint per line">${escHtml((a.guardrails||[]).join("\n"))}</textarea><div class="hint">One per line. Must-nots and limits.</div></div>
      </div>
      <div class="form-group"><label>Autonomy level</label><select id="f-autonomy">${["L0","L1","L2","L3","L4"].map(l=>`<option${(a.autonomyLevel||"L1")===l?" selected":""}>${l}</option>`).join("")}</select><div class="hint">L0 assist · L1 suggest+confirm · L2 act narrow+audit · L3 act broad · L4 autonomous. This describes action scope; proposals always require human approval.</div></div>
    </div>

    <div class="form-section">
      <div class="form-section-title">Usage — when &amp; how</div>
      <div class="form-group"><label>When to use<span class="req">*</span></label><textarea id="f-when" rows="2" placeholder="What situation triggers using this agent?">${escHtml(a.when)}</textarea></div>
      <div class="form-group"><label>SOP — Step by step<span class="req">*</span></label><textarea id="f-sop" rows="4" placeholder="1. Open the project in Claude&#10;2. Paste the input&#10;3. Review the output">${escHtml(a.sop)}</textarea><div class="hint">Numbered steps. One per line.</div></div>
      <div class="form-row">
        <div class="form-group"><label>Inputs</label><input type="text" id="f-inputs" value="${escHtml((a.inputs||[]).join(", "))}" placeholder="e.g. LinkedIn URL, bio text"><div class="hint">Comma-separated</div></div>
        <div class="form-group"><label>Outputs</label><input type="text" id="f-outputs" value="${escHtml((a.outputs||[]).join(", "))}" placeholder="e.g. List of fixes, rewritten bio"><div class="hint">Comma-separated</div></div>
      </div>
      <div class="form-group"><label>Runner<span class="req">*</span></label><select id="f-runner">${["native","api","foreign-runtime-handoff","scheduled-worker","none"].map(r=>`<option value="${r}" ${(a.runner||"none")===r?"selected":""}>${r}</option>`).join("")}</select><div class="hint">Where this agent runs. Invocation configuration is set separately by the runtime owner.</div></div>
      <div class="form-group"><label>Usability modes</label><div class="check-row">${["hosted-run","download-install","prepared-handoff","approval-queue"].map(mode=>`<label class="check-label"><input type="checkbox" name="f-usability" value="${mode}" ${(a.usabilityModes||[]).includes(mode)?"checked":""}> ${mode}</label>`).join("")}</div><div class="hint">What users can do; separate from the single execution adapter.</div></div>
    </div>

    <div class="form-section pillar-scc">
      <div class="form-section-title">② Skills · ③ Tools · ④ Context</div>
      <div class="form-group"><label>Skills</label><input type="text" id="f-skills" value="${escHtml((a.skills||[]).join(", "))}" placeholder="e.g. copywriting, seo-writing"><div class="hint">Reusable procedures from the Skills library. Comma-separated.</div></div>
      <div class="form-group"><label>Tools</label><input type="text" id="f-tools" value="${escHtml((a.tools||[]).join(", "))}" placeholder="e.g. Slack (MCP), Figma (MCP), Web search"><div class="hint">MCPs / integrations / APIs it can call. Comma-separated.</div></div>
      <div class="form-group"><label>Context</label><input type="text" id="f-context" value="${escHtml((a.context||[]).join(", "))}" placeholder="e.g. Fellow's profile, Studio playbook"><div class="hint">Memory / knowledge / data it draws on. Comma-separated.</div></div>
    </div>

    <div class="form-section">
      <div class="form-section-title">Platform &amp; Classification</div>
      <div class="form-row">
        <div class="form-group"><label>Platform<span class="req">*</span></label><select id="f-platform">${PLATFORMS.map(p=>`<option${a.platform===p?" selected":""}>${p}</option>`).join("")}</select></div>
        <div class="form-group"><label>Category<span class="req">*</span></label><select id="f-category"><option value="">Select...</option>${CATEGORIES.map(c=>`<option${a.category===c?" selected":""}>${c}</option>`).join("")}</select></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Status<span class="req">*</span></label><select id="f-status">${STATUS_OPTIONS.map(s=>`<option${a.status===s?" selected":""}>${s}</option>`).join("")}</select></div>
        <div class="form-group"><label>Owner<span class="req">*</span></label><input type="text" id="f-owner" value="${escHtml(a.owner)}" placeholder="e.g. Sarah"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Model</label><input type="text" id="f-model" value="${escHtml(a.model||"")}" placeholder="e.g. Claude Opus 4.x"></div>
        <div class="form-group"><label>Version</label><input type="text" id="f-version" value="${escHtml(a.version||"")}" placeholder="e.g. 1.0"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Access URL</label><input type="url" id="f-access" value="${escHtml(a.accessUrl||"")}" placeholder="https://..."></div>
        <div class="form-group"><label>Repo URL</label><input type="url" id="f-repo" value="${escHtml(a.repoUrl||"")}" placeholder="https://github.com/..."></div>
      </div>
    </div>
  </div>
  <div class="modal-footer">
    <button class="btn" onclick="closeModal()">Cancel</button>
    <button class="btn btn-primary" onclick="${isEdit?`saveEditAgent('${a.id}')`:"saveNewAgent()"}">Save agent</button>
  </div>`;
}

function requestFormHtml(){
  return `
  <div class="modal-header">
    <div><h2>Request an Agent</h2><p>Describe what you need — the build team will triage it</p></div>
    <button class="modal-close" onclick="closeModal()">&times;</button>
  </div>
  <div class="modal-body">
    <div class="form-group"><label>What should the agent do?<span class="req">*</span></label><input type="text" id="r-title" placeholder="e.g. Build pitch decks from meeting notes"></div>
    <div class="form-group"><label>Describe the need<span class="req">*</span></label><textarea id="r-desc" rows="4" placeholder="What problem would this solve? Who would use it? What would it take as input and produce as output?"></textarea></div>
    <div class="form-row">
      <div class="form-group"><label>Your name<span class="req">*</span></label><input type="text" id="r-name" placeholder="e.g. James"></div>
      <div class="form-group"><label>Priority</label><select id="r-priority">${PRIORITIES.map(p=>`<option>${p}</option>`).join("")}</select></div>
    </div>
  </div>
  <div class="modal-footer">
    <button class="btn" onclick="closeModal()">Cancel</button>
    <button class="btn btn-primary" onclick="saveNewRequest()">Submit request</button>
  </div>`;
}

function evalFormHtml(agent){
  return `
  <div class="modal-header">
    <div><h2>Log an Evaluation</h2><p>${escHtml(agent.name)} — appends to eval history</p></div>
    <button class="modal-close" onclick="closeModal()">&times;</button>
  </div>
  <div class="modal-body">
    <div class="form-row">
      <div class="form-group"><label>Eval Status</label><select id="e-status">${EVAL_OPTIONS.filter(o=>o!=="Not evaluated").map(e=>`<option>${e}</option>`).join("")}</select></div>
      <div class="form-group"><label>Score (0–100)</label><input type="number" id="e-score" min="0" max="100" value="75"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Reviewed by</label><input type="text" id="e-by" placeholder="e.g. Sarah"></div>
      <div class="form-group"><label>Trace URL</label><input type="url" id="e-trace" placeholder="Langfuse / trace link (optional)"></div>
    </div>
    <div class="form-group"><label>Notes<span class="req">*</span></label><textarea id="e-notes" rows="3" placeholder="Measured against the success criteria — what's working, what's not?"></textarea></div>
    <div class="form-group"><label>Known Issues</label><textarea id="e-issues" rows="2" placeholder="Failure modes, limitations"></textarea></div>
  </div>
  <div class="modal-footer">
    <button class="btn" onclick="closeModal()">Cancel</button>
    <button class="btn btn-primary" onclick="saveEval('${agent.id}')">Log evaluation</button>
  </div>`;
}

function triageFormHtml(req){
  return `
  <div class="modal-header">
    <div><h2>Triage Request</h2><p>${escHtml(req.title)}</p></div>
    <button class="modal-close" onclick="closeModal()">&times;</button>
  </div>
  <div class="modal-body">
    <div class="triage-context">
      <div class="desc">${escHtml(req.desc)}</div>
      <div class="meta">Requested by ${escHtml(req.requestedBy)} &middot; ${escHtml(req.date)}</div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Status</label><select id="t-status">${REQ_STATUSES.map(s=>`<option${req.status===s?" selected":""}>${s}</option>`).join("")}</select></div>
      <div class="form-group"><label>Priority</label><select id="t-priority">${PRIORITIES.map(p=>`<option${req.priority===p?" selected":""}>${p}</option>`).join("")}</select></div>
    </div>
    <div class="form-group"><label>Assign to</label><input type="text" id="t-assignee" value="${escHtml(req.assignee||"")}" placeholder="e.g. Haia"></div>
    <div class="form-group"><label>Notes</label><textarea id="t-notes" rows="2" placeholder="Triage notes, decline reason, etc.">${escHtml(req.notes||"")}</textarea></div>
    ${req.shippedAgentId?`<div class="hint">Shipped as agent ${escHtml(req.shippedAgentId)}.</div>`:""}
  </div>
  <div class="modal-footer">
    <button class="btn" onclick="closeModal()">Cancel</button>
    ${lockedControl("Ship as agent","Request-to-agent conversion is deferred. Register the agent separately; linking a request to a released agent needs its own governed workflow.","btn")}
    <button class="btn btn-primary" onclick="saveTriage('${req.id}')">Save changes</button>
  </div>`;
}

// ── MODAL MANAGEMENT ──
function openModal(type,data){
  // Only register, edit and request have a Convex mutation in this hybrid
  // phase. No form is allowed to silently fall back to localStorage.
  if(["addAgent","editAgent","request","triage"].includes(type)){
    if(!authCanWrite()||!convexWritesAvailable())return refuseLockedWrite();
    if(type==="editAgent"&&!data?.governedInConvex){
      toast("This local fixture is read-only until it is registered in Convex.");return;
    }
  }else if(writesLocked())return refuseLockedWrite();
  const root=document.getElementById("modal-root");
  let html="";
  if(type==="addAgent") html=agentFormHtml(data||null);
  else if(type==="editAgent") html=agentFormHtml(data);
  else if(type==="request") html=requestFormHtml();
  else if(type==="eval") html=evalFormHtml(data);
  else if(type==="triage") html=triageFormHtml(data);
  root.innerHTML=`<div class="modal-overlay" onclick="if(event.target===this)closeModal()"><div class="modal">${html}</div></div>`;
}
function closeModal(){document.getElementById("modal-root").innerHTML="";state.pendingRequestId=null}

// ── SAVE HANDLERS ──
function readAgentForm(){
  return{
    name:document.getElementById("f-name").value.trim(),
    tagline:document.getElementById("f-tagline").value.trim(),
    description:document.getElementById("f-desc").value.trim(),
    objective:document.getElementById("f-objective").value.trim(),
    successCriteria:parseLines(document.getElementById("f-success").value),
    guardrails:parseLines(document.getElementById("f-guardrails").value),
    autonomyLevel:document.getElementById("f-autonomy").value,
    platform:document.getElementById("f-platform").value,
    status:document.getElementById("f-status").value,
    category:document.getElementById("f-category").value,
    owner:document.getElementById("f-owner").value.trim(),
    model:document.getElementById("f-model").value.trim(),
    version:document.getElementById("f-version").value.trim(),
    when:document.getElementById("f-when").value.trim(),
    sop:document.getElementById("f-sop").value.trim(),
    inputs:parseCSV(document.getElementById("f-inputs").value),
    outputs:parseCSV(document.getElementById("f-outputs").value),
    runner:document.getElementById("f-runner").value,
    usabilityModes:[...document.querySelectorAll('input[name="f-usability"]:checked')].map(el=>el.value),
    skills:parseCSV(document.getElementById("f-skills").value),
    tools:parseCSV(document.getElementById("f-tools").value),
    context:parseCSV(document.getElementById("f-context").value),
    accessUrl:document.getElementById("f-access").value.trim(),
    repoUrl:document.getElementById("f-repo").value.trim()
  };
}
function validAgent(f){return f.name&&f.tagline&&f.objective&&f.when&&f.sop&&f.category&&f.owner&&Array.isArray(f.usabilityModes)&&f.usabilityModes.length>0}

function stableItems(labels,existing=[]){
  const seen=new Map();
  const reusable=new Map();
  for(const item of existing||[]){
    if(item&&typeof item.label==="string"&&typeof item.id==="string"){
      const items=reusable.get(item.label)||[];items.push(item.id);reusable.set(item.label,items);
    }
  }
  return labels.map(label=>{
    const prior=reusable.get(label);if(prior&&prior.length)return {id:prior.shift(),label};
    const base=String(label).toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")||"item";
    const count=(seen.get(base)||0)+1;seen.set(base,count);
    return {id:count===1?base:`${base}-${count}`,label};
  });
}
function contractItems(values){return values.map(key=>({key,required:true}));}
function contractTools(values){return values.map(label=>({label,type:"other"}));}
function contractContext(values){return values.map(label=>({label,type:"memory"}));}
function invocationForRunner(runner){
  // This form deliberately does not accept endpoints, credentials or a path.
  // A runtime owner configures an invocation separately; no browser value is
  // invented here.
  return undefined;
}
function convexRegistrationArgs(f,existing){
  return {
    name:f.name,tagline:f.tagline,description:f.description||undefined,
    platform:f.platform,status:f.status,category:f.category,owner:f.owner,
    model:f.model||undefined,objective:f.objective||undefined,whenToUse:f.when||undefined,
    sop:f.sop||undefined,outputs:f.outputs,runner:f.runner,
    usabilityModes:f.usabilityModes,invocation:existing?.invocation??invocationForRunner(f.runner),
    autonomyLevel:f.autonomyLevel,
    executionContract:{inputs:contractItems(f.inputs),runnerConfig:[]},
    evidenceContract:{acceptedTypes:[],requiredReturnArtifact:false},
    outcomeContract:{successCriteria:stableItems(f.successCriteria,existing?.outcomeContract?.successCriteria),evalSetId:null},
    guardrails:stableItems(f.guardrails,existing?.guardrails),skills:f.skills,tools:contractTools(f.tools),
    context:contractContext(f.context),accessUrl:f.accessUrl||undefined,repoUrl:f.repoUrl||undefined,
    draftVersion:f.version||"0.1.0",
  };
}
function editArgsForAgent(agent,f){
  const record=agent.convexRecord||{};
  const next=convexRegistrationArgs(f,record);
  const current={
    name:agent.name,tagline:agent.tagline,description:agent.description||undefined,
    platform:agent.platform,status:agent.status,category:agent.category,owner:agent.owner,
    model:agent.model||undefined,objective:agent.objective||undefined,whenToUse:agent.when||undefined,
    sop:agent.sop||undefined,outputs:agent.outputs||[],runner:agent.runner,
    usabilityModes:agent.usabilityModes||[],invocation:agent.invocation||undefined,
    autonomyLevel:agent.autonomyLevel||undefined,
    executionContract:record.executionContract||{inputs:contractItems(agent.inputs||[]),runnerConfig:[]},
    evidenceContract:record.evidenceContract||{acceptedTypes:[],requiredReturnArtifact:false},
    outcomeContract:record.outcomeContract||{successCriteria:stableItems(agent.successCriteria||[]),evalSetId:null},
    guardrails:record.guardrails||stableItems(agent.guardrails||[]),skills:agent.skills||[],tools:record.tools||contractTools(agent.tools||[]),
    context:record.context||contractContext(agent.context||[]),accessUrl:agent.accessUrl||undefined,repoUrl:agent.repoUrl||undefined,
  };
  const args={agentId:agent.convexId};
  for(const [key,value] of Object.entries(next)){
    if(["draftVersion","evidenceContract"].includes(key))continue;
    const editKey=key==="outcomeContract"?"successCriteria":key;
    const nextValue=key==="outcomeContract"?value.successCriteria:value;
    const currentValue=key==="outcomeContract"?current.outcomeContract.successCriteria:current[key];
    if(JSON.stringify(nextValue)!==JSON.stringify(currentValue))args[editKey]=nextValue;
  }
  return args;
}

async function saveNewAgent(){
  if(!authCanWrite()||!convexWritesAvailable())return refuseLockedWrite();
  const f=readAgentForm();
  if(!validAgent(f)){toast("Fill in all required fields and select a usability mode");return}
  try{
    const created=await ConvexDirectory.registerAgent(convexRegistrationArgs(f));
    closeModal();await loadGovernedDirectoryPilot();
    toast(`Agent registered in Convex: ${created.displayId}`);
  }catch(error){toast(`Agent was not registered: ${error&&error.message?error.message:"Convex rejected the request"}`)}
}

async function saveEditAgent(id){
  if(!authCanWrite()||!convexWritesAvailable())return refuseLockedWrite();
  const a=governedPilotById.get(id);if(!a||!a.convexId){toast("This agent is not a Convex record.");return}
  const f=readAgentForm();
  if(!validAgent(f)){toast("Fill in all required fields and select a usability mode");return}
  const args=editArgsForAgent(a,f);
  if(Object.keys(args).length===1){toast("No Convex-backed fields changed.");return}
  try{
    await ConvexDirectory.updateAgent(args);
    closeModal();await loadGovernedDirectoryPilot();
    toast("Agent updated in Convex: "+f.name);
  }catch(error){toast(`Agent was not updated: ${error&&error.message?error.message:"Convex rejected the request"}`)}
}

async function saveNewRequest(){
  if(!authCanWrite()||!convexWritesAvailable())return refuseLockedWrite();
  const title=document.getElementById("r-title").value.trim();
  const desc=document.getElementById("r-desc").value.trim();
  const name=document.getElementById("r-name").value.trim();
  if(!title||!desc||!name){toast("Fill in all required fields");return}
  try{
    const requestId=await ConvexDirectory.createRequest({title,desc,requestedBy:name,priority:document.getElementById("r-priority").value});
    closeModal();await loadConvexRequests();toast(`Request recorded in Convex: ${requestId}`);render();
  }catch(error){toast(`Request was not submitted: ${error&&error.message?error.message:"Convex rejected the request"}`)}
}

function saveEval(id){
  toast(EVAL_LOCK_REASON);
}

async function saveTriage(id){
  if(!authCanWrite()||!convexWritesAvailable())return refuseLockedWrite();
  const r=requests.find(x=>x.id===id);if(!r)return;
  try{
    await ConvexDirectory.updateRequest({
      id:r.convexId,
      status:document.getElementById("t-status").value,
      priority:document.getElementById("t-priority").value,
      assignee:document.getElementById("t-assignee").value.trim(),
      notes:document.getElementById("t-notes").value.trim(),
    });
    closeModal();await loadConvexRequests();toast("Request updated: "+r.title);render();
  }catch(error){toast(`Request was not updated: ${error&&error.message?error.message:"Convex rejected the request"}`)}
}

function shipRequestAsAgent(id){
  toast("Request-to-agent conversion is deferred. Register the agent separately; linking a request to a released agent needs its own governed workflow.");
}

// ── THE LOOP: propose → human approves/rejects → new version ──
// The maker only runs server-side, against real defect signals (failing
// traces, reviewer feedback notes, eval known issues). There is no offline
// synthesis path: a proposal carries an Approve button, so it must never be
// backed by a template the front-end wrote about itself. No evidence, or no
// service, means no proposal.
async function proposeImprovement(id){
  const a=governedPilotById.get(id);if(!a){toast("Cannot propose: the governed agent record is unavailable.");return}
  if(!(window.DirectoryAPI&&DirectoryAPI.enabled)){
    toast("Cannot propose offline — the optimizer reads real traces and feedback, which only the loop service can see");
    return;
  }
  try{
    const result=await DirectoryAPI.runImprovement(id);
    const proposals=(Array.isArray(result)?result:[result]).filter(Boolean).map(p=>({...p}));
    if(!proposals.length){toast("The optimizer returned no proposal");return}
    const count=proposals.length===1?"1 proposal":`${proposals.length} proposals`;
    if(setRailwayProposals(id,proposals)){
      render();
      toast(`${count} created from Railway evidence, one per defect. Catalog approval remains locked during the Convex pilot.`);
      return;
    }
    toast("Proposal was created by Railway but could not be attached to the governed directory view. Reload before trying again.");
  }catch(e){
    // Refusals are the expected result with no evidence; show the reason
    // verbatim so it names what is missing.
    toast(String(e&&e.message?e.message:e));
  }
}
// Decisions are per proposal, so every caller names the one it acted on. The
// remaining proposals stay pending rather than being cleared by a decision
// nobody made about them.
async function approveImprovement(id,proposalId){
  if(!authCanWrite()){toast(authWriteReason());return}
  if(!(window.DirectoryAPI&&DirectoryAPI.enabled)){toast("Approval unavailable — the Railway loop service cannot be reached.");return}
  try{
    const result=await DirectoryAPI.approve(id,proposalId);
    const displayed=governedPilotById.get(id);
    if(!displayed){toast("Approval was recorded, but the governed agent view is unavailable. Reload to reconcile it.");return}
    const decided=result&&result.proposal;
    const proposals=proposalsOf(displayed).map(proposal=>proposal&&proposal.id===proposalId?(decided||proposal):proposal);
    if(setRailwayProposals(id,proposals)){
      render();toast("Review approval recorded. Behaviour is unchanged until a human commits the patch.");return;
    }
    toast("Approval was recorded, but the proposal panel could not refresh. Reload to reconcile it.");
  }catch(e){
    if(e&&e.proposal){
      const displayed=governedPilotById.get(id);
      if(displayed){
        const proposals=proposalsOf(displayed).map(proposal=>proposal&&proposal.id===proposalId?e.proposal:proposal);
        setRailwayProposals(id,proposals);
        render();
      }
    }
    toast(`Approval failed — ${String(e&&e.message||"the review decision was not recorded")}`);
  }
}
async function rejectImprovement(id,proposalId){
  const displayed=governedPilotById.get(id);if(!displayed){toast("Cannot reject: the governed agent record is unavailable.");return}
  const pending=pendingProposalsOf(displayed);
  const target=pending.find(p=>p.id===proposalId)||(pending.length===1?pending[0]:null);
  if(!target)return;
  if(!(window.DirectoryAPI&&DirectoryAPI.enabled)){toast("Reject unavailable — the Railway loop service cannot be reached.");return}
  try{await DirectoryAPI.reject(id,target.id)}
  catch(e){toast(`Reject failed — ${String(e&&e.message||"the loop-service proposal was not changed")}`);return}
  const remaining=proposalsOf(displayed).filter(p=>p!==target);
  if(setRailwayProposals(id,remaining)){
    render();toast("Loop-service proposal rejected and cleared from Railway");return;
  }
  toast("Railway rejected the proposal, but the governed view could not refresh. Reload to reconcile it.");
}
async function reopenVerifierRejectedImprovement(id,proposalId){
  if(!(window.DirectoryAPI&&DirectoryAPI.enabled)){toast("Cannot reopen — the loop service is unavailable");return}
  try{
    const reopened=await DirectoryAPI.reopenRejected(id,proposalId);
    const displayed=governedPilotById.get(id);
    if(displayed){
      const proposals=proposalsOf(displayed).map(p=>p&&p.id===reopened.id?reopened:p);
      setRailwayProposals(id,proposals);
      const updated=governedPilotById.get(id);
      if(updated){
        const next={...updated,latestProposalAttempt:{outcome:"reopened-for-human-review",recordedAt:reopened.reopenedForHumanReviewAt,proposalId:reopened.id}};
        governedPilotById.set(id,next);
        agents=agents.map(agent=>agent.id===id?next:agent);
      }
      render();toast("Verifier rejection reopened for human review");return;
    }
    toast("Reopened in the loop service — refresh this agent to view it");
  }catch(e){toast(`Could not reopen: ${String(e&&e.message||e)}`)}
}

// ── RENDER ──
function renderSubTabs(){
  const reqCount=requests.filter(r=>r.status!=="Declined"&&r.status!=="Shipped").length;
  return `<div class="sub-tabs">
    <div class="sub-tab ${state.subTab==="agents"?"active":""}" onclick="switchSubTab('agents')">Agents<span class="count-badge">${agents.length}</span></div>
    <div class="sub-tab ${state.subTab==="requests"?"active":""}" onclick="switchSubTab('requests')">Requests<span class="count-badge">${reqCount}</span></div>
  </div>`;
}

function renderHealthStrip(){
  return `<div class="health-strip"><div class="health-stat"><span class="health-num">—</span><span class="health-label">No governed evaluation data yet<br>Legacy browser scores are intentionally omitted</span></div></div>`;
}

function readinessLabel(status){return status==="ready"?"Ready":status==="blocked"?"Blocked":"Needs review"}
function renderMigrationReadiness(){
  if(!migrationReview)return"";
  const readiness=migrationReview.readiness||{},summary=readiness.summary||{};
  const groups=Object.entries(migrationReview.records||{}).map(([type,rows])=>{
    if(!rows.length)return"";
    return `<div class="migration-group">
      <div class="migration-group-title">${escHtml(type)} <span>${rows.length}</span></div>
      ${rows.map(row=>`<div class="migration-row">
        <span class="migration-source">${escHtml(row.source)}</span>
        <code>${escHtml(row.sourceId)}</code>
        <span class="migration-status migration-${escHtml(row.readiness.status)}">${readinessLabel(row.readiness.status)}</span>
        <span class="migration-reasons">${(row.readiness.reasons||[]).map(reason=>escHtml(reason.message)).join(" · ")||"All governed fields present"}</span>
      </div>`).join("")}
    </div>`;
  }).join("");
  const sourceIssues=(readiness.sourceIssues||[]).map(issue=>`<div class="migration-source-issue">${escHtml(issue.source)} — ${escHtml(issue.reason)}</div>`).join("");
  return `<section class="migration-report">
    <div class="migration-report-head">
      <div><div class="migration-kicker">PHASE 2 · READ-ONLY</div><h3>Migration readiness</h3><p>${summary.total||0} records · ${summary.ready||0} ready · ${summary.blocked||0} blocked · ${summary["needs-review"]||0} need review</p></div>
      <button class="btn btn-sm btn-primary" onclick="downloadMigrationReview()">Download review JSON</button>
    </div>
    ${sourceIssues}
    <div class="migration-privacy">Metadata-only export. Raw run inputs, outputs, prompts, credentials, source material, and feedback text are excluded. No source store was changed.</div>
    ${groups||'<div class="migration-empty">No records were available to inspect.</div>'}
  </section>`;
}

async function prepareMigrationReview(button){
  if(!window.MigrationExport){toast("Migration exporter is still loading — retry in a moment");return}
  if(button){button.disabled=true;button.textContent="Inspecting…"}
  try{
    const browserSnapshot=MigrationExport.readBrowserMigrationSnapshot(localStorage,LEGACY_STORE_KEY);
    let serviceSnapshot=null,serviceIssue="not-attempted";
    if(window.DirectoryAPI){
      if(!DirectoryAPI.enabled)await DirectoryAPI.ready;
      if(!DirectoryAPI.enabled)await DirectoryAPI.probe();
      if(!DirectoryAPI.enabled)serviceIssue="unavailable";
      else{
        try{serviceSnapshot=await DirectoryAPI.migrationExport();serviceIssue=null}
        catch(error){
          // A category, never the thrown message: that text carries server
          // detail and the URL, and this report gets downloaded and shared.
          serviceSnapshot=null;
          serviceIssue=MigrationExport.classifyServiceFetchIssue(error);
        }
      }
    }
    migrationReview=MigrationExport.buildMigrationExport({browserSnapshot,serviceSnapshot,serviceIssue});
    if(serviceIssue==="unauthorised")toast("Loop service refused the export as unauthorised — recorded in the report");
    render();
    toast("Read-only migration report ready");
  }catch(error){
    toast(`Migration report failed: ${String(error.message||error)}`);
    if(button){button.disabled=false;button.textContent="Migration readiness"}
  }
}

function downloadMigrationReview(){
  if(!migrationReview){toast("Generate the migration report first");return}
  const blob=new Blob([JSON.stringify(migrationReview,null,2)],{type:"application/json"});
  const url=URL.createObjectURL(blob),a=document.createElement("a");
  const stamp=String(migrationReview.generatedAt||new Date().toISOString()).replace(/[:.]/g,"-");
  a.href=url;a.download=`agents-directory-phase2-${stamp}.json`;
  document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
  toast("Migration review downloaded — keep it out of git");
}

function renderAgentsList(){
  const directoryAgents=displayedAgents();
  const cats=["All",...new Set(directoryAgents.map(a=>a.category))];
  const stats=["All",...new Set(directoryAgents.map(a=>a.status))];
  const filtered=directoryAgents.filter(a=>{
    if(state.catFilter!=="All"&&a.category!==state.catFilter)return false;
    if(state.statusFilter!=="All"&&a.status!==state.statusFilter)return false;
    return true;
  });
  return `
    <div class="section-header"><h2>AGENTS</h2><div class="actions"><button class="btn" onclick="prepareMigrationReview(this)">Migration readiness</button>${writeActionButton("Request an Agent","openModal('request')")}${writeActionButton("+ Add agent","openModal('addAgent')","btn-primary")}</div></div>
    ${renderSubTabs()}
    ${renderWriteLockBanner()}
    ${renderMigrationReadiness()}
    ${renderHealthStrip()}
    <div id="automations" class="automations"></div>
    <p class="count-line">${filtered.length} agent${filtered.length!==1?"s":""} across the team. Click one to see its goals, skills, tools and context. Governed evaluation history is not available yet.</p>
    <div class="filters">
      ${cats.map(c=>`<button class="filter-chip ${state.catFilter===c?"active":""}" onclick="setFilter('cat','${escHtml(c)}')">${escHtml(c)}</button>`).join("")}
      <div class="filter-sep"></div>
      ${stats.map(s=>`<button class="filter-chip ${state.statusFilter===s?"active":""}" onclick="setFilter('status','${escHtml(s)}')">${escHtml(s)}</button>`).join("")}
    </div>
    <div class="card-grid">${filtered.map(a=>{
      const e=latestEval(a);const prop=pendingProposalsOf(a).length>0;
      return `
      <div class="card" onclick="openDetail('${a.id}')">
        <div class="card-top"><span class="card-id">${a.id} · v${escHtml(a.version||"1.0")}</span><span class="pill ${statusClass(a.status)}"><span class="dot"></span>${escHtml(a.status)}</span></div>
        <h3>${escHtml(a.name)}</h3><p>${escHtml(a.tagline)}</p>
        <div class="card-eval">
          <span class="pill ${evalClass(agentEvalStatus(a))} pill-xs">${e&&typeof e.score==="number"?e.score+" · ":""}${escHtml(agentEvalStatus(a))}</span>
          ${prop?'<span class="pill pill-loop pill-xs">● improvement pending</span>':""}
          ${governedBadge(a)}
        </div>
        <div class="card-footer"><span class="card-meta">${platformIcon(a.platform)} ${escHtml(a.platform)}<span class="sep">&middot;</span>${escHtml(a.category)}</span><div class="avatar">${escHtml(a.initials)}</div></div>
      </div>`;}).join("")}</div>
    ${filtered.length===0?'<div class="empty-filter">No agents match these filters.</div>':""}`;
}

function renderRequests(){
  const requestWritesLocked=!authCanWrite()||!convexWritesAvailable();
  const requestReason=!authCanWrite()?authWriteReason():"The authenticated Convex request service is unavailable.";
  const groups={"In Progress":[],"Approved":[],"Requested":[],"Shipped":[],"Declined":[]};
  requests.forEach(r=>{if(groups[r.status])groups[r.status].push(r)});
  function grp(name,items){
    if(!items.length)return"";
    return `<div class="status-group"><div class="status-group-title">${name}<span class="group-count">${items.length}</span></div><div class="request-list">${items.map(r=>`
      <div class="request-card${requestWritesLocked?" request-card-locked":""}" ${requestWritesLocked?"":`onclick="openModal('triage',requests.find(x=>x.id==='${r.id}'))"`}>
${requestWritesLocked?`<div class="locked-inline-reason">${escHtml(requestReason)}</div>`:""}
        <div class="request-left"><h3>${escHtml(r.title)}</h3><p>${escHtml(r.desc)}</p>${r.shippedAgentId?`<span class="shipped-tag">→ shipped as ${escHtml(r.shippedAgentId)}</span>`:""}</div>
        <div class="request-right">
          <span class="pill ${reqStatusClass(r.status)}"><span class="dot"></span>${escHtml(r.status)}</span>
          <span class="pill ${priorityClass(r.priority)}">${escHtml(r.priority)}</span>
          <div class="request-meta">${escHtml(r.requestedBy)}<br>${escHtml(r.date)}${r.assignee?`<br><b>${escHtml(r.assignee)}</b>`:""}</div>
        </div>
      </div>`).join("")}</div></div>`;
  }
  const active=["In Progress","Approved","Requested"].map(g=>grp(g,groups[g])).join("");
  const done=["Shipped","Declined"].filter(g=>groups[g].length).map(g=>grp(g,groups[g])).join("");
  return `
    <div class="section-header"><h2>AGENTS</h2><div class="actions"><button class="btn" onclick="prepareMigrationReview(this)">Migration readiness</button>${writeActionButton("+ New request","openModal('request')","btn-primary")}${writeActionButton("Add agent","openModal('addAgent')")}</div></div>
    ${renderSubTabs()}
    ${renderWriteLockBanner()}
    ${renderMigrationReadiness()}
    <p class="count-line">${!authCanWrite()?`Sign in to view requests. ${escHtml(requestReason)}`:requestReadState==="unavailable"?`Requests unavailable. Retry sign-in or reload before triage.`:"Agent requests from the team. Click a request to triage it. Request-to-agent conversion is deferred; register an agent separately."}</p>
    ${active}
    ${done?`<div class="resolved-divider"><div class="resolved-title">RESOLVED</div>${done}</div>`:""}`;
}

function pillarList(items,empty){return items&&items.length?items.map(i=>`<div class="item">&bull; ${escHtml(i)}</div>`).join(""):`<div class="item empty">${empty}</div>`}
function chips(items){return items&&items.length?items.map(i=>`<span class="chip">${escHtml(i)}</span>`).join(""):'<span class="chip empty">None specified</span>'}
function isGovernedPilot(a){return a&&a.governedInConvex===true}
function isReadOnlyRecord(a){return !authCanWrite()||writesLocked()||!isGovernedPilot(a)}
function governedBadge(a){return isGovernedPilot(a)?'<span class="pill pill-blue pill-xs governed-badge">Governed in Convex</span>':""}
function renderGovernedPilotNotice(a){
  if(isGovernedPilot(a))return `<div class="governed-pilot-notice"><strong>Convex governs this catalog record.</strong> Signed-in owners and approvers can edit directory fields here. Approval and manual eval logging remain locked; runs, feedback and reversible proposals continue in the loop service and are labelled separately.</div>`;
  if(writesLocked())return `<div class="governed-pilot-notice">${escHtml(writeLockReason())}</div>`;
  return "";
}
function renderDetailEditControl(a){
  if(!authCanWrite()){
    const auth=authState();
    if(auth.status==="signed-out")return `<span class="auth-action"><button class="btn btn-sm" onclick="beginDirectorySignIn()">Sign in to register, edit, or request</button><span class="locked-control-reason">${escHtml(authWriteReason())}</span></span>`;
    return lockedControl("Edit",authWriteReason(),"btn btn-sm");
  }
  if(!isGovernedPilot(a))return lockedControl("Edit","This local fixture is read-only until it is registered in Convex.","btn btn-sm");
  if(!convexWritesAvailable())return lockedControl("Edit",writeLockReason(),"btn btn-sm");
  return `<button class="btn btn-sm" onclick="openModal('editAgent',governedPilotById.get('${a.id}'))">Edit</button>`;
}
function renderEvalTitleActions(a){
  if(isReadOnlyRecord(a))return `<span class="eval-title-actions"><button class="btn-ghost btn-sm" onclick="proposeImprovement('${a.id}')">Propose improvement</button>${lockedControl("Log eval",EVAL_LOCK_REASON,"btn-ghost btn-sm",{showReason:false})}</span>`;
  return `<span class="eval-title-actions"><button class="btn-ghost btn-sm" onclick="proposeImprovement('${a.id}')">Propose improvement</button><button class="btn-ghost btn-sm" onclick="openModal('eval',agents.find(x=>x.id==='${a.id}'))">Log eval</button></span>`;
}
function renderEmptyEval(a){
  // Locked pilot: no second/third copy of the eval-lock sentence — badge + Why? hold it.
  if(isReadOnlyRecord(a))return"";
  return `<div class="empty-eval"><p>This agent hasn't been evaluated yet.</p><div class="cta" onclick="openModal('eval',agents.find(x=>x.id==='${a.id}'))">Log the first evaluation &rarr;</div></div>`;
}
function renderGovernedIdentity(a){
  if(!(isGovernedPilot(a)&&a.convexGovernance))return"";
  const g=a.convexGovernance,artifact=g.artifact,sourcePin=g.sourcePin;
  const catalogVersion=isArtifactVersionId(a.version)?"not recorded as semver":(a.version||"not recorded");
  const artifactId=isArtifactVersionId(a.version)?a.version:null;
  return `<div class="section governed-identity">
    <div class="section-title">Governed identity</div>
    <div class="section-body">
      <div><strong>Catalog version:</strong> ${escHtml(catalogVersion)}${g.versionState?` · ${escHtml(g.versionState)}`:""}</div>
      ${artifactId?`<div><strong>Artifact:</strong> <code>${escHtml(artifactId)}</code></div>`:""}
      <div><strong>Runner:</strong> ${escHtml(g.runner||"not recorded")}</div>
      <div><strong>Invocation:</strong> ${escHtml(g.invocationType||"not recorded")}</div>
      <div><strong>Usability:</strong> ${g.usabilityModes&&g.usabilityModes.length?escHtml(g.usabilityModes.join(", ")):"not recorded"}</div>
      ${artifact?`<div><strong>Artifact SHA-256:</strong> <code class="digest-full">${escHtml(artifact.digest)}</code></div><div><strong>Artifact locator:</strong> ${escHtml(artifact.locator)}</div>`:""}
      ${sourcePin?`<div><strong>Git commit source pin:</strong> <code class="digest-full">${escHtml(sourcePin.commitSha)}</code></div><div class="governed-caveat">Source pin only — not an artifact-content digest.</div>`:""}
    </div>
  </div>`;
}

function renderProposalAttempt(a){
  const attempt=a&&a.latestProposalAttempt;
  if(!attempt)return"";
  if(attempt.outcome==="maker-refused-no-evidence")return `<div class="proposal-attempt proposal-attempt-refused"><strong>Maker produced no proposal.</strong> It refused because no eligible defect evidence was available (${escHtml(String(attempt.failingTraces||0))} failing trace(s), ${escHtml(String(attempt.feedbackWithNotes||0))} feedback note(s)).</div>`;
  if(attempt.outcome==="maker-refused")return `<div class="proposal-attempt proposal-attempt-refused"><strong>Maker produced no proposal.</strong> ${escHtml(attempt.reason||"The optimizer refused to invent a change.")}</div>`;
  if(attempt.outcome==="verifier-rejected")return `<div class="proposal-attempt proposal-attempt-rejected"><strong>Verifier rejected a proposal.</strong> The retained proposal below includes its checker verdict and can be reopened for human review.</div>`;
  if(attempt.outcome==="reopened-for-human-review")return `<div class="proposal-attempt"><strong>Proposal reopened for human review.</strong> The verifier's earlier rejection remains on the proposal as context.</div>`;
  if(attempt.outcome==="human-approved-change-ready-to-commit")return `<div class="proposal-attempt"><strong>Review approved; change ready for a human commit.</strong> No artifact or runtime behaviour changed automatically.</div>`;
  if(attempt.outcome==="human-approved-pull-request-opened")return `<div class="proposal-attempt"><strong>Review approved; pull request opened.</strong> No catalog version was bumped automatically.</div>`;
  if(attempt.outcome==="proposals-created")return"";
  return"";
}
function copyProposalPatch(agentId,proposalId){
  const agent=governedPilotById.get(agentId)||agents.find(candidate=>candidate.id===agentId);
  const proposal=proposalsOf(agent).find(candidate=>candidate&&candidate.id===proposalId);
  if(!proposal||!proposal.patch){toast("No approved patch is available to copy.");return}
  copyText(proposal.patch,"Approved change patch copied — review it before committing")
}
function renderPromotionGate(p){
  const gate=p&&p.promotionGate;
  if(!gate||gate.eligible)return"";
  const failures=Array.isArray(gate.failures)?gate.failures:[];
  if(!failures.length)return`<div class="loop-promotion-gate"><strong>Promotion evidence gate:</strong> not eligible.</div>`;
  return`<div class="loop-promotion-gate"><strong>Promotion evidence gate — not eligible.</strong> Proposal stays proposed until these pass:<ul>${failures.map(f=>`<li><code>${escHtml(f.code||"")}</code> — ${escHtml(f.message||"")}</li>`).join("")}</ul></div>`;
}
function renderProposalCard(a,p,index,total){
  const approveLabel="Record review approval";
  const hasChange=Array.isArray(p.changes)&&p.changes.length===1;
  const autoRejected=p.status==="rejected"&&p.autoRejection&&p.autoRejection.by==="verifier";
  const approved=p.status==="approved";
  const label=approved?"REVIEW APPROVED · READY FOR HUMAN COMMIT":autoRejected?"AUTO-REJECTED BY VERIFIER":"IMPROVEMENT PROPOSED";
  const canApprove=authCanWrite()&&window.DirectoryAPI&&DirectoryAPI.enabled;
  return `<div class="loop-card${autoRejected?" loop-card-auto-rejected":""}${approved?" loop-card-approved":""}">
    <div class="loop-head"><span class="loop-badge">● ${label}${total>1?` · ${index+1} of ${total}`:""}</span><span class="loop-src">${escHtml(p.source)} · ${formatDate(approved?p.approvedAt:p.date)}</span></div>
    ${isGovernedPilot(a)?`<div class="railway-proposal-source"><strong>Loop-service proposal · Railway file store · pilot-only.</strong> This reversible proposal is read from Railway evidence and is not governed Convex catalog state.</div>`:""}
    <div class="loop-summary">${escHtml(p.summary)}</div>
    <div class="loop-detail">${escHtml(p.detail)}</div>
    ${renderProposalChanges(p.changes)}
    ${p.verdict?`<div class="loop-verdict"><span class="pill pill-xs ${p.verdict.verdict==="ship"?"pill-green":p.verdict.verdict==="reject"?"pill-amber":"pill-blue"}">checker: ${escHtml(p.verdict.verdict)} · ${p.verdict.confidence}</span>${(p.verdict.reasons||[]).length?`<span class="loop-verdict-why">${escHtml(p.verdict.reasons[0])}</span>`:""}</div>`:""}
    ${p.targetArtifactVersion?`<div class="loop-target">Derived against artifact <strong>${escHtml(p.targetArtifactVersion)}</strong>${p.targetArtifactDigest?` · <code>${escHtml(String(p.targetArtifactDigest).slice(0,7))}</code>`:""}.</div>`:""}
    ${renderPromotionGate(p)}
    ${approved?`<div class="loop-approval-notice"><strong>Approved is not applied.</strong> ${p.approvedBy?`Recorded by ${escHtml(p.approvedBy.name||p.approvedBy.subject)} on ${formatDate(p.approvedAt)}. `:""}A human must review, commit and release the artifact change.</div>`:`<div class="loop-approval-notice"><strong>Approval records a review decision only.</strong> It does not change the Railway catalog version, prompt, check, runtime, or governed Convex version. A human must make, verify and commit the artifact edit separately. Live comparable evidence (guardrails pass, non-negative grounding delta) is required in addition to this review.</div>`}
    <div class="loop-actions">${approved?`<button class="btn btn-sm btn-primary" onclick="copyProposalPatch('${a.id}','${escHtml(p.id||"")}')" ${p.patch?"":"disabled"}>Copy approved patch</button>`:autoRejected?`<button class="btn btn-sm" onclick="reopenVerifierRejectedImprovement('${a.id}','${escHtml(p.id||"")}')">Re-open for human review</button>`:`${canApprove?`<button class="btn btn-primary btn-sm" onclick="approveImprovement('${a.id}','${escHtml(p.id||"")}')" ${hasChange?"":"disabled"}>${escHtml(approveLabel)}</button>`:lockedControl(approveLabel,APPROVAL_LOCK_REASON,"btn btn-primary btn-sm")}<button class="btn btn-sm" onclick="rejectImprovement('${a.id}','${escHtml(p.id||"")}')">Reject proposal</button>`}</div>
  </div>`;
}

function renderDetail(a){
  const sopLines=(a.sop||"").split("\n").filter(Boolean);
  const e=latestEval(a);
  const prop=pendingProposalsOf(a),autoRejected=autoRejectedProposalsOf(a),approved=approvedProposalsOf(a);
  return `<div class="detail">
    <button class="back-btn" onclick="goBack()"><span>&lsaquo;</span> Back to Directory</button>
    <div class="detail-header">
      <div class="detail-eyebrow">${detailEyebrow(a)}</div>
      ${renderDetailEditControl(a)}
    </div>
    ${renderGovernedPilotNotice(a)}
    <h1>${escHtml(a.name)}</h1>
    <p class="tagline">${escHtml(a.tagline)}</p>
    <div class="pills">
      <span class="pill ${statusClass(a.status)}"><span class="dot"></span>${escHtml(a.status)}</span>
      <span class="pill pill-neutral">${escHtml(a.category)}</span>
      <span class="pill pill-neutral">${platformIcon(a.platform)} ${escHtml(a.platform)}</span>
      <span class="pill pill-neutral pill-owner"><span class="mini-avatar">${escHtml(a.initials)}</span>${escHtml(a.owner)}</span>
      ${governedBadge(a)}
    </div>

    <div class="use-panel">
      <div class="use-head">Use this agent<span class="use-tier">${invocationTier(a)}</span></div>
      <div class="use-actions">
        ${a.accessUrl?`<a class="btn btn-sm" href="${escHtml(a.accessUrl)}" target="_blank" rel="noopener">Open in ${escHtml(a.platform)} &#8599;</a>`:""}
        ${canInstall(a)?`<button class="btn btn-sm" onclick="copyAgentPrompt('${a.id}')" title="A plain-text summary of this directory record. Not the agent.">Copy summary</button>`:""}
        ${hasExportMode(a)?`<span id="install-actions"></span><span id="handoff-actions"></span>`:""}
        <span id="run-action"></span>
      </div>
      <div class="use-hint">${hasUsabilityDefect(a)?`MISCONFIGURED: this agent has no stored usabilityModes. Edit the record before offering access.`:isGapFillRuntime(a)?`Run, Copy as SKILL.md, evaluation, and Download use the same pinned gap-fill artifact. Paste material; Call 1 returns structured gaps; Call 2 drafts. No Chrome, Drive, or HTML file write.`:isSingleShotRuntime(a)?`Run, Copy as SKILL.md, evaluation, and Download use the same pinned single-shot artifact. This is not the full /biocraft agent: no Chrome, Drive, HTML rendering, or follow-up conversation.`:canHandoff(a)&&!canInstall(a)?`Prepared handoff: this agent is not installed or hosted here. The export is an engagement brief that pins the repository and commit where the agent actually lives, plus the setup checklist, prohibited actions, inputs, and how to return a result.`:needsInvokerConfiguration(a)?`${escHtml((a.invocation&&a.invocation.type)||"runtime")} execution is not configured. Use the stored prepared handoff/export path until an adapter is connected.`:`Available here: ${escHtml(a.usabilityModes.join(", "))}. The execution adapter remains ${escHtml((a.invocation&&a.invocation.type)||"link")}.`}</div>
      <div id="run-panel" class="run-panel"></div>
    </div>

    ${renderProposalAttempt(a)}
    ${prop.length?`${prop.length>1?`<div class="loop-set-note">${prop.length} separate proposals, one per defect. Each is approved or rejected on its own; deciding one leaves the others pending.</div>`:""}${prop.map((p,i)=>renderProposalCard(a,p,i,prop.length)).join("")}`:""}
    ${autoRejected.length?`<div class="loop-set-note">Verifier-rejected proposals are retained below. They are checker opinions, not human decisions.</div>${autoRejected.map((p,i)=>renderProposalCard(a,p,i,autoRejected.length)).join("")}`:""}
    ${approved.length?`<div class="loop-set-note">Approved review decisions are retained below. They are ready for a human commit and have not changed agent behaviour.</div>${approved.map((p,i)=>renderProposalCard(a,p,i,approved.length)).join("")}`:""}

    <div class="pillar-block pillar-goals">
      <div class="pillar-tag">① GOALS<span class="autonomy-pill" title="Action scope only — proposals always require human approval">${escHtml(a.autonomyLevel||"L1")} · ${autonomyLabel(a.autonomyLevel||"L1")}</span>${a.costPerOutcome&&a.costPerOutcome.target?`<span class="cost-pill">target ${"$"+a.costPerOutcome.target}/outcome</span>`:""}</div>
      <div class="section-body objective">${escHtml(a.objective||"No objective set.")}</div>
      <div class="io-grid">
        <div class="io-box"><h4>SUCCESS CRITERIA</h4>${pillarList(a.successCriteria,"None specified")}</div>
        <div class="io-box"><h4>GUARDRAILS</h4>${pillarList(a.guardrails,"None specified")}</div>
      </div>
      ${(a.goldenCases&&a.goldenCases.length)?`<div class="golden"><h4>GOLDEN CASES <span class="golden-sub">the scorable eval set — ${a.goldenCases.length}/20</span></h4>${a.goldenCases.map(g=>`<div class="golden-row"><div class="golden-io"><b>${escHtml(g.input)}</b> → ${escHtml(g.expected)}</div><div class="golden-rule">pass: ${escHtml(g.rule)}${g.source?` · <span class="golden-src">${escHtml(g.source)}</span>`:""}</div></div>`).join("")}</div>`:""}
      ${(a.failureClasses&&a.failureClasses.length)?`<div class="failclasses"><h4>FAILURE CLASSES</h4>${a.failureClasses.map(f=>`<div class="fail-row"><span class="fail-name">${escHtml(f.class)}</span><span class="fail-rate">${escHtml(f.acceptableRate)}</span><span class="fail-guard">${escHtml(f.guardrail)}</span></div>`).join("")}</div>`:""}
    </div>

    <div class="section"><div class="section-title">When to use</div><div class="section-body">${escHtml(a.when)}</div></div>
    <div class="section"><div class="section-title">SOP &mdash; How to use this agent</div><div class="section-body">${sopLines.map(s=>`<div class="step">${escHtml(s)}</div>`).join("")}</div></div>
    <div class="io-grid">
      <div class="io-box"><h4>INPUTS</h4>${pillarList(a.inputs,"None specified")}</div>
      <div class="io-box"><h4>OUTPUTS</h4>${pillarList(a.outputs,"None specified")}</div>
    </div>

    <div class="pillar-block pillar-scc">
      <div class="io-grid io-grid-3">
        <div class="io-box"><h4>② SKILLS</h4><div class="chip-row">${chips(a.skills)}</div></div>
        <div class="io-box"><h4>③ TOOLS</h4><div class="chip-row">${chips(a.tools)}</div></div>
        <div class="io-box"><h4>④ CONTEXT</h4><div class="chip-row">${chips(a.context)}</div></div>
      </div>
      ${(window.DirectoryAPI&&DirectoryAPI.enabled)?`<div class="ctx-recall">
        <div class="ctx-recall-head">Memory recall<span class="ctx-provider">${DirectoryAPI.info&&DirectoryAPI.info.memory?escHtml(DirectoryAPI.info.memory.provider):"live"}</span></div>
        <div class="ctx-recall-row"><input id="ctx-q" class="ctx-input" placeholder="Ask what this agent knows…" onkeydown="if(event.key==='Enter')recallContext('${a.id}')"><button class="btn btn-sm" onclick="recallContext('${a.id}')">Recall</button></div>
        <div id="ctx-results" class="ctx-results"></div>
      </div>`:""}
    </div>

    ${renderGovernedIdentity(a)}

    ${a.accessUrl||a.repoUrl?`<div class="section"><div class="section-title">Technical Details</div><div class="section-body">
      ${a.accessUrl?`<div class="detail-access-line"><strong>Access:</strong> <a href="${escHtml(a.accessUrl)}">${escHtml(a.accessUrl)}</a></div>`:""}
      ${a.repoUrl?`<div><strong>Repo:</strong> <a href="${escHtml(a.repoUrl)}">${escHtml(a.repoUrl)}</a></div>`:""}
    </div></div>`:""}

    <div class="section">
      <div class="section-title eval-title">Eval &amp; Observability${renderEvalTitleActions(a)}</div>
      <div class="eval-pill-row"><span class="pill ${evalClass(agentEvalStatus(a))}">${escHtml(evalStatusBadgeLabel(a))}</span>${renderEvalLockWhy(a)}${e?`<span class="date">Last reviewed: ${formatDate(e.date)}${e.by?" · "+escHtml(e.by):""}</span>`:""}</div>
      ${a.evalHistory&&a.evalHistory.length?`<div class="eval-history">${a.evalHistory.slice().reverse().map(h=>`
        <div class="eval-row">
          <div class="eval-row-top"><span class="pill ${evalClass(h.status)} pill-xs">${escHtml(h.status)}</span>${typeof h.score==="number"?`<span class="eval-score">${h.score}</span>`:""}<span class="eval-date">${formatDate(h.date)}${h.by?" · "+escHtml(h.by):""}</span>${h.traceUrl?`<a class="eval-trace" href="${escHtml(h.traceUrl)}">trace ↗</a>`:""}</div>
          ${h.notes?`<div class="eval-note">${escHtml(h.notes)}</div>`:""}
          ${h.knownIssues?`<div class="eval-issue"><b>Known issues:</b> ${escHtml(h.knownIssues)}</div>`:""}
        </div>`).join("")}</div>`:renderEmptyEval(a)}
      ${window.DirectoryAPI&&DirectoryAPI.enabled?renderTraceSurface(a):""}
      ${a.id==="A7"&&window.DirectoryAPI&&DirectoryAPI.enabled?renderMechanicalComparePanel(a):""}
    </div>

    ${a.changelog&&a.changelog.length?`<div class="section"><div class="section-title">Version history</div><div class="section-body">${a.changelog.slice().reverse().map(c=>`<div class="change-row"><span class="change-ver">v${escHtml(c.version)}</span><span class="change-date">${formatDate(c.date)}</span><span class="change-note">${escHtml(c.note)}</span></div>`).join("")}</div></div>`:""}

    <button class="contact-btn">&#x1F4AC; Message ${escHtml(a.owner)} on Slack</button>
  </div>`;
}

function maintainerRouteActive(){
  return typeof location!=="undefined"&&String(location.hash||"")==="#maintainer";
}

function render(){
  renderAuthSurface();
  const app=document.getElementById("app");
  // Separate route. The run panel is never rendered here, so a maintainer
  // action cannot also produce a witnessed-run evidence row.
  if(maintainerRouteActive()){app.innerHTML=maintainerPanelHtml();return}
  if(catalogPending()){
    app.innerHTML=`<div class="directory-state directory-state-loading"><h2>Loading governed directory…</h2><p>Waiting for Convex.</p></div>`;
    return;
  }
  if(catalogSource==="unavailable"){
    app.innerHTML=`<div class="directory-state directory-state-error"><h2>Directory unavailable</h2><p>${escHtml(catalogFailureReason)}</p><button class="btn btn-primary" onclick="retryGovernedDirectory()">Retry</button></div>`;
    return;
  }
  if(state.view==="detail"&&state.agent){
    const fresh=displayedAgents().find(x=>x.id===state.agent.id);
    if(!fresh){state.view="list";state.agent=null}
    else{state.agent=fresh;app.innerHTML=renderDetail(state.agent);loadRunCapability(state.agent.id);return}
  }
  app.innerHTML=state.subTab==="agents"?renderAgentsList():renderRequests();
  if(state.subTab==="agents"&&window.DirectoryAPI&&DirectoryAPI.enabled)loadAutomations();
}

// ── Automations panel (server-side loop; shown only when the service is up) ──
function cycleOutcomes(last){
  if(!last)return{attempted:0,proposed:0,refused:0,verifierRejected:0};
  if(last.outcomes)return last.outcomes;
  // Older loopRuns lacked outcomes — derive from jobs without inventing "improved".
  const jobs=Array.isArray(last.jobs)?last.jobs:[];
  let attempted=0,proposed=0,refused=0,verifierRejected=0;
  for(const job of jobs){
    if(!job||job.action==="skipped:budget")continue;
    attempted+=1;
    if(String(job.action||"").startsWith("refused:")){refused+=1;continue}
    proposed+=Number(job.proposals)||0;
    verifierRejected+=Number(job.rejected)||0;
  }
  if(!jobs.length&&typeof last.selected==="number")attempted=last.selected;
  return{attempted,proposed,refused,verifierRejected};
}
function formatCycleSub(last){
  if(!last)return"heartbeat idle — run a cycle to discover + improve";
  const o=cycleOutcomes(last);
  const jobs=last.budget&&typeof last.budget.jobs==="number"?last.budget.jobs:o.attempted;
  const maxJobs=last.budget&&typeof last.budget.maxJobs==="number"?last.budget.maxJobs:null;
  const jobPart=maxJobs!=null?` · ${jobs} of ${maxJobs} jobs`:` · ${jobs} job${jobs===1?"":"s"}`;
  const q=last.queue;
  const queuePart=q?` · queue ${q.open||0} open / ${q.blocked||0} blocked`:"";
  return`last cycle ${formatDate(last.ts)} · scanned ${last.scanned} · attempted ${o.attempted} · proposed ${o.proposed} · refused ${o.refused}${jobPart}${queuePart}`;
}
function formatQueueItem(x,sClass){
  const reason=x.note?`<div class="auto-refuse">${escHtml(x.note)}</div>`:"";
  return`<div class="auto-item auto-item-stack"><div class="auto-item-row"><span class="rq-score" title="score 1–3">${x.score}</span><span class="auto-agent">${escHtml(x.agentId)}</span><span class="auto-summary">${escHtml(x.title)}</span><span class="pill pill-xs ${sClass(x.status)}">${escHtml(x.status)}</span></div>${reason}</div>`;
}
async function loadAutomations(){
  const el=document.getElementById("automations");
  if(!el||!(window.DirectoryAPI&&DirectoryAPI.enabled))return;
  try{
    const [inbox,runs,learn,queue]=await Promise.all([DirectoryAPI.loopInbox(),DirectoryAPI.loopRuns(1),DirectoryAPI.loopLearnings(4),DirectoryAPI.loopQueue()]);
    const last=runs.runs&&runs.runs[0];
    const items=inbox.inbox||[];
    const learnings=(learn&&learn.learnings)||[];
    const q=(queue&&queue.queue)||[];
    // Blocked refusals are the useful output of a starved cycle — show them.
    const shownq=q.filter(x=>x.status==="open"||x.status==="in-progress"||x.status==="blocked").slice(0,8);
    const vClass=v=>v==="ship"?"pill-green":v==="reject"?"pill-amber":"pill-blue";
    const sClass=s=>s==="open"?"pill-blue":s==="in-progress"?"pill-purple":s==="blocked"?"pill-amber":"pill-green";
    el.innerHTML=`
      <div class="auto-head">
        <div><span class="auto-title">◷ Automations</span><span class="auto-sub">${formatCycleSub(last)}</span></div>
        <button class="btn btn-sm btn-primary" onclick="runLoopNow(this)">Run automations now</button>
      </div>
      <div class="auto-live-note">${escHtml(AUTOMATION_LIVE_NOTE)}</div>
      ${shownq.length?`<div class="auto-queue"><div class="auto-inbox-title">Research queue <span class="auto-sub2">discover → improve</span><span class="count-badge">${q.filter(x=>x.status==="open").length} open · ${q.filter(x=>x.status==="blocked").length} blocked</span></div>${shownq.map(x=>formatQueueItem(x,sClass)).join("")}</div>`:""}
      <div class="auto-inbox">
        <div class="auto-inbox-title">Triage inbox<span class="count-badge">${items.length}</span></div>
        ${items.length?items.map(x=>`<div class="auto-item"><span class="auto-agent">${escHtml(x.agentId)}</span><span class="auto-summary">${escHtml(x.proposal.summary)}</span>${x.proposal.verdict?`<span class="pill pill-xs ${vClass(x.proposal.verdict.verdict)}">checker: ${escHtml(x.proposal.verdict.verdict)} ${x.proposal.verdict.confidence}</span>`:""}</div>`).join(""):'<div class="auto-empty">Inbox clear — nothing awaiting triage.</div>'}
      </div>
      ${learnings.length?`<div class="auto-learnings"><div class="auto-inbox-title">Learnings<span class="count-badge">${learnings.length}</span></div>${learnings.map(l=>`<div class="auto-item"><span class="auto-agent">${escHtml(l.agentId||l.loop)}</span><span class="auto-summary">${escHtml(l.learning)}</span></div>`).join("")}</div>`:""}`;
  }catch(e){el.innerHTML=""}
}
async function runLoopNow(btn){
  // Allowed under the catalog lock (b′): runCycle stamps proposedImprovements,
  // research-queue rows, learnings and loopRuns on Railway only. It never calls
  // approveImprovement, so it cannot bump a catalog version. Auto-apply is dead.
  // A separately configured Railway scheduler is outside this UI guard.
  if(btn){btn.disabled=true;btn.textContent="Running…"}
  try{
    const r=await DirectoryAPI.runLoop();
    const o=r.outcomes||cycleOutcomes(r);
    const jobs=r.budget&&typeof r.budget.jobs==="number"?r.budget.jobs:o.attempted;
    const maxJobs=r.budget&&typeof r.budget.maxJobs==="number"?r.budget.maxJobs:"?";
    toast(`Cycle: scanned ${r.scanned}, attempted ${o.attempted}, proposed ${o.proposed}, refused ${o.refused}, ${jobs} of ${maxJobs} jobs`);
  }
  catch(e){toast("Loop service unreachable")}
  if(btn){btn.disabled=false;btn.textContent="Run automations now"}
  await loadRailwayProposalOverlay();
  loadAutomations();
}

// ── Using an agent across platforms (invocation) ──
function hasUsabilityDefect(a){return!Array.isArray(a.usabilityModes)||a.usabilityModes.length===0}
function hasUsabilityMode(a,mode){return!hasUsabilityDefect(a)&&a.usabilityModes.includes(mode)}
// The two export modes are deliberately NOT one gate. Collapsing them is what
// handed prepared-handoff agents an install-shaped export: a skill file
// reassembled from directory metadata, whose own procedure told you to go open
// the real agent. Each mode resolves its own server-owned artifact.
//   download-install → pinned SKILL.md + ZIP   (installable package)
//   prepared-handoff → pinned Briefing         (pointer + engagement terms)
function canInstall(a){return hasUsabilityMode(a,"download-install")}
function canHandoff(a){return hasUsabilityMode(a,"prepared-handoff")}
function hasExportMode(a){return canInstall(a)||canHandoff(a)}
function needsInvokerConfiguration(a){return(a.invocation&&a.invocation.type)==="mcp"}
function isSingleShotRuntime(a){return a.invocation&&a.invocation.type==="runtime"&&a.invocation.mode==="single-shot"}
function isGapFillRuntime(a){return a.invocation&&a.invocation.type==="runtime"&&a.invocation.mode==="gap-fill"}
function runtimeModeLabel(mode){
  if(mode==="gap-fill")return"gap-fill";
  if(mode==="single-shot")return"single-shot";
  return mode||"runtime";
}
function invocationTier(a){return hasUsabilityDefect(a)?"misconfigured":a.usabilityModes.join(" + ")}
function slug(s){return String(s).toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")}

// Capability (including the server-owned input contract) for the open detail
// view. The run form is built from this, never from the editable inputs[]
// labels on the record — renaming a label must not break the run.
const runCapabilities={};
function governedRuntimeRefused(capability){
  return Boolean(capability&&capability.governedRuntime&&capability.governedRuntime.matched===false);
}
function governedRuntimeReason(capability){
  return (capability&&capability.governedRuntime&&capability.governedRuntime.reason)||"GOVERNED_RUNTIME_MISMATCH";
}
async function loadRunCapability(id){
  const a=agents.find(x=>x.id===id),slot=document.getElementById("run-action"),installSlot=document.getElementById("install-actions"),handoffSlot=document.getElementById("handoff-actions");
  if(!a)return;
  if(window.DirectoryAPI){
    // Capability (brief, install, run) is server-owned. Wait for the in-flight
    // health probe, then retry once before declaring the server absent —
    // otherwise a detail view opened before probe resolution permanently shows
    // "unavailable" even when the loop is up.
    if(!DirectoryAPI.enabled)await DirectoryAPI.ready;
    if(!DirectoryAPI.enabled)await DirectoryAPI.probe();
  }
  if(!(window.DirectoryAPI&&DirectoryAPI.enabled)){
    showCapabilityFailure(a,{slot,installSlot,handoffSlot},"this page is running without a directory server, and every one of these artifacts is server-owned.");
    return;
  }
  try{
    const capability=await DirectoryAPI.invocationCapability(id);
    if(governedRuntimeRefused(capability)){
      delete runCapabilities[id];
      showCapabilityFailure(a,{slot,installSlot,handoffSlot},governedRuntimeReason(capability));
      return;
    }
    runCapabilities[id]=capability;
    if(slot&&hasUsabilityMode(a,"hosted-run")){
      if(capability.serverRun&&capability.artifactAvailable&&capability.configured&&capability.runnable)slot.innerHTML=`<button class="btn btn-sm btn-primary" onclick="toggleRun('${id}')">&#9654; ${capability.mode==="single-shot"?"Run single-shot draft":capability.mode==="gap-fill"?"Run gap-fill draft":"Run here"}</button>`;
      else if(!capability.configured)slot.innerHTML=`<span class="run-unavailable">${escHtml(capability.unavailableReason||"Runtime unavailable")}</span>`;
    }
    // download-install: only a pinned server-owned artifact is installable.
    // With none registered there is no client-side substitute to fall back to.
    if(installSlot&&canInstall(a)){
      const install=capability.installArtifact;
      const modeWord=runtimeModeLabel(capability.mode||install&&install.mode);
      if(install&&install.available)installSlot.innerHTML=`<button class="btn btn-sm" onclick="copyInstallSkill('${id}')">Copy ${escHtml(modeWord)} SKILL.md</button><button class="btn btn-sm" onclick="downloadInstallArtifact('${id}')">Download ${escHtml(modeWord)} (.zip)</button><span class="artifact-pin"><strong>${escHtml(install.artifactVersion)}</strong> · ${digestChip(install.artifactDigest,{algo:install.artifactDigestAlgorithm||"sha256"})}</span>`;
      else installSlot.innerHTML=`<span class="run-unavailable">No pinned installable artifact is registered for this agent, so there is nothing to install. The summary above is a description of the record, not the agent.</span>`;
    }
    // prepared-handoff: a briefing, never a generated skill file.
    if(handoffSlot&&canHandoff(a)){
      const handoff=capability.handoff;
      if(handoff&&handoff.available)handoffSlot.innerHTML=`<button class="btn btn-sm" onclick="copyHandoffBriefing('${id}')">Copy engagement brief</button><span class="artifact-pin">The agent lives at <a href="${escHtml(handoff.repoUrl)}" target="_blank" rel="noopener">${escHtml(handoff.repoUrl)}</a> · <strong>${escHtml(handoff.briefVersion)}</strong> · commit ${commitChip(handoff.commitSha)}</span>`;
      else handoffSlot.innerHTML=`<span class="run-unavailable">${escHtml((handoff&&handoff.reason)||"No pinned handoff package is registered for this agent.")}</span>`;
    }
  }catch(e){
    // An empty slot where a request failed is indistinguishable from an agent
    // that legitimately offers nothing, which forces a hand audit of the API to
    // find out which happened. Render the reason the server actually gave.
    delete runCapabilities[id];
    const detail=e&&e.status===404?`${id} is not registered on the server.`:String((e&&e.message)||e);
    showCapabilityFailure(a,{slot,installSlot,handoffSlot},detail);
  }
}
// Same slots, same wording, whether the request failed or was never attempted.
function showCapabilityFailure(a,slots,detail){
  const note=(label)=>`<span class="run-unavailable">${label} unavailable — ${escHtml(detail)}</span>`;
  if(slots.slot&&hasUsabilityMode(a,"hosted-run"))slots.slot.innerHTML=note("Run");
  if(slots.installSlot&&canInstall(a))slots.installSlot.innerHTML=note("Install artifact");
  if(slots.handoffSlot&&canHandoff(a))slots.handoffSlot.innerHTML=note("Engagement brief");
}

// The agent definition (four pillars) → a portable system prompt. This is what
// makes an agent usable across platforms: paste it into Claude, Cursor, ChatGPT.
function buildAgentPrompt(a){
  const L=[];
  L.push(`You are ${a.name}. ${a.objective||a.tagline}`);
  if(a.when)L.push(`\n## When to use\n${a.when}`);
  if((a.successCriteria||[]).length)L.push(`\n## Success criteria (what good looks like)\n${a.successCriteria.map(s=>"- "+s).join("\n")}`);
  if((a.guardrails||[]).length)L.push(`\n## Guardrails (must not)\n${a.guardrails.map(s=>"- "+s).join("\n")}`);
  if((a.skills||[]).length)L.push(`\n## Skills to apply\n${a.skills.map(s=>"- "+s).join("\n")}`);
  if((a.tools||[]).length)L.push(`\n## Tools you may use\n${a.tools.map(s=>"- "+s).join("\n")}`);
  if((a.context||[]).length)L.push(`\n## Context to draw on\n${a.context.map(s=>"- "+s).join("\n")}`);
  if(a.sop)L.push(`\n## Procedure\n${a.sop}`);
  if((a.inputs||[]).length)L.push(`\n## Inputs\n${a.inputs.map(s=>"- "+s).join("\n")}`);
  if((a.outputs||[]).length)L.push(`\n## Outputs\n${a.outputs.map(s=>"- "+s).join("\n")}`);
  return L.join("\n");
}
// There is deliberately no client-side "Copy as SKILL.md". It wrapped the
// summary above in yaml frontmatter and called the result the agent, which
// made two buttons out of one output and shipped a skill file whose own
// procedure said to go open the real agent. Installable and handoff artifacts
// are both server-owned and pinned; see copyInstallSkill / copyHandoffBriefing.
function copyText(text,msg){(navigator.clipboard&&navigator.clipboard.writeText?navigator.clipboard.writeText(text):Promise.reject()).then(()=>toast(msg)).catch(()=>{const ta=document.createElement("textarea");ta.value=text;document.body.appendChild(ta);ta.select();try{document.execCommand("copy");toast(msg)}catch(e){toast("Copy failed")}ta.remove()})}
function copyAgentPrompt(id){const a=agents.find(x=>x.id===id);if(a)copyText(buildAgentPrompt(a),"Summary copied — a description of this record, not the agent")}
async function copyHandoffBriefing(id){
  if(governedRuntimeRefused(runCapabilities[id])){toast(governedRuntimeReason(runCapabilities[id]));return}
  try{
    const brief=await DirectoryAPI.handoffBriefing(id);
    copyText(brief.content,`Engagement brief copied · ${brief.briefVersion} · commit ${String(brief.commitSha).slice(0,7)}`);
  }catch(e){toast(`Briefing unavailable: ${String(e.message||e)}`)}
}
async function copyInstallSkill(id){
  if(governedRuntimeRefused(runCapabilities[id])){toast(governedRuntimeReason(runCapabilities[id]));return}
  try{
    const artifact=await DirectoryAPI.installSkill(id);
    const modeWord=runtimeModeLabel(runCapabilities[id]?.mode||artifact.mode);
    copyText(artifact.content,`${modeWord} SKILL.md copied · ${artifact.artifactVersion}`);
  }catch(e){toast(`Install export failed: ${String(e.message||e)}`)}
}
async function downloadInstallArtifact(id){
  if(governedRuntimeRefused(runCapabilities[id])){toast(governedRuntimeReason(runCapabilities[id]));return}
  try{
    const artifact=await DirectoryAPI.downloadInstallArtifact(id);
    const url=URL.createObjectURL(artifact.blob),a=document.createElement("a");
    a.href=url;a.download=artifact.filename;document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
    toast(`Downloaded ${artifact.filename}`);
  }catch(e){toast(`Download failed: ${String(e.message||e)}`)}
}

function contractField(f,i){
  const req=f.required?`<span class="run-req">required</span>`:`<span class="run-opt">optional</span>`;
  const help=f.help?`<div class="run-help">${escHtml(f.help)}</div>`:"";
  const control=f.multiline?`<textarea id="run-in-${i}" data-k="${escHtml(f.key)}"></textarea>`:`<input id="run-in-${i}" data-k="${escHtml(f.key)}">`;
  return `<div class="run-field${f.multiline?" run-field-wide":""}"><label for="run-in-${i}">${escHtml(f.label)} ${req}</label>${help}${control}</div>`;
}
let gapFillState=null;
function runModeLabel(mode){
  if(mode==="gap-fill")return"gap-fill runtime";
  if(mode==="single-shot")return"single-shot runtime";
  return mode||"runtime";
}
function renderRunResult(id,r){
  const box=document.getElementById("run-out");if(!box)return;
  const cap=runCapabilities[id]||{};
  const notesBox=cap.feedbackNotes===false?"":`<label class="run-feedback-notes-label" for="run-feedback-notes">Why this rating — what was wrong or right</label><textarea id="run-feedback-notes" class="run-feedback-notes" maxlength="${Number(cap.feedbackNotesMaxChars)||2000}" placeholder="Specific defects, fabrications, or things it got right."></textarea>`;
  const feedback=r.tracePersisted&&r.traceId?`<div class="run-feedback" data-trace-id="${escHtml(r.traceId)}"><div class="run-feedback-title">Rate this run</div><div class="run-feedback-stars" role="radiogroup" aria-label="Rate this run">${[1,2,3,4,5].map(n=>`<label title="${n} star${n===1?"":"s"}"><input type="radio" name="run-rating" value="${n}"><span>&#9733;</span></label>`).join("")}</div>${notesBox}<button class="btn btn-sm" onclick="submitRunFeedback('${id}',this)">Submit feedback</button><div class="run-feedback-status"></div></div>`:"";
  const failed=r.status==="checks_failed"&&(r.checkFailures||[]).length;
  const groundingUnavailable=r.status==="grounding_unavailable"||r.llmGroundingStatus==="unavailable";
  const banner=failed?`<div class="run-checks-failed"><div class="run-checks-title">&#9888; ${r.checkFailures.length} check${r.checkFailures.length===1?"":"s"} did not pass — review before shipping</div><ul>${r.checkFailures.map(c=>{
    const msg=c.message||c.why||"";
    const kind=c.claimKind?` · ${escHtml(c.claimKind)}`:"";
    const tier=c.tier?` <span class="mech-tier">${escHtml(c.tier)}</span>`:"";
    return`<li><code>${escHtml(c.checkId)}</code>${tier}${kind}${msg?` — ${escHtml(msg)}`:""}</li>`;
  }).join("")}</ul><div class="run-checks-note">The output below was still generated and billed. A check can be wrong about a correct draft — if that is what happened, say so in the notes.</div></div>`:"";
  const observations=(r.observations||[]).length?`<div class="run-observations"><div class="run-checks-title">Observations (advisory — not pass/fail)</div><ul>${r.observations.map(c=>{
    const msg=c.message||c.why||"";
    return`<li><code>${escHtml(c.checkId)}</code> <span class="mech-tier">advisory</span>${msg?` — ${escHtml(msg)}`:""}</li>`;
  }).join("")}</ul></div>`:"";
  const groundingBanner=groundingUnavailable?`<div class="run-grounding-unavailable"><div class="run-checks-title">&#9888; Grounding check unavailable for this run</div><div class="run-checks-note">${escHtml(r.groundingNotice||"Truthfulness was not verified for this draft. Do not treat this run as grounded.")}</div></div>`:"";
  const callMeta=typeof r.callCount==="number"?` · ${r.callCount} call${r.callCount===1?"":"s"}`:"";
  const headLabel=failed?"Output (failed checks)":groundingUnavailable?"Output (grounding not verified)":"Output";
  box.innerHTML=`<div class="run-result${failed||groundingUnavailable?" run-result-failed":""}">${banner}${observations}${groundingBanner}<div class="run-result-head">${headLabel} <span class="run-via">via ${escHtml(runModeLabel(r.mode)||r.via)}${callMeta}</span> ${r.tracePersisted&&r.traceId?`<span class="run-trace">&#10003; metadata trace ${escHtml(r.traceId)} recorded</span>`:`<span class="run-via">trace not persisted</span>`}</div><pre>${escHtml(r.output)}</pre>${feedback}</div>`;
}
function renderGapFillForm(id,state){
  const panel=document.getElementById("run-panel");
  const out=document.getElementById("run-out");
  if(!panel||!out)return;
  const gaps=state.gaps||[];
  const gapFields=gaps.map((g,i)=>`<div class="run-field run-field-wide"><label for="gap-ans-${i}">${escHtml(g.question)} <span class="run-req">required</span></label>${g.reason?`<div class="run-help">${escHtml(g.reason)}</div>`:""}<textarea id="gap-ans-${i}" data-gap-id="${escHtml(g.id)}"></textarea></div>`).join("");
  const excl=state.exclusions?`<div class="run-field run-field-wide"><label for="gap-excl">Anything that must NOT appear <span class="run-opt">optional</span></label><textarea id="gap-excl">${escHtml(state.exclusions)}</textarea></div>`:`<div class="run-field run-field-wide"><label for="gap-excl">Anything that must NOT appear <span class="run-opt">optional</span></label><div class="run-help">Sarah's exclusion question — always optional; not a detected gap.</div><textarea id="gap-excl"></textarea></div>`;
  panel.innerHTML=`<div class="run-form"><div class="run-unsupported"><div class="run-unsupported-title">Answer these gaps</div><p>The agent found ${gaps.length} missing item${gaps.length===1?"":"s"} in the pasted material. Questions are from its interview bank.</p></div>${gapFields}${excl}<button class="btn btn-sm btn-primary" onclick="continueGapFillUI('${id}')">Draft with answers &#9654;</button></div><div id="run-out" class="run-out"><div class="run-status">Waiting for gap answers. Call 1 is recorded; Call 2 runs after you submit.</div></div>`;
}
function toggleRun(id){
  const a=agents.find(x=>x.id===id);const box=document.getElementById("run-panel");if(!a||!box)return;
  if(box.innerHTML){box.innerHTML="";gapFillState=null;return}
  gapFillState=null;
  const contract=(runCapabilities[id]||{}).inputContract;
  let fields,unsupported="";
  if(contract&&contract.fields&&contract.fields.length){
    fields=contract.fields.map(contractField).join("");
    if((contract.unsupported||[]).length)unsupported=`<div class="run-unsupported"><div class="run-unsupported-title">Not read in this mode</div><ul>${contract.unsupported.map(u=>`<li>${escHtml(u.label)} — ${escHtml(u.reason)}</li>`).join("")}</ul></div>`;
  }else{
    fields=(a.inputs&&a.inputs.length?a.inputs:["input"]).map((inp,i)=>contractField({key:inp,label:inp,required:false,multiline:inp.length>40},i)).join("");
  }
  box.innerHTML=`<div class="run-form">${unsupported}${fields}<button class="btn btn-sm btn-primary" onclick="runAgentUI('${id}')">Run &#9654;</button></div><div id="run-out" class="run-out"></div>`;
}
/**
 * Record that this human witnessed a hosted run.
 *
 * Written ONLY when output actually reached the browser. A failed run, a 409
 * from the digest gate, a needs_input pause, or a thrown request writes
 * nothing — the row asserts a human saw output, and with no output there is
 * nothing to assert.
 *
 * The digest recorded is the one the run REPORTS HAVING SERVED
 * (result.artifactDigest), never runCapabilities' expected pin. If those two
 * ever disagree the served one is the truth, and attesting to the other would
 * be attesting to bytes that did not run.
 *
 * Failure to record is surfaced, never swallowed: the run still succeeded, but
 * the human must know no evidence was captured or they will believe the
 * promotion gate has something it does not.
 */
// Run statuses loopService can return alongside a rendered draft. Only
// needs_input is excluded: it pauses for gap answers and renders no draft, so
// there is nothing to witness. checks_failed and grounding_unavailable BOTH
// produced a draft a human read — and a failed check is precisely when human
// attestation matters most, because that is when someone needs to say the
// check is wrong about this draft. Gating on a clean run would mean only
// flawless agents could ever be attested, and therefore only flawless agents
// could ever be released — including released to fix the failing check.
const WITNESSABLE_RUN_STATUSES=Object.freeze(["ok","checks_failed","grounding_unavailable"]);
const NON_WITNESSABLE_RUN_STATUSES=Object.freeze(["needs_input"]);

/**
 * Record that this human witnessed a hosted run.
 *
 * ALWAYS returns a verdict object, never null. A silent null is the exact
 * failure class this project keeps finding: the caller renders nothing and the
 * human believes evidence exists when it does not. Every path below states
 * whether the row was recorded and, if not, why.
 *
 * The digest recorded is the one the run REPORTS HAVING SERVED
 * (result.artifactDigest), never runCapabilities' expected pin.
 */
async function recordWitnessedRun(id, result){
  if(!result||typeof result!=="object"){
    return{recorded:false,reason:"the run returned no result object, so there is no output to attest"};
  }
  const status=String(result.status||"");
  if(NON_WITNESSABLE_RUN_STATUSES.includes(status)){
    return{recorded:false,witnessable:false,reason:`run status "${status}" renders no draft, so there is nothing to witness`};
  }
  if(!WITNESSABLE_RUN_STATUSES.includes(status)){
    // An unrecognised status is reported, not silently dropped. If loopService
    // grows a new status this says so instead of quietly recording nothing.
    return{recorded:false,reason:`unrecognised run status "${status}" — evidence was not recorded because this wiring does not know whether a draft was rendered`};
  }
  const output=typeof result.output==="string"?result.output:"";
  if(!output.trim()){
    return{recorded:false,reason:`run status "${status}" but no output reached the browser, so there is nothing to attest`};
  }
  const servedDigest=String(result.artifactDigest||"").trim();
  if(!/^[a-f0-9]{64}$/i.test(servedDigest)){
    return{recorded:false,reason:"the run reported no served artifact digest"};
  }
  // Two different facts, two different messages. "Not configured" and "this
  // build does not ship the method" have different fixes.
  if(!ConvexDirectory||!ConvexDirectory.enabled){
    return{recorded:false,reason:"Convex is not configured in this browser session, so no evidence could be written"};
  }
  if(typeof ConvexDirectory.recordVerifiedHumanRunEvidence!=="function"){
    return{recorded:false,reason:"this build of convex-directory.bundle.js does not include recordVerifiedHumanRunEvidence — the frontend bundle is stale and needs rebuilding (npm run build:frontend)"};
  }
  try{
    const evidenceId=await ConvexDirectory.recordVerifiedHumanRunEvidence({
      displayId:id,
      artifactDigest:servedDigest,
    });
    return{recorded:true,evidenceId,servedDigest,status};
  }catch(e){
    return{recorded:false,reason:String(e&&e.message?e.message:e)};
  }
}

function renderWitnessNotice(witness){
  if(!witness)return"";
  if(witness.recorded){
    return`<div class="run-witness">Run evidence recorded against served digest <code>${escHtml(String(witness.servedDigest).slice(0,12))}</code>. This is not an eval result — promotion additionally requires one, recorded separately.</div>`;
  }
  return`<div class="run-witness run-witness-err">Run succeeded but no evidence was recorded: ${escHtml(witness.reason||"unknown reason")}. The promotion gate has nothing from this run.</div>`;
}

async function runAgentUI(id){
  const box=document.getElementById("run-out");if(!box)return;
  if(governedRuntimeRefused(runCapabilities[id])){box.innerHTML=`<div class="run-status run-err">${escHtml(governedRuntimeReason(runCapabilities[id]))}</div>`;return}
  const inputs={};document.querySelectorAll("#run-panel [data-k]").forEach(el=>{if(el.value.trim())inputs[el.getAttribute("data-k")]=el.value.trim()});
  box.innerHTML='<div class="run-status">Running…</div>';
  try{
    const r=await DirectoryAPI.runAgent(id,inputs);
    if(r.status==="needs_input"){
      gapFillState={
        fellowName:inputs.fellowName||"",
        sourceMaterial:inputs.sourceMaterial||"",
        exclusions:inputs.exclusions||"",
        gaps:r.gaps||[],
      };
      renderGapFillForm(id,gapFillState);
      return;
    }
    gapFillState=null;
    renderRunResult(id,r);
    // Only after output reached the browser. A throw above (including the
    // digest gate's 409) never reaches this line.
    const witness=await recordWitnessedRun(id,r);
    {const el=document.getElementById("run-out");if(el)el.insertAdjacentHTML("beforeend",renderWitnessNotice(witness));}
  }catch(e){box.innerHTML=`<div class="run-status run-err">Run failed: ${escHtml(String(e.message||e))}${e.tracePersisted&&e.traceId?`<div>Error trace ${escHtml(e.traceId)} recorded.</div>`:`<div>Error trace persistence is disabled.</div>`}</div>`}
}
async function continueGapFillUI(id){
  if(!gapFillState)return;
  const box=document.getElementById("run-out");if(!box)return;
  if(governedRuntimeRefused(runCapabilities[id])){box.innerHTML=`<div class="run-status run-err">${escHtml(governedRuntimeReason(runCapabilities[id]))}</div>`;return}
  const gapAnswers={};
  document.querySelectorAll("#run-panel [data-gap-id]").forEach(el=>{
    const v=el.value.trim();
    if(v)gapAnswers[el.getAttribute("data-gap-id")]=v;
  });
  const exclusionsEl=document.getElementById("gap-excl");
  const exclusions=exclusionsEl?exclusionsEl.value.trim():gapFillState.exclusions||"";
  box.innerHTML='<div class="run-status">Drafting…</div>';
  try{
    const r=await DirectoryAPI.runAgent(id,{
      fellowName:gapFillState.fellowName,
      sourceMaterial:gapFillState.sourceMaterial,
      ...(exclusions?{exclusions}:{}),
      gapAnswers,
    });
    if(r.status==="needs_input"){
      gapFillState={...gapFillState,exclusions,gaps:r.gaps||[]};
      renderGapFillForm(id,gapFillState);
      return;
    }
    gapFillState=null;
    renderRunResult(id,r);
    // The gap-fill completion is the other way output reaches the browser.
    // Same rule, same served digest — a human saw a draft either way.
    const witness=await recordWitnessedRun(id,r);
    {const el=document.getElementById("run-out");if(el)el.insertAdjacentHTML("beforeend",renderWitnessNotice(witness));}
  }catch(e){box.innerHTML=`<div class="run-status run-err">Run failed: ${escHtml(String(e.message||e))}${e.tracePersisted&&e.traceId?`<div>Error trace ${escHtml(e.traceId)} recorded.</div>`:`<div>Error trace persistence is disabled.</div>`}</div>`}
}

async function submitRunFeedback(id,button){
  const form=button&&button.closest(".run-feedback");if(!form)return;
  const selected=form.querySelector('input[name="run-rating"]:checked');
  const status=form.querySelector(".run-feedback-status");
  if(!selected){status.textContent="Choose 1–5 stars.";return}
  const notesEl=form.querySelector(".run-feedback-notes");
  const notes=notesEl?notesEl.value.trim():"";
  button.disabled=true;status.textContent="Saving feedback…";
  try{
    await DirectoryAPI.submitFeedback(id,form.dataset.traceId,{rating:Number(selected.value),...(notes?{notes}:{})});
    form.querySelectorAll("input,textarea,button").forEach(el=>el.disabled=true);
    status.textContent=notes?"Rating and notes saved.":"Rating saved (no notes).";
  }catch(e){button.disabled=false;status.textContent=`Feedback failed: ${String(e.message||e)}`}
}

const MECH_LAST_RESULT_PREFIX="directory_mech_last_";

function formatTraceTimestamp(ts){
  if(!ts)return"—";
  const s=String(ts);
  // Prefer ISO → readable UTC without inventing local TZ claims.
  if(/^\d{4}-\d{2}-\d{2}T/.test(s)){
    return s.replace("T"," ").replace(/\.\d+Z$/," UTC").replace(/Z$/," UTC");
  }
  return s;
}

function renderTraceSurface(a){
  queueMicrotask(()=>hydrateTraceSurface(a.id));
  return`<div class="trace-surface" id="trace-surface">
    <h4>HOSTED RUN TRACES <span class="golden-sub">metadata only · no draft or source text</span></h4>
    <div id="trace-surface-body" class="trace-surface-body" aria-live="polite">Loading traces…</div>
  </div>`;
}

async function hydrateTraceSurface(agentId){
  const box=document.getElementById("trace-surface-body");
  if(!box||!window.DirectoryAPI||!DirectoryAPI.enabled)return;
  try{
    const payload=await DirectoryAPI.listTraces(agentId,20);
    const traces=Array.isArray(payload)?payload:(payload?.traces||[]);
    const sorted=[...traces].sort((a,b)=>
      String(b.ts||b.timestamp||"").localeCompare(String(a.ts||a.timestamp||""))
    );
    const count=sorted.length;
    if(!count){
      box.innerHTML=`<div class="mech-meta">0 traces stored. Hosted runs land here as metadata-only records.</div>`;
      return;
    }
    const recent=sorted.slice(0,8);
    box.innerHTML=`<div class="trace-count"><strong>${count}</strong> trace${count===1?"":"s"} stored · showing latest ${recent.length}</div>
      <div class="trace-list">${recent.map((t)=>{
        const status=t.status||"unknown";
        const reason=t.failureReason?escHtml(t.failureReason):"";
        const model=[t.provider,t.modelId].filter(Boolean).join(" / ");
        const grounding=t.llmGroundingStatus
          ?`<div class="trace-reason"><b>llmGroundingStatus:</b> ${escHtml(t.llmGroundingStatus)}</div>`
          :"";
        return`<div class="trace-row">
          <div class="trace-row-top">
            <span class="pill pill-xs ${
              status==="ok"?"pill-green"
              :status==="fail"?"pill-amber"
              :status==="grounding_unavailable"?"pill-amber"
              :status==="error"?"pill-grey"
              :"pill-neutral"
            }">${escHtml(status)}</span>
            <span class="trace-ts">${escHtml(formatTraceTimestamp(t.ts||t.timestamp))}</span>
            ${model?`<span class="trace-model">${escHtml(model)}</span>`:""}
          </div>
          ${reason?`<div class="trace-reason"><b>failureReason:</b> ${reason}</div>`:""}
          ${grounding}
        </div>`;
      }).join("")}</div>`;
  }catch(e){
    box.innerHTML=`<div class="mech-refuse">Could not load traces: ${escHtml(String(e.message||e))}</div>`;
  }
}

function mechLastResultKey(agentId){
  return`${MECH_LAST_RESULT_PREFIX}${agentId||"unknown"}`;
}

function saveMechLastResult(agentId,payload){
  try{
    localStorage.setItem(mechLastResultKey(agentId),JSON.stringify({
      ...payload,
      savedAt:new Date().toISOString(),
    }));
  }catch(_){/* quota / private mode — display still works for this visit */}
}

function loadMechLastResultLocal(agentId){
  try{
    const raw=localStorage.getItem(mechLastResultKey(agentId));
    if(!raw)return null;
    const parsed=JSON.parse(raw);
    if(!parsed||!parsed.kind||!parsed.result)return null;
    return parsed;
  }catch(_){return null}
}

function mechRecordIsModern(rec){
  if(!rec||typeof rec!=="object")return false;
  if(!rec.checkSetId&&!rec.checkSetVersion)return false;
  if(rec.outputSource!=="live"&&rec.outputSource!=="canned")return false;
  const rows=rec.checkResults;
  if(!Array.isArray(rows)||!rows.length)return false;
  return rows.every((row)=>
    row&&(row.id||row.checkId)
    &&(row.category==="grounding"||row.category==="style")
    &&("passed" in row)
  );
}

function mechParseStoredProvenance(rec){
  const raw=String(rec.outputSource||"");
  const compound=raw.match(/^(canned|live):(check_coverage|output_quality)$/);
  if(compound)return{outputSource:compound[1],experiment:compound[2]};
  if(raw==="canned"||raw==="live"){
    return{outputSource:raw,experiment:rec.experiment||null};
  }
  return{outputSource:null,experiment:rec.experiment||null};
}

function mechSideFromStoredRecord(rec,outputSource){
  if(!mechRecordIsModern(rec)){
    return{
      legacyIncomplete:true,
      artifactVersion:rec.artifactVersion||null,
      artifactDigest:rec.artifactDigest||null,
      outputSource,
    };
  }
  return{
    artifactVersion:rec.artifactVersion,
    artifactDigest:rec.artifactDigest,
    checkSetId:rec.checkSetId||null,
    checkSetVersion:rec.checkSetVersion||null,
    rulerVersion:rec.rulerVersion||null,
    groundingPassRate:mechGroundingPassRate(rec),
    groundingScoreableCount:mechGroundingScoreableCount(rec),
    groundingBasisCheckIds:rec.groundingBasisCheckIds||rec.byCategory?.grounding?.basisCheckIds||null,
    stylePassRate:rec.stylePassRate,
    styleScoreableCount:rec.styleScoreableCount,
    styleBasisCheckIds:rec.styleBasisCheckIds||rec.byCategory?.style?.basisCheckIds||null,
    byCategory:rec.byCategory
      ?{
          grounding:rec.byCategory.grounding?{...rec.byCategory.grounding}:null,
          style:rec.byCategory.style?{...rec.byCategory.style}:null,
        }
      :null,
    guardrailGate:rec.guardrailGate||null,
    passed:[...rec.passed],
    failed:[...rec.failed],
    notScoreable:[...rec.notScoreable],
    checkResults:rec.checkResults.map((row)=>({...row})),
    outputSource,
    timestamp:rec.timestamp||rec.ts||null,
  };
}

function mechCategoryCounts(side,category){
  if(!side||side.legacyIncomplete)return null;
  const cat=side.byCategory&&side.byCategory[category];
  if(cat&&typeof cat.scoreableCount==="number"&&Array.isArray(cat.passed)&&Array.isArray(cat.failed)){
    return{
      passed:cat.passed.length,
      failed:cat.failed.length,
      scoreable:cat.scoreableCount,
      passRate:typeof cat.passRate==="number"?cat.passRate:null,
    };
  }
  const rows=(side.checkResults||[]).filter((r)=>
    r.category===category&&(r.passed===true||r.passed===false)
  );
  if(!rows.length)return null;
  const passed=rows.filter((r)=>r.passed===true).length;
  return{
    passed,
    failed:rows.length-passed,
    scoreable:rows.length,
    passRate:Math.round((passed/rows.length)*1000)/10,
  };
}

/** True only when grounding was actually scored (scoreable > 0 with a numeric rate). */
function mechGroundingMeasured(side){
  const g=mechCategoryCounts(side,"grounding");
  return Boolean(
    g
    &&typeof g.passRate==="number"
    &&typeof g.scoreable==="number"
    &&g.scoreable>0
  );
}

/**
 * Grounding pass rate off a score row. `mechanicalCheckScore` is the historical
 * key for this number — nothing writes it any more, but rows persisted before
 * the rename still carry it, so a read falls back rather than rendering real
 * history as "not measured". There is deliberately no combined quality number:
 * grounding and style are separate rates and must be shown as such.
 */
function mechGroundingPassRate(row){
  if(!row||typeof row!=="object")return null;
  if(typeof row.groundingPassRate==="number")return row.groundingPassRate;
  if(typeof row.byCategory?.grounding?.passRate==="number")return row.byCategory.grounding.passRate;
  if(typeof row.mechanicalCheckScore==="number")return row.mechanicalCheckScore;
  return null;
}
function mechGroundingScoreableCount(row){
  if(!row||typeof row!=="object")return null;
  if(typeof row.groundingScoreableCount==="number")return row.groundingScoreableCount;
  if(typeof row.byCategory?.grounding?.scoreableCount==="number")return row.byCategory.grounding.scoreableCount;
  if(typeof row.scoreableCount==="number")return row.scoreableCount;
  return null;
}

/**
 * Grounding Δ only when both sides have a real grounding measurement.
 * Never invent a delta from a grounding pass rate when the UI would say
 * "not yet checked".
 */
function mechGroundingDeltaFromSides(left,right){
  if(!mechGroundingMeasured(left)||!mechGroundingMeasured(right)){
    return{
      comparable:false,
      reason:"no grounding delta — one or both sides have no grounding measurement",
    };
  }
  const leftRate=mechCategoryCounts(left,"grounding").passRate;
  const rightRate=mechCategoryCounts(right,"grounding").passRate;
  return{
    comparable:true,
    value:Math.round((rightRate-leftRate)*10)/10,
  };
}

function mechFormatPassRate(passRate,passed,scoreable){
  if(
    typeof passRate!=="number"
    ||typeof passed!=="number"
    ||typeof scoreable!=="number"
    ||scoreable<=0
  ){
    return"not yet checked";
  }
  return`${passRate}% · ${passed} of ${scoreable} checks passed`;
}

function mechFormatCategoryStrip(side){
  if(!side||side.legacyIncomplete){
    return`<div class="mech-card-meta">not yet checked</div>`;
  }
  const g=mechCategoryCounts(side,"grounding");
  const s=mechCategoryCounts(side,"style");
  const gText=g?`Grounding ${g.passed} of ${g.scoreable}`:"Grounding not yet checked";
  const sText=s?`Style ${s.passed} of ${s.scoreable}`:"Style not yet checked";
  return`<div class="mech-card-meta mech-cat-strip"><span class="mech-cat-grounding">${escHtml(gText)}</span> · <span class="mech-cat-style">${escHtml(sText)}</span></div>`;
}

function mechStyleFailCount(side){
  const s=mechCategoryCounts(side,"style");
  if(s&&typeof s.failed==="number")return s.failed;
  return null;
}

function mechCoverageReadingFromSides(left,right){
  const leftFails=mechStyleFailCount(left);
  const rightFails=mechStyleFailCount(right);
  if(leftFails==null||rightFails==null){
    return{direction:"unknown",detail:"Style detection counts not yet checked on one or both sides."};
  }
  if(rightFails>leftFails){
    return{
      direction:"right_detects_more",
      detail:"Right check set failed more style checks on the same output — stronger coverage, not worse quality.",
    };
  }
  if(rightFails<leftFails){
    return{
      direction:"left_detects_more",
      detail:"Left check set failed more style checks on the same output — stronger coverage on the left.",
    };
  }
  return{
    direction:"equal_style_detection",
    detail:"Style failure counts match on this output.",
  };
}

function mechChangedFromSides(left,right){
  const ids=new Set([
    ...(left.checkResults||[]).map((r)=>r.id||r.checkId),
    ...(right.checkResults||[]).map((r)=>r.id||r.checkId),
  ]);
  const map=(side)=>Object.fromEntries((side.checkResults||[]).map((r)=>[r.id||r.checkId,r.status]));
  const leftMap=map(left);
  const rightMap=map(right);
  const changed=[];
  for(const id of[...ids].sort()){
    const from=Object.prototype.hasOwnProperty.call(leftMap,id)?leftMap[id]:"absent";
    const to=Object.prototype.hasOwnProperty.call(rightMap,id)?rightMap[id]:"absent";
    if(from!==to)changed.push({checkId:id,from,to});
  }
  return changed;
}

function mechNormalizeScoreDelta(delta){
  if(delta&&typeof delta==="object"&&typeof delta.comparable==="boolean")return delta;
  if(typeof delta==="number"){
    return{comparable:true,value:delta};
  }
  return{comparable:false,reason:"not comparable"};
}

/** Rebuild a renderable score/compare payload from append-only mechanicalResults. */
function reconstructMechPayloadFromStored(rows){
  const list=Array.isArray(rows)?rows:[];
  for(let i=0;i<list.length;i++){
    const a=list[i];
    const aProv=mechParseStoredProvenance(a);
    if(!aProv.experiment||!a.comparedTo)continue;
    if(!mechRecordIsModern(a)&&!String(a.outputSource||"").includes(":")){
      // Incomplete modern schema without legacy compound tag — skip rather than invent.
      continue;
    }
    const partner=list.find((b,j)=>{
      if(j===i||!b.comparedTo)return false;
      const bProv=mechParseStoredProvenance(b);
      return bProv.outputSource===aProv.outputSource
        &&bProv.experiment===aProv.experiment
        &&b.artifactVersion===a.comparedTo
        &&b.comparedTo===a.artifactVersion;
    });
    if(!partner)continue;
    // Prefer modern pairs only; legacy pairs surface as not-yet-checked sides.
    const[leftRec,rightRec]=[a,partner].sort((x,y)=>
      String(x.timestamp||x.ts||"").localeCompare(String(y.timestamp||y.ts||""))
    );
    const outputSource=aProv.outputSource;
    const experiment=aProv.experiment;
    const left=mechSideFromStoredRecord(leftRec,outputSource);
    const right=mechSideFromStoredRecord(rightRec,outputSource);
    const restoredAt=rightRec.timestamp||rightRec.ts||leftRec.timestamp||leftRec.ts||null;
    if(experiment==="check_coverage"){
      const leftIds=[...(left.checkResults||[]).map((r)=>r.id||r.checkId)].sort();
      const rightIds=[...(right.checkResults||[]).map((r)=>r.id||r.checkId)].sort();
      const checkSetsDiffer=
        left.legacyIncomplete||right.legacyIncomplete
        ||leftIds.length!==rightIds.length
        ||leftIds.some((id,idx)=>id!==rightIds[idx]);
      const leftCount=leftIds.length;
      const rightCount=rightIds.length;
      const scoreDelta=checkSetsDiffer||left.legacyIncomplete||right.legacyIncomplete
        ?{
            comparable:false,
            reason:left.legacyIncomplete||right.legacyIncomplete
              ?"not yet checked"
              :`check set changed: ${leftCount} checks → ${rightCount} checks`,
            leftCheckCount:leftCount,
            rightCheckCount:rightCount,
          }
        :mechGroundingDeltaFromSides(left,right);
      if(scoreDelta.comparable&&typeof scoreDelta.value!=="number"){
        scoreDelta.comparable=false;
        scoreDelta.reason="no grounding delta — one or both sides have no grounding measurement";
        delete scoreDelta.value;
      }
      return{
        kind:"compare",
        source:"server",
        result:{
          experiment:"check_coverage",
          label:"check_coverage",
          measures:"check_coverage",
          interpretation:
            "Same output, different check sets. Category pass rates are side by side; more style failures mean stronger coverage, not worse output.",
          caseId:leftRec.goldenCaseId||rightRec.goldenCaseId||null,
          outputSource,
          outputProvenance:outputSource==="canned"?"canned_fixtures":"live_generation",
          answersDidImprovementHelp:false,
          findingKind:"check_coverage",
          checkSetsDiffer,
          ...(checkSetsDiffer
            ?{checkSetNote:scoreDelta.reason}
            :{}),
          outputQualityComparable:false,
          scoreDelta,
          groundingPassRateDelta:scoreDelta,
          left,
          right,
          changed:left.legacyIncomplete||right.legacyIncomplete?[]:mechChangedFromSides(left,right),
          coverageReading:mechCoverageReadingFromSides(left,right),
          restoredFromStore:true,
          restoredAt,
        },
      };
    }
    const scoreDelta=
      left.legacyIncomplete||right.legacyIncomplete
        ?{comparable:false,reason:"not yet checked"}
        :!left.checkSetId||!right.checkSetId
          ?{comparable:false,reason:"recorded before check-set versioning"}
          :left.checkSetId!==right.checkSetId
            ?{
                comparable:false,
                reason:`check set changed: ${(left.checkResults||[]).length} checks → ${(right.checkResults||[]).length} checks`,
              }
            :(left.rulerVersion||right.rulerVersion)&&(left.rulerVersion!==right.rulerVersion)
              ?{comparable:false,reason:"ruler version mismatch"}
              :mechGroundingDeltaFromSides(left,right);
    if(scoreDelta.comparable&&typeof scoreDelta.value!=="number"){
      scoreDelta.comparable=false;
      scoreDelta.reason="no grounding delta — one or both sides have no grounding measurement";
      delete scoreDelta.value;
    }
    return{
      kind:"compare",
      source:"server",
      result:{
        experiment:"output_quality",
        label:"output_quality",
        caseId:leftRec.goldenCaseId||rightRec.goldenCaseId||null,
        outputSource,
        outputProvenance:outputSource==="canned"?"canned_fixtures":"live_generation",
        answersDidImprovementHelp:outputSource==="live",
        findingKind:outputSource==="live"?"prompt_comparison":"plumbing_verification",
        scoreDelta,
        groundingPassRateDelta:scoreDelta,
        promotionEligible:outputSource==="live"&&scoreDelta.comparable===true,
        promotionEligibility:outputSource==="live"
          ?(scoreDelta.comparable
            ?{eligible:true,reason:null}
            :{eligible:false,reason:scoreDelta.reason||"grounding delta not comparable"})
          :{
              eligible:false,
              reason:'Comparable delta is real but not promotion-eligible — outputSource is "canned"; only "live" may support promotion.',
            },
        left,
        right,
        changed:left.legacyIncomplete||right.legacyIncomplete?[]:mechChangedFromSides(left,right),
        restoredFromStore:true,
        restoredAt,
      },
    };
  }
  const single=list.find((r)=>{
    const prov=mechParseStoredProvenance(r);
    return (prov.outputSource==="canned"||prov.outputSource==="live")&&!prov.experiment;
  });
  if(!single)return null;
  if(!mechRecordIsModern(single)){
    return{
      kind:"score",
      source:"server",
      result:{
        ok:true,
        verification:"ok",
        label:"mechanical_check_score",
        legacyIncomplete:true,
        caseId:single.goldenCaseId||null,
        outputSource:mechParseStoredProvenance(single).outputSource,
        restoredFromStore:true,
        restoredAt:single.timestamp||single.ts||null,
      },
    };
  }
  const singleSide=mechSideFromStoredRecord(single,mechParseStoredProvenance(single).outputSource);
  return{
    kind:"score",
    source:"server",
    result:{
      ok:true,
      verification:"ok",
      label:"mechanical_check_score",
      caseId:single.goldenCaseId||null,
      outputSource:singleSide.outputSource,
      outputProvenance:singleSide.outputSource==="live"?"live_generation":"canned_fixtures",
      findingKind:
        singleSide.outputSource==="live"?"single_version_live_score":"plumbing_verification",
      artifactVersion:singleSide.artifactVersion,
      artifactDigest:singleSide.artifactDigest,
      checkSetVersion:singleSide.checkSetVersion,
      groundingPassRate:mechGroundingPassRate(singleSide),
      groundingScoreableCount:mechGroundingScoreableCount(singleSide),
      groundingBasisCheckIds:singleSide.groundingBasisCheckIds||singleSide.byCategory?.grounding?.basisCheckIds||null,
      stylePassRate:singleSide.stylePassRate,
      styleScoreableCount:singleSide.styleScoreableCount,
      styleBasisCheckIds:singleSide.styleBasisCheckIds||singleSide.byCategory?.style?.basisCheckIds||null,
      byCategory:singleSide.byCategory,
      passed:singleSide.passed,
      failed:singleSide.failed,
      notScoreable:singleSide.notScoreable,
      checkResults:singleSide.checkResults,
      restoredFromStore:true,
      restoredAt:single.timestamp||single.ts||null,
    },
  };
}

function renderMechRestoredCaption(payload){
  if(!payload)return"";
  const when=payload.result?.restoredAt||payload.savedAt;
  const from=payload.source==="server"?"last stored run":"last run on this browser";
  const stamp=when?` · ${escHtml(String(when).replace("T"," ").replace(/\.\d+Z$/," UTC"))}`:"";
  return`<div class="mech-restored">Showing ${escHtml(from)}${stamp}. Re-run below to refresh.</div>`;
}

function showMechResult(agentId,payload,{persist=false,markRestored=false}={}){
  const box=document.getElementById("mech-compare-out");
  if(!box||!payload?.result)return;
  let next=payload;
  if(payload.kind==="compare"&&payload.result){
    const safe=mechGroundingDeltaFromSides(payload.result.left,payload.result.right);
    const claimed=mechNormalizeScoreDelta(
      payload.result.scoreDelta||payload.result.groundingPassRateDelta||payload.result.mechanicalCheckScoreDelta
    );
    // Never keep a numeric Δ when grounding wasn't measured on both sides.
    if(!safe.comparable&&claimed.comparable){
      next={
        ...payload,
        result:{
          ...payload.result,
          scoreDelta:safe,
          groundingPassRateDelta:safe,
          promotionEligible:false,
          promotionEligibility:{eligible:false,reason:safe.reason},
        },
      };
    }
  }
  if(persist)saveMechLastResult(agentId,next);
  const body=next.kind==="score"
    ?renderMechanicalScoreResult(next.result)
    :renderMechanicalCompareResult(next.result);
  const caption=markRestored||next.result.restoredFromStore||next.source==="local"
    ?renderMechRestoredCaption(next)
    :"";
  box.innerHTML=`${caption}${body}`;
}

async function hydrateMechLastResultUI(id){
  const box=document.getElementById("mech-compare-out");
  if(!box)return;
  const emptyHtml=`<div class="mech-meta mech-empty-last">No mechanical run stored yet. Results land here after the first score or compare.</div>`;
  const local=loadMechLastResultLocal(id);
  if(local){
    showMechResult(id,{...local,source:local.source||"local"},{markRestored:true});
  }else{
    box.innerHTML=emptyHtml;
    const rerun=document.querySelector("#mech-compare-panel details.mech-rerun");
    if(rerun)rerun.open=true;
  }
  try{
    const rows=await DirectoryAPI.mechanicalResults(id,20);
    const list=Array.isArray(rows)?rows:(rows?.results||rows?.items||[]);
    const fromServer=reconstructMechPayloadFromStored(list);
    if(!fromServer){
      // Empty or non-reconstructable server store wins over a stale browser cache.
      try{localStorage.removeItem(mechLastResultKey(id));}catch(_){}
      box.innerHTML=emptyHtml;
      const rerun=document.querySelector("#mech-compare-panel details.mech-rerun");
      if(rerun)rerun.open=true;
      return;
    }
    // Prefer a fresher server pair over a stale browser cache.
    const localTs=local?.savedAt||local?.result?.restoredAt||"";
    const serverTs=fromServer.result.restoredAt||"";
    if(!local||(serverTs&&serverTs>localTs)||!mechGroundingMeasured(local?.result?.left)||!mechGroundingMeasured(local?.result?.right)){
      saveMechLastResult(id,fromServer);
      showMechResult(id,fromServer,{markRestored:true});
      const rerun=document.querySelector("#mech-compare-panel details.mech-rerun");
      if(rerun)rerun.open=false;
    }
  }catch(_){
    /* local cache (if any) already shown; inventory/errors stay elsewhere */
  }
}

function renderMechanicalComparePanel(a){
  queueMicrotask(()=>{
    hydrateMechLastResultUI(a.id);
    loadMechanicalInventoryUI(a.id);
  });
  return `<div class="mech-compare" id="mech-compare-panel">
    <h4>MECHANICAL CHECKS <span class="golden-sub">not an eval score · does not feed fleet health · not written to evalHistory</span></h4>
    <div id="mech-compare-out" class="mech-compare-out" aria-live="polite"><div class="mech-meta">Loading last result…</div></div>
    <details class="mech-rerun">
      <summary>Re-run checks</summary>
      <div id="mech-inventory" class="mech-inventory">Loading inventory…</div>
      <div class="mech-compare-controls">
        <label>Golden case <select id="mech-case"><option value="a7-mira-okonkwo-v1">a7-mira-okonkwo-v1 (synthetic)</option></select></label>
        <label>Score version <select id="mech-score-version"><option value="biocraft-singleshot-v5">v5</option><option value="biocraft-singleshot-v6">v6</option><option value="biocraft-singleshot-v7">v7</option><option value="biocraft-singleshot-v9" selected>v9 (live)</option></select></label>
        <label>Left <select id="mech-left"><option value="biocraft-singleshot-v5">v5</option><option value="biocraft-singleshot-v6">v6</option><option value="biocraft-singleshot-v7">v7</option><option value="biocraft-singleshot-v9" selected>v9 (live)</option></select></label>
        <label>Right <select id="mech-right"><option value="biocraft-singleshot-v5">v5</option><option value="biocraft-singleshot-v6">v6</option><option value="biocraft-singleshot-v7">v7</option><option value="biocraft-singleshot-v9">v9 (live)</option></select></label>
        <label>Ruler (quality only) <select id="mech-ruler"><option value="biocraft-singleshot-v9" selected>v9 checks</option><option value="biocraft-singleshot-v7">v7 checks</option><option value="biocraft-singleshot-v6">v6 checks</option><option value="biocraft-singleshot-v5">v5 checks</option></select></label>
      </div>
      <div class="mech-compare-actions">
        <button class="btn btn-sm" onclick="runMechanicalScoreUI('${a.id}','canned')">With canned output (free)</button>
        <button class="btn btn-sm" onclick="runMechanicalScoreUI('${a.id}','live')">With a live run ($)</button>
        <button class="btn btn-sm" onclick="runMechanicalCompareUI('${a.id}','check_coverage','canned')">Check coverage — same output, different checks (free)</button>
        <button class="btn btn-sm" onclick="runMechanicalCompareUI('${a.id}','output_quality','canned')">Quality plumbing — pipeline test, canned (free)</button>
        <button class="btn btn-sm btn-primary" onclick="runMechanicalCompareUI('${a.id}','output_quality','live')">Output quality — two live runs + ruler ($)</button>
        <button class="btn btn-sm" onclick="previewMechanicalCompareUI('${a.id}')">Preview comparability</button>
      </div>
      <div class="mech-compare-hint">Check coverage = same output, different check sets (lower score = better detection). Output quality live = two prompt runs, one ruler (only that answers “did the improvement help”). Quality plumbing canned = plumbing only. Live buttons confirm before spending.</div>
    </details>
  </div>`;
}

async function loadMechanicalInventoryUI(id){
  const box=document.getElementById("mech-inventory");if(!box)return;
  try{
    const inv=await DirectoryAPI.mechanicalInventory(id);
    const failed=(inv.artifactVersions||[]).filter(v=>v.verification==="failed");
    const ok=(inv.artifactVersions||[]).filter(v=>v.verification==="ok");
    box.innerHTML=`<div class="mech-inventory-summary">${escHtml(inv.summary||"")}</div>
      <ul class="mech-inventory-list">
        ${(inv.goldenCases||[]).map(c=>`<li>Case <code>${escHtml(c.id)}</code>${c.synthetic?" · synthetic":""} · ${c.sourceGroundingCheckCount||0} source-grounding checks</li>`).join("")}
        ${ok.map(v=>`<li>Version <code>${escHtml(v.artifactVersion)}</code> · ${digestChip(v.artifactDigest)} · ${v.checkCount} checks · verified</li>`).join("")}
        ${failed.map(v=>`<li class="mech-verify-fail">Version <code>${escHtml(v.artifactVersion)}</code> · verification failed — not scoreable · ${escHtml(v.verificationError||"digest mismatch")}</li>`).join("")}
      </ul>`;
    const scoreSel=document.getElementById("mech-score-version");
    const leftSel=document.getElementById("mech-left");
    const rightSel=document.getElementById("mech-right");
    const rulerSel=document.getElementById("mech-ruler");
    const opts=ok.map(v=>`<option value="${escHtml(v.artifactVersion)}">${escHtml(v.artifactVersion)}</option>`).join("");
    if(scoreSel&&opts){scoreSel.innerHTML=opts;const prefer=ok.find(v=>v.artifactVersion.includes("v7"))||ok.find(v=>v.artifactVersion.includes("v6"))||ok[ok.length-1];if(prefer)scoreSel.value=prefer.artifactVersion}
    if(leftSel&&opts){leftSel.innerHTML=opts;leftSel.value=(ok.find(v=>v.artifactVersion.includes("v6"))||ok[0])?.artifactVersion||leftSel.value}
    if(rightSel&&opts){rightSel.innerHTML=opts;rightSel.value=(ok.find(v=>v.artifactVersion.includes("v7"))||ok.find(v=>v.artifactVersion.includes("v6"))||ok[ok.length-1])?.artifactVersion||rightSel.value}
    if(rulerSel&&opts){rulerSel.innerHTML=opts;rulerSel.value=(ok.find(v=>v.artifactVersion.includes("v7"))||ok.find(v=>v.artifactVersion.includes("v6"))||ok[ok.length-1])?.artifactVersion||rulerSel.value}
  }catch(e){
    box.innerHTML=`<div class="mech-refuse">Inventory unavailable: ${escHtml(String(e.message||e))}. Point localStorage.directory_api_base at a loop service that has these routes.</div>`;
  }
}

function mechCompareVersions(){
  return {
    caseId:document.getElementById("mech-case")?.value||"a7-mira-okonkwo-v1",
    scoreVersion:document.getElementById("mech-score-version")?.value||"biocraft-singleshot-v9",
    leftVersion:document.getElementById("mech-left")?.value||"biocraft-singleshot-v9",
    rightVersion:document.getElementById("mech-right")?.value||"biocraft-singleshot-v9",
    rulerVersion:document.getElementById("mech-ruler")?.value||"biocraft-singleshot-v9",
  };
}

function mechOutputSourceLabel(r){
  const src=r.outputSource||r.outputProvenance||"unknown";
  if(src==="live"||r.outputProvenance==="live_generation")return"live";
  if(src==="canned"||r.outputProvenance==="canned_fixtures")return"canned";
  return String(src).split(":")[0]||"unknown";
}

function renderMechHeadlineCard(side,outputSource,{semantic="quality"}={}){
  if(!side)return"";
  if(side.verification==="failed"){
    return`<div class="mech-card mech-card-fail"><div class="mech-card-eyebrow">Verification failed</div>
      <div class="mech-refuse">Not a score. ${escHtml(side.error||side.verificationError||"digest mismatch")}</div></div>`;
  }
  if(side.legacyIncomplete){
    return`<div class="mech-card mech-card-incomplete">
      <div class="mech-card-eyebrow">${escHtml(shortVersionLabel(side.artifactVersion)||"—")}</div>
      <div class="mech-card-score mech-card-score-missing">not yet checked</div>
      <div class="mech-card-unit">stored run predates category-split scores</div>
    </div>`;
  }
  const ver=side.artifactVersion||"";
  const short=shortVersionLabel(ver)||"—";
  const src=outputSource||side.outputSource||"";
  const g=mechCategoryCounts(side,"grounding");
  const headline=g
    ?mechFormatPassRate(g.passRate,g.passed,g.scoreable)
    :"not yet checked";
  return`<div class="mech-card mech-card-quality">
    <div class="mech-card-eyebrow"><span class="mech-card-ver">${escHtml(short)}</span> · <span class="mech-card-artifact">${escHtml(ver)}</span></div>
    <div class="mech-card-score${g&&g.failed>0?" mech-score-grounding-fail":""}">${escHtml(headline)}</div>
    <div class="mech-card-unit">grounding pass rate</div>
    ${mechFormatCategoryStrip(side)}
    ${src?`<div class="mech-card-meta">output source: ${escHtml(src)}</div>`:`<div class="mech-card-meta">output source: not yet checked</div>`}
    ${side.scoredWith?`<div class="mech-card-meta">scored with ruler <code>${escHtml(side.scoredWith)}</code></div>`:""}
  </div>`;
}

/** Coverage side strip: version + demoted grounding/style rates. */
function renderMechCoverageSideMeta(side,outputSource){
  if(!side)return"";
  if(side.verification==="failed"){
    return`<div class="mech-coverage-side"><div class="mech-card-eyebrow">Verification failed</div>
      <div class="mech-refuse">Not a score. ${escHtml(side.error||side.verificationError||"digest mismatch")}</div></div>`;
  }
  if(side.legacyIncomplete){
    return`<div class="mech-coverage-side">
      <div class="mech-card-eyebrow">${escHtml(shortVersionLabel(side.artifactVersion)||"—")}</div>
      <div class="mech-coverage-score-meta">not yet checked</div>
    </div>`;
  }
  const ver=side.artifactVersion||"";
  const short=shortVersionLabel(ver)||"—";
  const src=outputSource||side.outputSource||"";
  const g=mechCategoryCounts(side,"grounding");
  const headline=g
    ?mechFormatPassRate(g.passRate,g.passed,g.scoreable)
    :"not yet checked";
  return`<div class="mech-coverage-side">
    <div class="mech-card-eyebrow"><span class="mech-card-ver">${escHtml(short)}</span> · <span class="mech-card-artifact">${escHtml(ver)}</span></div>
    <div class="mech-coverage-score-meta${g&&g.failed>0?" mech-score-grounding-fail":""}">${escHtml(headline)}</div>
    ${mechFormatCategoryStrip(side)}
    ${src?`<div class="mech-card-meta">output source: ${escHtml(src)}</div>`:`<div class="mech-card-meta">output source: not yet checked</div>`}
  </div>`;
}

/**
 * Coverage headline is style detections — grounding is the labelled quality bar.
 */
function renderMechCoverageHeadline(left,right,outputSource){
  const L=mechStyleFailCount(left);
  const R=mechStyleFailCount(right);
  const caught=L==null||R==null
    ?"detections not yet checked"
    :`caught ${L} → ${R} style issues`;
  return`<div class="mech-coverage-headline" title="Style detections on the same output. More style failures mean stronger coverage, not worse quality. Grounding is reported separately and is never averaged with style.">
    <div class="mech-coverage-lead">
      <div class="mech-coverage-lead-label">style detections</div>
      <div class="mech-coverage-lead-value">${escHtml(caught)}</div>
    </div>
    <div class="mech-coverage-sides">
      ${renderMechCoverageSideMeta(left,outputSource)}
      ${renderMechCoverageSideMeta(right,outputSource)}
    </div>
  </div>`;
}

function renderGuardrailGateLine(gate){
  if(!gate||typeof gate!=="object")return"";
  const cov=gate.coverage;
  const summary=cov&&cov.summary
    ?cov.summary
    :gate.passed
      ?"guardrails passed (coverage not recorded)"
      :"guardrails failed";
  const tone=gate.passed?"mech-guardrail-pass":"mech-guardrail-fail";
  return`<div class="mech-guardrail-line ${tone}"><strong>Guardrails:</strong> ${escHtml(summary)}</div>`;
}

function renderPromotionEligibilityNote(r){
  const elig=r&&r.promotionEligibility;
  if(!elig)return"";
  if(elig.eligible){
    return`<div class="mech-promotion-elig mech-promotion-elig-ok"><strong>Promotion evidence:</strong> live comparable delta — may support a promotion decision (human approval still required).</div>`;
  }
  const delta=mechNormalizeScoreDelta(r.scoreDelta||r.groundingPassRateDelta||r.mechanicalCheckScoreDelta);
  const comparable=delta.comparable===true;
  if(comparable&&r.outputSource==="canned"){
    return`<div class="mech-promotion-elig mech-promotion-elig-block"><strong>Comparable, not promotable.</strong> ${escHtml(elig.reason||'Delta is real; outputSource is "canned" so it cannot support promotion.')}</div>`;
  }
  return`<div class="mech-promotion-elig mech-promotion-elig-block"><strong>Not promotion-eligible:</strong> ${escHtml(elig.reason||"missing live comparable evidence")}</div>`;
}

function renderMechQualityDeltaChip(delta,{allowDirection=true}={}){
  const d=mechNormalizeScoreDelta(delta);
  if(!d.comparable||typeof d.value!=="number"){
    return`<div class="mech-delta-chip mech-delta-refused">
      <div class="mech-delta-chip-label">grounding Δ</div>
      <div class="mech-delta-chip-value">—</div>
      <div class="mech-delta-chip-reason">${escHtml(
        d.reason||"no grounding delta — one or both sides have no grounding measurement"
      )}</div>
    </div>`;
  }
  const value=d.value;
  const label=value>0?`+${value}`:String(value);
  const dirClass=allowDirection
    ?(value>0?"mech-delta-up":value<0?"mech-delta-down":"")
    :"";
  return`<div class="mech-delta-chip mech-delta-quality ${dirClass}">
    <div class="mech-delta-chip-label">grounding Δ</div>
    <div class="mech-delta-chip-value">${escHtml(label)}</div>
  </div>`;
}

function renderMechQualityRefusedTile(r){
  const d=mechNormalizeScoreDelta(r.scoreDelta||r.groundingPassRateDelta||r.mechanicalCheckScoreDelta);
  const reason=d.reason||r.checkSetNote||"not comparable";
  return`<div class="mech-quality-tile" title="${escAttr(r.checkSetNote||r.interpretation||"Coverage experiment — no output-quality delta.")}">
    <div class="mech-quality-tile-label">Quality delta</div>
    <div class="mech-quality-tile-value">—</div>
    <div class="mech-quality-tile-reason">${escHtml(reason)}</div>
  </div>`;
}

function renderMechExperimentCaption(r,{experimentLabel,tooltip}){
  const src=mechOutputSourceLabel(r);
  const srcPhrase=src==="canned"?"canned outputs":src==="live"?"live outputs":`${src} outputs`;
  return`<div class="mech-caption">${escHtml(experimentLabel)} · ${escHtml(srcPhrase)} · ${
    r.experiment==="check_coverage"
      ?`coverage, not quality <span class="mech-info" title="${escAttr(tooltip)}" tabindex="0" aria-label="More about this experiment">ⓘ</span>`
      :`quality <span class="mech-info" title="${escAttr(tooltip)}" tabindex="0" aria-label="More about this experiment">ⓘ</span>`
  }</div>`;
}

function renderMechCheckTable(left,right,leftLabel,rightLabel){
  const ids=[...new Set([
    ...(left?.checkResults||[]).map(r=>r.id||r.checkId),
    ...(right?.checkResults||[]).map(r=>r.id||r.checkId),
  ])].filter(Boolean).sort();
  if(!ids.length)return"";
  const statusOf=(side,id)=>{
    const row=(side?.checkResults||[]).find(r=>(r.id||r.checkId)===id);
    if(!row)return{text:"absent",passFail:null,historical:false,category:null,why:null,tier:null};
    const hist=row.historicalImplementation;
    const cat=row.category||null;
    const tier=row.tier||null;
    const status=row.status||(row.passed===true?"pass":row.passed===false?"fail":null);
    return{
      text:[status,tier?`tier:${tier}`:null,hist?"historical":null].filter(Boolean).join(" · "),
      passFail:status,
      historical:!!hist,
      category:cat,
      why:row.why||null,
      tier,
    };
  };
  const cell=(side,id)=>{
    const s=statusOf(side,id);
    const tips=[];
    if(s.historical)tips.push("historicalImplementation: scored with the check logic that existed on this artifact version, not today's code.");
    if(s.why)tips.push(s.why);
    const tip=tips.length?` title="${escAttr(tips.join(" "))}"`:"";
    let cls="";
    if(s.passFail==="observation"||s.tier==="advisory")cls="mech-status-observation";
    else if(s.passFail==="no_hit"||s.tier==="named_hit"&&s.passFail!=="fail")cls="mech-status-named-hit";
    else if(s.passFail==="pass")cls="mech-status-pass";
    else if(s.passFail==="fail"&&s.category==="grounding")cls="mech-status-fail-grounding";
    else if(s.passFail==="fail")cls="mech-status-fail-style";
    return`<td class="${cls}"${tip}>${escHtml(s.text)}${s.category?` <span class="mech-cat-tag mech-cat-${escHtml(s.category)}">${escHtml(s.category)}</span>`:""}</td>`;
  };
  return`<div class="mech-table-wrap"><table class="mech-table">
    <thead><tr><th>Check id</th><th>${escHtml(leftLabel||"Left")}</th><th>${escHtml(rightLabel||"Right")}</th></tr></thead>
    <tbody>${ids.map(id=>{
      const L=statusOf(left,id).text,R=statusOf(right,id).text;
      const changed=L!==R?' class="mech-row-changed"':"";
      return`<tr${changed}><td><code>${escHtml(id)}</code></td>${cell(left,id)}${cell(right,id)}</tr>`;
    }).join("")}</tbody>
  </table></div>`;
}

function renderMechChecksDisclosure(left,right,leftLabel,rightLabel){
  const ids=new Set([
    ...(left?.checkResults||[]).map(r=>r.id||r.checkId),
    ...(right?.checkResults||[]).map(r=>r.id||r.checkId),
  ]);
  const n=ids.size;
  if(!n)return"";
  return`<details class="mech-checks-details"><summary>Show all ${n} checks</summary>${renderMechCheckTable(left,right,leftLabel,rightLabel)}</details>`;
}

function summarizeMechChanged(changed){
  let newlyPassing=0,newlyFailing=0,retired=0,other=0;
  for(const c of changed||[]){
    if(c.to==="pass"&&c.from!=="pass")newlyPassing++;
    else if(c.to==="fail"&&c.from!=="fail")newlyFailing++;
    else if(c.to==="absent")retired++;
    else other++;
  }
  return{newlyPassing,newlyFailing,retired,other,total:(changed||[]).length};
}

function renderMechChanged(changed){
  const s=summarizeMechChanged(changed);
  if(!s.total)return`<div class="mech-changed-summary">No check status changes.</div>`;
  const bits=[];
  if(s.newlyPassing)bits.push(`${s.newlyPassing} newly passing`);
  if(s.newlyFailing)bits.push(`${s.newlyFailing} newly failing`);
  if(s.retired)bits.push(`${s.retired} retired`);
  if(s.other)bits.push(`${s.other} other`);
  return`<details class="mech-changed" open>
    <summary>${s.total} checks changed${bits.length?`: ${bits.join(", ")}`:""}</summary>
    <ul>${changed.map(c=>`<li><code>${escHtml(c.checkId)}</code>: ${escHtml(c.from)} → ${escHtml(c.to)}</li>`).join("")}</ul>
  </details>`;
}

function renderMechanicalScoreResult(r){
  if(r.verification==="failed"||r.ok===false){
    return `<div class="mech-refuse">Verification failed — not a score. ${escHtml(r.error||"Fixture digest does not match declared digest.")}</div>`;
  }
  if(r.legacyIncomplete){
    return`<div class="mech-refuse">not yet checked — stored run predates category-split scores. Re-run below.</div>`;
  }
  const src=mechOutputSourceLabel(r);
  const rows=(r.checkResults||[]).map(row=>{
    const hist=row.historicalImplementation;
    const tips=[];
    if(hist)tips.push("historicalImplementation: scored with the check logic that existed on this artifact version, not today's code.");
    if(row.why)tips.push(row.why);
    const tip=tips.length?` title="${escAttr(tips.join(" "))}"`:"";
    const histLabel=hist?" · historical":"";
    const cat=row.category||"";
    let cls="";
    if(row.status==="observation"||row.tier==="advisory")cls="mech-status-observation";
    else if(row.status==="no_hit")cls="mech-status-named-hit";
    else if(row.status==="pass"||row.passed===true)cls="mech-status-pass";
    else if((row.status==="fail"||row.passed===false)&&cat==="grounding")cls="mech-status-fail-grounding";
    else if(row.status==="fail"||row.passed===false)cls="mech-status-fail-style";
    const tier=row.tier?` <span class="mech-tier">${escHtml(row.tier)}</span>`:"";
    return `<tr><td><code>${escHtml(row.id||row.checkId)}</code>${tier}${cat?` <span class="mech-cat-tag mech-cat-${escHtml(cat)}">${escHtml(cat)}</span>`:""}${row.family?` <span class="mech-fam">${escHtml(row.family)}</span>`:""}</td><td class="${cls}"${tip}>${escHtml(row.status||"")}${escHtml(histLabel)}${row.why?`<div class="mech-why">${escHtml(row.why)}</div>`:""}</td></tr>`;
  }).join("");
  return `${renderMechHeadlineCard(r,src)}
    <div class="mech-caption">Single-version score · ${escHtml(src==="unknown"?"output source not yet checked":src+" outputs")} · grounding headline · style separate</div>
    ${renderGuardrailGateLine(r.guardrailGate)}
    <div class="mech-meta">${escHtml(r.findingKind||"")} · does not feed fleet health · not written to evalHistory</div>
    <details class="mech-checks-details"><summary>Show all ${(r.checkResults||[]).length} checks</summary>
      <div class="mech-table-wrap"><table class="mech-table"><thead><tr><th>Check id</th><th>Result</th></tr></thead><tbody>${rows}</tbody></table></div>
    </details>`;
}

function renderMechanicalCompareResult(r){
  if(r.experiment==="check_coverage"){
    const left={...r.left,outputSource:r.outputSource};
    const right={...r.right,outputSource:r.outputSource};
    const delta=mechNormalizeScoreDelta(r.scoreDelta||r.groundingPassRateDelta||r.mechanicalCheckScoreDelta);
    const tooltip=[
      r.interpretation,
      delta.comparable===false?delta.reason:r.checkSetNote,
      "Grounding and style are never averaged. Coverage compares detection, not quality.",
      "This is not an eval score, does not feed fleet health, and is not written to evalHistory.",
    ].filter(Boolean).join(" ");
    const subtitle=r.coverageReading?.detail
      ||"Same output, different check sets — stronger coverage, not worse quality.";
    return`${renderMechCoverageHeadline(left,right,r.outputSource)}
      <p class="mech-subtitle">${escHtml(subtitle)}</p>
      ${renderMechQualityRefusedTile(r)}
      ${renderMechExperimentCaption(r,{experimentLabel:"Experiment A",tooltip})}
      ${renderMechChanged(r.changed)}
      ${renderMechChecksDisclosure(left,right,left.artifactVersion,right.artifactVersion)}`;
  }
  if(r.experiment==="output_quality"){
    const delta=r.scoreDelta||r.groundingPassRateDelta||r.mechanicalCheckScoreDelta;
    const isFinding=r.answersDidImprovementHelp===true&&r.findingKind==="prompt_comparison";
    const tooltip=isFinding
      ?`Experiment B live · ruler ${r.rulerVersion||""}. Same check set scores two prompt runs. Higher grounding rate is better. May answer whether the prompt change helped.`
      :`Experiment B plumbing · ruler ${r.rulerVersion||""}. Fixture comparison verifies the scoring path, not the prompts. Delta is not a finding that an improvement helped.`;
    const note=isFinding
      ?""
      :`<p class="mech-subtitle">Fixture comparison — verifies the scoring path, not the prompts. Not a finding that an improvement helped.</p>`;
    return`<div class="mech-headline-row">
        ${renderMechHeadlineCard(r.left,r.outputSource,{semantic:"quality"})}
        ${renderMechQualityDeltaChip(delta,{allowDirection:isFinding})}
        ${renderMechHeadlineCard(r.right,r.outputSource,{semantic:"quality"})}
      </div>
      ${note}
      ${renderPromotionEligibilityNote(r)}
      ${renderGuardrailGateLine(r.right?.guardrailGate||r.left?.guardrailGate)}
      ${r.checkSetsDiffer?`<div class="mech-note">${escHtml(r.checkSetNote||"Artifact check sets differ; both outputs scored with the ruler.")}</div>`:""}
      ${renderMechExperimentCaption(r,{
        experimentLabel:isFinding?"Experiment B · live":"Experiment B · plumbing",
        tooltip,
      })}
      ${renderMechChanged(r.changed)}
      ${renderMechChecksDisclosure(r.left,r.right,r.left?.artifactVersion,r.right?.artifactVersion)}`;
  }
  return `<div class="mech-refuse">${escHtml(r.note||r.error||"Unknown compare result")}</div>`;
}

async function previewMechanicalCompareUI(id){
  const box=document.getElementById("mech-compare-out");if(!box)return;
  const v=mechCompareVersions();
  box.innerHTML="Checking comparability…";
  try{
    const p=await DirectoryAPI.mechanicalComparePreview(id,v.leftVersion,v.rightVersion);
    if(p.checkSetsDiffer){
      box.innerHTML=`<div class="mech-refuse">${escHtml(p.note||"Not comparable — the check set changed between these versions")}</div>
        <div class="mech-note">Use Experiment A for coverage on one output, or Experiment B with an explicit ruler for prompt quality.</div>
        <div class="mech-meta">Left checks: ${(p.leftChecks||[]).map(c=>`<code>${escHtml(c)}</code>`).join(" ")}</div>
        <div class="mech-meta">Right checks: ${(p.rightChecks||[]).map(c=>`<code>${escHtml(c)}</code>`).join(" ")}</div>`;
    }else{
      box.innerHTML=`<div class="mech-note">Check sets match. Live output quality can use either version as ruler.</div>`;
    }
  }catch(e){box.innerHTML=`<div class="mech-refuse">${escHtml(String(e.message||e))}</div>`}
}

async function runMechanicalScoreUI(id,outputSource){
  const box=document.getElementById("mech-compare-out");if(!box)return;
  const v=mechCompareVersions();
  const src=outputSource||"canned";
  if(src==="live"&&!confirm(`Live score calls Anthropic once under ${v.scoreVersion}. Spend API budget?`)){
    box.innerHTML=`<div class="mech-meta">Live score cancelled.</div>`;
    return;
  }
  box.innerHTML=src==="live"?`Scoring ${escHtml(v.scoreVersion)} (live Anthropic call)…`:`Scoring ${escHtml(v.scoreVersion)} (canned, no paid call)…`;
  try{
    const r=await DirectoryAPI.mechanicalScore(id,{
      caseId:v.caseId,
      artifactVersion:v.scoreVersion,
      outputSource:src,
    });
    showMechResult(id,{kind:"score",source:"live_run",result:r},{persist:true});
  }catch(e){box.innerHTML=`<div class="mech-refuse">${escHtml(String(e.message||e))}</div>`}
}

async function runMechanicalCompareUI(id,experiment,outputSource){
  const box=document.getElementById("mech-compare-out");if(!box)return;
  const v=mechCompareVersions();
  const src=outputSource||"canned";
  if(src==="live"&&!confirm("Live output quality calls Anthropic twice (left prompt + right prompt). Spend API budget?")){
    box.innerHTML=`<div class="mech-meta">Live compare cancelled.</div>`;
    return;
  }
  box.innerHTML=src==="live"
    ?`Running Experiment B live (two Anthropic calls)…`
    :`Running ${experiment==="check_coverage"?"Experiment A · check coverage":"Experiment B · quality plumbing"} (canned)…`;
  try{
    const body={
      experiment,
      caseId:v.caseId,
      leftVersion:v.leftVersion,
      rightVersion:v.rightVersion,
      outputSource:src,
      ...(experiment==="output_quality"?{rulerVersion:v.rulerVersion}:{}),
    };
    const r=await DirectoryAPI.mechanicalCompare(id,body);
    showMechResult(id,{kind:"compare",source:"live_run",result:r},{persist:true});
  }catch(e){box.innerHTML=`<div class="mech-refuse">${escHtml(String(e.message||e))}</div>`}
}

async function recallContext(id){
  const inp=document.getElementById("ctx-q"),box=document.getElementById("ctx-results");
  if(!inp||!box)return;
  const q=inp.value.trim();if(!q){box.innerHTML="";return}
  box.innerHTML='<div class="ctx-empty">Recalling…</div>';
  try{
    const r=await DirectoryAPI.recallContext(id,q);
    box.innerHTML=(r.results&&r.results.length)
      ? r.results.map(x=>`<div class="ctx-hit">${typeof x.score==="number"?`<span class="ctx-score">${x.score}</span>`:""}<span>${escHtml(x.content)}</span></div>`).join("")
      : '<div class="ctx-empty">No memories matched.</div>';
  }catch(e){box.innerHTML='<div class="ctx-empty">Recall unavailable.</div>'}
}

function setFilter(t,v){if(t==="cat")state.catFilter=v;else state.statusFilter=v;render()}
function openDetail(id){state.agent=displayedAgents().find(a=>a.id===id);state.view="detail";render();window.scrollTo(0,0)}
function goBack(){state.view="list";state.agent=null;render()}
function switchSubTab(tab){state.subTab=tab;state.view="list";render()}

// ── MAINTAINER SURFACE ──
// Approver-only mutations, reachable only from inside the app.
//
// requireApprover reads a top-level `role` claim. That claim exists only on the
// named "convex" Clerk JWT template, which getToken({template:"convex"}) mints
// for a live browser session. The default __session cookie carries sub/sid/iss/
// exp and no role, which is why the Clerk CLI and the Convex dashboard both
// fail these calls. This panel is not a convenience — it is the only surface
// that can reach them.
//
// Deliberately separate from the run panel. The witnessed-run evidence row is
// written there when a human sees output; the eval result is authored HERE.
// One action must never produce both, or the separation is decorative.
//
// Ugly on purpose. Maintainer tool, not a fellow surface.

// The last preview awaiting a decision. Held in memory only: nothing is
// persisted as evidence until the human explicitly attests, so abandoning the
// tab leaves no half-state.
let maintPendingPreview=null;

const MAINT_RELEASES=[
  {key:"a7v10",label:"A7 → biocraft-singleshot-v10",method:"executeA7V10Release",
   agentId:"A7",previewVersion:"biocraft-singleshot-v10",
   digest:"f892dad7392ff31657d375d20ee532c1c2a0bcf726af4ed21ec4565ab17cfd18"},
  {key:"a10v4",label:"A10 → biocraft-gapfill-v4",method:"executeA10V4Release",
   agentId:"A10",previewVersion:"biocraft-gapfill-v4",
   digest:"a066599a997a1cbbd7de373e946b9efe44859acc8afdcad26be1b4c3c9c1cd4f"},
];

/** Why this session cannot act, naming the missing claim. Null when it can. */
function maintainerBlockReason(){
  const auth=authState();
  if(auth.status!=="signed-in")return`Not signed in (${escHtml(auth.status||"unknown")}). ${escHtml(auth.detail||"")}`;
  const u=auth.user||{};
  if(!ConvexDirectory||!ConvexDirectory.enabled)return"Convex directory is not configured in this browser session.";
  if(u.role==="approver")return null;
  const carried=Array.isArray(u.claimNames)&&u.claimNames.length?u.claimNames.join(", "):"(none decoded)";
  if(u.role===null||u.role===undefined){
    return`Your token carries no <code>role</code> claim. requireApprover needs a top-level <code>role: "approver"</code>. `+
      `Token template: <code>${escHtml(u.template||"?")}</code>. Claims present: <code>${escHtml(carried)}</code>. `+
      `Add <code>role</code> to the Clerk JWT template's custom claims, then sign out and back in.`;
  }
  return`Your token carries <code>role: "${escHtml(String(u.role))}"</code>, but requireApprover requires <code>"approver"</code>. Claims present: <code>${escHtml(carried)}</code>.`;
}

function maintOut(id,html){const el=document.getElementById(id);if(el)el.innerHTML=html}

/** Render any outcome — success or refusal — with its reason. Never silent. */
function maintResult(ok,title,detail){
  return`<div class="maint-result ${ok?"maint-ok":"maint-err"}"><strong>${escHtml(title)}</strong><pre>${escHtml(detail)}</pre></div>`;
}
function maintErrText(e){
  if(!e)return"Unknown failure with no error object.";
  const data=e.data||(e.cause&&e.cause.data)||null;
  const parts=[];
  if(data&&data.code)parts.push(`code: ${data.code}`);
  if(data&&data.status)parts.push(`status: ${data.status}`);
  parts.push(String(data&&data.message?data.message:(e.message||e)));
  return parts.join("\n");
}

async function maintRun(outId,label,fn){
  maintOut(outId,`<div class="maint-result">Running ${escHtml(label)}…</div>`);
  try{
    const r=await fn();
    maintOut(outId,maintResult(true,`${label} — OK`,JSON.stringify(r,null,2)));
  }catch(e){
    maintOut(outId,maintResult(false,`${label} — REFUSED`,maintErrText(e)));
  }
}

async function maintAuditFossils(){
  await maintRun("maint-fossil-out","listServicePromotionViolations",
    ()=>ConvexDirectory.listServicePromotionViolations());
}
async function maintBackfillFossils(){
  await maintRun("maint-fossil-out","backfillServicePromotionEligibility",
    ()=>ConvexDirectory.backfillServicePromotionEligibility({}));
}
async function maintRelease(key){
  const spec=MAINT_RELEASES.find(r=>r.key===key);if(!spec)return;
  const input=document.getElementById(`maint-digest-${key}`);
  const digest=input?input.value.trim():"";
  if(!digest){maintOut("maint-release-out",maintResult(false,`${spec.label} — NOT SENT`,"No manifest digest entered. The mutation seals on this value; sending an empty one would just 403."));return}
  await maintRun("maint-release-out",spec.label,()=>ConvexDirectory[spec.method](digest));
}
/** Render evidence provenance so a preview is never mistaken for production. */
function maintExecutionKindLabel(kind){
  if(kind==="candidate-preview")return`<span class="maint-kind maint-kind-preview">CANDIDATE PREVIEW — not a run any fellow received</span>`;
  if(kind==="production")return`<span class="maint-kind">production run</span>`;
  return`<span class="maint-kind maint-kind-unknown">execution kind not recorded (legacy row — treat as production)</span>`;
}

async function maintPreviewCandidate(key){
  const spec=MAINT_RELEASES.find(r=>r.key===key);if(!spec)return;
  const versionInput=document.getElementById(`maint-preview-version-${key}`);
  const digestInput=document.getElementById(`maint-preview-digest-${key}`);
  const artifactVersion=versionInput?versionInput.value.trim():"";
  const candidateDeclaredDigest=digestInput?digestInput.value.trim():"";
  if(!artifactVersion||!candidateDeclaredDigest){
    maintOut("maint-preview-out",maintResult(false,`${spec.label} preview — NOT SENT`,"artifactVersion and the candidate's declared artifact digest are both required. The fixture is verified against that digest at run time; without it there is nothing to verify against."));
    return;
  }
  maintPendingPreview=null;
  maintOut("maint-preview-out",`<div class="maint-result">Previewing ${escHtml(artifactVersion)}… this is a real model call and costs real money.</div>`);
  try{
    const srcEl=document.getElementById(`maint-preview-source-${key}`);
    const sourceMaterial=srcEl?srcEl.value.trim():"";
    const fellowEl=document.getElementById(`maint-preview-fellow-${key}`);
    const fellowName=fellowEl?fellowEl.value.trim():"";
    if(sourceMaterial&&!fellowName){
      maintOut("maint-preview-out",maintResult(false,`${spec.label} preview — NOT SENT`,"Pasting source needs a fellow name. Without one the draft would be generated under the fixture's fellow, which is a misattributed preview."));
      return;
    }
    const r=await DirectoryAPI.previewCandidate(spec.agentId,{artifactVersion,candidateDeclaredDigest,...(sourceMaterial?{sourceMaterial,fellowName}:{})});
    maintPendingPreview={
      agentId:spec.agentId,
      artifactDigest:r.artifactDigest,
      artifactVersion:r.artifactVersion,
      previewSourceKind:r.previewSourceKind,
      blockingCheckIds:(r.blockingFailures||[]).map(b=>b.checkId),
      attestable:r.attestable!==false,
      cost:(typeof r.costUsd==="number")?{
        amountUsd:r.costUsd,provider:r.provider,modelId:r.modelId,
        inputTokens:r.inputTokens,outputTokens:r.outputTokens,
      }:null,
    };
    const spend=r.costRecorded
      ?`Cost $${escHtml(String(r.costUsd))} recorded on trace ${escHtml(String(r.traceId))} before you decide anything.`
      :`COST NOT RECORDED${typeof r.costUsd==="number"?` ($${escHtml(String(r.costUsd))} spent)`:" (model is unpriced)"} — the spend happened but is not on a trace.`;
    const checkRows=(r.checkResults||[]).map(c=>
      `<div class="maint-check maint-check-${escHtml(c.status)}">${escHtml(c.tier)} · ${escHtml(c.checkId)} · <strong>${escHtml(c.status)}</strong>${c.why?` — ${escHtml(c.why)}`:""}</div>`).join("");
    const blocked=(r.blockingFailures||[]);
    const verdict=blocked.length
      ? `<div class="maint-result maint-err"><strong>NOT ATTESTABLE — ${blocked.length} blocking check failure(s)</strong>
         <div>${blocked.map(b=>escHtml(`${b.tier} · ${b.checkId}`)).join("<br>")}</div>
         <div>Recording evidence is refused. If a check is wrong about this draft, say why and override deliberately — the reason is recorded on the evidence row.</div>
         <div class="maint-row"><input id="maint-override-reason" size="70" placeholder="why this check is wrong about this draft">
         <button data-maint="attest-preview">Override and record evidence</button>
         <button data-maint="discard-preview">Discard</button></div></div>`
      : `<div class="maint-row"><button data-maint="attest-preview">Record witnessed evidence</button>
         <button data-maint="discard-preview">Discard — do not attest</button></div>`;
    maintOut("maint-preview-out",
      `<div class="maint-result ${blocked.length?"maint-err":"maint-ok"}"><strong>${escHtml(spec.label)} preview — ${blocked.length?"CHECKS FAILED":"OK"}</strong>
       <div>${maintExecutionKindLabel("candidate-preview")}</div>
       <div>Source: <strong>${escHtml(r.previewSourceKind==="pasted-source"?"pasted material":"synthetic golden fixture")}</strong>${r.caseId?` (${escHtml(r.caseId)})`:""}</div>
       <div>Checks (${escHtml(String((r.checkResults||[]).length))}, set <code>${escHtml(String(r.checkSetId||"").slice(0,12))}</code>): grounding ${escHtml(String(r.groundingPassRate))} · style ${escHtml(String(r.stylePassRate))}</div>
       ${checkRows}
       <div>Executed fixture digest <code>${escHtml(String(r.artifactDigest).slice(0,12))}</code>, verified against the candidate's declared digest at run time.</div>
       <div>${spend}</div>
       <div>No evidence has been recorded. Read the output; attest only if it is fit to release.</div>
       <pre>${escHtml(String(r.output||""))}</pre>
       ${verdict}</div>`);
  }catch(e){
    maintOut("maint-preview-out",maintResult(false,`${spec.label} preview — REFUSED`,maintErrText(e)));
  }
}

async function maintAttestPreview(){
  if(!maintPendingPreview){
    maintOut("maint-attest-out",maintResult(false,"Record witnessed evidence — NOT SENT","No preview is awaiting a decision. Run a preview first; evidence must attest output you actually read."));
    return;
  }
  const p=maintPendingPreview;
  const reasonEl=document.getElementById("maint-override-reason");
  const overrideReason=reasonEl?reasonEl.value.trim():"";
  if(p.blockingCheckIds&&p.blockingCheckIds.length&&!overrideReason){
    maintOut("maint-attest-out",maintResult(false,"Record witnessed evidence — NOT SENT",
      `${p.blockingCheckIds.join(", ")} failed. Attesting is refused without a stated reason. Say why the check is wrong about this draft, or discard.`));
    return;
  }
  await maintRun("maint-attest-out","recordCandidatePreviewEvidence",
    ()=>ConvexDirectory.recordCandidatePreviewEvidence({
      displayId:p.agentId,artifactDigest:p.artifactDigest,
      ...(overrideReason?{overrideReason}:{}),
      ...(p.cost?{cost:p.cost}:{}),
    }));
  maintPendingPreview=null;
}

function maintDiscardPreview(){
  const had=Boolean(maintPendingPreview);
  maintPendingPreview=null;
  maintOut("maint-attest-out",maintResult(true,"Preview discarded",
    had
      ?"No evidence was recorded. The candidate cannot promote without it, the proposal stays open, and the pointer has not moved. The preview's cost remains on its trace — the money was spent."
      :"There was no pending preview to discard."));
}

async function maintApprove(){
  const el=document.getElementById("maint-proposal-id");
  const id=el?el.value.trim():"";
  if(!id){maintOut("maint-approve-out",maintResult(false,"approve — NOT SENT","No proposalId entered."));return}
  await maintRun("maint-approve-out","reviews.approve",()=>ConvexDirectory.approveProposal(id));
}
async function maintCreateEvalSet(){
  const g=(k)=>{const el=document.getElementById(k);return el?el.value.trim():""};
  const agentId=g("maint-es-agent"),name=g("maint-es-name"),version=Number(g("maint-es-version")||"1");
  const criteria=g("maint-es-rubric").split("\n").map(l=>l.trim()).filter(Boolean);
  if(!agentId||!name||!criteria.length){
    maintOut("maint-eval-out",maintResult(false,"createEvalSet — NOT SENT","agentId, name, and at least one rubric criterion are required. A rubric with no criteria could only produce an eval result that names nothing."));return;
  }
  await maintRun("maint-eval-out","createEvalSet",()=>ConvexDirectory.createEvalSet({
    agentId,name,version,status:"draft",
    rubric:criteria.map(c=>{const [id,...rest]=c.split("|");return{id:id.trim(),label:(rest.join("|")||id).trim(),maxScore:1,conditional:false}}),
    guardrails:[{id:"no-secrets",label:"Contains no secrets"}],
  }));
}
async function maintCreateEvalCase(){
  const g=(k)=>{const el=document.getElementById(k);return el?el.value.trim():""};
  const evalSetId=g("maint-ec-set"),name=g("maint-ec-name"),fixtureRef=g("maint-ec-ref");
  if(!evalSetId||!name||!fixtureRef){maintOut("maint-eval-out",maintResult(false,"createEvalCase — NOT SENT","evalSetId, name, and fixtureRef are required."));return}
  await maintRun("maint-eval-out","createEvalCase",()=>ConvexDirectory.createEvalCase({
    evalSetId,name,fixtureRef,declaredFixtureDigest:g("maint-ec-digest")||"maintainer-authored",
  }));
}
async function maintRecordEvalResult(){
  const g=(k)=>{const el=document.getElementById(k);return el?el.value.trim():""};
  const evalSetId=g("maint-er-set"),evalCaseId=g("maint-er-case"),
        agentVersionId=g("maint-er-version"),evidenceId=g("maint-er-evidence");
  const scored=g("maint-er-criteria").split("\n").map(l=>l.trim()).filter(Boolean).map(l=>{
    const [id,score]=l.split("=").map(x=>(x||"").trim());
    return{criterionId:id,result:{kind:"score",score:Number(score||"1")}};
  });
  if(!evalSetId||!evalCaseId||!agentVersionId||!evidenceId){
    maintOut("maint-eval-out",maintResult(false,"recordEvalResult — NOT SENT","evalSetId, evalCaseId, agentVersionId, and evidenceId are all required."));return;
  }
  if(!scored.length){
    // Convex refuses this too (EVAL_RESULT_NAMES_NOTHING). Saying so here costs
    // nothing and explains the rule before the round trip.
    maintOut("maint-eval-out",maintResult(false,"recordEvalResult — NOT SENT","No criterion scored. An eval result must NAME WHAT WAS CHECKED — Convex refuses an empty or all-N/A set with EVAL_RESULT_NAMES_NOTHING."));return;
  }
  await maintRun("maint-eval-out","recordEvalResult",()=>ConvexDirectory.recordEvalResult({
    evalSetId,evalCaseId,agentVersionId,evidenceId,
    criterionResults:scored,
    guardrailResults:[{guardrailId:"no-secrets",passed:true}],
  }));
}

function maintainerPanelHtml(){
  const blocked=maintainerBlockReason();
  const head=`<h2>Maintainer — release surface</h2>
    <p class="maint-note">Approver-only Convex mutations. These are unreachable from the Clerk CLI or the Convex dashboard: <code>requireApprover</code> reads a top-level <code>role</code> claim carried only by the named <code>convex</code> JWT template, which only a live browser session can mint. The witnessed-run evidence row is written on the run panel; the eval result is authored here. Two acts, two surfaces, on purpose.</p>`;
  if(blocked){
    return`<div class="maint">${head}<div class="maint-result maint-err"><strong>Cannot act as approver</strong><div>${blocked}</div></div></div>`;
  }
  const rel=MAINT_RELEASES.map(r=>`<div class="maint-row">
      <label>${escHtml(r.label)} — releaseManifestDigest</label>
      <input id="maint-digest-${r.key}" value="${escHtml(r.digest)}" size="70">
      <button data-maint-release="${r.key}">Execute release</button>
    </div>`).join("");
  return`<div class="maint">${head}
  <fieldset><legend>1 · Fossil audit + backfill</legend>
    <button data-maint="audit-fossils">List service+promotion violations</button>
    <button data-maint="backfill-fossils">Backfill to eligibleForPromotion:false</button>
    <div id="maint-fossil-out"></div></fieldset>
  <fieldset><legend>2 · Releases (creates candidate + open proposal; does NOT move the pointer)</legend>
    ${rel}<div id="maint-release-out"></div></fieldset>
  <fieldset><legend>3 · Preview the candidate (real model call, real cost)</legend>
    <p class="maint-note">Executes the candidate's pinned fixture from <code>eval-artifacts/</code>, which fellows never receive. The fixture is verified against the candidate's declared digest at run time. Nothing is attested until you say so.</p>
    ${MAINT_RELEASES.map(r=>`<div class="maint-row">
      <label>${escHtml(r.label)}</label>
      <input id="maint-preview-version-${r.key}" value="${escHtml(r.previewVersion)}" size="28">
      <input id="maint-preview-digest-${r.key}" placeholder="candidate declared artifact digest" size="68">
      <input id="maint-preview-fellow-${r.key}" size="28" placeholder="fellow name (required when pasting)">
      <textarea id="maint-preview-source-${r.key}" rows="3" cols="70" placeholder="paste real source material — leave blank to fall back to the synthetic golden fixture"></textarea>
      <button data-maint-preview="${r.key}">Preview</button>
    </div>`).join("")}
    <div id="maint-preview-out"></div><div id="maint-attest-out"></div></fieldset>
  <fieldset><legend>4 · Eval set / case</legend>
    <div class="maint-row"><label>agentId (Convex id)</label><input id="maint-es-agent" size="40">
      <label>name</label><input id="maint-es-name" size="24">
      <label>version</label><input id="maint-es-version" value="1" size="4"></div>
    <div class="maint-row"><label>rubric — one per line, <code>id|label</code></label>
      <textarea id="maint-es-rubric" rows="3" cols="60">grounding|No claim unsupported by the source</textarea>
      <button data-maint="create-eval-set">Create eval set</button></div>
    <div class="maint-row"><label>evalSetId</label><input id="maint-ec-set" size="40">
      <label>case name</label><input id="maint-ec-name" size="24">
      <label>fixtureRef</label><input id="maint-ec-ref" size="30">
      <label>fixture digest</label><input id="maint-ec-digest" size="24">
      <button data-maint="create-eval-case">Create eval case</button></div></fieldset>
  <fieldset><legend>5 · Eval result — must name what was checked</legend>
    <div class="maint-row"><label>evalSetId</label><input id="maint-er-set" size="40">
      <label>evalCaseId</label><input id="maint-er-case" size="40"></div>
    <div class="maint-row"><label>agentVersionId</label><input id="maint-er-version" size="40">
      <label>evidenceId (from the witnessed run)</label><input id="maint-er-evidence" size="40"></div>
    <div class="maint-row"><label>criteria scored — one per line, <code>criterionId=score</code></label>
      <textarea id="maint-er-criteria" rows="3" cols="60">grounding=1</textarea>
      <button data-maint="record-eval-result">Record eval result</button></div>
    <div id="maint-eval-out"></div></fieldset>
  <fieldset><legend>6 · Approve — moves currentApprovedVersionId</legend>
    <div class="maint-row"><label>proposalId</label><input id="maint-proposal-id" size="40">
      <button data-maint="approve">reviews.approve</button></div>
    <div id="maint-approve-out"></div></fieldset>
  </div>`;
}

if(typeof document!=="undefined"){
  document.addEventListener("click",(ev)=>{
    const t=ev.target;
    if(!t||typeof t.closest!=="function")return;
    const rel=t.closest("[data-maint-release]");
    if(rel){ev.preventDefault();void maintRelease(rel.getAttribute("data-maint-release"));return}
    const prev=t.closest("[data-maint-preview]");
    if(prev){ev.preventDefault();void maintPreviewCandidate(prev.getAttribute("data-maint-preview"));return}
    const btn=t.closest("[data-maint]");
    if(!btn)return;
    ev.preventDefault();
    const action=btn.getAttribute("data-maint");
    if(action==="audit-fossils")void maintAuditFossils();
    else if(action==="backfill-fossils")void maintBackfillFossils();
    else if(action==="create-eval-set")void maintCreateEvalSet();
    else if(action==="create-eval-case")void maintCreateEvalCase();
    else if(action==="record-eval-result")void maintRecordEvalResult();
    else if(action==="attest-preview")void maintAttestPreview();
    else if(action==="discard-preview")maintDiscardPreview();
    else if(action==="approve")void maintApprove();
  });
  window.addEventListener("hashchange",()=>render());
}

// ── BOOT ──
render();
if(window.DirectoryAuth&&typeof DirectoryAuth.subscribe==="function"){
  // Clerk republishes on every session/token refresh. Redrawing the whole page
  // on those wipes the in-DOM run panel. Only re-render when identity materially
  // changes (sign-in, sign-out, or a different signed-in user). Subject is not
  // published on the auth state; display name is the identity proxy we have.
  function authIdentityKey(auth){
    if(!auth)return"unknown";
    if(auth.status==="signed-in")return`signed-in:${(auth.user&&auth.user.name)||""}`;
    return String(auth.status||"unknown");
  }
  let lastAuthIdentity=authIdentityKey(authState());
  DirectoryAuth.subscribe((next)=>{
    const key=authIdentityKey(next);
    if(key===lastAuthIdentity)return;
    lastAuthIdentity=key;
    void loadConvexRequests().then(()=>render());
  });
  if(DirectoryAuth.ready&&typeof DirectoryAuth.ready.then==="function"){
    DirectoryAuth.ready.then(()=>loadConvexRequests()).then(()=>render());
  }
}
// Convex is the only catalogue source. Pending and failed reads are rendered as
// explicit states; neither may fall back to browser seed data.
loadGovernedDirectoryPilot();
// The probe resolves after the first render — refresh the automations panel then.
if(window.DirectoryAPI)DirectoryAPI.ready.then(()=>{
  loadRailwayProposalOverlay();
  if(state.view==="list"&&state.subTab==="agents")loadAutomations();
  // Re-load capability once the probe has resolved — first paint may have
  // rendered the detail view before DirectoryAPI.enabled was true.
  if(state.view==="detail"&&state.agent)loadRunCapability(state.agent.id);
});
