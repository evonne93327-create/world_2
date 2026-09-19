/* ==========================================================
   雲端同步 — 流程控制 (sync.js)

   整包 appData 存成雲端的一列。這個做法跟現有架構完全吻合
   （saveData() 本來就是唯一的存檔出口），代價是衝突只能以
   「整包」為單位處理，沒辦法逐篇文件合併。
   因此這裡的原則是：寧可停下來問使用者，也絕不默默覆蓋。
   ========================================================== */

const SYNC_DIRTY_KEY = "world_sync_dirty_v1";
const SYNC_PUSH_DEBOUNCE_MS = 2500;

let syncStatus = "off";      // off | idle | syncing | error | conflict
let syncStatusDetail = "";
let syncPushTimer = null;
let lastPushedPayload = null; // 內容沒變就不重送

/* ---------- 「本機有尚未推送的變更」旗標 ----------
   必須存進 localStorage：使用者可能改完就關掉分頁，
   只放在記憶體的話下次開啟就不知道本機是髒的，
   會把別台裝置的版本當成最新而蓋掉這次的修改。 */
function isLocalDirty() {
  return localStorage.getItem(SYNC_DIRTY_KEY) === "1";
}
function setLocalDirty(dirty) {
  if (dirty) localStorage.setItem(SYNC_DIRTY_KEY, "1");
  else localStorage.removeItem(SYNC_DIRTY_KEY);
}

function setSyncStatus(status, detail) {
  syncStatus = status;
  syncStatusDetail = detail || "";
  renderSyncIndicator();
  if (typeof renderSyncModal === "function" && document.getElementById("syncModal") &&
      document.getElementById("syncModal").classList.contains("active")) {
    renderSyncModal();
  }
}

function syncIsActive() {
  return isSyncConfigured() && !!syncAuth.currentUser();
}

/* ---------- 啟動時的對帳 ---------- */

// 本機資料是否還是完全沒動過的預設範例
function localLooksUntouched() {
  try {
    return JSON.stringify(appData) === JSON.stringify(INITIAL_APP_DATA);
  } catch (e) {
    return false;
  }
}

function adoptRemote(row) {
  appData = row.data;
  saveSyncState(row.version, row.updated_at);
  setLocalDirty(false);
  lastPushedPayload = JSON.stringify(appData);

  // 直接寫回 localStorage，不要走 saveData()，否則會又標成髒的、又排一次推送
  localStorage.setItem("novel_multi_world_data_v5", JSON.stringify(appData));

  // 套用雲端資料後，目前選取的文件可能已經不存在了
  if (activeDocId && !appData.docs.find(d => d.id === activeDocId)) {
    activeDocId = appData.docs.length ? appData.docs[0].id : null;
    if (activeDocId) activeWorldId = appData.docs[0].worldId;
  }
  if (!appData.worldviews.find(w => w.id === activeWorldId) && appData.worldviews.length) {
    activeWorldId = appData.worldviews[0].id;
  }

  renderWorldRail();
  renderSidebarTree();
  updateWorldBadge();
  if (activeDocId) loadDocToEditor(activeDocId);
  if (activeView === 'canvas') renderCanvas();
}

async function initSync() {
  renderSyncIndicator();
  if (!syncIsActive()) { setSyncStatus("off"); return; }

  setSyncStatus("syncing", "正在對帳…");
  try {
    const remote = await syncData.pull();
    const state = loadSyncState();

    // 雲端還沒有資料：把本機推上去當作第一版
    if (!remote) {
      await pushNow(true);
      return;
    }

    // 這台裝置已經同步到雲端的最新版
    if (state.version === remote.version) {
      if (isLocalDirty()) await pushNow(true);
      else setSyncStatus("idle", "已是最新");
      return;
    }

    // 雲端的版本跟本機記錄的不一樣，代表別的地方寫過。
    // 本機沒有未推送的變更，或本機根本還是預設範例 → 直接採用雲端。
    if (!isLocalDirty() || localLooksUntouched()) {
      adoptRemote(remote);
      setSyncStatus("idle", "已從雲端更新");
      return;
    }

    // 兩邊都有變更 → 停下來問，不猜
    openSyncConflictModal(remote);
  } catch (e) {
    setSyncStatus("error", e.message || "同步失敗");
  }
}

/* ---------- 推送 ---------- */

// storage.js 的 saveData() 會呼叫這裡
function onDataSaved() {
  if (!syncIsActive()) return;
  setLocalDirty(true);
  if (syncPushTimer) clearTimeout(syncPushTimer);
  syncPushTimer = setTimeout(function() {
    syncPushTimer = null;
    pushNow(false);
  }, SYNC_PUSH_DEBOUNCE_MS);
}

async function pushNow(silent) {
  if (!syncIsActive()) return;
  if (syncStatus === "conflict") return; // 衝突還沒解決前不要再推

  const payload = JSON.stringify(appData);
  if (payload === lastPushedPayload && !isLocalDirty()) {
    setSyncStatus("idle", "已是最新");
    return;
  }

  setSyncStatus("syncing", "上傳中…");
  try {
    const state = loadSyncState();
    const result = await syncData.push(appData, state.version);

    if (result.conflict) {
      // 雲端被別台裝置改過，先把對方的版本抓回來給使用者比較
      const remote = await syncData.pull();
      openSyncConflictModal(remote);
      return;
    }

    saveSyncState(result.row.version, result.row.updated_at);
    setLocalDirty(false);
    lastPushedPayload = payload;
    setSyncStatus("idle", silent ? "已同步" : "已同步");
  } catch (e) {
    // 推送失敗時 dirty 旗標保持著，下次還會再試
    setSyncStatus("error", e.message || "上傳失敗");
  }
}

/* ---------- 衝突處理 ---------- */

let pendingConflictRemote = null;

function openSyncConflictModal(remote) {
  pendingConflictRemote = remote;
  setSyncStatus("conflict", "偵測到衝突");

  const info = document.getElementById("syncConflictInfo");
  if (info) {
    const when = remote && remote.updated_at
      ? new Date(remote.updated_at).toLocaleString()
      : "未知時間";
    const remoteDocs = remote && remote.data && Array.isArray(remote.data.docs)
      ? remote.data.docs.length : 0;
    info.innerHTML =
      '<div style="margin-bottom:8px;">這台裝置和雲端都有未同步的修改，需要你決定要保留哪一份。</div>' +
      '<div style="font-size:12px; color:var(--text-secondary); line-height:1.7;">' +
      '☁️ 雲端版本：' + remoteDocs + ' 份文檔，最後更新於 ' + escapeHtml(when) + '<br>' +
      '💻 這台裝置：' + (appData.docs ? appData.docs.length : 0) + ' 份文檔（尚未上傳）' +
      '</div>';
  }
  const modal = document.getElementById("syncConflictModal");
  if (modal) modal.classList.add("active");
}

function closeSyncConflictModal() {
  const modal = document.getElementById("syncConflictModal");
  if (modal) modal.classList.remove("active");
}

async function resolveConflictUseRemote() {
  if (!pendingConflictRemote) return;
  adoptRemote(pendingConflictRemote);
  pendingConflictRemote = null;
  closeSyncConflictModal();
  setSyncStatus("idle", "已採用雲端版本");
}

async function resolveConflictUseLocal() {
  closeSyncConflictModal();
  setSyncStatus("syncing", "上傳中…");
  try {
    const result = await syncData.overwrite(appData);
    saveSyncState(result.row.version, result.row.updated_at);
    setLocalDirty(false);
    lastPushedPayload = JSON.stringify(appData);
    pendingConflictRemote = null;
    setSyncStatus("idle", "已以本機版本覆蓋雲端");
  } catch (e) {
    setSyncStatus("error", e.message || "覆蓋失敗");
  }
}

/* 在做出取捨前，先把本機這份存成檔案，後悔了還有得救 */
function backupBeforeResolving() {
  if (typeof exportFullDatabaseJSON === "function") exportFullDatabaseJSON();
}

/* ---------- 設定面板 ---------- */

function openSyncModal() {
  renderSyncModal();
  document.getElementById("syncModal").classList.add("active");
}

function closeSyncModal() {
  document.getElementById("syncModal").classList.remove("active");
}

function syncStatusLine() {
  const labels = {
    off: "未啟用",
    idle: "已連線",
    syncing: "同步中",
    error: "發生問題",
    conflict: "有衝突待處理"
  };
  const state = loadSyncState();
  const when = state.at ? new Date(state.at).toLocaleString() : null;
  return '<div style="font-size:12px; color:var(--text-secondary); margin-bottom:10px;">' +
    '狀態：' + (labels[syncStatus] || syncStatus) +
    (syncStatusDetail ? '（' + escapeHtml(syncStatusDetail) + '）' : '') +
    (when ? '<br>最後同步：' + escapeHtml(when) : '') +
    '</div>';
}

function renderSyncModal() {
  const body = document.getElementById("syncModalBody");
  if (!body) return;

  const cfg = loadSyncConfig();
  const user = syncAuth.currentUser();

  // 第一步：填連線資訊
  if (!cfg.url || !cfg.anonKey) {
    body.innerHTML =
      '<p style="font-size:12px; color:var(--text-secondary); line-height:1.7;">' +
      '填入你的 Supabase 專案資訊。只需要 <b>anon public</b> 那把金鑰，' +
      '它設計上就可以公開；<b>service_role</b> 那把絕對不要貼在這裡。<br>' +
      '這些資訊只會存在這台裝置的瀏覽器裡。</p>' +
      '<label style="font-size:12px; font-weight:600;">Project URL</label>' +
      '<input type="text" id="syncUrlInput" class="form-input" placeholder="https://xxxxx.supabase.co" value="' + escapeHtml(cfg.url) + '">' +
      '<label style="font-size:12px; font-weight:600; margin-top:8px; display:block;">anon public key</label>' +
      '<input type="password" id="syncKeyInput" class="form-input" placeholder="eyJhbGciOi..." value="' + escapeHtml(cfg.anonKey) + '">' +
      '<div id="syncModalMsg" style="font-size:12px; color:var(--danger); margin-top:8px;"></div>' +
      '<button class="btn btn-primary" style="margin-top:10px;" onclick="submitSyncConfig()">儲存連線資訊</button>';
    return;
  }

  // 第二步：登入
  if (!user) {
    body.innerHTML =
      syncStatusLine() +
      '<p style="font-size:12px; color:var(--text-secondary); line-height:1.7;">' +
      '用信箱建立帳號或登入。資料會綁在這個帳號底下，' +
      '在別台裝置登入同一個帳號就能取得同一份資料。</p>' +
      '<label style="font-size:12px; font-weight:600;">信箱</label>' +
      '<input type="email" id="syncEmailInput" class="form-input" placeholder="you@example.com">' +
      '<label style="font-size:12px; font-weight:600; margin-top:8px; display:block;">密碼</label>' +
      '<input type="password" id="syncPasswordInput" class="form-input" placeholder="至少 6 個字元">' +
      '<div id="syncModalMsg" style="font-size:12px; margin-top:8px;"></div>' +
      '<div style="display:flex; gap:8px; margin-top:10px;">' +
      '<button class="btn btn-primary" style="flex:1;" onclick="submitSyncSignIn()">登入</button>' +
      '<button class="btn btn-secondary" style="flex:1;" onclick="submitSyncSignUp()">建立帳號</button>' +
      '</div>' +
      '<button class="btn btn-secondary" style="margin-top:10px; font-size:11px;" onclick="clearSyncConfig()">更改連線資訊</button>';
    return;
  }

  // 第三步：已登入
  body.innerHTML =
    syncStatusLine() +
    '<div style="font-size:13px; margin-bottom:12px;">已登入：<b>' + escapeHtml(user.email || "") + '</b></div>' +
    '<p style="font-size:12px; color:var(--text-secondary); line-height:1.7;">' +
    '修改後會自動上傳。整包資料會一起同步，所以<b>兩台裝置同時編輯時只能擇一保留</b>，' +
    '遇到這種情況會跳出來問你，不會默默覆蓋。</p>' +
    '<div id="syncModalMsg" style="font-size:12px; margin-top:8px;"></div>' +
    '<div style="display:flex; gap:8px; margin-top:10px;">' +
    '<button class="btn btn-primary" style="flex:1;" onclick="pushNow(false)">立即上傳</button>' +
    '<button class="btn btn-secondary" style="flex:1;" onclick="manualPull()">從雲端取回</button>' +
    '</div>' +
    '<button class="btn btn-secondary" style="margin-top:10px; font-size:11px;" onclick="submitSyncSignOut()">登出</button>';
}

function setSyncModalMsg(text, isError) {
  const el = document.getElementById("syncModalMsg");
  if (!el) return;
  el.style.color = isError ? "var(--danger)" : "var(--text-secondary)";
  el.textContent = text;
}

function submitSyncConfig() {
  const url = document.getElementById("syncUrlInput").value.trim();
  const key = document.getElementById("syncKeyInput").value.trim();
  if (!url || !key) { setSyncModalMsg("兩個欄位都要填。", true); return; }
  if (!/^https:\/\/.+/.test(url)) { setSyncModalMsg("Project URL 應該長得像 https://xxxxx.supabase.co", true); return; }
  saveSyncConfig(url, key);
  renderSyncModal();
}

function clearSyncConfig() {
  localStorage.removeItem(SYNC_CONFIG_KEY);
  syncAuth.signOut();
  setSyncStatus("off");
  renderSyncModal();
}

async function submitSyncSignIn() {
  const email = document.getElementById("syncEmailInput").value.trim();
  const password = document.getElementById("syncPasswordInput").value;
  if (!email || !password) { setSyncModalMsg("請填入信箱與密碼。", true); return; }
  setSyncModalMsg("登入中…");
  try {
    await syncAuth.signIn(email, password);
    renderSyncModal();
    await initSync();
  } catch (e) {
    setSyncModalMsg(e.message || "登入失敗", true);
  }
}

async function submitSyncSignUp() {
  const email = document.getElementById("syncEmailInput").value.trim();
  const password = document.getElementById("syncPasswordInput").value;
  if (!email || !password) { setSyncModalMsg("請填入信箱與密碼。", true); return; }
  setSyncModalMsg("建立中…");
  try {
    const result = await syncAuth.signUp(email, password);
    if (!result.signedIn) {
      setSyncModalMsg("帳號已建立，請先到信箱收驗證信，完成後再回來登入。");
      return;
    }
    renderSyncModal();
    await initSync();
  } catch (e) {
    setSyncModalMsg(e.message || "建立帳號失敗", true);
  }
}

function submitSyncSignOut() {
  syncAuth.signOut();
  setSyncStatus("off");
  renderSyncModal();
}

/* 手動從雲端取回。會覆蓋本機未上傳的修改，所以先確認。 */
async function manualPull() {
  if (isLocalDirty() &&
      !confirm("這台裝置還有尚未上傳的修改，從雲端取回會覆蓋掉它們。確定要繼續嗎？")) {
    return;
  }
  setSyncStatus("syncing", "下載中…");
  try {
    const remote = await syncData.pull();
    if (!remote) { setSyncStatus("idle", "雲端還沒有資料"); return; }
    adoptRemote(remote);
    setSyncStatus("idle", "已從雲端更新");
  } catch (e) {
    setSyncStatus("error", e.message || "下載失敗");
  }
}

/* ---------- 狀態指示 ---------- */

function renderSyncIndicator() {
  const btn = document.getElementById("syncRailBtn");
  if (!btn) return;
  const marks = {
    off: "☁️",
    idle: "☁️",
    syncing: "🔄",
    error: "⚠️",
    conflict: "❗"
  };
  btn.textContent = marks[syncStatus] || "☁️";
  const user = syncAuth.currentUser();
  btn.title = "雲端同步" +
    (user ? "（" + user.email + "）" : "（未登入）") +
    (syncStatusDetail ? " — " + syncStatusDetail : "");
  btn.classList.toggle("sync-error", syncStatus === "error" || syncStatus === "conflict");
}
