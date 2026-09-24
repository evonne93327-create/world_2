/* ==========================================================
   雲端同步 — 流程控制 (sync.js)

   整包 appData 存成雲端的一列。這個做法跟現有架構完全吻合
   （saveData() 本來就是唯一的存檔出口）。衝突是逐筆判斷的
   （一篇文檔、一個資料夾、白板上的一個物件…，見 js/sync-merge.js）：
   沒撞到的自動同步，撞到的那幾筆暫停、列出來讓使用者選。
   原則是：寧可停下來問使用者，也絕不默默覆蓋。

   同步時間：每次上傳或下載成功，把雲端回傳的版本號與更新時間
   （Supabase 的 updated_at）記在 localStorage，只留最新一筆（見
   api.js 的 saveSyncState）。「雲端有沒有變」就是拿雲端現在的版本跟
   這一筆比。
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
  return safeStorageGet(SYNC_DIRTY_KEY) === "1";
}
function setLocalDirty(dirty) {
  if (dirty) safeStorageSet(SYNC_DIRTY_KEY, "1");
  else safeStorageRemove(SYNC_DIRTY_KEY);
}

/* ---------- 逐筆衝突（還沒決定的那幾筆） ----------

   存進 localStorage：重開 app 之後還是要記得那幾筆還沒決定，否則下一輪
   合併會把它們當成「只有本機改」而把這台的版本推上去（見 sync-merge.js
   的 CONFLICT_SENTINEL）。只存 { kind, id, title }，不存內容。 */
const SYNC_RECORD_CONFLICTS_KEY = "wb_sync_record_conflicts";

function loadRecordConflicts() {
  try {
    const v = JSON.parse(safeStorageGet(SYNC_RECORD_CONFLICTS_KEY));
    return Array.isArray(v) ? v : [];
  } catch (e) { return []; }
}

function saveRecordConflicts(list) {
  if (list && list.length) {
    safeStorageSet(SYNC_RECORD_CONFLICTS_KEY, JSON.stringify(list.map(function(c) {
      return { kind: c.kind, id: c.id, title: c.title };
    })));
  } else {
    safeStorageRemove(SYNC_RECORD_CONFLICTS_KEY);
  }
  if (typeof renderSyncIndicator === "function") renderSyncIndicator();
}

function hasRecordConflicts() {
  return loadRecordConflicts().length > 0;
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
  return safeStorageGet(SYNC_PROVIDER_KEY) || "supabase";
}

function saveProviderId(id) {
  safeStorageSet(SYNC_PROVIDER_KEY, id);
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

/* 雲端回來的版本比這台裝置已經記錄的還舊。

   version 是只會往上加的（Supabase 由 trigger 遞增、Drive 由 Google 遞增），
   所以「我上次同步到第 10 版，現在雲端說它是第 3 版」在正常情況下不可能發生。
   會發生代表這一次讀到的是過期的回應——瀏覽器的 HTTP 快取、或雲端服務
   本身寫完還沒完全生效（Google Drive 尤其會，剛 PATCH 完馬上下載有機會
   拿到上一版的內容）。

   這件事原本完全沒有防守：initSync() 只問「版本一不一樣」，不一樣就進到
   「沒有待上傳的修改就採用雲端」那條路，於是把舊的內容蓋回本機、寫進
   localStorage、狀態顯示「已從雲端更新」，看起來一切正常。更糟的是
   state.version 也被改成 3，下次再存檔就會把這份舊資料當成新版推上雲端。

   （version 歸 1 的情況——Supabase 那一列被刪掉重建——長得一模一樣，
   同樣落在這裡。兩者要做的事也一樣：不要自己決定，問使用者。） */
function remoteIsOlderThanRecord(remote) {
  const mine = Number(loadSyncState().version);
  const theirs = Number(remote && remote.version);
  if (!isFinite(mine) || !isFinite(theirs)) return false;   // 比不了就不擋
  return theirs < mine;
}

/* 過期的讀取通常是一時的，隔一下再問一次多半就對了。
   只重試一次：再錯就不是一時的，該讓使用者知道。 */
const STALE_REREAD_DELAY_MS = 1500;

async function pullFreshEnough() {
  const first = await P().pull();
  if (!first || !remoteIsOlderThanRecord(first)) return { row: first, stale: false };

  setSyncStatus("syncing", "雲端回應看起來是舊的，重新確認中…");
  await new Promise(function(r) { setTimeout(r, STALE_REREAD_DELAY_MS); });

  let second = null;
  try { second = await P().pull(); } catch (e) { /* 第二次失敗就用第一次的結果去問 */ }
  if (second && !remoteIsOlderThanRecord(second)) return { row: second, stale: false };
  return { row: second || first, stale: true };
}

/* 上次同步當下每一項的雜湊（三方合併的祖先）。見 js/sync-merge.js。

   只存雜湊不存內容：這個 app 的圖片是 base64 存在文檔裡的，存整包快照會讓
   localStorage 的佔用直接翻倍，很容易撐爆 5MB。 */
const SYNC_FP_KEY = "wb_sync_fp";

function loadSyncFingerprint() {
  try { return JSON.parse(safeStorageGet(SYNC_FP_KEY)) || null; } catch (e) { return null; }
}

/* 每一次「本機與雲端一致」的時刻都要重記一次：採用雲端之後、推送成功之後、
   解決衝突之後。漏掉任何一個，下次合併的祖先就是錯的——而錯的祖先會讓
   「只有一邊改」被誤判成「兩邊都改」（多問一次，還好），或更糟的
   「都沒改」（安靜地採用另一邊，丟掉一次編輯）。 */
function saveSyncFingerprint(data) {
  try {
    if (typeof fingerprintOf !== "function") return;
    safeStorageSet(SYNC_FP_KEY, JSON.stringify(fingerprintOf(data)));
  } catch (e) { /* 存不下就退回整包二選一，不要讓同步整個停擺 */ }
}

function adoptRemote(row) {
  appData = row.data;
  saveSyncState(row.version, row.at);
  saveSyncFingerprint(appData);
  setLocalDirty(false);
  saveRecordConflicts([]);   // 整包採用雲端之後，兩邊一致，沒有什麼好選的了
  lastPushedPayload = JSON.stringify(appData);

  // 直接寫回 localStorage，不要走 saveData()，否則會又標成髒的、又排一次推送
  safeStorageSet("novel_multi_world_data_v5", JSON.stringify(appData));

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
  if (activeView === 'canvas') renderCanvasUnlessEditing();
}

/* 正在打便條紙的時候不要重畫白板：重畫會把那張便條紙的元素整個換掉，
   焦點跟著消失，接下來打的字全部掉到地上（實測：打了六段只剩兩段）。
   先記著，打完（失焦）再畫。 */
function renderCanvasUnlessEditing() {
  if (typeof renderCanvasWhenNotEditing === "function") renderCanvasWhenNotEditing();
  else renderCanvas();
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
  await reconcileWithRemote();
}

/* 拉一次雲端，跟本機比，能安全採用就採用，不能就停下來問。

   這一段原本長在 initSync() 裡面，只在 DOMContentLoaded 跑一次。但裝成 app
   的人常常是「切到後台、在另一台改東西、再切回來」——那個過程不會重新載入
   頁面，所以永遠不會再對帳一次，回來看到的還是切走之前的資料。
   拆出來給「回到前景」共用，兩條路走的是同一套判斷，不會有一邊比較寬鬆。 */
let lastReconcileAt = 0;

async function reconcileWithRemote() {
  lastReconcileAt = Date.now();
  setSyncStatus("syncing", "正在對帳…");
  try {
    /* 先只問雲端現在是第幾版（幾十個位元組），跟上次同步記下的一樣就不用
       把整包抓下來。閒置時、切回來時的對帳大多是這種情況。 */
    const known = loadSyncState();
    if (typeof P().peek === "function" && known.version !== null && known.version !== undefined) {
      const head = await P().peek();
      if (head && String(head.version) === String(known.version)) {
        if (isLocalDirty()) await pushNow(true);
        else setSyncStatus("idle", "已是最新");
        return;
      }
    }

    const fresh = await pullFreshEnough();
    const remote = fresh.row;
    const state = loadSyncState();

    /* 讀到的還是比本機記錄的舊。絕對不能採用——那會把已經上傳成功的
       東西換成舊版，而且接下來還會把舊版推回雲端。停下來問。 */
    if (remote && fresh.stale) {
      openSyncConflictModal(remote, true);
      return;
    }

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
    /* 還有沒決定的衝突時不可以整包採用：那幾筆這台的版本還沒上去，
       整包換成雲端的就沒了。一律走合併。 */
    const undecided = hasRecordConflicts();

    if (!undecided && localLooksUntouched()) {
      adoptRemote(remote);
      setSyncStatus("idle", "已從雲端更新");
      return;
    }

    if (!undecided && !isLocalDirty() && !remoteWouldLoseContent(remote)) {
      adoptRemote(remote);
      setSyncStatus("idle", "已從雲端更新");
      return;
    }

    // 兩邊都有變更 → 先試逐篇合併，真的撞在一起才問（見 mergeOrAsk）
    mergeOrAsk(remote);
  } catch (e) {
    setSyncStatus("error", e.message || "同步失敗");
  }
}

/* 本機與雲端分岔了：逐筆合併，撞在一起的那幾筆列出來問使用者。

   **每一條發現分岔的路都必須走這裡**，不可以自己直接開衝突視窗。

   這一條踩過：合併本來只接在對帳（reconcileWithRemote）那一條路上，但兩台
   各改一篇時真正會先走到的是 pushNow() 的版本衝突——A 推成功、版本變 N+1，
   B 帶著 N 去推就衝突了，而那裡直接跳視窗，合併根本輪不到。使用者回報
   「兩台各改一篇，還是跳出視窗叫我選一邊」就是這個。

   有撞在一起的也照樣套用：沒撞到的照常同步，撞到的那幾筆兩邊都不動
   （這台顯示這台的、推上去的是雲端原本的，見 mergeAppData 的 data／upload），
   記進 loadRecordConflicts()，等使用者選。有新的衝突才跳視窗——同一批
   已經問過、按了「稍後再決定」的，不要每次同步都再跳一次。

   沒有指紋（第一次同步、剛換後端）時 mergeAppData() 回 null，退回整包二選一
   ——沒有祖先就分不出「誰改的」，硬合併等於瞎猜。

   回傳有沒有全部自己解決掉。 */
function mergeOrAsk(remote) {
  const before = loadRecordConflicts();
  const merged = (typeof mergeAppData === "function" && remote && remote.data)
    ? mergeAppData(loadSyncFingerprint(), appData, remote.data, before) : null;

  if (!merged) {
    openSyncConflictModal(remote, false, null);
    return false;
  }

  /* 連撞好幾次：通常是另一台正在打字、每幾秒推一次。這不是衝突（有衝突的
     那幾筆上面已經另外記了），不要跳整包二選一的視窗——那個視窗以前會在
     這裡跳出來，而且計數不會歸零，按了哪一邊，下一次一撞又跳回來，看起來
     就像按鈕沒反應。改成：先把合併結果留在本機，隔幾秒再推。 */
  if (mergePushRetries >= MERGE_PUSH_MAX_RETRIES) {
    mergePushRetries = 0;
    saveRecordConflicts(merged.conflicts);
    applyMergedDataLocally(merged, remote);
    setLocalDirty(true);
    setSyncStatus("idle", "雲端正在被另一台更新，稍後自動再上傳");
    setTimeout(function() { pushNow(true); }, MERGE_BACKOFF_MS + Math.random() * MERGE_BACKOFF_MS);
    return false;
  }

  saveRecordConflicts(merged.conflicts);
  applyMergedData(merged, remote);
  if (!merged.conflicts.length) return true;
  const seen = {};
  before.forEach(function(c) { seen[c.kind + ":" + c.id] = true; });
  if (merged.conflicts.some(function(c) { return !seen[c.kind + ":" + c.id]; })) {
    openRecordConflictModal();
  }
  return false;
}

/* 合併完要推回去，而推回去有可能又撞到（另一台在這幾百毫秒間又推了一次）。
   那時會再合併、再推——正常情況兩三輪內一定收斂，因為每一輪都把對方的東西
   併進來了。但不能無上限：真的一直撞就停下來問，不要讓兩台裝置在那邊互相
   推到天荒地老。連撞到上限就先退開，隔一段隨機的時間再推（兩台不會又剛好
   同時推）。 */
let mergePushRetries = 0;
const MERGE_PUSH_MAX_RETRIES = 3;
const MERGE_BACKOFF_MS = 4000;

/* 套用合併結果。

   跟 adoptRemote() 的差別：那個是「整包採用雲端」，套完就跟雲端一致了；
   這個套完之後本機還有雲端沒有的東西（另一台沒看過的那幾篇），所以要標成
   髒的並推回去——不推的話，另一台永遠拿不到這台的那幾篇。

   版本要記成 remote 的：我們是站在雲端那一版上面合併出來的，推送時的條件式
   更新才對得上。**指紋（合併的祖先）也要馬上記成 remote 的**，不能等推送成功：
   合併完，這台＝雲端那一版＋這台還沒上去的修改，所以共同祖先就是雲端那一版。
   原本等推送成功才記，推送又撞到的話（另一台正在打字、一直在推），下一輪
   合併拿的還是舊祖先——上一輪從雲端拿進來的東西會被當成「這台改的」，
   跟雲端又更新的那一版一比就變成衝突。使用者看到的是：另一台在打的便條紙，
   在這台一直跳衝突。這台自己的修改跟 remote 不同，仍然看得出是這台改的。

   推上去的是 merged.upload 不是 appData：兩者只差在還沒決定的衝突，那幾筆
   雲端要保留雲端原本的版本。指紋也跟著記 upload（＝雲端現在的樣子）。 */
function applyMergedData(merged, remote) {
  applyMergedDataLocally(merged, remote);

  if (!merged.changedFromRemote) {
    // 要推的跟雲端一樣（只有雲端改過，或本機的修改都在還沒決定的那幾筆裡）
    setLocalDirty(false);
    lastPushedPayload = JSON.stringify(appData);
    setSyncStatus("idle", "已從雲端更新");
    return;
  }

  setLocalDirty(true);
  setSyncStatus("syncing", "已合併，上傳中…");
  pushData(merged.upload);
}

/* 合併結果放進本機（記版本、記祖先、存檔、必要時重畫），不推。 */
function applyMergedDataLocally(merged, remote) {
  const activeBefore = activeDocSnapshot();
  appData = merged.data;
  saveSyncState(remote.version, remote.at);
  saveSyncFingerprint(remote.data);
  safeStorageSet("novel_multi_world_data_v5", JSON.stringify(appData));

  // 目前選的文檔可能在合併後不存在了（另一台刪掉的）
  if (activeDocId && !appData.docs.find(d => d.id === activeDocId)) {
    activeDocId = appData.docs.length ? appData.docs[0].id : null;
    if (activeDocId) activeWorldId = appData.docs[0].worldId;
  }
  if (!appData.worldviews.find(w => w.id === activeWorldId) && appData.worldviews.length) {
    activeWorldId = appData.worldviews[0].id;
  }

  /* 合併結果跟這台原本的一樣（只是把這台的東西推上去）就不要重畫。
     有還沒決定的衝突時，每一次上傳都會走到這裡——重新載入編輯器會把正在
     打的字、游標位置打斷。正在看的那篇沒變也不要重新載入它。 */
  if (merged.changedFromLocal) {
    renderWorldRail();
    renderSidebarTree();
    updateWorldBadge();
    if (activeDocId && activeDocSnapshot() !== activeBefore) loadDocToEditor(activeDocId);
    if (activeView === 'canvas') renderCanvasUnlessEditing();
  }
}

function activeDocSnapshot() {
  const d = activeDocId && appData.docs ? appData.docs.find(x => x.id === activeDocId) : null;
  return (activeDocId || "") + ":" + (d ? JSON.stringify(d) : "");
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

/* ---------- 一次只推一個 ----------

   上傳在路上的時候（手機網路慢起來可以好幾秒），使用者繼續打字、又停了
   2.5 秒，debounce 會再叫一次 pushNow()。兩個上傳同時帶著同一個版本號出去，
   後到的那個一定撞到——撞到的是這台自己剛推上去的東西。再加上合併的祖先
   還沒更新，這台自己改的便條紙就會被判成「兩邊都改」，一直跳衝突視窗。
   （使用者回報「另一台明明閒置，還是一直跳衝突」就是這個。）

   所以同一時間只允許一個上傳；期間再來的只記一個「等一下再推」，推完再補。 */
let pushBusy = 0;
let pushToken = 0;
let pushQueued = false;

function claimPush() {
  pushToken++;
  pushBusy = pushToken;
  return pushToken;
}

/* 只有自己還握著的時候才放掉：合併之後的重推會拿一個新的號碼接手，
   外層收尾時不可以把它的鎖一起放掉。 */
function releasePush(token) {
  if (pushBusy !== token) return;
  pushBusy = 0;
  if (pushQueued) {
    pushQueued = false;
    setTimeout(function() { pushNow(true); }, 0);
  }
}

async function pushNow(silent) {
  if (!syncIsActive()) return;
  if (pushBusy) { pushQueued = true; return; }

  /* 衝突還沒解決前不能推（會蓋掉雲端）。但也不能就這樣安靜地不做事——
     把那個問題重新擺到使用者面前，他才有機會解決它。 */
  if (pendingConflictRemote) {
    // 帶上第一次判定的原因，否則說明會退回成一般的「兩邊都有修改」
    openSyncConflictModal(pendingConflictRemote, pendingConflictStale);
    return;
  }

  const payload = JSON.stringify(appData);
  if (payload === lastPushedPayload && !isLocalDirty()) {
    setSyncStatus("idle", "已是最新");
    return;
  }

  /* 有還沒決定的衝突：不能直接把 appData 推上去（那幾筆會蓋掉雲端的）。
     先把雲端抓下來走合併，推的是合併出來的 upload。 */
  if (hasRecordConflicts()) {
    const token = claimPush();
    setSyncStatus("syncing", "上傳中…");
    try {
      /* 跟對帳一樣要擋「讀到比上次同步還舊的」：拿舊的去合併，版本會被記回
         舊的那一號，接著推上去就把雲端倒退了。 */
      const fresh = await pullFreshEnough();
      const remote = fresh.row;
      if (remote && fresh.stale) { openSyncConflictModal(remote, true); return; }
      if (remote) { mergeOrAsk(remote); return; }
      saveRecordConflicts([]);   // 雲端整個沒資料了，沒有東西會被蓋掉
    } catch (e) {
      setSyncStatus("error", e.message || "上傳失敗");
      return;
    } finally {
      releasePush(token);
    }
  }

  await pushData(appData);
}

/* 真的推一份上去。data 通常就是 appData；有還沒決定的衝突時是合併出來的
   upload（那幾筆保留雲端的版本）。

   **出發前先拍一張快照**，送的、記指紋的、比對有沒有再改的，全部用這一張。
   原本是等上傳回來之後才拿 appData 去記指紋、清「有未上傳修改」——但上傳
   在路上的那幾秒使用者還在打字，於是指紋記到了根本沒上去的字，旗標也被
   清掉：下一輪合併以為這台沒改、雲端那份（少了那幾個字）比較新，要嘛把
   字吃掉，要嘛把自己的便條紙判成衝突。 */
async function pushData(data) {
  const token = claimPush();
  const sentJson = JSON.stringify(data);
  const localAtStart = data === appData ? sentJson : JSON.stringify(appData);
  const sent = JSON.parse(sentJson);
  setSyncStatus("syncing", "上傳中…");
  try {
    const state = loadSyncState();
    const result = await P().push(sent, state.version);

    if (result.conflict) {
      /* 雲端被別台裝置改過。先把對方那份抓回來試合併——這是兩台各改一篇時
         真正會走到的路，只跳視窗的話逐篇合併等於沒做（見 mergeOrAsk）。 */
      const fresh = await pullFreshEnough();
      const remote = fresh.row;
      if (remote && fresh.stale) { openSyncConflictModal(remote, true); return; }
      mergePushRetries++;
      mergeOrAsk(remote);
      return;
    }

    mergePushRetries = 0;
    saveSyncState(result.version, result.at);
    saveSyncFingerprint(sent);
    lastPushedPayload = localAtStart;
    // 上傳途中又改了東西：那些還沒上去，旗標要留著，推完這次接著再推
    const changedMeanwhile = JSON.stringify(appData) !== localAtStart;
    setLocalDirty(changedMeanwhile);
    if (changedMeanwhile) pushQueued = true;
    setSyncStatus("idle", "已同步");
  } catch (e) {
    // 推送失敗時 dirty 旗標保持著，下次還會再試
    setSyncStatus("error", e.message || "上傳失敗");
  } finally {
    releasePush(token);
  }
}

/* 把還在等 debounce 的那次上傳立刻送出去。

   上傳是「存檔後 2.5 秒」才送的（連打字的人不要每個字都打一次 API）。
   問題是在手機上，切到別的 app、鎖螢幕、或把分頁滑掉的時候，系統會把
   這個頁面凍結——那 2.5 秒的計時器就再也不會跑完，剛剛打的東西沒上傳，
   而且完全沒有徵兆。下次在別台裝置打開，看到的就是舊的版本。

   所以在「頁面要離開前景」的那一刻先把它送掉。visibilitychange 的
   hidden 在 iOS 上是唯一可靠的那個事件（beforeunload 在 iOS 的 PWA
   幾乎不觸發）。 */
function flushPendingPush() {
  if (!syncPushTimer) return;
  clearTimeout(syncPushTimer);
  syncPushTimer = null;
  pushNow(true);
}

/* 上傳失敗（斷線、權杖過期、伺服器出錯）之後要自己再試。

   原本失敗只是把狀態設成 error，註解寫「下次還會再試」——但「下次」只有
   在使用者又改了東西的時候才會來。在捷運上改完一段、失敗、然後就沒再打字，
   那份修改可以一直躺著不上去。

   三個時機重試：網路恢復、頁面回到前景、以及每分鐘定時掃一次。
   條件是「本機真的有還沒推上去的東西」，沒有的話什麼都不做。 */
const SYNC_RETRY_INTERVAL_MS = 60 * 1000;

/* 停止操作滿這麼久，就自動下載（對帳）一次。使用者指定 3 分鐘。

   「一次」：同一段閒置只做一次，之後要等使用者又動了、再停滿 3 分鐘才會
   再做。放著不動一整晚不會每 3 分鐘打一發 API。 */
const SYNC_IDLE_MS = 3 * 60 * 1000;
const SYNC_IDLE_CHECK_MS = 15 * 1000;
let idleSyncDoneFor = -1;

function shouldIdleSync(idleMs, activityAt, doneFor, threshold) {
  if (idleMs < threshold) return false;
  return activityAt !== doneFor;
}

function retryPushIfNeeded() {
  if (!syncIsActive()) return;
  if (pendingConflictRemote) return;       // 等使用者決定，不要自己亂推
  if (syncStatus === "syncing") return;
  if (!isLocalDirty()) return;
  pushNow(true);
}

/* 回到前景時要不要重新對帳。

   抽成純函式才測得到——visibilityState 與計時在測試裡偽造不了，而這裡每一條
   都是「不做會弄丟資料」或「做了會打架」的判斷。

   - 沒開同步：沒什麼好對的。
   - 已經有衝突等使用者決定：再拉一次只會把問題蓋掉，而且他選的是哪一份就
     變成猜的。
   - 正在同步：讓它跑完，不要兩條路同時動 appData。
   - 剛對過帳：iOS 切換 app 時 visibilitychange 有時會連發，而且從
     通知中心滑一下回來也算一次。每次都打一輪 API 沒有意義。 */
const RESUME_RECONCILE_MIN_GAP_MS = 5000;

function shouldReconcileOnResume(active, hasConflict, status, msSinceLast, minGap) {
  if (!active) return false;
  if (hasConflict) return false;
  if (status === "syncing") return false;
  if (msSinceLast < minGap) return false;
  return true;
}

/* 現在就對帳一次——如果該對的話。回傳有沒有真的去對。

   三個呼叫端，判斷完全共用（上面那支純函式）：
   - 回到前景（visibilitychange / pageshow）
   - app 一直開著沒動：每隔一段時間自己掃一次
   - 在 app 裡切換（換文檔、切白板、開目錄欄）——那也是「我回來看這份資料了」

   不用擔心呼叫太頻繁：最短間隔那一道會把多餘的擋掉。 */
function maybeReconcileNow() {
  const ok = shouldReconcileOnResume(
    syncIsActive(), !!pendingConflictRemote, syncStatus,
    Date.now() - lastReconcileAt, RESUME_RECONCILE_MIN_GAP_MS);
  if (!ok) return false;

  /* 先把還在 debounce 裡的編輯寫進 localStorage。

     內文是「改完 400ms」才存檔的，而 isLocalDirty() 是存檔時才被標記的。
     少了這一行，剛打完就切走、回來時本機明明有新東西卻不算「髒」，對帳會
     安靜地採用雲端那份——剛打的字就沒了。 */
  if (typeof flushPendingContentPersist === "function") flushPendingContentPersist();

  reconcileWithRemote();
  return true;
}

function initSyncRecovery() {
  document.addEventListener("visibilitychange", function() {
    if (document.visibilityState === "hidden") { flushPendingPush(); return; }
    // 對帳本身就會在該推的時候推；它沒去對才輪到單純的重試
    if (!maybeReconcileNow()) retryPushIfNeeded();
  });

  /* iOS 從 bfcache 還原時不保證發 visibilitychange，但一定會發 pageshow。
     重複觸發不要緊，上面那道 5 秒的間隔會擋掉。 */
  window.addEventListener("pageshow", function() {
    if (!maybeReconcileNow()) retryPushIfNeeded();
  });

  window.addEventListener("pagehide", flushPendingPush);
  window.addEventListener("online", retryPushIfNeeded);
  setInterval(retryPushIfNeeded, SYNC_RETRY_INTERVAL_MS);

  /* App 一直開著沒動的情況：放在桌上開著，中間在另一台改了東西。

     沒有任何事件會通知我們——沒切到背景、沒換文檔，visibilitychange 不會發。
     所以停止操作滿 SYNC_IDLE_MS 就自己去對一次（lastActivityAt 是閒置備份
     提醒那邊在記的，見 markUserActivity）。

     沒對成（正在同步、剛對過）就下一輪再試，對成了這段閒置就不再做。

     藏在背景時不掃：看不到的東西不需要更新，而且 iOS 本來就會把背景分頁的
     計時器凍結，掃了也是白掃。回到前景時 visibilitychange 那條會補上。 */
  setInterval(function() {
    if (document.visibilityState !== "visible") return;
    if (!shouldIdleSync(Date.now() - lastActivityAt, lastActivityAt, idleSyncDoneFor, SYNC_IDLE_MS)) return;
    if (maybeReconcileNow()) idleSyncDoneFor = lastActivityAt;
  }, SYNC_IDLE_CHECK_MS);
}

/* 在 app 裡換了地方看——換文檔、切白板、打開目錄欄。

   人沒離開 app，所以 visibilitychange 不會發，但「我現在要看這份資料」的
   意圖跟切回前景是一樣的。最短間隔那一道會擋掉連續切換造成的連發。

   放在 sync.js 而不是各個呼叫端自己寫：政策只有一個地方，以後要改
   （例如只在換文檔時對、切白板不對）不用去翻三個檔案。 */
function syncOnUserNavigation() {
  maybeReconcileNow();
}

/* ---------- 衝突處理 ---------- */

let pendingConflictRemote = null;
/* 這次的衝突是不是「雲端比本機記錄還舊」。要記住，因為之後重新問的時候
   （pushNow 發現衝突還沒解決）如果不帶上，說明文字會退回成一般的
   「兩邊都有修改」，把「雲端那份比較舊、建議選這台」這個最關鍵的提示弄丟。 */
let pendingConflictStale = false;

/* conflicts：逐篇合併找出來的「同一篇兩邊都改」清單（見 js/sync-merge.js）。
   沒傳就是走整包二選一的老路——第一次同步、剛換後端、或合併本身也沒轍。 */
function openSyncConflictModal(remote, remoteLooksStale, conflicts) {
  pendingConflictRemote = remote;
  pendingConflictStale = !!remoteLooksStale;
  setSyncStatus("conflict", remoteLooksStale ? "雲端回應看起來是舊的" : "偵測到衝突");

  const info = document.getElementById("syncConflictInfo");
  if (info) {
    const when = remote && remote.at
      ? new Date(remote.at).toLocaleString()
      : "未知時間";
    const remoteDocs = remote && remote.data && Array.isArray(remote.data.docs)
      ? remote.data.docs.length : 0;
    info.innerHTML =
      (remoteLooksStale
        ? '<div style="margin-bottom:8px;">雲端傳回來的是<b>比這台裝置上次上傳的還要舊</b>的版本' +
          '（雲端說它是第 ' + escapeHtml(String(remote && remote.version)) + ' 版，' +
          '這台裝置上次同步到第 ' + escapeHtml(String(loadSyncState().version)) + ' 版）。' +
          '通常是雲端剛寫入還沒完全生效，過一下再開通常就正常了。' +
          '<b>不確定的話請選「用這台的版本」</b>，那是比較新的那一份。</div>'
        : '<div style="margin-bottom:8px;">這台裝置和雲端都有未同步的修改，需要你決定要保留哪一份。</div>') +
      conflictListHtml(conflicts) +
      '<div style="font-size:12px; color:var(--text-secondary); line-height:1.7;">' +
      '☁️ 雲端版本：' + remoteDocs + ' 份文檔，最後更新於 ' + escapeHtml(when) + '<br>' +
      '💻 這台裝置：' + (appData.docs ? appData.docs.length : 0) + ' 份文檔（尚未上傳）' +
      '</div>';
  }
  const modal = document.getElementById("syncConflictModal");
  if (modal) modal.classList.add("active");
}

/* 把「哪幾篇真的撞在一起」列出來。

   只說「有衝突」的話，使用者要在整包二選一的時候完全靠猜。列出來之後他至少
   知道自己在放棄什麼——而且多數情況下這個清單只有一兩篇，其餘幾百篇都是
   自動合併好的。

   標題一律走 escapeHtml：那是使用者自己打的字，直接拼進 innerHTML 就是一個洞
   （見 NOTES 的硬規則 5）。 */
const CONFLICT_LIST_MAX = 8;

function conflictListHtml(conflicts) {
  if (!conflicts || !conflicts.length) return "";

  const shown = conflicts.slice(0, CONFLICT_LIST_MAX);
  const rest = conflicts.length - shown.length;
  const kindLabel = RECORD_KIND_ICON;

  return '<div style="margin:8px 0; padding:8px 10px; background:var(--bg-sunken);' +
         ' border-radius:8px; font-size:12px; line-height:1.8;">' +
         '<b>兩邊都改過的有 ' + conflicts.length + ' 項</b>' +
         '（其餘的已經自動合併好了）：<br>' +
         shown.map(function(c) {
           return (kindLabel[c.kind] || "•") + " " + escapeHtml(String(c.title || c.id));
         }).join("<br>") +
         (rest > 0 ? '<br>…還有 ' + rest + ' 項' : '') +
         '</div>';
}

/* 「稍後再決定」把彈窗收起來，但衝突還在。

   原本收起來之後 syncStatus 就一直停在 "conflict"，而 pushNow() 開頭
   有一行 `if (syncStatus === "conflict") return;`——於是從那一刻起，
   這個分頁再也不會上傳任何東西，畫面上卻一切正常。使用者的感受就是
   「我明明登入了，它就是不上傳」，而且看不出為什麼。

   改成：收起來時記著衝突還沒解決，下一次要推送時把彈窗叫回來重問，
   而不是安靜地什麼都不做。使用者可以一直按「稍後再決定」，但每次有新的
   修改要上傳時都會再看到它一次——不會忘記，也不會被默默關掉。 */
function closeSyncConflictModal() {
  const modal = document.getElementById("syncConflictModal");
  if (modal) modal.classList.remove("active");
  if (pendingConflictRemote) {
    setSyncStatus("conflict", "尚未決定要保留哪一份，資料暫時不會上傳");
  }
}

async function resolveConflictUseRemote() {
  if (!pendingConflictRemote) return;
  mergePushRetries = 0;
  adoptRemote(pendingConflictRemote);
  pendingConflictRemote = null;
  pendingConflictStale = false;
  closeSyncConflictModal();
  setSyncStatus("idle", "已採用雲端版本");
}

async function resolveConflictUseLocal() {
  closeSyncConflictModal();
  setSyncStatus("syncing", "上傳中…");
  try {
    const result = await P().overwrite(appData);
    mergePushRetries = 0;
    saveSyncState(result.version, result.at);
    saveSyncFingerprint(appData);
    setLocalDirty(false);
    saveRecordConflicts([]);
    lastPushedPayload = JSON.stringify(appData);
    pendingConflictRemote = null;
    pendingConflictStale = false;
    setSyncStatus("idle", "已以本機版本覆蓋雲端");
  } catch (e) {
    setSyncStatus("error", e.message || "覆蓋失敗");
  }
}

/* ==========================================================
   逐筆衝突的視窗

   每一筆一列，三個選項：用這台的／用雲端的／兩份都留（只有兩邊都還在的
   文檔才有）。選了那一筆才重新跟著同步；沒選的那幾筆繼續暫停，其他的照常。

   標題是使用者自己打的字，一律 textContent（NOTES 硬規則 5）。
   ========================================================== */

const RECORD_KIND_ICON = {
  doc: "📄", folder: "📁", world: "🌐", canvasNode: "🧩", canvasEdge: "🔗", canvasNote: "🗒️",
  trashDoc: "🗑️", trashFolder: "🗑️", trashCanvas: "🗑️", trashWorld: "🗑️"
};

let recordResolving = false;

function openRecordConflictModal() {
  renderRecordConflictModal();
  const modal = document.getElementById("syncRecordConflictModal");
  if (modal && hasRecordConflicts()) modal.classList.add("active");
}

function closeRecordConflictModal() {
  const modal = document.getElementById("syncRecordConflictModal");
  if (modal) modal.classList.remove("active");
}

function renderRecordConflictModal() {
  const list = document.getElementById("syncRecordConflictList");
  if (!list) return;
  const conflicts = loadRecordConflicts();
  if (!conflicts.length) { closeRecordConflictModal(); return; }

  list.innerHTML = "";
  conflicts.forEach(function(c) {
    const row = document.createElement("div");
    row.className = "sync-record-row";

    const name = document.createElement("div");
    name.className = "sync-record-name";
    name.textContent = (RECORD_KIND_ICON[c.kind] || "•") + " " + String(c.title || c.id);
    row.appendChild(name);

    const actions = document.createElement("div");
    actions.className = "sync-record-actions";
    function addBtn(text, choice) {
      const b = document.createElement("button");
      b.className = "btn btn-secondary";
      b.textContent = text;
      b.disabled = recordResolving;
      b.onclick = function() { resolveRecordConflicts([c], choice); };
      actions.appendChild(b);
    }
    addBtn("💻 用這台的", "local");
    addBtn("☁️ 用雲端的", "remote");
    if (c.kind === "doc") addBtn("📑 兩份都留", "both");
    row.appendChild(actions);
    list.appendChild(row);
  });

  ["syncRecordAllLocal", "syncRecordAllRemote"].forEach(function(id) {
    const b = document.getElementById(id);
    if (b) b.disabled = recordResolving;
  });
}

/* 套用使用者的選擇。choice 是 "local" | "remote" | "both"。

   先抓一次雲端最新的：「用雲端的」要拿的是雲端現在的版本，不是剛才看到的；
   「用這台的」要把祖先記成雲端現在的樣子，下一輪合併才會把這台的推上去。
   雲端在這之間又被改了，那一筆會再變成衝突——那也是對的。

   同步時間在這之後才更新（mergeOrAsk → 推送成功時）。 */
async function resolveRecordConflicts(targets, choice) {
  if (recordResolving || !targets.length || !syncIsActive()) return;
  recordResolving = true;
  renderRecordConflictModal();
  setSyncStatus("syncing", "套用你的選擇…");
  try {
    if (typeof flushPendingContentPersist === "function") flushPendingContentPersist();
    const fresh = await pullFreshEnough();
    if (!fresh.row || fresh.stale) {
      setSyncStatus("error", "暫時讀不到雲端最新的版本，請稍後再選一次");
      return;
    }
    const remote = fresh.row;

    let data = appData;
    let fp = loadSyncFingerprint() || {};
    targets.forEach(function(c) {
      /* 兩份都留：兩邊都還在才做得出副本。只剩一邊（另一邊刪了）的話，
         「兩份都留」能留的就是還在的那一份——這台有就用這台的，否則用雲端的。 */
      let pick = choice;
      if (choice === "both" && !(getRecord(data, c.kind, c.id) && getRecord(remote.data, c.kind, c.id))) {
        pick = getRecord(data, c.kind, c.id) ? "local" : "remote";
      }
      const r = applyRecordChoice(data, fp, remote.data, c, pick,
        pick === "both" ? newItemId("doc_") : null);
      data = r.data;
      fp = r.fp;
    });

    const done = {};
    targets.forEach(function(c) { done[c.kind + ":" + c.id] = true; });
    saveRecordConflicts(loadRecordConflicts().filter(function(c) { return !done[c.kind + ":" + c.id]; }));

    appData = data;
    safeStorageSet(SYNC_FP_KEY, JSON.stringify(fp));
    safeStorageSet("novel_multi_world_data_v5", JSON.stringify(appData));
    setLocalDirty(true);
    mergePushRetries = 0;
    mergeOrAsk(remote);
  } catch (e) {
    setSyncStatus("error", e.message || "套用失敗");
  } finally {
    recordResolving = false;
    renderRecordConflictModal();
  }
}

function resolveAllRecordConflicts(choice) {
  resolveRecordConflicts(loadRecordConflicts(), choice);
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
    '修改後會自動上傳；停止操作 3 分鐘後會自動下載一次。兩台裝置改到<b>同一筆</b>' +
    '（同一篇文檔、白板上同一個物件…）時會列出來問你，其他的照常同步，不會默默覆蓋。</p>' +
    (hasRecordConflicts()
      ? '<button class="btn btn-danger" style="margin-bottom:8px;" onclick="closeSyncModal(); openRecordConflictModal()">❗ 有 ' +
        loadRecordConflicts().length + ' 項衝突等你決定</button>'
      : '') +
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
  saveRecordConflicts([]);   // 衝突也是跟舊後端比出來的
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
  if ((isLocalDirty() || hasRecordConflicts()) &&
      !confirm("這台裝置還有尚未上傳的修改，從雲端取回會覆蓋掉它們。確定要繼續嗎？")) {
    return;
  }
  setSyncStatus("syncing", "下載中…");
  try {
    const fresh = await pullFreshEnough();
    const remote = fresh.row;
    if (!remote) { setSyncStatus("idle", "雲端還沒有資料"); return; }
    if (fresh.stale) { openSyncConflictModal(remote, true); return; }
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
  const p = P();
  const account = p.account();

  /* 「設定過這個後端、卻沒有帳號」＝授權掉了（Google 的權杖一小時就過期，
     而且刻意不存在本機，重開 app 時要靠靜默授權要回來；Google 不給的時候
     就會落到這裡）。使用者記得自己登入過，所以不會主動去看設定——不點個
     紅點出來，他只會發現「東西沒上去」而不知道是為什麼。 */
  const needsSignIn = p.isConfigured() && !account;
  const undecided = syncIsActive() ? loadRecordConflicts().length : 0;
  const needsAttention = (syncStatus === "error" || syncStatus === "conflict" || needsSignIn || undecided > 0);

  const icon = document.getElementById("syncRowIcon");
  if (icon) icon.textContent = marks[syncStatus] || "☁️";

  const status = document.getElementById("syncRowStatus");
  if (status) {
    status.textContent = p.label +
      (account ? "（" + account + "）" : needsSignIn ? "（授權已過期，需要重新登入）" : "（未登入）") +
      (syncStatusDetail ? " — " + syncStatusDetail : "") +
      (undecided ? "（" + undecided + " 項衝突待決定）" : "");
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
