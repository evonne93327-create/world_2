/* 編輯器這一輪的三件事：復原不要跳、圖片點得開、世界觀有一句話簡介。

   共通點一樣是「壞了不會有錯誤訊息」：

   - 復原時忘了把捲動位置放回去 → 畫面每按一次就彈一下，沒有任何報錯
   - 圖片檢視只在 closeImageViewer() 裡收尾 → 按 Escape 關掉的那一次收不到，
     幾百 KB 的 base64 一直掛在 DOM 上
   - 簡介拼進 innerHTML → 匯入的檔案可以在那裡塞標籤（硬規則 5） */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { loadApp, host, ROOT } = require("./helpers/load-app.js");

const app = loadApp();
const documentsJs = fs.readFileSync(path.join(ROOT, "js", "documents.js"), "utf8");
const directoryJs = fs.readFileSync(path.join(ROOT, "js", "directory.js"), "utf8");
const mainJs = fs.readFileSync(path.join(ROOT, "js", "main.js"), "utf8");
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

function codeOnly(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");
}

function bodyOf(src, name) {
  const m = src.match(new RegExp("function\\s+" + name + "\\s*\\([\\s\\S]*?(?=\\nfunction )"));
  assert.ok(m, "找不到 " + name + "()");
  return m[0];
}

/* ---------- 復原不要跳 ---------- */

test("caretScrollCorrection()：游標看得見就不要動", function() {
  // 一整行都在可見範圍裡
  assert.strictEqual(app.caretScrollCorrection(300, 324, 100, 700), 0);
  // 貼齊上緣、貼齊下緣，都還算看得見
  assert.strictEqual(app.caretScrollCorrection(100, 124, 100, 700), 0);
  assert.strictEqual(app.caretScrollCorrection(676, 700, 100, 700), 0);
});

test("caretScrollCorrection()：真的看不見才捲，而且捲到中間", function() {
  const mid = 100 + (700 - 100) / 2;          // 400
  // 游標在下面看不到的地方
  assert.strictEqual(app.caretScrollCorrection(900, 924, 100, 700), 924 - mid);
  // 游標在上面被捲過去了 → 負的（往回捲）
  assert.ok(app.caretScrollCorrection(-200, -176, 100, 700) < 0);
  // 只差一點點露出下緣也算看不見
  assert.ok(app.caretScrollCorrection(690, 714, 100, 700) !== 0);
});

test("復原之後要把捲動位置放回去，而且放在所有重畫之後", function() {
  /* textarea.value 整個換掉、再 focus() + setSelectionRange()，瀏覽器會自己
     去「把游標捲進視野」，挑的落點跟原本不一樣 —— 那就是使用者說的
     「多次復原會跳動，就算是同一行」。 */
  const body = codeOnly(bodyOf(documentsJs, "applyHistorySnapshot"));
  assert.match(body, /const keepScrollTop = scroller \? scroller\.scrollTop : null;/,
    "換內容之前要先記住捲動位置");
  /* 比整行、連條件一起比。只比 `scroller.scrollTop = keepScrollTop` 的話，
     有人把它包進 if (false) 或別的條件裡，這條還是綠的
     ——破壞測試那一輪就是這樣漏掉的。 */
  assert.match(body, /if \(scroller && keepScrollTop !== null\) scroller\.scrollTop = keepScrollTop;/,
    "做完要放回去，而且只被「有沒有這個容器」擋著");

  const restoreAt = body.indexOf("scroller.scrollTop = keepScrollTop");
  const lastRender = Math.max(
    body.lastIndexOf("renderTOC("), body.lastIndexOf("renderSidebarTree("),
    body.lastIndexOf("renderQuickJumpList("));
  assert.ok(lastRender !== -1 && restoreAt > lastRender,
    "還原要排在所有重畫之後 —— 它們都可能動到版面高度，早一步還原會被蓋掉");
});

test("復原的補捲不可以有動畫", function() {
  /* 見 NOTES 3d-2：試過兩輪（內建 smooth、自己跑 rAF），兩輪都把「工具列
     被吃掉」那個 bug 帶了回來。症狀看起來像完全無關的另一個 bug，
     要好幾輪之後才會被發現，所以這裡用反向檢查擋著。 */
  const body = codeOnly(bodyOf(documentsJs, "revealCaretIfOffscreen"));
  assert.ok(!/behavior:\s*["']smooth["']/.test(body), "不可以用 behavior: smooth");
  assert.ok(!/scrollIntoView|scrollTo\(|requestAnimationFrame/.test(body),
    "補捲只能是 scrollTop += 一次到位，不要做動畫");
  assert.match(body, /scroller\.scrollTop \+= delta/, "就是直接加上去");
});

test("連按復原時只在最後檢查一次游標", function() {
  /* 每一步都量一次的話：一來每次算出來的落點不同（就是那個跳動），
     二來量測本身要把游標前面的文章整篇重排（實測一萬行 106ms），
     連按五次就是五次。 */
  const m = documentsJs.match(/const UNDO_CARET_SETTLE_MS = (\d+);/);
  assert.ok(m, "要有一個具名的等待時間");
  const ms = Number(m[1]);
  assert.ok(ms >= 120 && ms <= 400,
    "太短蓋不過連按、太長會覺得畫面慢半拍（實得 " + ms + "）");

  const body = codeOnly(bodyOf(documentsJs, "scheduleUndoCaretCheck"));
  assert.match(body, /clearTimeout\(undoCaretTimer\)/,
    "每一次復原都要把上一次排的檢查取消掉，否則就不是「只檢查最後一次」");

  assert.match(codeOnly(bodyOf(documentsJs, "applyHistorySnapshot")), /scheduleUndoCaretCheck\(\)/,
    "復原之後要排這個檢查");
});

test("沒記到游標的快照不要把游標丟到文章結尾", function() {
  /* 最底下那一格快照沒有 sel（ensureDocHistory() 建的時候還沒有游標可記）。
     原本的退路是「放到結尾」，於是一路復原到底的最後一下會把畫面甩到文章
     最末端 —— 正是使用者說的跳動。不知道游標在哪就別動它。 */
  const body = codeOnly(bodyOf(documentsJs, "applyHistorySnapshot"));
  assert.match(body, /const priorStart = textarea\.selectionStart/,
    "要先把現在的游標記下來");

  const priorAt = body.indexOf("const priorStart");
  const valueAt = body.indexOf("textarea.value = content");
  assert.ok(priorAt !== -1 && valueAt !== -1 && priorAt < valueAt,
    "一定要在寫入 .value 之前讀 —— 寫入會把游標推到結尾（規格如此），" +
    "之後再讀就只讀得到結尾，退路會變成「一律跳到結尾」");

  assert.ok(!/selection \? Math\.min\(Math\.max\(0, selection\[0\]\), max\) : max/.test(body),
    "沒有選取範圍時不可以退回 max（文章結尾）");
});

/* ---------- 圖片檢視 ---------- */

test("圖片檢視的每一個 id 都在 index.html 裡", function() {
  ["imgViewerModal", "imgViewerImage", "imgViewerCount", "imgViewerPrev", "imgViewerNext"]
    .forEach(function(id) {
      assert.ok(documentsJs.includes('getElementById("' + id + '")'),
        "js 應該要用到 " + id);
      assert.ok(html.includes('id="' + id + '"'),
        "js 抓 " + id + "，但 index.html 裡沒有 —— 檢視整個不會動，而且不會報錯");
    });
});

test("放大檢視前還是要過圖片白名單", function() {
  /* 這是這些字串第二個會被放進 <img src> 的地方。它們走過匯入與同步兩條路
     進來，白名單要在每一個入口都擋（見 main.js 的 SAFE_IMAGE_SRC）。 */
  assert.match(codeOnly(bodyOf(documentsJs, "renderImageViewer")), /isSafeImageSrc\(/,
    "renderImageViewer() 要先檢查才寫進 img.src");
});

test("不管從哪一條路關掉，都要把那份 base64 放掉", function() {
  /* Escape 與點遮罩走的是共用的 dismissModal()，它只把 .active 拿掉，
     根本不會經過 closeImageViewer()。一開始就是這樣寫的，結果關掉之後
     幾百 KB 的 data URI 還掛在 <img> 上。 */
  const body = codeOnly(bodyOf(documentsJs, "setupImageViewer"));
  assert.match(body, /MutationObserver/, "要盯著 class 變化收尾");
  assert.match(body, /releaseImageViewer\(\)/, "class 被拿掉時要真的去收");
  assert.match(codeOnly(bodyOf(documentsJs, "releaseImageViewer")), /removeAttribute\("src"\)/,
    "收尾就是把 src 拿掉");
});

test("縮圖點得開，而且刪除鈕不會順便彈出大圖", function() {
  const body = codeOnly(bodyOf(documentsJs, "renderDocImages"));
  assert.match(body, /img\.onclick = function\(\) \{ openImageViewer\(index\); \}/,
    "點擊要掛在 <img> 上");
  assert.ok(!/box\.onclick/.test(body),
    "不要掛在外框上 —— 右上角的刪除鈕就在框裡，點刪除不該先彈一張大圖");
});

/* ---------- 世界觀的一句話簡介 ---------- */

test("簡介一律用 textContent", function() {
  /* 硬規則 5：使用者輸入（含匯入來的）不要拼進 innerHTML。 */
  const body = codeOnly(bodyOf(directoryJs, "renderWorldDesc"));
  assert.match(body, /line\.textContent =/, "要用 textContent");
  assert.ok(!/innerHTML/.test(body), "不可以拼 innerHTML");
});

test("簡介：按取消不動，留白儲存才是清掉", function() {
  /* 旁邊的重新命名把空字串當成錯誤（名稱不能空）。簡介本來就可以清掉，
     照抄那個寫法就會變成「清不掉」。 */
  const body = codeOnly(bodyOf(directoryJs, "promptEditWorldDesc"));
  assert.match(body, /openTextInputModal\(/, "用自己的輸入彈窗，不是 prompt()");
  assert.ok(!/markTextInputInvalid/.test(body), "簡介留白不算錯，不能擋");

  const apply = codeOnly(bodyOf(directoryJs, "applyWorldDesc"));
  assert.match(apply, /delete world\.desc/, "留白就要把它刪掉");
  assert.match(apply, /WORLD_DESC_MAX_LEN/, "長度要截 —— 它顯示在側欄一行裡");
});

test("WORLD_DESC_MAX_LEN 要定義在匯入那條路也看得到的地方", function() {
  /* 它原本寫在 directory.js。瀏覽器裡沒事（載入順序在前），但測試沙箱不載
     directory.js，import-export.js 一呼叫就 ReferenceError —— 而那是在
     「匯入別人的檔案」時才會走到的路，最不該在那裡爆掉。 */
  assert.match(mainJs, /const WORLD_DESC_MAX_LEN = \d+;/,
    "要宣告在 js/main.js");
  assert.ok(!/const WORLD_DESC_MAX_LEN/.test(directoryJs),
    "不要在 directory.js 裡再宣告一次");
  assert.strictEqual(typeof app.normalizeImportedWorld, "function",
    "沙箱裡叫得到匯入那條路（沒載 directory.js）");
});

test("匯入的簡介：非字串丟掉、太長截掉", function() {
  const evil = host(app.normalizeImportedWorld({ id: "w", name: "X", desc: { toString: 1 } }));
  assert.ok(!("desc" in evil), "物件／陣列畫出來是 [object Object]，直接丟掉");

  const long = host(app.normalizeImportedWorld({ id: "w", name: "X", desc: "字".repeat(500) }));
  assert.ok(long.desc.length <= 60, "太長要截（實得 " + long.desc.length + "）");

  const ok = host(app.normalizeImportedWorld({ id: "w", name: "X", desc: "  一句話  " }));
  assert.strictEqual(ok.desc, "一句話", "前後空白要去掉");

  const none = host(app.normalizeImportedWorld({ id: "w", name: "X" }));
  assert.ok(!("desc" in none), "本來就沒有的不要補一個空字串出來");
});

/* ---------- 加標籤、白板拉線：改用輸入彈窗之後的行為 ---------- */

function tagApp() {
  const app = loadApp(["js/state.js", "js/main.js", "js/storage.js", "js/documents.js",
                       "js/canvas.js", "js/import-export.js", "js/directory.js", "js/modal.js"]);
  app.run(`
    saveData = function() {};
    renderLiveHashtags = function() {};
    renderSidebarTree = function() {};
    renderCanvasLines = function() {};
    appData = {
      worldviews: [{ id: "w1", name: "主", canvas: { nodes: [
        { id: "n1", docId: "d1", x: 0, y: 0 }, { id: "n2", docId: "d2", x: 300, y: 0 }], edges: [], notes: [] } }],
      folders: [],
      docs: [{ id: "d1", worldId: "w1", title: "團長", tags: ["舊"], manualTags: [] },
             { id: "d2", worldId: "w1", title: "遊俠", tags: [] }],
      tagSettings: {}
    };
    activeWorldId = "w1"; activeDocId = "d1";
  `);
  return app;
}

test("加標籤：逗號分隔（半形全形都行）、去掉 #、不重複", function() {
  const app = tagApp();
  assert.strictEqual(app.run(`addManualTagsToActiveDoc(" #帝國軍方 , 主角群，舊,, ")`), true);
  const d = host(app.run(`appData.docs[0]`));
  assert.deepStrictEqual(d.tags, ["舊", "帝國軍方", "主角群"]);
  assert.deepStrictEqual(d.manualTags, ["帝國軍方", "主角群", "舊"]);
  assert.strictEqual(app.run(`appData.tagSettings["帝國軍方"]`), "c_gray", "新標籤給預設顏色");
});

test("加標籤：全是空白或逗號就不算，讓彈窗留著", function() {
  const app = tagApp();
  ["", "   ", ",，, ", "#"].forEach(function(input) {
    assert.strictEqual(app.run(`addManualTagsToActiveDoc(${JSON.stringify(input)})`), false,
      JSON.stringify(input) + " 不該算加到東西");
  });
  assert.deepStrictEqual(host(app.run(`appData.docs[0].tags`)), ["舊"]);
});

test("白板拉線：留白就是「關聯」，前後空白去掉", function() {
  const app = tagApp();
  const e1 = host(app.run(`addCanvasEdge("n1", "n2", "   ")`));
  assert.strictEqual(e1.label, "關聯", "跟原本 prompt() 版本一樣：留白＝關聯");
  const e2 = host(app.run(`addCanvasEdge("n1", "n2", "  宿敵  ")`));
  assert.strictEqual(e2.label, "宿敵");
  assert.strictEqual(app.run(`getCurrentWorldCanvas().edges.length`), 2);
});
