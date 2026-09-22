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
     reconcileOnResume 的話，其中一個掉了、另一個還在，測試照樣綠——
     這個測試自己先這樣寫過，紅不起來。 */
  const onVisible = recovery[0].match(/addEventListener\("visibilitychange"[\s\S]*?\n  \}\);/);
  assert.ok(onVisible, "要聽 visibilitychange");
  assert.match(onVisible[0], /reconcileOnResume\(\)/,
    "回到前景要對帳 —— 只做 retryPushIfNeeded() 的話只推不拉");
  assert.match(onVisible[0], /visibilityState === "hidden"/,
    "hidden 那一支還是要把待上傳的送掉");

  /* iOS 從 bfcache 還原時不保證發 visibilitychange，但一定會發 pageshow。 */
  const onShow = recovery[0].match(/addEventListener\("pageshow"[\s\S]*?\n  \}\);/);
  assert.ok(onShow, "iOS 的 bfcache 還原只保證發 pageshow");
  assert.match(onShow[0], /reconcileOnResume\(\)/, "pageshow 也要對帳");

  // 切走時把還在等的上傳送掉，這條原本就有，不能弄丟
  assert.match(recovery[0], /flushPendingPush/,
    "切到背景時要先把還在 debounce 的上傳送出去");
});

test("對帳前要先把還在 debounce 裡的編輯存起來", function() {
  /* 內文是「改完 400ms」才存檔的，而 isLocalDirty() 是存檔時才標記的。
     少了這一步：剛打完字就切走、回來時本機明明有新東西卻不算「髒」，
     對帳會安靜地採用雲端那份——剛打的字就沒了。 */
  const fn = syncJs.match(/function reconcileOnResume\(\)[\s\S]*?\n}/);
  assert.ok(fn, "找不到 reconcileOnResume()");

  const flushAt = fn[0].indexOf("flushPendingContentPersist");
  const reconcileAt = fn[0].indexOf("reconcileWithRemote(");
  assert.ok(flushAt !== -1,
    "對帳前要先 flushPendingContentPersist() —— 否則剛打的字會被當成不存在");
  assert.ok(reconcileAt !== -1);
  assert.ok(flushAt < reconcileAt,
    "要排在對帳之前 —— 排在後面等於沒做");
});
