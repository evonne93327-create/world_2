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
  /* 尾巴補一個假的 "\nfunction "：檔案裡最後一個函式後面沒有下一個函式可以
     當邊界，不補的話它永遠抓不到（檔案結尾的那個函式就是這樣）。 */
  const m = (src + "\nfunction ").match(new RegExp("function\\s+" + name + "\\s*\\([\\s\\S]*?(?=\\nfunction )"));
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

  const confirm = codeOnly(bodyOf(modalJs, "confirmMoveOrCopy"));
  assert.match(confirm, /moveItemInto\(/,
    "「移動」彈窗按「移動」也要走 moveItemInto()");
  assert.ok(!/\.parentId\s*=/.test(confirm),
    "confirmMoveOrCopy() 不該自己改 parentId —— 那份規則會跟拖放那一份走鐘");

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

test("拖曳一定要搶在選單前面", function() {
  /* 第一版是接在長按選單「之後」的，實機上完全不能用：這個 app 的選單在
     手機版是**從底部滑上來的整片 sheet ＋ 半透明遮罩**，畫面一暗、一整片
     東西蓋上來，那是「手勢結束了」的訊號，沒有人會想繼續移動手指。
     使用者的原話是「長按會出現菜單，然後有遮罩所以沒有辦法移動文件」。 */
  const arm = modalJs.match(/const DRAG_ARM_HOLD_MS = (\d+);/);
  const menu = modalJs.match(/const LONG_PRESS_DELAY_MS = (\d+);/);
  assert.ok(arm && menu, "兩個時間都要是具名常數");
  assert.ok(Number(arm[1]) < Number(menu[1]),
    "拿起來要早於選單跳出來（實得 " + arm[1] + "ms vs " + menu[1] + "ms）—— " +
    "不然使用者永遠是先看到選單");
  assert.ok(Number(arm[1]) >= 200,
    "太短會把「猶豫一下才開始捲動」誤判成拖曳（實得 " + arm[1] + "ms）");

  const armSlop = modalJs.match(/const DRAG_ARM_SLOP_PX = (\d+);/);
  const longPressSlop = modalJs.match(/const LONG_PRESS_SLOP_PX = (\d+);/);
  assert.ok(armSlop && longPressSlop, "位移門檻也要是具名常數");
  assert.ok(Number(armSlop[1]) < Number(longPressSlop[1]),
    "LONG_PRESS_SLOP_PX 那個 18px 是為了「拿著一公斤的平板手會晃」而放寬的；" +
    "用在這裡會把晃動誤判成「要拖了」");
});

test("拖曳開始時要把選單的計時器取消掉", function() {
  /* 不取消的話：手指拖到一半，480ms 一到，整片 sheet 還是會冒出來把畫面
     蓋掉——拖曳明明已經在進行了。 */
  /* 抓「那個非被動的 touchmove」，不要抓 if (dragHooks) —— 那個字串現在
     touchstart 裡也有一份（設定拿起來的計時器），會配到錯的區塊。 */
  const drag = modalJs.match(/element\.addEventListener\("touchmove",[\s\S]*?\{ passive: false \}\);/);
  assert.ok(drag, "找不到拖曳那個 touchmove");
  assert.match(drag[0], /dragging = true;[\s\S]*?clearTimeout\(pressTimer\);/,
    "開始拖的時候要把選單的計時器清掉");
  assert.match(drag[0], /closeContextMenu\(\)/,
    "撐過 480ms 才想拖的那條路還是要收得掉選單");
});

test("一拿起來就要 preventDefault，不可以等超過門檻才擋", function() {
  /* 這是第一版真正拖不動的技術原因。瀏覽器是看「第一次 touchmove 有沒有被
     preventDefault」來決定要不要自己接手做捲動；只要放過一次它就接手了，
     之後再擋都沒用，而且會補一個 touchcancel 把拖曳砍掉。

     合成事件測不出來（不會真的觸發捲動），所以只能比程式碼的順序。 */
  const drag = codeOnly(modalJs).match(/element\.addEventListener\("touchmove",[\s\S]*?\{ passive: false \}\);/);
  assert.ok(drag, "找不到拖曳那個 touchmove");
  const preventAt = drag[0].indexOf("e.preventDefault()");
  const slopAt = drag[0].indexOf("DRAG_START_SLOP_PX");
  assert.ok(preventAt !== -1 && slopAt !== -1, "兩段都要在");
  assert.ok(preventAt < slopAt,
    "preventDefault() 要排在「還沒超過門檻就 return」那一段之前 —— " +
    "排在後面的話，第一個 touchmove 會被放行，瀏覽器就接手去捲動了");
});

test("開始拖之後，後續的 touchmove 還要進得來", function() {
  /* 這個 bug 是自己寫出來的：開始拖的時候順手把 dragArmed 清掉，於是第二個
     touchmove 就在開頭的守衛被擋回去——幽靈停在第一次移動的位置不再跟著
     手指，preventDefault 也不再發生（瀏覽器可以接手捲動）。

     最糟的是它「看起來是成功的」：放手時是用 touchend 的座標去找目標，
     所以東西還是搬對了。實機上會看到幽靈卡住不動。 */
  const drag = codeOnly(modalJs).match(/element\.addEventListener\("touchmove",[\s\S]*?\{ passive: false \}\);/);
  assert.ok(drag, "找不到拖曳那個 touchmove");
  assert.match(drag[0], /if \(\(!dragArmed && !dragging\)/,
    "守衛要同時看 dragArmed 與 dragging");
  assert.ok(!/disarmDrag\(\)/.test(drag[0]),
    "開始拖的時候只能收掉「浮起來」那個樣子，不可以把狀態歸零 —— " +
    "歸零在 touchend / touchcancel");
});

test("拿起來要看得見，不能只靠震動", function() {
  /* iOS Safari 沒有 navigator.vibrate。只靠震的話，iPhone 使用者在那 300ms
     之後完全沒有任何提示，不會知道現在可以拖了。 */
  assert.match(modalJs, /classList\.add\("drag-armed"\)/,
    "拿起來要掛一個 class");
  /* 比整條規則、而且要求它真的畫得出東西。只比選擇器出現過的話，把規則
     改名但留著下面那條 transition 的清單，這裡還是綠的
     ——破壞測試那一輪就是這樣漏掉的。 */
  const rule = css.match(/\.node-row-outer\.drag-armed\s*>\s*\.node-row\s*\{[^}]*\}/);
  assert.ok(rule, "style.css 要有 .node-row-outer.drag-armed > .node-row 這條規則");
  assert.match(rule[0], /background|box-shadow|transform/,
    "那條規則要真的看得出變化，不能是空的");

  /* 兩條收尾的路都要把它拿掉，不然那一列會一直浮著。 */
  const attach = codeOnly(modalJs).match(/function attachContextMenu\([\s\S]*?\n\}/);
  assert.ok(attach, "找不到 attachContextMenu()");
  ["touchend", "touchcancel"].forEach(function(evt) {
    const h = attach[0].match(new RegExp('addEventListener\\("' + evt + '"[\\s\\S]*?\\}\\);'));
    assert.ok(h, "找不到 " + evt);
    assert.match(h[0], /disarmDrag\(\)/, evt + " 要把「拿起來」的狀態收掉");
  });
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
  /* 比整行、連條件一起比。只比函式名字的話，有人把它包進 if (false) 裡
     這條還是綠的（破壞測試那一輪就是這樣漏掉的）。 */
  assert.match(body, /if \(railSwipe && railSwipe\.claimed\) swallowNextClick\(\);/,
    "接手過的手勢，收尾要把瀏覽器補上的那一下 click 吃掉");

  assert.match(body, /\{ passive: false \}/,
    "要擋掉那一列的橫向捲動，touchmove 必須是非被動的");
});

/* ---------- 新世界觀附帶一篇空白文檔 ---------- */

function worldApp() {
  const app = loadApp([
    "js/state.js", "js/main.js", "js/storage.js", "js/documents.js",
    "js/canvas.js", "js/import-export.js", "js/directory.js"
  ]);
  app.run(`
    saveData = function() {};
    renderSidebarTree = function() {};
    renderBreadcrumb = function() {};
    var __selected = null;
    selectWorld = function(id) { __selected = id; };
    /* 彈窗在沙箱裡畫不出來。記下它收到的參數，測試自己扮演「按下按鈕」：
       __submit(["名稱", "簡介"]) 就是填好之後按「建立」。 */
    var __modal = null, __invalid = [];
    openTextInputModal = function(opts) { __modal = opts; };
    markTextInputInvalid = function(i) { __invalid.push(i || 0); };
    function __submit(values) { return __modal.onSubmit(values); }
    appData = { worldviews: [{ id: "w1", name: "舊的" }], folders: [],
                docs: [{ id: "d_old", worldId: "w1", folderId: null }], trash: { docs: [], folders: [] } };
    activeWorldId = "w1";
  `);
  return app;
}

test("新增世界觀之後，裡面就有一篇空白文檔", function() {
  const app = worldApp();
  app.run(`promptCreateWorldview(); __submit(["  新大陸  ", "  龍的故鄉  "]);`);

  const world = host(app.run(`appData.worldviews[appData.worldviews.length - 1]`));
  assert.strictEqual(world.name, "新大陸");
  assert.strictEqual(world.desc, "龍的故鄉", "同一個彈窗裡填的簡介也要存進去");

  const docs = host(app.run(`appData.docs.filter(function(d) { return d.worldId === "${world.id}"; })`));
  assert.strictEqual(docs.length, 1, "新的世界觀裡要剛好有一篇");
  assert.strictEqual(docs[0].folderId, null, "放在根目錄，不是某個資料夾裡");
  assert.strictEqual(docs[0].content, "", "是空白的");

  /* selectWorld() 會打開那個世界觀的第一篇 —— 文檔要在它被呼叫之前就放進去，
     不然打開的時候裡面還是空的，停在一片空白的編輯區。 */
  assert.strictEqual(app.run("__selected"), world.id, "建完要切過去");
  const body = codeOnly(bodyOf(directoryJs, "createWorldview"));
  assert.ok(body.indexOf("makeNewDoc(") < body.indexOf("selectWorld("),
    "文檔要在 selectWorld() 之前放進去 —— 它會打開第一篇");

  assert.strictEqual(app.run(`appData.docs.length`), 2, "舊的那篇不要被動到");
});

test("按取消或名稱留白就什麼都不建", function() {
  /* 不然每按一次取消就多一個沒有名字的世界觀，外加一篇孤兒文檔。 */

  // 按取消：onSubmit 根本不會被呼叫
  const cancel = worldApp();
  cancel.run(`promptCreateWorldview();`);
  assert.strictEqual(cancel.run("appData.worldviews.length"), 1);

  ['""', '"   "'].forEach(function(name) {
    const app = worldApp();
    const kept = app.run(`promptCreateWorldview(); __submit([${name}, "簡介"]);`);
    assert.strictEqual(kept, false,
      "名稱留白時 onSubmit 要回 false —— 彈窗留著讓他補，不是關掉然後什麼都沒發生");
    assert.deepStrictEqual(host(app.run("__invalid")), [0], "名稱那一欄要標出來");
    assert.strictEqual(app.run("appData.worldviews.length"), 1, "名稱是 " + name + " 時不該建世界觀");
    assert.strictEqual(app.run("appData.docs.length"), 1, "也不該多一篇文檔");
  });
});

test("新增世界觀的彈窗：名稱預設「新世界觀」、第二欄是簡介", function() {
  const app = worldApp();
  const fields = host(app.run(`promptCreateWorldview(); __modal.fields`));
  assert.strictEqual(fields.length, 2, "名稱與簡介在同一個彈窗裡");
  assert.strictEqual(fields[0].value, "新世界觀", "預設名稱（打開時會反藍，直接打字就取代）");
  assert.strictEqual(fields[1].value, "", "簡介預設空白");
  assert.ok(fields[1].maxLength > 0, "簡介要有長度上限 —— 它顯示在側欄一行裡");
});

test("新增資料夾：預設「新分類」、留白不建", function() {
  const app = worldApp();
  const fields = host(app.run(`promptCreateFolder(null, "w1"); __modal.fields`));
  assert.deepStrictEqual(fields.map(function(f) { return f.value; }), ["新分類"]);

  assert.strictEqual(app.run(`__submit(["   "])`), false, "留白要留著彈窗");
  assert.strictEqual(app.run("appData.folders.length"), 0);

  app.run(`__submit(["  騎士團  "])`);
  const f = host(app.run("appData.folders[0]"));
  assert.deepStrictEqual([f.name, f.worldId, f.parentId], ["騎士團", "w1", null]);
});

test("空白文檔的形狀只寫在 makeNewDoc() 一份", function() {
  /* 以前欄位是直接寫在 createNewDoc() 裡。第二個地方要用就只能複製一份，
     哪天加了欄位（manualTags 當初就是後來加的），複製的那份不會跟著長。 */
  const app = worldApp();
  const doc = host(app.run(`makeNewDoc("w9", "f1")`));
  ["id", "worldId", "folderId", "icon", "title", "content", "tags", "manualTags",
   "images", "wordCount", "updatedAt"].forEach(function(k) {
    assert.ok(k in doc, "空白文檔要有 " + k);
  });
  assert.strictEqual(doc.worldId, "w9");
  assert.strictEqual(doc.folderId, "f1");

  /* 同一毫秒建兩篇（連點兩下「新增文檔」）不可以撞 id —— 撞了的話兩篇會
     共用同一份復原紀錄，刪一篇另一篇也跟著不見。 */
  const a = app.run(`makeNewDoc("w9", null).id`);
  const b = app.run(`makeNewDoc("w9", null).id`);
  assert.notStrictEqual(a, b);

  const create = codeOnly(bodyOf(directoryJs, "createNewDoc"));
  assert.match(create, /makeNewDoc\(/, "「新增文檔」也要從 makeNewDoc() 拿");
  assert.ok(!/manualTags:/.test(create), "createNewDoc() 裡不該再有一份欄位清單");
});

/* ---------- 關掉目錄就取消批量刪除 ---------- */

test("exitBatchDeleteMode()：只會「離開」，絕不會「進入」", function() {
  /* 它底下呼叫的是 toggleBatchDeleteMode()——那是個切換。少了開頭那個
     「不在就什麼都不做」，每次關目錄都會變成「進入批量刪除模式」。 */
  const app = loadApp([
    "js/state.js", "js/main.js", "js/storage.js", "js/documents.js",
    "js/canvas.js", "js/import-export.js", "js/directory.js"
  ]);
  app.run(`
    renderSidebarTree = function() {};
    updateBatchBarCount = function() {};
    document.getElementById = function() {
      return { classList: { toggle: function() {}, add: function() {}, remove: function() {} }, textContent: "" };
    };
    isBatchDeleteMode = false;
    exitBatchDeleteMode();
  `);
  assert.strictEqual(app.run("isBatchDeleteMode"), false, "本來不在批量模式，關目錄之後也不能在");

  app.run(`
    isBatchDeleteMode = true;
    batchSelectedDocs.add("d1");
    batchSelectedFolders.add("f1");
    exitBatchDeleteMode();
  `);
  assert.strictEqual(app.run("isBatchDeleteMode"), false, "在批量模式就要離開");
  assert.strictEqual(app.run("batchSelectedDocs.size + batchSelectedFolders.size"), 0,
    "勾選要一起清掉 —— 留著的話下次打開目錄那幾項還勾著，隨手一按就刪掉早就忘記的東西");
});

test("每一條收起目錄的路都會取消批量刪除", function() {
  /* 反向掃描：main.js 裡每一個「把目錄收起來」的動作（加上 collapsed、拿掉
     drawer-open），所在的函式裡都要呼叫 afterSidebarClosed()。以後多一條
     收目錄的路卻忘了接，這裡會紅。 */
  const code = codeOnly(mainJs);
  const funcs = code.split(/\n(?=function )/);
  const closers = funcs.filter(function(f) {
    return /classList\.(add|toggle)\("collapsed"\)|classList\.remove\("drawer-open"\)/.test(f);
  });
  assert.ok(closers.length >= 3, "應該抓得到至少三個收目錄的函式（實得 " + closers.length + "）");
  closers.forEach(function(f) {
    const name = (f.match(/^function (\w+)/) || [])[1];
    assert.match(f, /afterSidebarClosed\(\)/,
      name + "() 會把目錄收起來，但沒有呼叫 afterSidebarClosed() —— 批量刪除的勾選會留著");
  });

  /* toggle 那條要注意：它是切換，只有「變成收起來」的那一邊才算。 */
  const toggle = funcs.find(function(f) { return /^function toggleSidebarMenu/.test(f); });
  assert.match(toggle, /if \(sidebar\.classList\.contains\("collapsed"\)\) afterSidebarClosed\(\);/,
    "toggleSidebarMenu() 只有在收起來的那一邊才取消 —— 展開的時候不該動");

  assert.match(bodyOf(mainJs, "afterSidebarClosed"), /exitBatchDeleteMode\(\)/,
    "afterSidebarClosed() 要真的去取消批量刪除");
});

/* ---------- 批量投射白板 ---------- */

test("batchNodePositions()：空白板從左上角開始", function() {
  const app = loadApp();
  const pos = host(app.batchNodePositions([], 1));
  assert.deepStrictEqual(pos, [{ x: 40, y: 60 }]);
  assert.deepStrictEqual(host(app.batchNodePositions([], 0)), []);
  assert.deepStrictEqual(host(app.batchNodePositions(null, 0)), []);
});

test("batchNodePositions()：放在既有節點下方，不會疊上去", function() {
  const app = loadApp();
  const existing = [{ x: 40, y: 70 }, { x: 280, y: 150 }, { x: 500, y: 20 }];
  const pos = host(app.batchNodePositions(existing, 5));
  const lowestBottom = 150 + 120;                  // 最低的那個 + 估計高度
  pos.forEach(function(p) {
    assert.ok(p.y > lowestBottom, "新節點要在所有既有節點下方（y=" + p.y + "）");
  });
  assert.strictEqual(pos[0].x, 40, "左邊跟既有節點最左邊對齊");
});

test("batchNodePositions()：排成接近正方形的網格，彼此不重疊", function() {
  const app = loadApp();
  const W = app.run("CANVAS_NODE_W");
  const H = app.run("BATCH_EST_NODE_H");

  [[3, 2], [4, 2], [9, 3], [20, 4], [50, 4]].forEach(function(pair) {
    const n = pair[0], cols = pair[1];
    const pos = host(app.batchNodePositions([], n));
    assert.strictEqual(pos.length, n);
    const xs = new Set(pos.map(function(p) { return p.x; }));
    assert.strictEqual(xs.size, cols, n + " 篇應該排成 " + cols + " 欄（實得 " + xs.size + "）");

    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const a = pos[i], b = pos[j];
      const overlap = a.x < b.x + W && b.x < a.x + W && a.y < b.y + H && b.y < a.y + H;
      assert.ok(!overlap, n + " 篇時第 " + i + " 與第 " + j + " 個疊在一起了");
    }
  });
});

test("projectDocsToCanvas()：跳過已在白板上的、別的世界觀的、重複的", function() {
  const app = loadApp();
  app.run(`
    saveData = function() {};
    appData = {
      worldviews: [{ id: "w1", name: "主", canvas: { nodes: [{ id: "node_a", docId: "a", x: 40, y: 60 }], edges: [], notes: [] } },
                   { id: "w2", name: "外傳", canvas: { nodes: [], edges: [], notes: [] } }],
      folders: [],
      docs: [{ id: "a", worldId: "w1" }, { id: "b", worldId: "w1" }, { id: "c", worldId: "w1" },
             { id: "x", worldId: "w2" }]
    };
    activeWorldId = "w1";
  `);
  const added = host(app.run(`projectDocsToCanvas(["a", "b", "b", "x", "nope", "c"])`));
  assert.deepStrictEqual(added, ["b", "c"],
    "a 已在白板上、b 重複、x 是別的世界觀、nope 不存在 —— 只有 b 與 c 該放上去");
  assert.strictEqual(app.run(`getCurrentWorldCanvas().nodes.length`), 3);
  assert.deepStrictEqual(host(app.run(`projectDocsToCanvas(["a", "b"])`)), [],
    "全都已經在白板上就什麼都不做");
});

test("批量投射的清單一律 createElement + textContent", function() {
  /* 批量匯出那邊以前是拼 HTML，被做出一個可利用的洞（見那裡的註解）。
     這裡列的是同一批標題，不能重蹈覆轍。 */
  const canvasJs = fs.readFileSync(path.join(ROOT, "js", "canvas.js"), "utf8");
  const body = codeOnly(bodyOf(canvasJs, "renderBatchProjectList"));
  const innerHtmlWrites = body.match(/innerHTML\s*=[^;]*/g) || [];
  assert.deepStrictEqual(innerHtmlWrites, ['innerHTML = ""'], "除了清空以外不可以碰 innerHTML");
  assert.match(body, /name\.textContent = \(d\.icon/, "文檔標題走 textContent");
  assert.match(body, /name\.textContent = \(folder\.icon/, "資料夾名稱走 textContent");
});

test("批量投射的兩個入口都接上了", function() {
  assert.match(html, /onclick="closeDocActionsPanel\(\); openBatchProjectModal\(\);"/,
    "文檔的 ⋯ 選單裡要有，跟「投射白板」放在一起");
  assert.match(html, /class="canvas-floating-btn" onclick="openBatchProjectModal\(\)"/,
    "白板上也要有 —— 人在白板上時最常想做的就是把文檔放上來");
});

/* ---------- 移動彈窗：排序、跨世界觀的移動與複製 ---------- */

function moveApp() {
  const app = loadApp([
    "js/state.js", "js/main.js", "js/storage.js", "js/documents.js",
    "js/canvas.js", "js/import-export.js", "js/directory.js"
  ]);
  app.run(`
    saveData = function() {};
    renderSidebarTree = function() {};
    renderBreadcrumb = function() {};
    refreshCanvasIfVisible = function() {};
    var __trashed = [];
    trashOrphanNodesForDocs = function(ids, label) { __trashed.push({ ids: ids.slice().sort(), label: label }); };
    appData = {
      worldviews: [{ id: "w1", name: "主", icon: "🌍" }, { id: "w2", name: "外傳", icon: "🔮" }],
      folders: [
        { id: "A", worldId: "w1", parentId: null, name: "角色" },
        { id: "B", worldId: "w1", parentId: "A", name: "騎士" },
        { id: "C", worldId: "w1", parentId: null, name: "年表" },
        { id: "X", worldId: "w2", parentId: null, name: "角色" },
        { id: "Y", worldId: "w2", parentId: "X", name: "反派" },
        { id: "Z", worldId: "w2", parentId: "不存在", name: "孤兒資料夾" }
      ],
      docs: [
        { id: "d1", worldId: "w1", folderId: "B", title: "團長", content: "內文", tags: ["t"], images: [] },
        { id: "d2", worldId: "w1", folderId: "A", title: "遊俠", content: "", tags: [], images: [] },
        { id: "d3", worldId: "w1", folderId: null, title: "總設定", content: "", tags: [], images: [] }
      ],
      trash: { docs: [], folders: [], canvas: [] }
    };
    activeWorldId = "w1";
  `);
  return app;
}

test("moveTargetOptions()：世界觀一 → 它的資料夾 → 世界觀二 → 它的資料夾", function() {
  const app = moveApp();
  const opts = host(app.run(`moveTargetOptions({ type: "doc", id: "d3" })`));
  const seq = opts.map(function(o) { return o.worldId + ":" + (o.parentId || "根") + ":" + o.depth; });
  assert.deepStrictEqual(seq, [
    "w1:根:0", "w1:A:1", "w1:B:2", "w1:C:1",
    "w2:根:0", "w2:X:1", "w2:Y:2", "w2:Z:1"
  ], "資料夾要緊跟在自己的世界觀後面、照樹狀順序；上層不存在的當成最上層");

  /* 原本是「先列全部世界觀，再列全部資料夾」，兩個世界觀都有「角色」時
     根本分不出是哪一個。現在它們各自排在自己的世界觀底下。 */
  const labels = opts.map(function(o) { return o.label; });
  assert.ok(labels[1].indexOf("　") === 0 && labels[2].indexOf("　　") === 0,
    "深度要用全形空白縮排（<option> 會吃掉一般的前導空白）");
});

test("moveTargetOptions()：標出目前位置", function() {
  const app = moveApp();
  const cur = host(app.run(`moveTargetOptions({ type: "doc", id: "d1" })`))
    .filter(function(o) { return o.current; });
  assert.deepStrictEqual(cur.map(function(o) { return o.parentId; }), ["B"], "只有一個、而且是它現在的資料夾");

  const root = host(app.run(`moveTargetOptions({ type: "doc", id: "d3" })`))
    .filter(function(o) { return o.current; });
  assert.deepStrictEqual(root.map(function(o) { return o.worldId + "/" + o.parentId; }), ["w1/null"],
    "在根目錄的話，標的是它那個世界觀的根目錄，不是別的世界觀的");
});

test("moveTargetOptions()：搬資料夾時，自己與整支子孫都不列", function() {
  const app = moveApp();
  const ids = host(app.run(`moveTargetOptions({ type: "folder", id: "A" })`))
    .map(function(o) { return o.parentId; });
  assert.ok(ids.indexOf("A") === -1 && ids.indexOf("B") === -1, "A 與它底下的 B 都不能是目的地");
  assert.ok(ids.indexOf("C") !== -1 && ids.indexOf("X") !== -1, "其他的照列");
});

test("跨世界觀搬資料夾：整棵子樹一起搬過去", function() {
  /* 原本只改了資料夾自己的 worldId。子資料夾與文檔留在原本的世界觀，
     而它們的上層已經不在那裡——兩邊的目錄樹都畫不出它們。 */
  const app = moveApp();
  assert.strictEqual(app.run(`moveItemInto({ type: "folder", id: "A" }, null, "w2")`), true);
  const where = host(app.run(`({
    A: appData.folders.find(function(f) { return f.id === "A"; }).worldId,
    B: appData.folders.find(function(f) { return f.id === "B"; }).worldId,
    d1: appData.docs.find(function(d) { return d.id === "d1"; }).worldId,
    d2: appData.docs.find(function(d) { return d.id === "d2"; }).worldId,
    d3: appData.docs.find(function(d) { return d.id === "d3"; }).worldId,
    C: appData.folders.find(function(f) { return f.id === "C"; }).worldId
  })`));
  assert.deepStrictEqual(where, { A: "w2", B: "w2", d1: "w2", d2: "w2", d3: "w1", C: "w1" },
    "A 底下的全部跟著過去，不相干的留在原地");

  const trashed = host(app.run("__trashed"));
  assert.strictEqual(trashed.length, 1);
  assert.deepStrictEqual(trashed[0].ids, ["d1", "d2"],
    "搬走的文檔在原本白板上的節點要收掉 —— 白板畫節點時不看世界觀，不收會一直掛著");
  assert.match(trashed[0].label, /搬到別的世界觀/,
    "垃圾桶裡要講清楚原因，不是「隨文檔一起刪除」");
});

test("同一個世界觀裡搬移：不碰白板", function() {
  const app = moveApp();
  app.run(`moveItemInto({ type: "doc", id: "d3" }, "C", "w1")`);
  app.run(`moveItemInto({ type: "folder", id: "B" }, "C", "w1")`);
  assert.strictEqual(app.run("__trashed.length"), 0, "還在同一張白板上，節點不能被收掉");
});

test("copyItemInto()：文檔複製一份，原本的不動", function() {
  const app = moveApp();
  const newId = app.run(`copyItemInto({ type: "doc", id: "d1" }, "X", "w2")`);
  assert.ok(newId && newId !== "d1", "要拿到新的 id");
  const both = host(app.run(`appData.docs.filter(function(d) { return d.title === "團長"; })`));
  assert.strictEqual(both.length, 2);
  const orig = both.find(function(d) { return d.id === "d1"; });
  const copy = both.find(function(d) { return d.id === newId; });
  assert.deepStrictEqual([orig.worldId, orig.folderId], ["w1", "B"], "原本的留在原地");
  assert.deepStrictEqual([copy.worldId, copy.folderId], ["w2", "X"]);
  assert.strictEqual(copy.content, "內文");
  assert.deepStrictEqual(copy.tags, ["t"]);

  /* 深拷貝：改了複本的標籤，原本的不能跟著變。 */
  app.run(`appData.docs.find(function(d) { return d.id === "${newId}"; }).tags.push("new")`);
  assert.deepStrictEqual(host(app.run(`appData.docs.find(function(d) { return d.id === "d1"; }).tags`)), ["t"],
    "複本跟原本不能共用同一個陣列");
});

test("copyItemInto()：資料夾整棵子樹複製，上下層對得上、id 全新", function() {
  const app = moveApp();
  const newRoot = app.run(`copyItemInto({ type: "folder", id: "A" }, "X", "w2")`);
  const r = host(app.run(`(function() {
    var root = appData.folders.find(function(f) { return f.id === "${newRoot}"; });
    var child = appData.folders.find(function(f) { return f.parentId === "${newRoot}"; });
    var docs = appData.docs.filter(function(d) { return d.worldId === "w2"; });
    return {
      root: [root.name, root.worldId, root.parentId],
      child: child ? [child.name, child.worldId] : null,
      docs: docs.map(function(d) {
        var f = appData.folders.find(function(x) { return x.id === d.folderId; });
        return d.title + "@" + (f ? f.name : "?") + "(" + (f && f.worldId) + ")";
      }).sort(),
      uniqueFolders: new Set(appData.folders.map(function(f) { return f.id; })).size === appData.folders.length,
      uniqueDocs: new Set(appData.docs.map(function(d) { return d.id; })).size === appData.docs.length,
      origStill: appData.folders.filter(function(f) { return f.worldId === "w1"; }).length
    };
  })()`));
  assert.deepStrictEqual(r.root, ["角色", "w2", "X"]);
  assert.deepStrictEqual(r.child, ["騎士", "w2"], "子資料夾要跟著複製、掛在新的那一個底下");
  assert.deepStrictEqual(r.docs, ["團長@騎士(w2)", "遊俠@角色(w2)"],
    "文檔要掛在「新的」資料夾底下，不是原本的");
  assert.ok(r.uniqueFolders && r.uniqueDocs, "同一毫秒產生的 id 也不能撞");
  assert.strictEqual(r.origStill, 3, "原本那三個資料夾都還在");
});

test("copyItemInto()：不能複製進自己的子孫", function() {
  const app = moveApp();
  assert.strictEqual(app.run(`copyItemInto({ type: "folder", id: "A" }, "B", "w1")`), null,
    "複製的過程中子孫又多了一份 —— 不擋的話會無止盡地長");
  assert.strictEqual(app.run(`copyItemInto({ type: "folder", id: "A" }, "A", "w1")`), null);
  assert.strictEqual(app.run(`copyItemInto({ type: "doc", id: "沒這篇" }, null, "w2")`), null);
});

test("移動彈窗：按鈕順序是 取消 → 複製 → 移動", function() {
  /* 使用者指定的順序。「移動」在最右邊＝主要動作的位置。 */
  const block = html.match(/id="moveTargetSelect"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/);
  assert.ok(block, "找不到移動彈窗的按鈕列");
  const labels = (block[0].match(/<button[^>]*>([^<]+)<\/button>/g) || [])
    .map(function(b) { return b.replace(/<[^>]+>/g, "").trim(); });
  assert.deepStrictEqual(labels, ["取消", "複製", "移動"]);

  assert.match(block[0], /id="moveCopyBtn" onclick="confirmMoveOrCopy\('copy'\)" hidden/,
    "「複製」預設藏起來，目的地是別的世界觀才出現");
  assert.match(block[0], /onclick="confirmMoveOrCopy\('move'\)"/);
  assert.ok(!/type="radio"/.test(block[0]), "不要再用單選框");

  /* .btn 設了 display: inline-flex，會蓋掉瀏覽器預設的 [hidden]{display:none}。
     少了這一條，「複製」在同一個世界觀時也會冒出來。 */
  assert.match(css, /#moveCopyBtn\[hidden\]\s*\{\s*display:\s*none;/,
    "hidden 屬性要真的藏得起來");
});

test("移動彈窗：只有目的地在別的世界觀時才有「複製」", function() {
  assert.match(codeOnly(bodyOf(modalJs, "updateMoveModeVisibility")), /copyBtn\.hidden = !other;/,
    "同一個世界觀裡不給複製 —— 同一個目錄多一份一樣的沒有意義");

  const confirm = codeOnly(bodyOf(modalJs, "confirmMoveOrCopy"));
  assert.match(confirm, /if \(mode === "copy" && !crossWorld\) return;/,
    "按鈕狀態跟目的地不同步的那一瞬間，同世界觀的複製也要擋掉");
  assert.match(confirm, /copyItemInto\(/, "按複製走 copyItemInto()");
  assert.match(confirm, /moveItemInto\(/, "按移動照舊走 moveItemInto()");

  const open = codeOnly(bodyOf(modalJs, "openMoveModal"));
  assert.match(open, /moveTargetOptions\(ref\)/, "清單要從 moveTargetOptions() 來（順序在那裡定、有測試）");
  assert.ok(!/appData\.worldviews\.forEach/.test(open), "不要在彈窗裡自己再排一次");
  assert.match(open, /updateMoveModeVisibility\(\)/,
    "打開時就要算一次 —— 目前位置是預設選項，「複製」一開始應該是藏著的");
});

/* ---------- 垃圾桶：全部放一起、照世界觀分組 ---------- */

function trashApp() {
  const app = loadApp([
    "js/state.js", "js/main.js", "js/storage.js", "js/documents.js",
    "js/canvas.js", "js/import-export.js", "js/directory.js", "js/modal.js"
  ]);
  app.run(`
    saveData = function() {};
    renderTrashList = function() {};
    confirm = function() { return true; };
    alert = function() {};
    appData = {
      worldviews: [{ id: "w1", name: "主" }, { id: "w2", name: "外傳" }],
      folders: [], docs: [],
      trash: {
        docs: [{ id: "a", worldId: "w1" }, { id: "b", worldId: "w2" }, { id: "g", worldId: "已刪除的" }],
        folders: [{ id: "fa", worldId: "w1" }, { id: "fb", worldId: "w2" }],
        canvas: [{ kind: "node", worldId: "w1" }, { kind: "note", worldId: "w2" }]
      }
    };
    activeWorldId = "w1";
  `);
  return app;
}

test("垃圾桶：清空就是全部清掉（所有世界觀共用一個）", function() {
  /* 中間有一版是「每個世界觀的垃圾桶各自獨立、只清自己的」，使用者用過之後
     改回來了：全部放在一起，標示清楚是哪個世界觀的就好。 */
  const app = trashApp();
  app.run(`emptyTrash()`);
  const left = host(app.run(`[appData.trash.docs.length, appData.trash.folders.length, appData.trash.canvas.length]`));
  assert.deepStrictEqual(left, [0, 0, 0]);
});

test("垃圾桶的清單：每一筆都列、白板項目點下去才照 id 找位置", function() {
  /* 白板項目以前是用「畫清單當下的索引」復原與刪除的。清單開著的時候同步
     可能換掉 trash.canvas，那個索引就會指到別筆——按「復原」復原到別的東西。
     改成點下去的那一刻照 id 重新找（canvasTrashIndexOf）。 */
  const body = codeOnly(bodyOf(modalJs, "renderTrashList"));
  assert.match(body, /\.map\(function\(item, index\) \{ return \{ item: item, index: index \}; \}\)/,
    "分組之前先把原本的索引記下來（組不出 id 的舊資料退回用它）");
  assert.match(body, /const i = canvasTrashIndexOf\(e\.item, e\.index\); if \(i >= 0 && restoreCanvasTrashItem\(i\)\)/,
    "復原前照 id 重新找位置");
  assert.match(body, /const i = canvasTrashIndexOf\(e\.item, e\.index\); if \(i >= 0\) permanentlyDeleteCanvasTrashItem\(i\)/,
    "刪除也是");
  assert.ok(!/activeWorldId/.test(body), "不要再照目前的世界觀篩選 —— 全部放在一起");
  assert.ok(!/innerHTML\s*=\s*'/.test(body), "空的提示也走 textContent");
});

/* ---------- 一句話簡介在搜尋欄上面 ---------- */

test("一句話簡介在搜尋欄上面", function() {
  const desc = html.indexOf('id="worldDescLine"');
  const search = html.indexOf('class="search-wrap"');
  const tree = html.indexOf('id="worldTreeContainer"');
  assert.ok(desc !== -1 && search !== -1 && tree !== -1);
  assert.ok(desc < search && search < tree, "順序要是：簡介 → 搜尋欄 → 目錄樹（使用者指定的位置）");
});

/* ---------- 垃圾桶：刪掉的世界觀照名字分組、放最上面 ---------- */

test("刪世界觀時，把名字蓋在垃圾桶裡屬於它的每一筆上", function() {
  const app = loadApp([
    "js/state.js", "js/main.js", "js/storage.js", "js/documents.js",
    "js/canvas.js", "js/import-export.js", "js/directory.js", "js/modal.js"
  ]);
  app.run(`
    appData = { worldviews: [{ id: "w1", name: "主" }, { id: "wX", name: "龍之谷", icon: "🐉" }],
      folders: [], docs: [],
      trash: { docs: [{ id: "early", worldId: "wX" }, { id: "other", worldId: "w1" }],
               folders: [{ id: "f", worldId: "wX" }],
               canvas: [{ kind: "node", worldId: "wX" }] } };
    stampDeletedWorldOnTrash("wX", "龍之谷", "🐉");
  `);
  const t = host(app.run("appData.trash"));
  assert.strictEqual(t.docs[0].fromWorldName, "龍之谷",
    "之前就從這個世界觀刪進來的也要蓋 —— 它現在一樣是「世界觀已經不在」");
  assert.strictEqual(t.folders[0].fromWorldName, "龍之谷");
  assert.strictEqual(t.canvas[0].fromWorldName, "龍之谷");
  assert.strictEqual(t.docs[0].fromWorldIcon, "🐉");
  assert.ok(!("fromWorldName" in t.docs[1]), "別的世界觀的不能被蓋");

  /* 現在世界觀整筆也會存進 trash.worlds（那一份有 id，合併有管到，見
     sync-merge 的測試）。蓋在每一筆上的名字還是留著：它是「更早就刪掉、
     後來世界觀也沒了」的那些項目認得出主人的唯一線索。 */
  const del = codeOnly(bodyOf(directoryJs, "deleteWorldById"));
  const stampAt = del.indexOf("stampDeletedWorldOnTrash(");
  const removeAt = del.indexOf("appData.worldviews = appData.worldviews.filter");
  assert.ok(stampAt !== -1 && stampAt < removeAt,
    "要在把世界觀拿掉之前蓋 —— 拿掉之後就查不到名字了");
});

test("trashGroups()：刪掉的世界觀在最上面（最近刪的在前），接著是現有的、照左側那排的順序", function() {
  const app = loadApp([
    "js/state.js", "js/main.js", "js/storage.js", "js/documents.js",
    "js/canvas.js", "js/import-export.js", "js/directory.js", "js/modal.js"
  ]);
  app.run(`appData = { worldviews: [{ id: "w1", name: "主", icon: "🌍" }, { id: "w2", name: "外傳" }],
                       folders: [], docs: [], trash: { docs: [], folders: [], canvas: [] } };`);
  const groups = host(app.run(`trashGroups(
    [{ id: "fA", worldId: "wA", fromWorldName: "龍之谷", deletedTs: 200 }],
    [{ id: "w2doc", worldId: "w2", deletedTs: 999 },
     { id: "a1", worldId: "wA", fromWorldName: "龍之谷", deletedTs: 200 },
     { id: "b1", worldId: "wB", fromWorldName: "廢墟", deletedTs: 300 },
     { id: "own", worldId: "w1", deletedTs: 50 },
     { id: "old", worldId: "wOld", deletedTs: 1 }],
    [{ index: 0, item: { kind: "node", worldId: "wA", deletedTs: 200 } }]
  )`));
  assert.deepStrictEqual(groups.map(function(g) { return (g.deleted ? "刪:" : "") + (g.name || "(無名)"); }),
    ["刪:廢墟", "刪:龍之谷", "刪:(無名)", "主", "外傳"],
    "刪掉的在上面、最近刪的在前；現有的照左側那排的順序（不是照刪除時間）");

  const dragon = groups[1];
  assert.deepStrictEqual([dragon.folders.length, dragon.docs.length, dragon.canvas.length], [1, 1, 1],
    "資料夾、文檔、白板項目都要進同一組");
  assert.strictEqual(dragon.canvas[0].index, 0, "白板項目要帶著原本的索引（復原用的）");
  assert.strictEqual(groups[3].icon, "🌍", "現有的世界觀用它現在的圖示");
});

test("垃圾桶：刪掉的世界觀放最上面", function() {
  const body = codeOnly(bodyOf(modalJs, "renderTrashList"));
  const goneAt = body.indexOf('heading("刪除的世界觀"');
  const aliveAt = body.indexOf("alive.forEach(");
  assert.ok(goneAt !== -1 && aliveAt !== -1 && goneAt < aliveAt,
    "「刪除的世界觀」那一區要畫在現有世界觀之前（使用者指定的順序）");
  assert.match(body, /heading\(\(g\.icon \|\| "🌐"\) \+ " " \+ g\.name, "trash-group-title"\)/,
    "現有的世界觀也要有標題 —— 全部放在一起之後，就靠這個分辨是哪個世界觀的");
  assert.match(body, /\(名稱沒有留下來的世界觀\)|名稱沒有留下來的世界觀/,
    "更早以前刪的世界觀沒蓋過名字，也要有一組，不能消失");
  assert.ok(!/來自已刪除的世界觀/.test(body), "分組之後不用再在每一列後面標了");
});

test("從垃圾桶復原時，把蓋上去的世界觀名字拿掉", function() {
  ["restoreDocFromTrash", "restoreFolderFromTrash"].forEach(function(fn) {
    const body = codeOnly(bodyOf(modalJs, fn));
    assert.match(body, /delete \w+\.fromWorldName;/, fn + "() 要拿掉 fromWorldName —— 回到目錄之後那是沒意義的雜訊");
    assert.match(body, /delete \w+\.fromWorldIcon;/, fn + "() 也要拿掉 fromWorldIcon");
  });
});

/* ---------- 刪掉的世界觀：整個復原 ---------- */

/* 使用者：「復原直接復原整個世界觀，不需要把刪除的世界觀裡面有什麼列出來」。

   整個復原需要世界觀本身的完整紀錄——名稱、圖示、簡介，還有**整張白板**
   （節點、連線、便條紙）。以前刪世界觀時那一筆直接丟掉，只有文檔與資料夾
   進垃圾桶，白板上的便條紙與連線說明永遠回不來。現在整筆存進 trash.worlds。 */
function worldTrashApp() {
  const app = loadApp([
    "js/state.js", "js/main.js", "js/storage.js", "js/documents.js",
    "js/canvas.js", "js/import-export.js", "js/directory.js", "js/modal.js"
  ]);
  app.run(`
    saveData = function() {}; renderSidebarTree = function() {}; renderBreadcrumb = function() {};
    updateWorldBadge = function() {}; renderTrashList = function() {}; refreshCanvasIfVisible = function() {};
    loadDocToEditor = function() {}; clearEditorWorkspace = function() {}; renderCanvas = function() {};
    confirm = function() { return true; }; alert = function() {};
    appData = {
      worldviews: [
        { id: "w1", name: "主", icon: "🌍", canvas: { nodes: [], edges: [], notes: [] } },
        { id: "wX", name: "龍之谷", icon: "🐉", desc: "巨龍的故鄉", canvas: {
          nodes: [{ id: "node_d1", docId: "d1", x: 1, y: 2 }, { id: "node_d2", docId: "d2", x: 3, y: 4 }],
          edges: [{ id: "e1", source: "node_d1", target: "node_d2", label: "宿敵" }],
          notes: [{ id: "note1", text: "伏筆" }] } }
      ],
      folders: [{ id: "fX", worldId: "wX", parentId: null, name: "巨龍" }],
      docs: [
        { id: "d1", worldId: "wX", folderId: "fX", title: "赤龍", tags: [] },
        { id: "d2", worldId: "wX", folderId: null, title: "龍族語言", tags: [] },
        { id: "keep", worldId: "w1", folderId: null, title: "主世界的", tags: [] }
      ],
      trash: { docs: [{ id: "earlier", worldId: "wX", title: "早就刪掉的", deletedTs: 1 }], folders: [], canvas: [] }
    };
    activeWorldId = "w1";
  `);
  return app;
}

test("刪世界觀：整筆（含白板）存進 trash.worlds，白板節點不另外拆進垃圾桶", function() {
  const app = worldTrashApp();
  app.run(`deleteWorldById("wX")`);
  const t = host(app.run("appData.trash"));
  assert.strictEqual(t.worlds.length, 1);
  const rec = t.worlds[0];
  assert.deepStrictEqual([rec.id, rec.name, rec.icon, rec.desc], ["wX", "龍之谷", "🐉", "巨龍的故鄉"]);
  assert.deepStrictEqual(rec.canvas.nodes.map(function(n) { return n.id; }), ["node_d1", "node_d2"],
    "白板要整張存下來 —— 以前便條紙與連線說明刪了就回不來");
  assert.strictEqual(rec.canvas.edges[0].label, "宿敵");
  assert.strictEqual(rec.canvas.notes[0].text, "伏筆");
  assert.ok(typeof rec.deletedTs === "number");

  assert.strictEqual((t.canvas || []).length, 0,
    "節點已經在整筆紀錄裡了，不要再拆一份進垃圾桶（復原時會變成兩份）");

  const withWorld = t.docs.filter(function(d) { return d.trashedWithWorld === "wX"; }).map(function(d) { return d.id; }).sort();
  assert.deepStrictEqual(withWorld, ["d1", "d2"], "隨世界觀一起進來的要標記");
  assert.ok(!t.docs.find(function(d) { return d.id === "earlier"; }).trashedWithWorld,
    "之前就刪掉的不是「隨世界觀一起」的，不能標");
  assert.strictEqual(t.folders[0].trashedWithWorld, "wX");
});

test("復原世界觀：世界觀、白板、當時裡面的東西全部回來；之前就刪掉的留在垃圾桶", function() {
  const app = worldTrashApp();
  app.run(`deleteWorldById("wX"); restoreWorldFromTrash("wX");`);
  const r = host(app.run(`({
    world: appData.worldviews.find(function(w) { return w.id === "wX"; }),
    docs: appData.docs.filter(function(d) { return d.worldId === "wX"; }).map(function(d) { return d; }),
    folders: appData.folders.filter(function(f) { return f.worldId === "wX"; }),
    trash: appData.trash
  })`));
  assert.ok(r.world, "世界觀要回來");
  assert.deepStrictEqual([r.world.name, r.world.icon, r.world.desc], ["龍之谷", "🐉", "巨龍的故鄉"]);
  assert.strictEqual(r.world.canvas.nodes.length, 2, "白板節點回來");
  assert.strictEqual(r.world.canvas.edges[0].label, "宿敵", "連線說明回來");
  assert.strictEqual(r.world.canvas.notes[0].text, "伏筆", "便條紙回來");
  assert.ok(!("deletedAt" in r.world) && !("deletedTs" in r.world), "刪除時間要拿掉");

  assert.deepStrictEqual(r.docs.map(function(d) { return d.id; }).sort(), ["d1", "d2"]);
  assert.strictEqual(r.docs.find(function(d) { return d.id === "d1"; }).folderId, "fX", "資料夾關係不變");
  r.docs.concat(r.folders).forEach(function(x) {
    ["deletedAt", "deletedTs", "trashedWithWorld", "fromWorldName", "fromWorldIcon"].forEach(function(k) {
      assert.ok(!(k in x), x.id + " 身上不該還留著 " + k);
    });
  });

  assert.strictEqual(r.trash.worlds.length, 0, "紀錄要從垃圾桶拿掉");
  assert.deepStrictEqual(r.trash.docs.map(function(d) { return d.id; }), ["earlier"],
    "刪世界觀之前就刪掉的，復原世界觀時不該跟著復活 —— 那是使用者本來就丟掉的");
});

test("復原舊資料（刪的時候還沒有 trash.worlds）：用蓋上去的名字重建，裡面的全部回來", function() {
  const app = worldTrashApp();
  app.run(`
    appData.trash.docs = [
      { id: "o1", worldId: "gone", title: "舊的一篇", fromWorldName: "廢墟", fromWorldIcon: "🏚️", deletedTs: 5 },
      { id: "o2", worldId: "gone", title: "舊的兩篇", deletedTs: 5 }
    ];
    restoreWorldFromTrash("gone");
  `);
  const w = host(app.run(`appData.worldviews.find(function(w) { return w.id === "gone"; })`));
  assert.deepStrictEqual([w.name, w.icon], ["廢墟", "🏚️"]);
  assert.deepStrictEqual(w.canvas, { nodes: [], edges: [], notes: [] }, "白板沒有存下來，就給一張空的");
  assert.strictEqual(app.run(`appData.docs.filter(function(d) { return d.worldId === "gone"; }).length`), 2);
  assert.strictEqual(app.run(`appData.trash.docs.length`), 0);
});

test("永久刪除世界觀：紀錄與屬於它的全部一起清掉，別的不動", function() {
  const app = worldTrashApp();
  app.run(`deleteWorldById("wX"); permanentlyDeleteTrashWorld("wX");`);
  const t = host(app.run("appData.trash"));
  assert.strictEqual(t.worlds.length, 0);
  assert.strictEqual(t.docs.filter(function(d) { return d.worldId === "wX"; }).length, 0,
    "包含之前就刪掉的 —— 世界觀都永久刪了，它們再也沒有地方可以回去");
  assert.strictEqual(t.folders.length, 0);
});

test("垃圾桶：刪掉的世界觀只列一列，不列裡面的東西", function() {
  const app = worldTrashApp();
  app.run(`deleteWorldById("wX")`);
  const groups = host(app.run(`trashGroups(appData.trash.folders, appData.trash.docs,
    (appData.trash.canvas || []).map(function(item, index) { return { item: item, index: index }; }),
    appData.trash.worlds)`));
  const gone = groups.filter(function(g) { return g.deleted; });
  assert.strictEqual(gone.length, 1);
  assert.strictEqual(gone[0].name, "龍之谷", "名字從整筆紀錄拿");
  assert.strictEqual(gone[0].restoreCount, 3, "會一起回來的：d1、d2、資料夾 fX（不含之前就刪掉的 earlier）");

  const body = codeOnly(bodyOf(modalJs, "renderTrashList"));
  assert.match(body, /restoreWorldFromTrash\(g\.worldId\)/, "那一列的「復原」是整個世界觀");
  assert.match(body, /permanentlyDeleteTrashWorld\(g\.worldId\)/, "「永久刪除」也是整個世界觀");
  assert.ok(!/rowsFor\(g\.folders, g\.docs, g\.canvas\);\s*\}\);\s*\/\/ 上面有/.test(body),
    "刪掉的世界觀不要再把裡面的東西一筆一筆列出來");
});

test("沒有任何文檔的世界觀刪掉之後，垃圾桶裡也看得到、也復原得回來", function() {
  /* 以前世界觀本身不進垃圾桶，空的世界觀刪掉就什麼都沒留下。 */
  const app = worldTrashApp();
  app.run(`
    appData.worldviews.push({ id: "empty", name: "空的", icon: "🫙", canvas: { nodes: [], edges: [], notes: [{ id: "n", text: "只有一張便條紙" }] } });
    deleteWorldById("empty");
  `);
  const groups = host(app.run(`trashGroups([], [], [], appData.trash.worlds)`));
  assert.ok(groups.some(function(g) { return g.deleted && g.name === "空的"; }));
  app.run(`restoreWorldFromTrash("empty")`);
  assert.strictEqual(app.run(`appData.worldviews.find(function(w) { return w.id === "empty"; }).canvas.notes[0].text`),
    "只有一張便條紙");
});

test("trash.worlds：60 天自動清除、匯入備份都有管到", function() {
  /* trash 底下每加一種東西，這兩個地方都要跟著加——跟合併是同一個教訓
     （trash.canvas 就是「後來加的、有地方沒跟著改」才出事）。 */
  const storage = fs.readFileSync(path.join(ROOT, "js", "storage.js"), "utf8");
  assert.match(storage, /\["docs", "folders", "canvas", "worlds"\]\.forEach/,
    "過期清除要掃 trash.worlds，不然刪掉的世界觀永遠佔著空間");

  const app = loadApp();
  const data = {
    worldviews: [{ id: "w1", name: "主" }],
    folders: [], docs: [],
    trash: { docs: [], folders: [], canvas: [], worlds: [
      { id: "wX", name: "龍之谷", icon: "🐉", canvas: { notes: [{ id: "n", text: "伏筆" }] }, deletedAt: "2026-09-01 10:00", deletedTs: 123 },
      { name: "沒有 id 的壞資料" },
      "不是物件"
    ] }
  };
  const clean = host(app.normalizeImportedDatabase(data));
  assert.strictEqual(clean.trash.worlds.length, 1, "壞掉的要丟掉，好的要留著");
  const w = clean.trash.worlds[0];
  assert.deepStrictEqual([w.id, w.name, w.deletedTs], ["wX", "龍之谷", 123], "刪除時間要補回去（過期清除靠它）");
  assert.deepStrictEqual(w.canvas.notes, [{ id: "n", text: "伏筆" }], "白板要帶過來");
  assert.deepStrictEqual(w.canvas.nodes, [], "缺的欄位補成空陣列（跟現有的世界觀過同一道整理）");
});

test("垃圾桶：「現有的世界觀」上面有一條線", function() {
  /* 使用者要的：把它跟上面「刪除的世界觀」那一區隔開。第一個區塊上面是
     說明文字，不需要線，所以用 :not(:first-child)。 */
  assert.match(css, /\.trash-section-title:not\(:first-child\)\s*\{[^}]*border-top:\s*1px solid/,
    "第二個以後的區塊標題要有上邊線");
  const body = codeOnly(bodyOf(modalJs, "renderTrashList"));
  assert.match(body, /heading\("現有的世界觀", "trash-section-title"\)/,
    "「現有的世界觀」要用區塊標題的樣式，那條線才套得上");
});

test("垃圾桶：刪掉的世界觀，項數放在第二行、用補充說明的小字", function() {
  /* 原本接在名稱後面（「龍之谷 · 4 項」），手機上一行放不下，被截成「· 1…」。 */
  const body = codeOnly(bodyOf(modalJs, "renderTrashList"));
  assert.match(body, /g\.restoreCount \? g\.restoreCount \+ " 項" : ""\)/,
    "項數要當成第二行（createTrashRow 的 sub）傳進去，不是接在名稱後面");
  assert.ok(!/"　·　" \+ g\.restoreCount/.test(body), "不要再接在名稱後面");

  const row = codeOnly(bodyOf(modalJs, "createTrashRow"));
  assert.match(row, /subSpan\.className = "trash-item-sub"/);
  assert.match(row, /subSpan\.textContent = second/, "用 textContent");

  const rule = css.match(/\.trash-item-sub\s*\{[^}]*\}/);
  assert.ok(rule, "要有 .trash-item-sub");
  assert.match(rule[0], /font-size:\s*var\(--fs-10\)/, "補充說明的字級，跟刪除時間同一級");
  assert.match(css, /\.trash-item-text\s*\{[^}]*min-width:\s*0/,
    "包起來那一欄要 min-width: 0，不然名稱的省略號不會生效");
});

test("垃圾桶：每一列的刪除時間都在第二行，不再擠在名稱右邊", function() {
  /* 使用者：「時間也放在第二行，其他刪掉的檔案也一樣」。以前時間是名稱右邊
     的一欄，加上兩顆按鈕，手機上名稱只剩幾個字的寬度。 */
  const row = codeOnly(bodyOf(modalJs, "createTrashRow"));
  assert.match(row, /const second = \[sub, deletedAt\]\.filter\(Boolean\)\.join\("　·　"\);/,
    "第二行＝（項數）· 刪除時間；項數在前");
  assert.ok(!/trash-item-meta/.test(row), "不要再有名稱右邊那一欄時間");
  assert.ok(!/row\.appendChild\(metaSpan\)/.test(row));
  assert.ok(!/\.trash-item-meta\s*\{/.test(css), "用不到的樣式一起拿掉");
});

test("垃圾桶：第二行的內容（實際畫出來）", function() {
  const app = loadApp(["js/state.js", "js/main.js", "js/storage.js", "js/documents.js",
                       "js/canvas.js", "js/import-export.js", "js/directory.js", "js/modal.js"]);
  /* 沙箱的 createElement 是空殼，自己做一個會記住子節點的版本來看結構。 */
  const out = host(app.run(`(function() {
    document.createElement = function(tag) {
      return { tag: tag, className: "", textContent: "", style: {}, children: [],
               appendChild: function(c) { this.children.push(c); } };
    };
    function texts(row) {
      var box = row.children[1];
      return box.children.length ? box.children.map(function(c) { return c.className + "=" + c.textContent; })
                                 : [box.className + "=" + box.textContent];
    }
    return {
      doc: texts(createTrashRow("📄", "赤龍", "2026-09-24 16:42", null, null)),
      world: texts(createTrashRow("🐉", "龍之谷", "2026-09-24 16:42", null, null, "4 項")),
      bare: texts(createTrashRow("📄", "沒記時間的舊資料", "", null, null)),
      children: createTrashRow("📄", "x", "t", null, null).children.map(function(c) { return c.className; })
    };
  })()`));
  assert.deepStrictEqual(out.doc, ["trash-item-name=赤龍", "trash-item-sub=2026-09-24 16:42"]);
  assert.deepStrictEqual(out.world, ["trash-item-name=龍之谷", "trash-item-sub=4 項　·　2026-09-24 16:42"]);
  assert.deepStrictEqual(out.bare, ["trash-item-name=沒記時間的舊資料"], "沒有時間就不留一行空白");
  assert.deepStrictEqual(out.children, ["trash-item-icon", "trash-item-text", "trash-item-actions"],
    "一列就是：圖示、兩行文字、按鈕");
});

/* ---------- 因為刪文檔而進垃圾桶的節點，跟著文檔走 ---------- */

/* 使用者：「如果是因為刪除掉文檔所以刪除的節點，直接跟著文檔本身，不用獨立
   出來」。以前這種節點在垃圾桶裡是獨立的一列「（隨文檔一起刪除的白板節點）」，
   復原文檔之後還要另外去復原它，不然白板上那篇就不見了。 */
function nodeFollowApp() {
  const app = loadApp([
    "js/state.js", "js/main.js", "js/storage.js", "js/documents.js",
    "js/canvas.js", "js/import-export.js", "js/directory.js", "js/modal.js"
  ]);
  app.run(`
    saveData = function() {}; renderSidebarTree = function() {}; renderBreadcrumb = function() {};
    renderTrashList = function() {}; refreshCanvasIfVisible = function() {};
    confirm = function() { return true; }; var __alerts = []; alert = function(m) { __alerts.push(m); };
    appData = {
      worldviews: [{ id: "w1", name: "主", canvas: {
        nodes: [{ id: "node_d1", docId: "d1", x: 0, y: 0 }, { id: "node_d2", docId: "d2", x: 300, y: 0 }],
        edges: [{ id: "e1", source: "node_d1", target: "node_d2", label: "宿敵" }], notes: [] } }],
      folders: [],
      docs: [{ id: "d1", worldId: "w1", folderId: null, title: "團長", tags: [] },
             { id: "d2", worldId: "w1", folderId: null, title: "遊俠", tags: [] }],
      trash: { docs: [], folders: [], canvas: [] }
    };
    activeWorldId = "w1";
    function __kill(id) { var d = appData.docs.find(function(x) { return x.id === id; });
      appData.docs = appData.docs.filter(function(x) { return x.id !== id; }); moveDocsToTrash([d]); }
  `);
  return app;
}

test("刪文檔時拆出來的節點，標記它跟著哪一篇", function() {
  const app = nodeFollowApp();
  app.run(`__kill("d1")`);
  const e = host(app.run(`appData.trash.canvas[0]`));
  assert.strictEqual(e.kind, "node");
  assert.strictEqual(e.withDoc, "d1");
  assert.strictEqual(app.run(`canvasTrashFollowsDoc(appData.trash.canvas[0])`), "d1");
});

test("舊資料沒有標記：用「隨文檔一起刪除」那個標籤認得出來", function() {
  const app = nodeFollowApp();
  assert.strictEqual(app.run(`canvasTrashFollowsDoc({ kind: "node", label: "（隨文檔一起刪除的白板節點）", node: { id: "n", docId: "dz" } })`), "dz");
  assert.strictEqual(app.run(`canvasTrashFollowsDoc({ kind: "node", label: "使用者自己刪的", node: { id: "n", docId: "dz" } })`), null,
    "使用者在白板上自己刪的節點不跟著文檔，照舊獨立一列");
  assert.strictEqual(app.run(`canvasTrashFollowsDoc({ kind: "note", withDoc: "dz", note: { id: "n" } })`), null,
    "只有節點會跟著文檔");
});

test("文檔搬到別的世界觀時留下的節點不跟著文檔", function() {
  /* 那篇文檔沒有被刪，還活在另一個世界觀。如果標成跟著它，之後它在新的
     世界觀被刪、再復原時，會把舊世界觀的節點也一起帶回舊白板——指著一篇
     已經不屬於那裡的文檔。 */
  const body = codeOnly(bodyOf(directoryJs, "moveItemInto"));
  assert.match(body, /trashOrphanNodesForDocs\(leavingDocIds, "（文檔搬到別的世界觀時留下的白板節點）", false\)/);
});

test("復原文檔：它的節點與連線一起回到白板，垃圾桶裡不留", function() {
  const app = nodeFollowApp();
  app.run(`__kill("d1"); restoreDocFromTrash("d1");`);
  const r = host(app.run(`({ nodes: appData.worldviews[0].canvas.nodes.map(function(n) { return n.id; }).sort(),
    edges: appData.worldviews[0].canvas.edges.map(function(e) { return e.label; }),
    trash: appData.trash.canvas.length, alerts: __alerts })`));
  assert.deepStrictEqual(r.nodes, ["node_d1", "node_d2"], "節點要跟著回來");
  assert.deepStrictEqual(r.edges, ["宿敵"], "連線說明也回來");
  assert.strictEqual(r.trash, 0, "垃圾桶裡不留一筆孤零零的節點");
  assert.deepStrictEqual(r.alerts, [], "跟著回來的過程不要跳任何提示");
});

test("永久刪除文檔：它的節點一起刪掉", function() {
  const app = nodeFollowApp();
  app.run(`__kill("d1"); permanentlyDeleteTrashDoc("d1");`);
  assert.strictEqual(app.run(`appData.trash.canvas.length`), 0,
    "不然垃圾桶裡會剩一筆再也復原不了的節點（它的文檔已經永久刪了）");
});

test("垃圾桶清單：文檔還在垃圾桶時，跟著它的節點不獨立列出", function() {
  const body = codeOnly(bodyOf(modalJs, "renderTrashList"));
  assert.match(body, /canvasTrashFollowsDoc\(/, "要看每一筆是不是跟著某篇文檔");
  assert.match(body, /trashedDocIds\.has\(/,
    "只有那篇文檔還在垃圾桶時才藏 —— 文檔不在了（例如早就被清掉），節點要能被看見");
});

test("跟著文檔復原節點：好幾顆時一顆都不漏（從後往前做）", function() {
  /* 舊資料裡同一篇文檔可能在兩個世界觀的白板上各有一顆節點，刪它時會拆出
     相鄰的兩筆。restoreCanvasTrashItem 每復原一筆就把它從陣列裡拿掉——從前
     往後做的話，第二筆會往前遞補到剛剛那個位置，然後被跳過。 */
  const app = nodeFollowApp();
  app.run(`
    appData.worldviews.push({ id: "w2", name: "外傳", canvas: { nodes: [{ id: "node_d1_w2", docId: "d1", x: 0, y: 0 }], edges: [], notes: [] } });
    __kill("d1");
  `);
  assert.strictEqual(app.run(`appData.trash.canvas.length`), 2, "兩個世界觀各拆出一筆");
  app.run(`restoreDocFromTrash("d1")`);
  assert.strictEqual(app.run(`appData.trash.canvas.length`), 0, "兩筆都要回去，不能漏掉第二筆");
  assert.strictEqual(app.run(`appData.worldviews[1].canvas.nodes.length`), 1);
});

test("跟著文檔復原節點：放不回去的安靜地留著，不跳提示", function() {
  /* 例如節點所屬的世界觀已經不在了。一般的「復原」會跳提示告訴使用者為什麼
     不行；跟著文檔一起復原時，使用者按的是「復原文檔」、文檔也確實回來了，
     跳一個關於節點的警告只會讓人以為文檔沒復原成功。 */
  const app = nodeFollowApp();
  app.run(`
    __kill("d1");
    appData.trash.canvas[0].worldId = "不存在的世界觀";
    restoreDocFromTrash("d1");
  `);
  assert.deepStrictEqual(host(app.run("__alerts")), [], "不跳提示");
  assert.strictEqual(app.run(`appData.trash.canvas.length`), 1,
    "放不回去就留在垃圾桶——文檔已經不在垃圾桶了，所以它會變成獨立一列，看得到");
  assert.ok(app.run(`appData.docs.some(function(d) { return d.id === "d1"; })`), "文檔本身要回來");
});

/* ==========================================================
   世界觀的排序與最愛
   ========================================================== */

function sortApp() {
  return loadApp([
    "js/state.js", "js/main.js", "js/storage.js", "js/documents.js",
    "js/canvas.js", "js/import-export.js", "js/directory.js", "js/modal.js"
  ]);
}

function sortedIds(app, worlds, docs, mode) {
  return host(app.sortWorldviews(worlds, docs || [], mode)).map(function(w) { return w.id; });
}

test("世界觀排序：建立時間新的在上；舊的預設世界觀（讀不出時間）在最下面", function() {
  const app = sortApp();
  const worlds = [{ id: "w_main", name: "主" }, { id: "w_1700000000000", name: "舊" },
                  { id: "w_1800000000000", name: "新" }];
  assert.deepStrictEqual(sortedIds(app, worlds, [], "created"), ["w_1800000000000", "w_1700000000000", "w_main"]);
});

test("世界觀排序：createdAt 優先於 id 裡的時間", function() {
  const app = sortApp();
  const worlds = [{ id: "w_1800000000000", name: "a" },
                  { id: "w_x", name: "b", createdAt: "2030-01-01T00:00:00.000Z" }];
  assert.deepStrictEqual(sortedIds(app, worlds, [], "created"), ["w_x", "w_1800000000000"]);
});

test("世界觀排序：最愛不管哪一種排序都在最上面", function() {
  const app = sortApp();
  const worlds = [{ id: "w_1800000000000", name: "甲" }, { id: "w_1700000000000", name: "乙", starred: true },
                  { id: "w_1600000000000", name: "丙" }, { id: "w_1500000000000", name: "丁", starred: true }];
  ["created", "updated", "name", "custom"].forEach(function(mode) {
    const ids = sortedIds(app, worlds, [], mode);
    assert.deepStrictEqual(ids.slice(0, 2).sort(), ["w_1500000000000", "w_1700000000000"], mode + "：最愛在最上面");
  });
  assert.deepStrictEqual(sortedIds(app, worlds, [], "created"),
    ["w_1700000000000", "w_1500000000000", "w_1800000000000", "w_1600000000000"],
    "最愛那一組裡面也照排序方式排");
});

test("世界觀排序：最近編輯照文檔的更新時間，沒有文檔的排最後", function() {
  const app = sortApp();
  const worlds = [{ id: "w_1800000000000", name: "a" }, { id: "w_1700000000000", name: "b" },
                  { id: "w_1600000000000", name: "c" }];
  const docs = [{ id: "d1", worldId: "w_1700000000000", updatedAt: "2026-09-26 10:00" },
                { id: "d2", worldId: "w_1600000000000", updatedAt: "2026-09-25 10:00" },
                { id: "d3", worldId: "w_1600000000000", updatedAt: "2026-09-26 11:00" }];
  assert.deepStrictEqual(sortedIds(app, worlds, docs, "updated"),
    ["w_1600000000000", "w_1700000000000", "w_1800000000000"]);
});

test("世界觀排序：名稱", function() {
  const app = sortApp();
  const worlds = [{ id: "a", name: "Charlie" }, { id: "b", name: "alpha" }, { id: "c", name: "Bravo" }];
  assert.deepStrictEqual(sortedIds(app, worlds, [], "name"), ["b", "c", "a"]);
});

test("世界觀排序：不動傳進來的陣列", function() {
  const app = sortApp();
  app.run(`var __w = [{ id: "w_1", name: "b" }, { id: "w_2", name: "a" }]; sortWorldviews(__w, [], "name");`);
  assert.deepStrictEqual(host(app.run("__w.map(function(w) { return w.id; })")), ["w_1", "w_2"]);
});

test("自訂排序：還沒拖過時跟建立時間一樣；拖過之後照拖的順序，而且寫進資料（會同步）", function() {
  const app = sortApp();
  app.run(`
    appData = { worldviews: [{ id: "w_1600000000000", name: "舊" }, { id: "w_1700000000000", name: "中" },
                             { id: "w_1800000000000", name: "新" }], folders: [], docs: [],
                trash: { docs: [], folders: [] } };
  `);
  const ids = function() { return host(app.run(`sortWorldviews(appData.worldviews, [], "custom").map(function(w) { return w.id; })`)); };
  assert.deepStrictEqual(ids(), ["w_1800000000000", "w_1700000000000", "w_1600000000000"]);

  // 把「舊」拖到「新」的前面
  assert.strictEqual(app.run(`reorderWorldview("w_1600000000000", "w_1800000000000", false)`), true);
  assert.deepStrictEqual(ids(), ["w_1600000000000", "w_1800000000000", "w_1700000000000"]);
  assert.deepStrictEqual(host(app.run("appData.worldviews.map(function(w) { return w.order; })")), [0, 2, 1],
    "順序存在每個世界觀的 order 上（跟著同步），不是存在陣列的位置");

  // 放在後面
  app.run(`reorderWorldview("w_1600000000000", "w_1700000000000", true)`);
  assert.deepStrictEqual(ids(), ["w_1800000000000", "w_1700000000000", "w_1600000000000"]);

  assert.strictEqual(app.run(`reorderWorldview("w_1600000000000", "w_1600000000000", false)`), false, "拖到自己身上不算");
});

test("新建的世界觀：記下建立時間，而且在建立時間與自訂排序下都在最上面", function() {
  const app = sortApp();
  app.run(`
    appData = { worldviews: [{ id: "w_1600000000000", name: "舊", order: 0 }, { id: "w_1700000000000", name: "中", order: 1 }],
                folders: [], docs: [], trash: { docs: [], folders: [] }, tagSettings: {} };
    selectWorld = function() {};
    var __w = createWorldview("全新", "");
  `);
  const w = host(app.run("__w"));
  assert.ok(!isNaN(Date.parse(w.createdAt)), "記下建立時間");
  ["created", "custom"].forEach(function(mode) {
    const top = host(app.run(`sortWorldviews(appData.worldviews, appData.docs, "${mode}")[0].id`));
    assert.strictEqual(top, w.id, mode + "：新的在最上面");
  });
  assert.ok(!("order" in w), "不用另外記 order：還沒拖過的會用建立時間補位，自然在最上面");
  // 之後再拖別的，新的那個也不會跑掉
  app.run(`reorderWorldview("w_1600000000000", "w_1700000000000", true)`);
  assert.strictEqual(host(app.run(`sortWorldviews(appData.worldviews, appData.docs, "custom")[0].id`)), w.id);
});

test("加星／取消最愛：存在世界觀上，取消時把欄位拿掉", function() {
  const app = sortApp();
  app.run(`
    appData = { worldviews: [{ id: "w1", name: "a" }], folders: [], docs: [], trash: { docs: [], folders: [] } };
    renderWorldRail = function() {}; renderWorldList = function() {};
  `);
  app.run(`toggleWorldStar("w1")`);
  assert.strictEqual(app.run("appData.worldviews[0].starred"), true);
  app.run(`toggleWorldStar("w1")`);
  assert.ok(!app.run(`"starred" in appData.worldviews[0]`), "不要留一個 starred: false（同步時多一個無意義的差異）");
});

test("長按選單有加入／取消最愛", function() {
  const body = bodyOf(modalJs, "buildWorldMenuItems");
  assert.match(body, /world\.starred \? "取消最愛" : "加入最愛"/);
  assert.match(body, /toggleWorldStar\(world\.id\)/);
});

test("側欄、世界觀清單、移動目標清單都用同一個排序", function() {
  ["renderWorldRail", "renderWorldList", "moveTargetOptions"].forEach(function(fn) {
    const body = codeOnly(bodyOf(directoryJs, fn));
    assert.match(body, /sortedWorldviews\(\)\.forEach/, fn + " 要照排序畫");
    assert.ok(!/appData\.worldviews\.forEach/.test(body), fn + " 不要再照陣列原本的順序");
  });
});

test("清單上的星星：點了不可以順便切換世界觀；名稱照舊走 textContent", function() {
  const body = codeOnly(bodyOf(directoryJs, "renderWorldList"));
  assert.match(body, /star\.onclick = function\(e\) \{\s*e\.stopPropagation\(\);\s*toggleWorldStar\(world\.id\);/);
  assert.ok(!/\.innerHTML\s*=(?!\s*""\s*;)/.test(body), "不要把名稱拼進 innerHTML");
  assert.match(html, /id="worldSortSelect"/, "清單上方有排序選單");
});

test("自訂排序才可以拖：長按拖曳與滑鼠拖放都只在自訂模式接上", function() {
  const body = codeOnly(bodyOf(directoryJs, "renderWorldList"));
  assert.match(body, /custom \? worldCardDragHooks\(world\) : undefined/);
  assert.match(body, /if \(custom\) enableWorldCardMouseDrag\(card, world\.id\);/);
});

test("匯入：最愛、順序、建立時間型別不對就拿掉", function() {
  const app = sortApp();
  const ok = host(app.normalizeImportedWorld({ id: "w", name: "a", starred: true, order: 3, createdAt: "2026-01-01T00:00:00Z" }));
  assert.strictEqual(ok.starred, true);
  assert.strictEqual(ok.order, 3);
  assert.strictEqual(ok.createdAt, "2026-01-01T00:00:00Z");
  const bad = host(app.normalizeImportedWorld({ id: "w", name: "a", starred: "yes", order: "1", createdAt: {} }));
  assert.ok(!("starred" in bad) && !("order" in bad) && !("createdAt" in bad));
});

test("排序選單：一半寬、靠右、膠囊形，而且打開清單時不搶焦點", function() {
  const rule = css.match(/\.world-sort-row \.world-sort-select \{[^}]*\}/);
  assert.ok(rule, "選擇器要兩層 —— .form-input 寫在後面，同權重會把圓角蓋回 6px");
  assert.match(rule[0], /width: 50%/);
  assert.match(rule[0], /border-radius: var\(--radius-round\)/);
  assert.match(rule[0], /appearance: none/, "原生下拉在 Chromium 會自己畫外框、圓角不跟著走");
  assert.match(css, /\.world-sort-row \{[^}]*justify-content: flex-end/, "靠右");
  assert.match(html, /id="worldSortSelect"[^>]*data-no-autofocus/,
    "桌機打開清單時不要聚焦它 —— 聚焦之後按上下鍵就改掉排序了");
  assert.match(mainJs, /!n\.hasAttribute\("data-no-autofocus"\)/, "自動聚焦要看這個標記");
});
