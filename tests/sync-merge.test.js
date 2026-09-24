/* 逐篇合併的三方合併規則。

   這是整個專案最危險的一段：錯了不會報錯，只會在某一次同步之後，某一篇
   文章安靜地變回舊版或整篇不見。所以這裡測得比別處細，而且每一條都寫出
   「錯了會發生什麼」。 */

const test = require("node:test");
const assert = require("node:assert");
const { loadApp, host } = require("./helpers/load-app.js");

const app = loadApp(["js/sync-merge.js"]);
const { fingerprintOf, stableStringify, hashString } = app;

/* 合併的結果要過一次 host()。

   沙箱是另一個 realm，裡面 new 出來的陣列／物件 prototype 跟這裡的不同，
   直接拿去 deepStrictEqual 一定失敗（helpers/load-app.js 的註解就寫著這件事，
   而這份測試第一次還是踩了：15 條紅在「[] 不等於 []」）。 */
function merge(base, local, remote) {
  return host(app.mergeAppData(base, local, remote));
}

function mergeCollection(baseHashes, localList, remoteList) {
  return host(app.mergeCollection(baseHashes, localList, remoteList));
}

/* ---------- 小工具，讓每個案例讀起來像一句話 ---------- */

function doc(id, content, extra) {
  const d = { id: id, worldId: "w1", folderId: null, title: id, content: content };
  if (extra) Object.keys(extra).forEach(function(k) { d[k] = extra[k]; });
  return d;
}

function world(id, name) {
  return { id: id, name: name || id, icon: "🌐", canvas: { nodes: [], edges: [], notes: [] } };
}

function db(docs, extra) {
  const base = {
    worldviews: [world("w1")],
    folders: [],
    docs: docs || [],
    tagSettings: {},
    trash: { docs: [], folders: [] }
  };
  if (extra) Object.keys(extra).forEach(function(k) { base[k] = extra[k]; });
  return base;
}

function titles(list) {
  return list.map(function(d) { return d.id; }).sort();
}

function contentOf(data, id) {
  const d = data.docs.find(function(x) { return x.id === id; });
  return d ? d.content : null;
}

/* ==========================================================
   基礎工具
   ========================================================== */
test("stableStringify：屬性順序不影響結果", function() {
  /* JSON.stringify 照的是插入順序。同一篇文檔在兩台裝置上經過不同路徑
     （新增 vs 匯入 vs 從雲端還原）屬性順序可能不同，內容一樣卻算出不同的
     雜湊 → 被判成「兩邊都改了」→ 假衝突。 */
  assert.strictEqual(
    stableStringify({ b: 1, a: 2 }),
    stableStringify({ a: 2, b: 1 }));

  // 巢狀也要一樣
  assert.strictEqual(
    stableStringify({ x: { q: 1, p: 2 }, y: [1, { n: 1, m: 2 }] }),
    stableStringify({ y: [1, { m: 2, n: 1 }], x: { p: 2, q: 1 } }));

  // 陣列順序是有意義的，不可以排序
  assert.notStrictEqual(stableStringify([1, 2]), stableStringify([2, 1]));
});

test("hashString：不同內容要給出不同的雜湊", function() {
  /* 碰撞的後果是「以為這一邊沒改」→ 採用另一邊 → 丟掉一次編輯。 */
  assert.notStrictEqual(hashString("第一章"), hashString("第二章"));
  assert.notStrictEqual(hashString("a"), hashString("b"));
  assert.strictEqual(hashString("同樣的字"), hashString("同樣的字"));

  // 只差一個字也要不同（改一個錯字也是一次編輯）
  assert.notStrictEqual(
    hashString("他走進了房間"), hashString("她走進了房間"));
});

/* ==========================================================
   使用者要的那個情境
   ========================================================== */
test("兩台裝置各改一篇：兩篇都要留著", function() {
  /* 這就是使用者的原話：「我在不同裝置上就可以同時處理兩個檔案了」。
     原本的整包二選一在這裡一定會丟掉其中一台的那一篇。 */
  const base = fingerprintOf(db([doc("d1", "原本一"), doc("d2", "原本二")]));

  const local = db([doc("d1", "平板改的"), doc("d2", "原本二")]);
  const remote = db([doc("d1", "原本一"), doc("d2", "手機改的")]);

  const m = merge(base, local, remote);
  assert.deepStrictEqual(m.conflicts, [], "不同篇不該算衝突");
  assert.strictEqual(contentOf(m.data, "d1"), "平板改的");
  assert.strictEqual(contentOf(m.data, "d2"), "手機改的");
});

test("同一篇兩邊都改：這才是衝突，而且要講得出是哪一篇", function() {
  const base = fingerprintOf(db([doc("d1", "原本")]));
  const local = db([doc("d1", "平板改的")]);
  const remote = db([doc("d1", "手機改的")]);

  const m = merge(base, local, remote);
  assert.strictEqual(m.conflicts.length, 1);
  assert.strictEqual(m.conflicts[0].kind, "doc");
  assert.strictEqual(m.conflicts[0].id, "d1");
  assert.strictEqual(m.conflicts[0].title, "d1",
    "要帶得出標題 —— 使用者看到「有衝突」時得知道是哪一篇");
});

test("同一篇兩邊改成一模一樣：不算衝突", function() {
  /* 兩邊各自改成同樣的內容（例如都把同一個錯字改掉）。內容相同就沒有什麼
     好選的，跳衝突視窗只是白白打擾。 */
  const base = fingerprintOf(db([doc("d1", "原本")]));
  const m = merge(base, db([doc("d1", "改過")]), db([doc("d1", "改過")]));
  assert.deepStrictEqual(m.conflicts, []);
  assert.strictEqual(contentOf(m.data, "d1"), "改過");
});

/* ==========================================================
   只有一邊改
   ========================================================== */
test("只有本機改：保留本機，不可以被雲端的舊版蓋掉", function() {
  const base = fingerprintOf(db([doc("d1", "原本")]));
  const m = merge(base, db([doc("d1", "我剛打的")]), db([doc("d1", "原本")]));
  assert.deepStrictEqual(m.conflicts, []);
  assert.strictEqual(contentOf(m.data, "d1"), "我剛打的");
});

test("只有雲端改：採用雲端 —— 那正是「在另一台改的東西要看得到」", function() {
  const base = fingerprintOf(db([doc("d1", "原本")]));
  const m = merge(base, db([doc("d1", "原本")]), db([doc("d1", "另一台打的")]));
  assert.deepStrictEqual(m.conflicts, []);
  assert.strictEqual(contentOf(m.data, "d1"), "另一台打的");
});

test("兩邊都沒改：結果要跟原本一樣，也不該說有變動", function() {
  const data = db([doc("d1", "原本"), doc("d2", "原本二")]);
  const base = fingerprintOf(data);
  const m = merge(base, db([doc("d1", "原本"), doc("d2", "原本二")]),
                               db([doc("d1", "原本"), doc("d2", "原本二")]));
  assert.deepStrictEqual(m.conflicts, []);
  assert.strictEqual(m.changedFromLocal, false,
    "沒有變動就不該說有 —— 呼叫端會因此白推一次");
  assert.strictEqual(m.changedFromRemote, false);
});

/* ==========================================================
   新增
   ========================================================== */
test("兩邊各自新增一篇：兩篇都要在", function() {
  const base = fingerprintOf(db([doc("d1", "舊的")]));
  const local = db([doc("d1", "舊的"), doc("d2", "平板新增")]);
  const remote = db([doc("d1", "舊的"), doc("d3", "手機新增")]);

  const m = merge(base, local, remote);
  assert.deepStrictEqual(m.conflicts, []);
  assert.deepStrictEqual(titles(m.data.docs), ["d1", "d2", "d3"]);
});

test("祖先裡沒有、只有一邊有 → 是新增，不是被刪", function() {
  /* 這一條分不清楚的話，剛在這台新增的文檔會在第一次同步時被當成
     「雲端刪掉了」而消失。 */
  const base = fingerprintOf(db([]));
  const m = merge(base, db([doc("d1", "剛建的")]), db([]));
  assert.deepStrictEqual(m.conflicts, []);
  assert.deepStrictEqual(titles(m.data.docs), ["d1"]);
});

/* ==========================================================
   刪除（祖先就是墓碑）
   ========================================================== */
test("在另一台刪掉、這台沒動過 → 跟著刪", function() {
  const base = fingerprintOf(db([doc("d1", "x"), doc("d2", "y")]));
  const m = merge(base, db([doc("d1", "x"), doc("d2", "y")]), db([doc("d1", "x")]));
  assert.deepStrictEqual(m.conflicts, []);
  assert.deepStrictEqual(titles(m.data.docs), ["d1"], "刪除要跟上，不然刪不掉");
});

test("一邊刪、另一邊改 → 衝突，而且那篇要留著", function() {
  /* 這是最兇的一種：直接照刪的話，另一台剛寫的東西就沒了。
     不確定就問，而且在問之前先把它留在結果裡，使用者選「用這台」時還在。 */
  const base = fingerprintOf(db([doc("d1", "原本")]));
  const m = merge(base, db([doc("d1", "我又寫了一段")]), db([]));
  assert.strictEqual(m.conflicts.length, 1);
  assert.strictEqual(m.conflicts[0].id, "d1");
  assert.deepStrictEqual(titles(m.data.docs), ["d1"], "還沒決定之前不可以先刪掉");
});

test("這台刪掉、另一台沒動 → 刪除要推得出去", function() {
  const base = fingerprintOf(db([doc("d1", "x"), doc("d2", "y")]));
  const m = merge(base, db([doc("d1", "x")]), db([doc("d1", "x"), doc("d2", "y")]));
  assert.deepStrictEqual(m.conflicts, []);
  assert.deepStrictEqual(titles(m.data.docs), ["d1"],
    "本機刪掉的東西不可以被雲端那份又帶回來");
});

/* ==========================================================
   垃圾桶與還原
   ========================================================== */
test("刪到垃圾桶：文檔搬家，兩邊都要對", function() {
  const before = db([doc("d1", "x"), doc("d2", "y")]);
  const base = fingerprintOf(before);

  // 本機把 d2 丟進垃圾桶
  const local = db([doc("d1", "x")], { trash: { docs: [doc("d2", "y")], folders: [] } });
  const remote = db([doc("d1", "x"), doc("d2", "y")]);

  const m = merge(base, local, remote);
  assert.deepStrictEqual(m.conflicts, []);
  assert.deepStrictEqual(titles(m.data.docs), ["d1"]);
  assert.deepStrictEqual(titles(m.data.trash.docs), ["d2"], "要留在垃圾桶裡才復原得了");
});

test("從垃圾桶還原：同一套規則就會自然正確", function() {
  /* 還原＝在 trash 那一邊是刪除、在 docs 那一邊是新增。兩個集合都走同一套
     三方合併，所以不用為還原另外寫一條路。 */
  const before = db([doc("d1", "x")], { trash: { docs: [doc("d2", "y")], folders: [] } });
  const base = fingerprintOf(before);

  const local = db([doc("d1", "x"), doc("d2", "y")]);          // 還原了 d2
  const remote = db([doc("d1", "x")], { trash: { docs: [doc("d2", "y")], folders: [] } });

  const m = merge(base, local, remote);
  assert.deepStrictEqual(m.conflicts, []);
  assert.deepStrictEqual(titles(m.data.docs), ["d1", "d2"], "還原的那篇要回到文檔裡");
  assert.deepStrictEqual(titles(m.data.trash.docs), [], "而且不可以同時留在垃圾桶");
});

/* ==========================================================
   資料夾與世界觀
   ========================================================== */
test("資料夾與世界觀走同一套，而且衝突分得出是哪一類", function() {
  const before = db([], { folders: [{ id: "f1", worldId: "w1", parentId: null, name: "舊名" }] });
  const base = fingerprintOf(before);

  const local = db([], { folders: [{ id: "f1", worldId: "w1", parentId: null, name: "平板改的名" }] });
  const remote = db([], { folders: [{ id: "f1", worldId: "w1", parentId: null, name: "手機改的名" }] });

  const m = merge(base, local, remote);
  assert.strictEqual(m.conflicts.length, 1);
  assert.strictEqual(m.conflicts[0].kind, "folder");
  assert.strictEqual(m.conflicts[0].title, "平板改的名", "要看得出是哪一個資料夾");
});

test("白板是掛在世界觀底下的：不同世界觀的白板可以同時改", function() {
  const before = db([], { worldviews: [world("w1", "主"), world("w2", "副")] });
  const base = fingerprintOf(before);

  const localW = [world("w1", "主"), world("w2", "副")];
  localW[0] = { id: "w1", name: "主", icon: "🌐",
                canvas: { nodes: [{ id: "n1" }], edges: [], notes: [] } };
  const remoteW = [world("w1", "主"), world("w2", "副")];
  remoteW[1] = { id: "w2", name: "副", icon: "🌐",
                 canvas: { nodes: [{ id: "n2" }], edges: [], notes: [] } };

  const m = merge(base, db([], { worldviews: localW }), db([], { worldviews: remoteW }));
  assert.deepStrictEqual(m.conflicts, [], "不同世界觀的白板不該互相衝突");
  const got = m.data.worldviews;
  assert.strictEqual(got.find(function(w) { return w.id === "w1"; }).canvas.nodes.length, 1);
  assert.strictEqual(got.find(function(w) { return w.id === "w2"; }).canvas.nodes.length, 1);
});

/* ==========================================================
   安全網
   ========================================================== */
test("沒有指紋時要回 null，不可以當成「沒有衝突」", function() {
  /* 第一次同步、或剛換過後端時沒有祖先可比。這時候硬合併等於拿兩邊的現況
     瞎猜，呼叫端必須退回原本「整包二選一」的路。 */
  assert.strictEqual(merge(null, db([]), db([])), null);
  assert.strictEqual(merge(fingerprintOf(db([])), null, db([])), null);
  assert.strictEqual(merge(fingerprintOf(db([])), db([]), null), null);
});

test("沒列進合併的頂層欄位要原封不動留著", function() {
  /* 以後加的欄位不會自動出現在合併規則裡。不特別處理的話，第一次合併就會
     把它整個弄丟，而且完全沒有徵兆。 */
  const base = fingerprintOf(db([]));
  const local = db([], { somethingNew: { a: 1 } });
  const m = merge(base, local, db([]));
  assert.deepStrictEqual(m.data.somethingNew, { a: 1 });
});

test("順序以本機為主，雲端新增的接在後面", function() {
  /* 目錄是照這個陣列的順序畫的。每次合併都重洗一次順序的話，使用者會覺得
     文檔自己在跳來跳去。 */
  const base = fingerprintOf(db([doc("d1", "a"), doc("d2", "b")]));
  const local = db([doc("d1", "a"), doc("d2", "b")]);
  const remote = db([doc("d2", "b"), doc("d1", "a"), doc("d9", "新的")]);

  const m = merge(base, local, remote);
  assert.deepStrictEqual(m.data.docs.map(function(d) { return d.id; }), ["d1", "d2", "d9"]);
});

test("changedFromRemote：合併結果跟雲端不同時才需要推回去", function() {
  const base = fingerprintOf(db([doc("d1", "原本")]));

  // 只有雲端改 → 合併結果就是雲端那份，不用再推
  const a = merge(base, db([doc("d1", "原本")]), db([doc("d1", "雲端改的")]));
  assert.strictEqual(a.changedFromRemote, false, "跟雲端一樣就不要白推一次");
  assert.strictEqual(a.changedFromLocal, true);

  // 兩邊各改一篇 → 合併結果兩邊都不同，一定要推
  const base2 = fingerprintOf(db([doc("d1", "x"), doc("d2", "y")]));
  const b = merge(base2,
    db([doc("d1", "本機改"), doc("d2", "y")]),
    db([doc("d1", "x"), doc("d2", "雲端改")]));
  assert.strictEqual(b.changedFromRemote, true, "不推的話另一台永遠拿不到這台的那篇");
  assert.strictEqual(b.changedFromLocal, true);
});

test("沒有 id 的項目不會讓合併爆掉", function() {
  /* 匯入來的壞資料可能沒有 id。整個合併不能因此丟例外——那會讓同步整個停擺。 */
  const base = fingerprintOf(db([doc("d1", "x")]));
  const local = db([doc("d1", "x"), { title: "沒有 id" }]);
  assert.doesNotThrow(function() { merge(base, local, db([doc("d1", "x")])); });
});

/* ==========================================================
   mergeCollection 自己的邊界
   ========================================================== */
test("mergeCollection：空的輸入不會爆", function() {
  assert.deepStrictEqual(mergeCollection({}, [], []), { list: [], upload: [], conflicts: [] });
  assert.deepStrictEqual(mergeCollection(null, null, null), { list: [], upload: [], conflicts: [] });
});

/* ==========================================================
   垃圾桶裡的白板項目（trash.canvas）

   以前 mergeAppData() 組 trash 時只放了 docs 與 folders，白板刪掉的節點、
   連線、便條紙在**任何一次**自動合併之後都會消失——而自動合併在兩台裝置
   各改一篇時就會發生，非常常見。使用者看到的是「垃圾桶裡的白板項目有時候
   會自己不見」，沒有任何錯誤訊息。

   這些項目本身沒有 id，但它們裝著的節點／連線／便條紙有，加上刪除的時間戳，
   組起來就是一個每台裝置都一樣的鍵（canvasTrashKey）。
   ========================================================== */

function ctrash(kind, payloadId, ts, extra) {
  const e = { kind: kind, worldId: "w1", label: kind + " " + payloadId, deletedAt: "t", deletedTs: ts };
  e[kind] = { id: payloadId };
  if (extra) Object.keys(extra).forEach(function(k) { e[k] = extra[k]; });
  return e;
}

function withCanvasTrash(data, entries) {
  data.trash = Object.assign({}, data.trash, { canvas: entries });
  return data;
}

function canvasKeysOf(data) {
  return ((data.trash && data.trash.canvas) || [])
    .map(function(e) { return e.kind + ":" + e[e.kind].id; }).sort();
}

test("trash.canvas：自動合併之後還在", function() {
  /* 就是這個 bug 的最小重現：兩台各改一篇 → 自動合併 → 白板垃圾全沒了。 */
  const before = withCanvasTrash(db([doc("d1", "原本")]), [ctrash("note", "n1", 100)]);
  const base = fingerprintOf(before);
  const local = withCanvasTrash(db([doc("d1", "原本")]), [ctrash("note", "n1", 100)]);
  const remote = withCanvasTrash(db([doc("d1", "另一台改的")]), [ctrash("note", "n1", 100)]);

  const r = merge(base, local, remote);
  assert.strictEqual(r.conflicts.length, 0);
  assert.deepStrictEqual(canvasKeysOf(r.data), ["note:n1"],
    "合併之後白板垃圾不見了 —— 使用者刪掉的便條紙再也救不回來");
});

test("trash.canvas：兩邊各自新增的都要留著", function() {
  const before = withCanvasTrash(db([]), []);
  const base = fingerprintOf(before);
  const local = withCanvasTrash(db([]), [ctrash("node", "nodeA", 100)]);
  const remote = withCanvasTrash(db([]), [ctrash("edge", "edgeB", 200)]);
  const r = merge(base, local, remote);
  assert.strictEqual(r.conflicts.length, 0);
  assert.deepStrictEqual(canvasKeysOf(r.data), ["edge:edgeB", "node:nodeA"]);
});

test("trash.canvas：一邊復原（從垃圾桶拿走）、另一邊沒動 → 跟著拿走", function() {
  /* 跟文檔一樣的三方合併規則：祖先有、這一邊沒有＝這一邊刪了。不然在平板
     上復原的便條紙，同步一次又會跑回手機的垃圾桶裡。 */
  const both = [ctrash("note", "n1", 100), ctrash("note", "n2", 200)];
  const before = withCanvasTrash(db([]), both);
  const base = fingerprintOf(before);
  const local = withCanvasTrash(db([]), [ctrash("note", "n2", 200)]);   // 這台復原了 n1
  const remote = withCanvasTrash(db([]), both);
  const r = merge(base, local, remote);
  assert.deepStrictEqual(canvasKeysOf(r.data), ["note:n2"]);
});

test("trash.canvas：同一個節點刪了兩次是兩筆，不會互相吃掉", function() {
  /* 節點 id 是 "node_" + 文檔 id：投射、刪掉、再投射、再刪掉，兩次的節點
     id 一樣。鍵裡一定要有刪除時間，不然合併時只會留一筆。 */
  const before = withCanvasTrash(db([]), []);
  const base = fingerprintOf(before);
  const local = withCanvasTrash(db([]), [ctrash("node", "node_d1", 100)]);
  const remote = withCanvasTrash(db([]), [ctrash("node", "node_d1", 900)]);
  const r = merge(base, local, remote);
  assert.strictEqual((r.data.trash.canvas || []).length, 2);
  assert.strictEqual(app.canvasTrashKey(ctrash("node", "node_d1", 100)) ===
                     app.canvasTrashKey(ctrash("node", "node_d1", 900)), false);
});

test("trash.canvas：舊的指紋沒有這一欄 → 兩邊的都留著（寧可多，不可少）", function() {
  /* 升級之後的第一次合併，localStorage 裡的指紋是舊版存的，沒有 trashCanvas。
     那時候分不出「這一邊刪了」還是「這一邊從來沒有」，只能兩邊都留。
     最壞的結果是一個已經復原過的便條紙又回到垃圾桶——那比丟掉好。 */
  const base = fingerprintOf(db([]));
  delete base.trashCanvas;
  const local = withCanvasTrash(db([]), [ctrash("note", "n1", 100)]);
  const remote = withCanvasTrash(db([]), [ctrash("note", "n2", 200)]);
  const r = merge(base, local, remote);
  assert.strictEqual(r.conflicts.length, 0, "舊指紋不能變成一堆衝突要使用者選");
  assert.deepStrictEqual(canvasKeysOf(r.data), ["note:n1", "note:n2"]);
});

test("trash 底下以後多出來的欄位，照本機的留著", function() {
  /* 跟頂層「沒列到的欄位照本機的留著」同一個規則。trash.canvas 就是這樣
     不見的：它是後來加的，合併那段沒跟著改。以後再加也不能重蹈覆轍。 */
  const before = db([doc("d1", "a")]);
  const base = fingerprintOf(before);
  const local = db([doc("d1", "a")]);
  local.trash.someFutureThing = [{ x: 1 }];
  const remote = db([doc("d1", "b")]);
  const r = merge(base, local, remote);
  assert.deepStrictEqual(r.data.trash.someFutureThing, [{ x: 1 }]);
});

test("兩邊都沒有 trash.canvas 時，合併結果也不要平白多出一個空陣列", function() {
  /* 多出來的話 changedFromLocal 會是 true，每次合併都會觸發一次多餘的上傳。 */
  const before = db([doc("d1", "a")]);
  const base = fingerprintOf(before);
  const r = merge(base, db([doc("d1", "a")]), db([doc("d1", "a")]));
  assert.ok(!("canvas" in r.data.trash));
  assert.strictEqual(r.changedFromLocal, false);
  assert.strictEqual(r.changedFromRemote, false);
});

test("衝突清單：文檔排在垃圾桶的東西前面", function() {
  /* conflicts 的順序就是衝突彈窗列出來的順序。 */
  const before = withCanvasTrash(db([doc("d1", "原本")]), []);
  before.trash.docs = [doc("t1", "垃圾原本")];
  const base = fingerprintOf(before);
  const local = JSON.parse(JSON.stringify(before));
  const remote = JSON.parse(JSON.stringify(before));
  local.docs[0].content = "這台";  remote.docs[0].content = "那台";
  local.trash.docs[0].content = "這台垃圾"; remote.trash.docs[0].content = "那台垃圾";
  const r = merge(base, local, remote);
  assert.deepStrictEqual(r.conflicts.map(function(c) { return c.kind; }), ["doc", "trashDoc"]);
});

test("trash.canvas：組不出鍵的（缺欄位）照本機的留著，不丟", function() {
  /* 資料缺欄位時沒辦法跟另一邊對應，但「沒辦法合併」不等於「可以丟」。 */
  const broken = { kind: "note", worldId: "w1", label: "缺內容的便條紙", deletedTs: 5 };  // 沒有 note.id
  const before = withCanvasTrash(db([doc("d1", "a")]), []);
  const base = fingerprintOf(before);
  const local = withCanvasTrash(db([doc("d1", "a")]), [broken, ctrash("note", "n1", 100)]);
  const remote = withCanvasTrash(db([doc("d1", "b")]), []);
  const r = merge(base, local, remote);
  const labels = r.data.trash.canvas.map(function(e) { return e.label; }).sort();
  assert.deepStrictEqual(labels, ["note n1", "缺內容的便條紙"]);
  assert.strictEqual(app.canvasTrashKey(broken), null);
});

/* ==========================================================
   垃圾桶裡整筆的世界觀（trash.worlds）

   刪世界觀時整筆（含白板）存進 trash.worlds，才能整個復原。它是 trash 底下
   新加的欄位——正是 trash.canvas 當初不見的那種情況，所以一加進來就要有人管。
   它有 id（就是世界觀的 id），直接走跟文檔一樣的三方合併。
   ========================================================== */

function withTrashWorlds(data, worlds) {
  data.trash = Object.assign({}, data.trash, { worlds: worlds });
  return data;
}
function tw(id, name, ts) {
  return { id: id, name: name || id, icon: "🐉", canvas: { nodes: [], edges: [], notes: [{ id: "n", text: name }] }, deletedTs: ts || 1 };
}

test("trash.worlds：自動合併之後還在", function() {
  const before = withTrashWorlds(db([doc("d1", "原本")]), [tw("wX", "龍之谷")]);
  const base = fingerprintOf(before);
  const local = withTrashWorlds(db([doc("d1", "原本")]), [tw("wX", "龍之谷")]);
  const remote = withTrashWorlds(db([doc("d1", "另一台改的")]), [tw("wX", "龍之谷")]);
  const r = merge(base, local, remote);
  assert.strictEqual(r.conflicts.length, 0);
  assert.deepStrictEqual(r.data.trash.worlds.map(function(w) { return w.id; }), ["wX"],
    "合併之後整個世界觀的紀錄不見了 —— 再也復原不回來");
});

test("trash.worlds：一台刪了世界觀、另一台沒動 → 兩邊都看得到那筆紀錄", function() {
  const before = withTrashWorlds(db([]), []);
  const base = fingerprintOf(before);
  const local = withTrashWorlds(db([]), [tw("wX", "龍之谷")]);
  const remote = withTrashWorlds(db([]), []);
  const r = merge(base, local, remote);
  assert.deepStrictEqual(r.data.trash.worlds.map(function(w) { return w.id; }), ["wX"]);
});

test("trash.worlds：一台把世界觀復原了、另一台沒動 → 跟著拿掉", function() {
  /* 不然在平板上復原的世界觀，同步之後手機的垃圾桶裡還掛著一份。 */
  const before = withTrashWorlds(db([]), [tw("wX", "龍之谷")]);
  const base = fingerprintOf(before);
  const local = withTrashWorlds(db([]), []);
  const remote = withTrashWorlds(db([]), [tw("wX", "龍之谷")]);
  const r = merge(base, local, remote);
  assert.deepStrictEqual(r.data.trash.worlds, []);
});

test("trash.worlds：舊指紋沒有這一欄 → 兩邊都留", function() {
  const base = fingerprintOf(db([]));
  delete base.trashWorlds;
  const r = merge(base, withTrashWorlds(db([]), [tw("wA")]), withTrashWorlds(db([]), [tw("wB")]));
  assert.strictEqual(r.conflicts.length, 0);
  assert.deepStrictEqual(r.data.trash.worlds.map(function(w) { return w.id; }).sort(), ["wA", "wB"]);
});

test("衝突清單裡，垃圾桶的世界觀用它的名字", function() {
  const before = withTrashWorlds(db([]), [tw("wX", "龍之谷")]);
  const base = fingerprintOf(before);
  const local = withTrashWorlds(db([]), [Object.assign(tw("wX", "龍之谷"), { name: "龍之谷A" })]);
  const remote = withTrashWorlds(db([]), [Object.assign(tw("wX", "龍之谷"), { name: "龍之谷B" })]);
  const r = merge(base, local, remote);
  assert.deepStrictEqual(r.conflicts.map(function(c) { return c.kind + ":" + c.title; }), ["trashWorld:龍之谷A"]);
});

test("trash.worlds：另一台刪了世界觀 → 這台合併之後也看得到那筆紀錄", function() {
  /* 「照本機的留著」只保得住這一台的；另一台刪的世界觀要真的合併進來，
     不然在平板上刪掉的世界觀，手機的垃圾桶裡永遠看不到、也復原不了。 */
  const before = withTrashWorlds(db([doc("d1", "a")]), []);
  const base = fingerprintOf(before);
  const local = withTrashWorlds(db([doc("d1", "這台改的")]), []);
  const remote = withTrashWorlds(db([doc("d1", "a")]), [tw("wX", "龍之谷")]);
  const r = merge(base, local, remote);
  assert.deepStrictEqual(r.data.trash.worlds.map(function(w) { return w.id; }), ["wX"]);
});

/* ==========================================================
   白板逐個物件合併

   以前整個世界觀（連白板）算一筆：兩台在同一塊白板上各動一張便條紙，
   就是「同一筆兩邊都改」→ 衝突。現在每個節點／連線／便條紙各算一筆。
   ========================================================== */

function note(id, text, extra) {
  return Object.assign({ id: id, x: 0, y: 0, w: 160, h: 100, text: text || "" }, extra || {});
}

function board(worldExtra, canvas) {
  return db([], { worldviews: [Object.assign({ id: "w1", name: "主", icon: "🌐",
    canvas: Object.assign({ nodes: [], edges: [], notes: [] }, canvas || {}) }, worldExtra || {})] });
}

function mergeP(base, local, remote, pending) {
  return host(app.mergeAppData(base, local, remote, pending));
}

function notesOf(data) {
  return data.worldviews[0].canvas.notes;
}

test("同一塊白板，兩台各動一張便條紙：都留著，不算衝突", function() {
  const base = fingerprintOf(board({}, { notes: [note("n1", "一"), note("n2", "二")] }));
  const local = board({}, { notes: [note("n1", "一", { x: 50 }), note("n2", "二")] });
  const remote = board({}, { notes: [note("n1", "一"), note("n2", "二改")] });
  const m = merge(base, local, remote);
  assert.deepStrictEqual(m.conflicts, []);
  const got = notesOf(m.data);
  assert.strictEqual(got.find(function(n) { return n.id === "n1"; }).x, 50);
  assert.strictEqual(got.find(function(n) { return n.id === "n2"; }).text, "二改");
  assert.deepStrictEqual(m.upload, m.data, "沒有衝突時推上去的就是這台看到的");
});

test("同一張便條紙兩邊都改：只有這一張是衝突，而且兩邊都不被蓋掉", function() {
  const base = fingerprintOf(board({}, { notes: [note("n1", "原本"), note("n2", "二")] }));
  const local = board({}, { notes: [note("n1", "這台寫的"), note("n2", "二")] });
  const remote = board({}, { notes: [note("n1", "那台寫的"), note("n2", "二改")] });
  const m = merge(base, local, remote);
  assert.deepStrictEqual(m.conflicts.map(function(c) { return c.kind + ":" + c.id; }), ["canvasNote:w1|notes|n1"]);
  assert.match(m.conflicts[0].title, /便條紙：這台寫的/, "要看得出是哪一張");
  assert.strictEqual(notesOf(m.data).find(function(n) { return n.id === "n1"; }).text, "這台寫的",
    "這台看到的是自己的版本");
  assert.strictEqual(notesOf(m.upload).find(function(n) { return n.id === "n1"; }).text, "那台寫的",
    "推上去的保留雲端原本那一版 —— 還沒決定之前不可以覆蓋");
  assert.strictEqual(notesOf(m.data).find(function(n) { return n.id === "n2"; }).text, "二改",
    "沒撞到的照常同步");
});

test("白板物件：一邊刪、另一邊沒動 → 跟著刪；一邊刪、另一邊改 → 衝突", function() {
  const base = fingerprintOf(board({}, { notes: [note("n1", "a"), note("n2", "b")] }));
  const local = board({}, { notes: [note("n2", "b")] });                           // 刪了 n1
  const remote = board({}, { notes: [note("n1", "a"), note("n2", "b改")] });
  let m = merge(base, local, remote);
  assert.deepStrictEqual(m.conflicts, []);
  assert.deepStrictEqual(notesOf(m.data).map(function(n) { return n.id; }), ["n2"]);

  const remote2 = board({}, { notes: [note("n1", "那台改了"), note("n2", "b")] });
  m = merge(base, local, remote2);
  assert.deepStrictEqual(m.conflicts.map(function(c) { return c.id; }), ["w1|notes|n1"]);
  assert.deepStrictEqual(notesOf(m.data).map(function(n) { return n.id; }), ["n2"], "這台刪掉的就是刪掉");
  assert.deepStrictEqual(notesOf(m.upload).map(function(n) { return n.id; }).sort(), ["n1", "n2"],
    "雲端改過的那張還在雲端上");
});

test("世界觀改名撞在一起：只有名稱是衝突，白板上的東西照常合併", function() {
  const base = fingerprintOf(board({}, { notes: [note("n1", "a")] }));
  const local = board({ name: "這台的名字" }, { notes: [note("n1", "a"), note("n9", "新的")] });
  const remote = board({ name: "那台的名字" }, { notes: [note("n1", "a改")] });
  const m = merge(base, local, remote);
  assert.deepStrictEqual(m.conflicts.map(function(c) { return c.kind + ":" + c.id; }), ["world:w1"]);
  assert.strictEqual(m.data.worldviews[0].name, "這台的名字");
  assert.strictEqual(m.upload.worldviews[0].name, "那台的名字");
  [m.data, m.upload].forEach(function(d) {
    const ns = notesOf(d);
    assert.strictEqual(ns.find(function(n) { return n.id === "n1"; }).text, "a改");
    assert.ok(ns.find(function(n) { return n.id === "n9"; }), "新加的便條紙兩份都要有");
  });
});

test("一台刪了世界觀、另一台改了它的白板 → 衝突，不可以安靜地刪掉", function() {
  const base = fingerprintOf(board({}, { notes: [note("n1", "a")] }));
  const local = db([], { worldviews: [] });
  const remote = board({}, { notes: [note("n1", "那台改的")] });
  const m = merge(base, local, remote);
  assert.deepStrictEqual(m.conflicts.map(function(c) { return c.kind + ":" + c.id; }), ["world:w1"]);
  assert.deepStrictEqual(m.data.worldviews, []);
  assert.strictEqual(m.upload.worldviews.length, 1, "雲端那一份還在");
});

test("舊的指紋（沒有逐物件的雜湊）：只有一邊動過照整個世界觀取；兩邊都動過取聯集", function() {
  const base = fingerprintOf(board({}, { notes: [note("n1", "a")] }));
  delete base.worldMeta;
  delete base.canvas;

  const local = board({}, { notes: [note("n1", "a"), note("n2", "這台")] });
  let m = merge(base, local, board({}, { notes: [note("n1", "a")] }));
  assert.deepStrictEqual(m.conflicts, []);
  assert.deepStrictEqual(notesOf(m.data).map(function(n) { return n.id; }), ["n1", "n2"]);

  m = merge(base, local, board({}, { notes: [note("n1", "a"), note("n3", "那台")] }));
  assert.deepStrictEqual(m.conflicts, []);
  assert.deepStrictEqual(notesOf(m.data).map(function(n) { return n.id; }).sort(), ["n1", "n2", "n3"],
    "沒有祖先分不出誰刪了什麼，寧可多留");
});

test("兩邊都沒有的陣列不要平白加上去（不然每次合併都多推一次）", function() {
  const w = { id: "w1", name: "主", canvas: { nodes: [], edges: [] } };
  const d = db([], { worldviews: [w] });
  const base = fingerprintOf(d);
  // 雲端動了白板（這樣才會走逐物件合併那條路，而不是「兩邊一樣」直接取）
  const w2 = { id: "w1", name: "主", canvas: { nodes: [{ id: "node_x", docId: "d1", x: 1, y: 2 }], edges: [] } };
  const other = db([doc("d1", "x")], { worldviews: [w2] });
  const m = merge(base, d, other);
  assert.strictEqual(m.changedFromRemote, false);
  assert.ok(!("notes" in m.data.worldviews[0].canvas));
});

/* ==========================================================
   還沒決定的衝突要一直是衝突
   ========================================================== */

test("衝突還沒決定：推上去之後祖先記成雲端那版，下一輪也不可以把本機的推上去", function() {
  const base0 = fingerprintOf(db([doc("d1", "原本"), doc("d2", "x")]));
  const local = db([doc("d1", "這台寫的"), doc("d2", "x")]);
  const remote = db([doc("d1", "那台寫的"), doc("d2", "x")]);
  const first = merge(base0, local, remote);
  assert.strictEqual(first.conflicts.length, 1);
  assert.strictEqual(first.changedFromRemote, false, "只有衝突那一筆不同的話，沒東西要推");

  // 推上去（或沒推）之後，祖先記成雲端現在的樣子
  const base1 = fingerprintOf(first.upload);
  const pending = first.conflicts.map(function(c) { return { kind: c.kind, id: c.id }; });

  const without = merge(base1, local, remote);
  assert.strictEqual(without.conflicts.length, 0,
    "（這就是為什麼要記號：少了它，下一輪看起來是「只有本機改」）");
  assert.strictEqual(contentOf(without.upload, "d1"), "這台寫的");

  const withP = mergeP(base1, local, remote, pending);
  assert.deepStrictEqual(withP.conflicts.map(function(c) { return c.id; }), ["d1"], "要一直是衝突");
  assert.strictEqual(contentOf(withP.upload, "d1"), "那台寫的", "雲端那一份不能被蓋掉");
  assert.strictEqual(contentOf(withP.data, "d1"), "這台寫的", "這台的也不能被蓋掉");
});

test("衝突還沒決定，但兩邊後來改成一樣了 → 自然消失", function() {
  const same = db([doc("d1", "一樣了")]);
  const m = mergeP(fingerprintOf(db([doc("d1", "舊")])), same, JSON.parse(JSON.stringify(same)),
    [{ kind: "doc", id: "d1" }]);
  assert.deepStrictEqual(m.conflicts, []);
});

test("衝突記號只影響那一筆：其他的照常三方合併", function() {
  const base = fingerprintOf(board({}, { notes: [note("n1", "a"), note("n2", "b")] }));
  const local = board({}, { notes: [note("n1", "a"), note("n2", "b")] });
  const remote = board({}, { notes: [note("n1", "a"), note("n2", "b改")] });
  const m = mergeP(base, local, remote, [{ kind: "canvasNote", id: "w1|notes|n1" }]);
  assert.deepStrictEqual(m.conflicts, [], "n1 兩邊一樣，不算衝突");
  assert.strictEqual(notesOf(m.data).find(function(n) { return n.id === "n2"; }).text, "b改");
});

/* ==========================================================
   使用者選了之後
   ========================================================== */

function choose(local, fp, remote, conflict, choice, newId) {
  return host(app.applyRecordChoice(local, fp, remote, conflict, choice, newId));
}

test("用這台的：本機不動，下一輪合併就把這台的推上去", function() {
  const base = fingerprintOf(db([doc("d1", "原本")]));
  const local = db([doc("d1", "這台寫的")]);
  const remote = db([doc("d1", "那台寫的")]);
  const c = { kind: "doc", id: "d1" };
  const r = choose(local, base, remote, c, "local");
  assert.strictEqual(contentOf(r.data, "d1"), "這台寫的");
  const m = merge(r.fp, r.data, remote);
  assert.deepStrictEqual(m.conflicts, []);
  assert.strictEqual(contentOf(m.upload, "d1"), "這台寫的");
  assert.strictEqual(m.changedFromRemote, true, "要推上去");
});

test("用雲端的：本機換成雲端的，不再是衝突；而且不會留在垃圾桶裡重複一份", function() {
  const base = fingerprintOf(db([doc("d1", "原本")]));
  const local = db([], { trash: { docs: [doc("d1", "原本")], folders: [] } }); // 這台刪了
  const remote = db([doc("d1", "那台寫的")]);
  const c = { kind: "doc", id: "d1" };
  assert.strictEqual(merge(base, local, remote).conflicts.length, 1);
  const r = choose(local, base, remote, c, "remote");
  assert.strictEqual(contentOf(r.data, "d1"), "那台寫的");
  assert.deepStrictEqual(r.data.trash.docs, [], "同一篇不可以同時在文檔與垃圾桶");
  const m = merge(r.fp, r.data, remote);
  assert.deepStrictEqual(m.conflicts, []);
});

test("兩份都留：這台的另存成（衝突副本），原本那篇換成雲端的", function() {
  const base = fingerprintOf(db([doc("d1", "原本")]));
  const local = db([doc("d1", "這台寫的")]);
  const remote = db([doc("d1", "那台寫的")]);
  const r = choose(local, base, remote, { kind: "doc", id: "d1" }, "both", "doc_copy");
  assert.strictEqual(contentOf(r.data, "d1"), "那台寫的");
  assert.strictEqual(contentOf(r.data, "doc_copy"), "這台寫的");
  assert.strictEqual(r.data.docs.find(function(d) { return d.id === "doc_copy"; }).title, "d1（衝突副本）");
  assert.deepStrictEqual(r.data.docs.map(function(d) { return d.id; }), ["d1", "doc_copy"], "副本緊接在原本那篇後面");
  const m = merge(r.fp, r.data, remote);
  assert.deepStrictEqual(m.conflicts, []);
  assert.strictEqual(contentOf(m.upload, "doc_copy"), "這台寫的", "副本要推上去");
});

test("白板物件用雲端的：只換那一張，其他的不動", function() {
  const base = fingerprintOf(board({}, { notes: [note("n1", "原本"), note("n2", "b")] }));
  const local = board({}, { notes: [note("n1", "這台"), note("n2", "b這台")] });
  const remote = board({}, { notes: [note("n1", "那台"), note("n2", "b")] });
  const r = choose(local, base, remote, { kind: "canvasNote", id: "w1|notes|n1" }, "remote");
  const ns = notesOf(r.data);
  assert.strictEqual(ns.find(function(n) { return n.id === "n1"; }).text, "那台");
  assert.strictEqual(ns.find(function(n) { return n.id === "n2"; }).text, "b這台");
});

test("世界觀本身用雲端的：名稱換掉，白板上的東西保留這台的", function() {
  const base = fingerprintOf(board({}, { notes: [note("n1", "a")] }));
  const local = board({ name: "這台" }, { notes: [note("n1", "a"), note("n2", "這台新增")] });
  const remote = board({ name: "那台" }, { notes: [note("n1", "a")] });
  const r = choose(local, base, remote, { kind: "world", id: "w1" }, "remote");
  assert.strictEqual(r.data.worldviews[0].name, "那台");
  assert.deepStrictEqual(notesOf(r.data).map(function(n) { return n.id; }), ["n1", "n2"]);
});

test("選了之後不動傳進來的那兩份", function() {
  const base = fingerprintOf(db([doc("d1", "原本")]));
  const local = db([doc("d1", "這台")]);
  const before = JSON.stringify(local);
  const baseBefore = JSON.stringify(base);
  choose(local, base, db([doc("d1", "那台")]), { kind: "doc", id: "d1" }, "remote");
  assert.strictEqual(JSON.stringify(local), before);
  assert.strictEqual(JSON.stringify(base), baseBefore);
});
