const API_BASE = "https://api.mimuu.ai";
let token = "", ownerName = "", currentSlug = null, currentProject = null, streaming = false;

if (window.marked) marked.setOptions({ breaks: true, gfm: true });
function md(t) { try { return marked.parse(t||""); } catch { return esc(t); } }
function esc(s) { const d=document.createElement("div"); d.textContent=s; return d.innerHTML; }

// Auth
function loadAuth() {
  try { const s=JSON.parse(localStorage.getItem("mimuu_chat")||"{}"); if(s.token){token=s.token;ownerName=s.ownerName||"";return true;} } catch{} return false;
}
function logout() { localStorage.removeItem("mimuu_chat"); location.href="/chat"; }
function hdr() { return {Authorization:`Bearer ${token}`}; }
function hdrJson() { return {...hdr(),"Content-Type":"application/json"}; }

// Sidebar
function initSidebar() {
  const av=document.getElementById("userAvatar"), un=document.getElementById("userName");
  if(av&&ownerName) av.textContent=ownerName[0].toUpperCase();
  if(un) un.textContent=ownerName||"Usuário";
  document.getElementById("logoutSidebar")?.addEventListener("click",logout);
  document.getElementById("menuBtn")?.addEventListener("click",()=>{
    if(window.innerWidth<=768){document.getElementById("sidebar")?.classList.add("open");document.getElementById("sidebarOverlay")?.classList.add("vis");}
    else document.getElementById("sidebar")?.classList.remove("collapsed");
  });
  document.getElementById("sidebarClose")?.addEventListener("click",()=>{
    if(window.innerWidth<=768)closeMobile();
    else document.getElementById("sidebar")?.classList.toggle("collapsed");
  });
  document.getElementById("sidebarOverlay")?.addEventListener("click",closeMobile);
}
function closeMobile(){document.getElementById("sidebar")?.classList.remove("open");document.getElementById("sidebarOverlay")?.classList.remove("vis");}

async function loadSidebarProjects(projects) {
  const c=document.getElementById("sidebarProjects"); if(!c) return;
  if(!projects||!projects.length){c.innerHTML='<div style="padding:8px 10px;font-size:12px;color:#6b6860">Nenhum projeto</div>';return;}
  c.innerHTML=projects.map(p=>`<div class="project-sidebar-item ${currentSlug===p.slug?'active':''}" onclick="openProject('${p.slug}')">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
    <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.name)}</span>
  </div>`).join("");
}

// Projects list
let allProjects=[];
async function loadProjects() {
  try {
    const r=await fetch(`${API_BASE}/api/projects`,{headers:hdr()});
    if(r.status===401){logout();return;}
    allProjects=await r.json();
    renderGrid(allProjects);
    loadSidebarProjects(allProjects);
  } catch(e) {
    document.getElementById("projectsGrid").innerHTML=`<div class="empty-state"><h3>Erro</h3><p>${e.message}</p></div>`;
  }
}

function renderGrid(list) {
  const g=document.getElementById("projectsGrid");
  if(!list.length){g.innerHTML='<div class="empty-state"><h3>Nenhum projeto</h3><p>Crie o primeiro projeto clicando em "Novo"</p></div>';return;}
  g.innerHTML=list.map(p=>{
    const d=new Date(p.updated_at||p.created_at).toLocaleDateString("pt-BR");
    return `<div class="project-card" onclick="openProject('${p.slug}')">
      <button class="del-btn" onclick="event.stopPropagation();delProject('${p.slug}','${p.name.replace(/'/g,"\\'")}')">✕</button>
      <h3>${esc(p.name)}</h3><p>${esc((p.description||"Sem descrição").slice(0,100))}</p>
      <div class="meta">Atualizado em ${d}</div>
    </div>`;
  }).join("");
}

// Create / Delete
function showCreate(){document.getElementById("createModal").classList.add("active");document.getElementById("projectName").focus();}
function hideCreate(){document.getElementById("createModal").classList.remove("active");document.getElementById("projectName").value="";document.getElementById("projectDesc").value="";}

async function doCreate() {
  const name=document.getElementById("projectName").value.trim(), desc=document.getElementById("projectDesc").value.trim();
  if(!name)return;
  const btn=document.getElementById("confirmCreate"); btn.disabled=true; btn.textContent="Criando...";
  try{
    const r=await fetch(`${API_BASE}/api/projects`,{method:"POST",headers:hdrJson(),body:JSON.stringify({name,description:desc})});
    if(!r.ok){alert((await r.json()).detail||"Erro");return;}
    hideCreate(); openProject((await r.json()).slug);
  }catch(e){alert(e.message);}
  finally{btn.disabled=false;btn.textContent="Criar";}
}

async function delProject(slug,name) {
  if(!confirm(`Deletar "${name}"?`))return;
  try{await fetch(`${API_BASE}/api/projects/${slug}`,{method:"DELETE",headers:hdr()});loadProjects();}catch(e){alert(e.message);}
}

// Open / Close project
async function openProject(slug) {
  currentSlug=slug; closeMobile();
  try{
    const r=await fetch(`${API_BASE}/api/projects/${slug}`,{headers:hdr()});
    if(!r.ok){alert("Não encontrado");return;}
    currentProject=await r.json();
    document.getElementById("wsTitle").textContent=currentProject.name;
  }catch(e){alert(e.message);return;}
  document.getElementById("listView").style.display="none";
  document.getElementById("workspaceView").classList.add("active");
  loadSidebarProjects(allProjects);
  await Promise.all([loadHistory(slug),refreshFiles(slug),refreshPreview(slug)]);
  history.pushState({slug},"",`?project=${slug}`);
}

function closeProject() {
  currentSlug=null; currentProject=null;
  document.getElementById("listView").style.display="";
  document.getElementById("workspaceView").classList.remove("active");
  document.getElementById("wsMessages").innerHTML="";
  document.getElementById("fileDrawer").classList.remove("open");
  document.getElementById("previewFrame").style.display="none";
  document.getElementById("noPreview").style.display="";
  history.pushState({},"","/projects");
  loadProjects();
}

// History
async function loadHistory(slug) {
  const c=document.getElementById("wsMessages"); c.innerHTML="";
  try{
    const r=await fetch(`${API_BASE}/api/projects/${slug}/history?limit=50`,{headers:hdr()});
    if(!r.ok)return;
    for(const m of await r.json()){
      const txt = m.text || m.content || "";
      if(!txt) continue;
      const d=document.createElement("div");
      d.className=`ws-msg ${m.role==="user"?"user":"ai"}`;
      if(m.role==="user"){d.innerHTML=`<span>${esc(txt)}</span>`;}else{d.innerHTML=md(txt);}
      c.appendChild(d);
    }
    c.scrollTop=c.scrollHeight;
  }catch{}
}

// Stream chat
async function sendMsg() {
  const inp=document.getElementById("wsInput"), msg=inp.value.trim();
  if(!msg||streaming||!currentSlug)return;
  inp.value=""; inp.style.height="auto"; streaming=true;
  const c=document.getElementById("wsMessages");
  const u=document.createElement("div"); u.className="ws-msg user"; u.innerHTML=`<span>${esc(msg)}</span>`; c.appendChild(u);
  const ai=document.createElement("div"); ai.className="ws-msg ai"; ai.innerHTML='<span class="sc"></span><span class="thinking-dot"></span>'; c.appendChild(ai); c.scrollTop=c.scrollHeight;
  const sc=ai.querySelector(".sc"); let full="";
  try{
    const r=await fetch(`${API_BASE}/api/projects/${currentSlug}/chat/stream`,{method:"POST",headers:hdrJson(),body:JSON.stringify({message:msg})});
    if(!r.ok){sc.textContent=`❌ ${(await r.json().catch(()=>({}))).detail||"Erro"}`;ai.querySelector(".thinking-dot")?.remove();streaming=false;return;}
    const rd=r.body.getReader(), dec=new TextDecoder(); let buf="";
    while(true){
      const{done,value}=await rd.read(); if(done)break;
      buf+=dec.decode(value,{stream:true}); const lines=buf.split("\n"); buf=lines.pop()||"";
      for(const l of lines){if(!l.startsWith("data:"))continue;const p=l.slice(5).trim();if(p==="[DONE]")break;try{const d=JSON.parse(p);if(d.token){full+=d.token;sc.textContent=full;c.scrollTop=c.scrollHeight;}if(d.done)break;}catch{}}
    }
  }catch(e){sc.textContent=`❌ ${e.message}`;}
  ai.querySelector(".thinking-dot")?.remove();
  // Collapse large code blocks for cleaner UX
  let rendered = md(full||"(sem resposta)");
  sc.innerHTML = rendered;
  // Find pre blocks > 200px and collapse them
  sc.querySelectorAll('pre').forEach(pre => {
    if(pre.scrollHeight > 250) {
      pre.style.maxHeight = '120px';
      pre.style.overflow = 'hidden';
      pre.style.position = 'relative';
      const btn = document.createElement('button');
      btn.textContent = '▼ Ver código completo';
      btn.style.cssText = 'display:block;width:100%;padding:6px;border:none;background:#2a2a4e;color:#ffc928;font-size:12px;cursor:pointer;border-radius:0 0 8px 8px;margin-top:-4px;';
      btn.onclick = () => { pre.style.maxHeight='none'; pre.style.overflow='auto'; btn.remove(); };
      pre.after(btn);
    }
  });
  c.scrollTop=c.scrollHeight; streaming=false;
  setTimeout(()=>{refreshPreview(currentSlug);refreshFiles(currentSlug);},1500);
}

// Files
async function refreshFiles(slug) {
  if(!slug)return;
  const c=document.getElementById("fileList"); c.innerHTML="";
  try{
    const r=await fetch(`${API_BASE}/api/projects/${slug}`,{headers:hdr()});if(!r.ok)return;
    const d=await r.json(), files=d.files||[];
    if(!files.length){c.innerHTML='<div style="padding:8px 12px;font-size:12px;color:var(--text-placeholder)">Nenhum arquivo</div>';return;}
    c.innerHTML=files.map(f=>{
      const ic=f.endsWith('.html')?'🌐':f.endsWith('.css')?'🎨':f.endsWith('.js')?'⚡':f.endsWith('.md')?'📝':'📄';
      return `<div class="fd-item ${f==='artifact.html'?'artifact':''}" onclick="viewFile('${f.replace(/'/g,"\\'")}')">${ic} <span style="overflow:hidden;text-overflow:ellipsis">${esc(f)}</span></div>`;
    }).join("");
  }catch{}
}

async function viewFile(path) {
  if(!currentSlug)return;
  if(path.endsWith('.html')){
    try{const r=await fetch(`${API_BASE}/api/projects/${currentSlug}/files/${path}`,{headers:hdr()});if(r.ok){const h=await r.text();document.getElementById("previewFrame").srcdoc=sandboxHtml(h);document.getElementById("previewFrame").style.display="";document.getElementById("noPreview").style.display="none";document.getElementById("previewTitle").textContent=path;}}catch{}
    return;
  }
  try{
    const r=await fetch(`${API_BASE}/api/projects/${currentSlug}/files/${path}`,{headers:hdr()});if(!r.ok)return;
    const t=await r.text();
    document.getElementById("fileViewerName").textContent=path;
    const ed=document.getElementById("fileViewerContent"); ed.value=t;
    const editable=['.md','.txt','.css','.js','.json','.html','.py','.ts'];
    ed.readOnly=!editable.some(e=>path.endsWith(e));
    const sb=document.getElementById("fileSaveBtn"); sb.style.display=ed.readOnly?"none":""; sb.dataset.path=path;
    document.getElementById("fileModal").classList.add("active");
  }catch{}
}

async function saveFile() {
  const path=document.getElementById("fileSaveBtn").dataset.path, content=document.getElementById("fileViewerContent").value;
  if(!currentSlug||!path)return;
  const btn=document.getElementById("fileSaveBtn"); btn.disabled=true; btn.textContent="Salvando...";
  try{
    const r=await fetch(`${API_BASE}/api/projects/${currentSlug}/files/${path}`,{method:"PUT",headers:hdrJson(),body:JSON.stringify({content})});
    if(r.ok){document.getElementById("fileModal").classList.remove("active");refreshFiles(currentSlug);if(path.endsWith('.html'))refreshPreview(currentSlug);}
    else alert((await r.json().catch(()=>({}))).detail||"Erro");
  }catch(e){alert(e.message);}
  finally{btn.disabled=false;btn.textContent="Salvar";}
}

// Context
async function openContext() {
  if(!currentSlug||!currentProject)return;
  document.getElementById("contextEditor").value=currentProject.context||"";
  document.getElementById("contextModal").classList.add("active");
}

async function saveContext() {
  if(!currentSlug)return;
  const content=document.getElementById("contextEditor").value;
  const btn=document.getElementById("saveContext"); btn.disabled=true; btn.textContent="Salvando...";
  try{
    const r=await fetch(`${API_BASE}/api/projects/${currentSlug}/context`,{method:"PUT",headers:hdrJson(),body:JSON.stringify({content})});
    if(r.ok){document.getElementById("contextModal").classList.remove("active");if(currentProject)currentProject.context=content;}
    else alert((await r.json().catch(()=>({}))).detail||"Erro");
  }catch(e){alert(e.message);}
  finally{btn.disabled=false;btn.textContent="Salvar";}
}

// Preview
function sandboxHtml(html) {
  // Inject script that intercepts ALL link clicks and prevents navigation
  // Also intercepts form submits. Everything stays inside the preview.
  const script = `<script>
document.addEventListener('click', function(e) {
  var a = e.target.closest('a');
  if (a) {
    e.preventDefault();
    e.stopPropagation();
    // If it's an anchor link (#section), scroll to it
    var href = a.getAttribute('href') || '';
    if (href.startsWith('#')) {
      var target = document.querySelector(href);
      if (target) target.scrollIntoView({behavior:'smooth'});
    }
    // Otherwise do nothing — no external navigation
  }
}, true);
document.addEventListener('submit', function(e) { e.preventDefault(); }, true);
<\/script>`;
  
  if (html.includes('</body>')) return html.replace('</body>', script + '</body>');
  if (html.includes('</html>')) return html.replace('</html>', script + '</html>');
  return html + script;
}

async function refreshPreview(slug) {
  if(!slug)return;
  try{
    const r=await fetch(`${API_BASE}/api/projects/${slug}/artifact`,{headers:hdr()});
    if(r.ok){const html=await r.text();document.getElementById("previewFrame").srcdoc=sandboxHtml(html);document.getElementById("previewFrame").style.display="";document.getElementById("noPreview").style.display="none";document.getElementById("previewTitle").textContent="artifact.html";}
    else{document.getElementById("previewFrame").style.display="none";document.getElementById("noPreview").style.display="";}
  }catch{}
}

// Events
document.getElementById("newProjectBtn")?.addEventListener("click",showCreate);
document.getElementById("cancelCreate")?.addEventListener("click",hideCreate);
document.getElementById("confirmCreate")?.addEventListener("click",doCreate);
document.getElementById("projectName")?.addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();doCreate();}});
document.getElementById("backBtn")?.addEventListener("click",closeProject);
document.getElementById("filesBtn")?.addEventListener("click",()=>document.getElementById("fileDrawer").classList.toggle("open"));
document.getElementById("closeFiles")?.addEventListener("click",()=>document.getElementById("fileDrawer").classList.remove("open"));
document.getElementById("contextBtn")?.addEventListener("click",openContext);
document.getElementById("cancelContext")?.addEventListener("click",()=>document.getElementById("contextModal").classList.remove("active"));
document.getElementById("saveContext")?.addEventListener("click",saveContext);
document.getElementById("closeFileViewer")?.addEventListener("click",()=>document.getElementById("fileModal").classList.remove("active"));
document.getElementById("fileSaveBtn")?.addEventListener("click",saveFile);
document.getElementById("refreshPreview")?.addEventListener("click",()=>refreshPreview(currentSlug));
document.getElementById("wsSend")?.addEventListener("click",sendMsg);
document.getElementById("wsInput")?.addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendMsg();}});
document.getElementById("wsInput")?.addEventListener("input",function(){this.style.height="auto";this.style.height=Math.min(this.scrollHeight,120)+"px";});
window.addEventListener("popstate",e=>{if(e.state?.slug)openProject(e.state.slug);else closeProject();});

// Init
if(!loadAuth()){location.href="/chat";}
else{
  initSidebar();
  const p=new URLSearchParams(location.search).get("project");
  if(p){loadProjects().then(()=>openProject(p));}
  else loadProjects();
}
