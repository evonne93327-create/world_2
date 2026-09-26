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

test("閱讀模式：表格畫成表格、章節標題變標題、其他照原本的換行", function() {
  /* 沙箱的 DOM 是空殼，這裡換一個會記住子節點的最小版本。 */
  app.run(`
    var __mk = function(tag) {
      return { tagName: tag.toUpperCase(), children: [], childNodes: [], className: "", textContent: "",
        set innerHTML(v) { this.children = []; this.childNodes = []; },
        appendChild: function(c) { this.children.push(c); this.childNodes.push(c); return c; } };
    };
    document.createElement = __mk;
    document.createTextNode = function(t) { return { tagName: "#text", textContent: t }; };
    var __box = __mk("div");
    buildReadingDom(__box, "# 第一章 啟程\\n第一段\\n第一段第二行\\n\\n${T.replace(/\n/g, "\\n")}\\n後記");
  `);
  const kinds = host(app.run("__box.children.map(function(c) { return c.tagName + ':' + (c.className || ''); })"));
  assert.deepStrictEqual(kinds, ["H3:reading-heading", "P:reading-para", "DIV:reading-table-wrap", "P:reading-para"]);
  assert.strictEqual(app.run("__box.children[0].textContent"), "第一章 啟程", "# 拿掉");
  const cells = host(app.run(`__box.children[2].children[0].children.map(function(tr) {
    return tr.children.map(function(td) { return td.tagName + ':' + td.textContent; }); })`));
  assert.deepStrictEqual(cells, [["TH:名稱", "TH:首領"], ["TD:銀月王國", "TD:艾琳"]]);
  assert.ok(!/innerHTML\s*=\s*[^"]/.test(tableJs.replace(/innerHTML = ""/g, "")), "格子內容不拼 innerHTML");
});

test("接線：選單有表格與閱讀模式；跳到某一行時先離開閱讀模式", function() {
  assert.match(html, /onclick="closeDocActionsPanel\(\); openTableEditor\(\);"/);
  assert.match(html, /onclick="closeDocActionsPanel\(\); toggleReadingMode\(\);"/);
  assert.match(html, /<script src="js\/doc-table\.js"><\/script>/);
  const jump = modalJs.match(/function jumpToLine\([\s\S]*?\n}/)[0];
  assert.ok(jump.indexOf("setReadingMode(false)") !== -1 &&
    jump.indexOf("setReadingMode(false)") < jump.indexOf("getElementById(\"docContentInput\")"),
    "閱讀模式看不到輸入框，要先切回來");
  assert.match(docsJs, /if \(typeof docReadingMode !== "undefined" && docReadingMode\) renderReadingView\(\);/,
    "換文檔（或同步拿到新內容）時閱讀模式要重排");
});
