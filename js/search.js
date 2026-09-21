/* ==========================================================
   搜尋功能
   ========================================================== */

function handleSearchInput(inputEl) {
  const clearBtn = document.getElementById("searchClearBtn");
  if (inputEl.value.trim().length > 0) {
    clearBtn.style.display = "inline-flex";
  } else {
    clearBtn.style.display = "none";
  }
  renderSidebarTree();
  // 改了搜尋內容，內文裡標的還是舊的詞——搜尋框寫著一件事、文檔標著
  // 另一件事，比沒有標示還糟。等使用者點新的結果時會重新標。
  if (typeof searchHighlightTerm !== "undefined" &&
      searchHighlightTerm && searchHighlightTerm !== inputEl.value.trim()) {
    clearSearchHighlight();
  }
}

function clearSearchInput() {
  const inputEl = document.getElementById("searchInput");
  const clearBtn = document.getElementById("searchClearBtn");
  inputEl.value = "";
  clearBtn.style.display = "none";
  renderSidebarTree();
  clearSearchHighlight();
  inputEl.focus();
}

function docMatchesSearch(doc, search) {
  if (!search) return true;
  return (doc.title || "").toLowerCase().includes(search) || (doc.content || "").toLowerCase().includes(search);
}

function renderActiveDocSearchPin(container, search) {
  const doc = appData.docs.find(d => d.id === activeDocId);
  if (!doc || doc.worldId !== activeWorldId) return;
  if (!docMatchesSearch(doc, search)) return;

  const pinWrap = document.createElement("div");
  pinWrap.className = "search-pin-wrap";

  const label = document.createElement("div");
  label.className = "search-pin-label";
  label.textContent = "📌 目前開啟的文檔";
  pinWrap.appendChild(label);

  pinWrap.appendChild(createDocRowElement(doc));
  container.appendChild(pinWrap);
}

/* ==========================================================
   搜尋命中標示

   從搜尋結果點進文檔時，把搜尋的詞在內文裡標起來。

   做法是在 textarea 底下墊一層同樣排版的圖層，命中的字用 <mark> 畫底色，
   再讓上層透明底的 textarea 把字顯示在上面。

   不用原生選取（setSelectionRange）的原因有兩個：選取只有在 textarea
   取得焦點時才看得見，手機上那會彈出鍵盤；而且選取一次只能標一段，
   同一個詞出現很多次的話只看得到第一個。
   ========================================================== */

let searchHighlightTerm = "";

/* 「跳到某一行」也用同一個圖層標起來。

   原本 jumpToLine() 是用 textarea 的原生選取（setSelectionRange）：
   選取只有在 textarea 有焦點時才看得見，所以它得先 focus()——在手機上
   那就等於每次跳轉都把軟體鍵盤叫出來，而且畫面被鍵盤吃掉一半，
   跳過去的那一行未必還看得到。捲動也是用「字元位置佔全文的百分比」
   估的，遇到長短不一的段落會偏掉。

   改成跟搜尋一樣畫在圖層上：不用搶焦點、不會彈鍵盤，而且捲動可以直接量
   那個 <mark> 的實際位置，不用推算。 */
let jumpHighlightRange = null;   // [start, end]，字元位置

function setJumpHighlight(start, end) {
  jumpHighlightRange = [start, end];
  renderSearchHighlight();
}

function clearJumpHighlight() {
  if (!jumpHighlightRange) return;
  jumpHighlightRange = null;
  renderSearchHighlight();
}

function currentSearchTerm() {
  const el = document.getElementById("searchInput");
  return el ? el.value.trim() : "";
}

function setSearchHighlight(term) {
  searchHighlightTerm = term || "";
  renderSearchHighlight();
}

function clearSearchHighlight() {
  if (!searchHighlightTerm) return;
  searchHighlightTerm = "";
  renderSearchHighlight();
}

/* 這次要標起來的所有區間，已排序且不重疊。

   搜尋命中與「跳到某一行」可能同時存在（搜尋到一半又按了目錄），
   而且會重疊——重疊的話直接照順序輸出會產生交錯的標籤，HTML 會壞掉。
   所以先收集、排序，再把跟前一段重疊的部分切掉。 */
function collectHighlightRanges(text) {
  const ranges = [];

  const term = searchHighlightTerm;
  if (term) {
    const lower = text.toLowerCase();
    const needle = term.toLowerCase();
    let idx = lower.indexOf(needle);
    while (idx !== -1) {
      ranges.push({ start: idx, end: idx + term.length, kind: "hit" });
      idx = lower.indexOf(needle, idx + term.length);
    }
  }

  if (jumpHighlightRange) {
    const start = Math.max(0, Math.min(jumpHighlightRange[0], text.length));
    const end = Math.max(start, Math.min(jumpHighlightRange[1], text.length));
    if (end > start) ranges.push({ start: start, end: end, kind: "jump" });
  }

  ranges.sort(function(a, b) { return a.start - b.start || a.end - b.end; });

  const merged = [];
  ranges.forEach(function(r) {
    const last = merged[merged.length - 1];
    if (!last || r.start >= last.end) { merged.push(r); return; }
    // 重疊：只留還沒被蓋到的那一截，蓋不到就整段丟掉
    if (r.end > last.end) merged.push({ start: last.end, end: r.end, kind: r.kind });
  });
  return merged;
}

function renderSearchHighlight() {
  const layer = document.getElementById("docContentHighlight");
  const textarea = document.getElementById("docContentInput");
  if (!layer || !textarea) return;

  const text = textarea.value || "";
  const ranges = collectHighlightRanges(text);

  if (!ranges.length) { layer.innerHTML = ""; return; }

  let html = "";
  let from = 0;
  ranges.forEach(function(r) {
    html += escapeHtml(text.slice(from, r.start));
    html += '<mark class="' + (r.kind === "jump" ? "is-jump" : "is-hit") + '">' +
            escapeHtml(text.slice(r.start, r.end)) + "</mark>";
    from = r.end;
  });
  html += escapeHtml(text.slice(from));

  // 結尾的換行在 pre-wrap 下不會產生最後一個空行，補一個字元讓兩層等高
  layer.innerHTML = html + "\n";
}

/* 捲到第一個命中的地方。位置直接量圖層裡第一個 <mark>，
   不用自己推算行號與折行——圖層跟 textarea 排版一致，量到的就是對的。 */
function scrollToFirstSearchHit(selector) {
  const layer = document.getElementById("docContentHighlight");
  const scroller = document.querySelector(".editor-content-area");
  if (!layer || !scroller) return;

  const mark = layer.querySelector(selector || "mark");
  if (!mark) return;

  const markRect = mark.getBoundingClientRect();
  const scrollerRect = scroller.getBoundingClientRect();
  if (markRect.height === 0) return;

  // 已經看得到就不要亂捲
  if (markRect.top >= scrollerRect.top && markRect.bottom <= scrollerRect.bottom) return;

  // 擺在容器上方三分之一處，前後文都看得到
  const offset = markRect.top - scrollerRect.top - scroller.clientHeight / 3;
  scroller.scrollTop += offset;
}

/* 從搜尋結果點進某篇文檔時呼叫。搜尋框是空的就什麼都不做。 */
function applySearchHighlightForOpenedDoc() {
  const term = currentSearchTerm();
  if (!term) { clearSearchHighlight(); return; }
  setSearchHighlight(term);
  scrollToFirstSearchHit();
}
