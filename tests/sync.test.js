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

  /* 「不能安全採用就停下來問」這條路不能在重構中掉了。
     現在它走 mergeOrAsk()——合併得起來就自己處理，合併不起來才問。 */
  assert.match(init[0].length ? syncJs : syncJs, /function mergeOrAsk\(/,
    "要有那條政策");
  const policy = syncJs.match(/function mergeOrAsk\(remote\)[\s\S]*?\n}/);
  assert.ok(policy && /openSyncConflictModal\(/.test(policy[0]),
    "合併不起來時還是要停下來問，不可以自己猜");
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
test("停止操作滿 3 分鐘就自己去對一次（下載）", function() {
  /* 放在桌上開著，中間在另一台改了東西——沒切到背景、沒換文檔，
     visibilitychange 不會發，沒有任何事件會通知我們。使用者指定：停止操作
     3 分鐘後自動同步一次。 */
  const recovery = syncJs.match(/function initSyncRecovery\(\)[\s\S]*?\n}/);
  assert.ok(recovery, "找不到 initSyncRecovery()");

  const poll = recovery[0].match(/setInterval\(function\(\)[\s\S]*?SYNC_IDLE_CHECK_MS\)/);
  assert.ok(poll, "要有一個檢查閒置的計時器");
  assert.match(poll[0], /shouldIdleSync\(Date\.now\(\) - lastActivityAt, lastActivityAt, idleSyncDoneFor, SYNC_IDLE_MS\)/,
    "看的是「距離最後一次操作多久」，不是固定每幾分鐘");
  assert.match(poll[0], /if \(maybeReconcileNow\(\)\) idleSyncDoneFor = lastActivityAt;/,
    "真的對到了才記「這段閒置做過了」—— 沒對成（正在同步）要下一輪再試");

  /* 藏在背景時不掃：看不到的東西不需要更新，而且 iOS 會把背景分頁的計時器
     凍結，掃了也是白掃。回到前景時 visibilitychange 那條會補上。 */
  assert.match(poll[0], /visibilityState !== "visible"/,
    "背景時不要掃 —— 白花 API 額度");

  const idle = syncJs.match(/const SYNC_IDLE_MS = ([^;]+);/);
  assert.ok(idle, "要有具名常數");
  assert.strictEqual(Function("return (" + idle[1] + ");")(), 3 * 60 * 1000, "使用者指定 3 分鐘");
});

test("shouldIdleSync：同一段閒置只下載一次", function() {
  const f = app.shouldIdleSync;
  const T = 180000;
  assert.strictEqual(f(T - 1, 100, -1, T), false, "還沒滿 3 分鐘");
  assert.strictEqual(f(T, 100, -1, T), true, "滿了");
  assert.strictEqual(f(T * 5, 100, 100, T), false,
    "這段閒置已經做過了 —— 放著一整晚不可以每 3 分鐘打一發 API");
  assert.strictEqual(f(T, 200, 100, T), true, "又動過、又停滿 3 分鐘 → 再一次");
});

test("對帳前先只問版本，一樣就不下載整包", function() {
  /* 雲端是整包存成一列，下載就是整個資料庫。閒置、切回來的對帳大多數時候
     雲端根本沒變，先問版本（幾十個位元組）就夠了。 */
  const fn = syncJs.match(/async function reconcileWithRemote\(\)[\s\S]*?\n}/);
  assert.ok(fn, "找不到 reconcileWithRemote()");
  const peekAt = fn[0].indexOf("P().peek()");
  const pullAt = fn[0].indexOf("pullFreshEnough()");
  assert.ok(peekAt !== -1 && pullAt !== -1 && peekAt < pullAt, "先 peek 再決定要不要 pull");
  assert.match(fn[0], /String\(head\.version\) === String\(known\.version\)/,
    "跟上次同步記下的版本比（Drive 的版本是字串、Supabase 的是數字）");

  const api = fs.readFileSync(path.join(ROOT, "js", "api.js"), "utf8");
  assert.match(api, /select=version,updated_at"/, "Supabase 的 peek 不可以帶 data 欄位");
  const gd = fs.readFileSync(path.join(ROOT, "js", "gdrive.js"), "utf8");
  assert.match(gd, /peek: async function\(\)/, "Drive 也要有");
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
test("每一條發現分岔的路都要先試合併", function() {
  /* 這一條是踩出來的，而且是最貴的一次：合併本來只接在對帳
     （reconcileWithRemote）上，但兩台各改一篇時**真正先走到的是
     pushNow() 的版本衝突**——A 推成功、版本變 N+1，B 帶著舊版本去推就衝突，
     而那裡直接跳視窗，合併根本輪不到。使用者回報「兩台各改一篇，還是跳出
     視窗叫我選一邊」就是這個。

     所以不逐一檢查各個呼叫點（那正是漏掉的原因），改成反過來掃：
     **每一處 openSyncConflictModal() 都必須是已知的例外，否則就是新的漏洞。**
     以後有人再加一條分岔路卻忘了先合併，這裡就會紅。 */
  assert.match(syncJs, /function mergeOrAsk\(remote\)/,
    "「先合併、不行才問」要抽成單一政策");

  const policy = syncJs.match(/function mergeOrAsk\(remote\)[\s\S]*?\n}/);
  assert.ok(policy, "找不到 mergeOrAsk()");
  assert.match(policy[0], /mergeAppData\(loadSyncFingerprint\(\), appData, remote\.data, before\)/,
    "要拿指紋當祖先去合併，並帶上還沒決定的衝突（不然推完一輪之後會被當成只有本機改）");
  assert.match(policy[0], /if \(merged && mergePushRetries < MERGE_PUSH_MAX_RETRIES\)/,
    "merged 可能是 null（沒有祖先），要先擋");
  assert.match(policy[0], /saveRecordConflicts\(merged\.conflicts\)/,
    "撞在一起的那幾筆要記下來等使用者選");
  assert.match(policy[0], /openRecordConflictModal\(\)/, "有新的衝突要問");

  /* 掃過每一處直接開視窗的地方。允許的只有三種：
     - mergeOrAsk 自己（合併不成才問）
     - 「雲端回應看起來是舊的」（那是另一個問題，合併救不到）
     - 重新把還沒解決的衝突擺回使用者面前（pendingConflictRemote） */
  const code = syncJs.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");

  /* 函式定義本身不是呼叫點（這個測試第一次就把它算進去了，紅在自己身上）。 */
  const calls = [];
  const re = /openSyncConflictModal\(/g;
  let m;
  while ((m = re.exec(code))) {
    if (code.slice(Math.max(0, m.index - 9), m.index) === "function ") continue;
    calls.push(code.slice(m.index + "openSyncConflictModal(".length));
  }
  assert.ok(calls.length >= 3, "應該抓得到好幾處（實得 " + calls.length + "）");

  calls.forEach(function(rest, i) {
    const arg = rest.split(")")[0];
    const ok = /remote, false, merged/.test(arg)      // mergeOrAsk 自己
            || /remote, true/.test(arg)               // 雲端回應是舊的
            || /pendingConflictRemote/.test(arg);     // 重新問一次
    assert.ok(ok,
      "第 " + (i + 1) + " 處 openSyncConflictModal(" + arg + ") 沒有先試合併。\n" +
      "發現本機與雲端分岔時一律走 mergeOrAsk()，不要自己直接開視窗 —— " +
      "只接一半的話，逐篇合併在真正會走到的那條路上等於沒做");
  });
});

test("pushNow 撞到版本衝突時要走合併，不是直接跳視窗", function() {
  /* 兩台各改一篇時，這才是第一個會被觸發的地方（2.5 秒的推送 debounce
     遠早於任何一次對帳）。 */
  const fn = syncJs.match(/async function pushData\(data\)[\s\S]*?\n}/);
  assert.ok(fn, "找不到 pushData()");

  const branch = fn[0].match(/if \(result\.conflict\)[\s\S]*?\n    }/);
  assert.ok(branch, "找不到 result.conflict 那一段");
  assert.match(branch[0], /mergeOrAsk\(remote\)/,
    "推送衝突要先試合併 —— 這裡只跳視窗的話，使用者永遠看不到逐篇合併的效果");
});

test("合併後重推不可以無上限地互撞", function() {
  /* 合併完要推回去，而推回去可能又撞到（另一台在這幾百毫秒又推了一次）。
     正常兩三輪會收斂，但不能沒有上限——兩台裝置互相推到天荒地老比跳視窗
     還糟。 */
  assert.match(syncJs, /const MERGE_PUSH_MAX_RETRIES = \d+;/, "要有上限常數");
  assert.match(syncJs, /mergePushRetries < MERGE_PUSH_MAX_RETRIES/,
    "超過上限就要停下來問");
  assert.match(syncJs, /mergePushRetries\+\+/, "撞一次要加一次");

  /* 歸零要在 pushNow 的成功路徑裡找，不能只看整份檔案有沒有這串字——
     宣告本身就是 `let mergePushRetries = 0;`，那樣寫的話把成功路徑裡那一行
     刪掉測試照樣綠。（這個陷阱在 caretPointer 那邊踩過一次了。） */
  const fn = syncJs.match(/async function pushData\(data\)[\s\S]*?\n}/);
  assert.ok(fn, "找不到 pushData()");
  assert.match(fn[0], /mergePushRetries = 0;/,
    "推送成功要歸零 —— 不歸零的話用久了就再也不會合併了");
});

test("沒有祖先時不可以硬合併", function() {
  /* 第一次同步、剛換後端時沒有指紋。沒有祖先就分不出「誰改的」，硬合併
     等於拿兩邊的現況瞎猜。mergeAppData() 這時回 null，對帳必須退回
     整包二選一。 */
  const merge = fs.readFileSync(path.join(ROOT, "js", "sync-merge.js"), "utf8");
  assert.match(merge, /if \(!base \|\| !local \|\| !remote\) return null;/,
    "缺任何一份就要回 null");

  const policy = syncJs.match(/function mergeOrAsk\(remote\)[\s\S]*?\n}/);
  assert.ok(policy, "找不到 mergeOrAsk()");
  assert.match(policy[0], /if \(merged && mergePushRetries/,
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
    ["async function pushData\\(", "推送成功之後"],
    ["async function resolveConflictUseLocal\\(", "以本機覆蓋雲端之後"]
  ].forEach(function(pair) {
    const fn = syncJs.match(new RegExp(pair[0] + "[\\s\\S]*?\\n}"));
    assert.ok(fn, "找不到 " + pair[0]);
    assert.match(fn[0], /saveSyncFingerprint\(/, pair[1] + "要重記指紋");
  });

  /* 推上去的是 data（有還沒決定的衝突時是 upload，不是 appData），指紋要記
     推上去的那一份——那才是「雲端現在的樣子」。記成 appData 的話，衝突那幾筆
     的祖先會變成這台的版本，一旦沒有衝突記號擋著，雲端那一版就會被當成
     「只有雲端改」而蓋掉這台的。 */
  const push = syncJs.match(/async function pushData\(data\)[\s\S]*?\n}/);
  assert.ok(push, "找不到 pushData()");
  assert.match(push[0], /saveSyncFingerprint\(data\);/, "指紋記推上去的那一份");
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
  assert.match(fn[0], /pushData\(merged\.upload\)/,
    "推的是 upload —— 推 appData 的話，還沒決定的那幾筆會把雲端的蓋掉");
  assert.match(fn[0], /saveSyncFingerprint\(merged\.upload\)/,
    "沒東西要推時，指紋記雲端現在的樣子（upload），不是這台的");
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
