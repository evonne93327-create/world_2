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
