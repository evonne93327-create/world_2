/* 表格：內文裡存成 Markdown 表格，用格子視窗編輯，閱讀模式畫成表格。

   解析錯的後果是安靜的：一格裡有 | 就被切成兩格、表格被段首縮排弄壞
   （前面多兩個全形空格就不是表格了）、插入時黏在上一行的字後面。 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { loadApp, host, ROOT } = require("./helpers/load-app.js");

const app = loadApp(["js/state.js", "js/main.js", "js/storage.js", "js/documents.js", "js/doc-table.js"]);
const docsJs = fs.readFileSync(path.join(ROOT, "js", "documents.js"), "utf8");
const modalJs = fs.readFileSync(path.join(ROOT, "js", "modal.js"), "utf8");
const tableJs = fs.readFileSync(path.join(ROOT, "js", "doc-table.js"), "utf8");
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

const T = "| 名稱 | 首領 |\n| --- | --- |\n| 銀月王國 | 艾琳 |";

test("parseTableRow：切格子、去頭尾的 |、\\| 是格子裡的字", function() {
  assert.deepStrictEqual(host(app.parseTableRow("| a | b |")), ["a", "b"]);
  assert.deepStrictEqual(host(app.parseTableRow("a | b")), ["a", "b"]);
  assert.deepStrictEqual(host(app.parseTableRow("| x \\| y | z |")), ["x | y", "z"]);
  assert.deepStrictEqual(host(app.parseTableRow("|  | b |")), ["", "b"], "空格子要留著，欄位才不會錯位");
});

test("分隔線那一列認得出來，不會被當成內容", function() {
  assert.strictEqual(app.isTableSeparatorRow("| --- | :---: |"), true);
  assert.strictEqual(app.isTableSeparatorRow("| a | --- |"), false);
  assert.deepStrictEqual(host(app.tableRowsFromLines(T.split("\n"))), [["名稱", "首領"], ["銀月王國", "艾琳"]]);
});

test("欄數不齊的補齊", function() {
  assert.deepStrictEqual(host(app.tableRowsFromLines(["| a | b | c |", "| 1 |"])), [["a", "b", "c"], ["1", "", ""]]);
});

test("findTableAt：游標在表格裡就找得到整張，範圍剛好是那幾行", function() {
  const text = "前言\n" + T + "\n後記";
  const pos = text.indexOf("艾琳");
  const f = host(app.findTableAt(text, pos));
  assert.ok(f);
  assert.strictEqual(text.slice(f.start, f.end), T);
  assert.strictEqual(f.firstLine, 1);
  assert.strictEqual(app.findTableAt(text, 1), null, "游標在前言那一行就不是");
  assert.strictEqual(app.findTableAt(text, text.length), null);
});

test("tableToMarkdown：| 跳脫、換行變空白、全空的列拿掉、標題列一定留", function() {
  const md = app.tableToMarkdown([["名稱", "說明"], ["a|b", "第一行\n第二行"], ["", "  "]]);
  assert.strictEqual(md, "| 名稱 | 說明 |\n| --- | --- |\n| a\\|b | 第一行 第二行 |");
  assert.strictEqual(app.tableToMarkdown([["", ""]]), "|   |   |\n| --- | --- |", "標題全空也留著");
  assert.strictEqual(app.tableToMarkdown([]), "");
});

test("來回一趟不變：解析再產生，內容一樣", function() {
  const rows = host(app.tableRowsFromLines(T.split("\n")));
  assert.strictEqual(app.tableToMarkdown(rows), T);
  const tricky = [["a|b", "c"], ["\\", "d"]];
  const back = host(app.tableRowsFromLines(app.tableToMarkdown(tricky).split("\n")));
  assert.deepStrictEqual(back, tricky);
});

test("插入：一定自己佔完整的幾行，不會黏在別的字上", function() {
  const md = "| a |\n| --- |";
  let r = host(app.spliceTableIntoText("前面後面", md, null, 2));
  assert.strictEqual(r.text, "前面\n" + md + "\n後面");
  r = host(app.spliceTableIntoText("第一行\n", md, null, 4));
  assert.strictEqual(r.text, "第一行\n" + md, "已經在行首、後面沒字了就不多加換行");
  r = host(app.spliceTableIntoText("", md, null, 0));
  assert.strictEqual(r.text, md);
});

test("改一張既有的表格：只換那一段；刪掉時連它那一行的換行一起拿掉", function() {
  const text = "前言\n" + T + "\n後記";
  const f = host(app.findTableAt(text, text.indexOf("艾琳")));
  const range = { start: f.start, end: f.end };
  let r = host(app.spliceTableIntoText(text, "| x |\n| --- |", range, 0));
  assert.strictEqual(r.text, "前言\n| x |\n| --- |\n後記");
  r = host(app.spliceTableIntoText(text, "", range, 0));
  assert.strictEqual(r.text, "前言\n後記", "不要留一行空的");
});

test("段首縮排不碰表格；表格行按 Enter 不縮排", function() {
  assert.strictEqual(app.shouldIndentLine("| a | b |"), false, "前面多兩個全形空格就不是表格了");
  const out = host(app.indentParagraphsInText("段落\n" + T));
  assert.ok(out.text.endsWith(T), "表格原封不動");
  const enter = docsJs.match(/function handleEditorEnterKey\([\s\S]*?\n}/)[0];
  assert.ok(enter.indexOf("^\\s*\\|/.test(lineText)) return;") < enter.indexOf("e.preventDefault()"),
    "在表格行要在 preventDefault 之前就放手，讓瀏覽器照常換行");
});

/* 沙箱的 DOM 是空殼，這裡換一個會記住子節點的最小版本。 */
app.run(`
  var __mk = function(tag) {
    return { tagName: tag.toUpperCase(), children: [], childNodes: [], className: "", textContent: "", dataset: {},
      set innerHTML(v) { this.children = []; this.childNodes = []; },
      appendChild: function(c) { this.children.push(c); this.childNodes.push(c); return c; } };
  };
  var __text = function(el) {
    return el.children && el.children.length ? el.children.map(__text).join("") : (el.textContent || "");
  };
`);

function readingOf(text) {
  app.run(`
    document.createElement = __mk;
    document.createTextNode = function(t) { return { tagName: "#text", textContent: t }; };
    var __box = __mk("div");
    buildReadingDom(__box, ${JSON.stringify(text)});
  `);
}

test("閱讀模式：表格畫成表格、章節標題變標題、其他照原本的換行", function() {
  readingOf("# 第一章 啟程\n第一段\n第一段第二行\n\n" + T + "\n後記");
  const kinds = host(app.run("__box.children.map(function(c) { return c.tagName + ':' + (c.className || ''); })"));
  assert.deepStrictEqual(kinds, ["H3:reading-heading", "P:reading-para", "DIV:reading-table-wrap", "P:reading-para"]);
  assert.strictEqual(app.run("__text(__box.children[0])"), "第一章 啟程", "# 拿掉");
  const cells = host(app.run(`__box.children[2].children[0].children.map(function(tr) {
    return tr.children.map(function(td) { return td.tagName + ':' + __text(td); }); })`));
  assert.deepStrictEqual(cells, [["TH:名稱", "TH:首領"], ["TD:銀月王國", "TD:艾琳"]]);
  assert.ok(!/innerHTML\s*=\s*[^"]/.test(tableJs.replace(/innerHTML = ""/g, "")), "格子內容不拼 innerHTML");
});

test("閱讀模式：每一行都記得自己在原文的第幾行（雙擊要照這個放游標）", function() {
  readingOf("# 第一章\n甲\n乙\n\n" + T);
  assert.strictEqual(app.run("__box.children[0].dataset.line"), 0);
  const paraLines = host(app.run("__box.children[1].children.filter(function(c) { return c.tagName === 'SPAN'; }).map(function(c) { return c.dataset.line; })"));
  assert.deepStrictEqual(paraLines, [1, 2]);
  const rowLines = host(app.run("__box.children[2].children[0].children.map(function(tr) { return tr.dataset.line; })"));
  assert.deepStrictEqual(rowLines, [4, 6], "分隔線那一行（第 5 行）不算一列，但行號要跳過它");
});

test("行內格式：**粗體**、*斜體*、~~刪除線~~；記得每段在原文的位置", function() {
  const f = function(t) { return host(app.parseInlineFormat(t, 0)).map(function(s) { return s.kind + ":" + s.text + "@" + s.o; }); };
  assert.deepStrictEqual(f("他是**皇帝**的*影子*，~~不是~~"),
    ["text:他是@0", "bold:皇帝@4", "text:的@8", "italic:影子@10", "text:，@13", "strike:不是@16"]);
  assert.deepStrictEqual(f("5 * 3 * 2"), ["text:5 * 3 * 2@0"], "前後是空白的 * 不是斜體");
  assert.deepStrictEqual(f("**沒有結尾"), ["text:**沒有結尾@0"]);
  assert.deepStrictEqual(f("** 不算 **"), ["text:** 不算 **@0"]);
  readingOf("這是**重點**");
  const segs = host(app.run("__box.children[0].children[0].children.map(function(c) { return c.tagName + ':' + c.textContent + '@' + c.dataset.o; })"));
  assert.deepStrictEqual(segs, ["SPAN:這是@0", "STRONG:重點@4"]);
});

test("標題裡的格式位置要加上 # 的長度", function() {
  readingOf("# 第二章 **北境**之戰");
  assert.strictEqual(app.run("__box.children[0].tagName"), "H3");
  const segs = host(app.run("__box.children[0].children.map(function(c) { return c.tagName + ':' + c.textContent + '@' + c.dataset.o; })"));
  assert.deepStrictEqual(segs, ["SPAN:第二章 @2", "STRONG:北境@8", "SPAN:之戰@12"]);
});

test("sourceOffsetOf：第幾行第幾個字 → 在整篇的位置；超出那一行停在行尾", function() {
  const text = "ab\ncdef\ng";
  assert.deepStrictEqual(host(app.sourceOffsetOf(text, 1, 2)), { pos: 5, lineStart: 3, lineEnd: 7 });
  assert.deepStrictEqual(host(app.sourceOffsetOf(text, 1, 99)), { pos: 7, lineStart: 3, lineEnd: 7 });
  assert.deepStrictEqual(host(app.sourceOffsetOf(text, 9, 0)), { pos: 8, lineStart: 8, lineEnd: 9 }, "行號超出就用最後一行");
});

test("雙擊回到編輯：滑鼠 dblclick、手指自己看兩下的間隔；表格點一下要等確定不是雙擊", function() {
  const appJs = fs.readFileSync(path.join(ROOT, "js", "app.js"), "utf8");
  assert.match(appJs, /setupReadingDoubleTap\(\)/, "要接上");
  const setup = tableJs.match(/function setupReadingDoubleTap\(\)[\s\S]*?\n}/)[0];
  assert.match(setup, /addEventListener\("dblclick"/);
  assert.match(setup, /addEventListener\("touchend"/, "iOS 不保證連點兩下會發 dblclick");
  assert.match(setup, /e\.preventDefault\(\);\s*\/\/ 不要再補一個 click/);
  const edit = tableJs.match(/function editFromReadingAt\([\s\S]*?\n}/)[0];
  assert.ok(edit.indexOf("setReadingMode(false)") < edit.indexOf("ta.focus("), "先切回編輯才聚焦得到");
  assert.match(edit, /cancelPendingTableOpen\(\)/, "雙擊的第一下不可以把表格視窗打開");
  const tbl = tableJs.match(/function buildReadingTable\([\s\S]*?\n}/)[0];
  assert.match(tbl, /pendingTableOpen = setTimeout\(/, "表格點一下要延後開視窗");
  assert.match(fs.readFileSync(path.join(ROOT, "style.css"), "utf8"), /\.is-reading \.doc-reading-view \{ touch-action: manipulation; \}/,
    "連點兩下不要被拿去放大畫面");
});

test("接線：選單有表格與閱讀模式；閱讀模式裡跳轉就留在閱讀模式", function() {
  assert.match(html, /onclick="closeDocActionsPanel\(\); openTableEditor\(\);"/);
  assert.match(html, /onclick="closeDocActionsPanel\(\); toggleReadingMode\(\);"/);
  assert.match(html, /<script src="js\/doc-table\.js"><\/script>/);
  /* 使用者回報：在閱讀模式點章節跳轉會直接變回編輯模式。跳過去是要看，不是要改。 */
  const jump = modalJs.match(/function jumpToLine\([\s\S]*?\n}/)[0];
  assert.match(jump, /if \(jumpInReadingView\(lineIndex\)\) return;/, "找得到那一行就留在閱讀模式");
  assert.ok(jump.indexOf("jumpInReadingView(") < jump.indexOf("setReadingMode(false)"),
    "找不到（例如內容是空的）才退回編輯");
  assert.ok(jump.indexOf("setReadingMode(false)") < jump.indexOf("getElementById(\"docContentInput\")"),
    "退回編輯要在碰輸入框之前");
  assert.match(docsJs, /if \(typeof docReadingMode !== "undefined" && docReadingMode\) renderReadingView\(\);/,
    "換文檔（或同步拿到新內容）時閱讀模式要重排");
});

test("閱讀模式裡跳轉：找行號不超過目標的最後一個元素（空行、分隔線沒有自己的元素）", function() {
  app.run(`
    var __els = [0, 2, 3, 5, 7].map(function(l) { return { dataset: { line: String(l) }, id: "L" + l }; });
    document.querySelectorAll = function(sel) { return sel === "#docReadingView [data-line]" ? __els : []; };
  `);
  const at = function(n) { const el = app.run("readingElementForLine(" + n + ")"); return el ? el.id : null; };
  assert.strictEqual(at(3), "L3");
  assert.strictEqual(at(4), "L3", "第 4 行是空行，停在它前面那一行");
  assert.strictEqual(at(6), "L5", "分隔線那一行歸到上一列");
  assert.strictEqual(at(99), "L7");
  app.run(`__els = [];`);
  assert.strictEqual(at(0), null);
  assert.strictEqual(app.run("jumpInReadingView(0)"), false, "找不到就回 false，讓 jumpToLine 退回編輯");
  app.run(`document.querySelectorAll = function() { return []; };`);
});
