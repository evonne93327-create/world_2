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

function jumpToLine(lineIndex) {
 const textarea = document.getElementById("docContentInput");
 const lines = textarea.value.split("\n");
 let pos = 0;
 for (let i = 0; i < lineIndex && i < lines.length; i++) {
 pos += lines[i].length + 1;
 }
 const lineLength = (lines[lineIndex] || "").length;

 textarea.focus();
 textarea.setSelectionRange(pos, pos + lineLength);
 const percent = pos / Math.max(1, textarea.value.length);
 textarea.scrollTop = (textarea.scrollHeight - textarea.clientHeight) * percent;

 closeQuickJumpPanel();
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

 Object.keys(appData.colorPalette).forEach(function(colorId) {
 const palette = appData.colorPalette[colorId] || DEFAULT_PALETTES.c_gray;
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
 const palette = appData.colorPalette[item.colorId] || DEFAULT_PALETTES.c_gray;

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

 if (window.innerWidth <= 768) closeSidebarMobile();
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
 const palette = appData.colorPalette[colorId] || DEFAULT_PALETTES.c_gray;

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
 const inputStr = prompt("請輸入欲加入的 Hashtag（可用逗號「,」同時新增多個）：");
 if (inputStr && inputStr.trim()) {
 const rawTags = inputStr.split(/[,，]/);
 const doc = appData.docs.find(d => d.id === activeDocId);
 if (doc) {
 if (!doc.tags) doc.tags = [];
 if (!Array.isArray(doc.manualTags)) doc.manualTags = [];
 rawTags.forEach(function(item) {
 const clean = item.trim().replace(/^#/, '');
 if (!clean) return;
 if (!doc.tags.includes(clean)) doc.tags.push(clean);
 if (!doc.manualTags.includes(clean)) doc.manualTags.push(clean);
 if (!appData.tagSettings[clean]) appData.tagSettings[clean] = "c_gray";
 });
 saveData();
 renderLiveHashtags(doc.tags);
 renderSidebarTree();
 }
 }
 };
 bar.appendChild(addBtn);
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

 const isMobile = window.innerWidth <= 768;
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
 const menu = document.getElementById("customContextMenu");
 const overlay = document.getElementById("ctxMenuOverlay");
 if (menu) menu.classList.remove("active");
 if (overlay) overlay.classList.remove("active");
}

function attachContextMenu(element, itemsFn, titleFn) {
 if (!element) return;

 element.addEventListener("contextmenu", function(e) {
 e.preventDefault();
 e.stopPropagation();
 showContextMenu(e, itemsFn(), titleFn ? titleFn() : null);
 });

 let pressTimer = null;
 let longPressTriggered = false;
 let startX = 0, startY = 0;

 element.addEventListener("touchstart", function(e) {
 if (e.touches.length !== 1) return;
 e.stopPropagation();
 longPressTriggered = false;
 startX = e.touches[0].clientX;
 startY = e.touches[0].clientY;
 pressTimer = setTimeout(function() {
 longPressTriggered = true;
 if (navigator.vibrate) { try { navigator.vibrate(12); } catch (err) {} }
 showContextMenu(e, itemsFn(), titleFn ? titleFn() : null);
 }, 480);
 }, { passive: true });

 element.addEventListener("touchmove", function(e) {
 if (!pressTimer) return;
 const dx = Math.abs(e.touches[0].clientX - startX);
 const dy = Math.abs(e.touches[0].clientY - startY);
 if (dx > 10 || dy > 10) {
 clearTimeout(pressTimer);
 pressTimer = null;
 }
 }, { passive: true });

 element.addEventListener("touchend", function(e) {
 clearTimeout(pressTimer);
 pressTimer = null;
 if (longPressTriggered) {
 e.preventDefault();
 e.stopPropagation();
 }
 });

 element.addEventListener("touchcancel", function() {
 clearTimeout(pressTimer);
 pressTimer = null;
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
 document.addEventListener("scroll", closeContextMenu, true);
}

function buildWorldMenuItems(world) {
 return [
 { icon: "✏️", label: "重新命名", action: function() { promptRenameItem("world", world.id, world.name); } },
 { icon: "🎨", label: "更換圖示", action: function() { openIconPicker("world", world.id); } },
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
 { icon: "🗑️", label: "刪除文檔", danger: true, action: function() { deleteDocById(doc.id); } }
 ];
}

function moveDocsToTrash(docsArray) {
 if (!docsArray || !docsArray.length) return;
 const now = formatTime(new Date());
 docsArray.forEach(function(d) {
 appData.trash.docs.push(Object.assign({}, d, { deletedAt: now }));
 delete docHistory[d.id];
 });
}

function moveFoldersToTrash(foldersArray) {
 if (!foldersArray || !foldersArray.length) return;
 const now = formatTime(new Date());
 foldersArray.forEach(function(f) {
 appData.trash.folders.push(Object.assign({}, f, { deletedAt: now }));
 });
}

function openTrashModal() {
 renderTrashList();
 document.getElementById("trashModal").classList.add("active");
}

function closeTrashModal() {
 document.getElementById("trashModal").classList.remove("active");
}

function renderTrashList() {
 const list = document.getElementById("trashList");
 if (!list) return;
 list.innerHTML = "";

 const folders = appData.trash.folders || [];
 const docs = appData.trash.docs || [];

 if (folders.length === 0 && docs.length === 0) {
 list.innerHTML = '<div class="hashtag-filter-empty">垃圾桶目前是空的</div>';
 return;
 }

 folders.forEach(function(f) {
 list.appendChild(createTrashRow(f.icon || '📁', f.name || '未命名資料夾', f.deletedAt, function() {
 restoreFolderFromTrash(f.id);
 }, function() {
 permanentlyDeleteTrashFolder(f.id);
 }));
 });

 docs.forEach(function(d) {
 list.appendChild(createTrashRow(d.icon || '📄', d.title || '無標題文檔', d.deletedAt, function() {
 restoreDocFromTrash(d.id);
 }, function() {
 permanentlyDeleteTrashDoc(d.id);
 }));
 });
}

function createTrashRow(icon, name, deletedAt, onRestore, onPermanentDelete) {
 const row = document.createElement("div");
 row.className = "trash-item";

 const iconSpan = document.createElement("span");
 iconSpan.className = "trash-item-icon";
 iconSpan.textContent = icon;

 const nameSpan = document.createElement("span");
 nameSpan.className = "trash-item-name";
 nameSpan.textContent = name;

 const metaSpan = document.createElement("span");
 metaSpan.className = "trash-item-meta";
 metaSpan.textContent = deletedAt || "";

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
 row.appendChild(nameSpan);
 row.appendChild(metaSpan);
 row.appendChild(actions);
 return row;
}

function restoreFolderFromTrash(folderId) {
 const idx = appData.trash.folders.findIndex(f => f.id === folderId);
 if (idx === -1) return;
 const [folder] = appData.trash.folders.splice(idx, 1);
 delete folder.deletedAt;

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

 if (doc.folderId && !appData.folders.some(f => f.id === doc.folderId)) {
 doc.folderId = null;
 }
 if (!appData.worldviews.some(w => w.id === doc.worldId)) {
 doc.worldId = activeWorldId;
 }
 if (!Array.isArray(doc.manualTags)) doc.manualTags = computeManualTagsFor(doc.content, doc.tags);

 appData.docs.push(doc);
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
 saveData();
 renderTrashList();
}

function emptyTrash() {
 const total = (appData.trash.docs || []).length + (appData.trash.folders || []).length;
 if (total === 0) { alert("垃圾桶目前是空的。"); return; }
 if (!confirm("確定要清空垃圾桶嗎？裡面的 " + total + " 個項目將會永久刪除，此動作無法復原！")) return;
 appData.trash.docs = [];
 appData.trash.folders = [];
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
 const pal = appData.colorPalette[key] || DEFAULT_PALETTES[key];
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
 const pal = appData.colorPalette[key] || DEFAULT_PALETTES[key];
 const opt = document.createElement("div");
 opt.className = "picker-option";
 opt.innerHTML = `<span style="width:14px; height:14px; border-radius:50%; background:${pal.bg}; border:1.5px solid ${pal.text};"></span><span style="color:${pal.text}; font-weight:600;">${escapeHtml(pal.name)}</span>`;
 opt.onclick = function() {
 appData.tagSettings[tag] = key;
 saveData();
 popover.classList.remove("active");
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
 popover.classList.remove("active");
 removeHashtagFromDoc(tag);
 };
 popover.appendChild(removeOpt);

 const rect = anchorElement.getBoundingClientRect();
 popover.style.top = (rect.bottom + window.scrollY + 6) + "px";
 popover.style.left = Math.max(10, rect.left + window.scrollX) + "px";
 popover.classList.add("active");
}

function promptMoveFolder(folderId) {
 moveFolderTargetId = folderId;
 const select = document.getElementById("moveTargetSelect");
 select.innerHTML = "";

 appData.worldviews.forEach(function(w) {
 const opt = document.createElement("option");
 opt.value = JSON.stringify({ worldId: w.id, parentId: null });
 opt.textContent = "🌐 " + w.name + " (根目錄)";
 select.appendChild(opt);
 });

 appData.folders.forEach(function(f) {
 if (f.id !== folderId && f.parentId !== folderId && !isDescendantOf(folderId, f.id)) {
 const opt = document.createElement("option");
 opt.value = JSON.stringify({ worldId: f.worldId, parentId: f.id });
 opt.textContent = "📁 " + f.name;
 select.appendChild(opt);
 }
 });

 document.getElementById("moveModal").classList.add("active");
}

function closeMoveModal() { 
document.getElementById("moveModal").classList.remove("active"); 
}

function confirmMoveFolder() {
 const select = document.getElementById("moveTargetSelect");
 if (!select.value || !moveFolderTargetId) return;
 const target = JSON.parse(select.value);
 const folder = appData.folders.find(f => f.id === moveFolderTargetId);
 if (folder) {
 folder.worldId = target.worldId;
 folder.parentId = target.parentId;
 saveData();
 renderSidebarTree();
 renderBreadcrumb();
 }
 closeMoveModal();
}