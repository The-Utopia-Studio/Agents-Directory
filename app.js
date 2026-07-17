// ── DATA ──
let agents=[
  {id:"A1",name:"LinkedIn Auditor",tagline:"Scrapes and analyzes LinkedIn profiles, then suggests prioritized fixes with suggested rewrites.",platform:"Claude",status:"Active",category:"Personal Branding",owner:"Sarah",initials:"SA",when:"When onboarding a new fellow or when a fellow asks for LinkedIn help.",sop:"1. Copy the fellow's LinkedIn profile URL\n2. Open the LinkedIn Auditor project in Claude\n3. Paste the URL and say \"audit this profile\"\n4. Review suggestions before sharing with the fellow",inputs:["LinkedIn profile URL"],outputs:["Prioritized list of fixes","Suggested rewrites for each section"],evalStatus:"Performing well",evalNotes:"Headline suggestions are strong. About section rewrites sometimes lose the fellow's voice — needs more few-shot examples.",knownIssues:"Struggles with non-English profiles.",lastReviewed:"2026-07-10",integrations:["LinkedIn"],accessUrl:"",repoUrl:""},
  {id:"A2",name:"Bio Generator",tagline:"Creates SEO-optimized LinkedIn bios with CTA language. Tries to learn the fellow's voice over time.",platform:"Claude",status:"Active",category:"Personal Branding",owner:"Sarah",initials:"SA",when:"When a fellow needs a new or refreshed LinkedIn bio.",sop:"1. Gather the fellow's current bio, role, and goals\n2. Open Bio Generator project in Claude\n3. Provide context and ask for bio options\n4. Iterate on tone and voice match",inputs:["Fellow's current bio","Role description","Target audience"],outputs:["3 bio variations","SEO keyword suggestions"],evalStatus:"Needs improvement",evalNotes:"CTAs are sometimes too aggressive. Voice matching is inconsistent without enough examples.",knownIssues:"Tends toward generic corporate language without strong examples.",lastReviewed:"2026-07-08",integrations:[],accessUrl:"",repoUrl:""},
  {id:"A3",name:"Post Suggester",tagline:"Scrapes trending topics in a fellow's field and generates draft LinkedIn posts with hooks and CTAs.",platform:"Manus",status:"Active",category:"Marketing & Content",owner:"James",initials:"JA",when:"Weekly content planning for fellows, or when a fellow needs post ideas fast.",sop:"1. Provide the fellow's industry and recent topics\n2. Run the agent in Manus\n3. Review generated drafts\n4. Edit for voice and accuracy before sharing",inputs:["Fellow's industry","Recent topics or news"],outputs:["5-10 draft post ideas","Hook + CTA for each"],evalStatus:"Performing well",evalNotes:"Good at identifying trending angles. Hooks are strong. Some posts need fact-checking.",knownIssues:"Occasionally surfaces outdated trends.",lastReviewed:"2026-07-12",integrations:["LinkedIn"],accessUrl:"",repoUrl:""},
  {id:"A4",name:"Marketing Scout",tagline:"Scrapes Slack channels and suggests marketing tasks, topics, and content opportunities for the team.",platform:"Claude",status:"Experimental",category:"Marketing & Content",owner:"Mo",initials:"MO",when:"When planning weekly marketing sprints or looking for content inspiration from internal conversations.",sop:"1. Agent runs on a schedule (or manually triggered)\n2. Reviews recent Slack activity\n3. Outputs a list of suggested tasks and topics\n4. Team reviews and picks what to action",inputs:["Slack channel access"],outputs:["Weekly task suggestions","Topic ideas with source threads"],evalStatus:"Not evaluated",evalNotes:"",knownIssues:"Still in early testing. Signal-to-noise ratio needs tuning.",lastReviewed:"",integrations:["Slack"],accessUrl:"",repoUrl:""},
  {id:"A5",name:"Design Agent",tagline:"Claude + MCP integrations for design-system work — component generation, asset management, and design QA.",platform:"Claude",status:"Experimental",category:"Design & Product",owner:"Aiden",initials:"AI",when:"When building or updating design system components, or doing design QA on new pages.",sop:"1. Open the Design Agent project in Claude\n2. Describe the component or design task\n3. Agent uses MCP to interact with Figma/code\n4. Review output and iterate",inputs:["Component description","Design system context"],outputs:["Component code","Figma updates","QA checklist"],evalStatus:"Not evaluated",evalNotes:"",knownIssues:"MCP integrations are still being configured.",lastReviewed:"",integrations:["Figma","GitHub"],accessUrl:"",repoUrl:""},
  {id:"A6",name:"Research Assistant",tagline:"Cursor-based agent for deep research tasks — market analysis, competitive intel, and posting reminders.",platform:"Cursor",status:"Active",category:"Research & Analysis",owner:"Hager",initials:"HA",when:"When preparing for investment calls, doing market research, or needing competitive analysis.",sop:"1. Open Cursor workspace with research agent config\n2. Provide research brief or question\n3. Agent searches, synthesizes, and outputs structured findings\n4. Review and refine",inputs:["Research question or brief"],outputs:["Structured research doc","Key findings summary"],evalStatus:"Performing well",evalNotes:"Strong on synthesis. Sometimes misses niche sources.",knownIssues:"Cursor context window can limit very large research scopes.",lastReviewed:"2026-07-05",integrations:[],accessUrl:"",repoUrl:""}
];

let requests=[
  {id:"R1",title:"Pitch Deck Agent",desc:"Help fellows build investor-ready pitch decks from meeting notes and strategy docs.",requestedBy:"Ollie",date:"Jul 15, 2026",priority:"Important",status:"Approved",notes:""},
  {id:"R2",title:"Onboarding Agent",desc:"Guide new fellows through their first 2 weeks — checklist, introductions, setup tasks.",requestedBy:"Sarah",date:"Jul 14, 2026",priority:"Urgent",status:"In Progress",assignee:"Haia",notes:"Deciding whether this is a workflow or an agent."},
  {id:"R3",title:"Competitive Intel Agent",desc:"Automated competitor tracking — pull updates from news, LinkedIn, and filings.",requestedBy:"Hager",date:"Jul 12, 2026",priority:"Nice to have",status:"Requested",notes:""},
  {id:"R4",title:"Email Drafter",desc:"Draft outreach emails for fellows based on their ICP and messaging framework.",requestedBy:"James",date:"Jul 10, 2026",priority:"Important",status:"Requested",notes:""},
  {id:"R5",title:"Meeting Notes Agent",desc:"Summarize Granola meeting notes into structured action items and follow-ups.",requestedBy:"Mo",date:"Jul 8, 2026",priority:"Nice to have",status:"Declined",notes:"Granola already handles this well. Revisit if quality drops."},
];

let nextAgentNum=agents.length+1;
let nextReqNum=requests.length+1;
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
function escHtml(s){return s?String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"):""}
function toast(msg){const t=document.createElement("div");t.className="toast";t.textContent=msg;document.body.appendChild(t);setTimeout(()=>t.remove(),2500)}
function formatDate(d){if(!d)return"";const dt=new Date(d);return dt.toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}

// ── MODAL FORMS ──
function agentFormHtml(agent){
  const isEdit=!!agent;
  const a=agent||{name:"",tagline:"",description:"",platform:"Claude",status:"Experimental",category:"",owner:"",when:"",sop:"",inputs:[],outputs:[],integrations:[],accessUrl:"",repoUrl:"",evalStatus:"Not evaluated",evalNotes:"",knownIssues:"",lastReviewed:""};
  return `
  <div class="modal-header">
    <div><h2>${isEdit?"Edit Agent":"Add Agent"}</h2><p>${isEdit?"Update this agent's details":"Register a new agent in the directory"}</p></div>
    <button class="modal-close" onclick="closeModal()">&times;</button>
  </div>
  <div class="modal-body">
    <div class="form-section">
      <div class="form-section-title">Identity</div>
      <div class="form-group"><label>Name<span class="req">*</span></label><input type="text" id="f-name" value="${escHtml(a.name)}" placeholder="e.g. LinkedIn Auditor" maxlength="40"><div class="hint">Short, memorable. Max 40 characters.</div></div>
      <div class="form-group"><label>Tagline<span class="req">*</span></label><input type="text" id="f-tagline" value="${escHtml(a.tagline)}" placeholder="One sentence: what it does and for whom" maxlength="120"><div class="hint">Max 120 characters.</div></div>
      <div class="form-group"><label>Description</label><textarea id="f-desc" rows="3" placeholder="What it does, how it works, why it exists">${escHtml(a.description||"")}</textarea></div>
    </div>
    <div class="form-section">
      <div class="form-section-title">SOP &amp; Usage</div>
      <div class="form-group"><label>When to use<span class="req">*</span></label><textarea id="f-when" rows="2" placeholder="What situation triggers using this agent?">${escHtml(a.when)}</textarea></div>
      <div class="form-group"><label>SOP — Step by step<span class="req">*</span></label><textarea id="f-sop" rows="4" placeholder="1. Open the project in Claude\n2. Paste the input\n3. Review the output">${escHtml(a.sop)}</textarea><div class="hint">Numbered steps. One per line.</div></div>
      <div class="form-row">
        <div class="form-group"><label>Inputs</label><input type="text" id="f-inputs" value="${escHtml(a.inputs.join(", "))}" placeholder="e.g. LinkedIn URL, bio text"><div class="hint">Comma-separated</div></div>
        <div class="form-group"><label>Outputs</label><input type="text" id="f-outputs" value="${escHtml(a.outputs.join(", "))}" placeholder="e.g. List of fixes, rewritten bio"><div class="hint">Comma-separated</div></div>
      </div>
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
      <div class="form-group"><label>Integrations</label><input type="text" id="f-integrations" value="${escHtml((a.integrations||[]).join(", "))}" placeholder="e.g. Slack, LinkedIn, Figma"><div class="hint">Comma-separated</div></div>
      <div class="form-row">
        <div class="form-group"><label>Access URL</label><input type="url" id="f-access" value="${escHtml(a.accessUrl||"")}" placeholder="https://..."></div>
        <div class="form-group"><label>Repo URL</label><input type="url" id="f-repo" value="${escHtml(a.repoUrl||"")}" placeholder="https://github.com/..."></div>
      </div>
    </div>
    ${isEdit?`<div class="form-section">
      <div class="form-section-title">Eval &amp; Observability</div>
      <div class="form-row">
        <div class="form-group"><label>Eval Status</label><select id="f-eval">${EVAL_OPTIONS.map(e=>`<option${a.evalStatus===e?" selected":""}>${e}</option>`).join("")}</select></div>
        <div class="form-group"><label>Last Reviewed</label><input type="date" id="f-reviewed" value="${a.lastReviewed||""}"></div>
      </div>
      <div class="form-group"><label>Eval Notes</label><textarea id="f-evalnotes" rows="2" placeholder="What's working? What needs improvement?">${escHtml(a.evalNotes||"")}</textarea></div>
      <div class="form-group"><label>Known Issues</label><textarea id="f-issues" rows="2" placeholder="Failure modes, limitations, edge cases">${escHtml(a.knownIssues||"")}</textarea></div>
    </div>`:""}
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
    <div><h2>Update Evaluation</h2><p>${agent.name}</p></div>
    <button class="modal-close" onclick="closeModal()">&times;</button>
  </div>
  <div class="modal-body">
    <div class="form-row">
      <div class="form-group"><label>Eval Status</label><select id="e-status">${EVAL_OPTIONS.map(e=>`<option${agent.evalStatus===e?" selected":""}>${e}</option>`).join("")}</select></div>
      <div class="form-group"><label>Reviewed Date</label><input type="date" id="e-date" value="${new Date().toISOString().split('T')[0]}"></div>
    </div>
    <div class="form-group"><label>Notes</label><textarea id="e-notes" rows="3" placeholder="What's working? What's not?">${escHtml(agent.evalNotes||"")}</textarea></div>
    <div class="form-group"><label>Known Issues</label><textarea id="e-issues" rows="2" placeholder="Failure modes, limitations">${escHtml(agent.knownIssues||"")}</textarea></div>
  </div>
  <div class="modal-footer">
    <button class="btn" onclick="closeModal()">Cancel</button>
    <button class="btn btn-primary" onclick="saveEval('${agent.id}')">Save evaluation</button>
  </div>`;
}

function triageFormHtml(req){
  return `
  <div class="modal-header">
    <div><h2>Triage Request</h2><p>${req.title}</p></div>
    <button class="modal-close" onclick="closeModal()">&times;</button>
  </div>
  <div class="modal-body">
    <div class="triage-context">
      <div class="desc">${escHtml(req.desc)}</div>
      <div class="meta">Requested by ${escHtml(req.requestedBy)} &middot; ${req.date}</div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Status</label><select id="t-status">${REQ_STATUSES.map(s=>`<option${req.status===s?" selected":""}>${s}</option>`).join("")}</select></div>
      <div class="form-group"><label>Priority</label><select id="t-priority">${PRIORITIES.map(p=>`<option${req.priority===p?" selected":""}>${p}</option>`).join("")}</select></div>
    </div>
    <div class="form-group"><label>Assign to</label><input type="text" id="t-assignee" value="${escHtml(req.assignee||"")}" placeholder="e.g. Haia"></div>
    <div class="form-group"><label>Notes</label><textarea id="t-notes" rows="2" placeholder="Triage notes, decline reason, etc.">${escHtml(req.notes||"")}</textarea></div>
  </div>
  <div class="modal-footer">
    <button class="btn" onclick="closeModal()">Cancel</button>
    <button class="btn btn-primary" onclick="saveTriage('${req.id}')">Save changes</button>
  </div>`;
}

// ── MODAL MANAGEMENT ──
function openModal(type, data){
  const root=document.getElementById("modal-root");
  let html="";
  if(type==="addAgent") html=agentFormHtml(null);
  else if(type==="editAgent") html=agentFormHtml(data);
  else if(type==="request") html=requestFormHtml();
  else if(type==="eval") html=evalFormHtml(data);
  else if(type==="triage") html=triageFormHtml(data);
  root.innerHTML=`<div class="modal-overlay" onclick="if(event.target===this)closeModal()"><div class="modal">${html}</div></div>`;
}
function closeModal(){document.getElementById("modal-root").innerHTML=""}

// ── SAVE HANDLERS ──
function parseCSV(s){return s?s.split(",").map(x=>x.trim()).filter(Boolean):[]}

function saveNewAgent(){
  const name=document.getElementById("f-name").value.trim();
  const tagline=document.getElementById("f-tagline").value.trim();
  const when=document.getElementById("f-when").value.trim();
  const sop=document.getElementById("f-sop").value.trim();
  const category=document.getElementById("f-category").value;
  const owner=document.getElementById("f-owner").value.trim();
  if(!name||!tagline||!when||!sop||!category||!owner){toast("Fill in all required fields");return}
  agents.push({
    id:"A"+nextAgentNum++,name,tagline,
    description:document.getElementById("f-desc").value.trim(),
    platform:document.getElementById("f-platform").value,
    status:document.getElementById("f-status").value,
    category,owner,initials:getInitials(owner),
    when,sop,
    inputs:parseCSV(document.getElementById("f-inputs").value),
    outputs:parseCSV(document.getElementById("f-outputs").value),
    integrations:parseCSV(document.getElementById("f-integrations").value),
    accessUrl:document.getElementById("f-access").value.trim(),
    repoUrl:document.getElementById("f-repo").value.trim(),
    evalStatus:"Not evaluated",evalNotes:"",knownIssues:"",lastReviewed:""
  });
  closeModal();toast("Agent added: "+name);render();
}

function saveEditAgent(id){
  const a=agents.find(x=>x.id===id);if(!a)return;
  const name=document.getElementById("f-name").value.trim();
  const tagline=document.getElementById("f-tagline").value.trim();
  const when=document.getElementById("f-when").value.trim();
  const sop=document.getElementById("f-sop").value.trim();
  const category=document.getElementById("f-category").value;
  const owner=document.getElementById("f-owner").value.trim();
  if(!name||!tagline||!when||!sop||!category||!owner){toast("Fill in all required fields");return}
  Object.assign(a,{name,tagline,description:document.getElementById("f-desc").value.trim(),platform:document.getElementById("f-platform").value,status:document.getElementById("f-status").value,category,owner,initials:getInitials(owner),when,sop,inputs:parseCSV(document.getElementById("f-inputs").value),outputs:parseCSV(document.getElementById("f-outputs").value),integrations:parseCSV(document.getElementById("f-integrations").value),accessUrl:document.getElementById("f-access").value.trim(),repoUrl:document.getElementById("f-repo").value.trim(),evalStatus:document.getElementById("f-eval").value,evalNotes:document.getElementById("f-evalnotes").value.trim(),knownIssues:document.getElementById("f-issues").value.trim(),lastReviewed:document.getElementById("f-reviewed").value});
  closeModal();toast("Agent updated: "+name);state.agent=a;render();
}

function saveNewRequest(){
  const title=document.getElementById("r-title").value.trim();
  const desc=document.getElementById("r-desc").value.trim();
  const name=document.getElementById("r-name").value.trim();
  if(!title||!desc||!name){toast("Fill in all required fields");return}
  requests.push({id:"R"+nextReqNum++,title,desc,requestedBy:name,date:new Date().toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}),priority:document.getElementById("r-priority").value,status:"Requested",notes:"",assignee:""});
  closeModal();toast("Request submitted: "+title);render();
}

function saveEval(id){
  const a=agents.find(x=>x.id===id);if(!a)return;
  a.evalStatus=document.getElementById("e-status").value;
  a.lastReviewed=document.getElementById("e-date").value;
  a.evalNotes=document.getElementById("e-notes").value.trim();
  a.knownIssues=document.getElementById("e-issues").value.trim();
  closeModal();toast("Evaluation updated");state.agent=a;render();
}

function saveTriage(id){
  const r=requests.find(x=>x.id===id);if(!r)return;
  r.status=document.getElementById("t-status").value;
  r.priority=document.getElementById("t-priority").value;
  r.assignee=document.getElementById("t-assignee").value.trim();
  r.notes=document.getElementById("t-notes").value.trim();
  closeModal();toast("Request updated: "+r.title);render();
}

// ── RENDER ──
function renderSubTabs(){
  const reqCount=requests.filter(r=>r.status!=="Declined"&&r.status!=="Shipped").length;
  return `<div class="sub-tabs">
    <div class="sub-tab ${state.subTab==="agents"?"active":""}" onclick="switchSubTab('agents')">Agents<span class="count-badge">${agents.length}</span></div>
    <div class="sub-tab ${state.subTab==="requests"?"active":""}" onclick="switchSubTab('requests')">Requests<span class="count-badge">${reqCount}</span></div>
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
    <p class="count-line">${filtered.length} agent${filtered.length!==1?"s":""} across the team. Click one to see its SOP, eval status, and how to use it.</p>
    <div class="filters">
      ${cats.map(c=>`<button class="filter-chip ${state.catFilter===c?"active":""}" onclick="setFilter('cat','${c}')">${c}</button>`).join("")}
      <div class="filter-sep"></div>
      ${stats.map(s=>`<button class="filter-chip ${state.statusFilter===s?"active":""}" onclick="setFilter('status','${s}')">${s}</button>`).join("")}
    </div>
    <div class="card-grid">${filtered.map(a=>`
      <div class="card" onclick="openDetail('${a.id}')">
        <div class="card-top"><span class="card-id">${a.id}</span><span class="pill ${statusClass(a.status)}"><span class="dot"></span>${a.status}</span></div>
        <h3>${a.name}</h3><p>${a.tagline}</p>
        <div class="card-footer"><span class="card-meta">${platformIcon(a.platform)} ${a.platform}<span class="sep">&middot;</span>${a.category}</span><div class="avatar">${a.initials}</div></div>
      </div>`).join("")}</div>
    ${filtered.length===0?'<div class="empty-filter">No agents match these filters.</div>':""}`;
}

function renderRequests(){
  const groups={"In Progress":[],"Approved":[],"Requested":[],"Shipped":[],"Declined":[]};
  requests.forEach(r=>{if(groups[r.status])groups[r.status].push(r)});
  function grp(name,items){
    if(!items.length)return"";
    return `<div class="status-group"><div class="status-group-title">${name}<span class="group-count">${items.length}</span></div><div class="request-list">${items.map(r=>`
      <div class="request-card" onclick="openModal('triage',requests.find(x=>x.id==='${r.id}'))">
        <div class="request-left"><h3>${r.title}</h3><p>${escHtml(r.desc)}</p></div>
        <div class="request-right">
          <span class="pill ${reqStatusClass(r.status)}"><span class="dot"></span>${r.status}</span>
          <span class="pill ${priorityClass(r.priority)}">${r.priority}</span>
          <div class="request-meta">${r.requestedBy}<br>${r.date}${r.assignee?`<br><b>${r.assignee}</b>`:""}</div>
        </div>
      </div>`).join("")}</div></div>`;
  }
  const active=["In Progress","Approved","Requested"].map(g=>grp(g,groups[g])).join("");
  const done=["Shipped","Declined"].filter(g=>groups[g].length).map(g=>grp(g,groups[g])).join("");
  return `
    <div class="section-header"><h2>AGENTS</h2><div class="actions"><button class="btn btn-primary" onclick="openModal('request')">+ New request</button><button class="btn" onclick="openModal('addAgent')">Add agent</button></div></div>
    ${renderSubTabs()}
    <p class="count-line">Agent requests from the team. Click a request to triage it.</p>
    ${active}
    ${done?`<div class="resolved-divider"><div class="resolved-title">RESOLVED</div>${done}</div>`:""}`;
}

function renderDetail(a){
  const hasEval=a.evalNotes||a.lastReviewed;
  const sopLines=a.sop.split("\n").filter(Boolean);
  return `<div class="detail">
    <button class="back-btn" onclick="goBack()"><span>&lsaquo;</span> Back to Directory</button>
    <div class="detail-header">
      <div class="detail-eyebrow">AGENT ${a.id}</div>
      <button class="btn btn-sm" onclick="openModal('editAgent',agents.find(x=>x.id==='${a.id}'))">Edit</button>
    </div>
    <h1>${a.name}</h1>
    <p class="tagline">${a.tagline}</p>
    <div class="pills">
      <span class="pill ${statusClass(a.status)}"><span class="dot"></span>${a.status}</span>
      <span class="pill pill-neutral">${a.category}</span>
      <span class="pill pill-neutral">${platformIcon(a.platform)} ${a.platform}</span>
      <span class="pill pill-neutral pill-owner"><span class="mini-avatar">${a.initials}</span>${a.owner}</span>
    </div>
    <div class="section"><div class="section-title">When to use</div><div class="section-body">${a.when}</div></div>
    <div class="section"><div class="section-title">SOP &mdash; How to use this agent</div><div class="section-body">${sopLines.map(s=>`<div class="step">${s}</div>`).join("")}</div></div>
    <div class="io-grid">
      <div class="io-box"><h4>INPUTS</h4>${a.inputs.length?a.inputs.map(i=>`<div class="item">&bull; ${i}</div>`).join(""):'<div class="item empty">None specified</div>'}</div>
      <div class="io-box"><h4>OUTPUTS</h4>${a.outputs.length?a.outputs.map(o=>`<div class="item">&bull; ${o}</div>`).join(""):'<div class="item empty">None specified</div>'}</div>
    </div>
    ${(a.integrations&&a.integrations.length)||a.accessUrl||a.repoUrl?`<div class="section"><div class="section-title">Technical Details</div><div class="section-body">
      ${a.integrations&&a.integrations.length?`<div class="detail-meta-line"><strong>Integrations:</strong> ${a.integrations.join(", ")}</div>`:""}
      ${a.accessUrl?`<div class="detail-access-line"><strong>Access:</strong> <a href="${escHtml(a.accessUrl)}">${escHtml(a.accessUrl)}</a></div>`:""}
      ${a.repoUrl?`<div><strong>Repo:</strong> <a href="${escHtml(a.repoUrl)}">${escHtml(a.repoUrl)}</a></div>`:""}
    </div></div>`:""}
    <div class="section">
      <div class="section-title" style="display:flex;justify-content:space-between;align-items:center">Eval &amp; Observability<button class="btn-ghost btn-sm" onclick="openModal('eval',agents.find(x=>x.id==='${a.id}'))">Update eval</button></div>
      <div class="eval-pill-row"><span class="pill ${evalClass(a.evalStatus)}">${a.evalStatus}</span>${a.lastReviewed?`<span class="date">Last reviewed: ${formatDate(a.lastReviewed)}</span>`:""}</div>
      ${a.evalNotes?`<div class="notes-box"><h4>NOTES</h4><p>${a.evalNotes}</p></div>`:""}
      ${a.knownIssues?`<div class="issues-box"><h4>KNOWN ISSUES</h4><p>${a.knownIssues}</p></div>`:""}
      ${!hasEval?`<div class="empty-eval"><p>This agent hasn't been evaluated yet.</p><div class="cta" onclick="openModal('eval',agents.find(x=>x.id==='${a.id}'))">Add an evaluation &rarr;</div></div>`:""}
    </div>
    <button class="contact-btn">&#x1F4AC; Message ${a.owner} on Slack</button>
  </div>`;
}

function render(){
  const app=document.getElementById("app");
  if(state.view==="detail"&&state.agent){app.innerHTML=renderDetail(state.agent);return}
  app.innerHTML=state.subTab==="agents"?renderAgentsList():renderRequests();
}

function setFilter(t,v){if(t==="cat")state.catFilter=v;else state.statusFilter=v;render()}
function openDetail(id){state.agent=agents.find(a=>a.id===id);state.view="detail";render();window.scrollTo(0,0)}
function goBack(){state.view="list";state.agent=null;render()}
function switchSubTab(tab){state.subTab=tab;state.view="list";render()}

render();
