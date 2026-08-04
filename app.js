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

  {id:"A7",name:"Biocraft single-shot draft",tagline:"A stateless text-only draft mode inspired by /biocraft. It requires all source material up front and has no Chrome or Drive tools.",description:"This is not the full /biocraft agent. It makes one Anthropic call with no conversation state, browser tools, Drive tools, or HTML rendering.",platform:"Claude",status:"Experimental",category:"Personal Branding",owner:"Sarah",initials:"SA",model:"Claude Sonnet 4.6",version:"1.0",
    objective:"Draft a LinkedIn About bio, spoken event introduction, and headline from complete source material supplied in one request.",
    successCriteria:["LinkedIn About hook is 200 characters or fewer","Full LinkedIn About text is 2,600 characters or fewer","Suggested LinkedIn headline is 220 characters or fewer","Spoken event introduction reads aloud in 20 to 30 seconds"],
    guardrails:["Never fabricate or alter a metric, achievement, employer relationship, credential, quote, role, or job title.","Distinguish work done for a company from founding or owning that company.","Preserve qualifiers such as Intern, Participant, and Apprenticeship.","Do not use an em dash or a double hyphen as an em-dash substitute.","Do not use emoji, exclamation points, hedging, or unnecessary passive voice.","Remove AI cliche and these terms on sight: utilize, leverage, facilitate, innovative, robust, seamless, cutting-edge, unlock, elevate, passionate, synergy, game-changer, revolutionize, revolutionary.","Do not use \"it is not X, it is Y\" contrast framing.","Do not report or annotate character counts. The host validates limits; a model-generated count is not evidence.","If a supplied quote is not grounded clearly enough to attribute, omit it.","Do not add a CTA to the third-person event introduction. The required CTA belongs only in the LinkedIn About."],
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
    accessUrl:"",repoUrl:"https://github.com/aiden150/ux-qa-agent",evalHistory:[],
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
// on Railway's agent row, is read back explicitly from Railway, and cannot be
// approved here because approval bumps the divergent Railway catalog version.
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
const APPROVAL_LOCK_REASON="Approval stays locked during the pilot because it bumps the Railway catalog version while Convex is the displayed authority. You may reject this reversible loop-service proposal.";
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
  return `<div class="write-lock-banner"><strong>Convex is the catalogue authority.</strong> Signed-in registration, edits and requests write there directly; browser-storage fallbacks are removed. Runs, trace feedback, loop proposals, queue and learnings remain live in the loop service; proposal approval and manual eval logging remain locked. ${escHtml(AUTOMATION_LIVE_NOTE)}</div>`;
}
function lockedControl(label,reason,cls){
  const classes=cls||"btn";
  return `<span class="locked-control"><button class="${classes}" disabled aria-disabled="true">${escHtml(label)}</button><span class="locked-control-reason">${escHtml(reason)}</span></span>`;
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
const PLATFORMS=["Claude","Codex","Cursor","Manus","ChatGPT","n8n","Custom","Other"];
const STATUS_OPTIONS=["Experimental","Active","Under Review","Deprecated"];
const EVAL_OPTIONS=["Not evaluated","Performing well","Needs improvement","Under review"];
const REQ_STATUSES=["Requested","Approved","In Progress","Shipped","Declined"];
const PRIORITIES=["Nice to have","Important","Urgent"];

let state={view:"list",subTab:"agents",agent:null,catFilter:"All",statusFilter:"All",modal:null,editingAgent:null};

// ── HELPERS ──
function statusClass(s){return{Active:"pill-active",Experimental:"pill-experimental",Deprecated:"pill-deprecated","Under Review":"pill-amber"}[s]||"pill-neutral"}
function evalClass(s){return{"Performing well":"pill-green","Needs improvement":"pill-amber","Under review":"pill-blue"}[s]||"pill-grey"}
function platformIcon(p){return{Claude:"◈",Cursor:"▣",Manus:"◉",ChatGPT:"◎"}[p]||"◇"}
function reqStatusClass(s){return{Requested:"pill-neutral",Approved:"pill-blue","In Progress":"pill-purple",Shipped:"pill-green",Declined:"pill-grey"}[s]||"pill-neutral"}
function priorityClass(p){return{Urgent:"pill-amber",Important:"pill-neutral","Nice to have":"pill-grey"}[p]||"pill-grey"}
function getInitials(name){return name.split(" ").map(w=>w[0]).join("").toUpperCase().slice(0,2)}
function autonomyLabel(l){return{L0:"assist only",L1:"suggest + confirm",L2:"act narrow + audit",L3:"act broad",L4:"autonomous"}[l]||"suggest + confirm"}
function escHtml(s){return s?String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"):""}
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
  toast(APPROVAL_LOCK_REASON);
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
  if(isReadOnlyRecord(a))return `<span class="eval-title-actions"><button class="btn-ghost btn-sm" onclick="proposeImprovement('${a.id}')">Propose improvement</button>${lockedControl("Log eval",EVAL_LOCK_REASON,"btn-ghost btn-sm")}</span>`;
  return `<span class="eval-title-actions"><button class="btn-ghost btn-sm" onclick="proposeImprovement('${a.id}')">Propose improvement</button><button class="btn-ghost btn-sm" onclick="openModal('eval',agents.find(x=>x.id==='${a.id}'))">Log eval</button></span>`;
}
function renderEmptyEval(a){
  if(isReadOnlyRecord(a)){
    return `<div class="empty-eval"><p>This agent hasn't been evaluated yet.</p><div class="locked-inline-reason">${escHtml(EVAL_LOCK_REASON)}</div></div>`;
  }
  return `<div class="empty-eval"><p>This agent hasn't been evaluated yet.</p><div class="cta" onclick="openModal('eval',agents.find(x=>x.id==='${a.id}'))">Log the first evaluation &rarr;</div></div>`;
}
function renderGovernedIdentity(a){
  if(!(isGovernedPilot(a)&&a.convexGovernance))return"";
  const g=a.convexGovernance,artifact=g.artifact,sourcePin=g.sourcePin;
  return `<div class="section governed-identity">
    <div class="section-title">Governed identity</div>
    <div class="section-body">
      <div><strong>Version:</strong> ${escHtml(a.version||"not recorded")}${g.versionState?` · ${escHtml(g.versionState)}`:""}</div>
      <div><strong>Runner:</strong> ${escHtml(g.runner||"not recorded")}</div>
      <div><strong>Invocation:</strong> ${escHtml(g.invocationType||"not recorded")}</div>
      <div><strong>Usability:</strong> ${g.usabilityModes&&g.usabilityModes.length?escHtml(g.usabilityModes.join(", ")):"not recorded"}</div>
      ${artifact?`<div><strong>Artifact SHA-256:</strong> <code>${escHtml(artifact.digest)}</code></div><div><strong>Artifact locator:</strong> ${escHtml(artifact.locator)}</div>`:""}
      ${sourcePin?`<div><strong>Git commit source pin:</strong> <code>${escHtml(sourcePin.commitSha)}</code></div><div class="governed-caveat">Source pin only — not an artifact-content digest.</div>`:""}
    </div>
  </div>`;
}

function renderProposalAttempt(a){
  const attempt=a&&a.latestProposalAttempt;
  if(!attempt)return"";
  if(attempt.outcome==="maker-refused-no-evidence")return `<div class="proposal-attempt proposal-attempt-refused"><strong>Maker produced no proposal.</strong> It refused because no eligible defect evidence was available (${escHtml(String(attempt.failingTraces||0))} failing trace(s), ${escHtml(String(attempt.feedbackWithNotes||0))} feedback note(s)).</div>`;
  if(attempt.outcome==="verifier-rejected")return `<div class="proposal-attempt proposal-attempt-rejected"><strong>Verifier rejected a proposal.</strong> The retained proposal below includes its checker verdict and can be reopened for human review.</div>`;
  if(attempt.outcome==="reopened-for-human-review")return `<div class="proposal-attempt"><strong>Proposal reopened for human review.</strong> The verifier's earlier rejection remains on the proposal as context.</div>`;
  return"";
}
function renderProposalCard(a,p,index,total){
  const approveLabel=`Record approval → catalog v${bumpVersion(a.version)}`;
  const hasChange=Array.isArray(p.changes)&&p.changes.length===1;
  const autoRejected=p.status==="rejected"&&p.autoRejection&&p.autoRejection.by==="verifier";
  return `<div class="loop-card${autoRejected?" loop-card-auto-rejected":""}">
    <div class="loop-head"><span class="loop-badge">● ${autoRejected?"AUTO-REJECTED BY VERIFIER":"IMPROVEMENT PROPOSED"}${total>1?` · ${index+1} of ${total}`:""}</span><span class="loop-src">${escHtml(p.source)} · ${formatDate(p.date)}</span></div>
    ${isGovernedPilot(a)?`<div class="railway-proposal-source"><strong>Loop-service proposal · Railway file store · pilot-only.</strong> This reversible proposal is read from Railway evidence and is not governed Convex catalog state.</div>`:""}
    <div class="loop-summary">${escHtml(p.summary)}</div>
    <div class="loop-detail">${escHtml(p.detail)}</div>
    ${renderProposalChanges(p.changes)}
    ${p.verdict?`<div class="loop-verdict"><span class="pill pill-xs ${p.verdict.verdict==="ship"?"pill-green":p.verdict.verdict==="reject"?"pill-amber":"pill-blue"}">checker: ${escHtml(p.verdict.verdict)} · ${p.verdict.confidence}</span>${(p.verdict.reasons||[]).length?`<span class="loop-verdict-why">${escHtml(p.verdict.reasons[0])}</span>`:""}</div>`:""}
    ${p.targetArtifactVersion?`<div class="loop-target">Derived against artifact <strong>${escHtml(p.targetArtifactVersion)}</strong>${p.targetArtifactDigest?` · <code>${escHtml(String(p.targetArtifactDigest).slice(0,7))}</code>`:""}.</div>`:""}
    <div class="loop-approval-notice"><strong>Approval records a review decision only.</strong> It bumps the catalog label and clears this proposal, but changes no prompt, check, runtime, or agent behavior. A human must make, verify, and commit the artifact edit separately.</div>
    <div class="loop-actions">${autoRejected?`<button class="btn btn-sm" onclick="reopenVerifierRejectedImprovement('${a.id}','${escHtml(p.id||"")}')">Re-open for human review</button>`:`${isReadOnlyRecord(a)?lockedControl(approveLabel,APPROVAL_LOCK_REASON,"btn btn-primary btn-sm"):`<button class="btn btn-primary btn-sm" onclick="approveImprovement('${a.id}','${escHtml(p.id||"")}')" ${hasChange?"":"disabled"}>${escHtml(approveLabel)}</button>`}<button class="btn btn-sm" onclick="rejectImprovement('${a.id}','${escHtml(p.id||"")}')">Reject proposal</button>`}</div>
  </div>`;
}

function renderDetail(a){
  const sopLines=(a.sop||"").split("\n").filter(Boolean);
  const e=latestEval(a);
  const prop=pendingProposalsOf(a),autoRejected=autoRejectedProposalsOf(a);
  return `<div class="detail">
    <button class="back-btn" onclick="goBack()"><span>&lsaquo;</span> Back to Directory</button>
    <div class="detail-header">
      <div class="detail-eyebrow">AGENT ${a.id} · v${escHtml(a.version||"1.0")}${a.model?" · "+escHtml(a.model):""}</div>
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
      <div class="use-hint">${hasUsabilityDefect(a)?`MISCONFIGURED: this agent has no stored usabilityModes. Edit the record before offering access.`:isSingleShotRuntime(a)?`Run, Copy as SKILL.md, evaluation, and Download use the same pinned single-shot artifact. This is not the full /biocraft agent: no Chrome, Drive, HTML rendering, or follow-up conversation.`:canHandoff(a)&&!canInstall(a)?`Prepared handoff: this agent is not installed or hosted here. The export is an engagement brief that pins the repository and commit where the agent actually lives, plus the setup checklist, prohibited actions, inputs, and how to return a result.`:needsInvokerConfiguration(a)?`${escHtml((a.invocation&&a.invocation.type)||"runtime")} execution is not configured. Use the stored prepared handoff/export path until an adapter is connected.`:`Available here: ${escHtml(a.usabilityModes.join(", "))}. The execution adapter remains ${escHtml((a.invocation&&a.invocation.type)||"link")}.`}</div>
      <div id="run-panel" class="run-panel"></div>
    </div>

    ${renderProposalAttempt(a)}
    ${prop.length?`${prop.length>1?`<div class="loop-set-note">${prop.length} separate proposals, one per defect. Each is approved or rejected on its own; deciding one leaves the others pending.</div>`:""}${prop.map((p,i)=>renderProposalCard(a,p,i,prop.length)).join("")}`:""}
    ${autoRejected.length?`<div class="loop-set-note">Verifier-rejected proposals are retained below. They are checker opinions, not human decisions.</div>${autoRejected.map((p,i)=>renderProposalCard(a,p,i,autoRejected.length)).join("")}`:""}

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
      <div class="eval-pill-row"><span class="pill ${evalClass(agentEvalStatus(a))}">${e&&typeof e.score==="number"?e.score+" · ":""}${escHtml(agentEvalStatus(a))}</span>${e?`<span class="date">Last reviewed: ${formatDate(e.date)}${e.by?" · "+escHtml(e.by):""}</span>`:""}</div>
      ${a.evalHistory&&a.evalHistory.length?`<div class="eval-history">${a.evalHistory.slice().reverse().map(h=>`
        <div class="eval-row">
          <div class="eval-row-top"><span class="pill ${evalClass(h.status)} pill-xs">${escHtml(h.status)}</span>${typeof h.score==="number"?`<span class="eval-score">${h.score}</span>`:""}<span class="eval-date">${formatDate(h.date)}${h.by?" · "+escHtml(h.by):""}</span>${h.traceUrl?`<a class="eval-trace" href="${escHtml(h.traceUrl)}">trace ↗</a>`:""}</div>
          ${h.notes?`<div class="eval-note">${escHtml(h.notes)}</div>`:""}
          ${h.knownIssues?`<div class="eval-issue"><b>Known issues:</b> ${escHtml(h.knownIssues)}</div>`:""}
        </div>`).join("")}</div>`:renderEmptyEval(a)}
    </div>

    ${a.changelog&&a.changelog.length?`<div class="section"><div class="section-title">Version history</div><div class="section-body">${a.changelog.slice().reverse().map(c=>`<div class="change-row"><span class="change-ver">v${escHtml(c.version)}</span><span class="change-date">${formatDate(c.date)}</span><span class="change-note">${escHtml(c.note)}</span></div>`).join("")}</div></div>`:""}

    <button class="contact-btn">&#x1F4AC; Message ${escHtml(a.owner)} on Slack</button>
  </div>`;
}

function render(){
  renderAuthSurface();
  const app=document.getElementById("app");
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
async function loadAutomations(){
  const el=document.getElementById("automations");
  if(!el||!(window.DirectoryAPI&&DirectoryAPI.enabled))return;
  try{
    const [inbox,runs,learn,queue]=await Promise.all([DirectoryAPI.loopInbox(),DirectoryAPI.loopRuns(1),DirectoryAPI.loopLearnings(4),DirectoryAPI.loopQueue()]);
    const last=runs.runs&&runs.runs[0];
    const items=inbox.inbox||[];
    const learnings=(learn&&learn.learnings)||[];
    const q=(queue&&queue.queue)||[];
    const openq=q.filter(x=>x.status==="open"||x.status==="in-progress").slice(0,5);
    const vClass=v=>v==="ship"?"pill-green":v==="reject"?"pill-amber":"pill-blue";
    const sClass=s=>s==="open"?"pill-blue":s==="in-progress"?"pill-purple":s==="blocked"?"pill-amber":"pill-green";
    el.innerHTML=`
      <div class="auto-head">
        <div><span class="auto-title">◷ Automations</span><span class="auto-sub">${last?`last cycle ${formatDate(last.ts)} · scanned ${last.scanned} · improved ${last.selected} · $${last.budget.spentUsd}${last.queue?` · queue ${last.queue.open} open`:""}`:"heartbeat idle — run a cycle to discover + improve"}</span></div>
        <button class="btn btn-sm btn-primary" onclick="runLoopNow(this)">Run automations now</button>
      </div>
      <div class="auto-live-note">${escHtml(AUTOMATION_LIVE_NOTE)}</div>
      ${openq.length?`<div class="auto-queue"><div class="auto-inbox-title">Research queue <span class="auto-sub2">discover → improve</span><span class="count-badge">${q.filter(x=>x.status==="open").length}</span></div>${openq.map(x=>`<div class="auto-item"><span class="rq-score" title="score 1–3">${x.score}</span><span class="auto-agent">${escHtml(x.agentId)}</span><span class="auto-summary">${escHtml(x.title)}</span><span class="pill pill-xs ${sClass(x.status)}">${escHtml(x.status)}</span></div>`).join("")}</div>`:""}
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
  try{const r=await DirectoryAPI.runLoop();toast(`Cycle: scanned ${r.scanned}, ${r.jobs.length} job(s) run, $${r.budget.spentUsd} spent`)}
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
function invocationTier(a){return hasUsabilityDefect(a)?"misconfigured":a.usabilityModes.join(" + ")}
function slug(s){return String(s).toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")}

// Capability (including the server-owned input contract) for the open detail
// view. The run form is built from this, never from the editable inputs[]
// labels on the record — renaming a label must not break the run.
const runCapabilities={};
const GOVERNED_RUNTIME_MISMATCH="Runtime version does not match the governed version. Deployment or approval is incomplete.";
function capabilityIdentityMatches(a,capability){
  const governance=a&&a.convexGovernance;
  if(!governance)return false;
  if(hasUsabilityMode(a,"hosted-run")||canInstall(a)){
    const expected=governance.artifact;
    const actual=capability&&capability.installArtifact;
    if(!governance.isCurrentApproved||!expected||!actual||actual.available!==true)return false;
    if(actual.artifactVersion!==a.version)return false;
    if(actual.artifactDigestAlgorithm!==expected.algorithm)return false;
    if(actual.artifactDigest!==expected.digest)return false;
  }
  if(canHandoff(a)){
    const expected=governance.sourcePin;
    const actual=capability&&capability.handoff;
    if(!expected||!actual||actual.available!==true)return false;
    if(actual.commitSha!==expected.commitSha||actual.repoUrl!==expected.repoUrl)return false;
  }
  return true;
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
    if(!capabilityIdentityMatches(a,capability)){
      delete runCapabilities[id];
      showCapabilityFailure(a,{slot,installSlot,handoffSlot},GOVERNED_RUNTIME_MISMATCH);
      return;
    }
    capability.governedIdentityMatched=true;
    runCapabilities[id]=capability;
    if(slot&&hasUsabilityMode(a,"hosted-run")){
      if(capability.serverRun&&capability.artifactAvailable&&capability.configured&&capability.runnable)slot.innerHTML=`<button class="btn btn-sm btn-primary" onclick="toggleRun('${id}')">&#9654; ${capability.mode==="single-shot"?"Run single-shot draft":"Run here"}</button>`;
      else if(!capability.configured)slot.innerHTML=`<span class="run-unavailable">${escHtml(capability.unavailableReason||"Runtime unavailable")}</span>`;
    }
    // download-install: only a pinned server-owned artifact is installable.
    // With none registered there is no client-side substitute to fall back to.
    if(installSlot&&canInstall(a)){
      const install=capability.installArtifact;
      if(install&&install.available)installSlot.innerHTML=`<button class="btn btn-sm" onclick="copyInstallSkill('${id}')">Copy single-shot SKILL.md</button><button class="btn btn-sm" onclick="downloadInstallArtifact('${id}')">Download single-shot (.zip)</button><span class="artifact-pin"><strong>${escHtml(install.artifactVersion)}</strong> · ${escHtml(install.artifactDigestAlgorithm)}:<code>${escHtml(install.artifactDigest)}</code></span>`;
      else installSlot.innerHTML=`<span class="run-unavailable">No pinned installable artifact is registered for this agent, so there is nothing to install. The summary above is a description of the record, not the agent.</span>`;
    }
    // prepared-handoff: a briefing, never a generated skill file.
    if(handoffSlot&&canHandoff(a)){
      const handoff=capability.handoff;
      if(handoff&&handoff.available)handoffSlot.innerHTML=`<button class="btn btn-sm" onclick="copyHandoffBriefing('${id}')">Copy engagement brief</button><span class="artifact-pin">The agent lives at <a href="${escHtml(handoff.repoUrl)}" target="_blank" rel="noopener">${escHtml(handoff.repoUrl)}</a> · <strong>${escHtml(handoff.briefVersion)}</strong> · commit <code>${escHtml(handoff.commitSha)}</code></span>`;
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
  if(runCapabilities[id]?.governedIdentityMatched!==true){toast(GOVERNED_RUNTIME_MISMATCH);return}
  try{
    const brief=await DirectoryAPI.handoffBriefing(id);
    copyText(brief.content,`Engagement brief copied · ${brief.briefVersion} · commit ${String(brief.commitSha).slice(0,7)}`);
  }catch(e){toast(`Briefing unavailable: ${String(e.message||e)}`)}
}
async function copyInstallSkill(id){
  if(runCapabilities[id]?.governedIdentityMatched!==true){toast(GOVERNED_RUNTIME_MISMATCH);return}
  try{
    const artifact=await DirectoryAPI.installSkill(id);
    copyText(artifact.content,`Single-shot SKILL.md copied · ${artifact.artifactVersion}`);
  }catch(e){toast(`Single-shot export failed: ${String(e.message||e)}`)}
}
async function downloadInstallArtifact(id){
  if(runCapabilities[id]?.governedIdentityMatched!==true){toast(GOVERNED_RUNTIME_MISMATCH);return}
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
function toggleRun(id){
  const a=agents.find(x=>x.id===id);const box=document.getElementById("run-panel");if(!a||!box)return;
  if(box.innerHTML){box.innerHTML="";return}
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
async function runAgentUI(id){
  const box=document.getElementById("run-out");if(!box)return;
  if(runCapabilities[id]?.governedIdentityMatched!==true){box.innerHTML=`<div class="run-status run-err">${escHtml(GOVERNED_RUNTIME_MISMATCH)}</div>`;return}
  const inputs={};document.querySelectorAll("#run-panel [data-k]").forEach(el=>{if(el.value.trim())inputs[el.getAttribute("data-k")]=el.value.trim()});
  box.innerHTML='<div class="run-status">Running…</div>';
  try{
    const r=await DirectoryAPI.runAgent(id,inputs);
    const cap=runCapabilities[id]||{};
    const notesBox=cap.feedbackNotes===false?"":`<label class="run-feedback-notes-label" for="run-feedback-notes">Why this rating — what was wrong or right</label><textarea id="run-feedback-notes" class="run-feedback-notes" maxlength="${Number(cap.feedbackNotesMaxChars)||2000}" placeholder="Specific defects, fabrications, or things it got right."></textarea>`;
    const feedback=r.tracePersisted&&r.traceId?`<div class="run-feedback" data-trace-id="${escHtml(r.traceId)}"><div class="run-feedback-title">Rate this run</div><div class="run-feedback-stars" role="radiogroup" aria-label="Rate this run">${[1,2,3,4,5].map(n=>`<label title="${n} star${n===1?"":"s"}"><input type="radio" name="run-rating" value="${n}"><span>&#9733;</span></label>`).join("")}</div>${notesBox}<button class="btn btn-sm" onclick="submitRunFeedback('${id}',this)">Submit feedback</button><div class="run-feedback-status"></div></div>`:"";
    // A run that missed a mechanical check must not read as a clean run. The
    // whole result card changes colour and gains a banner, not just a line of
    // text above identical output.
    const failed=r.status==="checks_failed"&&(r.checkFailures||[]).length;
    // A check reports what its detectors saw, never a verdict on the draft.
    // "No CTA detected" is a reason to look, not proof the model omitted one.
    const banner=failed?`<div class="run-checks-failed"><div class="run-checks-title">&#9888; ${r.checkFailures.length} mechanical check${r.checkFailures.length===1?"":"s"} did not pass — review before shipping</div><ul>${r.checkFailures.map(c=>`<li><code>${escHtml(c.checkId)}</code> — ${escHtml(c.message)}</li>`).join("")}</ul><div class="run-checks-note">The output below was still generated and billed. A check can be wrong about a correct draft — if that is what happened, say so in the notes.</div></div>`:"";
    box.innerHTML=`<div class="run-result${failed?" run-result-failed":""}">${banner}<div class="run-result-head">${failed?"Output (failed checks)":"Output"} <span class="run-via">via ${escHtml(r.mode==="single-shot"?"single-shot runtime":r.via)}</span> ${r.tracePersisted&&r.traceId?`<span class="run-trace">&#10003; metadata trace ${escHtml(r.traceId)} recorded</span>`:`<span class="run-via">trace not persisted</span>`}</div><pre>${escHtml(r.output)}</pre>${feedback}</div>`;
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
