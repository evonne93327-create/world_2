/* 目錄樹：搬移、收合、以及手機上的拖曳。

   這一批的共通點是「壞掉的時候沒有錯誤訊息」：

   - 資料夾整列不再收合 → 點下去只是選取，看起來像「沒反應」
   - 觸控拖曳沒接上 → 手機上長按之後移動手指，什麼都不會發生
   - 幽靈忘了關 pointer-events → elementFromPoint 永遠問到幽靈自己，
     每一次拖曳都「放不進去」，而且完全沒有跡象可循
   - 搬移規則散成兩份 → 其中一份忘了擋「搬進自己的子孫」，那一支從樹上
     被切下來，資料還在但畫不出來，使用者看到的是「文檔憑空消失」 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { loadApp, host, ROOT } = require("./helpers/load-app.js");

const directoryJs = fs.readFileSync(path.join(ROOT, "js", "directory.js"), "utf8");
const modalJs = fs.readFileSync(path.join(ROOT, "js", "modal.js"), "utf8");
const mainJs = fs.readFileSync(path.join(ROOT, "js", "main.js"), "utf8");
const appJs = fs.readFileSync(path.join(ROOT, "js", "app.js"), "utf8");
const css = fs.readFileSync(path.join(ROOT, "style.css"), "utf8");
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

/* 比順序／找呼叫之前先把註解拿掉。註解裡常常在解釋舊寫法，比到的會是註解。
   （tests/kb-vars.test.js 在同一個陷阱上踩過四次。） */
function codeOnly(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");
}

/* 抓出某個函式「整個呼叫」的原始碼，括號配對著數。

   不要用 /attachContextMenu\([\s\S]*?\);/ 這種非貪婪的寫法：這裡的引數
   本身就是函式（function() { return ...; }），第一個 `);` 出現在引數裡面，
   抓到的只有半截。（這份測試自己先踩過一次，報了一個不存在的錯。） */
function callsTo(src, name) {
  const out = [];
  const needle = name + "(";
  let at = src.indexOf(needle);
  while (at !== -1) {
    let i = at + needle.length;
    let depth = 1;
    while (i < src.length && depth > 0) {
      if (src[i] === "(") depth++;
      else if (src[i] === ")") depth--;
      i++;
    }
    out.push(src.slice(at, i));
    at = src.indexOf(needle, i);
  }
  return out;
}

/* 抓某個函式的整個函式體：從它的 function 那一行，到下一個頂層 function 為止。
   不要用非貪婪配到第一個 \n} —— 裡面有巢狀區塊，那樣會在半路切斷。 */
function bodyOf(src, name) {
  const m = src.match(new RegExp("function\\s+" + name + "\\s*\\([\\s\\S]*?(?=\\nfunction )"));
  assert.ok(m, "找不到 " + name + "()");
  return m[0];
}

/* ---------- 搬移的規則只有一份 ---------- */

function freshApp() {
  const app = loadApp([
    "js/state.js", "js/main.js", "js/storage.js", "js/documents.js",
    "js/canvas.js", "js/import-export.js", "js/directory.js"
  ]);
  app.run(`
    saveData = function() {};
    renderSidebarTree = function() {};
    renderBreadcrumb = function() {};
    appData = {
      worldviews: [{ id: "w1", name: "主" }, { id: "w2", name: "外傳" }],
      folders: [
        { id: "A", worldId: "w1", parentId: null },
        { id: "B", worldId: "w1", parentId: "A" },
        { id: "C", worldId: "w1", parentId: "B" }
      ],
      docs: [{ id: "d1", worldId: "w1", folderId: "A" }]
    };
    activeWorldId = "w1";
  `);
  return app;
}

test("moveItemInto()：文檔搬進資料夾", function() {
  const app = freshApp();
  assert.strictEqual(app.run(`moveItemInto({ type: "doc", id: "d1" }, "B", null)`), true);
  assert.deepStrictEqual(host(app.run("appData.docs[0]")),
    { id: "d1", worldId: "w1", folderId: "B" });
});

test("moveItemInto()：搬到空白處＝回到世界觀的根目錄", function() {
  const app = freshApp();
  assert.strictEqual(app.run(`moveItemInto({ type: "doc", id: "d1" }, null, null)`), true);
  assert.strictEqual(app.run("appData.docs[0].folderId"), null,
    "沒有目標資料夾就是根目錄。原本桌機版根本沒有這個目標，東西拖進資料夾就出不來了");
});

test("moveItemInto()：資料夾不可以搬進自己的子孫", function() {
  const app = freshApp();
  /* 這是整段裡最危險的一條。A 搬進自己的孫子 C 的話，A→B→C→A 繞成一個圈，
     從根目錄走不到它們，畫面上那一整支就消失了——資料其實還在。 */
  assert.strictEqual(app.run(`moveItemInto({ type: "folder", id: "A" }, "C", null)`), false);
  assert.strictEqual(app.run(`moveItemInto({ type: "folder", id: "A" }, "B", null)`), false);
  assert.strictEqual(app.run(`moveItemInto({ type: "folder", id: "A" }, "A", null)`), false,
    "也不可以搬進自己");
  assert.strictEqual(app.run("appData.folders[0].parentId"), null, "A 應該沒有被動到");
});

test("moveItemInto()：沒真的動到就回 false", function() {
  const app = freshApp();
  /* 回傳值決定要不要存檔、重畫、震動回饋。原地放下卻回 true 的話，
     使用者會覺得「我明明沒搬，它卻震了一下」。 */
  assert.strictEqual(app.run(`moveItemInto({ type: "doc", id: "d1" }, "A", "w1")`), false,
    "本來就在 A 裡面");
  assert.strictEqual(app.run(`moveItemInto({ type: "doc", id: "沒這篇" }, "B", null)`), false);
  assert.strictEqual(app.run(`moveItemInto(null, "B", null)`), false);
  assert.strictEqual(app.run(`moveItemInto({ type: "怪東西", id: "d1" }, "B", null)`), false);
});

test("moveItemInto()：可以換世界觀", function() {
  const app = freshApp();
  assert.strictEqual(app.run(`moveItemInto({ type: "doc", id: "d1" }, null, "w2")`), true);
  assert.strictEqual(app.run("appData.docs[0].worldId"), "w2");
});

test("搬移的規則只寫在 moveItemInto() 裡一份", function() {
  /* 以前拖放那一條路自己 doc.folderId = ...、移動彈窗那一條路自己
     folder.parentId = ...，兩份各自演化。彈窗那一份**沒有**擋「搬進自己的
     子孫」——它是靠在畫選項時先過濾掉，那等於把規則寄放在 UI 上。 */
  const drop = codeOnly(directoryJs).match(/folderRow\.ondrop[\s\S]*?\n \};/);
  assert.ok(drop, "找不到資料夾那一列的 ondrop");
  assert.match(drop[0], /moveItemInto\(/,
    "拖放收尾要走 moveItemInto()，不要自己指派 folderId/parentId");

  const confirm = codeOnly(modalJs).match(/function confirmMoveFolder\(\)[\s\S]*?\n\}/);
  assert.ok(confirm, "找不到 confirmMoveFolder()");
  assert.match(confirm[0], /moveItemInto\(/,
    "「移動」彈窗按確認也要走 moveItemInto()");
  assert.ok(!/\.parentId\s*=/.test(confirm[0]),
    "confirmMoveFolder() 不該自己改 parentId —— 那份規則會跟拖放那一份走鐘");

  assert.match(bodyOf(directoryJs, "moveItemInto"), /isDescendantOf\(/,
    "擋「搬進自己的子孫」的判斷要在 moveItemInto() 裡面，不是靠 UI 先過濾選項");
});

/* ---------- 點整列就收合／展開 ---------- */

test("點資料夾那一列就收合／展開，不必瞄準三角形", function() {
  const onclick = codeOnly(directoryJs).match(/folderRow\.onclick[\s\S]*?\n \};/);
  assert.ok(onclick, "找不到資料夾那一列的 onclick");
  assert.match(onclick[0], /collapsedFolders\[folder\.id\]\s*=\s*!collapsedFolders\[folder\.id\]/,
    "單擊就要切換收合狀態 —— 三角形只有十幾像素，手指點不中");
  assert.match(onclick[0], /folderHasChildren\(folder\.id\)/,
    "沒有子項目的不要切換，切了只會讓箭頭閃一下");
});

test("資料夾那一列不可以再掛 ondblclick", function() {
  /* 單擊已經在切換了。留著雙擊的話一次雙擊會切三次（click、click、dblclick），
     使用者看到的是隨機的開合——而且不會有任何錯誤訊息。 */
  assert.ok(!/folderRow\.ondblclick/.test(directoryJs),
    "單擊已經會收合了，ondblclick 會讓雙擊變成切三次");
});

test("點圖示跟點那一列是同一件事", function() {
  /* 註解一直寫著「點圖示就跟點這一列一樣」，但 onclick 開頭那個
     e.target.closest('.node-icon') 會直接 return，所以點圖示其實毫無反應。 */
  const folderClick = codeOnly(directoryJs).match(/folderRow\.onclick[\s\S]*?\n \};/)[0];
  const docClick = codeOnly(directoryJs).match(/row\.onclick[\s\S]*?\n \};/)[0];
  assert.ok(!/closest\('\.node-icon'\)/.test(folderClick),
    "資料夾那一列不該把圖示排除掉 —— 點它應該跟點文字一樣");
  assert.ok(!/closest\('\.node-icon'\)/.test(docClick),
    "文檔那一列不該把圖示排除掉 —— 點它應該就是打開那篇");
});

/* ---------- 手機上的拖曳 ---------- */

test("目錄樹的每一列都接上了觸控拖曳", function() {
  /* HTML5 的 draggable/dragstart/drop 在觸控裝置上根本不會觸發（iOS Safari
     完全不支援）。少接哪一列，那一列在手機上就是「看得到、拖不動」。 */
  const calls = callsTo(codeOnly(directoryJs), "attachContextMenu")
    .filter(function(c) { return /attachContextMenu\(\s*(folderRow|row)\b/.test(c); });
  assert.strictEqual(calls.length, 2, "資料夾與文檔各一列（實得 " + calls.length + "）");
  calls.forEach(function(c) {
    assert.match(c, /touchDragHooks\(/,
      "這一列沒有傳 touchDragHooks()，手機上就拖不動它：\n" + c);
  });
});

test("拖曳期間的 touchmove 必須是非被動的", function() {
  /* passive 的監聽器裡 preventDefault() 會被瀏覽器忽略（連錯誤都不報，
     只在 console 留一行警告）。擋不住的話側欄會一邊被拖、一邊跟著手指捲。 */
  const move = modalJs.match(/element\.addEventListener\("touchmove"[\s\S]*?\{ passive: false \}\);/);
  assert.ok(move, "attachContextMenu() 裡要有一個 { passive: false } 的 touchmove");
  assert.match(move[0], /preventDefault\(\)/, "那個監聽器要擋掉預設的捲動");
  assert.match(move[0], /dragHooks\.move\(/, "而且要把座標交給拖曳");
});

test("長按之後才進入拖曳，而且門檻比長按的容忍值小", function() {
  const attach = codeOnly(modalJs).match(/function attachContextMenu\([\s\S]*?\n\}/);
  assert.ok(attach, "找不到 attachContextMenu()");
  assert.match(attach[0], /longPressTriggered/,
    "拖曳要接在長按之後 —— 目錄這一列的手勢已經滿了（點＝開、直拖＝捲動）");

  const slop = modalJs.match(/const DRAG_AFTER_MENU_SLOP_PX = (\d+);/);
  const longPress = modalJs.match(/const LONG_PRESS_SLOP_PX = (\d+);/);
  assert.ok(slop && longPress, "兩個門檻都要是具名常數");
  assert.ok(Number(slop[1]) < Number(longPress[1]),
    "選單都跳出來了，這時候的移動是刻意的，門檻不該比「按著不動」還寬鬆");
});

test("拖曳有唯一的收尾出口，touchcancel 也走它", function() {
  /* 系統把手勢收走（來電、多指、下拉通知）時只會來 touchcancel。漏掉它的話
     幽靈會永遠掛在畫面上，而且自動捲動的計時器一直在跑。 */
  /* 要在 attachContextMenu() 自己的函式體裡找。modal.js 別處也有
     touchcancel 的監聽器，直接對整個檔案比對會比到錯的那一個
     （測試會因為錯的理由通過）。 */
  const attachBody = bodyOf(modalJs, "attachContextMenu");
  const cancel = attachBody.match(/addEventListener\("touchcancel"[\s\S]*?\}\);/);
  assert.ok(cancel, "attachContextMenu() 裡找不到 touchcancel 的監聽器");
  assert.match(cancel[0], /dragHooks\.cancel\(\)/, "touchcancel 要通知拖曳收尾");

  const body = bodyOf(directoryJs, "cancelTouchDrag");
  assert.match(body, /clearInterval\(/, "自動捲動的計時器要停掉");
  assert.match(body, /removeChild\(/, "幽靈要從畫面上拿掉");
  assert.match(body, /classList\.remove\("is-touch-dragging"\)/, "拖曳中的 class 要拿掉");
  assert.match(body, /touchDragState = null/, "狀態要歸零");
});

test("幽靈不可以吃到點擊，否則永遠找不到放置目標", function() {
  /* 放置目標是用 elementFromPoint() 找的，而幽靈就跟在手指下面。
     忘了 pointer-events: none 的話每次問到的都是幽靈自己 → 每一次拖曳都
     「放不下去」，而且完全沒有錯誤訊息。 */
  const rule = css.match(/\.drag-ghost\s*\{[\s\S]*?\}/);
  assert.ok(rule, "style.css 裡要有 .drag-ghost");
  assert.match(rule[0], /pointer-events:\s*none/,
    ".drag-ghost 一定要 pointer-events: none");
  assert.match(bodyOf(directoryJs, "dropTargetAt"), /elementFromPoint\(/,
    "放置目標是用 elementFromPoint() 找的（上面那條規則就是為了它）");
});

test("放置目標的標記在 HTML 結構上真的存在", function() {
  assert.match(directoryJs, /folderRow\.dataset\.folderId = folder\.id/,
    "資料夾那一列要標上 id，dropTargetAt() 靠它找");
  assert.match(directoryJs, /childrenDiv\.dataset\.folderId = folder\.id/,
    "子項目容器也要標 —— 手指落在資料夾底下的文檔上時，才算丟進那個資料夾");
  assert.match(html, /id="worldTreeContainer"/, "整棵樹的容器＝根目錄這個放置目標");
});

/* ---------- 「移動」彈窗現在兩種都收 ---------- */

test("文檔也有「移動」這條路", function() {
  /* 拖曳要求兩端同時看得見；文檔在最底下、目標資料夾收在最上面時拖不動。
     這是那種情況的退路，而且它在任何裝置上都一定會動。 */
  assert.match(modalJs, /function promptMoveDoc\(/, "要有 promptMoveDoc()");
  const docMenu = modalJs.match(/function buildDocMenuItems\([\s\S]*?\n\}/);
  assert.ok(docMenu, "找不到 buildDocMenuItems()");
  assert.match(docMenu[0], /promptMoveDoc\(/, "文檔的長按選單裡要有「移動文檔」");
  assert.match(html, /id="moveModalTitle"/,
    "標題要有 id —— 同一個彈窗現在資料夾與文檔共用，字要能換");
});

/* ---------- 世界觀清單 ---------- */

test("worldStats()：只算還在的文檔，時間取最新的那一筆", function() {
  const app = loadApp([
    "js/state.js", "js/main.js", "js/storage.js", "js/documents.js",
    "js/canvas.js", "js/import-export.js", "js/directory.js"
  ]);
  const docs = [
    { id: "a", worldId: "w1", updatedAt: "2026-01-05 09:00" },
    { id: "b", worldId: "w1", updatedAt: "2026-03-20 18:30" },
    { id: "c", worldId: "w1", updatedAt: "2026-02-11 07:15" },
    { id: "d", worldId: "w2", updatedAt: "2027-01-01 00:00" }
  ];
  const s = host(app.worldStats(docs, "w1"));
  assert.strictEqual(s.count, 3, "別的世界觀的不要算進來");
  assert.strictEqual(s.updatedAt, "2026-03-20 18:30",
    "updatedAt 是固定寬度的字串，比字典序就是比時間");

  assert.deepStrictEqual(host(app.worldStats(docs, "沒這個世界觀")),
    { count: 0, updatedAt: "" }, "空的要回得出來，不要是 undefined");
  assert.deepStrictEqual(host(app.worldStats(null, "w1")), { count: 0, updatedAt: "" });
});

test("worldStats()：缺 updatedAt 的文檔要算進篇數，不要弄壞時間", function() {
  const app = loadApp([
    "js/state.js", "js/main.js", "js/storage.js", "js/documents.js",
    "js/canvas.js", "js/import-export.js", "js/directory.js"
  ]);
  /* 匯入來的、或很早以前建的文檔可能沒有 updatedAt。那時候
     undefined > "字串" 是 false，所以不會污染結果——但篇數要照算。 */
  const s = host(app.worldStats([
    { id: "a", worldId: "w1" },
    { id: "b", worldId: "w1", updatedAt: "2026-03-20 18:30" },
    { id: "c", worldId: "w1", updatedAt: null }
  ], "w1"));
  assert.strictEqual(s.count, 3);
  assert.strictEqual(s.updatedAt, "2026-03-20 18:30");
});

test("世界觀清單一律 createElement + textContent", function() {
  /* 名稱與簡介都是使用者寫的（或匯入來的）字，拼進 innerHTML 就是一個洞
     （硬規則 5）。這個畫面一次列出全部的世界觀，等於把每一筆都攤開。 */
  const body = codeOnly(bodyOf(directoryJs, "renderWorldList"));
  assert.ok(!/innerHTML\s*=\s*[^"']/.test(body.replace('list.innerHTML = "";', "")),
    "除了清空以外不可以碰 innerHTML");
  assert.match(body, /name\.textContent = world\.name/, "名稱走 textContent");
  assert.match(body, /desc\.textContent =/, "簡介走 textContent");
});

test("清單的兩個入口都接上了", function() {
  /* 手機：從底部那一列往上滑；電腦／平板：點上方的世界觀徽章。
     少接哪一個，那個版面就完全打不開這個畫面。 */
  assert.match(html, /id="btnB_WorldBadge"[^>]*onclick="openWorldListModal\(\)"/,
    "上方徽章要點得開清單");
  assert.ok(!/id="btnB_WorldBadge"[^>]*is-static/.test(html),
    "既然點得動就不該還掛著 is-static");
  assert.match(mainJs, /function setupRailSwipeUp\(\)/, "要有往上滑那條路");
  assert.match(mainJs, /openWorldListModal\(\)/, "滑到底要真的開清單");

  assert.match(appJs, /setupRailSwipeUp\(\);/, "沒有人叫它的話那條路是死的");
});

test("往上滑：方向不對就整個放手，那一列還要能橫向捲", function() {
  const body = codeOnly(bodyOf(mainJs, "setupRailSwipeUp"));
  assert.match(body, /if \(!isMobileLayout\(\)\) return;/,
    "只有「那一列在底下」時才有這個手勢 —— 桌機版它是左邊的直欄，" +
    "往上滑在那裡的意思是捲動它自己");
  assert.match(body, /dy < 0 && Math\.abs\(dy\) > Math\.abs\(dx\) \* RAIL_SWIPE_SLOPE/,
    "要往上、而且垂直要比水平明顯，才算這個手勢");
  assert.match(body, /railSwipe = null; return;/,
    "方向不對要整個放手，不能只是不處理 —— 後面那幾個 touchmove 還會再進來");

  /* 起手點幾乎一定落在某顆世界觀按鈕上。沒有這一段的話，滑開清單的同時
     會順手切換世界觀（左緣右滑那邊踩過同一個坑）。 */
  assert.match(body, /swallowNextClick\(\)/,
    "接手過的手勢，收尾要把瀏覽器補上的那一下 click 吃掉");

  assert.match(body, /\{ passive: false \}/,
    "要擋掉那一列的橫向捲動，touchmove 必須是非被動的");
});
