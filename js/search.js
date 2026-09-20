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

function renderSearchHighlight() {
  const layer = document.getElementById("docContentHighlight");
  const textarea = document.getElementById("docContentInput");
  if (!layer || !textarea) return;

  const text = textarea.value || "";
  const term = searchHighlightTerm;

  if (!term) { layer.innerHTML = ""; return; }

  // 不分大小寫比對，但畫出來的要是原文
  const lower = text.toLowerCase();
  const needle = term.toLowerCase();
  let html = "";
  let from = 0;
  let idx = lower.indexOf(needle);

  while (idx !== -1) {
    html += escapeHtml(text.slice(from, idx));
    html += "<mark>" + escapeHtml(text.slice(idx, idx + term.length)) + "</mark>";
    from = idx + term.length;
    idx = lower.indexOf(needle, from);
  }
  html += escapeHtml(text.slice(from));

  // 結尾的換行在 pre-wrap 下不會產生最後一個空行，補一個字元讓兩層等高
  layer.innerHTML = html + "\n";
}

/* 捲到第一個命中的地方。位置直接量圖層裡第一個 <mark>，
   不用自己推算行號與折行——圖層跟 textarea 排版一致，量到的就是對的。 */
function scrollToFirstSearchHit() {
  const layer = document.getElementById("docContentHighlight");
  const scroller = document.querySelector(".editor-content-area");
  if (!layer || !scroller) return;

  const mark = layer.querySelector("mark");
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
