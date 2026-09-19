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

/* ---------- 目前選用的後端 ---------- */

const SYNC_PROVIDER_KEY = "world_sync_provider_v1";

function loadProviderId() {
  return localStorage.getItem(SYNC_PROVIDER_KEY) || "supabase";
}

function saveProviderId(id) {
  localStorage.setItem(SYNC_PROVIDER_KEY, id);
}

/* 同步流程一律透過這個物件跟後端講話，不直接碰 Supabase 或 Google 的東西 */
function P() {
  return loadProviderId() === "gdrive" ? gdriveProvider : supabaseProvider;
}

function syncIsActive() {
  const p = P();
  return p.isConfigured() && !!p.account();
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
  saveSyncState(row.version, row.at);
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
    const remote = await P().pull();
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
    const result = await P().push(appData, state.version);

    if (result.conflict) {
      // 雲端被別台裝置改過，先把對方的版本抓回來給使用者比較
      const remote = await P().pull();
      openSyncConflictModal(remote);
      return;
    }

    saveSyncState(result.version, result.at);
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
    const when = remote && remote.at
      ? new Date(remote.at).toLocaleString()
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
    const result = await P().overwrite(appData);
    saveSyncState(result.version, result.at);
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

  const p = P();
  const account = p.account();

  let html = renderProviderChooser();

  // 還沒設定好、或還沒登入 → 顯示該後端自己的設定步驟
  if (!p.isConfigured() || !account) {
    body.innerHTML = html + p.renderSetup();
    return;
  }

  body.innerHTML = html +
    syncStatusLine() +
    '<div style="font-size:13px; margin-bottom:12px;">目前帳號：<b>' + escapeHtml(account) + '</b></div>' +
    '<p style="font-size:12px; color:var(--text-secondary); line-height:1.7;">' +
    '修改後會自動上傳。整包資料一起同步，所以<b>兩台裝置同時編輯時只能擇一保留</b>，' +
    '遇到這種情況會跳出來問你，不會默默覆蓋。</p>' +
    '<div id="syncModalMsg" style="font-size:12px; margin-top:8px;"></div>' +
    '<div style="display:flex; gap:8px; margin-top:8px;">' +
    '<button class="btn btn-primary" onclick="pushNow(false)">立即上傳</button>' +
    '<button class="btn btn-secondary" onclick="manualPull()">從雲端取回</button>' +
    '<button class="btn btn-secondary" onclick="submitSyncSignOut()">登出</button>' +
    '</div>';
}

/* 後端選擇器。兩邊各自獨立記住自己的設定與帳號，
   所以切換不會弄丟另一邊的設定，但資料也不會自動搬過去——
   這點要講明，否則使用者會以為換一下就全部跟著走。 */
function renderProviderChooser() {
  const current = loadProviderId();
  const opts = [supabaseProvider, gdriveProvider];
  let html = '<div style="display:flex; gap:8px; margin-bottom:10px;">';
  opts.forEach(function(o) {
    const on = o.id === current;
    html += '<button class="btn ' + (on ? 'btn-primary' : 'btn-secondary') + '" ' +
      'onclick="switchSyncProvider(\'' + o.id + '\')">' +
      escapeHtml(o.label) + '</button>';
  });
  html += '</div>';
  html += '<div style="font-size:11px; color:var(--text-muted); margin-bottom:12px; line-height:1.6;">' +
    escapeHtml((current === 'gdrive' ? gdriveProvider : supabaseProvider).blurb) + '</div>';
  return html;
}

function switchSyncProvider(id) {
  if (id === loadProviderId()) return;
  if (isLocalDirty() &&
      !confirm("這台裝置還有尚未上傳的修改。切換後端不會自動搬移資料，" +
               "建議先切回原本的後端上傳完再換。確定現在切換嗎？")) {
    return;
  }
  saveProviderId(id);
  saveSyncState(null, null); // 新後端的版本紀錄跟舊的無關
  setSyncStatus("off");
  renderSyncModal();
  initSync();
}

function setSyncModalMsg(text, isError) {
  const el = document.getElementById("syncModalMsg");
  if (!el) return;
  el.style.color = isError ? "var(--danger)" : "var(--text-secondary)";
  el.textContent = text;
}

function submitSyncSignOut() {
  P().signOut();
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
    const remote = await P().pull();
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
  const account = P().account();
  btn.title = "雲端同步 · " + P().label +
    (account ? "（" + account + "）" : "（未登入）") +
    (syncStatusDetail ? " — " + syncStatusDetail : "");
  btn.classList.toggle("sync-error", syncStatus === "error" || syncStatus === "conflict");
}
