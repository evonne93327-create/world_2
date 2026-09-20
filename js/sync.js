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
/* 這台裝置是不是還停在出廠狀態（只有那幾篇範例文檔、一個字都沒改）。

   原本是把整包 appData 轉成文字跟 INITIAL_APP_DATA 比對——但載入時
   migrateDocTags() 已經先幫每篇補上 manualTags，而 INITIAL_APP_DATA 裡
   沒有這個 key，所以兩串文字永遠不可能相同，這個函式永遠回傳 false。
   之後再加任何欄位也會重蹈覆轍。

   改成只看「認得出來的身分」：篇數一樣、id 一樣、標題與內文都沒被動過。
   往資料結構加欄位不會影響這個判斷。

   （這個函式有兩個用途：判斷要不要跳同步衝突，以及判斷有沒有還沒備份的
   修改。壞掉的時候後者會讓全新安裝、一個字都沒寫就跳出備份提醒。） */
function localLooksUntouched() {
  try {
    const initial = INITIAL_APP_DATA.docs || [];
    const now = appData.docs || [];
    if (now.length !== initial.length) return false;

    for (let i = 0; i < initial.length; i++) {
      const a = initial[i];
      const b = now.find(function(d) { return d.id === a.id; });
      if (!b) return false;
      if ((b.title || "") !== (a.title || "")) return false;
      if ((b.content || "") !== (a.content || "")) return false;
    }

    // 資料夾與世界觀的數量也要沒變，否則「只是還沒寫字，但已經建好架構了」
    // 會被誤判成沒動過
    if ((appData.folders || []).length !== (INITIAL_APP_DATA.folders || []).length) return false;
    if ((appData.worldviews || []).length !== (INITIAL_APP_DATA.worldviews || []).length) return false;

    /* 白板也要比。注意出廠預設本來就附了一個範例白板（兩個節點一條線），
       所以不能寫成「白板上有東西就算動過」——那樣又會永遠回傳 false，
       跟原本拿整包 JSON 比對是同一類錯誤。跟出廠那份的數量比才對。 */
    const countOf = function(w) {
      const c = (w && w.canvas) || {};
      return (c.nodes || []).length + ":" + (c.edges || []).length + ":" + (c.notes || []).length;
    };
    for (let i = 0; i < (INITIAL_APP_DATA.worldviews || []).length; i++) {
      const iw = INITIAL_APP_DATA.worldviews[i];
      const nw = (appData.worldviews || []).find(function(w) { return w.id === iw.id; });
      if (!nw) return false;
      if (countOf(nw) !== countOf(iw)) return false;
    }

    return true;
  } catch (e) {
    return false;
  }
}

/* 採用雲端會不會讓內容變少。

   只看篇數不夠——改標題不會變篇數，但整篇被刪掉就會。這裡刻意寬鬆：
   只要雲端的文檔或世界觀比本機少，就算「可能會毀掉東西」，寧可多問一次。
   使用者在別台裝置真的刪了文檔時也會問，那是對的：刪除本來就該確認一次。 */
function remoteWouldLoseContent(remote) {
  const rd = (remote && remote.data) || {};
  const remoteDocs = Array.isArray(rd.docs) ? rd.docs.length : 0;
  const remoteWorlds = Array.isArray(rd.worldviews) ? rd.worldviews.length : 0;
  const localDocs = (appData.docs || []).length;
  const localWorlds = (appData.worldviews || []).length;
  return remoteDocs < localDocs || remoteWorlds < localWorlds;
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

  /* Google 雲端硬碟的權杖不存本機，每次重開都是空的。先靜默試著要回來，
     不然 syncIsActive() 一定是 false，同步會在使用者毫不知情的狀況下關掉。
     Supabase 的 session 有存在 localStorage，不需要這一步。 */
  if (loadProviderId() === "gdrive" && typeof restoreGdriveSessionQuietly === "function") {
    setSyncStatus("syncing", "正在恢復 Google 授權…");
    await restoreGdriveSessionQuietly();
    renderSyncIndicator();
  }

  if (!syncIsActive()) { setSyncStatus("off"); return; }

  setSyncStatus("syncing", "正在對帳…");
  try {
    const remote = await P().pull();
    const state = loadSyncState();

    /* 雲端還沒有資料：把本機推上去當作第一版。

       但如果本機還是出廠範例（剛裝好就登入），推上去等於用範例資料佔住
       雲端的第一版——之後其他裝置對帳時會看到一份「有效但內容是範例」的
       雲端資料。不推，等使用者真的寫了東西再說。 */
    if (!remote) {
      if (localLooksUntouched()) {
        setSyncStatus("idle", "雲端還沒有資料，開始寫之後會自動上傳");
        return;
      }
      await pushNow(true);
      return;
    }

    // 這台裝置已經同步到雲端的最新版
    if (state.version === remote.version) {
      if (isLocalDirty()) await pushNow(true);
      else setSyncStatus("idle", "已是最新");
      return;
    }

    /* 雲端的版本跟本機記錄的不一樣，代表別的地方寫過。

       但「版本不一樣」不等於「雲端比較新」。schema 裡資料列被重建時
       version 會歸 1（supabase/schema.sql 的 trigger：insert 時 version := 1），
       所以「本機記錄 57、雲端是 1」也算不一樣——那其實是雲端被重設了。

       原本的判斷是「沒有待上傳的修改 → 直接採用雲端」。實測過：本機 200 篇、
       雲端 2 篇，會直接覆蓋成 2 篇，寫進 localStorage，不問也不提示。
       「沒有待上傳的修改」只代表沒東西要推，不代表本機的資料不值錢。

       改成：只有在確定不會毀掉東西的時候才安靜採用，其餘一律跳出來問。 */
    if (localLooksUntouched()) {
      adoptRemote(remote);
      setSyncStatus("idle", "已從雲端更新");
      return;
    }

    if (!isLocalDirty() && !remoteWouldLoseContent(remote)) {
      adoptRemote(remote);
      setSyncStatus("idle", "已從雲端更新");
      return;
    }

    // 兩邊都有變更，或採用雲端會少掉東西 → 停下來問，不猜
    openSyncConflictModal(remote);
  } catch (e) {
    setSyncStatus("error", e.message || "同步失敗");
  }
}

/* ---------- 推送 ---------- */

// storage.js 的 saveData() 會呼叫這裡
function onDataSaved() {
  // 有新的修改就解除「稍後再說」，否則按過一次之後這個 session 都不會再提醒。
  // 放在 syncIsActive() 判斷之前：沒設定雲端同步的人一樣需要被提醒備份。
  idleBackupSnoozed = false;

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
  const marks = {
    off: "☁️",
    idle: "☁️",
    syncing: "🔄",
    error: "⚠️",
    conflict: "❗"
  };
  const account = P().account();
  const needsAttention = (syncStatus === "error" || syncStatus === "conflict");

  const icon = document.getElementById("syncRowIcon");
  if (icon) icon.textContent = marks[syncStatus] || "☁️";

  const status = document.getElementById("syncRowStatus");
  if (status) {
    status.textContent = P().label +
      (account ? "（" + account + "）" : "（未登入）") +
      (syncStatusDetail ? " — " + syncStatusDetail : "");
    status.classList.toggle("is-alert", needsAttention);
  }

  /* 同步的 ☁️ 按鈕收進設定之後，出問題就看不到了。在設定按鈕上點一個
     紅點，至少還看得出「裡面有東西要處理」。 */
  const railBtn = document.getElementById("settingsRailBtn");
  if (railBtn) railBtn.classList.toggle("has-alert", needsAttention);
}

/* ==========================================================
   閒置備份提醒

   視窗連續一段時間沒有任何動作時，提醒使用者把資料備份出去。

   刻意加了三道條件，不是無條件每三分鐘跳一次：
   - 分頁在背景時不跳。人根本沒在看，跳出來只會在他回來那一刻擋路。
   - 已經有別的彈窗開著時不跳，不疊在別人上面。
   - 沒有東西需要備份就不跳。雲端同步開著的時候，存檔後 2.5 秒就會自動
     上傳，三分鐘後通常早就推完了——這時候跳出來問要不要備份是純粹的噪音。
     所以只在「真的還有沒備份的修改」時才問。

   按過「稍後再說」之後會停掉，直到下一次有新的修改才會重新計時，
   否則放著不動就會每三分鐘被打擾一次。
   ========================================================== */

const IDLE_BACKUP_MS = 3 * 60 * 1000;
const IDLE_CHECK_INTERVAL_MS = 15 * 1000;

let lastActivityAt = Date.now();
let idleBackupSnoozed = false;
let idleBackupTimer = null;

function markUserActivity() {
  lastActivityAt = Date.now();
}

// 有沒有東西值得備份
function hasUnbackedUpChanges() {
  if (syncIsActive()) return isLocalDirty();
  // 還沒設定雲端同步：只要資料不是原封不動的預設範例，就是只存在這台瀏覽器裡
  return !localLooksUntouched();
}

function shouldShowIdleBackup() {
  if (idleBackupSnoozed) return false;
  if (document.hidden) return false;
  if (document.querySelector(".modal-overlay.active")) return false;
  if (syncStatus === "syncing" || syncStatus === "conflict") return false;
  if (!hasUnbackedUpChanges()) return false;
  return Date.now() - lastActivityAt >= IDLE_BACKUP_MS;
}

function openIdleBackupModal() {
  const info = document.getElementById("idleBackupInfo");
  const actions = document.getElementById("idleBackupActions");
  if (!info || !actions) return;

  const mins = Math.round(IDLE_BACKUP_MS / 60000);
  actions.innerHTML = "";

  function addBtn(cls, text, handler) {
    const b = document.createElement("button");
    b.className = "btn " + cls;
    b.textContent = text;
    b.onclick = handler;
    actions.appendChild(b);
  }

  if (syncIsActive()) {
    info.innerHTML = "已經 " + mins + " 分鐘沒有動作了，這台裝置還有<strong>尚未上傳</strong>的修改。<br>" +
      "目前的雲端後端：" + escapeHtml(P().label) + "。";
    addBtn("btn-primary", "☁️ 立即上傳", function() { closeIdleBackupModal(); pushNow(false); });
  } else {
    info.innerHTML = "已經 " + mins + " 分鐘沒有動作了。這台裝置<strong>還沒設定雲端同步</strong>，" +
      "資料只存在這個瀏覽器裡——清掉瀏覽器資料就沒了。";
    addBtn("btn-primary", "☁️ 設定雲端同步", function() { closeIdleBackupModal(); openSyncModal(); });
  }

  addBtn("btn-secondary", "💾 存成檔案備份", function() {
    closeIdleBackupModal();
    if (typeof exportFullDatabaseJSON === "function") exportFullDatabaseJSON();
  });
  addBtn("btn-secondary", "稍後再說", dismissIdleBackup);

  document.getElementById("idleBackupModal").classList.add("active");
}

function closeIdleBackupModal() {
  document.getElementById("idleBackupModal").classList.remove("active");
  markUserActivity();
}

/* 「稍後再說」：關掉並停止再問，直到下一次有新的修改（onDataSaved 會解除）。
   沒有這個的話，人離開座位，回來會看到同一個彈窗問過很多次。 */
function dismissIdleBackup() {
  idleBackupSnoozed = true;
  closeIdleBackupModal();
}

function initIdleBackupReminder() {
  ["pointerdown", "pointermove", "keydown", "wheel", "touchstart", "focus"].forEach(function(evt) {
    window.addEventListener(evt, markUserActivity, { passive: true, capture: true });
  });
  // 捲動不會冒泡到 window，要用捕獲階段才收得到編輯器裡的捲動
  window.addEventListener("scroll", markUserActivity, { passive: true, capture: true });
  document.addEventListener("visibilitychange", function() {
    if (!document.hidden) markUserActivity();
  });

  // 用「定期檢查時間戳」而不是「每次動作都重設 setTimeout」：
  // pointermove 一秒可以觸發幾十次，重設計時器太浪費。
  if (idleBackupTimer) clearInterval(idleBackupTimer);
  idleBackupTimer = setInterval(function() {
    if (shouldShowIdleBackup()) openIdleBackupModal();
  }, IDLE_CHECK_INTERVAL_MS);
}
