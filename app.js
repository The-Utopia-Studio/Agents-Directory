// ═══════════════════════════════════════════════════════════════════
//  Agents Inventory — Utopia Studio
//  Schema is organised around the four pillars an agent is only ever as
//  good as: GOALS · SKILLS · TOOLS · CONTEXT  (see ai-native framing).
//  Eval is an append-only HISTORY (not a single field) so fleet health
//  can be trended, and each agent carries a versioned changelog plus an
//  optional proposedImprovement — the human-in-the-loop hook that turns
//  one-shot builds into an eval → improve → approve loop.
// ═══════════════════════════════════════════════════════════════════

// ── SEED DATA ──
const SEED_AGENTS=[
  {id:"A1",name:"LinkedIn Auditor",tagline:"Scrapes and analyzes LinkedIn profiles, then suggests prioritized fixes with suggested rewrites.",description:"",platform:"Claude",status:"Active",category:"Personal Branding",owner:"Sarah",initials:"SA",model:"Claude Opus 4.x",version:"1.2",
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
    proposedImprovement:null},

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
    proposedImprovement:{source:"GEPA (stub)",date:"2026-07-15",status:"proposed",
      summary:"Add a voice-anchoring step + a CTA-tone rubric to the prompt.",
      detail:"Traces show failures cluster when no example bio is supplied. Proposed: (1) require ≥2 of the fellow's own sentences as voice anchors before generating; (2) score each CTA against a 'confident-not-pushy' rubric and regenerate any that fail. Est. +18 pts on voice-match in offline eval."}},

  {id:"A3",name:"Post Suggester",tagline:"Scrapes trending topics in a fellow's field and generates draft LinkedIn posts with hooks and CTAs.",description:"",platform:"Manus",status:"Active",category:"Marketing & Content",owner:"James",initials:"JA",model:"—",version:"1.1",
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
    proposedImprovement:null},

  {id:"A4",name:"Marketing Scout",tagline:"Scrapes Slack channels and suggests marketing tasks, topics, and content opportunities for the team.",description:"",platform:"Claude",status:"Experimental",category:"Marketing & Content",owner:"Mo",initials:"MO",model:"Claude Sonnet 4.x",version:"0.3",
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
    proposedImprovement:null},

  {id:"A5",name:"Design Agent",tagline:"Claude + MCP integrations for design-system work — component generation, asset management, and design QA.",description:"",platform:"Claude",status:"Experimental",category:"Design & Product",owner:"Aiden",initials:"AI",model:"Claude Opus 4.x",version:"0.2",
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
    proposedImprovement:null},

  {id:"A6",name:"Research Assistant",tagline:"Cursor-based agent for deep research tasks — market analysis, competitive intel, and posting reminders.",description:"",platform:"Cursor",status:"Active",category:"Research & Analysis",owner:"Hager",initials:"HA",model:"—",version:"1.0",
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
    proposedImprovement:null}
];

const SEED_REQUESTS=[
  {id:"R1",title:"Pitch Deck Agent",desc:"Help fellows build investor-ready pitch decks from meeting notes and strategy docs.",requestedBy:"Ollie",date:"Jul 15, 2026",priority:"Important",status:"Approved",assignee:"",notes:"",shippedAgentId:null},
  {id:"R2",title:"Onboarding Agent",desc:"Guide new fellows through their first 2 weeks — checklist, introductions, setup tasks.",requestedBy:"Sarah",date:"Jul 14, 2026",priority:"Urgent",status:"In Progress",assignee:"Haia",notes:"Deciding whether this is a workflow or an agent.",shippedAgentId:null},
  {id:"R3",title:"Competitive Intel Agent",desc:"Automated competitor tracking — pull updates from news, LinkedIn, and filings.",requestedBy:"Hager",date:"Jul 12, 2026",priority:"Nice to have",status:"Requested",assignee:"",notes:"",shippedAgentId:null},
  {id:"R4",title:"Email Drafter",desc:"Draft outreach emails for fellows based on their ICP and messaging framework.",requestedBy:"James",date:"Jul 10, 2026",priority:"Important",status:"Requested",assignee:"",notes:"",shippedAgentId:null},
  {id:"R5",title:"Meeting Notes Agent",desc:"Summarize Granola meeting notes into structured action items and follow-ups.",requestedBy:"Mo",date:"Jul 8, 2026",priority:"Nice to have",status:"Declined",assignee:"",notes:"Granola already handles this well. Revisit if quality drops.",shippedAgentId:null}
];

// ── STATE (hydrated from localStorage) ──
let agents=[],requests=[],nextAgentNum=1,nextReqNum=1;
const STORE_KEY="utopia_agents_dir_v2";

function persist(){try{localStorage.setItem(STORE_KEY,JSON.stringify({agents,requests,nextAgentNum,nextReqNum}))}catch(e){}}
function inferredUsabilityModes(a){
  const type=a.invocation&&a.invocation.type;
  if(a.id==="A2"&&type==="mock")return["hosted-run","download-install"];
  if(type==="http"||type==="mock")return["hosted-run"];
  if(type==="mcp"||type==="runtime")return["prepared-handoff"];
  return["download-install"];
}
function hydrate(){
  try{const s=JSON.parse(localStorage.getItem(STORE_KEY));
    if(s&&Array.isArray(s.agents)){agents=s.agents.map(a=>Array.isArray(a.usabilityModes)?a:{...a,usabilityModes:inferredUsabilityModes(a)});requests=s.requests;nextAgentNum=s.nextAgentNum;nextReqNum=s.nextReqNum;persist();return}
  }catch(e){}
  agents=JSON.parse(JSON.stringify(SEED_AGENTS));
  requests=JSON.parse(JSON.stringify(SEED_REQUESTS));
  nextAgentNum=agents.length+1;nextReqNum=requests.length+1;
  persist();
}
function resetData(){if(!confirm("Reset the directory to seed data? Local changes will be lost."))return;localStorage.removeItem(STORE_KEY);hydrate();state.view="list";render();toast("Reset to seed data")}

const CATEGORIES=["Personal Branding","Marketing & Content","Design & Product","Research & Analysis","Operations & Workflow","Investment & DD","Other"];
const PLATFORMS=["Claude","Cursor","Manus","ChatGPT","n8n","Custom","Other"];
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
function formatDate(d){if(!d)return"";const dt=new Date(d);return isNaN(dt)?escHtml(d):dt.toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}
function parseCSV(s){return s?s.split(",").map(x=>x.trim()).filter(Boolean):[]}
function parseLines(s){return s?s.split("\n").map(x=>x.replace(/^\s*[-•\d.]+\s*/,"").trim()).filter(Boolean):[]}

// eval helpers (history is the source of truth)
function latestEval(a){return a.evalHistory&&a.evalHistory.length?a.evalHistory[a.evalHistory.length-1]:null}
function agentEvalStatus(a){const e=latestEval(a);return e?e.status:"Not evaluated"}
function daysSince(d){if(!d)return Infinity;const dt=new Date(d);if(isNaN(dt))return Infinity;return Math.floor((Date.now()-dt.getTime())/86400000)}
function bumpVersion(v){const m=String(v||"0.0").match(/^(\d+)\.(\d+)/);if(!m)return"1.0";return m[1]+"."+(parseInt(m[2],10)+1)}

// fleet health — powers the top-of-list health strip (a success-criteria metric)
function fleetHealth(){
  const evaluated=agents.filter(a=>latestEval(a));
  const scores=evaluated.map(a=>latestEval(a).score).filter(n=>typeof n==="number");
  const avg=scores.length?Math.round(scores.reduce((x,y)=>x+y,0)/scores.length):0;
  const coverage=agents.length?Math.round(evaluated.length/agents.length*100):0;
  const needsReview=agents.filter(a=>{const e=latestEval(a);if(!e)return true;return e.status==="Needs improvement"||e.score<70||daysSince(e.date)>30}).length;
  const proposals=agents.filter(a=>a.proposedImprovement&&a.proposedImprovement.status==="proposed").length;
  return{avg,coverage,needsReview,proposals,evaluated:evaluated.length,total:agents.length};
}

// ── MODAL FORMS ──
function agentFormHtml(agent){
  const isEdit=!!agent;
  const a=agent||{name:"",tagline:"",description:"",platform:"Claude",status:"Experimental",category:"",owner:"",model:"",version:"",objective:"",successCriteria:[],guardrails:[],when:"",sop:"",inputs:[],outputs:[],skills:[],tools:[],context:[],usabilityModes:["download-install"],accessUrl:"",repoUrl:""};
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
      <div class="form-group"><label>Autonomy level</label><select id="f-autonomy">${["L0","L1","L2","L3","L4"].map(l=>`<option${(a.autonomyLevel||"L1")===l?" selected":""}>${l}</option>`).join("")}</select><div class="hint">L0 assist · L1 suggest+confirm · L2 act narrow+audit · L3 act broad · L4 autonomous. The loop won't auto-apply above this.</div></div>
    </div>

    <div class="form-section">
      <div class="form-section-title">Usage — when &amp; how</div>
      <div class="form-group"><label>When to use<span class="req">*</span></label><textarea id="f-when" rows="2" placeholder="What situation triggers using this agent?">${escHtml(a.when)}</textarea></div>
      <div class="form-group"><label>SOP — Step by step<span class="req">*</span></label><textarea id="f-sop" rows="4" placeholder="1. Open the project in Claude&#10;2. Paste the input&#10;3. Review the output">${escHtml(a.sop)}</textarea><div class="hint">Numbered steps. One per line.</div></div>
      <div class="form-row">
        <div class="form-group"><label>Inputs</label><input type="text" id="f-inputs" value="${escHtml((a.inputs||[]).join(", "))}" placeholder="e.g. LinkedIn URL, bio text"><div class="hint">Comma-separated</div></div>
        <div class="form-group"><label>Outputs</label><input type="text" id="f-outputs" value="${escHtml((a.outputs||[]).join(", "))}" placeholder="e.g. List of fixes, rewritten bio"><div class="hint">Comma-separated</div></div>
      </div>
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
    ${req.shippedAgentId?"":`<button class="btn" onclick="shipRequestAsAgent('${req.id}')">Ship as agent &rarr;</button>`}
    <button class="btn btn-primary" onclick="saveTriage('${req.id}')">Save changes</button>
  </div>`;
}

// ── MODAL MANAGEMENT ──
function openModal(type,data){
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
    usabilityModes:[...document.querySelectorAll('input[name="f-usability"]:checked')].map(el=>el.value),
    skills:parseCSV(document.getElementById("f-skills").value),
    tools:parseCSV(document.getElementById("f-tools").value),
    context:parseCSV(document.getElementById("f-context").value),
    accessUrl:document.getElementById("f-access").value.trim(),
    repoUrl:document.getElementById("f-repo").value.trim()
  };
}
function validAgent(f){return f.name&&f.tagline&&f.objective&&f.when&&f.sop&&f.category&&f.owner}

function saveNewAgent(){
  const f=readAgentForm();
  if(!validAgent(f)){toast("Fill in all required fields (incl. objective)");return}
  agents.push(Object.assign({id:"A"+nextAgentNum++,initials:getInitials(f.owner),version:f.version||"1.0",evalHistory:[],changelog:[{version:f.version||"1.0",date:new Date().toISOString().split("T")[0],note:"Registered in directory."}],proposedImprovement:null},f));
  if(state.pendingRequestId){const r=requests.find(x=>x.id===state.pendingRequestId);if(r){r.status="Shipped";r.shippedAgentId="A"+(nextAgentNum-1);}state.pendingRequestId=null}
  persist();closeModal();toast("Agent added: "+f.name);
  render();
}

function saveEditAgent(id){
  const a=agents.find(x=>x.id===id);if(!a)return;
  const f=readAgentForm();
  if(!validAgent(f)){toast("Fill in all required fields (incl. objective)");return}
  const versionChanged=f.version&&f.version!==a.version;
  Object.assign(a,f,{initials:getInitials(f.owner)});
  if(versionChanged)a.changelog.push({version:f.version,date:new Date().toISOString().split("T")[0],note:"Edited via directory."});
  persist();closeModal();toast("Agent updated: "+f.name);state.agent=a;render();
}

function saveNewRequest(){
  const title=document.getElementById("r-title").value.trim();
  const desc=document.getElementById("r-desc").value.trim();
  const name=document.getElementById("r-name").value.trim();
  if(!title||!desc||!name){toast("Fill in all required fields");return}
  requests.push({id:"R"+nextReqNum++,title,desc,requestedBy:name,date:new Date().toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}),priority:document.getElementById("r-priority").value,status:"Requested",notes:"",assignee:"",shippedAgentId:null});
  persist();closeModal();toast("Request submitted: "+title);render();
}

function saveEval(id){
  const a=agents.find(x=>x.id===id);if(!a)return;
  const notes=document.getElementById("e-notes").value.trim();
  if(!notes){toast("Add eval notes");return}
  let score=parseInt(document.getElementById("e-score").value,10);if(isNaN(score))score=null;else score=Math.max(0,Math.min(100,score));
  const entry={date:document.getElementById("e-date")?document.getElementById("e-date").value:new Date().toISOString().split("T")[0],status:document.getElementById("e-status").value,score,notes,knownIssues:document.getElementById("e-issues").value.trim(),by:document.getElementById("e-by").value.trim(),traceUrl:document.getElementById("e-trace").value.trim()};
  if(!entry.date)entry.date=new Date().toISOString().split("T")[0];
  a.evalHistory.push(entry);
  if(window.DirectoryAPI&&DirectoryAPI.enabled){DirectoryAPI.logEval(id,entry).catch(()=>{})}
  persist();closeModal();toast("Evaluation logged");state.agent=a;render();
}

function saveTriage(id){
  const r=requests.find(x=>x.id===id);if(!r)return;
  r.status=document.getElementById("t-status").value;
  r.priority=document.getElementById("t-priority").value;
  r.assignee=document.getElementById("t-assignee").value.trim();
  r.notes=document.getElementById("t-notes").value.trim();
  persist();closeModal();toast("Request updated: "+r.title);render();
}

// Requests → Agents: open a prefilled Add Agent form, mark request Shipped on save
function shipRequestAsAgent(id){
  const r=requests.find(x=>x.id===id);if(!r)return;
  state.pendingRequestId=id;
  openModal("addAgent",{name:r.title.replace(/ Agent$/,""),tagline:r.desc.slice(0,120),description:r.desc,platform:"Claude",status:"Experimental",category:"",owner:r.assignee||"",model:"",version:"1.0",objective:"",successCriteria:[],guardrails:[],when:"",sop:"",inputs:[],outputs:[],skills:[],tools:[],context:[],accessUrl:"",repoUrl:""});
}

// ── THE LOOP: propose (stub) → human approves/rejects → new version ──
// In production, proposedImprovement is written by a GEPA/DSPy job that reads
// failing traces from Langfuse. Here it's synthesised from the latest eval so
// the human-in-the-loop review flow is exercisable end-to-end.
async function proposeImprovement(id){
  const a=agents.find(x=>x.id===id);if(!a)return;
  // Live path: the loop service runs the real optimizer against real traces.
  if(window.DirectoryAPI&&DirectoryAPI.enabled){
    try{
      const p=await DirectoryAPI.runImprovement(id);
      a.proposedImprovement={source:p.source,date:p.date,status:p.status,summary:p.summary,detail:p.detail};
      persist();state.agent=a;render();toast("Improvement proposed by "+p.source+" — awaiting review");return;
    }catch(e){toast("Optimizer unreachable — using local stub")}
  }
  // Offline fallback (static deploy): synthesise from the latest eval.
  const e=latestEval(a);
  const issue=(e&&e.knownIssues)||"the most frequent failure in recent traces";
  a.proposedImprovement={source:"heuristic (offline)",date:new Date().toISOString().split("T")[0],status:"proposed",
    summary:"Prompt/skill revision targeting: "+issue,
    detail:"Reflective optimiser read the recent eval notes and proposes a revised prompt + tool-description addressing \""+issue+"\". Review, then approve to cut a new version or reject to discard."};
  persist();state.agent=a;render();toast("Improvement proposed — awaiting review");
}
async function approveImprovement(id){
  const a=agents.find(x=>x.id===id);if(!a||!a.proposedImprovement)return;
  if(window.DirectoryAPI&&DirectoryAPI.enabled){
    try{
      const r=await DirectoryAPI.approve(id);
      a.version=r.version;if(r.agent&&r.agent.changelog)a.changelog=r.agent.changelog;a.proposedImprovement=null;
      persist();state.agent=a;render();toast("Approved → shipped v"+r.version);return;
    }catch(e){toast("Approval failed — check connection and retry");return}
  }
  const nv=bumpVersion(a.version);
  a.changelog.push({version:nv,date:new Date().toISOString().split("T")[0],note:"Approved improvement: "+a.proposedImprovement.summary});
  a.version=nv;a.proposedImprovement=null;
  persist();state.agent=a;render();toast("Approved → shipped v"+nv);
}
async function rejectImprovement(id){
  const a=agents.find(x=>x.id===id);if(!a||!a.proposedImprovement)return;
  if(window.DirectoryAPI&&DirectoryAPI.enabled){try{await DirectoryAPI.reject(id)}catch(e){}}
  a.proposedImprovement=null;persist();state.agent=a;render();toast("Improvement rejected");
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
  const h=fleetHealth();
  return `<div class="health-strip">
    <div class="health-stat"><span class="health-num">${h.avg}</span><span class="health-label">Fleet health<br>avg eval score</span></div>
    <div class="health-stat"><span class="health-num">${h.coverage}%</span><span class="health-label">Eval coverage<br>${h.evaluated}/${h.total} evaluated</span></div>
    <div class="health-stat"><span class="health-num ${h.needsReview?"health-warn":""}">${h.needsReview}</span><span class="health-label">Need review<br>weak · stale · unevaluated</span></div>
    <div class="health-stat"><span class="health-num ${h.proposals?"health-loop":""}">${h.proposals}</span><span class="health-label">Improvements<br>awaiting approval</span></div>
  </div>`;
}

function renderAgentsList(){
  const cats=["All",...new Set(agents.map(a=>a.category))];
  const stats=["All",...new Set(agents.map(a=>a.status))];
  const filtered=agents.filter(a=>{
    if(state.catFilter!=="All"&&a.category!==state.catFilter)return false;
    if(state.statusFilter!=="All"&&a.status!==state.statusFilter)return false;
    return true;
  });
  return `
    <div class="section-header"><h2>AGENTS</h2><div class="actions"><button class="btn" onclick="openModal('request')">Request an Agent</button><button class="btn btn-primary" onclick="openModal('addAgent')">+ Add agent</button></div></div>
    ${renderSubTabs()}
    ${renderHealthStrip()}
    <div id="automations" class="automations"></div>
    <p class="count-line">${filtered.length} agent${filtered.length!==1?"s":""} across the team. Click one to see its goals, skills, tools, context, and eval history. <a class="reset-link" onclick="resetData()">reset demo data</a></p>
    <div class="filters">
      ${cats.map(c=>`<button class="filter-chip ${state.catFilter===c?"active":""}" onclick="setFilter('cat','${escHtml(c)}')">${escHtml(c)}</button>`).join("")}
      <div class="filter-sep"></div>
      ${stats.map(s=>`<button class="filter-chip ${state.statusFilter===s?"active":""}" onclick="setFilter('status','${escHtml(s)}')">${escHtml(s)}</button>`).join("")}
    </div>
    <div class="card-grid">${filtered.map(a=>{
      const e=latestEval(a);const prop=a.proposedImprovement&&a.proposedImprovement.status==="proposed";
      return `
      <div class="card" onclick="openDetail('${a.id}')">
        <div class="card-top"><span class="card-id">${a.id} · v${escHtml(a.version||"1.0")}</span><span class="pill ${statusClass(a.status)}"><span class="dot"></span>${escHtml(a.status)}</span></div>
        <h3>${escHtml(a.name)}</h3><p>${escHtml(a.tagline)}</p>
        <div class="card-eval">
          <span class="pill ${evalClass(agentEvalStatus(a))} pill-xs">${e&&typeof e.score==="number"?e.score+" · ":""}${escHtml(agentEvalStatus(a))}</span>
          ${prop?'<span class="pill pill-loop pill-xs">● improvement pending</span>':""}
        </div>
        <div class="card-footer"><span class="card-meta">${platformIcon(a.platform)} ${escHtml(a.platform)}<span class="sep">&middot;</span>${escHtml(a.category)}</span><div class="avatar">${escHtml(a.initials)}</div></div>
      </div>`;}).join("")}</div>
    ${filtered.length===0?'<div class="empty-filter">No agents match these filters.</div>':""}`;
}

function renderRequests(){
  const groups={"In Progress":[],"Approved":[],"Requested":[],"Shipped":[],"Declined":[]};
  requests.forEach(r=>{if(groups[r.status])groups[r.status].push(r)});
  function grp(name,items){
    if(!items.length)return"";
    return `<div class="status-group"><div class="status-group-title">${name}<span class="group-count">${items.length}</span></div><div class="request-list">${items.map(r=>`
      <div class="request-card" onclick="openModal('triage',requests.find(x=>x.id==='${r.id}'))">
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
    <div class="section-header"><h2>AGENTS</h2><div class="actions"><button class="btn btn-primary" onclick="openModal('request')">+ New request</button><button class="btn" onclick="openModal('addAgent')">Add agent</button></div></div>
    ${renderSubTabs()}
    <p class="count-line">Agent requests from the team. Click a request to triage it — or ship an approved one straight into the catalog.</p>
    ${active}
    ${done?`<div class="resolved-divider"><div class="resolved-title">RESOLVED</div>${done}</div>`:""}`;
}

function pillarList(items,empty){return items&&items.length?items.map(i=>`<div class="item">&bull; ${escHtml(i)}</div>`).join(""):`<div class="item empty">${empty}</div>`}
function chips(items){return items&&items.length?items.map(i=>`<span class="chip">${escHtml(i)}</span>`).join(""):'<span class="chip empty">None specified</span>'}

function renderDetail(a){
  const sopLines=a.sop.split("\n").filter(Boolean);
  const e=latestEval(a);
  const prop=a.proposedImprovement&&a.proposedImprovement.status==="proposed";
  return `<div class="detail">
    <button class="back-btn" onclick="goBack()"><span>&lsaquo;</span> Back to Directory</button>
    <div class="detail-header">
      <div class="detail-eyebrow">AGENT ${a.id} · v${escHtml(a.version||"1.0")}${a.model?" · "+escHtml(a.model):""}</div>
      <button class="btn btn-sm" onclick="openModal('editAgent',agents.find(x=>x.id==='${a.id}'))">Edit</button>
    </div>
    <h1>${escHtml(a.name)}</h1>
    <p class="tagline">${escHtml(a.tagline)}</p>
    <div class="pills">
      <span class="pill ${statusClass(a.status)}"><span class="dot"></span>${escHtml(a.status)}</span>
      <span class="pill pill-neutral">${escHtml(a.category)}</span>
      <span class="pill pill-neutral">${platformIcon(a.platform)} ${escHtml(a.platform)}</span>
      <span class="pill pill-neutral pill-owner"><span class="mini-avatar">${escHtml(a.initials)}</span>${escHtml(a.owner)}</span>
    </div>

    <div class="use-panel">
      <div class="use-head">Use this agent<span class="use-tier">${invocationTier(a)}</span></div>
      <div class="use-actions">
        ${a.accessUrl?`<a class="btn btn-sm" href="${escHtml(a.accessUrl)}" target="_blank" rel="noopener">Open in ${escHtml(a.platform)} &#8599;</a>`:""}
        ${canDownload(a)?`<button class="btn btn-sm" onclick="copyAgentPrompt('${a.id}')">Copy prompt</button><button class="btn btn-sm" onclick="copyAgentSkill('${a.id}')">Copy as SKILL.md</button>`:""}
        ${isRunnable(a)&&window.DirectoryAPI&&DirectoryAPI.enabled?`<button class="btn btn-sm btn-primary" onclick="toggleRun('${a.id}')">&#9654; Run here</button>`:""}
      </div>
      <div class="use-hint">${needsInvokerConfiguration(a)?`${escHtml((a.invocation&&a.invocation.type)||"runtime")} execution is not configured. Use the prepared handoff/export path until an adapter is connected.`:`Available here: ${escHtml(getUsabilityModes(a).join(", "))}. The execution adapter remains ${escHtml((a.invocation&&a.invocation.type)||"link")}.`}</div>
      <div id="run-panel" class="run-panel"></div>
    </div>

    ${prop?`<div class="loop-card">
      <div class="loop-head"><span class="loop-badge">● IMPROVEMENT PROPOSED</span><span class="loop-src">${escHtml(a.proposedImprovement.source)} · ${formatDate(a.proposedImprovement.date)}</span></div>
      <div class="loop-summary">${escHtml(a.proposedImprovement.summary)}</div>
      <div class="loop-detail">${escHtml(a.proposedImprovement.detail)}</div>
      ${a.proposedImprovement.verdict?`<div class="loop-verdict"><span class="pill pill-xs ${a.proposedImprovement.verdict.verdict==="ship"?"pill-green":a.proposedImprovement.verdict.verdict==="reject"?"pill-amber":"pill-blue"}">checker: ${escHtml(a.proposedImprovement.verdict.verdict)} · ${a.proposedImprovement.verdict.confidence}</span>${(a.proposedImprovement.verdict.reasons||[]).length?`<span class="loop-verdict-why">${escHtml(a.proposedImprovement.verdict.reasons[0])}</span>`:""}</div>`:""}
      <div class="loop-actions"><button class="btn btn-primary btn-sm" onclick="approveImprovement('${a.id}')">Approve &rarr; ship v${bumpVersion(a.version)}</button><button class="btn btn-sm" onclick="rejectImprovement('${a.id}')">Reject</button></div>
    </div>`:""}

    <div class="pillar-block pillar-goals">
      <div class="pillar-tag">① GOALS<span class="autonomy-pill" title="Autonomy level — the loop won't auto-apply above this">${escHtml(a.autonomyLevel||"L1")} · ${autonomyLabel(a.autonomyLevel||"L1")}</span>${a.costPerOutcome&&a.costPerOutcome.target?`<span class="cost-pill">target ${"$"+a.costPerOutcome.target}/outcome</span>`:""}</div>
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

    ${a.accessUrl||a.repoUrl?`<div class="section"><div class="section-title">Technical Details</div><div class="section-body">
      ${a.accessUrl?`<div class="detail-access-line"><strong>Access:</strong> <a href="${escHtml(a.accessUrl)}">${escHtml(a.accessUrl)}</a></div>`:""}
      ${a.repoUrl?`<div><strong>Repo:</strong> <a href="${escHtml(a.repoUrl)}">${escHtml(a.repoUrl)}</a></div>`:""}
    </div></div>`:""}

    <div class="section">
      <div class="section-title eval-title">Eval &amp; Observability<span class="eval-title-actions"><button class="btn-ghost btn-sm" onclick="proposeImprovement('${a.id}')">Propose improvement</button><button class="btn-ghost btn-sm" onclick="openModal('eval',agents.find(x=>x.id==='${a.id}'))">Log eval</button></span></div>
      <div class="eval-pill-row"><span class="pill ${evalClass(agentEvalStatus(a))}">${e&&typeof e.score==="number"?e.score+" · ":""}${escHtml(agentEvalStatus(a))}</span>${e?`<span class="date">Last reviewed: ${formatDate(e.date)}${e.by?" · "+escHtml(e.by):""}</span>`:""}</div>
      ${a.evalHistory&&a.evalHistory.length?`<div class="eval-history">${a.evalHistory.slice().reverse().map(h=>`
        <div class="eval-row">
          <div class="eval-row-top"><span class="pill ${evalClass(h.status)} pill-xs">${escHtml(h.status)}</span>${typeof h.score==="number"?`<span class="eval-score">${h.score}</span>`:""}<span class="eval-date">${formatDate(h.date)}${h.by?" · "+escHtml(h.by):""}</span>${h.traceUrl?`<a class="eval-trace" href="${escHtml(h.traceUrl)}">trace ↗</a>`:""}</div>
          ${h.notes?`<div class="eval-note">${escHtml(h.notes)}</div>`:""}
          ${h.knownIssues?`<div class="eval-issue"><b>Known issues:</b> ${escHtml(h.knownIssues)}</div>`:""}
        </div>`).join("")}</div>`:`<div class="empty-eval"><p>This agent hasn't been evaluated yet.</p><div class="cta" onclick="openModal('eval',agents.find(x=>x.id==='${a.id}'))">Log the first evaluation &rarr;</div></div>`}
    </div>

    ${a.changelog&&a.changelog.length?`<div class="section"><div class="section-title">Version history</div><div class="section-body">${a.changelog.slice().reverse().map(c=>`<div class="change-row"><span class="change-ver">v${escHtml(c.version)}</span><span class="change-date">${formatDate(c.date)}</span><span class="change-note">${escHtml(c.note)}</span></div>`).join("")}</div></div>`:""}

    <button class="contact-btn">&#x1F4AC; Message ${escHtml(a.owner)} on Slack</button>
  </div>`;
}

function render(){
  const app=document.getElementById("app");
  if(state.view==="detail"&&state.agent){const fresh=agents.find(x=>x.id===state.agent.id);if(fresh)state.agent=fresh;app.innerHTML=renderDetail(state.agent);return}
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
      ${openq.length?`<div class="auto-queue"><div class="auto-inbox-title">Research queue <span class="auto-sub2">discover → improve</span><span class="count-badge">${q.filter(x=>x.status==="open").length}</span></div>${openq.map(x=>`<div class="auto-item"><span class="rq-score" title="score 1–3">${x.score}</span><span class="auto-agent">${escHtml(x.agentId)}</span><span class="auto-summary">${escHtml(x.title)}</span><span class="pill pill-xs ${sClass(x.status)}">${escHtml(x.status)}</span></div>`).join("")}</div>`:""}
      <div class="auto-inbox">
        <div class="auto-inbox-title">Triage inbox<span class="count-badge">${items.length}</span></div>
        ${items.length?items.map(x=>`<div class="auto-item"><span class="auto-agent">${escHtml(x.agentId)}</span><span class="auto-summary">${escHtml(x.proposal.summary)}</span>${x.proposal.verdict?`<span class="pill pill-xs ${vClass(x.proposal.verdict.verdict)}">checker: ${escHtml(x.proposal.verdict.verdict)} ${x.proposal.verdict.confidence}</span>`:""}</div>`).join(""):'<div class="auto-empty">Inbox clear — nothing awaiting triage.</div>'}
      </div>
      ${learnings.length?`<div class="auto-learnings"><div class="auto-inbox-title">Learnings<span class="count-badge">${learnings.length}</span></div>${learnings.map(l=>`<div class="auto-item"><span class="auto-agent">${escHtml(l.agentId||l.loop)}</span><span class="auto-summary">${escHtml(l.learning)}</span></div>`).join("")}</div>`:""}`;
  }catch(e){el.innerHTML=""}
}
async function runLoopNow(btn){
  if(btn){btn.disabled=true;btn.textContent="Running…"}
  try{const r=await DirectoryAPI.runLoop();toast(`Cycle: scanned ${r.scanned}, ${r.jobs.length} job(s) run, $${r.budget.spentUsd} spent`)}
  catch(e){toast("Loop service unreachable")}
  loadAutomations();
}

// ── Using an agent across platforms (invocation) ──
function getUsabilityModes(a){
  if(Array.isArray(a.usabilityModes)&&a.usabilityModes.length)return a.usabilityModes;
  return inferredUsabilityModes(a);
}
function hasUsabilityMode(a,mode){return getUsabilityModes(a).includes(mode)}
function isRunnable(a){return hasUsabilityMode(a,"hosted-run")&&["mock","http"].includes(a.invocation&&a.invocation.type)}
function canDownload(a){return hasUsabilityMode(a,"download-install")||hasUsabilityMode(a,"prepared-handoff")||needsInvokerConfiguration(a)}
function needsInvokerConfiguration(a){return["mcp","runtime"].includes(a.invocation&&a.invocation.type)}
function invocationTier(a){return getUsabilityModes(a).join(" + ")}
function slug(s){return String(s).toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")}

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
// Export as a SKILL.md (the open cross-vendor standard).
function buildSkillMd(a){
  return `---\nname: ${slug(a.name)}\ndescription: ${(a.tagline||a.objective||"").replace(/\n/g," ")}\n---\n\n`+buildAgentPrompt(a)+"\n";
}
function copyText(text,msg){(navigator.clipboard&&navigator.clipboard.writeText?navigator.clipboard.writeText(text):Promise.reject()).then(()=>toast(msg)).catch(()=>{const ta=document.createElement("textarea");ta.value=text;document.body.appendChild(ta);ta.select();try{document.execCommand("copy");toast(msg)}catch(e){toast("Copy failed")}ta.remove()})}
function copyAgentPrompt(id){const a=agents.find(x=>x.id===id);if(a)copyText(buildAgentPrompt(a),"Prompt copied — paste into any platform")}
function copyAgentSkill(id){const a=agents.find(x=>x.id===id);if(a)copyText(buildSkillMd(a),"SKILL.md copied")}

function toggleRun(id){
  const a=agents.find(x=>x.id===id);const box=document.getElementById("run-panel");if(!a||!box)return;
  if(box.innerHTML){box.innerHTML="";return}
  const fields=(a.inputs&&a.inputs.length?a.inputs:["input"]).map((inp,i)=>`<div class="run-field"><label>${escHtml(inp)}</label><input id="run-in-${i}" data-k="${escHtml(inp)}" placeholder="${escHtml(inp)}"></div>`).join("");
  box.innerHTML=`<div class="run-form">${fields}<button class="btn btn-sm btn-primary" onclick="runAgentUI('${id}')">Run &#9654;</button></div><div id="run-out" class="run-out"></div>`;
}
async function runAgentUI(id){
  const box=document.getElementById("run-out");if(!box)return;
  const inputs={};document.querySelectorAll("#run-panel [data-k]").forEach(el=>{if(el.value.trim())inputs[el.getAttribute("data-k")]=el.value.trim()});
  box.innerHTML='<div class="run-status">Running…</div>';
  try{
    const r=await DirectoryAPI.runAgent(id,inputs);
    box.innerHTML=`<div class="run-result"><div class="run-result-head">Output <span class="run-via">via ${escHtml(r.via)}</span> <span class="run-trace">&#10003; trace ${escHtml(r.traceId)} recorded</span></div><pre>${escHtml(r.output)}</pre></div>`;
  }catch(e){box.innerHTML=`<div class="run-status run-err">Run failed: ${escHtml(String(e.message||e))}${e.traceId?`<div>Error trace ${escHtml(e.traceId)} recorded.</div>`:""}</div>`}
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
function openDetail(id){state.agent=agents.find(a=>a.id===id);state.view="detail";render();window.scrollTo(0,0)}
function goBack(){state.view="list";state.agent=null;render()}
function switchSubTab(tab){state.subTab=tab;state.view="list";render()}

// ── BOOT ──
hydrate();
render();
// The probe resolves after the first render — refresh the automations panel then.
if(window.DirectoryAPI)DirectoryAPI.ready.then(()=>{if(state.view==="list"&&state.subTab==="agents")loadAutomations()});
