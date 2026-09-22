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
  assert.deepStrictEqual(mergeCollection({}, [], []), { list: [], conflicts: [] });
  assert.deepStrictEqual(mergeCollection(null, null, null), { list: [], conflicts: [] });
});
