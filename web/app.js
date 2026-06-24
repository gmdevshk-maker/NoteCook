function showTreeCtx(e, kind, id) {
  e.preventDefault();
  e.stopPropagation();
  const menu = document.getElementById('ctxMenu');
  let html;
  if (kind === 'notebook') {
    html = `
      <div class="ctx-item" onclick="addDocuments('${id}')"><i class="ti ti-file-plus"></i> 파일 추가</div>
      <div class="ctx-item" onclick="renameNotebook('${id}')"><i class="ti ti-pencil"></i> 이름 변경</div>
      <div class="ctx-divider"></div>
      <div class="ctx-item danger" onclick="deleteNotebook('${id}')"><i class="ti ti-trash"></i> 노트북 삭제</div>`;
  } else {
    html = `
      <div class="ctx-item" onclick="closeCtx();openSource('${id}')"><i class="ti ti-external-link"></i> 파일 열기</div>
      <div class="ctx-divider"></div>
      <div class="ctx-item danger" onclick="deleteDocument('${id}')"><i class="ti ti-trash"></i> 문서 삭제</div>`;
  }
  document.getElementById('ctxContent').innerHTML = html;
  menu.style.left = e.clientX + 'px';
  menu.style.top = e.clientY + 'px';
  menu.classList.add('visible');
}
function closeCtx() {
  document.getElementById('ctxMenu').classList.remove('visible');
}

// === 옵션 메뉴 / 다크 모드 ===
const THEME_KEY = 'notecook.theme';

function applyTheme(theme) {
  const dark = theme === 'dark';
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  document.getElementById('darkSwitch').classList.toggle('on', dark);
}
function toggleTheme() {
  const cur = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  const next = cur === 'dark' ? 'light' : 'dark';
  localStorage.setItem(THEME_KEY, next);
  applyTheme(next);
}
function toggleOptMenu(e) {
  e.stopPropagation();
  closeCtx();
  document.getElementById('optMenu').classList.toggle('visible');
}
function closeOptMenu() {
  document.getElementById('optMenu').classList.remove('visible');
}

// 저장된 테마 복원 (기본: 라이트)
applyTheme(localStorage.getItem(THEME_KEY) || 'light');

// 다크 모드 행 클릭 → 토글 (메뉴는 열린 채 유지해 즉시 결과 확인)
document.getElementById('darkModeItem').addEventListener('click', (e) => {
  e.stopPropagation();
  toggleTheme();
});

document.addEventListener('click', () => { closeCtx(); closeOptMenu(); closeSelPop(); closeSavedMenu(); });
document.addEventListener('contextmenu', (e) => {
  if (!e.target.closest('.tree-item')) closeCtx();
});

const sidebar = document.getElementById('sidebar');
const resizer = document.getElementById('resizer');
let isResizing = false;

resizer.addEventListener('mousedown', (e) => {
  isResizing = true;
  resizer.classList.add('dragging');
  document.body.style.cursor = 'col-resize';
  e.preventDefault();
});
document.addEventListener('mousemove', (e) => {
  if (!isResizing) return;
  const appRect = sidebar.parentElement.getBoundingClientRect();
  let newW = e.clientX - appRect.left;
  newW = Math.max(140, Math.min(360, newW));
  sidebar.style.width = newW + 'px';
});
document.addEventListener('mouseup', () => {
  if (isResizing) {
    isResizing = false;
    resizer.classList.remove('dragging');
    document.body.style.cursor = '';
  }
});

// === 모델 관리 모달 ===
const MODEL_KEY = 'notecook.model';

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function humanSize(bytes) {
  if (!bytes) return '';
  const gb = bytes / 1e9;
  if (gb >= 1) return gb.toFixed(1) + ' GB';
  return (bytes / 1e6).toFixed(0) + ' MB';
}
function getSelectedModel() { return localStorage.getItem(MODEL_KEY) || ''; }
function setSelectedModel(tag) {
  localStorage.setItem(MODEL_KEY, tag);
  document.getElementById('modelLabel').textContent = tag || '모델 미선택';
}

async function openModelModal() {
  document.getElementById('modelModal').classList.add('visible');
  closeOptMenu();
  await refreshOllama();
}
function closeModelModal() {
  document.getElementById('modelModal').classList.remove('visible');
}

async function refreshOllama() {
  const api = window.pywebview && window.pywebview.api;
  const statusEl = document.getElementById('ollamaStatus');
  const textEl = document.getElementById('ollamaStatusText');
  const actEl = document.getElementById('ollamaStatusActions');
  if (!api) { textEl.textContent = '브리지 미연결'; return; }

  textEl.textContent = '상태 확인 중…';
  statusEl.className = 'ollama-status warn';
  actEl.innerHTML = '';

  let st;
  try { st = await api.ollama_status(); }
  catch (e) { textEl.textContent = '상태 조회 실패'; statusEl.className = 'ollama-status err'; return; }

  if (!st.installed) {
    statusEl.className = 'ollama-status err';
    textEl.textContent = 'Ollama가 설치되어 있지 않습니다. 모델을 받으려면 먼저 설치하세요.';
    actEl.innerHTML = `<button class="mini-btn primary" onclick="openOllamaSite()"><i class="ti ti-external-link"></i> 설치 페이지</button>
                      <button class="mini-btn" onclick="refreshOllama()"><i class="ti ti-refresh"></i> 다시 확인</button>`;
  } else if (!st.running) {
    statusEl.className = 'ollama-status warn';
    textEl.textContent = 'Ollama가 실행되고 있지 않습니다.';
    actEl.innerHTML = `<button class="mini-btn" onclick="refreshOllama()"><i class="ti ti-refresh"></i> 다시 확인</button>`;
  } else {
    statusEl.className = 'ollama-status ok';
    textEl.textContent = 'Ollama 정상 동작 중';
    actEl.innerHTML = `<button class="mini-btn" onclick="refreshOllama()"><i class="ti ti-refresh"></i> 새로고침</button>`;
  }

  await renderModels(st);
  await renderGpu(st.running);
}

async function renderGpu(running) {
  const el = document.getElementById('gpuSection');
  const api = getApi();
  if (!api || !running) {
    el.innerHTML = '<div class="model-meta" style="padding:4px 2px;">Ollama 실행 후 표시됩니다.</div>';
    return;
  }
  const s = await api.gpu_status();
  if (!s.supported || s.gpu === 'none') {
    el.innerHTML = '<div class="model-meta" style="padding:4px 2px;">GPU 미감지 — CPU(+Vulkan)로 동작합니다.</div>';
  } else if (s.present) {
    el.innerHTML = `<div class="model-row"><div class="model-info">
      <div class="model-name">${s.gpu.toUpperCase()} 가속 런너 <span class="badge-rec">설치됨</span></div></div></div>`;
  } else {
    el.innerHTML = `<div class="model-row">
      <div class="model-info">
        <div class="model-name">${s.gpu.toUpperCase()} GPU 감지됨</div>
        <div class="model-meta">가속 런너 미설치 · 약 ${s.download_mb} MB 다운로드 (최초 1회)</div>
        <div class="progress" data-tag="gpu-runner"><div class="progress-bar"><div class="progress-fill"></div></div><div class="progress-text"></div></div>
      </div>
      <div class="model-actions"><button class="mini-btn primary" onclick="installGpu()"><i class="ti ti-download"></i> 가속 설치</button></div>
    </div>`;
  }
}
function installGpu() {
  const prog = document.querySelector('.progress[data-tag="gpu-runner"]');
  if (prog) { prog.classList.add('active'); prog.querySelector('.progress-text').textContent = '시작하는 중…'; }
  const api = getApi();
  if (api) api.gpu_install();
}

async function renderModels(st) {
  const api = window.pywebview && window.pywebview.api;
  // 추천/임베딩 목록은 상수라 상태와 무관하게 항상 표시. 설치 목록만 실행 중일 때 채워짐.
  const data = api ? await api.ollama_models() : { installed: [], recommended: [], embed: [] };
  const installedNames = new Set((data.installed || []).map(m => m.name));
  const selected = getSelectedModel();

  // 설치된 모델
  const instEl = document.getElementById('installedList');
  if (!data.installed || data.installed.length === 0) {
    instEl.innerHTML = `<div class="model-meta" style="padding:4px 2px;">설치된 모델이 없습니다. 아래에서 다운로드하세요.</div>`;
  } else {
    instEl.innerHTML = data.installed.map(m => {
      const embed = isEmbeddingModel(m.name);
      const sel = m.name === selected;
      let action;
      if (embed) {
        action = '<span class="badge-tag">임베딩</span>';   // 임베딩 모델은 생성용으로 선택 불가
      } else if (sel) {
        action = '';
      } else {
        action = `<button class="mini-btn primary" onclick="selectModel('${esc(m.name)}')">선택</button>`;
      }
      return `<div class="model-row ${sel ? 'selected' : ''}">
        <div class="model-info">
          <div class="model-name">${esc(m.name)} ${sel && !embed ? '<span class="badge-rec">선택됨</span>' : ''}</div>
          <div class="model-meta">${humanSize(m.size)}</div>
        </div>
        <div class="model-actions">
          ${action}
          <button class="mini-btn danger" onclick="deleteModel('${esc(m.name)}')"><i class="ti ti-trash"></i></button>
        </div>
      </div>`;
    }).join('');
  }

  // 추천 Gemma 4
  document.getElementById('recommendList').innerHTML =
    (data.recommended || []).map(m => downloadRowHtml(m, installedNames, selected)).join('');
  // 임베딩
  document.getElementById('embedList').innerHTML =
    (data.embed || []).map(m => downloadRowHtml(m, installedNames, selected)).join('');
}

function downloadRowHtml(m, installedNames, selected) {
  // Ollama 는 태그 없는 모델을 ':latest' 로 저장하므로 두 형태 모두 확인
  const installed = installedNames.has(m.tag) || installedNames.has(m.tag + ':latest');
  const sel = m.tag === selected;
  const meta = [m.approx, m.context ? m.context + ' 컨텍스트' : '', m.note].filter(Boolean).join(' · ');
  let action;
  if (installed) {
    if (m.embedding) {
      action = '<span class="badge-rec">사용 중</span>';   // 임베딩: 다운로드 즉시 자동 사용
    } else {
      action = sel
        ? '<span class="badge-rec">선택됨</span>'
        : `<button class="mini-btn primary" onclick="selectModel('${esc(m.tag)}')">선택</button>`;
    }
  } else {
    // 필수(임베딩)는 강조 버튼으로
    const cls = m.required ? 'mini-btn primary' : 'mini-btn';
    action = `<button class="${cls}" onclick="downloadModel('${esc(m.tag)}')"><i class="ti ti-download"></i> 다운로드</button>`;
  }
  return `<div class="model-row ${sel ? 'selected' : ''}">
    <div class="model-info">
      <div class="model-name">${esc(m.label)}
        ${m.required && !installed ? '<span class="badge-req">필수</span>' : ''}
        ${m.recommended ? '<span class="badge-rec">권장</span>' : ''}
        <span class="badge-tag">${esc(m.tag)}</span>
      </div>
      <div class="model-meta">${esc(meta)}</div>
      <div class="progress" id="progress-${cssId(m.tag)}" data-tag="${esc(m.tag)}">
        <div class="progress-bar"><div class="progress-fill"></div></div>
        <div class="progress-text"></div>
      </div>
    </div>
    <div class="model-actions">${action}</div>
  </div>`;
}

function cssId(tag) { return tag.replace(/[^a-zA-Z0-9]/g, '_'); }
// 임베딩 전용 모델 판별 (생성 모델로 선택되면 /api/chat 400 → 막기 위함)
function isEmbeddingModel(name) {
  return /embed|bge|minilm|gte|e5|arctic/i.test(name || '');
}

async function selectModel(tag) {
  setSelectedModel(tag);
  await refreshOllama();
}
async function deleteModel(tag) {
  const api = window.pywebview && window.pywebview.api;
  if (!api) return;
  if (isEmbeddingModel(tag) &&
      !(await askConfirm(`"${tag}" 은(는) 문서 검색에 쓰이는 임베딩 모델입니다.\n삭제하면 분석이 동작하지 않습니다. 그래도 삭제할까요?`, { title: '모델 삭제' }))) {
    return;
  }
  await api.ollama_delete(tag);
  if (getSelectedModel() === tag) setSelectedModel('');
  await refreshOllama();
}
async function downloadModel(tag) {
  const api = window.pywebview && window.pywebview.api;
  if (!api) return;
  const prog = document.querySelector(`.progress[data-tag="${cssText(tag)}"]`);
  if (prog) {
    prog.classList.add('active');
    prog.querySelector('.progress-text').textContent = '시작하는 중…';
  }
  await api.ollama_download(tag);
}
function downloadCustom() {
  const input = document.getElementById('customTag');
  const tag = input.value.trim();
  if (!tag) return;
  const prog = document.getElementById('progress-custom');
  prog.setAttribute('data-tag', tag);
  prog.classList.add('active');
  prog.querySelector('.progress-text').textContent = '시작하는 중…';
  const api = window.pywebview && window.pywebview.api;
  if (api) api.ollama_download(tag);
}
function cssText(tag) { return tag.replace(/"/g, '\\"'); }
function openOllamaSite() {
  const api = window.pywebview && window.pywebview.api;
  // 외부 브라우저로 열기는 추후 추가; 우선 안내 텍스트 콘솔 출력
  console.log('Ollama 설치: https://ollama.com/download');
  alert('브라우저에서 https://ollama.com/download 를 열어 설치한 뒤 "다시 확인"을 누르세요.');
}

// Python 에서 push 하는 다운로드 진행률
window.onPullProgress = function(p) {
  const prog = document.querySelector(`.progress[data-tag="${cssText(p.tag)}"]`);
  if (prog) {
    prog.classList.add('active');
    const fill = prog.querySelector('.progress-fill');
    const txt = prog.querySelector('.progress-text');
    if (typeof p.percent === 'number') fill.style.width = p.percent + '%';
    let line = p.status || '';
    if (typeof p.percent === 'number') line += `  ${p.percent}%`;
    if (p.total) line += `  (${humanSize(p.completed || 0)} / ${humanSize(p.total)})`;
    txt.textContent = line;
    if (p.done && p.ok) { fill.style.width = '100%'; txt.textContent = '완료 ✓'; }
    if (p.done && !p.ok) { txt.textContent = '실패: ' + (p.error || '알 수 없는 오류'); }
  }
  // 완료 시 목록 갱신(설치됨/선택 버튼으로 전환). prog 요소 유무와 무관하게 실행하고,
  // Ollama /api/tags 반영 지연을 대비해 지연 재갱신까지 둔다.
  if (p.done && p.ok) {
    refreshOllama();
    setTimeout(refreshOllama, 1000);
    setTimeout(refreshOllama, 2500);
  }
};

// 오버레이 빈 영역 클릭 시 모달 닫기
document.getElementById('modelModal').addEventListener('click', (e) => {
  if (e.target.id === 'modelModal') closeModelModal();
});

// 시작 시 저장된 선택 모델을 라벨에 반영 (임베딩 모델이 잘못 저장돼 있으면 해제)
(function () {
  const saved = getSelectedModel();
  setSelectedModel(isEmbeddingModel(saved) ? '' : saved);
})();

// === 라이브러리(노트북/문서) + RAG ===
let LIB = { notebooks: [] };
let SCOPE = null;            // {type:'notebook'|'doc', notebookId, docId, name, nbName}
const expanded = new Set();  // 펼쳐진 노트북 id
const selectedDocs = new Set(); // 체크박스로 선택된 문서 id (분석 대상)
let analyzing = false;
let preparing = true;   // 앱 시작 시 모델 준비 중 → 준비 끝날 때까지 분석 버튼 비활성

// 모델 버튼 상태 아이콘 + 분석 버튼 활성/비활성 갱신.
// state: 'preparing'(주황·깜빡) | 'ready'(초록) | 'error'(빨강) | 'idle'(회색)
function setModelStatus(state) {
  const ic = document.getElementById('modelStatusIcon');
  if (ic) ic.className = 'ti ti-cpu st-' + state;
  preparing = (state === 'preparing');
  setSendDisabled(analyzing);   // 버튼 상태 재평가
}

function getApi() { return window.pywebview && window.pywebview.api; }

// 창 제어 (frameless 커스텀 타이틀바)
function winMin() { const a = getApi(); if (a) a.win_minimize(); }
async function winMax() {
  const a = getApi(); if (!a) return;
  const r = await a.win_toggle_maximize();
  const max = !!(r && r.maximized);
  document.getElementById('maxIcon').className = 'ti ' + (max ? 'ti-copy' : 'ti-square');
  document.body.classList.toggle('maximized', max);
}
function winClose() { const a = getApi(); if (a) a.win_close(); }

// frameless 가장자리 리사이즈 핸들
const MIN_W = 820, MIN_H = 560;
let rszState = null;
function initResizeHandles() {
  document.querySelectorAll('.rsz').forEach(h => {
    h.addEventListener('mousedown', async (e) => {
      const api = getApi(); if (!api) return;
      e.preventDefault();
      const b = await api.win_get_bounds();
      rszState = { edge: h.dataset.edge, sx: e.screenX, sy: e.screenY, b, busy: false };
      document.body.classList.add('resizing');
    });
  });
  window.addEventListener('mousemove', (e) => {
    if (!rszState || rszState.busy) return;
    const { edge, sx, sy, b } = rszState;
    const dx = e.screenX - sx, dy = e.screenY - sy;
    let x = b.x, y = b.y, w = b.width, h = b.height;
    if (edge.includes('e')) w = b.width + dx;
    if (edge.includes('s')) h = b.height + dy;
    if (edge.includes('w')) { w = b.width - dx; x = b.x + dx; }
    if (edge.includes('n')) { h = b.height - dy; y = b.y + dy; }
    if (w < MIN_W) { if (edge.includes('w')) x = b.x + (b.width - MIN_W); w = MIN_W; }
    if (h < MIN_H) { if (edge.includes('n')) y = b.y + (b.height - MIN_H); h = MIN_H; }
    rszState.busy = true;
    getApi().win_set_bounds(Math.round(x), Math.round(y), Math.round(w), Math.round(h))
      .then(() => { if (rszState) rszState.busy = false; })
      .catch(() => { if (rszState) rszState.busy = false; });
  });
  window.addEventListener('mouseup', () => {
    if (rszState) { rszState = null; document.body.classList.remove('resizing'); }
  });
}
initResizeHandles();

// 프롬프트 입력창 높이 조절 핸들 (하단 그립을 상하로 드래그)
(function initPromptResize() {
  const handle = document.getElementById('promptResize');
  const ta = document.getElementById('promptInput');
  if (!handle || !ta) return;
  let active = false, startY = 0, startH = 0;
  handle.addEventListener('mousedown', (e) => {
    active = true; startY = e.clientY; startH = ta.offsetHeight;
    document.body.style.cursor = 'ns-resize';
    document.body.classList.add('resizing');
    e.preventDefault();
  });
  window.addEventListener('mousemove', (e) => {
    if (!active) return;
    let h = startH + (e.clientY - startY);
    h = Math.max(52, Math.min(400, h));
    ta.style.height = h + 'px';
  });
  window.addEventListener('mouseup', () => {
    if (active) { active = false; document.body.style.cursor = ''; document.body.classList.remove('resizing'); }
  });
})();

// 텍스트 입력 모달 (window.prompt 대체)
let _textResolve = null;
function askText(title, def) {
  return new Promise(res => {
    _textResolve = res;
    document.getElementById('textModalTitle').textContent = title;
    const inp = document.getElementById('textModalInput');
    inp.value = def || '';
    document.getElementById('textModal').classList.add('visible');
    setTimeout(() => { inp.focus(); inp.select(); }, 40);
    inp.onkeydown = (e) => {
      if (e.key === 'Enter') closeTextModal(true);
      if (e.key === 'Escape') closeTextModal(false);
    };
  });
}
function closeTextModal(ok) {
  const v = document.getElementById('textModalInput').value.trim();
  document.getElementById('textModal').classList.remove('visible');
  if (_textResolve) { _textResolve(ok ? v : null); _textResolve = null; }
}

// 테마에 맞춘 확인 모달 (window.confirm 대체)
let _confirmResolve = null;
function askConfirm(message, opts) {
  opts = opts || {};
  return new Promise(res => {
    _confirmResolve = res;
    document.getElementById('confirmTitle').textContent = opts.title || '삭제 확인';
    document.getElementById('confirmMsg').textContent = message;
    const ok = document.getElementById('confirmOkBtn');
    ok.textContent = opts.okText || '삭제';
    document.getElementById('confirmModal').classList.add('visible');
    setTimeout(() => ok.focus(), 40);
  });
}
function closeConfirm(ok) {
  document.getElementById('confirmModal').classList.remove('visible');
  if (_confirmResolve) { _confirmResolve(ok); _confirmResolve = null; }
}
document.getElementById('confirmModal').addEventListener('click', (e) => {
  if (e.target.id === 'confirmModal') closeConfirm(false);
});
document.addEventListener('keydown', (e) => {
  if (!document.getElementById('confirmModal').classList.contains('visible')) return;
  if (e.key === 'Escape') { e.preventDefault(); closeConfirm(false); }
  else if (e.key === 'Enter') { e.preventDefault(); closeConfirm(true); }
});

async function loadLibrary() {
  const api = getApi();
  if (!api) return;
  const res = await api.get_library();
  LIB = res.library || { notebooks: [] };
  if (LIB.notebooks.length && expanded.size === 0) expanded.add(LIB.notebooks[0].id);
  pruneSelection();   // 삭제된 문서가 선택 목록에 남지 않도록 정리
  renderTree();
  updateScopeLabel();
}

function renderTree() {
  const tree = document.getElementById('tree');
  if (!LIB.notebooks.length) {
    tree.innerHTML = '<div class="tree-note">노트북이 없습니다. 상단 + 로 추가하세요.</div>';
    return;
  }
  let html = '';
  for (const nb of LIB.notebooks) {
    const open = expanded.has(nb.id);
    const sel = SCOPE && SCOPE.type === 'notebook' && SCOPE.notebookId === nb.id;
    html += `<div class="tree-item ${sel ? 'active' : ''}" data-nb-id="${nb.id}" oncontextmenu="showTreeCtx(event,'notebook','${nb.id}')" onclick="onNotebookClick('${nb.id}')">
      <input type="checkbox" class="tree-check" id="nbchk-${nb.id}" title="노트북 전체 선택" onclick="toggleNbSelect(event,'${nb.id}')">
      <i class="ti ti-chevron-${open ? 'down' : 'right'}"></i>
      <i class="ti ti-folder${open ? '-open' : ''}"></i>
      <span>${esc(nb.name)}</span>
      <span class="tree-badge">${nb.docs.length}</span>
      <span class="tree-action" title="파일 추가" onclick="event.stopPropagation();addDocuments('${nb.id}')"><i class="ti ti-file-plus"></i></span>
    </div>`;
    if (open) {
      if (!nb.docs.length) {
        html += `<div class="tree-child" data-nb-id="${nb.id}"><div class="tree-note">문서 없음 · 우클릭/드래그 → 파일 추가</div></div>`;
      } else {
        html += `<div class="tree-child" data-nb-id="${nb.id}">`;
        for (const d of nb.docs) {
          const dsel = SCOPE && SCOPE.type === 'doc' && SCOPE.docId === d.id;
          const st = d.status || 'ready';
          const icon = st === 'indexing'
            ? '<span class="spinner" style="margin:0 1px;"></span>'
            : st === 'error'
              ? '<i class="ti ti-alert-triangle" style="color:var(--color-text-danger);"></i>'
              : '<i class="ti ti-file-text"></i>';
          const title = st === 'indexing' ? ' title="처리 중…"' : '';
          html += `<div class="tree-item ${dsel ? 'active' : ''}"${title} oncontextmenu="showTreeCtx(event,'doc','${d.id}')" onclick="onDocClick('${nb.id}','${d.id}')">
            <input type="checkbox" class="tree-check" id="dchk-${d.id}" onclick="toggleDocSelect(event,'${d.id}')">
            ${icon}
            <span>${esc(d.name)}</span>
          </div>`;
        }
        html += '</div>';
      }
    }
  }
  tree.innerHTML = html;
  applyCheckStates();
}

// === 체크박스 선택(분석 대상) ===
function allDocIds() {
  const a = [];
  for (const n of LIB.notebooks) for (const d of n.docs) a.push(d.id);
  return a;
}
function selectedList() {   // 선택 순서 유지, 존재하는 문서만
  const out = [];
  for (const id of selectedDocs) {
    for (const n of LIB.notebooks) {
      const d = n.docs.find(x => x.id === id);
      if (d) { out.push({ id, name: d.name, nbId: n.id, nbName: n.name }); break; }
    }
  }
  return out;
}
function nbState(nb) {       // 'none' | 'some' | 'all'
  if (!nb.docs.length) return 'none';
  let sel = 0;
  for (const d of nb.docs) if (selectedDocs.has(d.id)) sel++;
  return sel === 0 ? 'none' : (sel === nb.docs.length ? 'all' : 'some');
}
function overallState() {
  const all = allDocIds();
  if (!all.length) return 'none';
  let sel = 0;
  for (const id of all) if (selectedDocs.has(id)) sel++;
  return sel === 0 ? 'none' : (sel === all.length ? 'all' : 'some');
}
function applyCheckStates() {
  for (const nb of LIB.notebooks) {
    const c = document.getElementById('nbchk-' + nb.id);
    if (c) { const s = nbState(nb); c.checked = s === 'all'; c.indeterminate = s === 'some'; }
    for (const d of nb.docs) {
      const dc = document.getElementById('dchk-' + d.id);
      if (dc) dc.checked = selectedDocs.has(d.id);
    }
  }
  const head = document.getElementById('selectAllChk');
  if (head) { const s = overallState(); head.checked = s === 'all'; head.indeterminate = s === 'some'; }
}
function afterSelectionChange() {
  renderTree();        // 체크 상태 갱신 (applyCheckStates 포함)
  updateScopeLabel();
  refreshSelPop();     // 팝오버 열려 있으면 갱신
}
function toggleDocSelect(e, docId) {
  e.stopPropagation();
  if (selectedDocs.has(docId)) selectedDocs.delete(docId); else selectedDocs.add(docId);
  afterSelectionChange();
}
function toggleNbSelect(e, nbId) {
  e.stopPropagation();
  const nb = LIB.notebooks.find(n => n.id === nbId);
  if (!nb || !nb.docs.length) { afterSelectionChange(); return; }
  const ids = nb.docs.map(d => d.id);
  if (nbState(nb) === 'all') ids.forEach(id => selectedDocs.delete(id));
  else ids.forEach(id => selectedDocs.add(id));
  afterSelectionChange();
}
function toggleAllSelect(e) {
  if (e) e.stopPropagation();
  if (overallState() === 'all') selectedDocs.clear();
  else allDocIds().forEach(id => selectedDocs.add(id));
  afterSelectionChange();
}
function pruneSelection() {   // 라이브러리 변경 후 사라진 문서 정리
  const live = new Set(allDocIds());
  for (const id of [...selectedDocs]) if (!live.has(id)) selectedDocs.delete(id);
}

// === 선택 파일 목록 팝오버 ===
function onScopeLabelClick(e) {
  if (selectedList().length < 2) return;   // 2개 이상일 때만 목록 표시
  e.stopPropagation();
  const pop = document.getElementById('selPop');
  if (pop.classList.contains('visible')) { closeSelPop(); return; }
  closeCtx(); closeOptMenu();
  const r = e.currentTarget.getBoundingClientRect();
  pop.style.left = r.left + 'px';
  pop.style.top = (r.bottom + 4) + 'px';
  pop.classList.add('visible');   // visible 먼저 → refreshSelPop 가 내용을 채울 수 있음
  refreshSelPop();
}
function closeSelPop() {
  document.getElementById('selPop').classList.remove('visible');
}
function refreshSelPop() {
  const pop = document.getElementById('selPop');
  if (!pop.classList.contains('visible')) return;
  const list = selectedList();
  if (list.length < 2) { closeSelPop(); return; }
  document.getElementById('selPopHead').textContent = `선택한 파일 ${list.length}개`;
  let html = '';
  for (const it of list) {
    html += `<div class="sel-row">
      <i class="ti ti-file-text"></i>
      <span class="sel-name" title="${esc(it.nbName)} / ${esc(it.name)}">${esc(it.name)} <span class="sel-sub">· ${esc(it.nbName)}</span></span>
      <button class="sel-remove" title="선택 제외" onclick="removeFromSelection(event,'${it.id}')"><i class="ti ti-x"></i></button>
    </div>`;
  }
  document.getElementById('selPopBody').innerHTML = html;
}
function removeFromSelection(e, docId) {
  e.stopPropagation();
  selectedDocs.delete(docId);
  afterSelectionChange();   // 트리 체크 해제 + 라벨/팝오버 갱신
}

function onNotebookClick(id) {
  if (expanded.has(id)) expanded.delete(id); else expanded.add(id);
  const nb = LIB.notebooks.find(n => n.id === id);
  SCOPE = { type: 'notebook', notebookId: id, name: nb ? nb.name : '' };
  updateScopeLabel(); renderTree();
}
function onDocClick(nbId, docId) {
  const nb = LIB.notebooks.find(n => n.id === nbId);
  const d = nb && nb.docs.find(x => x.id === docId);
  SCOPE = { type: 'doc', notebookId: nbId, docId, name: d ? d.name : '', nbName: nb ? nb.name : '' };
  updateScopeLabel(); renderTree();
}
function updateScopeLabel() {
  const el = document.getElementById('scopeLabel');
  const icon = document.getElementById('scopeIcon');
  el.classList.remove('clickable');
  const sel = selectedList();
  if (sel.length >= 2) {                 // 여러 개 선택 → "파일명 외 N개" (클릭 시 목록)
    el.textContent = `${sel[0].name} 외 ${sel.length - 1}개`;
    icon.className = 'ti ti-files'; icon.style.color = 'var(--color-text-info)';
    el.classList.add('clickable');
    return;
  }
  if (sel.length === 1) {                 // 1개 선택
    el.textContent = `${sel[0].nbName} / ${sel[0].name}`;
    icon.className = 'ti ti-file-text'; icon.style.color = 'var(--color-text-secondary)';
    return;
  }
  closeSelPop();                          // 선택 없음 → 기존 SCOPE 기준
  if (!SCOPE) { el.textContent = '노트북을 선택하세요'; icon.className = 'ti ti-folder-open'; icon.style.color = '#febc2e'; return; }
  if (SCOPE.type === 'doc') {
    el.textContent = `${SCOPE.nbName} / ${SCOPE.name}`;
    icon.className = 'ti ti-file-text'; icon.style.color = 'var(--color-text-secondary)';
  } else {
    el.textContent = SCOPE.name;
    icon.className = 'ti ti-folder-open'; icon.style.color = '#febc2e';
  }
}
function currentDocIds() {
  const sel = selectedList().map(s => s.id);   // 체크박스 선택이 우선
  if (sel.length) return sel;
  if (!SCOPE) return [];
  if (SCOPE.type === 'doc') return [SCOPE.docId];
  const nb = LIB.notebooks.find(n => n.id === SCOPE.notebookId);
  return nb ? nb.docs.map(d => d.id) : [];
}

async function addNotebook() {
  const name = await askText('새 노트북 이름', '새 노트북');
  if (name === null) return;
  await getApi().add_notebook(name || '새 노트북');
  await loadLibrary();
}
async function renameNotebook(id) {
  closeCtx();
  const nb = LIB.notebooks.find(n => n.id === id);
  const name = await askText('노트북 이름 변경', nb ? nb.name : '');
  if (name === null || !name) return;
  await getApi().rename_notebook(id, name);
  await loadLibrary();
}
async function deleteNotebook(id) {
  closeCtx();
  const nb = LIB.notebooks.find(n => n.id === id);
  const name = nb ? nb.name : '노트북';
  if (!(await askConfirm(`폴더: "${name}"\n선택한 폴더를 삭제할까요?`, { title: '폴더 삭제' }))) return;
  await getApi().delete_notebook(id);
  if (SCOPE && SCOPE.notebookId === id) { SCOPE = null; updateScopeLabel(); }
  await loadLibrary();
}
async function deleteDocument(id) {
  closeCtx();
  let name = '문서';
  for (const n of LIB.notebooks) { const d = n.docs.find(x => x.id === id); if (d) { name = d.name; break; } }
  if (!(await askConfirm(`파일: "${name}"\n선택한 파일을 삭제할까요?`, { title: '파일 삭제' }))) return;
  await getApi().delete_document(id);
  if (SCOPE && SCOPE.docId === id) { SCOPE = null; updateScopeLabel(); }
  await loadLibrary();
}
async function addDocuments(notebookId) {
  closeCtx();
  const api = getApi();
  if (!api) return;
  expanded.add(notebookId);
  const res = await api.add_documents(notebookId);   // 파일 선택 → 즉시 '처리 중'으로 추가
  if (res.canceled) return;
  if (res.error) { alert(res.error); return; }
  await loadLibrary();   // 트리에 즉시 표시(인덱싱은 백그라운드 진행)
}

// === 탐색기 → 트리 폴더 드래그앤드롭 ===
// dragover 동안 대상 노트북을 추적/하이라이트하고, 실제 파일 처리(경로 획득)는
// Python 의 _on_drop 핸들러가 수행한다. (브라우저 JS 는 전체 경로를 못 읽음)
window.__dropTargetNb = null;   // 현재 hover 중인 노트북 id
window.__lastDropNb = null;     // drop 순간 스냅샷 (Python 이 읽음)

function clearDropHighlight() {
  document.querySelectorAll('.tree-item.drop-target').forEach(el => el.classList.remove('drop-target'));
}
function setDropTarget(nbId) {
  if (window.__dropTargetNb === nbId) return;
  window.__dropTargetNb = nbId || null;
  clearDropHighlight();
  if (nbId) {
    const el = document.querySelector('.tree-item[data-nb-id="' + nbId + '"]');
    if (el) el.classList.add('drop-target');
  }
}
function setupTreeDnd() {
  const tree = document.getElementById('tree');
  if (!tree || tree.__dndReady) return;
  tree.__dndReady = true;
  tree.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    const host = e.target.closest ? e.target.closest('[data-nb-id]') : null;
    setDropTarget(host ? host.getAttribute('data-nb-id') : null);
  });
  tree.addEventListener('dragleave', (e) => {
    if (!tree.contains(e.relatedTarget)) setDropTarget(null);   // 트리 밖으로 완전히 나갈 때만
  });
  tree.addEventListener('drop', (e) => {
    e.preventDefault();
    window.__lastDropNb = window.__dropTargetNb;   // Python 이 읽을 대상 스냅샷
    clearDropHighlight();
  });
}

// Python 드롭 핸들러가 문서 추가 후 호출 → 트리 즉시 갱신
window.onDropAdded = function(p) {
  if (!p) return;
  if (p.notebook_id) expanded.add(p.notebook_id);
  loadLibrary();
  if (p.skipped && p.skipped.length) {
    alert('지원하지 않는 형식이라 제외했습니다:\n' + p.skipped.join(', ') + '\n(지원: pdf, docx, txt, md)');
  }
};

// 백그라운드 인덱싱 완료/실패 시 Python 이 호출 → 트리 갱신
window.onDocStatus = function(p) {
  loadLibrary();
  if (p && p.status === 'error') {
    alert(`"${p.name}" 처리 실패:\n${p.error || '알 수 없는 오류'}`);
  }
};

// --- 분석(RAG) ---
function clearEmptyHint() { const h = document.getElementById('emptyHint'); if (h) h.remove(); }
async function clearAnswer() {
  if (analyzing) return;   // 분석 중에는 초기화하지 않음
  const box = document.getElementById('answerBox');
  // 분석 결과가 있을 때만(빈 안내가 없을 때) 초기화 확인창 표시
  if (!document.getElementById('emptyHint')) {
    const ok = await askConfirm('분석 결과를 초기화할까요?', { title: '분석 결과 초기화', okText: '초기화' });
    if (!ok) return;
  }
  box.innerHTML =
    '<div class="empty-hint" id="emptyHint">' +
    '<i class="ti ti-message-2" aria-hidden="true"></i>' +
    '<div>문서를 추가하고 질문하면 분석 결과가 여기에 표시됩니다.</div>' +
    '</div>';
}
function clearPrompt() {
  const ta = document.getElementById('promptInput');
  ta.value = '';
  ta.focus();
}
function scrollAnswer() { const b = document.getElementById('answerBox'); b.scrollTop = b.scrollHeight; }
function setSendDisabled(d) {
  const b = document.getElementById('sendBtn');
  const disabled = d || preparing;   // 분석 중이거나 모델 준비 중이면 비활성
  b.disabled = disabled; b.style.opacity = disabled ? '0.6' : '';
  b.title = (preparing && !d) ? '모델 준비 중입니다. 잠시만 기다려 주세요.' : '';
  const c = document.getElementById('clearAnswerBtn'); if (c) c.disabled = d;   // 분석 중 초기화 버튼 비활성화
}

function appendUser(text) {
  clearEmptyHint();
  const box = document.getElementById('answerBox');
  const m = document.createElement('div'); m.className = 'msg';
  m.innerHTML = `<div class="msg-role user"><i class="ti ti-user" style="font-size:12px;"></i> 사용자</div><div class="msg-content"></div>`;
  m.querySelector('.msg-content').textContent = text;
  box.appendChild(m); scrollAnswer();
}
function appendLoading() {
  clearEmptyHint();
  const box = document.getElementById('answerBox');
  const m = document.createElement('div'); m.className = 'msg';
  m.innerHTML = `<div class="msg-role ai"><i class="ti ti-robot" style="font-size:12px;"></i> NoteCook AI</div><div class="msg-content ai"><span class="spinner"></span> 분석 중…</div>`;
  box.appendChild(m); scrollAnswer();
  return m.querySelector('.msg-content');
}
// === 경량 마크다운 → HTML 렌더러 (오프라인, CDN 의존 없음) ===
// 모델 출력은 esc()로 먼저 이스케이프해 XSS를 막은 뒤 마크다운 문법만 HTML로 변환한다.
function renderInline(s) {
  return esc(s)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')      // **굵게**
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')       // *기울임*
    .replace(/`([^`]+)`/g, '<code>$1</code>');                // `코드`
}
function renderMarkdown(src) {
  const lines = String(src).replace(/\r\n/g, '\n').split('\n');
  let html = '';
  let i = 0;
  const listStack = [];                                       // {tag:'ul'|'ol'}
  const closeLists = (toDepth = 0) => {
    while (listStack.length > toDepth) html += `</${listStack.pop().tag}>`;
  };
  while (i < lines.length) {
    const line = lines[i];

    // 코드 블록 ```
    const fence = line.match(/^\s*```/);
    if (fence) {
      closeLists();
      i++;
      let code = '';
      while (i < lines.length && !/^\s*```/.test(lines[i])) { code += lines[i] + '\n'; i++; }
      i++;                                                    // 닫는 ``` 소비
      html += `<pre><code>${esc(code.replace(/\n$/, ''))}</code></pre>`;
      continue;
    }

    // 빈 줄 → 목록/문단 종료
    if (/^\s*$/.test(line)) { closeLists(); i++; continue; }

    // 제목 #, ##, ###
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) { closeLists(); html += `<h${h[1].length}>${renderInline(h[2])}</h${h[1].length}>`; i++; continue; }

    // 가로줄 ---
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) { closeLists(); html += '<hr>'; i++; continue; }

    // 인용 >
    const q = line.match(/^\s*>\s?(.*)$/);
    if (q) { closeLists(); html += `<blockquote>${renderInline(q[1])}</blockquote>`; i++; continue; }

    // 목록 (들여쓰기 깊이 기반 중첩)
    const li = line.match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/);
    if (li) {
      const depth = Math.floor(li[1].length / 2) + 1;
      const tag = /\d/.test(li[2]) ? 'ol' : 'ul';
      while (listStack.length > depth) html += `</${listStack.pop().tag}>`;
      if (listStack.length < depth) { html += `<${tag}>`; listStack.push({ tag }); }
      else if (listStack.length && listStack[listStack.length - 1].tag !== tag) {
        html += `</${listStack[listStack.length - 1].tag}>`;
        listStack[listStack.length - 1] = { tag };
        html += `<${tag}>`;
      }
      html += `<li>${renderInline(li[3])}</li>`;
      i++; continue;
    }

    // 일반 문단 (이어지는 텍스트 줄을 하나로 묶음)
    closeLists();
    let para = line;
    i++;
    while (i < lines.length && !/^\s*$/.test(lines[i]) &&
           !/^\s*(#{1,3}\s|[-*+]\s|\d+\.\s|>|```)/.test(lines[i])) {
      para += '\n' + lines[i]; i++;
    }
    html += `<p>${renderInline(para).replace(/\n/g, '<br>')}</p>`;
  }
  closeLists();
  return html;
}

// === 답변 스트리밍 (Python 이 토큰 조각마다 window.onAnalyzeStream 호출) ===
let streamEl = null;        // 현재 스트리밍 중인 .msg-content
let streamRaw = '';         // 누적 원본 마크다운
let streamStarted = false;  // 첫 토큰 도착 여부(스피너 제거용)
let streamScheduled = false;

function startStream(el) {
  streamEl = el; streamRaw = ''; streamStarted = false;
}
function flushStream() {
  streamScheduled = false;
  if (!streamEl) return;
  streamEl.innerHTML = renderMarkdown(streamRaw);
  scrollAnswer();
}
window.onAnalyzeStream = function (p) {
  if (!streamEl || !p || typeof p.delta !== 'string') return;
  if (!streamStarted) {        // 첫 토큰: 스피너/대기문구 비우고 caret 표시
    streamStarted = true;
    streamEl.textContent = '';
    streamEl.classList.add('streaming');
  }
  streamRaw += p.delta;
  // 토큰마다 즉시 렌더하면 O(n^2) 이므로 프레임당 1회로 합친다(부담 최소화)
  if (!streamScheduled) { streamScheduled = true; requestAnimationFrame(flushStream); }
};
function endStream() {
  if (streamEl) streamEl.classList.remove('streaming');
  streamEl = null; streamRaw = ''; streamStarted = false; streamScheduled = false;
}

async function openSource(docId, page) {
  const api = getApi();
  if (!api) { alert('Python 브리지가 연결되지 않았습니다.'); return; }
  try {
    const r = await api.open_source(docId, page || null);
    if (r && r.ok === false) alert(r.error || '파일을 열 수 없습니다.');
  } catch (e) {
    alert('파일 열기 실패: ' + String(e));
  }
}

// 본문의 [n] / [n, m] 인용을, 알려진 출처 번호에 한해 클릭 가능한 <a>로 바꾼다.
// citeMap 에 없는 번호는 그대로 둔다(코드블록 안 숫자 등 오탐 방지).
function linkifyCitations(html, citeMap) {
  return html.replace(/\[(\d+(?:\s*,\s*\d+)*)\]/g, (m, grp) => {
    const parts = grp.split(',').map(x => x.trim());
    if (!parts.some(n => citeMap[n])) return m;
    const inner = parts.map(n => citeMap[n] ? `<a class="cite" data-cite="${n}">${n}</a>` : n).join(', ');
    return `[${inner}]`;
  });
}

function renderAnswer(el, res) {
  el.classList.remove('error');
  if (!res.answer) {
    el.classList.add('error');
    el.textContent = '모델이 응답을 생성하지 못했습니다. 모델이 메모리에 올라오는 중일 수 있으니 잠시 후 다시 시도해 주세요.';
    return;
  }
  // 인용 번호 → 출처 매핑 (한 출처가 여러 번호를 가질 수 있음: s.nums)
  const citeMap = {};
  for (const s of (res.sources || [])) {
    const nums = (s.nums && s.nums.length) ? s.nums : (s.n != null ? [s.n] : []);
    for (const n of nums) citeMap[String(n)] = s;
  }
  el.innerHTML = linkifyCitations(renderMarkdown(res.answer), citeMap);
  // 본문 인용에 클릭(원본 열기) 연결 — 이 답변 메시지(el)에 한정해 바인딩.
  el.querySelectorAll('a.cite').forEach(a => {
    const s = citeMap[a.dataset.cite];
    if (s && s.doc_id) {
      a.classList.add('clickable');
      a.title = s.page ? `${s.name} ${s.page}페이지 열기` : `${s.name} 열기`;
      a.onclick = () => openSource(s.doc_id, s.page);
    }
  });
  if (res.sources && res.sources.length) {
    const chips = document.createElement('div'); chips.className = 'source-chips';
    for (const s of res.sources) {
      const loc = s.page ? ` · p.${s.page}` : '';
      const nums = (s.nums && s.nums.length) ? s.nums : (s.n != null ? [s.n] : []);
      const c = document.createElement('span'); c.className = 'source-chip';
      if (s.doc_id) {
        c.classList.add('clickable');
        c.title = s.page ? `원본 파일 ${s.page}페이지 열기` : '원본 파일 열기';
        c.onclick = () => openSource(s.doc_id, s.page);
      }
      const numPart = nums.length ? `<span class="chip-num">[${nums.join(', ')}]</span> ` : '';
      c.innerHTML = `<i class="ti ti-file-text" style="font-size:10px;"></i> ${numPart}${esc(s.name + loc)}`;
      chips.appendChild(c);
    }
    el.appendChild(chips);
  }
}

async function analyze() {
  if (analyzing) return;
  const api = getApi();
  if (!api) { alert('Python 브리지가 연결되지 않았습니다.'); return; }
  const q = document.getElementById('promptInput').value.trim();
  if (!q) return;
  const docIds = currentDocIds();
  if (!docIds.length) {
    appendUser(q);
    const el = appendLoading(); el.classList.add('error');
    el.textContent = '분석할 문서가 없습니다. 노트북에 파일을 추가하거나 문서를 선택하세요.';
    return;
  }
  const model = getSelectedModel();
  if (!model || isEmbeddingModel(model)) {
    appendUser(q);
    const el = appendLoading(); el.classList.add('error');
    el.textContent = !model
      ? '생성 모델이 선택되지 않았습니다. 우측 상단 모델 관리에서 Gemma 4 등 생성 모델을 선택하세요.'
      : `선택된 "${model}" 은(는) 임베딩 전용 모델이라 답변 생성에 쓸 수 없습니다. Gemma 4 등 생성 모델을 선택하세요.`;
    return;
  }
  appendUser(q);
  document.getElementById('promptInput').value = '';
  const el = appendLoading();
  analyzing = true; setSendDisabled(true);
  startStream(el);
  try {
    const res = await api.analyze(q, docIds, model);
    endStream();
    if (res.error) { el.classList.add('error'); el.textContent = res.error; }
    else renderAnswer(el, res);   // 최종 본문+출처 칩으로 정리(스트림 누락분 보정)
  } catch (e) {
    endStream();
    el.classList.add('error'); el.textContent = '오류: ' + String(e);
  } finally {
    analyzing = false; setSendDisabled(false); scrollAnswer();
  }
}

document.getElementById('promptInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); analyze(); }
});
document.getElementById('textModal').addEventListener('click', (e) => {
  if (e.target.id === 'textModal') closeTextModal(false);
});
document.getElementById('promptModal').addEventListener('click', (e) => {
  if (e.target.id === 'promptModal') closePromptModal(false);
});

// === 프롬프트 저장/불러오기 (localStorage) ===
const PROMPTS_KEY = 'notecook.prompts';
function loadPrompts() {
  try { return JSON.parse(localStorage.getItem(PROMPTS_KEY)) || []; } catch (e) { return []; }
}
function savePrompts(arr) { localStorage.setItem(PROMPTS_KEY, JSON.stringify(arr)); }

// 저장 모달
function openSavePrompt() {
  closeSavedMenu();
  document.getElementById('pmTitle').value = '';
  document.getElementById('pmContent').value = document.getElementById('promptInput').value;
  updateTitleCount();
  document.getElementById('promptModal').classList.add('visible');
  setTimeout(() => document.getElementById('pmTitle').focus(), 40);
}
function updateTitleCount() {
  document.getElementById('pmTitleCount').textContent =
    document.getElementById('pmTitle').value.length + '/10';
  updateSaveBtn();
}
function updateSaveBtn() {
  const title = document.getElementById('pmTitle').value.trim();
  const content = document.getElementById('pmContent').value.trim();
  document.getElementById('pmSaveBtn').disabled = !title || !content;
}
function closePromptModal(save) {
  if (save) {
    const title = document.getElementById('pmTitle').value.trim();
    const content = document.getElementById('pmContent').value.trim();
    if (!title || !content) return;
    const arr = loadPrompts();
    arr.unshift({ id: 'p' + Date.now().toString(36), title, content });
    savePrompts(arr);
  }
  document.getElementById('promptModal').classList.remove('visible');
}

// 드롭다운
function toggleSavedMenu(e) {
  e.stopPropagation();
  const menu = document.getElementById('savedMenu');
  if (menu.classList.contains('visible')) { closeSavedMenu(); return; }
  closeCtx(); closeOptMenu(); closeSelPop();
  document.getElementById('savedSearch').value = '';
  renderSavedList();
  const r = e.currentTarget.getBoundingClientRect();
  menu.classList.add('visible');
  menu.style.left = r.left + 'px';
  // 기본은 버튼 위로 펼치고, 위 공간이 부족하면 아래로
  const h = menu.offsetHeight;
  let top = r.top - h - 4;
  if (top < 8) top = r.bottom + 4;
  menu.style.top = top + 'px';
  setTimeout(() => document.getElementById('savedSearch').focus(), 30);
}
function closeSavedMenu() { document.getElementById('savedMenu').classList.remove('visible'); }
function renderSavedList() {
  const all = loadPrompts();
  const q = document.getElementById('savedSearch').value.trim().toLowerCase();
  const arr = q ? all.filter(p => p.title.toLowerCase().includes(q)) : all;
  const list = document.getElementById('savedList');
  if (!arr.length) {
    list.innerHTML = `<div class="saved-empty">${all.length ? '검색 결과가 없습니다.' : '저장된 프롬프트가 없습니다.'}</div>`;
    return;
  }
  let html = '';
  for (const p of arr) {
    html += `<div class="saved-item" onclick="applySavedPrompt('${p.id}')">
      <i class="ti ti-message-2" style="font-size:12px;color:var(--color-text-tertiary);flex:none;"></i>
      <span class="si-title" title="${esc(p.title)}">${esc(p.title)}</span>
      <button class="saved-del" title="삭제" onclick="deleteSavedPrompt(event,'${p.id}')"><i class="ti ti-x"></i></button>
    </div>`;
  }
  list.innerHTML = html;
}
function applySavedPrompt(id) {
  const p = loadPrompts().find(x => x.id === id);
  if (!p) return;
  const ta = document.getElementById('promptInput');
  ta.value = p.content;
  closeSavedMenu();
  ta.focus();
}
async function deleteSavedPrompt(e, id) {
  e.stopPropagation();
  const p = loadPrompts().find(x => x.id === id);
  const name = p ? p.title : '';
  if (!(await askConfirm(`"${name}" 를 삭제합니다.\n계속할까요?`, { title: '프롬프트 삭제' }))) return;
  savePrompts(loadPrompts().filter(x => x.id !== id));
  renderSavedList();
}

// === Python 브리지 연결 확인 (pywebview가 window.pywebview.api 를 주입) ===
// 앱 시작 시 Ollama 서버 기동 + 모델 워밍업 진행 상태를 모델 버튼(라벨+아이콘 색)에 반영.
window.onPrepareStatus = function (p) {
  if (!p) return;
  const label = document.getElementById('modelLabel');
  if (p.step === 'done') {
    label.textContent = getSelectedModel() || '모델 미선택';   // 원래 라벨로 복귀
    setModelStatus(p.ok ? 'ready' : 'error');
  } else {
    if (p.status) label.textContent = p.status;
    setModelStatus('preparing');
  }
};

window.addEventListener('pywebviewready', async () => {
  setModelStatus('preparing');   // 분석 버튼 잠금 + 아이콘 깜빡임 시작
  try {
    const info = await window.pywebview.api.ping();
    console.log('[NoteCook] Python 브리지 연결됨:', info);
    setupTreeDnd();
    await loadLibrary();
    // 서버 기동 + 임베딩/선택 모델을 백그라운드로 미리 준비 (논블로킹).
    window.pywebview.api.prepare(getSelectedModel());
    // 안전장치: 준비 완료 신호가 끝내 안 오면(브리지 이상 등) 2분 뒤 잠금 해제.
    setTimeout(() => { if (preparing) setModelStatus('idle'); }, 120000);
  } catch (e) {
    console.warn('[NoteCook] Python 브리지 연결 실패', e);
    setModelStatus('idle');   // 브리지 실패 시 버튼 영구 잠금 방지
  }
});
