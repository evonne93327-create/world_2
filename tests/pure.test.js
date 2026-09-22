/* 純函式的單元測試。不需要瀏覽器、不需要 npm install，
   直接 node --test tests/ 就會跑。 */

const test = require("node:test");
const assert = require("node:assert");
const { loadApp, host } = require("./helpers/load-app.js");

const app = loadApp();

test("extractHashtagsFromText", function() {
  const f = app.extractHashtagsFromText;

  assert.deepStrictEqual(host(f("#主角群 這是內容")), ["主角群"]);
  assert.deepStrictEqual(host(f("沒有標籤")), []);
  assert.deepStrictEqual(host(f("")), []);
  assert.deepStrictEqual(host(f(null)), []);

  // 同一個標籤出現兩次只算一次
  assert.deepStrictEqual(host(f("#帝國 第一段\n#帝國 第二段")), ["帝國"]);

  // 多行多標籤，順序照出現順序
  assert.deepStrictEqual(host(f("#甲 x\n#乙 y\n#丙 z")), ["甲", "乙", "丙"]);
});

test("computeManualTagsFor：只留下「內文裡找不到」的標籤", function() {
  const f = app.computeManualTagsFor;

  // 內文裡有 #主角群，所以它不是手動加的
  assert.deepStrictEqual(host(f("#主角群 內容", ["主角群"])), []);

  // 內文裡沒有，就是手動加的
  assert.deepStrictEqual(host(f("內容", ["主角群"])), ["主角群"]);

  assert.deepStrictEqual(host(f("#甲 內容", ["甲", "乙"])), ["乙"]);

  // 標籤含正規表示式的特殊字元不能讓它爆掉
  assert.doesNotThrow(function() { f("內容", ["a.b*c", "(x)"]); });
  assert.deepStrictEqual(host(f("內容", ["a.b*c"])), ["a.b*c"]);

  // #甲乙 不該被 #甲 匹配到
  assert.deepStrictEqual(host(f("#甲乙 內容", ["甲"])), ["甲"]);

  assert.deepStrictEqual(host(f("", null)), []);
});

test("recomputeDocFromContent：字數是中文字 + 英文單詞", function() {
  const f = app.recomputeDocFromContent;

  const a = { manualTags: [], tags: [] };
  f(a, "Hello world from the desert");
  assert.strictEqual(a.wordCount, 5, "五個英文單詞");

  const b = { manualTags: [], tags: [] };
  f(b, "第一章：邊境的鐵匠之女。");
  assert.strictEqual(b.wordCount, 10, "十個中文字（標點不算）");

  const c = { manualTags: [], tags: [] };
  f(c, "");
  assert.strictEqual(c.wordCount, 0);

  // 標籤從內文抽出來，手動加的接在後面
  const d = { manualTags: ["手動的"], tags: [] };
  f(d, "#內文的 一些字");
  assert.ok(host(d.tags).includes("內文的"));
  assert.ok(host(d.tags).includes("手動的"));
});

test("escapeHtml：五個危險字元都要處理", function() {
  const f = app.escapeHtml;
  assert.strictEqual(f("<script>"), "&lt;script&gt;");
  assert.strictEqual(f('a"b'), "a&quot;b");
  assert.strictEqual(f("a'b"), "a&#39;b", "單引號漏掉的話，單引號包的屬性就跳得出去");
  assert.strictEqual(f("a&b"), "a&amp;b");
  assert.strictEqual(f(""), "");
  assert.strictEqual(f(null), "");
  // & 要先換，否則 &lt; 會被二次轉義成 &amp;lt;
  assert.strictEqual(f("<"), "&lt;");
});

test("isSafeImageSrc：只放行 app 自己產生的資料 URI", function() {
  const f = app.isSafeImageSrc;
  assert.ok(f("data:image/png;base64,iVBORw0KGgo="));
  assert.ok(f("data:image/jpeg;base64,/9j/4AAQ"));

  assert.ok(!f('x" onerror="alert(1)'), "跳脫屬性");
  assert.ok(!f("javascript:alert(1)"));
  assert.ok(!f("data:image/svg+xml;base64,PHN2Zz4="), "SVG 可以內含腳本");
  assert.ok(!f("https://evil.example/x.png"), "外部網址");
  assert.ok(!f(null));
  assert.ok(!f({ toString: () => "data:image/png;base64,AA" }), "不是字串");
});

test("importFromTXT 的解析：標題、標籤、內文", function() {
  /* importFromTXT 會呼叫 importDocsArray，這裡只想測解析，
     所以把它換掉攔下結果。 */
  let captured = null;
  app.importDocsArray = function(docs) { captured = host(docs); };

  app.importFromTXT("【角色設定】\n標籤：#主角群 #帝國\n\n這是內文。\n\n====================\n\n");
  assert.strictEqual(captured.length, 1);
  assert.strictEqual(captured[0].title, "角色設定");
  assert.deepStrictEqual(captured[0].tags, ["#主角群", "#帝國"]);
  assert.strictEqual(captured[0].content, "這是內文。");

  app.importFromTXT("【甲】\n\nA\n\n====================\n\n【乙】\n\nB\n\n====================");
  assert.strictEqual(captured.length, 2);
  assert.strictEqual(captured[0].title, "甲");
  assert.strictEqual(captured[1].title, "乙");

  // 沒有標題的也不能爆
  app.importFromTXT("就只是一段字");
  assert.strictEqual(captured.length, 1);
  assert.strictEqual(captured[0].title, "匯入文檔");
});

test("coerceImportedDoc：垃圾資料要擋下來", function() {
  const f = app.coerceImportedDoc;

  assert.strictEqual(f(5), null, "數字");
  assert.strictEqual(f(null), null);
  assert.strictEqual(f([]), null, "陣列");
  assert.strictEqual(f({}), null, "全空的物件");
  assert.strictEqual(f({ title: "", content: "", images: [] }), null, "三個都空");

  assert.strictEqual(f({ title: "角色", content: "內容" }).title, "角色");

  // title 是物件 → 不當成字串用
  assert.strictEqual(f({ title: { a: 1 }, content: "x" }).title, "匯入文檔");

  // 標題有上限
  assert.strictEqual(f({ title: "あ".repeat(100000), content: "x" }).title.length, 200);

  // tags 裡的非字串要濾掉
  assert.deepStrictEqual(host(f({ title: "t", content: "x", tags: ["好", 5, null] }).tags), ["好"]);
});

test("validateFullDatabase：壞掉的備份檔要擋下來並說明原因", function() {
  const f = app.validateFullDatabase;
  const world = { id: "w1", name: "W", icon: "🌍", canvas: { nodes: [], edges: [], notes: [] } };

  assert.strictEqual(f({ worldviews: [world], folders: [], docs: [] }), null, "最小的合法檔案");

  assert.match(f({ worldviews: [], folders: [], docs: [] }), /沒有任何世界觀/);
  assert.match(f({ worldviews: [{ name: "無 id" }], folders: [], docs: [] }), /缺少 id/);
  assert.match(f({ worldviews: [world], folders: [], docs: [{ title: "無 id", worldId: "w1" }] }), /缺少 id/);
  assert.match(
    f({ worldviews: [world], folders: [], docs: [{ id: "d1", worldId: "不存在" }] }),
    /不存在的世界觀/, "孤兒文檔要指出來");

  // id 含有會跳脫 HTML 屬性的字元 —— 實際被利用過，見 poc_dataid
  assert.match(
    f({ worldviews: [world], folders: [],
        docs: [{ id: 'x" onfocus="alert(1)', worldId: "w1", title: "t" }] }),
    /不允許的字元/);
});

/* ==========================================================
   軟體鍵盤：visualViewport 的四個量

   實機只有使用者測得到（這個環境裝不起 WebKit），所以把算式釘在這裡。
   iPad 直放 820×1124、橫放 1180×764 是實機量過的尺寸。
   ========================================================== */
test("keyboardInsetState：沒有 visualViewport、或差距太小就不算鍵盤", function() {
  const f = app.keyboardInsetState;

  assert.strictEqual(f(null, 1124).open, false, "沒有這個 API 的瀏覽器維持原樣");

  // 網址列收合之類的小變化不是鍵盤
  assert.strictEqual(f({ height: 1100, offsetTop: 0, scale: 1 }, 1124).open, false);

  // 雙指放大時 vv.height 也會變小，那不是鍵盤
  assert.strictEqual(f({ height: 500, offsetTop: 0, scale: 2 }, 1124).open, false);

  // 關掉的時候四個值都要是 0，CSS 端才不會拿到半套的狀態
  assert.deepStrictEqual(host(f(null, 1124)),
    { open: false, height: 0, top: 0, viewHeight: 0, inset: 0 });
});

test("keyboardInsetState：iOS 沒有推版面視窗時（offsetTop = 0）", function() {
  const f = app.keyboardInsetState;

  // iPad 直放，鍵盤蓋掉 420
  const p = f({ height: 704, offsetTop: 0, scale: 1 }, 1124);
  assert.strictEqual(p.open, true);
  assert.strictEqual(p.viewHeight, 704, "body 的內容盒＝看得見的高度");
  assert.strictEqual(p.top, 0, "沒被推就不用讓");
  assert.strictEqual(p.height, 704, "body 的外框：版面頂端 → 看得見的底端");
  assert.strictEqual(p.inset, 420, "浮動按鈕要讓開的量＝鍵盤高度");

  // iPad 橫放，可視區矮很多
  const l = f({ height: 364, offsetTop: 0, scale: 1 }, 764);
  assert.strictEqual(l.open, true, "橫放一樣要判定成有鍵盤");
  assert.strictEqual(l.viewHeight, 364);
  assert.strictEqual(l.inset, 400);
});

test("keyboardInsetState：iOS 把版面視窗往上推時，上緣也要讓開", function() {
  const f = app.keyboardInsetState;

  // iPad 直放，鍵盤蓋掉 420，iOS 又把版面視窗往上推了 180
  const s = f({ height: 704, offsetTop: 180, scale: 1 }, 1124);

  assert.strictEqual(s.top, 180, "被推掉多少，body 的 padding-top 就要補多少");
  assert.strictEqual(s.viewHeight, 704, "看得見的高度跟推不推無關");
  assert.strictEqual(s.height, 884, "body 的外框＝被推掉的 + 看得見的");
  assert.strictEqual(s.inset, 240, "版面被推上去之後，鍵盤只蓋住底下這麼多");

  // top + viewHeight === height：body 的內容盒剛好落在看得見的那一塊
  assert.strictEqual(s.top + s.viewHeight, s.height);
  // top + viewHeight + inset === innerHeight：三段加起來就是整個版面視窗
  assert.strictEqual(s.top + s.viewHeight + s.inset, 1124);

  // 「有沒有鍵盤」不能受 offsetTop 影響 —— 橫放時 iOS 得推很多，
  // 把 offsetTop 折進偵測式子就會判成「沒有鍵盤」，按鈕整組退回鍵盤底下。
  assert.strictEqual(f({ height: 364, offsetTop: 340, scale: 1 }, 764).open, true);
});

test("keyboardInsetState：offsetTop 量到怪值也不能算出負數或 NaN", function() {
  const f = app.keyboardInsetState;

  // 橡皮筋捲動可能量到負的 offsetTop
  assert.strictEqual(f({ height: 704, offsetTop: -50, scale: 1 }, 1124).top, 0);
  assert.strictEqual(f({ height: 704, offsetTop: -50, scale: 1 }, 1124).inset, 420);

  // 推得比鍵盤還高是不可能的，夾回鍵盤高度
  const over = f({ height: 704, offsetTop: 999, scale: 1 }, 1124);
  assert.strictEqual(over.top, 420);
  assert.strictEqual(over.inset, 0, "讓到底就是 0，不能變負的");
  assert.strictEqual(over.height, 1124);

  // offsetTop 取不到時當 0。少了這道保險，undefined 會讓整串變成 NaN，
  // 而 NaN <= 門檻 是 false，會一路寫進 --kb-h: NaNpx。
  const missing = f({ height: 704, scale: 1 }, 1124);
  assert.strictEqual(missing.top, 0);
  Object.keys(missing).forEach(function(k) {
    if (k === "open") return;
    assert.ok(isFinite(missing[k]), k + " 不可以是 NaN");
  });
});

test("caretBottomFromPointer：用手指的座標換算游標那一行的底", function() {
  const f = app.caretBottomFromPointer;

  // 沒捲動過：就是點下去的位置再加一行
  assert.strictEqual(f(300, 0, 0, 30), 330);

  /* 按下去之後瀏覽器自己又捲了 120（它也會把游標捲進視野）。
     內容往上跑了 120，所以那一行現在在畫面上更高的地方。
     不補這一段就是用過期的座標算，會少捲。 */
  assert.strictEqual(f(300, 0, 120, 30), 210);

  // 反方向（往回捲）也要對
  assert.strictEqual(f(300, 120, 0, 30), 450);

  /* 加一整行而不是半行：pointerY 落在那一行的任何高度都有可能，寧可多算
     一點。游標只會被捲得更靠上，方向是安全的；少算就可能卡在鍵盤邊緣。 */
  assert.ok(f(300, 0, 0, 30) - 300 >= 30, "至少要留一整行");
});

test("caretMeasureMethod：手指座標要排在所有量法前面", function() {
  const f = app.caretMeasureMethod;

  /* 手指剛指過就用它，不管游標在不在最末端。它是唯一「不管游標在哪裡都準」
     的來源，而且零重排。 */
  assert.strictEqual(f(true, true, false), "pointer");
  assert.strictEqual(f(true, true, true), "pointer",
    "就算在最末端也該用手指座標 —— 它比 textarea 的底更準");

  // 沒有手指座標（程式聚焦、鍵盤操作）才退回去
  assert.strictEqual(f(true, false, true), "textarea-bottom");
  assert.strictEqual(f(true, false, false), "mirror");

  /* 打字途中（accurate=false）：只有「游標在整篇最末端」這一種量法便宜到
     負擔得起。不在最末端就跳過，交給瀏覽器自己的捲動。 */
  assert.strictEqual(f(false, false, true), "textarea-bottom");
  assert.strictEqual(f(false, false, false), "skip");
  assert.strictEqual(f(false, true, false), "skip",
    "打字途中不可以用手指座標 —— 游標早就離開那個位置了");
});

test("keyboardHeightKey：直放橫放要分開存", function() {
  const f = app.keyboardHeightKey;

  // iPad 實測尺寸：直 820×1124、橫 1180×764
  assert.strictEqual(f(820, 1124), "wb_kbh_p");
  assert.strictEqual(f(1180, 764), "wb_kbh_l");

  // 手機
  assert.strictEqual(f(390, 844), "wb_kbh_p");
  assert.strictEqual(f(844, 390), "wb_kbh_l");

  // 兩個方向不能拿到同一個鍵，否則分開存等於沒做
  assert.notStrictEqual(f(820, 1124), f(1124, 820));

  // 正方形視窗（分割畫面可能出現）歸到直放，不要變成 undefined
  assert.strictEqual(f(800, 800), "wb_kbh_p");
});
