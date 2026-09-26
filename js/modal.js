/* ==========================================================
 彈跳視窗與選單管理
 ========================================================== */

function toggleDocActionsPanel() {
 const panel = document.getElementById("docActionsPanel");
 if (panel.classList.contains("active")) {
 closeDocActionsPanel();
 } else {
 openDocActionsPanel();
 }
}

function openDocActionsPanel() {
 // 兩個浮動面板在手機版是並排的底部按鈕，同時開著會疊在一起
 closeQuickJumpPanel();
 // 「段首空兩格」是每篇文檔各自的開關，打開面板時才知道現在這篇是開還是關
 if (typeof renderDocToolsState === "function") renderDocToolsState();
 document.getElementById("docActionsPanel").classList.add("active");
}

function closeDocActionsPanel() {
 document.getElementById("docActionsPanel").classList.remove("active");
}

function toggleQuickJumpPanel() {
 const panel = document.getElementById("quickJumpPanel");
 if (panel.classList.contains("active")) {
 closeQuickJumpPanel();
 } else {
 openQuickJumpPanel();
 }
}

function openQuickJumpPanel() {
 closeDocActionsPanel();
 const doc = appData.docs.find(d => d.id === activeDocId);
 document.getElementById("quickJumpDocTitle").textContent = (doc && doc.title) ? doc.title : "未命名文檔";
 document.getElementById("quickJumpWordCount").textContent = doc ? (doc.wordCount || 0) : 0;
 document.getElementById("quickJumpUpdatedAt").textContent = doc ? (doc.updatedAt || "--") : "--";
 renderQuickJumpList(doc ? (doc.content || "") : "");
 document.getElementById("quickJumpPanel").classList.add("active");
 document.getElementById("quickJumpOverlay").classList.add("active");
 const fab = document.getElementById("quickJumpFab");
 fab.textContent = "✕";
 fab.title = "關閉快速跳轉";
}

function closeQuickJumpPanel() {
 document.getElementById("quickJumpPanel").classList.remove("active");
 document.getElementById("quickJumpOverlay").classList.remove("active");
 const fab = document.getElementById("quickJumpFab");
 fab.textContent = "📑";
 fab.title = "章節 / Hashtag 快速跳轉";
}

function renderQuickJumpList(content) {
 const list = document.getElementById("quickJumpList");
 list.innerHTML = "";

 const lines = content.split("\n");
 const entries = [];

 lines.forEach(function(line, idx) {
 const trimmed = line.trim();
 if (MARKDOWN_HEADING_REGEX.test(trimmed)) {
 entries.push({ type: 'chapter', label: trimmed.replace(/^#\s+/, ''), lineIndex: idx });
 } else if (CHAPTER_LINE_REGEX.test(trimmed)) {
 entries.push({ type: 'chapter', label: trimmed.substring(0, 30), lineIndex: idx });
 }

 extractHashtagsFromLine(line).forEach(function(tagName) {
 entries.push({ type: 'tag', label: tagName, lineIndex: idx });
 });
 });

 entries.sort(function(a, b) { return a.lineIndex - b.lineIndex; });

 if (entries.length === 0) {
 list.innerHTML = '<div class="quickjump-empty">尚未偵測到章節標題或 Hashtag<br>試試輸入「# 第一章 標題」或「#標籤」</div>';
 return;
 }

 entries.forEach(function(entry) {
 const row = document.createElement("div");
 row.className = "quickjump-item" + (entry.type === 'tag' ? ' is-tag' : '');

 const lineBadge = document.createElement("span");
 lineBadge.className = "quickjump-item-line";
 lineBadge.textContent = "L" + (entry.lineIndex + 1);

 const icon = document.createElement("span");
 icon.className = "quickjump-item-icon";
 icon.textContent = entry.type === 'chapter' ? '📍' : '#';

 const label = document.createElement("span");
 label.className = "quickjump-item-label";
 label.textContent = entry.label;

 row.appendChild(lineBadge);
 row.appendChild(icon);
 row.appendChild(label);

 row.onclick = function() { jumpToLine(entry.lineIndex); };

 list.appendChild(row);
 });
}

/* 跳到某一行，並且用跟搜尋一樣的方式把那一行標起來。

   原本是用 textarea 的原生選取：得先 focus() 才看得見，手機上因此每次
   跳轉都彈鍵盤；捲動則是拿「字元位置佔全文的百分比」乘上總高度去估的，
   段落長短不一時會偏掉。現在畫在高亮圖層上，捲動直接量那個 <mark>
   的實際位置。

   游標還是放過去（想接著打字的人按一下就在對的地方），但只有在有實體
   鍵盤的裝置上才把焦點搶過來——觸控裝置搶焦點就等於叫出鍵盤。 */
function jumpToLine(lineIndex) {
 const textarea = document.getElementById("docContentInput");
 if (!textarea) return;
 const lines = textarea.value.split("\n");
 let pos = 0;
 for (let i = 0; i < lineIndex && i < lines.length; i++) {
 pos += lines[i].length + 1;
 }
 const lineLength = (lines[lineIndex] || "").length;

 if (typeof setJumpHighlight === "function") setJumpHighlight(pos, pos + lineLength);

 try {
 if (typeof isTouchPrimary === "function" && !isTouchPrimary()) textarea.focus();
 textarea.setSelectionRange(pos, pos + lineLength);
 } catch (e) { /* 還沒掛上或瀏覽器不給就算了，標示已經畫出來了 */ }

 closeQuickJumpPanel();

 /* 關閉快速跳轉面板會改動版面（面板收起來、捲軸可能變長），
    等瀏覽器重排完再量位置，否則量到的是收起來之前的座標。 */
 requestAnimationFrame(function() {
 if (typeof scrollToFirstSearchHit === "function") scrollToFirstSearchHit("mark.is-jump");
 });
}

function openHashtagFilterModal() {
 hashtagFilterActiveColor = null;
 renderHashtagFilterModal();
 document.getElementById("hashtagFilterModal").classList.add("active");
}

function closeHashtagFilterModal() {
 document.getElementById("hashtagFilterModal").classList.remove("active");
}

function renderHashtagFilterModal() {
 renderHashtagFilterColorChips();
 renderHashtagFilterList();
}

function renderHashtagFilterColorChips() {
 const wrap = document.getElementById("hashtagFilterColors");
 wrap.innerHTML = "";

 const allChip = document.createElement("div");
 allChip.className = "hashtag-filter-color-chip" + (hashtagFilterActiveColor === null ? " active" : "");
 allChip.innerHTML = '<span class="hashtag-filter-color-dot" style="background:linear-gradient(135deg,#bbb,#888);"></span><span>全部</span>';
 allChip.onclick = function() {
 hashtagFilterActiveColor = null;
 renderHashtagFilterModal();
 };
 wrap.appendChild(allChip);

 // 用 DEFAULT_PALETTES 的鍵順序，不要用 appData.colorPalette——後者是使用者
 // 存檔裡的複本，鍵的順序停在他第一次存檔那天，改了排序這裡不會跟著動
 Object.keys(DEFAULT_PALETTES).forEach(function(colorId) {
 const palette = getPalette(colorId);
 const chip = document.createElement("div");
 chip.className = "hashtag-filter-color-chip" + (hashtagFilterActiveColor === colorId ? " active" : "");
 chip.innerHTML =
 '<span class="hashtag-filter-color-dot" style="background:' + palette.bg + '; border:1px solid ' + palette.text + '55;"></span>' +
 '<span>' + escapeHtml(palette.name || colorId) + '</span>';
 chip.onclick = function() {
 hashtagFilterActiveColor = colorId;
 renderHashtagFilterModal();
 };
 wrap.appendChild(chip);
 });
}

function collectHashtagOccurrences(colorFilter) {
 const results = [];
 const docsInWorld = appData.docs.filter(d => d.worldId === activeWorldId);

 docsInWorld.forEach(function(doc) {
 const lines = (doc.content || "").split("\n");
 const seenTags = {};

 lines.forEach(function(line, idx) {
 extractHashtagsFromLine(line).forEach(function(tagName) {
 const colorId = appData.tagSettings[tagName] || "c_gray";
 if (colorFilter && colorId !== colorFilter) return;
 seenTags[tagName] = true;
 results.push({
 tag: tagName,
 colorId: colorId,
 lineIndex: idx,
 docId: doc.id,
 docTitle: doc.title || "無標題文檔"
 });
 });
 });

 (doc.manualTags || []).forEach(function(tagName) {
 if (seenTags[tagName]) return;
 const colorId = appData.tagSettings[tagName] || "c_gray";
 if (colorFilter && colorId !== colorFilter) return;
 results.push({
 tag: tagName,
 colorId: colorId,
 lineIndex: null,
 docId: doc.id,
 docTitle: doc.title || "無標題文檔"
 });
 });
 });

 results.sort(function(a, b) {
 if (a.docTitle !== b.docTitle) return a.docTitle.localeCompare(b.docTitle, 'zh-Hant');
 const la = a.lineIndex === null ? Infinity : a.lineIndex;
 const lb = b.lineIndex === null ? Infinity : b.lineIndex;
 return la - lb;
 });

 return results;
}

function renderHashtagFilterList() {
 const list = document.getElementById("hashtagFilterList");
 list.innerHTML = "";

 const results = collectHashtagOccurrences(hashtagFilterActiveColor);

 if (results.length === 0) {
 list.innerHTML = '<div class="hashtag-filter-empty">目前世界觀中尚未找到符合條件的 Hashtag</div>';
 return;
 }

 results.forEach(function(item) {
 const palette = getPalette(item.colorId);

 const row = document.createElement("div");
 row.className = "hashtag-filter-item";

 const dot = document.createElement("span");
 dot.className = "hashtag-filter-color-dot";
 dot.style.background = palette.bg;
 dot.style.border = "1px solid " + palette.text + "55";

 const tagSpan = document.createElement("span");
 tagSpan.className = "hashtag-filter-item-tag";
 tagSpan.style.color = palette.text;
 tagSpan.textContent = "#" + item.tag;

 const lineSpan = document.createElement("span");
 lineSpan.className = "hashtag-filter-item-line";
 lineSpan.textContent = item.lineIndex === null ? "手動標籤" : ("L" + (item.lineIndex + 1));

 const titleSpan = document.createElement("span");
 titleSpan.className = "hashtag-filter-item-title";
 titleSpan.textContent = item.docTitle;

 row.appendChild(dot);
 row.appendChild(tagSpan);
 row.appendChild(lineSpan);
 row.appendChild(titleSpan);

 row.onclick = function() {
 jumpToHashtagOccurrence(item.docId, item.lineIndex);
 };

 list.appendChild(row);
 });
}

function jumpToHashtagOccurrence(docId, lineIndex) {
 closeHashtagFilterModal();
 const doc = appData.docs.find(d => d.id === docId);
 if (!doc) return;

 if (doc.folderId) {
 let curId = doc.folderId;
 const guard = new Set();
 while (curId && !guard.has(curId)) {
 guard.add(curId);
 collapsedFolders[curId] = false;
 const f = appData.folders.find(x => x.id === curId);
 curId = f ? f.parentId : null;
 }
 }

 activeFolderId = doc.folderId || null;
 loadDocToEditor(docId);
 if (activeView !== 'editor') switchView('editor');
 renderSidebarTree();

 if (lineIndex !== null) {
 setTimeout(function() { jumpToLine(lineIndex); }, 0);
 }

 if (isMobileLayout()) closeSidebarMobile();
}

function attachLongPress(el, callback, duration) {
 duration = duration || 550;
 const MOVE_TOLERANCE = 10;
 let timer = null;
 let didFire = false;
 let startX = 0, startY = 0;

 function getPoint(e) {
 return e.touches && e.touches.length ? e.touches[0] : e;
 }

 function start(e) {
 if (e.type === "mousedown" && e.button !== 0) return;
 didFire = false;
 const point = getPoint(e);
 startX = point.clientX;
 startY = point.clientY;
 clearTimeout(timer);
 timer = setTimeout(function() {
 didFire = true;
 timer = null;
 callback(e);
 }, duration);
 }

 function move(e) {
 if (timer === null) return;
 const point = getPoint(e);
 if (Math.abs(point.clientX - startX) > MOVE_TOLERANCE || Math.abs(point.clientY - startY) > MOVE_TOLERANCE) {
 clearTimeout(timer);
 timer = null;
 }
 }

 function cancel() {
 if (timer !== null) {
 clearTimeout(timer);
 timer = null;
 }
 }

 function suppressTrailingClick(e) {
 if (didFire) {
 e.preventDefault();
 e.stopPropagation();
 didFire = false;
 }
 }

 el.addEventListener("mousedown", start);
 el.addEventListener("mousemove", move);
 el.addEventListener("mouseup", cancel);
 el.addEventListener("mouseleave", cancel);

 el.addEventListener("touchstart", start, { passive: true });
 el.addEventListener("touchmove", move, { passive: true });
 el.addEventListener("touchend", cancel);
 el.addEventListener("touchcancel", cancel);

 el.addEventListener("click", suppressTrailingClick, true);
}

function renderLiveHashtags(tags) {
 const bar = document.getElementById("liveTagToolbar");
 bar.innerHTML = "";

 (tags || []).forEach(function(tag) {
 const colorId = appData.tagSettings[tag] || "c_gray";
 const palette = getPalette(colorId);

 const chip = document.createElement("span");
 chip.className = "tag-chip";
 chip.style.backgroundColor = palette.bg;
 chip.style.color = palette.text;

 chip.innerHTML = '<span>#' + escapeHtml(tag) + '</span>';
 chip.title = "長按或右鍵以指定分類顏色／移除標籤";

 attachLongPress(chip, function() {
 openColorPicker(tag, chip);
 });

 // 新增：電腦端右鍵直接觸發
 chip.addEventListener("contextmenu", function(e) {
 e.preventDefault();
 e.stopPropagation();
 openColorPicker(tag, chip);
 });

 bar.appendChild(chip);
 });

 const addBtn = document.createElement("button");
 addBtn.className = "btn-add-tag";
 addBtn.textContent = "＋ 標籤";
 addBtn.onclick = function() {
 openTextInputModal({
 title: "🏷️ 加入標籤",
 fields: [{ label: "標籤（可以用逗號同時加好幾個）", value: "", placeholder: "例如：帝國軍方, 主角群" }],
 okText: "加入",
 onSubmit: function(values) {
 if (!addManualTagsToActiveDoc(values[0])) { markTextInputInvalid(0); return false; }
 }
 });
 };
 bar.appendChild(addBtn);
}

/* 把輸入的一串標籤加到目前這篇。逗號（半形、全形）分隔，開頭的 # 會拿掉。
   回傳有沒有真的加到東西——全是空白或逗號的話回 false，讓彈窗留著。 */
function addManualTagsToActiveDoc(inputStr) {
 const doc = appData.docs.find(d => d.id === activeDocId);
 if (!doc) return false;
 const clean = String(inputStr || "").split(/[,，]/)
 .map(function(item) { return item.trim().replace(/^#/, ''); })
 .filter(Boolean);
 if (!clean.length) return false;

 if (!doc.tags) doc.tags = [];
 if (!Array.isArray(doc.manualTags)) doc.manualTags = [];
 clean.forEach(function(tag) {
 if (!doc.tags.includes(tag)) doc.tags.push(tag);
 if (!doc.manualTags.includes(tag)) doc.manualTags.push(tag);
 if (!appData.tagSettings[tag]) appData.tagSettings[tag] = "c_gray";
 });
 saveData();
 renderLiveHashtags(doc.tags);
 renderSidebarTree();
 return true;
}

function removeHashtagFromDoc(tag) {
 const doc = appData.docs.find(d => d.id === activeDocId);
 if (!doc) return;

 const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
 const inlineRe = new RegExp('#' + escaped + '(?=[\\s#]|$)', 'g');
 const existsInContent = inlineRe.test(doc.content || "");

 if (existsInContent) {
 const alsoRemoveFromText = confirm(
 '標籤「#' + tag + '」目前仍出現在內文中，若只移除標籤而不刪除內文文字，' +
 '下次編輯內文時它又會被重新偵測回來。\n\n是否要一併刪除內文中所有的「#' + tag + '」文字？'
 );
 if (!alsoRemoveFromText) return;

 inlineRe.lastIndex = 0;
 doc.content = (doc.content || "").replace(inlineRe, "");
 document.getElementById("docContentInput").value = doc.content;
 // 內文被改寫了，標示的位置不再正確
 if (typeof clearSearchHighlight === "function") clearSearchHighlight();
 if (typeof clearJumpHighlight === "function") clearJumpHighlight();
 }

 if (Array.isArray(doc.manualTags)) {
 doc.manualTags = doc.manualTags.filter(function(t) { return t !== tag; });
 }
 doc.tags = extractHashtagsFromText(doc.content || "").concat(doc.manualTags || []);
 doc.tags = doc.tags.filter(function(t, idx) { return doc.tags.indexOf(t) === idx; });

 const wordText = doc.content || "";
 const cjk = (wordText.match(/[\u4e00-\u9fa5]/g) || []).length;
 const eng = (wordText.replace(/[\u4e00-\u9fa5]/g, ' ').match(/\b[a-zA-Z0-9_]+\b/g) || []).length;
 doc.wordCount = cjk + eng;
 doc.updatedAt = formatTime(new Date());

 document.getElementById("statWordCount").textContent = doc.wordCount;
 document.getElementById("statUpdatedAt").textContent = doc.updatedAt;

 saveData();
 renderTOC(doc.content || "");
 renderLiveHashtags(doc.tags);
 renderSidebarTree();
 if (document.getElementById("quickJumpPanel").classList.contains("active")) {
 renderQuickJumpList(doc.content || "");
 }
}

/* ---------- 長按選單與 iOS 合成滑鼠事件 ----------

   選單是在手指還按著的時候跳出來的（長按 480ms，那時手指還沒放開）。

   那根手指放開時，iOS 會補一串「相容用」的 mouse 事件，目標是手指底下那個
   節點——不是選單。setupGlobalClickDismiss() 掛在 document 上的 mousedown /
   click 處理器看到「目標不在選單裡」，就把剛跳出來的選單關掉了。使用者看到
   的就是「長按看到清單，鬆手之後它就不見了」。

   （同一串合成事件也是白板節點會亂跑的元凶——那邊是用「這個移動事件跟開始
   拖曳的是不是同一次互動」擋掉的。這裡擋的是同一個東西的另一個出口。）

   做法：從長按叫出選單，到那根手指放開後的一小段時間為止，不接受「點到
   外面」的關閉。使用者真的想關的時候會有一次新的 touchstart，那時立刻解除，
   所以點旁邊關選單完全不受影響。

   為什麼不用單純的「開啟後 N 毫秒內不關」：手指可以按著不放兩秒再鬆手，
   合成事件是在「鬆手」時才來的，用開啟時間當基準擋不到。 */

const CTX_TOUCH_ECHO_MS = 700;   // 合成事件跟在 touchend 後面多久內會到
let ctxMenuHeldByTouch = false;  // 叫出選單的那根手指還按著嗎
let ctxMenuGuardUntil = 0;       // 放開之後還要再擋到什麼時候

/* 長按叫出選單時呼叫：手指還按著，先無限期擋著 */
function guardContextMenuFromTouchEcho() {
  ctxMenuHeldByTouch = true;
  ctxMenuGuardUntil = 0;
}

/* 那根手指放開了：再擋一小段時間，讓合成事件過完 */
function releaseContextMenuTouchGuard() {
  if (!ctxMenuHeldByTouch) return;
  ctxMenuHeldByTouch = false;
  ctxMenuGuardUntil = Date.now() + CTX_TOUCH_ECHO_MS;
}

/* 新的一次觸碰，或選單已經關了：那之後的事件都是使用者真的動作 */
function clearContextMenuTouchGuard() {
  ctxMenuHeldByTouch = false;
  ctxMenuGuardUntil = 0;
}

function contextMenuGuardActive() {
  return ctxMenuHeldByTouch || Date.now() < ctxMenuGuardUntil;
}

function showContextMenu(e, items, title) {
 if (e && e.preventDefault) e.preventDefault();
 if (e && e.stopPropagation) e.stopPropagation();

 const menu = document.getElementById("customContextMenu");
 const overlay = document.getElementById("ctxMenuOverlay");
 if (!menu || !overlay) return;
 menu.innerHTML = "";

 if (title) {
 const head = document.createElement("div");
 head.className = "ctx-menu-title";
 head.textContent = title;
 menu.appendChild(head);
 }

 items.forEach(function(item) {
 if (item.type === "divider") {
 const div = document.createElement("div");
 div.className = "ctx-menu-divider";
 menu.appendChild(div);
 return;
 }
 const el = document.createElement("div");
 el.className = "ctx-menu-item" + (item.danger ? " danger" : "");
 el.innerHTML = '<span class="ctx-menu-icon">' + (item.icon || "") + '</span><span>' + escapeHtml(item.label) + '</span>';
 el.onclick = function(ev) {
 ev.stopPropagation();
 closeContextMenu();
 item.action();
 };
 menu.appendChild(el);
 });

 overlay.classList.add("active");
 menu.classList.add("active");

 const isMobile = isMobileLayout();
 if (!isMobile) {
 // 電腦端隱藏遮罩，允許點擊穿透到底層元素
 overlay.style.pointerEvents = "none";
 overlay.style.background = "transparent";

 const point = (e && e.touches && e.touches[0]) || (e && e.changedTouches && e.changedTouches[0]) || e || { clientX: 40, clientY: 40 };
 const x = point.clientX;
 const y = point.clientY;
 menu.style.left = "-9999px";
 menu.style.top = "-9999px";
 requestAnimationFrame(function() {
 const rect = menu.getBoundingClientRect();
 let left = x, top = y;
 if (left + rect.width > window.innerWidth - 8) left = window.innerWidth - rect.width - 8;
 if (top + rect.height > window.innerHeight - 8) top = window.innerHeight - rect.height - 8;
 menu.style.left = Math.max(8, left) + "px";
 menu.style.top = Math.max(8, top) + "px";
 });
 } else {
 // 手機端恢復原本的半透明防呆遮罩
 overlay.style.pointerEvents = "auto";
 overlay.style.background = "";
 menu.style.left = "";
 menu.style.top = "";
 }
}

function closeContextMenu() {
 clearContextMenuTouchGuard();
 const menu = document.getElementById("customContextMenu");
 const overlay = document.getElementById("ctxMenuOverlay");
 if (menu) menu.classList.remove("active");
 if (overlay) overlay.classList.remove("active");
}

/* 長按時手指可以晃動多少還算「按著不動」。

   原本是 10px。實際用起來在平板上有機率叫不出選單——手拿著一台一公斤的
   機器，按住半秒手指晃十幾像素是常態，超過就被判成拖曳，計時器被清掉。
   放寬到 18px 之後才穩。

   放寬之後那十幾像素已經把節點拖走了，所以選單跳出來的同時要把拖曳
   取消並還原位置（cancelCanvasDragForMenu），兩件事是一組的。 */
const LONG_PRESS_SLOP_PX = 18;

/* 按多久才算長按。

   曾經有過一份拿 300ms 當門檻的量測程式，把按在 300～480ms 之間、本來就
   不該跳選單的那幾次算成了「長按失敗」，害人去查根本沒壞的東西。以後要再
   量這件事，讀這個常數，不要自己抄一個數字。 */
const LONG_PRESS_DELAY_MS = 480;

/* 選單跳出來的瞬間該做的事：取消白板上正在進行的拖曳。

   白板不一定載入（這個函式在目錄那邊也用），所以要先看在不在。 */
function cancelDragBeforeMenu() {
 if (typeof cancelCanvasDragForMenu === "function") cancelCanvasDragForMenu();
}

/* 按住一下下就「拿起來」，這時候移動＝拖曳。

   第一版是接在**長按選單之後**的：選單跳出來、手指不放繼續移動就變成拖曳
   （iOS 相簿是這個順序）。實機上不通，使用者回報「長按會出現菜單，然後有
   遮罩所以沒有辦法移動文件」。原因是這個 app 的選單在手機版**不是**開在手指
   底下的小方塊，而是**從底部滑上來的整片 sheet ＋ 半透明遮罩**——畫面一暗、
   一整片東西蓋上來，那是「這段手勢結束了」的訊號，沒有人會想繼續移動手指。
   把拖曳藏在那後面等於沒做。

   所以拖曳要**搶在選單前面**：

     0ms ──── 300ms ──────── 480ms
     按下     拿起來(震一下)   選單

   - 300ms 之前就移動 → 那是要捲動側欄，照舊
   - 停穩 300ms → 震一下＋那一列浮起來，「拿起來了」；之後移動就是拖曳，
     而且會把選單的計時器取消掉，選單根本不會出現
   - 停穩但一直不動 → 480ms 照舊跳選單（選單那條路完全沒變）
   - 撐過 480ms 看到選單才想拖 → 還是可以，選單會自己收掉

   兩個門檻的取捨：300ms 要短到「還沒看到選單就能開始拖」，又要長到不會把
   猶豫一下才開始的捲動誤判成拖曳（真正要捲的人幾乎都在 100ms 內就動了）。
   位移容忍值比 LONG_PRESS_SLOP_PX 小很多：那個 18px 是為了「拿著一公斤的
   平板手會晃」而放寬的，但這裡晃動會被誤判成「要拖了」，寧可嚴一點——
   反正沒拿起來就只是照常捲動，沒有損失。 */
const DRAG_ARM_HOLD_MS = 300;    // 停穩多久算「拿起來」
const DRAG_ARM_SLOP_PX = 8;      // 這段期間晃超過這麼多就當成要捲動
const DRAG_START_SLOP_PX = 8;    // 拿起來之後移動超過這麼多才真的開始拖

/* 從 window 的捕獲階段看著這一次觸碰，直到它結束。回傳一個停止函式。

   為什麼長按的「取消」不能只掛在元素自己身上：左緣滑動（setupEdgeSwipe）
   接手一個手勢之後會 stopPropagation()，免得底下的東西跟著動。它掛在
   document 的捕獲階段，所以接下來的 touchmove 與 touchend 全都到不了元素
   ——長按的計時器收不到「手指移動了」也收不到「手指放開了」，時間一到就
   照樣觸發。實際發生過三種：

   - 白板上從左緣右滑開目錄 → 長出一張便利貼
   - 目錄開著、按在某一列上往左滑收起來 → 目錄收掉之後那一列的選單跳出來
   - 拿起來之後往左下拖 → 被當成「收目錄」搶走

   window 的捕獲階段排在 document 之前，誰 stopPropagation 都擋不到這裡。
   這裡只看、只取消，不攔任何東西，所以排在最前面沒有副作用。

   每一次觸碰掛一組、結束就拆，不是 attach 的時候掛：目錄每重畫一次就會對
   每一列呼叫一次 attachContextMenu()，在那裡掛 window 監聽器會越疊越多。 */
function watchTouchFromWindow(onMove, onEnd) {
 function move(e) { onMove(e); }
 function end(e) { stop(); onEnd(e); }
 function stop() {
 window.removeEventListener("touchmove", move, true);
 window.removeEventListener("touchend", end, true);
 window.removeEventListener("touchcancel", end, true);
 }
 window.addEventListener("touchmove", move, { capture: true, passive: true });
 window.addEventListener("touchend", end, true);
 window.addEventListener("touchcancel", end, true);
 return stop;
}

/* 目前是不是有一列被「拿起來」了（含正在拖）。

   左緣滑動要問這個：拿起來之後往左拖是在搬東西，不是要收目錄。只存一個
   元素，因為同一時間只會有一根手指在拖。 */
let touchDragOwner = null;

function touchDragInProgress() {
 return !!touchDragOwner;
}

/* dragHooks（選填）：{ start(x, y), move(x, y), end(x, y), cancel() }
   給得出這幾個的元素，按住一下下再移動就會進入拖曳。 */
function attachContextMenu(element, itemsFn, titleFn, dragHooks) {
 if (!element) return;

 element.addEventListener("contextmenu", function(e) {
 e.preventDefault();
 e.stopPropagation();
 cancelDragBeforeMenu();
 showContextMenu(e, itemsFn(), titleFn ? titleFn() : null);
 });

 let pressTimer = null;
 let armTimer = null;
 let dragArmed = false;
 let dragging = false;
 let longPressTriggered = false;
 let startX = 0, startY = 0;
 let stopWatch = null;

 function clearTouchTimers() {
 clearTimeout(pressTimer);
 clearTimeout(armTimer);
 pressTimer = null;
 armTimer = null;
 }

 function disarmDrag() {
 dragArmed = false;
 element.classList.remove("drag-armed");
 if (touchDragOwner === element) touchDragOwner = null;
 }

 /* 手指移動：還沒停穩就動了，兩個計時器各自看自己的容忍值。 */
 function onWatchedMove(e) {
 if (!pressTimer && !armTimer) return;
 if (!e.touches || !e.touches[0]) return;
 const dx = Math.abs(e.touches[0].clientX - startX);
 const dy = Math.abs(e.touches[0].clientY - startY);

 // 還沒停穩就動了 → 這是要捲動側欄（或是左緣滑動），不要拿起來
 if (armTimer && (dx > DRAG_ARM_SLOP_PX || dy > DRAG_ARM_SLOP_PX)) {
 clearTimeout(armTimer);
 armTimer = null;
 }
 if (pressTimer && (dx > LONG_PRESS_SLOP_PX || dy > LONG_PRESS_SLOP_PX)) {
 clearTimeout(pressTimer);
 pressTimer = null;
 }
 }

 /* 手指放開（或被系統收走）。這一條一定收得到，所以計時器與「拿起來」的
    狀態都在這裡歸零。

    正在拖的話，收尾交給元素自己的 touchend（它要算放在哪裡）。但萬一那個
    touchend 被別人攔掉了，拖曳就永遠不會結束：幽靈掛在畫面上，
    touchDragOwner 也一直不清，左緣滑動從此再也打不開目錄。所以排一個
    下一輪的檢查——元素的 touchend 是同一次分派裡同步跑的，正常情況下
    這時 dragging 早就是 false 了，這一段什麼都不做。 */
 function onWatchedEnd() {
 stopWatch = null;
 clearTouchTimers();
 if (!dragging) { disarmDrag(); return; }
 setTimeout(function() {
 if (!dragging) return;
 dragging = false;
 disarmDrag();
 if (dragHooks && dragHooks.cancel) dragHooks.cancel();
 }, 0);
 }

 element.addEventListener("touchstart", function(e) {
 if (e.touches.length !== 1) return;
 e.stopPropagation();
 clearTouchTimers();
 disarmDrag();
 longPressTriggered = false;
 startX = e.touches[0].clientX;
 startY = e.touches[0].clientY;
 if (stopWatch) stopWatch();
 stopWatch = watchTouchFromWindow(onWatchedMove, onWatchedEnd);

 /* 拿起來。純粹是狀態＋回饋，不動畫面上任何別的東西——使用者到這裡
    還是可以直接放手（那就當成一般的點擊）。 */
 if (dragHooks) {
 armTimer = setTimeout(function() {
 armTimer = null;
 dragArmed = true;
 touchDragOwner = element;
 if (navigator.vibrate) { try { navigator.vibrate(8); } catch (err) {} }
 element.classList.add("drag-armed");
 }, DRAG_ARM_HOLD_MS);
 }

 pressTimer = setTimeout(function() {
 pressTimer = null;
 longPressTriggered = true;
 /* 選單接手了，那一列就不要再浮著——但 dragArmed 留著：撐過 480ms
    才想拖的人還是拖得動（選單會在拖曳開始時自己收掉）。 */
 element.classList.remove("drag-armed");
 if (navigator.vibrate) { try { navigator.vibrate(12); } catch (err) {} }
 cancelDragBeforeMenu();
 showContextMenu(e, itemsFn(), titleFn ? titleFn() : null);
 /* 一定要在 showContextMenu 之後：它會先 clearContextMenuTouchGuard() */
 guardContextMenuFromTouchEcho();
 }, LONG_PRESS_DELAY_MS);
 }, { passive: true });

 /* 拖曳那條路要擋掉預設行為（否則側欄會跟著手指捲動），所以必須是
    非被動的監聽器。刻意另外掛一個、不去動上面那個 passive 的：
    上面那個白板也在用，改成非被動會讓整片白板的捲動都付出代價。 */
 if (dragHooks) {
 element.addEventListener("touchmove", function(e) {
 /* dragging 也要看。開始拖之後 dragArmed 曾經被清掉過一次，結果第二個
    touchmove 就在這裡被擋回去了：幽靈停在第一次移動的位置不再跟著手指，
    而放手時是用 touchend 的座標去找目標，所以「東西還是搬對了」——
    看起來像成功，實際上整段拖曳是瞎的。 */
 if ((!dragArmed && !dragging) || e.touches.length !== 1) return;
 const t = e.touches[0];

 /* 一拿起來就擋，**不要等超過門檻才擋**。

    瀏覽器是看「第一次 touchmove 有沒有被 preventDefault」來決定要不要
    自己接手做捲動的。只要放過一次，它就接手了：之後再怎麼擋都沒用，
    而且它會補一個 touchcancel 過來，把拖到一半的狀態直接砍掉。
    第一版就是在門檻內先 return，所以實機上拖不動。

    合成事件測不出這件事（它不會真的觸發捲動），所以那個 bug 在測試裡
    是綠的——「因為錯的理由而通過」的標準案例。 */
 e.preventDefault();

 if (!dragging) {
 if (Math.abs(t.clientX - startX) <= DRAG_START_SLOP_PX &&
 Math.abs(t.clientY - startY) <= DRAG_START_SLOP_PX) return;
 dragging = true;
 /* 選單不要再跳出來了。拖曳已經開始，480ms 到的時候冒出一整片
    sheet 只會把畫面蓋掉。 */
 clearTimeout(pressTimer);
 pressTimer = null;
 closeContextMenu();        // 已經跳出來的話（撐過 480ms 才動）收掉
 /* 只收掉「浮起來」那個樣子，不要動 dragArmed —— 見上面那段註解。
    真正的歸零在 touchend / touchcancel。 */
 element.classList.remove("drag-armed");
 dragHooks.start(t.clientX, t.clientY);
 }

 e.stopPropagation();
 dragHooks.move(t.clientX, t.clientY);
 }, { passive: false });
 }

 element.addEventListener("touchend", function(e) {
 clearTouchTimers();
 disarmDrag();
 if (dragging) {
 dragging = false;
 e.preventDefault();
 e.stopPropagation();
 const t = e.changedTouches && e.changedTouches[0];
 dragHooks.end(t ? t.clientX : 0, t ? t.clientY : 0);
 return;
 }
 if (longPressTriggered) {
 e.preventDefault();
 e.stopPropagation();
 }
 });

 element.addEventListener("touchcancel", function() {
 clearTouchTimers();
 disarmDrag();
 /* 系統把手勢收走了（來電、多指、下拉通知）。拖到一半不能就這樣留著：
    幽靈會永遠掛在畫面上，而且下一次觸碰會接續到半途的狀態。 */
 if (dragging) {
 dragging = false;
 if (dragHooks.cancel) dragHooks.cancel();
 }
 });
}

function setupDirectoryContextMenu() {
 const overlay = document.getElementById("ctxMenuOverlay");
 if (overlay) overlay.onclick = closeContextMenu;

 attachContextMenu(document.getElementById("worldTreeContainer"), function() {
 return [
 { icon: "📁", label: "新增資料夾", action: function() { promptCreateFolder(null); } },
 { icon: "📄", label: "新增文檔", action: function() { createNewDoc(null); } }
 ];
 }, function() { return "📂 目錄操作"; });

 document.addEventListener("keydown", function(e) {
 if (e.key === "Escape") closeContextMenu();
 });
 window.addEventListener("resize", closeContextMenu);
 /* 捲動也擋：在 iOS 上鬆手常常會帶出一下回彈捲動，那跟合成滑鼠事件
    一樣不是使用者想關選單的意思。 */
 document.addEventListener("scroll", function() {
 if (contextMenuGuardActive()) return;
 closeContextMenu();
 }, true);

 /* 新的一次觸碰＝使用者真的動作，解除防護（點旁邊關選單因此不受影響） */
 document.addEventListener("touchstart", clearContextMenuTouchGuard, true);
 document.addEventListener("touchend", releaseContextMenuTouchGuard, true);
 document.addEventListener("touchcancel", releaseContextMenuTouchGuard, true);
}

function buildWorldMenuItems(world) {
 return [
 { icon: "✏️", label: "重新命名", action: function() { promptRenameItem("world", world.id, world.name); } },
 { icon: "📝", label: "一句話簡介", action: function() { promptEditWorldDesc(world.id); } },
 { icon: "🎨", label: "更換圖示", action: function() { openIconPicker("world", world.id); } },
 { icon: world.starred ? "☆" : "⭐", label: world.starred ? "取消最愛" : "加入最愛",
 action: function() { toggleWorldStar(world.id); } },
 { type: "divider" },
 { icon: "📁", label: "新增資料夾", action: function() { promptCreateFolder(null, world.id); } },
 { icon: "📄", label: "新增文檔", action: function() { createNewDoc(null, world.id); } },
 { type: "divider" },
 { icon: "🗑️", label: "刪除世界觀", danger: true, action: function() { deleteWorldById(world.id); } }
 ];
}

function buildFolderMenuItems(folder) {
 return [
 { icon: "✏️", label: "重新命名", action: function() { promptRenameItem("folder", folder.id, folder.name); } },
 { icon: "🎨", label: "更換圖示", action: function() { openIconPicker("folder", folder.id); } },
 { type: "divider" },
 { icon: "📁", label: "新增子資料夾", action: function() { promptCreateFolder(folder.id, folder.worldId); } },
 { icon: "📄", label: "新增文檔於此", action: function() { createNewDoc(folder.id, folder.worldId); } },
 { type: "divider" },
 { icon: "🔀", label: "移動資料夾", action: function() { promptMoveFolder(folder.id); } },
 { icon: "🗑️", label: "刪除資料夾", danger: true, action: function() { deleteFolderById(folder.id); } }
 ];
}

function buildDocMenuItems(doc) {
 return [
 { icon: "✏️", label: "重新命名", action: function() { promptRenameItem("doc", doc.id, doc.title || ""); } },
 { icon: "🎨", label: "更換圖示", action: function() { openIconPicker("doc", doc.id); } },
 { type: "divider" },
 { icon: "🔀", label: "移動文檔", action: function() { promptMoveDoc(doc.id); } },
 { icon: "🗑️", label: "刪除文檔", danger: true, action: function() { deleteDocById(doc.id); } }
 ];
}

/* opts（選填）：
     extra      蓋在每一筆上的欄位（刪世界觀時用來標 trashedWithWorld）
     keepCanvas 不要把白板節點拆進垃圾桶——刪整個世界觀時，節點已經在那個
                世界觀的整筆紀錄裡了，再拆一份的話復原時會變成兩份 */
function moveDocsToTrash(docsArray, opts) {
 if (!docsArray || !docsArray.length) return;
 opts = opts || {};
 const now = formatTime(new Date());
 docsArray.forEach(function(d) {
 // deletedAt 是給人看的字串，deletedTs 才是拿來算保留期限的
 appData.trash.docs.push(Object.assign({}, d, opts.extra || {}, { deletedAt: now, deletedTs: Date.now() }));
 delete docHistory[d.id];
 });

 /* 白板上指向這些文檔的節點與連線原本會留在資料裡（畫的時候跳過不畫），
    一直累積佔空間。一起收進垃圾桶，復原文檔之後節點也回得來。 */
 if (!opts.keepCanvas && typeof trashOrphanNodesForDocs === "function") {
 trashOrphanNodesForDocs(docsArray.map(function(d) { return d.id; }));
 }
}

function moveFoldersToTrash(foldersArray, opts) {
 if (!foldersArray || !foldersArray.length) return;
 opts = opts || {};
 const now = formatTime(new Date());
 foldersArray.forEach(function(f) {
 appData.trash.folders.push(Object.assign({}, f, opts.extra || {}, { deletedAt: now, deletedTs: Date.now() }));
 });
}

function openTrashModal() {
 renderTrashList();
 document.getElementById("trashModal").classList.add("active");
}

function closeTrashModal() {
 document.getElementById("trashModal").classList.remove("active");
}

/* 垃圾桶：所有世界觀共用一個，照世界觀分組、標出每一組是哪個世界觀的。

   （中間有一版是「每個世界觀的垃圾桶各自獨立」，使用者用過之後改回來了：
   全部放在一起，標示清楚是哪個世界觀的就好。）

   世界觀已經被刪掉的放最上面，名字從刪除時蓋在每一筆上的 fromWorldName
   拿（見 stampDeletedWorldOnTrash）。 */
function trashIsOrphan(item) {
 return !!item && !appData.worldviews.some(function(w) { return w.id === item.worldId; });
}

function renderTrashList() {
 const list = document.getElementById("trashList");
 if (!list) return;
 list.innerHTML = "";

 const folders = appData.trash.folders || [];
 const docs = appData.trash.docs || [];
 const worlds = appData.trash.worlds || [];
 /* 白板上刪掉的節點／連線／便條紙是用「在原本陣列裡的索引」復原與刪除的
    （這三種東西的 id 各自獨立、不保證不重複），分組之前先把索引帶著。 */
 /* 跟著某篇文檔的節點（因為刪那篇才進來的），只要那篇還在垃圾桶就不獨立
    列出——它們會跟著文檔一起復原或刪除。那篇不在垃圾桶了（早就被清掉、
    或復原時節點沒放回去）就照常列出來，不然會變成看不到的垃圾。 */
 const trashedDocIds = new Set(docs.map(function(d) { return d.id; }));
 const canvasItems = (appData.trash.canvas || [])
 .map(function(item, index) { return { item: item, index: index }; })
 .filter(function(e) {
 const docId = canvasTrashFollowsDoc(e.item);
 return !(docId && trashedDocIds.has(docId));
 });

 if (folders.length === 0 && docs.length === 0 && canvasItems.length === 0 && worlds.length === 0) {
 const empty = document.createElement("div");
 empty.className = "hashtag-filter-empty";
 empty.textContent = "垃圾桶目前是空的";
 list.appendChild(empty);
 return;
 }

 const canvasIcons = { node: '🔗', edge: '↔️', note: '🗒️' };
 function rowsFor(fs, ds, cs) {
 fs.forEach(function(f) {
 list.appendChild(createTrashRow(f.icon || '📁', f.name || '未命名資料夾', f.deletedAt, function() {
 restoreFolderFromTrash(f.id);
 }, function() {
 permanentlyDeleteTrashFolder(f.id);
 }));
 });
 ds.forEach(function(d) {
 list.appendChild(createTrashRow(d.icon || '📄', d.title || '無標題文檔', d.deletedAt, function() {
 restoreDocFromTrash(d.id);
 }, function() {
 permanentlyDeleteTrashDoc(d.id);
 }));
 });
 cs.forEach(function(e) {
 list.appendChild(createTrashRow(
 canvasIcons[e.item.kind] || '🧩',
 e.item.label || '白板項目',
 e.item.deletedAt,
 function() { const i = canvasTrashIndexOf(e.item, e.index); if (i >= 0 && restoreCanvasTrashItem(i)) renderTrashList(); },
 function() { const i = canvasTrashIndexOf(e.item, e.index); if (i >= 0) permanentlyDeleteCanvasTrashItem(i); }
 ));
 });
 }
 function heading(text, cls) {
 const h = document.createElement("div");
 h.className = cls;
 h.textContent = text;
 list.appendChild(h);
 }

 const groups = trashGroups(folders, docs, canvasItems, worlds);
 const gone = groups.filter(function(g) { return g.deleted; });
 const alive = groups.filter(function(g) { return !g.deleted; });

 /* 刪掉的世界觀：一個世界觀一列，「復原」就是整個世界觀回來。裡面有什麼
    不列出來（使用者：「不需要把刪除的世界觀裡面有什麼列出來」），只寫會
    一起回來幾項，讓人知道不是空的。 */
 if (gone.length) {
 heading("刪除的世界觀", "trash-section-title");
 gone.forEach(function(g) {
 list.appendChild(createTrashRow(g.icon || "🌐", g.name || "（名稱沒有留下來的世界觀）", g.deletedAt,
 function() { restoreWorldFromTrash(g.worldId); },
 function() { permanentlyDeleteTrashWorld(g.worldId); },
 g.restoreCount ? g.restoreCount + " 項" : ""));
 });
 // 上面有「刪除的世界觀」時才需要這個標題，把兩區分開
 if (alive.length) heading("現有的世界觀", "trash-section-title");
 }
 alive.forEach(function(g) {
 heading((g.icon || "🌐") + " " + g.name, "trash-group-title");
 rowsFor(g.folders, g.docs, g.canvas);
 });
}

/* 照世界觀分組。純函式，好測。

   順序：已經刪掉的世界觀在最上面（最近刪的在前），接著是現有的世界觀，照
   左側那一排的順序——跟使用者平常看到的順序一樣，比較好找。沒有東西的
   世界觀不列。 */
function trashGroups(folders, docs, canvasItems, worlds) {
 const byWorld = {};
 const order = [];
 const records = {};
 (worlds || []).forEach(function(w) { if (w && w.id) records[w.id] = w; });

 function slot(item) {
 const key = item.worldId || "?";
 if (!byWorld[key]) {
 const live = appData.worldviews.find(function(w) { return w.id === key; });
 const rec = records[key];
 byWorld[key] = {
 worldId: key, deleted: !live,
 name: live ? live.name : (rec ? rec.name : ""),
 icon: live ? (live.icon || "") : (rec ? (rec.icon || "") : ""),
 deletedAt: rec ? rec.deletedAt : "",
 hasRecord: !!rec,
 folders: [], docs: [], canvas: [], latest: rec ? (rec.deletedTs || 0) : 0,
 restoreCount: 0
 };
 order.push(key);
 }
 const g = byWorld[key];
 if (g.deleted && !g.name && item.fromWorldName) { g.name = item.fromWorldName; g.icon = item.fromWorldIcon || ""; }
 if (g.deleted && !g.deletedAt && item.deletedAt) g.deletedAt = item.deletedAt;
 if ((item.deletedTs || 0) > g.latest) g.latest = item.deletedTs || 0;
 return g;
 }

 // 整筆紀錄先登記：沒有任何文檔的世界觀刪掉之後也要看得到
 (worlds || []).forEach(function(w) { if (w && w.id) slot({ worldId: w.id }); });
 (folders || []).forEach(function(f) { slot(f).folders.push(f); });
 (docs || []).forEach(function(d) { slot(d).docs.push(d); });
 (canvasItems || []).forEach(function(e) { slot(e.item).canvas.push(e); });

 /* 復原時會一起回來幾項——跟 restoreWorldFromTrash() 同一條規則：有整筆
    紀錄的只算 trashedWithWorld 標記的；舊資料全部都算。 */
 order.forEach(function(k) {
 const g = byWorld[k];
 if (!g.deleted) return;
 const counts = function(x) { return !g.hasRecord || x.trashedWithWorld === k; };
 g.restoreCount = g.folders.filter(counts).length + g.docs.filter(counts).length;
 });

 const worldOrder = {};
 appData.worldviews.forEach(function(w, i) { worldOrder[w.id] = i; });
 const all = order.map(function(k) { return byWorld[k]; });
 const gone = all.filter(function(g) { return g.deleted; })
 .sort(function(a, b) { return b.latest - a.latest; });
 const alive = all.filter(function(g) { return !g.deleted; })
 .sort(function(a, b) { return worldOrder[a.worldId] - worldOrder[b.worldId]; });
 return gone.concat(alive);
}

function permanentlyDeleteCanvasTrashItem(index) {
 if (!confirm("確定要永久刪除這個白板項目嗎？此動作無法復原。")) return;
 appData.trash.canvas.splice(index, 1);
 saveData();
 renderTrashList();
}

/* 每一列兩行：第一行是名稱，第二行用補充說明的小字寫刪除時間。

   sub（選填）放在時間前面，刪掉的世界觀用它寫「N 項」：「4 項 · 2026-09-24 16:42」。

   以前時間是擠在名稱右邊的一欄，加上兩顆按鈕，手機上名稱只剩幾個字的寬度，
   世界觀的「· N 項」更是直接被截成「· 1…」（使用者要求：時間與項數都放
   第二行，所有刪掉的東西都一樣）。 */
function createTrashRow(icon, name, deletedAt, onRestore, onPermanentDelete, sub) {
 const row = document.createElement("div");
 row.className = "trash-item";

 const iconSpan = document.createElement("span");
 iconSpan.className = "trash-item-icon";
 iconSpan.textContent = icon;

 const nameSpan = document.createElement("span");
 nameSpan.className = "trash-item-name";
 nameSpan.textContent = name;

 /* 名稱與第二行包成一欄，佔住整個中間（flex: 1），名稱自己的省略號照舊。
    兩樣都沒有（很舊的資料沒記刪除時間）就不留一行空白。 */
 const second = [sub, deletedAt].filter(Boolean).join("　·　");
 let textBox = nameSpan;
 if (second) {
 textBox = document.createElement("span");
 textBox.className = "trash-item-text";
 const subSpan = document.createElement("span");
 subSpan.className = "trash-item-sub";
 subSpan.textContent = second;
 textBox.appendChild(nameSpan);
 textBox.appendChild(subSpan);
 }

 const actions = document.createElement("div");
 actions.className = "trash-item-actions";

 const restoreBtn = document.createElement("button");
 restoreBtn.className = "btn btn-secondary";
 restoreBtn.style.cssText = "font-size:11px; padding:3px 8px;";
 restoreBtn.textContent = "復原";
 restoreBtn.onclick = onRestore;

 const delBtn = document.createElement("button");
 delBtn.className = "btn btn-danger";
 delBtn.style.cssText = "font-size:11px; padding:3px 8px;";
 delBtn.textContent = "永久刪除";
 delBtn.onclick = onPermanentDelete;

 actions.appendChild(restoreBtn);
 actions.appendChild(delBtn);

 row.appendChild(iconSpan);
 row.appendChild(textBox);
 row.appendChild(actions);
 return row;
}

function restoreFolderFromTrash(folderId) {
 const idx = appData.trash.folders.findIndex(f => f.id === folderId);
 if (idx === -1) return;
 const [folder] = appData.trash.folders.splice(idx, 1);
 delete folder.deletedAt;
 delete folder.deletedTs;
 // 垃圾桶分組用的（見 stampDeletedWorldOnTrash），回到目錄之後就沒有意義了
 delete folder.fromWorldName;
 delete folder.fromWorldIcon;

 if (folder.parentId && !appData.folders.some(f => f.id === folder.parentId)) {
 folder.parentId = null;
 }
 if (!appData.worldviews.some(w => w.id === folder.worldId)) {
 folder.worldId = activeWorldId;
 }

 appData.folders.push(folder);
 saveData();
 renderSidebarTree();
 renderTrashList();
}

function restoreDocFromTrash(docId) {
 const idx = appData.trash.docs.findIndex(d => d.id === docId);
 if (idx === -1) return;
 const [doc] = appData.trash.docs.splice(idx, 1);
 delete doc.deletedAt;
 delete doc.deletedTs;
 delete doc.fromWorldName;
 delete doc.fromWorldIcon;

 if (doc.folderId && !appData.folders.some(f => f.id === doc.folderId)) {
 doc.folderId = null;
 }
 if (!appData.worldviews.some(w => w.id === doc.worldId)) {
 doc.worldId = activeWorldId;
 }
 if (!Array.isArray(doc.manualTags)) doc.manualTags = computeManualTagsFor(doc.content, doc.tags);

 appData.docs.push(doc);
 // 因為刪它才進垃圾桶的節點跟著回白板（它們在垃圾桶裡本來就沒有獨立列出來）
 if (typeof restoreNodesFollowingDoc === "function") restoreNodesFollowingDoc(doc.id);
 saveData();
 renderSidebarTree();
 renderTrashList();
}

function permanentlyDeleteTrashFolder(folderId) {
 if (!confirm("確定要永久刪除此資料夾嗎？此動作無法復原！")) return;
 appData.trash.folders = appData.trash.folders.filter(f => f.id !== folderId);
 saveData();
 renderTrashList();
}

function permanentlyDeleteTrashDoc(docId) {
 if (!confirm("確定要永久刪除此文檔嗎？此動作無法復原！")) return;
 appData.trash.docs = appData.trash.docs.filter(d => d.id !== docId);
 if (typeof dropNodesFollowingDoc === "function") dropNodesFollowingDoc(docId);
 saveData();
 renderTrashList();
}

function emptyTrash() {
 const t = appData.trash;
 const total = (t.docs || []).length + (t.folders || []).length + (t.canvas || []).length +
 (t.worlds || []).length;
 if (total === 0) { alert("垃圾桶目前是空的。"); return; }
 if (!confirm("確定要清空垃圾桶嗎？裡面的 " + total + " 個項目（所有世界觀的）將會永久刪除，此動作無法復原！")) return;
 t.docs = [];
 t.folders = [];
 t.canvas = [];
 t.worlds = [];
 saveData();
 renderTrashList();
}

function buildEmojiPicker() {
 const grid = document.getElementById("emojiGrid");
 grid.innerHTML = "";
 COMMON_ICONS.forEach(function(emoji) {
 const div = document.createElement("div");
 div.className = "emoji-opt";
 div.textContent = emoji;
 div.onclick = function() { document.getElementById("customIconInput").value = emoji; };
 grid.appendChild(div);
 });
}

function openIconPicker(type, id) {
 iconPickerContext = { type: type, id: id };
 let currentIcon = "📄";
 if (type === 'world') {
 const w = appData.worldviews.find(x => x.id === id);
 currentIcon = w ? w.icon : "🌐";
 } else if (type === 'folder') {
 const f = appData.folders.find(x => x.id === id);
 currentIcon = f ? f.icon : "📁";
 } else if (type === 'doc') {
 const d = appData.docs.find(x => x.id === id);
 currentIcon = d ? d.icon : "📄";
 }
 document.getElementById("customIconInput").value = currentIcon || "";
 document.getElementById("iconPickerModal").classList.add("active");
}

function closeIconPickerModal() {
 document.getElementById("iconPickerModal").classList.remove("active");
}

function applyCustomIcon() {
 const val = document.getElementById("customIconInput").value.trim() || "📄";
 const ctx = iconPickerContext;
 if (ctx.type === 'world') {
 const w = appData.worldviews.find(x => x.id === ctx.id);
 if (w) { w.icon = val; updateWorldBadge(); }
 } else if (ctx.type === 'folder') {
 const f = appData.folders.find(x => x.id === ctx.id);
 if (f) f.icon = val;
 } else if (ctx.type === 'doc') {
 const d = appData.docs.find(x => x.id === ctx.id);
 if (d) {
 d.icon = val;
 if (d.id === activeDocId) document.getElementById("docIconBtn").textContent = val;
 }
 }
 saveData();
 renderSidebarTree();
 renderBreadcrumb();
 // 節點左上角顯示的就是這個圖示，正在看白板時要一起更新
 refreshCanvasIfVisible();
 closeIconPickerModal();
}

function openPaletteModal() {
 const container = document.getElementById("paletteConfigList");
 container.innerHTML = "";

 Object.keys(DEFAULT_PALETTES).forEach(function(key) {
 const pal = getPalette(key);
 const row = document.createElement("div");
 row.className = "palette-row";

 const circle = document.createElement("div");
 circle.className = "palette-circle";
 circle.style.backgroundColor = pal.bg;
 circle.style.borderColor = pal.text;

 const inputWrap = document.createElement("div");
 inputWrap.className = "palette-input-wrap";
 inputWrap.innerHTML = '<input type="text" class="form-input" id="pal_name_' + key + '" value="' + escapeHtml(pal.name) + '" placeholder="請輸入標籤分類名稱...">';

 row.appendChild(circle);
 row.appendChild(inputWrap);
 container.appendChild(row);
 });

 document.getElementById("paletteModal").classList.add("active");
}

function cancelPaletteModal() {
 document.getElementById("paletteModal").classList.remove("active");
}

function closePaletteModal() {
 Object.keys(DEFAULT_PALETTES).forEach(function(key) {
 const input = document.getElementById("pal_name_" + key);
 if (input && input.value.trim()) {
 if (!appData.colorPalette[key]) appData.colorPalette[key] = Object.assign({}, DEFAULT_PALETTES[key]);
 appData.colorPalette[key].name = input.value.trim();
 }
 });
 saveData();
 document.getElementById("paletteModal").classList.remove("active");
 const currentDoc = appData.docs.find(d => d.id === activeDocId);
 if (currentDoc) renderLiveHashtags(currentDoc.tags);
}

function openColorPicker(tag, anchorElement) {
 const popover = document.getElementById("colorPickerPopover");
 popover.innerHTML = '<div style="font-size:11px; font-weight:700; color:var(--text-muted); margin-bottom:4px;">指定分類顏色：</div>';

 Object.keys(DEFAULT_PALETTES).forEach(function(key) {
 const pal = getPalette(key);
 const opt = document.createElement("div");
 opt.className = "picker-option";
 opt.innerHTML = `<span style="width:14px; height:14px; border-radius:50%; background:${pal.bg}; border:1.5px solid ${pal.text};"></span><span style="color:${pal.text}; font-weight:600;">${escapeHtml(pal.name)}</span>`;
 opt.onclick = function() {
 appData.tagSettings[tag] = key;
 saveData();
 closeAnchoredPopover();
 const currentDoc = appData.docs.find(d => d.id === activeDocId);
 if (currentDoc) renderLiveHashtags(currentDoc.tags);
 };
 popover.appendChild(opt);
 });

 const divider = document.createElement("div");
 divider.className = "picker-option-divider";
 popover.appendChild(divider);

 const removeOpt = document.createElement("div");
 removeOpt.className = "picker-option picker-option-danger";
 removeOpt.innerHTML = '<span style="width:14px; text-align:center;">✕</span><span>移除此標籤</span>';
 removeOpt.onclick = function() {
 closeAnchoredPopover();
 removeHashtagFromDoc(tag);
 };
 popover.appendChild(removeOpt);

 /* 定位交給 openAnchoredPopover()：它用視窗座標、會在捲動時跟著錨點跑，
    而且放不下時會自動翻到標籤上方。原本這裡是自己算一次就固定，
    標籤所在的編輯區一捲動，選單就留在原地指著錯的東西。 */
 openAnchoredPopover(popover, anchorElement);
}

function promptMoveFolder(folderId) {
 openMoveModal({ type: "folder", id: folderId });
}

/* 文檔也走同一個彈窗。

   拖曳（滑鼠或手指）是快的那條路，但它要求兩端同時看得到——文檔在最底下、
   目標資料夾收在最上面時，拖起來很痛苦。這個選單項目是那種情況的退路，
   而且它在任何裝置上都一定會動。 */
function promptMoveDoc(docId) {
 openMoveModal({ type: "doc", id: docId });
}

function openMoveModal(ref) {
 moveTargetRef = ref;
 const select = document.getElementById("moveTargetSelect");
 select.innerHTML = "";

 const title = document.getElementById("moveModalTitle");
 if (title) {
 title.textContent = ref.type === "doc"
 ? "🔀 移動文檔或更改所屬世界觀"
 : "🔀 移動資料夾或更改所屬世界觀";
 }

 /* 順序與排除規則都在 moveTargetOptions()（純函式，有測試）。
    option 的文字用 textContent：世界觀與資料夾的名字是使用者寫的。 */
 moveTargetOptions(ref).forEach(function(o) {
 const opt = document.createElement("option");
 opt.value = JSON.stringify({ worldId: o.worldId, parentId: o.parentId });
 opt.textContent = o.label + (o.current ? "　（目前位置）" : "");
 if (o.current) opt.selected = true;
 select.appendChild(opt);
 });

 updateMoveModeVisibility();

 document.getElementById("moveModal").classList.add("active");
}

/* 目的地是不是在別的世界觀。只有這種時候才問「移動還是複製」。 */
function moveTargetIsOtherWorld() {
 const select = document.getElementById("moveTargetSelect");
 if (!select || !select.value || !moveTargetRef) return false;
 const target = JSON.parse(select.value);
 const src = moveTargetRef.type === "doc"
 ? appData.docs.find(d => d.id === moveTargetRef.id)
 : appData.folders.find(f => f.id === moveTargetRef.id);
 return !!src && src.worldId !== target.worldId;
}

/* 目的地換了就重算：「複製」那顆只在別的世界觀時出現，底下那行說明也是。 */
function updateMoveModeVisibility() {
 const copyBtn = document.getElementById("moveCopyBtn");
 const hint = document.getElementById("moveModeHint");
 const other = moveTargetIsOtherWorld();
 if (copyBtn) copyBtn.hidden = !other;
 if (hint) {
 /* 兩顆按鈕的後果差很多，講清楚：移動的話原本那張白板上的節點會收進
    垃圾桶；複製的話白板不會跟著過去。 */
 hint.hidden = !other;
 hint.textContent = other
 ? "複製：原本的留在這裡，白板節點不跟過去。移動：這邊白板上的節點會收進垃圾桶（救得回來）。"
 : "";
 }
}

function closeMoveModal() { 
document.getElementById("moveModal").classList.remove("active"); 
}

/* mode：按了哪一顆，"copy" 或 "move"。

   「複製」那顆在同一個世界觀時是藏起來的，但還是再擋一次：按鈕狀態跟目的地
   不同步的那一瞬間（例如改了選項、change 事件還沒到），同世界觀的複製會在
   同一個目錄多出一份一樣的。 */
function confirmMoveOrCopy(mode) {
 const select = document.getElementById("moveTargetSelect");
 if (!select.value || !moveTargetRef) return;
 const target = JSON.parse(select.value);
 const payload = { type: moveTargetRef.type, id: moveTargetRef.id };
 const crossWorld = moveTargetIsOtherWorld();
 if (mode === "copy" && !crossWorld) return;
 if (mode !== "copy") mode = "move";
 const movedActiveDoc = crossWorld && mode === "move" && (
 (payload.type === "doc" && payload.id === activeDocId) ||
 (payload.type === "folder" && folderSubtree(payload.id).docIds.has(activeDocId)));
 closeMoveModal();

 if (mode === "copy") {
 if (!copyItemInto(payload, target.parentId, target.worldId)) return;
 saveData();
 renderSidebarTree();
 } else {
 /* 搬移的規則（含「不能搬進自己的子孫」）只寫在 moveItemInto() 裡一份，
    拖曳與這個彈窗都走它。 */
 if (!moveItemInto(payload, target.parentId, target.worldId)) return;
 }
 if (!crossWorld) return;

 /* 跨世界觀之後，目前這個世界觀裡看不到任何變化（複製）或東西直接不見
    （移動）——兩種都會讓人懷疑到底有沒有成功。問一句要不要過去看，
    順便當作「完成了」的回報。 */
 const world = appData.worldviews.find(w => w.id === target.worldId);
 const name = world ? world.name : "那個世界觀";
 if (confirm((mode === "copy" ? "已複製到「" : "已移動到「") + name + "」。\n要切過去看嗎？")) {
 const keepDoc = movedActiveDoc ? activeDocId : null;
 selectWorld(target.worldId);
 if (keepDoc) loadDocToEditor(keepDoc);      // 正在寫的那篇跟著過去，不要換成別篇
 return;
 }

 /* 不過去的話：正在編輯的那篇已經不在這個世界觀了，編輯區不能繼續顯示它
    （麵包屑、白板、字數都會對不上）。跟刪除之後一樣，換成這裡的第一篇。 */
 if (movedActiveDoc) {
 const rest = appData.docs.filter(d => d.worldId === activeWorldId);
 if (rest.length) loadDocToEditor(rest[0].id);
 else clearEditorWorkspace();
 renderSidebarTree();
 }
}

/* ==========================================================
   輸入名稱的彈窗（取代瀏覽器內建的 prompt()）

   為什麼不用 prompt()：
   - 使用者要的是「預設文字反藍，直接打字就取代」。prompt() 的預設文字
     選不選取是瀏覽器自己決定的，iOS 是游標停在最後、不選取，得先手動
     刪掉「新分類」才能打。那個行為程式碼碰不到。
   - 新增世界觀要同時填名稱與一句話簡介，prompt() 只有一個欄位。

   觸控裝置上這個彈窗**會**主動聚焦並叫出鍵盤，跟 setupModalKeyboard()
   的規則相反。那條規則的理由是「很多彈窗一打開先想看內容、未必要打字」；
   這個彈窗唯一的用途就是打字，不聚焦反而要多點一下。聚焦一定要在點擊
   的同一個呼叫堆疊裡同步做，iOS 才肯叫出鍵盤。

   用法：
     openTextInputModal({
       title: "📁 新增資料夾",
       fields: [{ label: "名稱", value: "新分類" }, ...],   // 一或兩欄
       okText: "建立",
       onSubmit: function(values) { ...; return true; }     // 回 false＝不關
     });
   ========================================================== */
let textInputSubmit = null;

function openTextInputModal(opts) {
  const modal = document.getElementById("textInputModal");
  const box = document.getElementById("textInputFields");
  if (!modal || !box) return;

  document.getElementById("textInputTitle").textContent = opts.title || "";
  document.getElementById("textInputOkBtn").textContent = opts.okText || "確定";
  textInputSubmit = opts.onSubmit || null;

  box.innerHTML = "";
  const inputs = (opts.fields || []).map(function(f, i) {
    const wrap = document.createElement("label");
    wrap.className = "text-input-field";
    const cap = document.createElement("span");
    cap.className = "text-input-label";
    cap.textContent = f.label || "";
    const input = document.createElement("input");
    input.type = "text";
    input.className = "form-input";
    input.value = f.value || "";
    input.placeholder = f.placeholder || "";
    if (f.maxLength) input.maxLength = f.maxLength;
    input.dataset.index = String(i);
    wrap.appendChild(cap);
    wrap.appendChild(input);
    box.appendChild(wrap);
    return input;
  });

  inputs.forEach(function(input, i) {
    input.addEventListener("input", function() { input.classList.remove("is-invalid"); });
    input.addEventListener("keydown", function(e) {
      if (e.key !== "Enter") return;
      /* 用注音、倉頡選字時按的 Enter 是「確定這個字」，不是「送出」。
         不擋的話打「騎士」選完字就直接建立了一個叫「qi shi」或半截的資料夾。
         keyCode 229 是部分瀏覽器（含 iOS）在組字中給的值。 */
      if (e.isComposing || e.keyCode === 229) return;
      e.preventDefault();
      if (i < inputs.length - 1) focusAndSelect(inputs[i + 1]);   // 還有下一欄就跳過去
      else submitTextInputModal();
    });
  });

  // 關掉之後焦點要還回去（setupModalKeyboard 的規矩），先記下來再聚焦
  if (typeof focusBeforeModal !== "undefined" && !focusBeforeModal) focusBeforeModal = document.activeElement;
  modal.classList.add("active");
  if (inputs[0]) focusAndSelect(inputs[0]);
}

/* 聚焦並全選。select() 在 iOS 上不一定生效，setSelectionRange 補一次；
   下一格再補一次是因為 iOS 升鍵盤的過程中會把選取範圍重設掉。那一次只在
   使用者還沒動過內容時才做，免得把他剛打的字又選起來。 */
function focusAndSelect(input) {
  const original = input.value;
  input.focus();
  input.select();
  try { input.setSelectionRange(0, input.value.length); } catch (e) {}
  requestAnimationFrame(function() {
    if (document.activeElement !== input || input.value !== original) return;
    try { input.setSelectionRange(0, input.value.length); } catch (e) {}
  });
}

function textInputValues() {
  return Array.from(document.querySelectorAll("#textInputFields input"))
    .map(function(x) { return x.value; });
}

function submitTextInputModal() {
  const fn = textInputSubmit;
  if (fn && fn(textInputValues()) === false) return;     // 呼叫端說還不能關（例如名稱留白）
  closeTextInputModal();
}

function closeTextInputModal() {
  textInputSubmit = null;
  const modal = document.getElementById("textInputModal");
  if (modal) modal.classList.remove("active");
}

/* 呼叫端拒絕送出時用：把那一欄標紅並重新選起來。 */
function markTextInputInvalid(index) {
  const input = document.querySelectorAll("#textInputFields input")[index || 0];
  if (!input) return;
  input.classList.add("is-invalid");
  focusAndSelect(input);
}
