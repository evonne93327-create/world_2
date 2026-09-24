/* 兩台裝置 + 一個假的雲端，跑真正的同步流程（pushNow／reconcileWithRemote／
   resolveRecordConflicts），不是只測合併的純函式。

   逐筆衝突這條路牽涉到好幾個地方一起配合：合併算出兩份（這台看的／推上去的）、
   衝突記進 localStorage、推的時候換成 upload、使用者選了之後改指紋再合併一次。
   少接任何一段都不會報錯，只會在某一次同步之後某一邊的東西被安靜地蓋掉。 */

const test = require("node:test");
const assert = require("node:assert");
const { loadApp, host } = require("./helpers/load-app.js");

function makeCloud(data) {
  return { json: JSON.stringify(data), version: 1, at: "2026-01-01T00:00:00Z", pulls: 0, peeks: 0,
           pushes: 0, conflicts: 0, beforePush: null };
}

function device(cloud, data) {
  const app = loadApp(["js/state.js", "js/storage.js", "js/main.js", "js/api.js",
                       "js/sync-merge.js", "js/sync.js"]);
  app.__cloud = cloud;
  app.run(`
    renderWorldRail = function() {}; renderSidebarTree = function() {};
    updateWorldBadge = function() {}; loadDocToEditor = function() {}; renderCanvas = function() {};
    var __n = 0;
    newItemId = function(prefix) { return prefix + "copy" + (++__n); };
    supabaseProvider.isConfigured = function() { return true; };
    supabaseProvider.account = function() { return "me"; };
    supabaseProvider.peek = async function() {
      __cloud.peeks++;
      return { version: __cloud.version, at: __cloud.at };
    };
    supabaseProvider.pull = async function() {
      __cloud.pulls++;
      return { data: JSON.parse(__cloud.json), version: __cloud.version, at: __cloud.at };
    };
    supabaseProvider.push = async function(data, expected) {
      __cloud.pushes++;
      await new Promise(function(r) { setTimeout(r, 5); });   // 網路在路上
      if (__cloud.beforePush) __cloud.beforePush();
      if (expected !== __cloud.version) { __cloud.conflicts++; return { conflict: true }; }
      __cloud.json = JSON.stringify(data);
      __cloud.version++;
      __cloud.at = "2026-01-01T00:00:0" + __cloud.version + "Z";
      return { conflict: false, version: __cloud.version, at: __cloud.at };
    };
  `);
  app.run("appData = " + JSON.stringify(data) + ";");
  app.run(`saveSyncState(1, __cloud.at); saveSyncFingerprint(appData); setLocalDirty(false);
           lastPushedPayload = JSON.stringify(appData);`);
  return app;
}

async function settle() {
  for (let i = 0; i < 20; i++) await new Promise(function(r) { setTimeout(r, 0); });
}

function start() {
  return {
    worldviews: [{ id: "w1", name: "主", icon: "🌐", canvas: { nodes: [], edges: [],
      notes: [{ id: "n1", x: 0, y: 0, w: 160, h: 100, text: "一" },
              { id: "n2", x: 0, y: 0, w: 160, h: 100, text: "二" }] } }],
    folders: [],
    docs: [{ id: "d1", worldId: "w1", folderId: null, title: "甲", content: "原本甲" },
           { id: "d2", worldId: "w1", folderId: null, title: "乙", content: "原本乙" }],
    tagSettings: {},
    trash: { docs: [], folders: [], canvas: [], worlds: [] }
  };
}

function cloudData(cloud) { return JSON.parse(cloud.json); }
function content(data, id) { const d = data.docs.find(function(x) { return x.id === id; }); return d && d.content; }
function edit(app, id, text) {
  app.run(`appData.docs.find(function(d) { return d.id === ${JSON.stringify(id)}; }).content = ${JSON.stringify(text)}; setLocalDirty(true);`);
}

test("兩台各改一篇：都上得去，另一台對帳後也拿得到", async function() {
  const cloud = makeCloud(start());
  const A = device(cloud, start());
  const B = device(cloud, start());

  edit(A, "d1", "A 改的甲");
  await A.run("pushNow(true)"); await settle();
  edit(B, "d2", "B 改的乙");
  await B.run("pushNow(true)"); await settle();

  assert.strictEqual(content(cloudData(cloud), "d1"), "A 改的甲");
  assert.strictEqual(content(cloudData(cloud), "d2"), "B 改的乙");
  assert.deepStrictEqual(host(B.run("loadRecordConflicts()")), []);

  await A.run("reconcileWithRemote()"); await settle();
  assert.strictEqual(content(host(A.run("appData")), "d2"), "B 改的乙", "A 要拿到 B 改的");
});

test("雲端沒變：對帳只問版本，不下載整包", async function() {
  const cloud = makeCloud(start());
  const A = device(cloud, start());
  await A.run("reconcileWithRemote()"); await settle();
  assert.strictEqual(cloud.peeks, 1);
  assert.strictEqual(cloud.pulls, 0, "版本一樣就不該把整包抓下來");
});

test("同一篇兩邊都改：那一篇暫停，兩邊都不被蓋掉；其他的照常同步", async function() {
  const cloud = makeCloud(start());
  const A = device(cloud, start());
  const B = device(cloud, start());

  edit(A, "d1", "A 寫的");
  await A.run("pushNow(true)"); await settle();

  edit(B, "d1", "B 寫的");
  B.run(`appData.worldviews[0].canvas.notes[1].text = "B 改的便條"; setLocalDirty(true);`);
  await B.run("pushNow(true)"); await settle();

  const pending = host(B.run("loadRecordConflicts()"));
  assert.deepStrictEqual(pending.map(function(c) { return c.kind + ":" + c.id; }), ["doc:d1"]);
  assert.strictEqual(content(host(B.run("appData")), "d1"), "B 寫的", "B 看到的還是自己的");
  assert.strictEqual(content(cloudData(cloud), "d1"), "A 寫的", "雲端的沒有被 B 蓋掉");
  assert.strictEqual(cloudData(cloud).worldviews[0].canvas.notes[1].text, "B 改的便條",
    "沒撞到的照常上去");

  // B 又改了別篇：還是不可以順便把 d1 推上去
  edit(B, "d2", "B 又改了乙");
  await B.run("pushNow(true)"); await settle();
  assert.strictEqual(content(cloudData(cloud), "d2"), "B 又改了乙");
  assert.strictEqual(content(cloudData(cloud), "d1"), "A 寫的", "衝突那一篇在決定之前一直保留雲端的");

  // 重開 app（換一個沙箱、同一份 localStorage）之後也要記得
  assert.ok(B.localStorage.getItem("wb_sync_record_conflicts"), "要存在 localStorage，重開之後才記得");
});

test("選「用這台的」：這台的推上去，衝突消失", async function() {
  const cloud = makeCloud(start());
  const A = device(cloud, start());
  const B = device(cloud, start());
  edit(A, "d1", "A 寫的"); await A.run("pushNow(true)"); await settle();
  edit(B, "d1", "B 寫的"); await B.run("pushNow(true)"); await settle();

  await B.run(`resolveRecordConflicts(loadRecordConflicts(), "local")`); await settle();
  assert.strictEqual(content(cloudData(cloud), "d1"), "B 寫的");
  assert.deepStrictEqual(host(B.run("loadRecordConflicts()")), []);
  assert.strictEqual(B.run("loadSyncState().version"), cloud.version, "選了之後同步時間才更新到最新");
});

test("選「用雲端的」：這台換成雲端的，雲端不動", async function() {
  const cloud = makeCloud(start());
  const A = device(cloud, start());
  const B = device(cloud, start());
  edit(A, "d1", "A 寫的"); await A.run("pushNow(true)"); await settle();
  edit(B, "d1", "B 寫的"); await B.run("pushNow(true)"); await settle();

  await B.run(`resolveRecordConflicts(loadRecordConflicts(), "remote")`); await settle();
  assert.strictEqual(content(host(B.run("appData")), "d1"), "A 寫的");
  assert.strictEqual(content(cloudData(cloud), "d1"), "A 寫的");
  assert.deepStrictEqual(host(B.run("loadRecordConflicts()")), []);
});

test("選「兩份都留」：兩份都上雲端", async function() {
  const cloud = makeCloud(start());
  const A = device(cloud, start());
  const B = device(cloud, start());
  edit(A, "d1", "A 寫的"); await A.run("pushNow(true)"); await settle();
  edit(B, "d1", "B 寫的"); await B.run("pushNow(true)"); await settle();

  await B.run(`resolveRecordConflicts(loadRecordConflicts(), "both")`); await settle();
  const c = cloudData(cloud);
  assert.strictEqual(content(c, "d1"), "A 寫的");
  const copy = c.docs.find(function(d) { return /（衝突副本）$/.test(d.title); });
  assert.ok(copy, "副本要上雲端");
  assert.strictEqual(copy.content, "B 寫的");
});

test("白板：兩台各動同一塊白板上不同的便條紙，都留著", async function() {
  const cloud = makeCloud(start());
  const A = device(cloud, start());
  const B = device(cloud, start());
  A.run(`appData.worldviews[0].canvas.notes[0].x = 99; setLocalDirty(true);`);
  await A.run("pushNow(true)"); await settle();
  B.run(`appData.worldviews[0].canvas.notes[1].text = "B 的"; setLocalDirty(true);`);
  await B.run("pushNow(true)"); await settle();

  const notes = cloudData(cloud).worldviews[0].canvas.notes;
  assert.strictEqual(notes[0].x, 99);
  assert.strictEqual(notes[1].text, "B 的");
  assert.deepStrictEqual(host(B.run("loadRecordConflicts()")), []);
});

test("有還沒決定的衝突時，對帳不可以整包採用雲端", async function() {
  const cloud = makeCloud(start());
  const A = device(cloud, start());
  const B = device(cloud, start());
  edit(A, "d1", "A 寫的"); await A.run("pushNow(true)"); await settle();
  edit(B, "d1", "B 寫的"); await B.run("pushNow(true)"); await settle();

  // A 又改了別篇；B 這時候沒有待上傳的東西（dirty 是 false），以前這裡會整包採用雲端
  edit(A, "d2", "A 改乙"); await A.run("pushNow(true)"); await settle();
  assert.strictEqual(B.run("isLocalDirty()"), false);
  await B.run("reconcileWithRemote()"); await settle();
  const b = host(B.run("appData"));
  assert.strictEqual(content(b, "d1"), "B 寫的", "B 還沒選，B 的那一版不可以不見");
  assert.strictEqual(content(b, "d2"), "A 改乙", "其他的照常拿到");
});

test("選之前雲端那篇又被改了一次：選「用這台的」還是用這台的", async function() {
  /* 選的時候要把祖先記成「雲端現在的樣子」。只把衝突從清單拿掉不夠：
     祖先還停在上一次同步，雲端那篇又變了，下一輪就會再判成衝突——
     使用者明明選了，卻又被問一次（或更糟，換一種情況就選錯邊）。 */
  const cloud = makeCloud(start());
  const A = device(cloud, start());
  const B = device(cloud, start());
  edit(A, "d1", "A 寫的"); await A.run("pushNow(true)"); await settle();
  edit(B, "d1", "B 寫的"); await B.run("pushNow(true)"); await settle();
  edit(A, "d1", "A 又寫了"); await A.run("pushNow(true)"); await settle();

  await B.run(`resolveRecordConflicts(loadRecordConflicts(), "local")`); await settle();
  assert.deepStrictEqual(host(B.run("loadRecordConflicts()")), [], "選了就不該再問");
  assert.strictEqual(content(cloudData(cloud), "d1"), "B 寫的");
});

test("有衝突待決定時，每次上傳都不可以重新載入編輯器（會打斷正在打的字）", async function() {
  const cloud = makeCloud(start());
  const A = device(cloud, start());
  const B = device(cloud, start());
  edit(A, "d1", "A 寫的"); await A.run("pushNow(true)"); await settle();
  edit(B, "d1", "B 寫的"); await B.run("pushNow(true)"); await settle();
  assert.strictEqual(host(B.run("loadRecordConflicts()")).length, 1);

  B.run(`activeDocId = "d2"; var __loads = 0; loadDocToEditor = function() { __loads++; };
         var __trees = 0; renderSidebarTree = function() { __trees++; };`);
  edit(B, "d2", "B 正在打字"); await B.run("pushNow(true)"); await settle();
  assert.strictEqual(content(cloudData(cloud), "d2"), "B 正在打字", "照樣上傳");
  assert.strictEqual(B.run("__loads"), 0, "只是把這台的推上去，畫面不用動");
  assert.strictEqual(B.run("__trees"), 0, "目錄也不用重畫");
});

test("合併拿到別篇的修改：正在看的那篇沒變就不重新載入", async function() {
  const cloud = makeCloud(start());
  const A = device(cloud, start());
  const B = device(cloud, start());
  edit(A, "d1", "A 寫的"); await A.run("pushNow(true)"); await settle();

  B.run(`activeDocId = "d2"; var __loads = 0; loadDocToEditor = function() { __loads++; };`);
  B.run(`appData.worldviews[0].canvas.notes[0].x = 5; setLocalDirty(true);`);
  await B.run("pushNow(true)"); await settle();
  assert.strictEqual(content(host(B.run("appData")), "d1"), "A 寫的", "別篇照樣拿到");
  assert.strictEqual(B.run("__loads"), 0, "正在打的那篇沒變，不要打斷");
});

test("有衝突待決定時，讀到比上次同步還舊的雲端版本：停下來問，不可以拿它合併", async function() {
  const cloud = makeCloud(start());
  const A = device(cloud, start());
  const B = device(cloud, start());
  edit(A, "d1", "A 寫的"); await A.run("pushNow(true)"); await settle();
  edit(B, "d1", "B 寫的"); await B.run("pushNow(true)"); await settle();
  const recorded = B.run("loadSyncState().version");

  cloud.version = 1;   // 雲端回應倒退（剛寫入還沒生效的讀取）
  const before = cloud.json;
  edit(B, "d2", "B 改乙");
  await B.run("pushNow(true)");
  await new Promise(function(r) { setTimeout(r, 1700); });   // pullFreshEnough 會隔 1.5 秒重問一次
  await settle();
  assert.strictEqual(cloud.json, before, "不可以推");
  assert.strictEqual(B.run("loadSyncState().version"), recorded, "版本不可以被記回舊的");
  assert.ok(B.run("!!pendingConflictRemote"), "要停下來問");
});


/* ==========================================================
   使用者回報：另一台在打字（或閒置），這台一直跳衝突、按了也沒反應
   ========================================================== */

/* 模擬另一台在這台上傳的途中又推了一版：直接改雲端那一份。 */
function otherDevicePushes(cloud, noteIndex, text) {
  const d = JSON.parse(cloud.json);
  d.worldviews[0].canvas.notes[noteIndex].text = text;
  cloud.json = JSON.stringify(d);
  cloud.version++;
}

test("另一台一直在推：這台連撞兩次，另一台的便條紙也不可以變成衝突", async function() {
  const cloud = makeCloud(start());
  const A = device(cloud, start());
  otherDevicePushes(cloud, 1, "B 打了一些");
  let n = 0;
  cloud.beforePush = function() { if (++n === 2) otherDevicePushes(cloud, 1, "B 打了一些又一些"); };

  A.run(`appData.worldviews[0].canvas.notes[0].text = "A 的"; setLocalDirty(true);`);
  await A.run("pushNow(true)"); await settle();

  assert.deepStrictEqual(host(A.run("loadRecordConflicts()")), [],
    "上一輪從雲端拿進來的 B 的便條紙，不可以被當成「這台改的」");
  const notes = cloudData(cloud).worldviews[0].canvas.notes;
  assert.strictEqual(notes[0].text, "A 的");
  assert.strictEqual(notes[1].text, "B 打了一些又一些");
});

test("上傳途中又打字：沒上去的字不可以被記成已同步", async function() {
  const cloud = makeCloud(start());
  const A = device(cloud, start());
  let once = false;
  cloud.beforePush = function() {
    if (once) return;
    once = true;
    A.run(`appData.worldviews[0].canvas.notes[0].text = "打到一半又多打了"; setLocalDirty(true);`);
  };
  A.run(`appData.worldviews[0].canvas.notes[0].text = "打到一半"; setLocalDirty(true);`);
  await A.run("pushNow(true)"); await settle();

  assert.strictEqual(cloudData(cloud).worldviews[0].canvas.notes[0].text, "打到一半又多打了",
    "上傳途中打的字要接著推上去");
  assert.strictEqual(A.run("isLocalDirty()"), false);

  // 另一台改別張，這台再對帳：不可以把自己的字吃掉，也不可以變成衝突
  otherDevicePushes(cloud, 1, "B 改的");
  await A.run("lastReconcileAt = 0; reconcileWithRemote()"); await settle();
  const a = host(A.run("appData"));
  assert.strictEqual(a.worldviews[0].canvas.notes[0].text, "打到一半又多打了");
  assert.deepStrictEqual(host(A.run("loadRecordConflicts()")), []);
});

test("一次只推一個：上傳還在路上時再叫一次，不會自己撞自己", async function() {
  const cloud = makeCloud(start());
  const A = device(cloud, start());
  A.run(`appData.worldviews[0].canvas.notes[0].text = "一"; setLocalDirty(true);`);
  const first = A.run("pushNow(true)");
  A.run(`appData.worldviews[0].canvas.notes[0].text = "一二"; setLocalDirty(true);`);
  await A.run("pushNow(true)");
  await first; await settle();
  assert.strictEqual(cloud.conflicts, 0, "兩個上傳帶著同一個版本號出去，後到的一定撞到自己");
  assert.strictEqual(cloudData(cloud).worldviews[0].canvas.notes[0].text, "一二", "第二次的也要補推");
});

test("連撞到上限：不跳整包二選一的視窗，退開之後再推", async function() {
  const cloud = makeCloud(start());
  const A = device(cloud, start());
  let n = 0;
  cloud.beforePush = function() { if (++n <= 4) otherDevicePushes(cloud, 1, "B 第 " + n + " 次"); };
  A.run(`appData.worldviews[0].canvas.notes[0].text = "A 的"; setLocalDirty(true);`);
  await A.run("pushNow(true)"); await settle();

  assert.strictEqual(A.run("!!pendingConflictRemote"), false,
    "連撞不是衝突 —— 以前這裡會跳視窗，而且按哪一邊都會馬上又跳回來");
  assert.strictEqual(A.run("mergePushRetries"), 0, "要歸零");
  assert.strictEqual(A.run("isLocalDirty()"), true, "還沒上去");

  await A.run("pushNow(true)"); await settle();   // 退開之後的那一次
  assert.strictEqual(cloudData(cloud).worldviews[0].canvas.notes[0].text, "A 的");
  assert.deepStrictEqual(host(A.run("loadRecordConflicts()")), []);
});

test("正在打便條紙時不重畫白板，打完才補畫", function() {
  /* 重畫會把正在編輯的便條紙換掉，焦點跟著消失，接下來打的字全部不見
     （實測：打六段只剩兩段）。 */
  const app = loadApp();
  app.run(`
    var __renders = 0; renderCanvas = function() { __renders++; };
    activeView = "canvas";
    var __editing = true;
    document.querySelector = function(sel) {
      return (sel === ".canvas-note.is-editing" && __editing) ? {} : null;
    };
  `);
  app.run("renderCanvasWhenNotEditing()");
  assert.strictEqual(app.run("__renders"), 0, "編輯中不可以重畫");
  app.run("__editing = false; flushDeferredCanvasRender()");
  assert.strictEqual(app.run("__renders"), 1, "打完要補畫");
  app.run("flushDeferredCanvasRender()");
  assert.strictEqual(app.run("__renders"), 1, "補過就不要再畫");
});
