/* ==========================================================
   文檔編輯與狀態
   ========================================================== */

function isChapterHeadingLine(trimmedLine) {
  return MARKDOWN_HEADING_REGEX.test(trimmedLine) || CHAPTER_LINE_REGEX.test(trimmedLine);
}

function extractHashtagsFromLine(line) {
  const trimmed = line.trim();
  if (isChapterHeadingLine(trimmed)) return [];
  const tags = [];
  const tagRegex = /#([^\s#]+)/g;
  let m;
  while ((m = tagRegex.exec(line)) !== null) {
    const t = m[1].trim();
    if (t) tags.push(t);
  }
  return tags;
}

function extractHashtagsFromText(text) {
  const result = [];
  (text || "").split("\n").forEach(function(line) {
    extractHashtagsFromLine(line).forEach(function(t) {
      if (!result.includes(t)) result.push(t);
    });
  });
  return result;
}

function loadDocToEditor(docId) {
  flushPendingContentPersist();
  activeDocId = docId;
  const doc = appData.docs.find(d => d.id === docId);
  if (!doc) return;

  document.getElementById("docIconBtn").textContent = doc.icon || "📄";
  document.getElementById("docTitleInput").value = doc.title || "";
  document.getElementById("docContentInput").value = doc.content || "";
  document.getElementById("statWordCount").textContent = doc.wordCount || 0;
  document.getElementById("statUpdatedAt").textContent = doc.updatedAt || "--";
  autoGrowTextarea(document.getElementById("docContentInput"));

  renderBreadcrumb();
  renderTOC(doc.content || "");
  renderLiveHashtags(doc.tags || []);
  renderDocImages(doc.images || []);
  renderSidebarTree();
  closeQuickJumpPanel();
  // 「段首空兩格」是每篇各自的開關，換文檔要跟著換
  if (typeof renderDocToolsState === "function") renderDocToolsState();

  // 換了一篇文檔，上一篇的標示不該留著。
  // 從搜尋結果點進來的那條路徑會在這之後自己加回去。
  if (typeof clearSearchHighlight === "function") clearSearchHighlight();
  if (typeof clearJumpHighlight === "function") clearJumpHighlight();

  ensureDocHistory(doc.id, doc.content || "");
}

/* 標題每敲一個字原本都會 saveData() ＋ 重畫整棵側欄樹 ＋ 重畫麵包屑。
   saveData() 是把整包 appData 序列化寫進 localStorage。實測 1500 篇文檔時，
   敲一個字要 112ms（序列化 42ms、重畫樹 16ms），大概每秒只打得了 9 個字。

   內文本來就有 400ms 的 debounce，標題沒有。補上同一套：
   - 記憶體裡的 doc.title 立刻更新，畫面上該跟著變的（麵包屑、側欄那一列、
     快速跳轉）也立刻更新——那幾個都是常數成本。
   - 只有 saveData() 進 debounce。
   - 側欄改成只更新受影響的那一列，不重畫整棵樹。 */
let titlePersistTimer = null;
let pendingTitleDocId = null;

function schedulePersistTitle(docId) {
  pendingTitleDocId = docId;
  if (titlePersistTimer) clearTimeout(titlePersistTimer);
  titlePersistTimer = setTimeout(function() {
    titlePersistTimer = null;
    flushPendingTitlePersist();
  }, 400);
}

function flushPendingTitlePersist() {
  if (!titlePersistTimer && !pendingTitleDocId) return;
  if (titlePersistTimer) { clearTimeout(titlePersistTimer); titlePersistTimer = null; }
  pendingTitleDocId = null;
  saveData();
}

function onTitleChange() {
  const doc = appData.docs.find(d => d.id === activeDocId);
  if (!doc) return;
  doc.title = document.getElementById("docTitleInput").value;
  doc.updatedAt = formatTime(new Date());
  document.getElementById("statUpdatedAt").textContent = doc.updatedAt;
  schedulePersistTitle(doc.id);
  updateDocRowInPlace(doc);
  renderBreadcrumb();
  if (document.getElementById("quickJumpPanel").classList.contains("active")) {
    document.getElementById("quickJumpDocTitle").textContent = doc.title || "未命名文檔";
    document.getElementById("quickJumpUpdatedAt").textContent = doc.updatedAt || "--";
  }
}

function recomputeDocFromContent(doc, text) {
  const cjk = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const eng = (text.replace(/[\u4e00-\u9fa5]/g, ' ').match(/\b[a-zA-Z0-9_]+\b/g) || []).length;
  doc.wordCount = cjk + eng;

  if (!Array.isArray(doc.manualTags)) doc.manualTags = [];
  const textTags = extractHashtagsFromText(text);
  const mergedTags = textTags.slice();
  doc.manualTags.forEach(function(t) {
    if (!mergedTags.includes(t)) mergedTags.push(t);
  });
  doc.tags = mergedTags;

  doc.tags.forEach(function(t) {
    if (!appData.tagSettings[t]) appData.tagSettings[t] = "c_gray";
  });
}

/* 每敲一個字，原本會把整篇內文掃過好幾遍：算字數、抽標籤（兩輪正規
   表示式）、重建章節目錄、重畫標籤列、重畫麵包屑。實測單篇 14 萬字時
   一個字要 55ms，其中光 recomputeDocFromContent 就 17.5ms——打起來會黏。

   拆成兩段：
   - 立刻要做的只有「把字記進記憶體」跟「讓輸入框長高」。這兩件的成本
     跟文章長度無關，不能延後，延後了畫面會頓。
   - 其餘全部是「從內文推導出來的顯示」——字數、標籤、章節目錄、麵包屑。
     晚 200ms 更新完全看不出來，但省掉的是每一鍵掃一次全文。

   200ms 比存檔的 400ms 短：字數要先跟上，不然使用者會覺得它壞了。 */
const DERIVED_UI_DELAY_MS = 200;
let derivedUiTimer = null;
let pendingDerivedDocId = null;

function scheduleDerivedUi(docId) {
  pendingDerivedDocId = docId;
  if (derivedUiTimer) clearTimeout(derivedUiTimer);
  derivedUiTimer = setTimeout(function() {
    derivedUiTimer = null;
    flushDerivedUi();
  }, DERIVED_UI_DELAY_MS);
}

function flushDerivedUi() {
  if (derivedUiTimer) { clearTimeout(derivedUiTimer); derivedUiTimer = null; }
  const docId = pendingDerivedDocId;
  pendingDerivedDocId = null;
  if (!docId) return;

  const doc = appData.docs.find(d => d.id === docId);
  if (!doc) return;
  const text = doc.content || "";

  // 標題空白時用第一行當標題
  const titleInput = document.getElementById("docTitleInput");
  if (titleInput && !titleInput.value.trim()) {
    doc.title = (text.trim().split("\n")[0] || "").substring(0, 24);
  }

  recomputeDocFromContent(doc, text);

  if (docId !== activeDocId) return;   // 已經切到別篇了，畫面不用更新

  const wc = document.getElementById("statWordCount");
  if (wc) wc.textContent = doc.wordCount;
  const ua = document.getElementById("statUpdatedAt");
  if (ua) ua.textContent = doc.updatedAt;

  renderBreadcrumb();
  renderTOC(text);
  renderLiveHashtags(doc.tags);
  updateDocRowInPlace(doc);

  if (document.getElementById("quickJumpPanel").classList.contains("active")) {
    renderQuickJumpList(text);
    document.getElementById("quickJumpWordCount").textContent = doc.wordCount;
    document.getElementById("quickJumpUpdatedAt").textContent = doc.updatedAt;
  }
}

function onContentChange() {
  const doc = appData.docs.find(d => d.id === activeDocId);
  if (!doc) return;

  // 一開始編輯就把標示清掉：文字一動，標示的位置就不對了
  if (typeof clearSearchHighlight === "function") clearSearchHighlight();
  if (typeof clearJumpHighlight === "function") clearJumpHighlight();

  const textarea = document.getElementById("docContentInput");
  const text = textarea.value;
  doc.content = text;
  doc.updatedAt = formatTime(new Date());
  autoGrowTextareaFast(textarea);

  scheduleDerivedUi(doc.id);
  scheduleContentPersist(doc.id, text);
}

/* 打字時用的快速版本。

   autoGrowTextarea() 會把高度歸零再讀 scrollHeight，等於強迫瀏覽器把整篇
   重新排版兩次。文章短的時候無所謂，一萬行的時候實測一鍵要 196ms。

   但「在同一行裡打字」不會改變需要的高度。所以先數換行數（純字串掃描，
   八萬字約 0.7ms），跟上次一樣就直接跳過重量——實測降到 0.2ms。

   兩個漏網的情況用一個延後的完整量測補回來：
   - 某一行長到自動換行，視覺上多了一行但換行數沒變
   - 刪掉內容之後高度該縮回去（scrollHeight 不會告訴你這件事）
   寬度變了（轉向、視窗縮放）也是靠那個延後的量測收尾——不能放進比對的
   鍵裡，讀寬度本身就要排版。 */
let lastGrowKey = null;
let growCorrectTimer = null;

function countNewlines(s) {
  let n = 1;
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 10) n++;
  return n;
}

function autoGrowTextareaFast(el) {
  if (!el) return;

  /* 這個鍵裡只能放「不需要排版就拿得到」的東西。

     第一版我把 el.clientWidth 也放進來（想偵測轉向／視窗縮放），結果每敲
     一個字都比原本更慢——讀 clientWidth 跟讀 scrollHeight 一樣會強迫瀏覽器
     排版，我想避開的成本自己又叫了一次（實測 196ms → 219ms）。
     寬度變化交給下面那個延後的完整量測處理就好。 */
  const key = countNewlines(el.value);

  if (key !== lastGrowKey) {
    lastGrowKey = key;
    autoGrowTextarea(el);
    /* 行數變了（多半是剛按下 Enter）才順便確認游標沒被鍵盤壓到。

       掛在這裡而不是每一鍵都做，是因為那幾個 getBoundingClientRect 一樣
       會強迫排版——同一行裡打字時不做，就不會把上面辛苦省下來的成本又
       花回去。而且行數沒變的時候游標本來就不會往下掉。 */
    scheduleCaretRoomCheck();
    return;
  }

  // 行數沒變：這一鍵不重量，但排一次延後的完整量測收尾
  if (growCorrectTimer) clearTimeout(growCorrectTimer);
  growCorrectTimer = setTimeout(function() {
    growCorrectTimer = null;
    lastGrowKey = null;      // 下次一定重量
    autoGrowTextarea(el);
    scheduleCaretRoomCheck();
  }, 250);
}

/* ==========================================================
   游標與鍵盤之間至少留一行

   CSS 的 scroll-padding-bottom 已經告訴瀏覽器「把東西捲進視野時下面要留
   這麼多」，但那條規則對「游標」的捲動有沒有被遵守，各家瀏覽器的行為
   不一致（而且這個環境裝不起 WebKit，沒辦法驗 Safari）。所以再加一道
   自己算的保險。

   兩種量法，成本差很多：

   - 游標在最後一行：那一行的底就是 textarea 的底，一次
     getBoundingClientRect 就問得到。打字途中只走這條。
   - 游標在中間：沒得取巧，要把游標前面的文字用同樣的字體與寬度重排一次
     （實測一萬行 106ms）。只在「剛聚焦／鍵盤剛升起」這種一次性的時機做。

   為什麼中間那種也非量不可——原本這裡是直接放棄、「交給瀏覽器自己處理」：
   iOS 的「自己處理」是把整個版面視窗往上推（visualViewport.offsetTop 變成
   非 0）。那一推會把最上面的工具列推出畫面，也讓所有 position:fixed 的
   東西跟著偏掉，就是使用者回報的「點到會被鍵盤蓋住的地方，按鈕就跑掉」。
   我們自己先把游標捲到看得見的地方，iOS 就沒有理由去推。
   ========================================================== */

let caretRoomRaf = null;
let caretRoomAccurate = false;
let caretRoomAssumedInset = 0;

/* 這一次聚焦補捲了幾次、每次多少。只給設定裡的 🩺 鍵盤診斷看。

   「捲上去的時候會跳動」的真面目就是這個陣列不只一筆：鍵盤是滑上來的，
   滑的過程中 visualViewport 會連發好幾次 resize，每次量到的可視底都不一樣，
   照著補就變成一格一格往上跳。正常情況這裡應該只有一筆（聚焦當下那一次）。

   只留最後五筆，不然長時間編輯會一直長。 */
let caretScrollLog = [];

function logCaretScroll(px) {
  caretScrollLog.push("+" + Math.round(px));
  if (caretScrollLog.length > 5) caretScrollLog.shift();
}

function resetCaretScrollLog() {
  caretScrollLog = [];
}

/* accurate＝允許用重排的方式量任意位置的游標。打字途中不要開。 */
function scheduleCaretRoomCheck(accurate, assumedInset) {
  if (accurate) caretRoomAccurate = true;
  if (assumedInset > 0) caretRoomAssumedInset = assumedInset;
  if (caretRoomRaf) return;
  caretRoomRaf = requestAnimationFrame(function() {
    caretRoomRaf = null;
    const acc = caretRoomAccurate;
    const inset = caretRoomAssumedInset;
    caretRoomAccurate = false;
    caretRoomAssumedInset = 0;
    ensureCaretRoom(acc, inset);
  });
}

/* 聚焦時先把位置讓出來。

   這是整條因果鏈的上游：只要游標在鍵盤升起後仍然看得見，iOS 就不會去推
   版面視窗，工具列不會被推掉，固定定位的按鈕也不會跟著偏。

   鍵盤高度用上一次量到的。第一次聚焦時還沒有值，那一次就只能讓 iOS 自己
   處理——之後每一次都有了。

   但「捲上去」有個前提：下面還要有東西可以捲。

   游標在文章中間時下面有一大片內容，捲得動；在**文章結尾附近**時，捲動
   容器底下就只剩那一點內距（桌機／平板版是 40px），而要讓游標高過鍵盤得
   捲 300~400px——捲到底也讓不出來，iOS 照樣得推版面視窗。而「在文章結尾
   附近打字」正是寫東西最常見的狀態。

   加大的底部內距本來只掛在 .kb-open 上，也就是**鍵盤已經升起**才給，
   正好晚了一步：最需要那塊空間的就是「聚焦了、鍵盤還沒來」的那一刻。
   所以這裡先掛一個 .kb-pending，把同一塊空間提前留出來。

   順帶也讓 iOS 自己的「把游標捲進視野」有地方可捲——它會優先捲最近的
   捲動容器，捲得動就不必去推版面視窗了。這一點對「第一次聚焦」特別有用，
   那一次我們沒有記得的鍵盤高度可以用。 */
function setupCaretRoomOnFocus() {
  const ta = document.getElementById("docContentInput");
  if (!ta) return;

  ta.addEventListener("focus", function() {
    resetCaretScrollLog();      // 每次聚焦重新計數，診斷看的是「這一次」

    /* 只有軟體鍵盤才需要這塊空間。接了實體鍵盤的機器留著它，只是在文章
       結尾多出一塊空白。這是「有沒有手指」的判斷，不是「版面寬不寬」——
       iPad 直放 820 寬算桌機版面，但它一樣是軟體鍵盤。 */
    if (isTouchPrimary()) document.documentElement.classList.add("kb-pending");

    const inset = (typeof lastKnownKeyboardInset === "number") ? lastKnownKeyboardInset : 0;
    if (inset <= 0) return;
    scheduleCaretRoomCheck(true, inset);
  });

  /* 不再編輯就把空間收回去，否則文章結尾會一直掛著一塊空白。
     （用「收起鍵盤」按鈕關掉鍵盤時 iOS 不會 blur，那一次會留著——
     那是對的，鍵盤隨時可能再上來。） */
  ta.addEventListener("blur", function() {
    document.documentElement.classList.remove("kb-pending");
  });
}

/* 量游標那一行的底在畫面上的 y。量不出來就回 null，呼叫端照舊放棄。

   做法是拿一個看不見的 div，套上跟 textarea 一模一樣的字體、寬度、內距與
   換行規則，把游標前面的文字放進去，尾巴插一個記號，問那個記號在第幾列。
   box-sizing 強制成 border-box 並直接用 textarea 的外框寬度，這樣內容區的
   寬度一定對得起來——差一點點就會換行位置不同，整個量測就沒意義了。 */
let caretMirror = null;

function measureCaretBottom(ta) {
  try {
    const cs = getComputedStyle(ta);
    const rect = ta.getBoundingClientRect();
    if (!caretMirror) {
      caretMirror = document.createElement("div");
      caretMirror.setAttribute("aria-hidden", "true");
      document.body.appendChild(caretMirror);
    }
    const m = caretMirror;
    m.style.cssText = "";
    ["fontFamily", "fontSize", "fontWeight", "fontStyle", "letterSpacing",
     "lineHeight", "textIndent", "textTransform", "wordSpacing", "wordBreak",
     "overflowWrap", "tabSize",
     "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
     "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth"
    ].forEach(function(k) { m.style[k] = cs[k]; });
    m.style.boxSizing = "border-box";
    m.style.width = rect.width + "px";
    m.style.whiteSpace = "pre-wrap";
    m.style.position = "absolute";
    m.style.left = "-9999px";
    m.style.top = "0";
    m.style.visibility = "hidden";
    m.style.pointerEvents = "none";

    m.textContent = ta.value.slice(0, ta.selectionStart);
    const marker = document.createElement("span");
    /* 零寬字元：不佔寬度，但拿得到位置。空的 span 量不到。 */
    marker.textContent = "\u200b";
    m.appendChild(marker);

    const lineHeight = parseFloat(cs.lineHeight) || 24;
    const top = marker.offsetTop;
    m.textContent = "";      // 量完就清掉，不要一直佔著整篇文章的記憶體
    if (!isFinite(top)) return null;
    return rect.top + top + lineHeight;
  } catch (e) {
    return null;
  }
}

/* assumedInset：鍵盤還沒升起、但我們知道它大概會蓋掉多少時傳進來。

   聚焦的那一刻鍵盤還沒出現，visualViewport 量到的還是整個畫面，照那個算
   會覺得「游標看得見啊」而什麼都不做——然後 iOS 就自己去推版面視窗了。
   用上一次記下來的鍵盤高度先把位置讓出來，它就沒有理由推。 */
function ensureCaretRoom(accurate, assumedInset) {
  const ta = document.getElementById("docContentInput");
  const scroller = document.querySelector(".editor-content-area");
  if (!ta || !scroller || document.activeElement !== ta) return;

  const caret = ta.selectionStart;
  if (caret !== ta.selectionEnd) return;                  // 有選取範圍就不要亂動

  const onLastLine = ta.value.indexOf("\n", caret) === -1;
  if (!onLastLine && !accurate) return;                   // 打字途中不做昂貴的量測

  /* 真正看得見的底：可視區域與捲動容器取交集。
     visualViewport 才知道鍵盤蓋掉多少，window.innerHeight 不知道。 */
  const vv = window.visualViewport;
  let viewBottom = vv ? (vv.offsetTop + vv.height) : window.innerHeight;
  if (assumedInset > 0) {
    // 鍵盤還沒升起：用記得的高度先算，取比較保守（比較高）的那一個
    viewBottom = Math.min(viewBottom, window.innerHeight - assumedInset);
  }
  let bottom = Math.min(viewBottom, scroller.getBoundingClientRect().bottom);

  /* 浮動的復原／快速跳轉那一排就浮在編輯區底部，游標停在它們底下一樣
     看不到。它們擋住哪裡，可用的底就到哪裡。 */
  const bar = document.querySelector(".undoredo-sticky-bar");
  if (bar) {
    const r = bar.getBoundingClientRect();
    if (r.height > 0 && r.top < bottom) bottom = r.top;
  }

  const lineHeight = parseFloat(getComputedStyle(ta).lineHeight) || 24;
  const caretLineBottom = onLastLine
    ? ta.getBoundingClientRect().bottom
    : measureCaretBottom(ta);
  if (caretLineBottom === null) return;

  // 游標那一行的底，要離「可用的底」至少一行
  const overflow = caretLineBottom - (bottom - lineHeight);
  if (overflow > 1) {
    scroller.scrollTop += overflow;
    logCaretScroll(overflow);
  }
}

function autoGrowTextarea(el) {
  if (!el) return;
  // 「先歸零高度、再用 scrollHeight 量出真正需要的高度」這招本身沒問題，但每次量測都要
  // 先把 textarea 縮回瀏覽器預設高度（很矮，例如只有 2 行）才能重新量測，這一瞬間
  // .editor-content-area 能捲動的範圍會跟著大幅變小；如果當下已經捲到比較下面（例如
  // 內文長到第 10 行左右、畫面容不下、已經自動往下捲來跟著游標），瀏覽器會在這個縮小的
  // 瞬間把捲動位置強制夾回新的（很小的）上限，通常就是最頂端——textarea 隨後雖然馬上
  // 撐回原本高度，但被夾掉的捲動位置不會自動復原，畫面就會像「打字/貼上打到某個位置
  // 就自動跳回最上面」。這裡在量測前後記住／還原 .editor-content-area 的 scrollTop，
  // 把這個副作用抵銷掉。
  const scrollContainer = document.querySelector(".editor-content-area");
  const prevScrollTop = scrollContainer ? scrollContainer.scrollTop : null;

  el.style.height = "auto";
  el.style.height = el.scrollHeight + "px";

  if (scrollContainer && prevScrollTop !== null) {
    scrollContainer.scrollTop = prevScrollTop;
  }
}

function scheduleContentPersist(docId, text) {
  pendingPersistInfo = { docId: docId, text: text };

  if (contentPersistTimer) clearTimeout(contentPersistTimer);
  contentPersistTimer = setTimeout(function() {
    contentPersistTimer = null;
    flushPendingContentPersist();
  }, 400);

  if (!historySnapshotTimer) {
    historySnapshotTimer = setTimeout(function() {
      historySnapshotTimer = null;
      if (pendingPersistInfo) {
        pushHistorySnapshot(pendingPersistInfo.docId, pendingPersistInfo.text);
      }
    }, HISTORY_SNAPSHOT_THROTTLE_MS);
  }
}

function flushPendingContentPersist() {
  flushPendingTitlePersist();   // 標題跟內文一起補存，兩邊都不要掉字
  flushDerivedUi();             // 字數與標籤要先算完，不然存進去的是舊的

  const hadPending = !!contentPersistTimer || !!historySnapshotTimer;

  if (contentPersistTimer) {
    clearTimeout(contentPersistTimer);
    contentPersistTimer = null;
  }
  if (historySnapshotTimer) {
    clearTimeout(historySnapshotTimer);
    historySnapshotTimer = null;
  }
  if (!hadPending) return;

  if (pendingPersistInfo) {
    pushHistorySnapshot(pendingPersistInfo.docId, pendingPersistInfo.text);
    pendingPersistInfo = null;
  }
  saveData();
  renderSidebarTree();
}

function ensureDocHistory(docId, content) {
  if (!docHistory[docId]) {
    docHistory[docId] = { stack: [content], index: 0, sel: [null] };
  }
  updateUndoRedoButtons(docId);
}

/* 自己接管了 Ctrl+Z，就要自己負責游標。

   applyHistorySnapshot() 直接覆寫 textarea.value，瀏覽器會把游標丟到最後，
   復原兩三次之後使用者就不知道自己在哪了。快照時一起把選取範圍記下來，
   套用時還原。

   選取範圍存在跟 stack 平行的 sel 陣列，不跟內文放在同一個物件裡——
   記憶體上限那段是照字元總量算的（見 trimHistoryMemory），
   把字串換成物件會把那套計算弄複雜。 */
function currentSelectionOf(docId) {
  if (docId !== activeDocId) return null;
  const ta = document.getElementById("docContentInput");
  if (!ta) return null;
  return [ta.selectionStart, ta.selectionEnd];
}

function pushHistorySnapshot(docId, content) {
  const h = docHistory[docId];
  if (!h) return;
  if (h.stack[h.index] === content) return;

  if (!h.sel) h.sel = [];
  h.sel = h.sel.slice(0, h.index + 1);
  h.sel.push(currentSelectionOf(docId));

  h.stack = h.stack.slice(0, h.index + 1);
  h.stack.push(content);
  h.index = h.stack.length - 1;

  // 單篇的步數上限。sel 要跟著一起剪，否則索引會對不上內容
  while (h.stack.length > DOC_HISTORY_MAX_STEPS) {
    h.stack.splice(1, 1);
    if (h.sel) h.sel.splice(1, 1);
    h.index--;
  }
  trimHistoryMemory(docId);

  if (docId === activeDocId) updateUndoRedoButtons(docId);
}

/* 全部文檔的復原紀錄加起來的字元總量上限。

   步數上限只擋得住單篇；docHistory 是全域的，開過的每一篇都留著自己那疊，
   寫一整天下來開了三十篇就是三十疊。所以另外算總量，超過就從「最舊、而且
   不是現在正在編輯的那篇」開始丟——正在寫的那篇不能被動，不然使用者會
   發現自己按不了復原。 */
function trimHistoryMemory(protectDocId) {
  const total = function() {
    let n = 0;
    Object.keys(docHistory).forEach(function(id) {
      docHistory[id].stack.forEach(function(t) { n += (t || "").length; });
    });
    return n;
  };

  if (total() <= DOC_HISTORY_MAX_CHARS) return;

  // 先砍別篇：整疊只留目前那一格，復原紀錄沒了但內容還在
  Object.keys(docHistory).forEach(function(id) {
    if (id === protectDocId || id === activeDocId) return;
    if (total() <= DOC_HISTORY_MAX_CHARS) return;
    const h = docHistory[id];
    h.stack = [h.stack[h.index]];
    if (h.sel) h.sel = [h.sel[h.index]];
    h.index = 0;
  });

  // 還是超過，才動正在編輯這篇最舊的那幾步
  const h = docHistory[protectDocId] || docHistory[activeDocId];
  while (h && h.stack.length > 1 && total() > DOC_HISTORY_MAX_CHARS) {
    h.stack.splice(1, 1);
    if (h.sel) h.sel.splice(1, 1);
    if (h.index > 0) h.index--;
  }
}

function applyHistorySnapshot(doc, content, selection) {
  doc.content = content;
  const textarea = document.getElementById("docContentInput");
  textarea.value = content;
  autoGrowTextarea(textarea);

  /* 還原游標。內容換過了，位置要夾在新長度裡面，否則會丟出例外或跳到怪地方。
     沒有記錄到選取範圍的（例如從別的裝置同步過來的舊資料）就放在結尾。 */
  const max = content.length;
  const start = selection ? Math.min(Math.max(0, selection[0]), max) : max;
  const end = selection ? Math.min(Math.max(start, selection[1]), max) : max;
  try {
    textarea.focus();
    textarea.setSelectionRange(start, end);
  } catch (e) { /* textarea 還沒掛上時忽略 */ }
  // 復原／取消復原是整段換掉內文，標示的位置會完全對不上
  if (typeof clearSearchHighlight === "function") clearSearchHighlight();
  if (typeof clearJumpHighlight === "function") clearJumpHighlight();

  recomputeDocFromContent(doc, content);
  doc.updatedAt = formatTime(new Date());
  document.getElementById("statWordCount").textContent = doc.wordCount;
  document.getElementById("statUpdatedAt").textContent = doc.updatedAt;

  renderBreadcrumb();
  renderTOC(content);
  renderLiveHashtags(doc.tags);
  renderSidebarTree();
  if (document.getElementById("quickJumpPanel").classList.contains("active")) {
    renderQuickJumpList(content);
    document.getElementById("quickJumpWordCount").textContent = doc.wordCount;
    document.getElementById("quickJumpUpdatedAt").textContent = doc.updatedAt;
  }

  saveData();
}

function undoDocContent() {
  flushPendingContentPersist();
  const doc = appData.docs.find(d => d.id === activeDocId);
  if (!doc) return;
  const h = docHistory[doc.id];
  if (!h || h.index <= 0) return;

  h.index--;
  applyHistorySnapshot(doc, h.stack[h.index], h.sel && h.sel[h.index]);
  updateUndoRedoButtons(doc.id);
}

function redoDocContent() {
  flushPendingContentPersist();
  const doc = appData.docs.find(d => d.id === activeDocId);
  if (!doc) return;
  const h = docHistory[doc.id];
  if (!h || h.index >= h.stack.length - 1) return;

  h.index++;
  applyHistorySnapshot(doc, h.stack[h.index], h.sel && h.sel[h.index]);
  updateUndoRedoButtons(doc.id);
}

function updateUndoRedoButtons(docId) {
  const undoBtn = document.getElementById("docUndoBtn");
  const redoBtn = document.getElementById("docRedoBtn");
  if (!undoBtn || !redoBtn) return;

  const h = docHistory[docId];
  const canUndo = !!h && h.index > 0;
  const canRedo = !!h && h.index < h.stack.length - 1;
  undoBtn.disabled = !canUndo;
  redoBtn.disabled = !canRedo;
}

function renderTOC(content) {
  const container = document.getElementById("tocLinksContainer");
  const card = document.getElementById("tocCard");
  container.innerHTML = "";

  const lines = content.split("\n");
  const chapters = [];

  lines.forEach(function(line, idx) {
    const trimmed = line.trim();
    if (MARKDOWN_HEADING_REGEX.test(trimmed)) {
      chapters.push({ title: trimmed.replace(/^#\s+/, ''), lineIndex: idx, fullText: trimmed });
    } else if (CHAPTER_LINE_REGEX.test(trimmed)) {
      chapters.push({ title: trimmed.substring(0, 24), lineIndex: idx, fullText: trimmed });
    }
  });

  if (chapters.length === 0) {
    card.style.display = "none";
    return;
  }

  card.style.display = "block";
  chapters.forEach(function(ch) {
    const chip = document.createElement("span");
    chip.className = "toc-chip";
    chip.textContent = "📍 " + ch.title;
    /* 用行號定位，不要用 indexOf(fullText)。

       indexOf 找的是「全文裡第一個長這樣的字串」——兩章同名，或內文裡
       引用了章節標題，就會跳到錯的地方。章節物件上本來就帶著 lineIndex，
       而 jumpToLine() 已經是照行號精準定位的正確實作（快速跳轉用的就是它）。 */
    chip.onclick = function() {
      jumpToLine(ch.lineIndex);
    };
    container.appendChild(chip);
  });
}

/* 圖片在存進去之前先縮小。

   原本是 readAsDataURL 直接把原檔塞進 appData。手機拍的 4MB 照片轉成
   base64 大約 5.3MB——localStorage 總共才 5MB，一張就爆，而且爆掉的時候
   存檔是靜悄悄失敗的（見 storage.js 的 saveData）。

   縮到長邊 1600px、JPEG 品質 0.82，一般照片會落在 150～300KB，二三十張
   都還塞得下。1600px 是「白板縮圖與編輯器預覽都夠清楚」與「不要太大」
   之間的折衷；原檔本來就比較小的話不會放大。 */
const IMAGE_MAX_EDGE = 1600;
const IMAGE_JPEG_QUALITY = 0.82;
const IMAGE_MAX_BYTES = 1.5 * 1024 * 1024;   // 壓完還超過就擋下來

function handleImageUpload(e) {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;

  if (!/^image\//.test(file.type)) {
    alert("這不是圖片檔。");
    return;
  }

  compressImageFile(file).then(function(dataUrl) {
    if (!isSafeImageSrc(dataUrl)) { alert("圖片處理失敗，請換一張試試。"); return; }
    if (dataUrl.length > IMAGE_MAX_BYTES) {
      alert("這張圖片壓縮後仍然有 " + Math.round(dataUrl.length / 1024) + " KB，太大了。\n" +
            "瀏覽器的儲存空間只有約 5MB，請先用別的工具把它縮小再放進來。");
      return;
    }
    const doc = appData.docs.find(d => d.id === activeDocId);
    if (!doc) return;
    if (!doc.images) doc.images = [];
    doc.images.push(dataUrl);
    saveData();
    renderDocImages(doc.images);
  }).catch(function(err) {
    console.error(err);
    alert("讀取圖片時發生錯誤，請換一張試試。");
  });
}

function compressImageFile(file) {
  return new Promise(function(resolve, reject) {
    const reader = new FileReader();
    reader.onerror = function() { reject(new Error("讀不到檔案")); };
    reader.onload = function(evt) {
      const img = new Image();
      img.onerror = function() { reject(new Error("這個檔案不是瀏覽器認得的圖片")); };
      img.onload = function() {
        const scale = Math.min(1, IMAGE_MAX_EDGE / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));

        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        // JPEG 沒有透明度，先鋪白底，否則透明的地方會變成黑塊
        ctx.fillStyle = "#FFFFFF";
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);

        try {
          resolve(canvas.toDataURL("image/jpeg", IMAGE_JPEG_QUALITY));
        } catch (err) {
          reject(err);
        }
      };
      img.src = evt.target.result;
    };
    reader.readAsDataURL(file);
  });
}

function renderDocImages(images) {
  const strip = document.getElementById("docImagesContainer");
  strip.innerHTML = "";
  if (!images || images.length === 0) return;

  images.forEach(function(imgSrc, index) {
    // 來路不明的字串不要進 <img src>（見 isSafeImageSrc）。用 DOM 屬性
    // 設定而不是拼 HTML 字串，就算白名單哪天放寬了也跳不出屬性。
    if (!isSafeImageSrc(imgSrc)) return;

    const box = document.createElement("div");
    box.className = "img-preview-box";

    const img = document.createElement("img");
    img.src = imgSrc;
    img.alt = "圖片";

    const del = document.createElement("button");
    del.className = "img-del-btn";
    del.title = "刪除圖片";
    del.textContent = "✕";
    del.onclick = function() { deleteDocImage(index); };

    box.appendChild(img);
    box.appendChild(del);
    strip.appendChild(box);
  });
}

function deleteDocImage(index) {
  const doc = appData.docs.find(d => d.id === activeDocId);
  if (doc && doc.images) {
    doc.images.splice(index, 1);
    saveData();
    renderDocImages(doc.images);
  }
}

/* ==========================================================
   段首空兩格

   中文排版的習慣是每一段開頭空兩個全形字。這是一個「開關」，不是一次性的
   動作：打開時把整篇現有的段落補上縮排，並且從那之後每按一次 Enter 就自動
   幫新的一段空兩格；關掉時把縮排拿掉，Enter 也恢復原狀。

   狀態存在文檔上（doc.autoIndent），不是全域設定——同一個世界觀裡，正文
   章節要縮排，角色設定那種條列式的不該縮，兩種文檔會並存。

   套用縮排時刻意跳過的幾種行：
   - 空行：段落之間的分隔，縮排它只會留下兩個看不見的空白。
   - 已經有縮排的：再加一次就變四格。
   - 標題行（「# 第一章」「第1章」「Chapter 3」）：那是結構不是內文，
     縮排會讓它看起來像段落，而且目錄那邊是照行首比對的。
   - 整行只有標籤的（「#問題 #0921問題」）：那是給系統看的中繼資料。

   兩個方向都走 pushHistorySnapshot()，所以按錯了可以直接按復原。
   ========================================================== */

const PARAGRAPH_INDENT = "\u3000\u3000";   // 兩個全形空格

/* 這一行是不是「整行都是標籤」。用 extractHashtagsFromText 判斷太鬆
   （內文裡夾一個標籤也會中），所以自己切開來看每一段是不是都以 # 開頭。 */
function isTagOnlyLine(line) {
  const parts = line.trim().split(/\s+/);
  return parts.length > 0 && parts.every(function(p) { return p.length > 1 && p[0] === "#"; });
}

function shouldIndentLine(line) {
  if (!line.trim()) return false;                       // 空行
  if (/^[\s\u3000]/.test(line)) return false;           // 已經有縮排了
  if (MARKDOWN_HEADING_REGEX.test(line)) return false;  // 「# 第一章 啟程」
  if (CHAPTER_LINE_REGEX.test(line)) return false;      // 「第1章」「Chapter 3」
  if (isTagOnlyLine(line)) return false;                // 整行都是標籤
  return true;
}

function indentParagraphsInText(text) {
  const lines = (text || "").split("\n");
  let changed = 0;
  const out = lines.map(function(line) {
    if (!shouldIndentLine(line)) return line;
    changed++;
    return PARAGRAPH_INDENT + line;
  });
  return { text: out.join("\n"), changed: changed };
}

/* 關掉時把縮排拿掉：開頭剛好是那兩個全形空格的就砍掉。

   這裡有一個刻意的取捨：如果使用者在打開這個開關之前就自己手打過縮排，
   關掉的時候那些也會被一起拿掉。要做到完全可逆就得記住「哪幾行是我加的」，
   但那份紀錄在使用者接著編輯（插入、刪除、搬動段落）之後就對不上了，
   會變成更難解釋的錯誤。

   所以這個開關的語意就定義成「這篇文檔要不要有段首縮排」，關＝一個都沒有。
   這一步也有進復原紀錄，覺得不對按一下就回得來。 */
function unindentParagraphsInText(text) {
  const lines = (text || "").split("\n");
  let changed = 0;
  const out = lines.map(function(line) {
    if (line.indexOf(PARAGRAPH_INDENT) !== 0) return line;
    changed++;
    return line.slice(PARAGRAPH_INDENT.length);
  });
  return { text: out.join("\n"), changed: changed };
}

function docAutoIndentOn(doc) {
  return !!(doc && doc.autoIndent);
}

function toggleParagraphIndent() {
  closeDocActionsPanel();

  const doc = appData.docs.find(d => d.id === activeDocId);
  const textarea = document.getElementById("docContentInput");
  if (!doc || !textarea) return;

  /* 先把還在等 debounce 的那一筆寫進去再動手，否則稍後那筆會拿著
     動手之前的舊內容蓋回來，等於白做。 */
  flushPendingContentPersist();

  const turningOn = !docAutoIndentOn(doc);
  const result = turningOn
    ? indentParagraphsInText(textarea.value)
    : unindentParagraphsInText(textarea.value);

  ensureDocHistory(doc.id, doc.content || "");
  if (result.changed) {
    pushHistorySnapshot(doc.id, textarea.value);   // 動手前的樣子，按復原回得來

    textarea.value = result.text;
    doc.content = result.text;
    doc.updatedAt = formatTime(new Date());
    autoGrowTextarea(textarea);
    pushHistorySnapshot(doc.id, result.text);
  }

  doc.autoIndent = turningOn;

  // 字數、標籤、目錄、側欄那一列都要跟著更新，走平常那條路就好
  scheduleDerivedUi(doc.id);
  flushDerivedUi();
  saveData();
  renderSidebarTree();
  renderDocToolsState();

  // 整篇換過了，原本標示的位置已經不對
  if (result.changed) {
    if (typeof clearSearchHighlight === "function") clearSearchHighlight();
    if (typeof clearJumpHighlight === "function") clearJumpHighlight();
  }

  showDocToolHint(turningOn
    ? (result.changed
        ? "已在 " + result.changed + " 個段落前空兩格；之後按 Enter 也會自動空（可按復原還原）"
        : "已開啟：之後按 Enter 會自動空兩格")
    : (result.changed
        ? "已取消 " + result.changed + " 個段落的縮排；按 Enter 不再自動空（可按復原還原）"
        : "已關閉：按 Enter 不再自動空兩格"));
}

/* 按鈕直接寫「按下去會發生什麼事」，而不是另外掛一個「開／關」的狀態標籤。

   狀態標籤要看的人多想一步（現在是開的 → 所以按下去會變成關的），而且
   「段首空兩格　開」跟「段首空兩格　關」這兩種寫法，第一眼很容易讀成
   「按這個會開啟」。直接寫「取消空兩格」就沒有這個歧義，順便也把現在的
   狀態講出來了——會出現「取消」兩個字，就代表現在是空著的。 */
function renderDocToolsState() {
  const label = document.getElementById("indentLabel");
  if (!label) return;
  const doc = appData.docs.find(d => d.id === activeDocId);
  label.textContent = docAutoIndentOn(doc) ? "取消空兩格" : "段首空兩格";
}

/* ==========================================================
   按 Enter 自動空兩格

   只在這篇文檔的開關是開著的時候才作用。

   幾個一定要處理的情況：
   - 輸入法組字中（e.isComposing）不能攔：中文輸入時 Enter 是「確認候選字」，
     攔下來會讓選字直接變成換行，完全沒辦法打字。
   - Shift+Enter 不縮排：沿用一般編輯器的慣例，那是「同一段裡換行」。
   - 游標後面已經有縮排或空白（在段落開頭按 Enter 把整段往下推）時不再加，
     否則會變成四格。
   - 停在一個只有縮排、沒有字的行上按 Enter（想空一行分段）時，把那兩個
     全形空格清掉再換行——否則會留下一行看不見的空白，而且那一行在匯出
     或字數統計上都是雜訊。

   插入一律用 execCommand("insertText")：雖然是舊 API，但所有瀏覽器都還
   支援，而且它會保留 textarea 自己的復原堆疊，也會照常送出 input 事件
   （字數、標籤那些就不用自己補呼叫）。不支援時退回手動拼字串。
   ========================================================== */

function insertAtCaret(textarea, text, replaceFrom) {
  if (typeof replaceFrom === "number") {
    textarea.setSelectionRange(replaceFrom, textarea.selectionEnd);
  }
  let done = false;
  try {
    done = document.execCommand("insertText", false, text);
  } catch (e) { done = false; }

  if (!done) {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const v = textarea.value;
    textarea.value = v.slice(0, start) + text + v.slice(end);
    const caret = start + text.length;
    textarea.setSelectionRange(caret, caret);
    if (typeof onContentChange === "function") onContentChange();
  }
}

function handleEditorEnterKey(e) {
  if (e.key !== "Enter") return;
  if (e.isComposing || e.keyCode === 229) return;   // 輸入法組字中
  if (e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;

  const doc = appData.docs.find(d => d.id === activeDocId);
  if (!docAutoIndentOn(doc)) return;

  const ta = e.target;
  const v = ta.value;
  const start = ta.selectionStart;
  const end = ta.selectionEnd;

  const lineStart = v.lastIndexOf("\n", start - 1) + 1;
  let lineEnd = v.indexOf("\n", end);
  if (lineEnd === -1) lineEnd = v.length;

  const lineText = v.slice(lineStart, lineEnd);
  const after = v.slice(end, lineEnd);   // 換行之後會變成新一行開頭的那段字

  e.preventDefault();

  // 新的一行本來就有縮排／空白了，不要再加
  if (after && /^[\s\u3000]/.test(after)) { insertAtCaret(ta, "\n"); return; }

  // 停在只有縮排、沒有字的行上 → 把那截空白一起換成換行，不留看不見的殘渣
  if (!lineText.trim()) { insertAtCaret(ta, "\n", lineStart); return; }

  insertAtCaret(ta, "\n" + PARAGRAPH_INDENT);
}

function setupEditorEnterIndent() {
  const ta = document.getElementById("docContentInput");
  if (ta) ta.addEventListener("keydown", handleEditorEnterKey);
}

/* 小工具的操作結果要說一聲，不然使用者按下去什麼都沒看到，會以為壞了。
   用短暫的浮出提示而不是 alert：不用再點一次關掉。 */
let docToolHintTimer = null;

function showDocToolHint(text) {
  const el = document.getElementById("docToolHint");
  if (!el) return;
  el.textContent = text;
  el.classList.add("active");
  if (docToolHintTimer) clearTimeout(docToolHintTimer);
  docToolHintTimer = setTimeout(function() {
    el.classList.remove("active");
    docToolHintTimer = null;
  }, 2600);
}
