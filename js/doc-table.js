/* ==========================================================
   表格 (doc-table.js)

   內文維持純文字，表格存成 Markdown 的樣子：

     | 名稱 | 首領 |
     | --- | --- |
     | 銀月王國 | 艾琳 |

   為什麼不把輸入區換成富文本編輯器：內文是純文字這件事，是標籤、章節目錄、
   快速跳轉（照行號）、段首縮排、復原、同步合併、匯出匯入、以及 iPad 鍵盤
   那一大串修正的共同前提。換掉的話全部要重做（使用者看過三種做法之後選的
   是這一種）。

   - 編輯：「⋯ 更多操作」→「表格」開一個格子視窗。游標停在某張表格裡的時候，
     打開的就是那一張；不在任何表格裡就是新增一張，插在游標那一行。
   - 看：「📖 閱讀模式」把整篇排好給你看，表格就是表格，**粗體**、*斜體*、
     ~~刪除線~~ 也畫出來。點一張表格可以直接開視窗改它；雙擊任何地方回到
     編輯，游標落在點的那個字。

   格子裡的字一律 textContent／input.value，不拼 innerHTML（硬規則 5）。
   ========================================================== */

/* ---------- 純函式：解析與產生 ---------- */

function isTableLine(line) {
  return /^\s*\|/.test(line || "");
}

/* 照沒有被跳脫的 | 切開。開頭、結尾那兩根 | 切出來的空字串丟掉。 */
function parseTableRow(line) {
  const s = String(line || "").trim();
  const cells = [];
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "\\" && s[i + 1] === "|") { cur += "|"; i++; continue; }
    if (ch === "|") { cells.push(cur); cur = ""; continue; }
    cur += ch;
  }
  cells.push(cur);
  if (s[0] === "|") cells.shift();
  if (s.length > 1 && s[s.length - 1] === "|" && s[s.length - 2] !== "\\") cells.pop();
  return cells.map(function(c) { return c.trim(); });
}

function isTableSeparatorRow(line) {
  const cells = parseTableRow(line);
  return cells.length > 0 && cells.every(function(c) { return /^:?-{1,}:?$/.test(c); });
}

/* 一段連續的表格行 → 二維陣列（第一列是標題）。分隔線那一列不算。
   每一列補齊到同樣的欄數，缺的補空字串。 */
function tableRowsFromLines(lines) {
  const rows = [];
  lines.forEach(function(line) {
    if (isTableSeparatorRow(line)) return;
    rows.push(parseTableRow(line));
  });
  const cols = rows.reduce(function(m, r) { return Math.max(m, r.length); }, 0);
  return rows.map(function(r) {
    const out = r.slice();
    while (out.length < cols) out.push("");
    return out;
  });
}

/* 游標在 pos 的時候，它在哪一張表格裡。回傳這張表格在內文裡的範圍
   （start 是第一行的開頭，end 是最後一行的結尾，不含最後那個換行）以及
   解析好的內容；不在表格裡回 null。 */
function findTableAt(text, pos) {
  const v = String(text || "");
  const lines = v.split("\n");
  let offset = 0;
  let lineIndex = -1;
  const starts = [];
  for (let i = 0; i < lines.length; i++) {
    starts.push(offset);
    if (lineIndex === -1 && pos <= offset + lines[i].length) lineIndex = i;
    offset += lines[i].length + 1;
  }
  if (lineIndex === -1) lineIndex = lines.length - 1;
  return tableAtLine(lines, starts, lineIndex);
}

/* 同上，但用行號找（閱讀模式裡點表格時用）。 */
function findTableAtLine(text, lineIndex) {
  const lines = String(text || "").split("\n");
  const starts = [];
  let offset = 0;
  lines.forEach(function(l) { starts.push(offset); offset += l.length + 1; });
  return tableAtLine(lines, starts, lineIndex);
}

function tableAtLine(lines, starts, lineIndex) {
  if (lineIndex < 0 || lineIndex >= lines.length || !isTableLine(lines[lineIndex])) return null;
  let first = lineIndex;
  let last = lineIndex;
  while (first > 0 && isTableLine(lines[first - 1])) first--;
  while (last < lines.length - 1 && isTableLine(lines[last + 1])) last++;
  return {
    start: starts[first],
    end: starts[last] + lines[last].length,
    firstLine: first,
    rows: tableRowsFromLines(lines.slice(first, last + 1))
  };
}

/* 格子內容 → 放進內文的那幾行。| 要跳脫、換行換成空白（一格只能是一行）。
   全空的內文列丟掉；標題列永遠留著（沒有它就不是表格了）。 */
function tableToMarkdown(rows) {
  const cols = (rows || []).reduce(function(m, r) { return Math.max(m, r.length); }, 0);
  if (!cols) return "";
  const clean = function(c) {
    return String(c == null ? "" : c).replace(/\r?\n/g, " ").replace(/\|/g, "\\|").trim();
  };
  const line = function(r) {
    const cells = [];
    for (let i = 0; i < cols; i++) cells.push(clean(r[i]) || " ");
    return "| " + cells.join(" | ") + " |";
  };
  const sep = [];
  for (let i = 0; i < cols; i++) sep.push("---");

  const out = [line(rows[0]), "| " + sep.join(" | ") + " |"];
  rows.slice(1).forEach(function(r) {
    if (r.some(function(c) { return clean(c); })) out.push(line(r));
  });
  return out.join("\n");
}

/* 把 md 放進 text。有 range（改一張既有的表格）就換掉那一段；沒有就插在
   caret 那裡，而且一定自己佔完整的幾行：前面不是行首就先換行，後面不是
   行尾就補一個換行。md 是空字串＝刪掉那張表格（連同它那一行的換行）。
   回傳 { text, caret }。 */
function spliceTableIntoText(text, md, range, caret) {
  const v = String(text || "");
  if (range) {
    if (!md) {
      let s = range.start, e = range.end;
      if (v[e] === "\n") e++;
      else if (s > 0 && v[s - 1] === "\n") s--;
      return { text: v.slice(0, s) + v.slice(e), caret: s };
    }
    return { text: v.slice(0, range.start) + md + v.slice(range.end), caret: range.start + md.length };
  }
  if (!md) return { text: v, caret: caret };
  const at = Math.max(0, Math.min(typeof caret === "number" ? caret : v.length, v.length));
  const before = v.slice(0, at);
  const after = v.slice(at);
  const lead = (at === 0 || before[before.length - 1] === "\n") ? "" : "\n";
  const tail = (after === "" || after[0] === "\n") ? "" : "\n";
  const piece = lead + md + tail;
  return { text: before + piece + after, caret: at + lead.length + md.length };
}

/* ---------- 表格視窗 ---------- */

const TABLE_DEFAULT_ROWS = 3;   // 含標題列
const TABLE_DEFAULT_COLS = 3;

let tableEditState = null;   // { docId, range, rows }

function openTableEditor(atLineIndex) {
  const doc = appData.docs.find(d => d.id === activeDocId);
  if (!doc) return;
  const ta = document.getElementById("docContentInput");
  const text = doc.content || "";

  const found = typeof atLineIndex === "number"
    ? findTableAtLine(text, atLineIndex)
    : findTableAt(text, ta ? ta.selectionStart : text.length);

  let rows;
  if (found && found.rows.length) {
    rows = found.rows.map(function(r) { return r.slice(); });
  } else {
    rows = [];
    for (let r = 0; r < TABLE_DEFAULT_ROWS; r++) {
      const row = [];
      for (let c = 0; c < TABLE_DEFAULT_COLS; c++) row.push("");
      rows.push(row);
    }
  }

  tableEditState = {
    docId: doc.id,
    range: found ? { start: found.start, end: found.end } : null,
    caret: ta ? ta.selectionStart : text.length,
    rows: rows
  };

  const title = document.getElementById("tableEditorTitle");
  if (title) title.textContent = found ? "▦ 編輯表格" : "▦ 插入表格";
  const del = document.getElementById("tableEditorDelete");
  if (del) del.hidden = !found;

  renderTableEditor();
  document.getElementById("tableEditorModal").classList.add("active");
}

function closeTableEditor() {
  document.getElementById("tableEditorModal").classList.remove("active");
  tableEditState = null;
}

/* 先把畫面上格子裡的字收回 state，再改結構（加列、刪欄…），不然剛打的字會
   在重畫時不見。 */
function collectTableEditorInputs() {
  const st = tableEditState;
  if (!st) return;
  document.querySelectorAll("#tableEditorGrid input[data-r]").forEach(function(input) {
    const r = Number(input.dataset.r), c = Number(input.dataset.c);
    if (st.rows[r]) st.rows[r][c] = input.value;
  });
}

function renderTableEditor() {
  const st = tableEditState;
  const grid = document.getElementById("tableEditorGrid");
  if (!st || !grid) return;
  grid.innerHTML = "";

  const table = document.createElement("table");
  table.className = "table-editor";
  const cols = st.rows[0] ? st.rows[0].length : 0;

  // 最上面一排：刪欄
  const ctl = document.createElement("tr");
  for (let c = 0; c < cols; c++) {
    const th = document.createElement("td");
    th.className = "table-editor-ctl";
    if (cols > 1) th.appendChild(tableEditorBtn("✕", "刪除這一欄", function() { removeTableColumn(c); }));
    ctl.appendChild(th);
  }
  ctl.appendChild(document.createElement("td"));
  table.appendChild(ctl);

  st.rows.forEach(function(row, r) {
    const tr = document.createElement("tr");
    if (r === 0) tr.className = "is-header";
    row.forEach(function(cell, c) {
      const td = document.createElement("td");
      const input = document.createElement("input");
      input.type = "text";
      input.className = "table-editor-cell";
      input.value = cell;
      input.placeholder = r === 0 ? "標題" : "";
      input.dataset.r = r;
      input.dataset.c = c;
      td.appendChild(input);
      tr.appendChild(td);
    });
    const tail = document.createElement("td");
    tail.className = "table-editor-ctl";
    if (r > 0 && st.rows.length > 2) tail.appendChild(tableEditorBtn("✕", "刪除這一列", function() { removeTableRow(r); }));
    tr.appendChild(tail);
    table.appendChild(tr);
  });

  grid.appendChild(table);
}

function tableEditorBtn(text, title, onClick) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "table-editor-x";
  b.textContent = text;
  b.title = title;
  b.onclick = onClick;
  return b;
}

function addTableRow() {
  collectTableEditorInputs();
  const st = tableEditState;
  if (!st) return;
  st.rows.push(st.rows[0].map(function() { return ""; }));
  renderTableEditor();
}

function addTableColumn() {
  collectTableEditorInputs();
  const st = tableEditState;
  if (!st) return;
  st.rows.forEach(function(r) { r.push(""); });
  renderTableEditor();
}

function removeTableRow(r) {
  collectTableEditorInputs();
  const st = tableEditState;
  if (!st || r <= 0 || st.rows.length <= 2) return;
  st.rows.splice(r, 1);
  renderTableEditor();
}

function removeTableColumn(c) {
  collectTableEditorInputs();
  const st = tableEditState;
  if (!st || st.rows[0].length <= 1) return;
  st.rows.forEach(function(r) { r.splice(c, 1); });
  renderTableEditor();
}

function confirmTableEditor() {
  collectTableEditorInputs();
  applyTableEdit(tableToMarkdown(tableEditState ? tableEditState.rows : []));
}

function deleteTableFromEditor() {
  if (!tableEditState || !tableEditState.range) return;
  if (!confirm("確定要刪除這張表格嗎？（刪了之後可以按「復原」救回來）")) return;
  applyTableEdit("");
}

/* 寫回內文。走跟打字一樣的出口（onContentChange）：存檔、字數、標籤、
   復原紀錄都在那條路上。 */
function applyTableEdit(md) {
  const st = tableEditState;
  if (!st) return;
  const doc = appData.docs.find(d => d.id === st.docId);
  const ta = document.getElementById("docContentInput");
  closeTableEditor();
  if (!doc || !ta || doc.id !== activeDocId) return;

  const res = spliceTableIntoText(ta.value, md, st.range, st.caret);
  if (res.text === ta.value) return;
  ta.value = res.text;
  try { ta.setSelectionRange(res.caret, res.caret); } catch (e) { /* 沒掛上就算了 */ }
  onContentChange();
  if (docReadingMode) renderReadingView();
  if (typeof showDocToolHint === "function") showDocToolHint(md ? "表格已更新" : "表格已刪除");
}

/* ---------- 閱讀模式 ----------

   整篇排好給你看：章節標題放大、表格畫成表格、其餘保留原本的換行。
   只是「看」，要改字切回編輯（表格可以直接點開來改）。
   狀態只在這一次開著的期間有效，重新整理就回到編輯——不然下次打開 app 時
   找不到輸入框，會以為壞了。 */
let docReadingMode = false;

function toggleReadingMode() {
  setReadingMode(!docReadingMode);
}

function setReadingMode(on) {
  docReadingMode = !!on;
  const wrap = document.querySelector(".content-editor-wrap");
  if (wrap) wrap.classList.toggle("is-reading", docReadingMode);
  const label = document.getElementById("readingModeLabel");
  if (label) label.textContent = docReadingMode ? "回到編輯" : "閱讀模式";
  const icon = document.getElementById("readingModeIcon");
  if (icon) icon.textContent = docReadingMode ? "✏️" : "📖";
  if (docReadingMode) {
    renderReadingView();
    if (typeof showDocToolHint === "function") showDocToolHint("雙擊任何地方就回到編輯");
  } else {
    cancelPendingTableOpen();
    const view = document.getElementById("docReadingView");
    if (view) view.innerHTML = "";
  }
}

function renderReadingView() {
  const view = document.getElementById("docReadingView");
  if (!view) return;
  const doc = appData.docs.find(d => d.id === activeDocId);
  buildReadingDom(view, doc ? (doc.content || "") : "");
}

/* ---------- 行內格式：**粗體**、*斜體*、~~刪除線~~ ----------

   只在閱讀模式裡畫出來；編輯時輸入框是純文字，看得到符號本身（輸入框沒辦法
   混排粗細不同的字，高亮層也會跟字錯開）。

   符號裡面緊貼著的第一個、最後一個字不能是空白，也不能是符號本身：
   「5 * 3 * 2」不是斜體，「** 不算 **」也不會變成斜體的「* 不算 *」。
   不做巢狀（**粗*斜*體** 會照最外層的粗體畫，裡面的 * 原樣留著）。 */
const INLINE_FORMAT_REGEX = /\*\*([^\s*](?:.*?[^\s*])?)\*\*|~~([^\s~](?:.*?[^\s~])?)~~|\*([^\s*](?:[^*]*?[^\s*])?)\*/g;

/* 純函式：切成一段一段。每段記下它在「原本那一行」裡從第幾個字開始
   （o，符號之後的位置）——雙擊時要照這個把游標放回原文。 */
function parseInlineFormat(text, baseOffset) {
  const src = String(text || "");
  const base = baseOffset || 0;
  const out = [];
  let last = 0;
  let m;
  INLINE_FORMAT_REGEX.lastIndex = 0;
  while ((m = INLINE_FORMAT_REGEX.exec(src))) {
    if (m.index > last) out.push({ kind: "text", text: src.slice(last, m.index), o: base + last });
    if (m[1] !== undefined) out.push({ kind: "bold", text: m[1], o: base + m.index + 2 });
    else if (m[2] !== undefined) out.push({ kind: "strike", text: m[2], o: base + m.index + 2 });
    else out.push({ kind: "italic", text: m[3], o: base + m.index + 1 });
    last = m.index + m[0].length;
  }
  if (last < src.length) out.push({ kind: "text", text: src.slice(last), o: base + last });
  return out;
}

const INLINE_TAG = { text: "span", bold: "strong", italic: "em", strike: "s" };

function appendInline(parent, text, baseOffset) {
  parseInlineFormat(text, baseOffset).forEach(function(seg) {
    const el = document.createElement(INLINE_TAG[seg.kind]);
    el.textContent = seg.text;
    el.dataset.o = seg.o;
    parent.appendChild(el);
  });
}

/* ---------- 小標題與列點 ----------

   「## 小標題」「### 更小的標題」：比章節（「# 」）小一級。不進章節快速跳轉——
   那一排按鈕是給章節用的，小標題也放進去會太多。
   「- 列點」「* 列點」：前面每空兩格（或一個全形空格、一個 tab）就是下一層。
   「*斜體*」開頭沒有空格，不會被當成列點。 */
const SUBHEADING_REGEX = /^(#{2,6})\s+(.*)$/;
const LIST_ITEM_REGEX = /^([ \t\u3000]*)[-*]\s+(.*)$/;

function listItemOf(line) {
  const m = LIST_ITEM_REGEX.exec(line || "");
  if (!m) return null;
  let width = 0;
  for (const ch of m[1]) width += (ch === " ") ? 1 : 2;   // 全形空格、tab 都當兩格
  return { level: Math.min(Math.floor(width / 2), 5), text: m[2], textStart: line.length - m[2].length };
}

/* 純 DOM 組裝，不拼 innerHTML。拆出來是為了測試：餵一個容器進去就能看結果。
   每一行（段落裡的一行、標題、表格的一列）都掛 data-line＝它在原文的第幾行，
   雙擊回到編輯時才知道要把游標放哪。 */
function buildReadingDom(container, text) {
  container.innerHTML = "";
  const lines = String(text || "").split("\n");
  let i = 0;
  let para = null;
  let list = null;

  function flushPara() {
    if (para) { container.appendChild(para); para = null; }
    if (list) { container.appendChild(list); list = null; }
  }

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (isTableLine(line)) {
      flushPara();
      const first = i;
      const block = [];
      const rowLines = [];
      while (i < lines.length && isTableLine(lines[i])) {
        if (!isTableSeparatorRow(lines[i])) rowLines.push(i);
        block.push(lines[i]);
        i++;
      }
      container.appendChild(buildReadingTable(tableRowsFromLines(block), first, rowLines));
      continue;
    }

    if (trimmed && typeof isChapterHeadingLine === "function" && isChapterHeadingLine(trimmed)) {
      flushPara();
      const h = document.createElement("h3");
      h.className = "reading-heading";
      h.dataset.line = i;
      const shown = trimmed.replace(/^#+\s*/, "");
      appendInline(h, shown, line.indexOf(shown));
      container.appendChild(h);
      i++;
      continue;
    }

    const sub = SUBHEADING_REGEX.exec(trimmed);
    if (sub) {
      flushPara();
      const h = document.createElement(sub[1].length === 2 ? "h4" : "h5");
      h.className = "reading-subheading";
      h.dataset.line = i;
      appendInline(h, sub[2], line.length - sub[2].length);
      container.appendChild(h);
      i++;
      continue;
    }

    const item = listItemOf(line);
    if (item) {
      if (para) { container.appendChild(para); para = null; }
      if (!list) {
        list = document.createElement("ul");
        list.className = "reading-list";
      }
      const li = document.createElement("li");
      li.dataset.line = i;
      li.dataset.level = item.level;
      appendInline(li, item.text, item.textStart);
      list.appendChild(li);
      i++;
      continue;
    }
    if (list) { container.appendChild(list); list = null; }

    if (!trimmed) { flushPara(); i++; continue; }

    if (!para) {
      para = document.createElement("p");
      para.className = "reading-para";
    } else {
      para.appendChild(document.createElement("br"));
    }
    const span = document.createElement("span");
    span.className = "reading-line";
    span.dataset.line = i;
    appendInline(span, line, 0);
    para.appendChild(span);
    i++;
  }
  flushPara();

  if (!container.childNodes.length) {
    const empty = document.createElement("p");
    empty.className = "reading-empty";
    empty.dataset.line = 0;
    empty.textContent = "這篇還沒有內容（雙擊開始寫）";
    container.appendChild(empty);
  }
}

/* 點一下表格＝開表格視窗；但雙擊＝回到編輯。第一下先等一下，確定沒有第二下
   才開視窗，不然雙擊時第一下就把視窗打開了。 */
const READING_DOUBLE_TAP_MS = 300;
let pendingTableOpen = null;

function cancelPendingTableOpen() {
  if (pendingTableOpen) { clearTimeout(pendingTableOpen); pendingTableOpen = null; }
}

function buildReadingTable(rows, firstLine, rowLines) {
  const wrap = document.createElement("div");
  wrap.className = "reading-table-wrap";
  wrap.dataset.line = firstLine;
  wrap.title = "點一下編輯這張表格，雙擊回到編輯模式";
  wrap.onclick = function() {
    cancelPendingTableOpen();
    pendingTableOpen = setTimeout(function() {
      pendingTableOpen = null;
      openTableEditor(firstLine);
    }, READING_DOUBLE_TAP_MS);
  };

  const table = document.createElement("table");
  table.className = "reading-table";
  rows.forEach(function(row, r) {
    const tr = document.createElement("tr");
    if (rowLines && rowLines[r] !== undefined) tr.dataset.line = rowLines[r];
    row.forEach(function(cell) {
      const td = document.createElement(r === 0 ? "th" : "td");
      appendInline(td, cell, null);
      tr.appendChild(td);
    });
    table.appendChild(tr);
  });
  wrap.appendChild(table);
  return wrap;
}

/* ---------- 閱讀模式裡的跳轉 ----------

   章節目錄、標籤、快速跳轉都是給一個行號。空行、表格的分隔線在閱讀畫面裡
   沒有對應的元素，所以找「行號不超過它的最後一個」。 */
function readingElementForLine(lineIndex) {
  let best = null;
  let bestLine = -1;
  document.querySelectorAll("#docReadingView [data-line]").forEach(function(el) {
    const l = Number(el.dataset.line);
    if (l <= lineIndex && l > bestLine) { best = el; bestLine = l; }
  });
  return best;
}

let readingJumpTimer = null;

function jumpInReadingView(lineIndex) {
  const el = readingElementForLine(lineIndex);
  if (!el) return false;

  // 閃一下：拿掉再加回去，連續跳同一行時動畫才會重播
  document.querySelectorAll("#docReadingView .reading-jump").forEach(function(x) { x.classList.remove("reading-jump"); });
  void el.offsetWidth;
  el.classList.add("reading-jump");
  if (readingJumpTimer) clearTimeout(readingJumpTimer);
  readingJumpTimer = setTimeout(function() { el.classList.remove("reading-jump"); }, 1800);

  /* 跟編輯時的跳轉（scrollToFirstSearchHit）同一種捲法：擺在捲動區的上方三分之一。
     等一格再量：剛收起來的快速跳轉面板會改動版面。 */
  requestAnimationFrame(function() {
    const scroller = document.querySelector(".editor-content-area");
    if (!scroller) return;
    const r = el.getBoundingClientRect();
    const s = scroller.getBoundingClientRect();
    if (r.top >= s.top && r.bottom <= s.bottom) return;
    scroller.scrollTop += r.top - s.top - scroller.clientHeight / 3;
  });
  return true;
}

/* ---------- 雙擊回到編輯 ----------

   滑鼠：dblclick。手指：iOS 不保證連點兩下會發 dblclick，自己看兩次 touchend
   的間隔與距離。切回編輯要在這個手勢的同一個呼叫堆疊裡聚焦輸入框，iOS 才肯
   叫出鍵盤（跟 3k 同一個道理）。 */
const READING_TAP_SLOP_PX = 24;
let lastReadingTap = null;

/* 點到的地方在原文的第幾行、第幾個字。認不出來就回 null。 */
function readingSourceAt(x, y, target) {
  let node = null, offset = 0;
  try {
    if (document.caretRangeFromPoint) {
      const r = document.caretRangeFromPoint(x, y);
      if (r) { node = r.startContainer; offset = r.startOffset; }
    } else if (document.caretPositionFromPoint) {
      const p = document.caretPositionFromPoint(x, y);
      if (p) { node = p.offsetNode; offset = p.offset; }
    }
  } catch (e) { node = null; }

  const el = node ? (node.nodeType === 3 ? node.parentElement : node) : target;
  const lineEl = el && el.closest ? el.closest("[data-line]") : null;
  if (!lineEl) return null;
  const line = Number(lineEl.dataset.line);
  const seg = node && node.nodeType === 3 && el.dataset && el.dataset.o !== undefined && el.dataset.o !== "" ? el : null;
  // 表格格子沒有記欄位位置（null）：游標放在那一列的開頭
  const col = seg && lineEl.tagName !== "TR" ? Number(seg.dataset.o) + offset : 0;
  return { line: line, col: isFinite(col) ? col : 0 };
}

/* 純函式：第幾行第幾個字 → 在整篇裡的位置。超出那一行就停在行尾。 */
function sourceOffsetOf(text, line, col) {
  const lines = String(text || "").split("\n");
  const l = Math.max(0, Math.min(line, lines.length - 1));
  let pos = 0;
  for (let i = 0; i < l; i++) pos += lines[i].length + 1;
  return { pos: pos + Math.max(0, Math.min(col || 0, lines[l].length)), lineStart: pos, lineEnd: pos + lines[l].length };
}

function editFromReadingAt(x, y, target) {
  if (!docReadingMode) return;
  cancelPendingTableOpen();
  const at = readingSourceAt(x, y, target) || { line: 0, col: 0 };
  const ta = document.getElementById("docContentInput");
  setReadingMode(false);
  if (!ta) return;
  const where = sourceOffsetOf(ta.value, at.line, at.col);
  try {
    ta.focus({ preventScroll: true });
    ta.setSelectionRange(where.pos, where.pos);
  } catch (e) { /* 沒掛上就算了 */ }
  // 用「跳到某一行」同一套標示＋捲動，看得出游標落在哪
  if (typeof setJumpHighlight === "function") setJumpHighlight(where.lineStart, where.lineEnd);
  requestAnimationFrame(function() {
    if (typeof scrollToFirstSearchHit === "function") scrollToFirstSearchHit("mark.is-jump");
  });
}

function setupReadingDoubleTap() {
  const view = document.getElementById("docReadingView");
  if (!view) return;
  view.addEventListener("dblclick", function(e) {
    e.preventDefault();
    editFromReadingAt(e.clientX, e.clientY, e.target);
  });
  view.addEventListener("touchend", function(e) {
    if (e.touches.length || !e.changedTouches.length) return;
    const t = e.changedTouches[0];
    const now = Date.now();
    const prev = lastReadingTap;
    lastReadingTap = { at: now, x: t.clientX, y: t.clientY };
    if (prev && now - prev.at < READING_DOUBLE_TAP_MS &&
        Math.abs(t.clientX - prev.x) < READING_TAP_SLOP_PX && Math.abs(t.clientY - prev.y) < READING_TAP_SLOP_PX) {
      lastReadingTap = null;
      e.preventDefault();   // 不要再補一個 click（會去開表格視窗）
      editFromReadingAt(t.clientX, t.clientY, e.target);
    }
  });
}
