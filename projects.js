const API_BASE = "https://api.mimuu.ai";

let token = "";
let currentSlug = null;
let streaming = false;
let currentProject = null;

// Configure marked
if (window.marked) marked.setOptions({ breaks: true, gfm: true });
function renderMd(text) {
  if (!window.marked || !text) return escHtml(text || "");
  try { return marked.parse(text); } catch { return escHtml(text); }
}

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
function authHeaders() { return { Authorization: `Bearer ${token}` }; }

// --- Projects List ---
async function loadProjects() {
  const container = document.getElementById("projects-container");
  try {
    const res = await fetch(`${API_BASE}/api/projects`, { headers: authHeaders() });
    if (res.status === 401) { logout(); return; }
    const projects = await res.json();
    renderProjectsList(projects);
  } catch (e) {
    container.innerHTML = `<div class="empty-state"><div class="icon">⚠️</div><h3>Erro ao carregar</h3><p>${e.message}</p></div>`;
  }
}

function renderProjectsList(projects) {
  const container = document.getElementById("projects-container");
  let html = '<div class="projects-grid">';
  html += `<div class="new-project-card" onclick="showCreateModal()"><span class="plus">+</span> Novo Projeto</div>`;
  for (const p of projects) {
    const date = new Date(p.updated_at || p.created_at).toLocaleDateString("pt-BR");
    const desc = (p.description || "Sem descrição").slice(0, 100);
    html += `
      <div class="project-card" onclick="openProject('${p.slug}')">
        <button class="delete-btn" onclick="event.stopPropagation(); deleteProject('${p.slug}', '${p.name.replace(/'/g, "\\'")}')">✕</button>
        <h3>${escHtml(p.name)}</h3>
        <p>${escHtml(desc)}</p>
        <div class="meta">Atualizado em ${date}</div>
      </div>`;
  }
  if (!projects.length) {
    html += `<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--muted)"><p>Nenhum projeto ainda. Crie o primeiro! 🚀</p></div>`;
  }
  html += '</div>';
  container.innerHTML = html;
}

// --- Create/Delete ---
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
  btn.disabled = true; btn.textContent = "Criando...";
  try {
    const res = await fetch(`${API_BASE}/api/projects`, {
      method: "POST", headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ name, description }),
    });
    if (!res.ok) { const err = await res.json(); alert(err.detail || "Erro"); return; }
    const project = await res.json();
    hideCreateModal();
    openProject(project.slug);
  } catch (e) { alert("Erro: " + e.message); }
  finally { btn.disabled = false; btn.textContent = "Criar"; }
}

async function deleteProject(slug, name) {
  if (!confirm(`Deletar "${name}"? Todos os arquivos serão removidos.`)) return;
  try {
    const res = await fetch(`${API_BASE}/api/projects/${slug}`, { method: "DELETE", headers: authHeaders() });
    if (res.ok) loadProjects(); else alert("Erro ao deletar");
  } catch (e) { alert("Erro: " + e.message); }
}

// --- Open Project ---
async function openProject(slug) {
  currentSlug = slug;
  try {
    const res = await fetch(`${API_BASE}/api/projects/${slug}`, { headers: authHeaders() });
    if (!res.ok) { alert("Projeto não encontrado"); return; }
    currentProject = await res.json();
    document.getElementById("project-title").textContent = currentProject.name;
    document.getElementById("brand-title").textContent = currentProject.name;
  } catch (e) { alert("Erro: " + e.message); return; }

  document.getElementById("list-view").style.display = "none";
  document.getElementById("workspace-view").classList.add("active");

  await Promise.all([
    loadProjectHistory(slug),
    refreshFileList(slug),
    refreshPreview(slug),
  ]);

  history.pushState({ slug }, "", `?project=${slug}`);
}

function closeProject() {
  currentSlug = null;
  currentProject = null;
  document.getElementById("list-view").style.display = "";
  document.getElementById("workspace-view").classList.remove("active");
  document.getElementById("messages").innerHTML = "";
  document.getElementById("brand-title").textContent = "Meus Projetos";
  document.getElementById("preview-frame").style.display = "none";
  document.getElementById("no-preview").style.display = "";
  document.getElementById("file-panel").classList.remove("active");
  history.pushState({}, "", "/projects");
  loadProjects();
}

// --- File Panel ---
async function refreshFileList(slug) {
  if (!slug) return;
  const list = document.getElementById("file-list");
  list.innerHTML = '<div style="color:var(--muted);font-size:12px;padding:8px">Carregando...</div>';

  try {
    const res = await fetch(`${API_BASE}/api/projects/${slug}`, { headers: authHeaders() });
    if (!res.ok) return;
    const data = await res.json();
    const files = data.files || [];

    if (!files.length) {
      list.innerHTML = '<div style="color:var(--muted);font-size:12px;padding:8px">Nenhum arquivo ainda</div>';
      return;
    }

    list.innerHTML = files.map(f => {
      const icon = f.endsWith('.html') ? '🌐' : f.endsWith('.css') ? '🎨' : f.endsWith('.js') ? '⚡' : f.endsWith('.md') ? '📝' : '📄';
      const isArtifact = f === 'artifact.html';
      return `<div class="file-item ${isArtifact ? 'artifact' : ''}" onclick="viewFile('${escAttr(f)}')" title="${escHtml(f)}">
        <span>${icon}</span>
        <span class="file-name">${escHtml(f)}</span>
      </div>`;
    }).join('');
  } catch {}
}

async function viewFile(filePath) {
  if (!currentSlug) return;

  // If it's an HTML file, show in preview
  if (filePath.endsWith('.html')) {
    try {
      const res = await fetch(`${API_BASE}/api/projects/${currentSlug}/files/${filePath}`, { headers: authHeaders() });
      if (res.ok) {
        const html = await res.text();
        const frame = document.getElementById("preview-frame");
        frame.srcdoc = html;
        frame.style.display = "";
        document.getElementById("no-preview").style.display = "none";
        document.getElementById("preview-title").textContent = filePath;
      }
    } catch {}
    return;
  }

  // For other files, show in a code viewer overlay
  try {
    const res = await fetch(`${API_BASE}/api/projects/${currentSlug}/files/${filePath}`, { headers: authHeaders() });
    if (!res.ok) { alert("Arquivo não encontrado"); return; }
    const content = await res.text();
    showFileViewer(filePath, content);
  } catch (e) { alert("Erro: " + e.message); }
}

function showFileViewer(name, content) {
  const modal = document.getElementById("file-viewer-modal");
  document.getElementById("file-viewer-name").textContent = name;
  const editor = document.getElementById("file-viewer-content");
  editor.value = content;
  editor.readOnly = !name.endsWith('.md') && !name.endsWith('.txt') && !name.endsWith('.css') && !name.endsWith('.js') && !name.endsWith('.json');
  document.getElementById("file-save-btn").style.display = editor.readOnly ? "none" : "";
  document.getElementById("file-save-btn").dataset.path = name;
  modal.classList.add("active");
}

function hideFileViewer() {
  document.getElementById("file-viewer-modal").classList.remove("active");
}

function toggleFilePanel() {
  document.getElementById("file-panel").classList.toggle("active");
}

// --- Context Editor ---
async function openContextEditor() {
  if (!currentSlug || !currentProject) return;
  const modal = document.getElementById("context-modal");
  document.getElementById("context-editor").value = currentProject.context || "";
  modal.classList.add("active");
}

async function saveContext() {
  if (!currentSlug) return;
  const content = document.getElementById("context-editor").value;
  const btn = document.getElementById("save-context");
  btn.disabled = true; btn.textContent = "Salvando...";
  try {
    const res = await fetch(`${API_BASE}/api/projects/${currentSlug}/context`, {
      method: "PUT",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
    if (res.ok) {
      document.getElementById("context-modal").classList.remove("active");
      if (currentProject) currentProject.context = content;
    } else {
      const err = await res.json().catch(() => ({}));
      alert(err.detail || "Erro ao salvar");
    }
  } catch (e) { alert("Erro: " + e.message); }
  finally { btn.disabled = false; btn.textContent = "Salvar"; }
}

async function saveFile() {
  const path = document.getElementById("file-save-btn").dataset.path;
  const content = document.getElementById("file-viewer-content").value;
  if (!currentSlug || !path) return;
  const btn = document.getElementById("file-save-btn");
  btn.disabled = true; btn.textContent = "Salvando...";
  try {
    const res = await fetch(`${API_BASE}/api/projects/${currentSlug}/files/${path}`, {
      method: "PUT",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
    if (res.ok) {
      hideFileViewer();
      refreshFileList(currentSlug);
      if (path.endsWith('.html')) refreshPreview(currentSlug);
    } else {
      const err = await res.json().catch(() => ({}));
      alert(err.detail || "Erro ao salvar");
    }
  } catch (e) { alert("Erro: " + e.message); }
  finally { btn.disabled = false; btn.textContent = "💾 Salvar"; }
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
      if (m.role === "user") div.textContent = m.content;
      else div.innerHTML = renderMd(m.content || "");
      container.appendChild(div);
    }
    container.scrollTop = container.scrollHeight;
  } catch {}
}

// --- Streaming Chat ---
async function sendMessage() {
  const input = document.getElementById("input");
  const message = input.value.trim();
  if (!message || streaming || !currentSlug) return;
  input.value = "";
  input.style.height = "auto";
  streaming = true;

  const msgsEl = document.getElementById("messages");

  // User bubble
  const userDiv = document.createElement("div");
  userDiv.className = "msg user";
  userDiv.textContent = message;
  msgsEl.appendChild(userDiv);

  // AI bubble
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
  contentEl.innerHTML = renderMd(fullText || "(sem resposta)");
  msgsEl.scrollTop = msgsEl.scrollHeight;
  streaming = false;

  // Auto-refresh preview + file list after AI responds
  setTimeout(() => {
    refreshPreview(currentSlug);
    refreshFileList(currentSlug);
  }, 1500);
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
      document.getElementById("preview-title").textContent = "artifact.html";
    } else {
      document.getElementById("preview-frame").style.display = "none";
      document.getElementById("no-preview").style.display = "";
    }
  } catch {}
}

// --- Helpers ---
function escHtml(s) { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; }
function escAttr(s) { return s.replace(/'/g, "\\'").replace(/"/g, "&quot;"); }

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
document.getElementById("input").addEventListener("input", function() {
  this.style.height = "auto";
  this.style.height = Math.min(this.scrollHeight, 120) + "px";
});
document.getElementById("project-name").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); createProject(); }
});

// File panel toggle
document.getElementById("files-toggle")?.addEventListener("click", toggleFilePanel);
document.getElementById("close-files")?.addEventListener("click", () => {
  document.getElementById("file-panel").classList.remove("active");
});

// Context editor
document.getElementById("context-btn")?.addEventListener("click", openContextEditor);
document.getElementById("cancel-context")?.addEventListener("click", () => {
  document.getElementById("context-modal").classList.remove("active");
});
document.getElementById("save-context")?.addEventListener("click", saveContext);

// File viewer
document.getElementById("close-file-viewer")?.addEventListener("click", hideFileViewer);
document.getElementById("file-save-btn")?.addEventListener("click", saveFile);

// --- Init ---
if (!loadAuth()) {
  window.location.href = "/chat";
} else {
  const params = new URLSearchParams(location.search);
  const projectSlug = params.get("project");
  if (projectSlug) openProject(projectSlug);
  else loadProjects();
}

window.addEventListener("popstate", (e) => {
  if (e.state?.slug) openProject(e.state.slug);
  else closeProject();
});
