/* 「回到前景就先對帳一次」的判斷。

   這一塊每一條都是「不做會弄丟資料」或「做了會打架」，而且錯了不會有錯誤
   訊息——只會在某一次切回來的時候，安靜地把某一邊的資料換掉。 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { loadApp, ROOT } = require("./helpers/load-app.js");

/* sync.js 不在預設載入清單裡（那份只載測純函式需要的幾支）。 */
const app = loadApp(["js/state.js", "js/storage.js", "js/main.js", "js/sync.js"]);
const syncJs = fs.readFileSync(path.join(ROOT, "js", "sync.js"), "utf8");

const GAP = 5000;

test("shouldReconcileOnResume：什麼時候該重新對帳", function() {
  const f = app.shouldReconcileOnResume;

  // 一般情況：切回來、離上次對帳夠久 → 對
  assert.strictEqual(f(true, false, "idle", 60000, GAP), true);

  // 沒開雲端同步，沒什麼好對的
  assert.strictEqual(f(false, false, "idle", 60000, GAP), false);

  /* 已經有衝突等使用者決定。再拉一次只會把問題蓋掉，而且他選的是哪一份
     就變成猜的。 */
  assert.strictEqual(f(true, true, "idle", 60000, GAP), false);

  // 正在同步：讓它跑完，不要兩條路同時動 appData
  assert.strictEqual(f(true, false, "syncing", 60000, GAP), false);

  /* 剛對過帳。iOS 切換 app 時 visibilitychange 有時連發，從通知中心滑一下
     回來也算一次——每次都打一輪 API 沒有意義。 */
  assert.strictEqual(f(true, false, "idle", 100, GAP), false);
  assert.strictEqual(f(true, false, "idle", GAP - 1, GAP), false);
  assert.strictEqual(f(true, false, "idle", GAP, GAP), true, "剛好到門檻就該對");

  // 上一次失敗（error）不該擋住下一次對帳——那正是最需要重試的狀態
  assert.strictEqual(f(true, false, "error", 60000, GAP), true);
});

test("間隔要擋得掉連發，又不能久到切回來還是舊資料", function() {
  const m = syncJs.match(/const RESUME_RECONCILE_MIN_GAP_MS = (\d+);/);
  assert.ok(m, "要有具名常數，不要把毫秒數散在程式碼裡");
  const ms = parseInt(m[1], 10);
  assert.ok(ms >= 1000, "太短擋不掉 iOS 那種連發的 visibilitychange");
  assert.ok(ms <= 30000, "太長的話切回來看到的還是舊資料，這個功能就沒意義了");
});

test("對帳只有一套判斷，開啟與回到前景共用", function() {
  /* 兩邊各寫一套的話，遲早有一邊比較寬鬆——而「比較寬鬆」在這裡的意思是
     某個情況下會安靜地覆蓋掉一邊的資料。 */
  assert.match(syncJs, /async function reconcileWithRemote\(\)/,
    "對帳要抽成一支共用的函式");

  const init = syncJs.match(/async function initSync\(\)[\s\S]*?(?=\n\/\*|\nasync function |\nfunction )/);
  assert.ok(init, "找不到 initSync()");
  assert.match(init[0], /await reconcileWithRemote\(\)/,
    "initSync() 要走共用的那一支，不要自己再寫一套");

  // 停下來問的那條路不能在重構中掉了
  assert.match(syncJs, /openSyncConflictModal\(remote\)/,
    "不能安全採用時要跳出衝突視窗，不可以自己猜");
});

test("回到前景要對帳，不能只是重試上傳", function() {
  /* 原本回到前景只做 retryPushIfNeeded()，那只推不拉——在另一台改的東西
     永遠不會被拉回來，而這正是使用者要的功能。 */
  const recovery = syncJs.match(/function initSyncRecovery\(\)[\s\S]*?\n}/);
  assert.ok(recovery, "找不到 initSyncRecovery()");

  /* 兩個監聽器要分開檢查。只在整段 initSyncRecovery() 裡找
     maybeReconcileNow 的話，其中一個掉了、另一個還在，測試照樣綠——
     這個測試自己先這樣寫過，紅不起來。 */
  const onVisible = recovery[0].match(/addEventListener\("visibilitychange"[\s\S]*?\n  \}\);/);
  assert.ok(onVisible, "要聽 visibilitychange");
  assert.match(onVisible[0], /maybeReconcileNow\(\)/,
    "回到前景要對帳 —— 只做 retryPushIfNeeded() 的話只推不拉");
  assert.match(onVisible[0], /visibilityState === "hidden"/,
    "hidden 那一支還是要把待上傳的送掉");

  /* iOS 從 bfcache 還原時不保證發 visibilitychange，但一定會發 pageshow。 */
  const onShow = recovery[0].match(/addEventListener\("pageshow"[\s\S]*?\n  \}\);/);
  assert.ok(onShow, "iOS 的 bfcache 還原只保證發 pageshow");
  assert.match(onShow[0], /maybeReconcileNow\(\)/, "pageshow 也要對帳");

  // 切走時把還在等的上傳送掉，這條原本就有，不能弄丟
  assert.match(recovery[0], /flushPendingPush/,
    "切到背景時要先把還在 debounce 的上傳送出去");
});

test("對帳前要先把還在 debounce 裡的編輯存起來", function() {
  /* 內文是「改完 400ms」才存檔的，而 isLocalDirty() 是存檔時才標記的。
     少了這一步：剛打完字就切走、回來時本機明明有新東西卻不算「髒」，
     對帳會安靜地採用雲端那份——剛打的字就沒了。 */
  const fn = syncJs.match(/function maybeReconcileNow\(\)[\s\S]*?\n}/);
  assert.ok(fn, "找不到 maybeReconcileNow()");

  const flushAt = fn[0].indexOf("flushPendingContentPersist");
  const reconcileAt = fn[0].indexOf("reconcileWithRemote(");
  assert.ok(flushAt !== -1,
    "對帳前要先 flushPendingContentPersist() —— 否則剛打的字會被當成不存在");
  assert.ok(reconcileAt !== -1);
  assert.ok(flushAt < reconcileAt,
    "要排在對帳之前 —— 排在後面等於沒做");
});

/* ==========================================================
   另外兩個對帳的時機
   ========================================================== */
test("app 一直開著沒動的時候也要自己去對一次", function() {
  /* 放在桌上開著，中間在另一台改了東西——沒切到背景、沒換文檔，
     visibilitychange 不會發，沒有任何事件會通知我們。只能自己定期掃。 */
  const recovery = syncJs.match(/function initSyncRecovery\(\)[\s\S]*?\n}/);
  assert.ok(recovery, "找不到 initSyncRecovery()");

  const poll = recovery[0].match(/setInterval\(function\(\)[\s\S]*?SYNC_POLL_INTERVAL_MS\)/);
  assert.ok(poll, "要有一個定期對帳的計時器");
  assert.match(poll[0], /maybeReconcileNow\(\)/, "掃的時候要真的去對帳");

  /* 藏在背景時不掃：看不到的東西不需要更新，而且 iOS 會把背景分頁的計時器
     凍結，掃了也是白掃。回到前景時 visibilitychange 那條會補上。 */
  assert.match(poll[0], /visibilityState !== "visible"/,
    "背景時不要掃 —— 白花 API 額度");
});

test("定期對帳的間隔要明顯比重試上傳長", function() {
  /* 重試上傳只有在本機真的有東西要推時才動作，成本是零；定期對帳每次都是
     一發真的 API 請求，太頻繁會吃掉 Supabase 的免費額度與 Drive 的配額。 */
  const poll = syncJs.match(/const SYNC_POLL_INTERVAL_MS = ([^;]+);/);
  const retry = syncJs.match(/const SYNC_RETRY_INTERVAL_MS = ([^;]+);/);
  assert.ok(poll && retry, "兩個間隔都要有具名常數");

  const evalMs = function(expr) { return Function("return (" + expr + ");")(); };
  const pollMs = evalMs(poll[1]);
  const retryMs = evalMs(retry[1]);

  assert.ok(pollMs > retryMs,
    "定期對帳不該比重試上傳還頻繁 —— 一個免費、一個要花 API 額度");
  assert.ok(pollMs >= 60 * 1000, "低於一分鐘太耗額度");
  assert.ok(pollMs <= 15 * 60 * 1000, "超過十五分鐘就失去「自己會更新」的意義了");
});

test("在 app 裡換地方看的時候也要對帳", function() {
  /* 人沒離開 app，所以 visibilitychange 不會發，但「我現在要看這份資料」的
     意圖跟切回前景是一樣的。 */
  assert.match(syncJs, /function syncOnUserNavigation\(\)/,
    "政策要放在 sync.js，不要每個呼叫端各寫一套");

  const fn = syncJs.match(/function syncOnUserNavigation\(\)[\s\S]*?\n}/);
  assert.ok(fn, "找不到 syncOnUserNavigation()");
  assert.match(fn[0], /maybeReconcileNow\(\)/, "要走同一支共用的判斷");

  /* 呼叫端：換文檔、切文檔／白板、開目錄欄。少接一個就是那條路徑不會更新。 */
  const docsJs = fs.readFileSync(path.join(ROOT, "js", "documents.js"), "utf8");
  const mainJs = fs.readFileSync(path.join(ROOT, "js", "main.js"), "utf8");

  const loadDoc = docsJs.match(/function loadDocToEditor\([\s\S]*?\n}/);
  assert.ok(loadDoc, "找不到 loadDocToEditor()");
  assert.match(loadDoc[0], /syncOnUserNavigation\(\)/, "換文檔要對帳");

  const switchV = mainJs.match(/function switchView\([\s\S]*?\n}/);
  assert.ok(switchV, "找不到 switchView()");
  assert.match(switchV[0], /syncOnUserNavigation\(\)/, "切文檔／白板要對帳");

  const openSidebar = mainJs.match(/function openSidebarMenu\([\s\S]*?\n}/);
  assert.ok(openSidebar, "找不到 openSidebarMenu()");
  assert.match(openSidebar[0], /syncOnUserNavigation\(\)/, "回到目錄要對帳");
});

/* ==========================================================
   逐篇合併有沒有真的接上
   ========================================================== */
test("對帳要先試逐篇合併，再退回整包二選一", function() {
  /* 合併引擎測得再細，對帳沒去叫它也是白搭——使用者還是會看到
     「兩邊都有修改，請選一邊」。 */
  const fn = syncJs.match(/async function reconcileWithRemote\(\)[\s\S]*?(?=\n\/\*)/);
  assert.ok(fn, "找不到 reconcileWithRemote()");

  const mergeAt = fn[0].indexOf("mergeAppData(");
  const modalAt = fn[0].lastIndexOf("openSyncConflictModal(");
  assert.ok(mergeAt !== -1, "對帳要呼叫 mergeAppData()");
  assert.ok(modalAt !== -1, "整包二選一那條路要留著當退路");
  assert.ok(mergeAt < modalAt,
    "合併要排在跳衝突視窗之前 —— 排在後面就永遠輪不到它");

  assert.match(fn[0], /!merged\.conflicts\.length/,
    "只有「一項都不衝突」才可以自己套用");
});

test("沒有祖先時不可以硬合併", function() {
  /* 第一次同步、剛換後端時沒有指紋。沒有祖先就分不出「誰改的」，硬合併
     等於拿兩邊的現況瞎猜。mergeAppData() 這時回 null，對帳必須退回
     整包二選一。 */
  const merge = fs.readFileSync(path.join(ROOT, "js", "sync-merge.js"), "utf8");
  assert.match(merge, /if \(!base \|\| !local \|\| !remote\) return null;/,
    "缺任何一份就要回 null");

  const fn = syncJs.match(/async function reconcileWithRemote\(\)[\s\S]*?(?=\n\/\*)/);
  assert.match(fn[0], /merged && !merged\.conflicts\.length/,
    "要先確認 merged 不是 null 才看 conflicts —— " +
    "少了這道，null 會在讀 .conflicts 時丟例外，同步整個停擺");
});

test("每一個「本機與雲端一致」的時刻都要重記指紋", function() {
  /* 漏掉任何一個，下次合併的祖先就是錯的。錯的祖先會讓「只有一邊改」被
     誤判成「兩邊都改」（多問一次，還好），或更糟的「都沒改」——那會安靜地
     採用另一邊，丟掉一次編輯。 */
  assert.match(syncJs, /function saveSyncFingerprint\(/, "要有存指紋的函式");

  [
    ["function adoptRemote\\(", "採用雲端之後"],
    ["async function pushNow\\(", "推送成功之後"],
    ["async function resolveConflictUseLocal\\(", "以本機覆蓋雲端之後"]
  ].forEach(function(pair) {
    const fn = syncJs.match(new RegExp(pair[0] + "[\\s\\S]*?\\n}"));
    assert.ok(fn, "找不到 " + pair[0]);
    assert.match(fn[0], /saveSyncFingerprint\(/, pair[1] + "要重記指紋");
  });
});

test("指紋只存雜湊，不存整包快照", function() {
  /* 這個 app 的圖片是 base64 存在文檔裡的。存整包快照會讓 localStorage 的
     佔用直接翻倍，很容易撐爆 5MB —— 而撐爆的症狀是存檔失敗，比不做還糟。 */
  const fn = syncJs.match(/function saveSyncFingerprint\([\s\S]*?\n}/);
  assert.ok(fn, "找不到 saveSyncFingerprint()");
  assert.match(fn[0], /fingerprintOf\(/,
    "要存 fingerprintOf() 的結果（每項一個雜湊），不是 JSON.stringify(appData)");
  assert.ok(!/JSON\.stringify\(data\)\s*\)/.test(fn[0]),
    "不可以把整包資料存進去");
});

test("合併完要推回去，不然另一台拿不到這台的那幾篇", function() {
  const fn = syncJs.match(/function applyMergedData\([\s\S]*?\n}/);
  assert.ok(fn, "找不到 applyMergedData()");
  assert.match(fn[0], /pushNow\(/, "合併結果要推上去");
  assert.match(fn[0], /changedFromRemote/,
    "跟雲端一樣時就不要白推一次");
  assert.match(fn[0], /saveSyncState\(remote\.version, remote\.at\)/,
    "版本要記成 remote 的 —— 我們是站在那一版上面合併的，" +
    "推送的條件式更新才對得上");
});

test("衝突視窗要講得出是哪幾篇，而且標題要跳脫", function() {
  /* 只說「有衝突」的話，使用者在整包二選一時完全靠猜。
     標題是使用者自己打的字，直接拼進 innerHTML 就是一個洞（NOTES 硬規則 5）。 */
  const fn = syncJs.match(/function conflictListHtml\([\s\S]*?\n}/);
  assert.ok(fn, "找不到 conflictListHtml()");
  assert.match(fn[0], /escapeHtml\(String\(c\.title/,
    "標題一定要 escapeHtml");
  assert.match(fn[0], /CONFLICT_LIST_MAX/,
    "要有上限 —— 幾百篇全列出來的話視窗會爆掉");
});
