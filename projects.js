const API_BASE = "https://api.mimuu.ai";

let token = "";
let currentSlug = null;
let streaming = false;

// --- Auth ---
function loadAuth() {
  try {
    const saved = JSON.parse(localStorage.getItem("mimuu_chat") || "{}");
    if (saved.token) { token = saved.token; return true; }
  } catch {}
  return false;
}

function logout() {
  localStorage.removeItem("mimuu_chat");
  window.location.href = "/chat";
}

function authHeaders() {
  return { Authorization: `Bearer ${token}` };
}

// --- Projects List ---
async function loadProjects() {
  const container = document.getElementById("projects-container");
  try {
    const res = await fetch(`${API_BASE}/api/projects`, { headers: authHeaders() });
    if (res.status === 401) { logout(); return; }
    const projects = await res.json();
    renderProjectsList(projects);
  } catch (e) {
    container.innerHTML = `<div class="empty-state"><div class="icon">⚠️</div><h3>Erro ao carregar projetos</h3><p>${e.message}</p></div>`;
  }
}

function renderProjectsList(projects) {
  const container = document.getElementById("projects-container");
  
  let html = '<div class="projects-grid">';
  html += `<div class="new-project-card" onclick="showCreateModal()">
    <span class="plus">+</span> Novo Projeto
  </div>`;
  
  for (const p of projects) {
    const date = new Date(p.updated_at || p.created_at).toLocaleDateString("pt-BR");
    const desc = (p.description || "Sem descrição").slice(0, 100);
    html += `
      <div class="project-card" onclick="openProject('${p.slug}')">
        <button class="delete-btn" onclick="event.stopPropagation(); deleteProject('${p.slug}', '${p.name.replace(/'/g, "\\'")}')">✕</button>
        <h3>${escHtml(p.name)}</h3>
        <p>${escHtml(desc)}</p>
        <div class="meta">Atualizado em ${date}</div>
      </div>
    `;
  }
  
  if (projects.length === 0) {
    html += `
      <div style="grid-column: 1/-1; text-align:center; padding:40px; color:var(--muted)">
        <p>Nenhum projeto ainda. Crie o primeiro! 🚀</p>
      </div>
    `;
  }
  
  html += '</div>';
  container.innerHTML = html;
}

// --- Create Project ---
function showCreateModal() {
  document.getElementById("create-modal").classList.add("active");
  document.getElementById("project-name").focus();
}

function hideCreateModal() {
  document.getElementById("create-modal").classList.remove("active");
  document.getElementById("project-name").value = "";
  document.getElementById("project-desc").value = "";
}

async function createProject() {
  const name = document.getElementById("project-name").value.trim();
  const description = document.getElementById("project-desc").value.trim();
  if (!name) return;
  
  const btn = document.getElementById("confirm-create");
  btn.disabled = true;
  btn.textContent = "Criando...";
  
  try {
    const res = await fetch(`${API_BASE}/api/projects`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ name, description }),
    });
    
    if (!res.ok) {
      const err = await res.json();
      alert(err.detail || "Erro ao criar projeto");
      return;
    }
    
    const project = await res.json();
    hideCreateModal();
    openProject(project.slug);
  } catch (e) {
    alert("Erro: " + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Criar";
  }
}

// --- Delete Project ---
async function deleteProject(slug, name) {
  if (!confirm(`Deletar projeto "${name}"? Todos os arquivos serão removidos.`)) return;
  
  try {
    const res = await fetch(`${API_BASE}/api/projects/${slug}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    if (res.ok) loadProjects();
    else alert("Erro ao deletar");
  } catch (e) {
    alert("Erro: " + e.message);
  }
}

// --- Open Project (Workspace View) ---
async function openProject(slug) {
  currentSlug = slug;
  
  // Fetch project details
  try {
    const res = await fetch(`${API_BASE}/api/projects/${slug}`, { headers: authHeaders() });
    if (!res.ok) { alert("Projeto não encontrado"); return; }
    const project = await res.json();
    
    document.getElementById("project-title").textContent = project.name;
    document.getElementById("brand-title").textContent = project.name;
  } catch (e) {
    alert("Erro: " + e.message);
    return;
  }
  
  // Switch views
  document.getElementById("list-view").style.display = "none";
  document.getElementById("workspace-view").classList.add("active");
  
  // Load history
  await loadProjectHistory(slug);
  
  // Load preview
  await refreshPreview(slug);
  
  // Update URL
  history.pushState({ slug }, "", `?project=${slug}`);
}

function closeProject() {
  currentSlug = null;
  document.getElementById("list-view").style.display = "";
  document.getElementById("workspace-view").classList.remove("active");
  document.getElementById("messages").innerHTML = "";
  document.getElementById("brand-title").textContent = "Meus Projetos";
  document.getElementById("no-preview").style.display = "";
  document.getElementById("preview-frame").style.display = "none";
  history.pushState({}, "", "/projects");
  loadProjects();
}

// --- Chat History ---
async function loadProjectHistory(slug) {
  const container = document.getElementById("messages");
  container.innerHTML = "";
  
  try {
    const res = await fetch(`${API_BASE}/api/projects/${slug}/history?limit=50`, { headers: authHeaders() });
    if (!res.ok) return;
    const msgs = await res.json();
    
    for (const m of msgs) {
      const div = document.createElement("div");
      div.className = `msg ${m.role === "user" ? "user" : "ai"}`;
      if (m.role === "user") {
        div.textContent = m.content;
      } else {
        div.innerHTML = marked.parse(m.content || "");
      }
      container.appendChild(div);
    }
    container.scrollTop = container.scrollHeight;
  } catch {}
}

// --- Chat Streaming ---
async function sendMessage() {
  const input = document.getElementById("input");
  const message = input.value.trim();
  if (!message || streaming || !currentSlug) return;
  
  input.value = "";
  streaming = true;
  
  // Add user message
  const msgsEl = document.getElementById("messages");
  const userDiv = document.createElement("div");
  userDiv.className = "msg user";
  userDiv.textContent = message;
  msgsEl.appendChild(userDiv);
  
  // Add AI bubble with thinking indicator
  const aiDiv = document.createElement("div");
  aiDiv.className = "msg ai streaming";
  aiDiv.innerHTML = '<span class="stream-content"></span><span class="thinking-dot"></span>';
  msgsEl.appendChild(aiDiv);
  msgsEl.scrollTop = msgsEl.scrollHeight;
  
  const contentEl = aiDiv.querySelector(".stream-content");
  let fullText = "";
  
  try {
    const res = await fetch(`${API_BASE}/api/projects/${currentSlug}/chat/stream`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });
    
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: "Erro desconhecido" }));
      contentEl.textContent = `❌ ${err.detail}`;
      aiDiv.classList.remove("streaming");
      streaming = false;
      return;
    }
    
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      
      const lines = buf.split("\n");
      buf = lines.pop() || "";
      
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") break;
        try {
          const data = JSON.parse(payload);
          if (data.token) {
            fullText += data.token;
            contentEl.textContent = fullText;
            msgsEl.scrollTop = msgsEl.scrollHeight;
          }
          if (data.done) break;
        } catch {}
      }
    }
  } catch (e) {
    contentEl.textContent = `❌ ${e.message}`;
  }
  
  // Finish: render markdown
  aiDiv.classList.remove("streaming");
  const dot = aiDiv.querySelector(".thinking-dot");
  if (dot) dot.remove();
  contentEl.innerHTML = marked.parse(fullText || "(sem resposta)");
  msgsEl.scrollTop = msgsEl.scrollHeight;
  
  streaming = false;
  
  // Auto-refresh preview after AI responds (might have generated an artifact)
  setTimeout(() => refreshPreview(currentSlug), 1500);
}

// --- Preview ---
async function refreshPreview(slug) {
  if (!slug) return;
  
  try {
    const res = await fetch(`${API_BASE}/api/projects/${slug}/artifact`, { headers: authHeaders() });
    if (res.ok) {
      const html = await res.text();
      const frame = document.getElementById("preview-frame");
      frame.srcdoc = html;
      frame.style.display = "";
      document.getElementById("no-preview").style.display = "none";
    } else {
      document.getElementById("preview-frame").style.display = "none";
      document.getElementById("no-preview").style.display = "";
    }
  } catch {}
}

// --- Helpers ---
function escHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

// --- Event Listeners ---
document.getElementById("logout-btn").addEventListener("click", logout);
document.getElementById("back-btn").addEventListener("click", closeProject);
document.getElementById("cancel-create").addEventListener("click", hideCreateModal);
document.getElementById("confirm-create").addEventListener("click", createProject);
document.getElementById("refresh-preview").addEventListener("click", () => refreshPreview(currentSlug));

document.getElementById("send-btn").addEventListener("click", sendMessage);
document.getElementById("input").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});

// Auto-resize textarea
document.getElementById("input").addEventListener("input", function() {
  this.style.height = "auto";
  this.style.height = Math.min(this.scrollHeight, 120) + "px";
});

// Create modal: Enter to submit
document.getElementById("project-name").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); createProject(); }
});

// --- Init ---
if (!loadAuth()) {
  window.location.href = "/chat";
} else {
  // Check URL for project param
  const params = new URLSearchParams(location.search);
  const projectSlug = params.get("project");
  if (projectSlug) {
    openProject(projectSlug);
  } else {
    loadProjects();
  }
}

// Handle browser back/forward
window.addEventListener("popstate", (e) => {
  if (e.state?.slug) {
    openProject(e.state.slug);
  } else {
    closeProject();
  }
});
