/* ==========================================================
 目錄與資料夾操作
 ========================================================== */

function selectWorld(worldId) {
 if (activeWorldId === worldId) return;
 activeWorldId = worldId;
 activeFolderId = null;

 const docsInWorld = appData.docs.filter(d => d.worldId === worldId);
 if (docsInWorld.length > 0) {
 loadDocToEditor(docsInWorld[0].id);
 } else {
 clearEditorWorkspace();
 }

 updateWorldBadge();
 renderSidebarTree();
 if (activeView === 'canvas') renderCanvas();
}

function clearEditorWorkspace() {
 activeDocId = null;
 document.getElementById("docIconBtn").textContent = "📄";
 document.getElementById("docTitleInput").value = "";
 document.getElementById("docContentInput").value = "";
 if (typeof clearSearchHighlight === "function") clearSearchHighlight();
 autoGrowTextarea(document.getElementById("docContentInput"));
 document.getElementById("statWordCount").textContent = "0";
 document.getElementById("statUpdatedAt").textContent = "--";
 document.getElementById("liveTagToolbar").innerHTML = "";
 document.getElementById("docImagesContainer").innerHTML = "";
 document.getElementById("tocCard").style.display = "none";
 document.getElementById("docBreadcrumbBar").innerHTML = '<span class="breadcrumb-item" style="color:var(--text-muted);">（目前世界觀尚無文件）</span>';
 updateUndoRedoButtons(null);
}

function renderWorldRail() {
 const container = document.getElementById("worldRailContainer");
 if (!container) return;
 container.innerHTML = "";

 appData.worldviews.forEach(function(world) {
 const btn = document.createElement("button");
 btn.className = "world-rail-btn " + (world.id === activeWorldId ? "active" : "");
 btn.title = world.name;
 btn.textContent = world.icon || "🌐";

 btn.onclick = function() {
 selectWorld(world.id);
 };

 attachContextMenu(btn, function() { return buildWorldMenuItems(world); }, function() { return (world.icon || '🌐') + ' ' + world.name; });
 container.appendChild(btn);
 });
}

function updateWorldBadge() {
 const world = appData.worldviews.find(w => w.id === activeWorldId);
 if (world) {
 const icon = world.icon || '🌐';
 document.getElementById("currentWorldIcon").textContent = icon;
 document.getElementById("currentWorldName").textContent = world.name;
 }
 renderWorldRail();
}

function renderSidebarTree() {
 const container = document.getElementById("worldTreeContainer");
 const search = document.getElementById("searchInput").value.trim().toLowerCase();
 container.innerHTML = "";

 renderBreadcrumb();

 const currentWorld = appData.worldviews.find(w => w.id === activeWorldId);
 if (!currentWorld) return;

 if (search) {
 renderActiveDocSearchPin(container, search);
 }

 renderFolderLevel(currentWorld.id, null, container, search);
}

function folderHasChildren(folderId) {
 return appData.folders.some(f => f.parentId === folderId) ||
 appData.docs.some(d => d.folderId === folderId);
}

/* 搜尋時，這個資料夾（含它底下所有層）裡有沒有命中的文檔。

   原本搜尋只過濾文檔、資料夾一律照畫，所以搜「騎士」會看到一整棵完整的
   樹，兩筆結果散在裡面要自己用眼睛找。現在整個子樹都沒命中就不畫。

   遞迴時把走過的資料夾記下來，資料損毀造成 parentId 繞成圈時才不會無限遞迴。 */
function folderSubtreeHasMatch(worldId, folderId, search, seen) {
 seen = seen || {};
 if (seen[folderId]) return false;
 seen[folderId] = true;

 const hit = appData.docs.some(function(d) {
 return d.worldId === worldId && d.folderId === folderId && docMatchesSearch(d, search);
 });
 if (hit) return true;

 return appData.folders.some(function(f) {
 return f.worldId === worldId && f.parentId === folderId &&
 folderSubtreeHasMatch(worldId, f.id, search, seen);
 });
}

function renderFolderLevel(worldId, parentId, parentElement, search) {
 let folders = appData.folders.filter(f => f.worldId === worldId && f.parentId === parentId);
 if (search) {
 folders = folders.filter(function(f) { return folderSubtreeHasMatch(worldId, f.id, search); });
 }

 folders.forEach(function(folder) {
 const folderDiv = document.createElement("div");
 folderDiv.className = "folder-group";

 const isCollapsed = !!collapsedFolders[folder.id];
 const folderRow = document.createElement("div");
 folderRow.className = "node-row-outer";
 folderRow.draggable = true;

 folderRow.ondragstart = function(e) {
 e.stopPropagation();
 e.dataTransfer.setData("text/plain", JSON.stringify({ type: "folder", id: folder.id }));
 };

 let rowStateClass = (folder.id === activeFolderId ? " selected" : "");
 if (isBatchDeleteMode && batchSelectedFolders.has(folder.id)) {
 rowStateClass += " batch-checked";
 }

 folderRow.onclick = function(e) {
 if (e.target.closest('.folder-caret') || e.target.closest('.node-icon')) return;
 if (isBatchDeleteMode) {
 toggleBatchItemSelection('folder', folder.id);
 return;
 }
 activeFolderId = folder.id;
 renderSidebarTree();
 };

 folderRow.ondblclick = function(e) {
 if (isBatchDeleteMode) return;
 collapsedFolders[folder.id] = !collapsedFolders[folder.id];
 renderSidebarTree();
 };

 const hasChildren = folderHasChildren(folder.id);
 const caretHtml = hasChildren
 ? '<span class="folder-caret" style="cursor:pointer;">' + (isCollapsed ? '▸' : '▾') + '</span>'
 : '<span class="folder-caret" style="visibility:hidden; pointer-events:none;"></span>';

 folderRow.innerHTML = 
caretHtml +
 '<div class="node-row' + rowStateClass + '">' +
 '<div class="node-left">' +
 '<span class="node-icon">' + escapeHtml(folder.icon || '📁') + '</span>' +
 '<span class="node-name">' + escapeHtml(folder.name) + '</span>' +
 '</div>' +
 '</div>';

 const iconSpan = folderRow.querySelector('.node-icon');
 if (iconSpan) {
 iconSpan.onclick = function(ev) {
 ev.stopPropagation();
 openIconPicker('folder', folder.id);
 };
 }

 if (hasChildren) {
 const caretSpan = folderRow.querySelector('.folder-caret');
 if (caretSpan) {
 caretSpan.onclick = function(e) {
 e.stopPropagation();
 collapsedFolders[folder.id] = !collapsedFolders[folder.id];
 renderSidebarTree();
 };
 }
 }

 attachContextMenu(folderRow, function() { return buildFolderMenuItems(folder); }, function() { return (folder.icon || '📁') + ' ' + folder.name; });

 folderRow.ondragover = function(e) { e.preventDefault(); folderRow.style.background = "var(--select-bg)"; };
 folderRow.ondragleave = function() { folderRow.style.background = ""; };
 folderRow.ondrop = function(e) {
 e.preventDefault();
 e.stopPropagation();
 folderRow.style.background = "";
 try {
 const dragPayload = JSON.parse(e.dataTransfer.getData("text/plain"));
 if (dragPayload.type === "doc") {
 const doc = appData.docs.find(d => d.id === dragPayload.id);
 if (doc) {
 doc.folderId = folder.id;
 doc.worldId = worldId;
 saveData();
 renderSidebarTree();
 renderBreadcrumb();
 }
 } else if (dragPayload.type === "folder") {
 const movingFolderId = dragPayload.id;
 if (movingFolderId !== folder.id && !isDescendantOf(movingFolderId, folder.id)) {
 const f = appData.folders.find(x => x.id === movingFolderId);
 if (f) {
 f.parentId = folder.id;
 f.worldId = worldId;
 saveData();
 renderSidebarTree();
 renderBreadcrumb();
 }
 }
 }
 } catch(err) {}
 };

 folderDiv.appendChild(folderRow);

 const childrenDiv = document.createElement("div");
 childrenDiv.className = "folder-children";
 if (isCollapsed && !search) childrenDiv.style.display = "none";

 renderFolderLevel(worldId, folder.id, childrenDiv, search);

 const docsInFolder = appData.docs.filter(d => {
 const match = d.worldId === worldId && d.folderId === folder.id;
 if (!search) return match;
 if (d.id === activeDocId) return false; 
return match && docMatchesSearch(d, search);
 });

 docsInFolder.forEach(function(doc) {
 childrenDiv.appendChild(createDocRowElement(doc));
 });

 folderDiv.appendChild(childrenDiv);
 parentElement.appendChild(folderDiv);
 });

 if (parentId === null) {
 const rootDocs = appData.docs.filter(d => {
 const isRoot = d.worldId === worldId && !d.folderId;
 if (!search) return isRoot;
 if (d.id === activeDocId) return false; 
return isRoot && docMatchesSearch(d, search);
 });
 rootDocs.forEach(function(doc) {
 parentElement.appendChild(createDocRowElement(doc));
 });
 }
}

function isDescendantOf(parentCheckId, targetFolderId) {
 let cur = targetFolderId;
 while (cur) {
 if (cur === parentCheckId) return true;
 const f = appData.folders.find(x => x.id === cur);
 cur = f ? f.parentId : null;
 }
 return false;
}

function createDocRowElement(doc) {
 const row = document.createElement("div");
 row.className = "node-row-outer";
 row.dataset.docId = doc.id;      // 讓 updateDocRowInPlace() 找得到這一列
 let rowStateClass = (doc.id === activeDocId ? " active" : "");
 if (isBatchDeleteMode && batchSelectedDocs.has(doc.id)) {
 rowStateClass += " batch-checked";
 }
 row.draggable = true;
 row.ondragstart = function(e) {
 e.stopPropagation();
 e.dataTransfer.setData("text/plain", JSON.stringify({ type: "doc", id: doc.id }));
 };
 row.onclick = function(e) {
 if (e.target.closest('.node-icon')) return;
 if (isBatchDeleteMode) {
 toggleBatchItemSelection('doc', doc.id);
 return;
 }
 activeWorldId = doc.worldId;
 activeFolderId = null;
 updateWorldBadge();
 loadDocToEditor(doc.id);
 openDocFromDirectory(doc);
 // 有在搜尋的話，把搜尋的詞在內文裡標起來並捲過去。
 // 停在白板檢視時不做——那裡看的是節點，不是內文。
 if (activeView === 'editor') applySearchHighlightForOpenedDoc();
 if (isMobileLayout()) closeSidebarMobile();
 };

 const displayTitle = doc.title || "無標題文檔";

 row.innerHTML = 
'<span class="folder-caret" style="visibility:hidden; pointer-events:none;"></span>' +
 '<div class="node-row' + rowStateClass + '">' +
 '<div class="node-left">' +
 '<span class="node-icon">' + escapeHtml(doc.icon || '📄') + '</span>' +
 '<span class="node-name">' + escapeHtml(displayTitle) + '</span>' +
 '</div>' +
 '<div style="font-size:10px; color:var(--text-muted);">' + (doc.wordCount || 0) + '字</div>' +
 '</div>';

 const iconSpan = row.querySelector('.node-icon');
 if (iconSpan) {
 iconSpan.onclick = function(ev) {
 ev.stopPropagation();
 openIconPicker('doc', doc.id);
 };
 }

 attachContextMenu(row, function() { return buildDocMenuItems(doc); }, function() { return (doc.icon || '📄') + ' ' + (doc.title || '無標題文檔'); });
 return row;
}

/* 只更新側欄裡的某一列，不重畫整棵樹。

   renderSidebarTree() 是 innerHTML = "" 之後整棵重建，實測 1500 篇文檔要
   16ms。改標題這種「只有一列的文字變了」的情況不需要付這個代價——
   結構沒變（沒有新增、刪除、搬移、也不是在搜尋），就地改字就好。

   找不到那一列（例如正在搜尋、或它在收起來的資料夾裡）就什麼都不做：
   那些情況下一次完整重畫自然會正確，不需要在這裡處理。 */
function updateDocRowInPlace(doc) {
  if (!doc) return;
  const container = document.getElementById("worldTreeContainer");
  if (!container) return;
  const row = container.querySelector('[data-doc-id="' + CSS.escape(doc.id) + '"]');
  if (!row) return;

  const nameSpan = row.querySelector(".node-name");
  if (nameSpan) nameSpan.textContent = doc.title || "無標題文檔";
  const iconSpan = row.querySelector(".node-icon");
  if (iconSpan) iconSpan.textContent = doc.icon || "📄";

  const countDiv = row.querySelector(".node-row > div:last-child");
  if (countDiv) countDiv.textContent = (doc.wordCount || 0) + "字";
}

function renderBreadcrumb() {
 const bar = document.getElementById("docBreadcrumbBar");
 bar.innerHTML = "";

 const doc = appData.docs.find(d => d.id === activeDocId);
 if (!doc) {
 bar.innerHTML = '<span class="breadcrumb-item" style="color:var(--text-muted);">（無已選文檔）</span>';
 return;
 }

 const world = appData.worldviews.find(w => w.id === doc.worldId) || { id: "w_main", name: "主世界觀", icon: "🌐" };

 bar.appendChild(createBreadcrumbDropdownItem(
 (world.icon || '🌐') + " " + world.name,
 function() {
 activeWorldId = world.id;
 activeFolderId = null;
 updateWorldBadge();
 renderSidebarTree();
 },
 getWorldChildOptions(world.id, null)
 ));

 const folderChain = [];
 let curFolderId = doc.folderId;
 while (curFolderId) {
 const f = appData.folders.find(item => item.id === curFolderId);
 if (f) {
 folderChain.unshift(f);
 curFolderId = f.parentId;
 } else break;
 }

 folderChain.forEach(function(folder) {
 const sep = document.createElement("span");
 sep.className = "breadcrumb-sep";
 sep.textContent = "›";
 sep.style.cursor = "pointer";
 sep.title = "跳轉到 " + folder.name;
 sep.onclick = function(e) {
 e.stopPropagation();
 navigateToBreadcrumbFolder(folder);
 };
 bar.appendChild(sep);

 const folderItemEl = createBreadcrumbDropdownItem(
 (folder.icon || '📁') + " " + folder.name,
 function() { navigateToBreadcrumbFolder(folder); },
 getWorldChildOptions(folder.worldId, folder.id)
 );
 folderItemEl.ondblclick = function(e) {
 e.stopPropagation();
 openSidebarMenu();
 navigateToBreadcrumbFolder(folder);
 };
 bar.appendChild(folderItemEl);
 });

 const sepDoc = document.createElement("span");
 sepDoc.className = "breadcrumb-sep";
 sepDoc.textContent = "›";
 bar.appendChild(sepDoc);

 const docItem = document.createElement("span");
 docItem.className = "breadcrumb-item";
 docItem.style.color = "var(--accent-text)";
 docItem.textContent = (doc.icon || '📄') + " " + (doc.title || "無標題文檔");
 bar.appendChild(docItem);
}

function navigateToBreadcrumbFolder(folder) {
 activeWorldId = folder.worldId;
 activeFolderId = folder.id;

 let cur = folder;
 while (cur) {
 delete collapsedFolders[cur.id];
 cur = appData.folders.find(f => f.id === cur.parentId);
 }

 updateWorldBadge();
 renderSidebarTree();

 if (isMobileLayout()) {
 const sidebar = document.getElementById("appSidebar");
 const overlay = document.getElementById("sidebarOverlay");
 if (!sidebar.classList.contains("drawer-open")) {
 sidebar.classList.add("drawer-open");
 overlay.classList.add("active");
 history.pushState({ drawer: true }, "");
 }
 }

 requestAnimationFrame(() => {
 const selectedRow = document.querySelector(".node-row.selected");
 if (selectedRow) selectedRow.scrollIntoView({ block: "center", behavior: "smooth" });
 });
}

function getWorldChildOptions(worldId, parentId) {
 const folders = appData.folders.filter(f => f.worldId === worldId && f.parentId === parentId);
 const docs = appData.docs.filter(d => d.worldId === worldId && d.folderId === parentId);
 return { folders, docs };
}

function createBreadcrumbDropdownItem(text, onClickMain, childrenObj) {
 const container = document.createElement("div");
 container.className = "breadcrumb-item";

 const label = document.createElement("span");
 label.textContent = text;
 label.onclick = function(e) {
 e.stopPropagation();
 onClickMain();
 };
 container.appendChild(label);

 if (childrenObj && (childrenObj.folders.length > 0 || childrenObj.docs.length > 0)) {
 const arrow = document.createElement("span");
 arrow.textContent = " ▾";
 arrow.style.fontSize = "10px";
 arrow.style.opacity = "0.7";
 arrow.onclick = function(e) {
 e.stopPropagation();
 const willOpen = !dropdown.classList.contains("active");
 closeAllBreadcrumbDropdowns();
 if (willOpen) {
 dropdown.classList.add("active");
 const barEl = document.getElementById("docBreadcrumbBar");
 if (barEl) barEl.classList.add("dropdown-open");
 }
 };
 container.appendChild(arrow);

 const dropdown = document.createElement("div");
 dropdown.className = "breadcrumb-dropdown";

 childrenObj.folders.forEach(function(f) {
 const opt = document.createElement("div");
 opt.className = "breadcrumb-dropdown-item";
 opt.innerHTML = `<span>${escapeHtml(f.icon || '📁')}</span><span>${escapeHtml(f.name)}</span>`;
 opt.onclick = function(e) {
 e.stopPropagation();
 navigateToBreadcrumbFolder(f);
 closeAllBreadcrumbDropdowns();
 };
 dropdown.appendChild(opt);
 });

 childrenObj.docs.forEach(function(d) {
 const opt = document.createElement("div");
 opt.className = "breadcrumb-dropdown-item";
 opt.innerHTML = `<span>${escapeHtml(d.icon || '📄')}</span><span>${escapeHtml(d.title || '無標題')}</span>`;
 opt.onclick = function(e) {
 e.stopPropagation();
 loadDocToEditor(d.id);
 closeAllBreadcrumbDropdowns();
 };
 dropdown.appendChild(opt);
 });

 container.appendChild(dropdown);
 }

 return container;
}

function closeAllBreadcrumbDropdowns() {
 document.querySelectorAll(".breadcrumb-dropdown.active").forEach(d => d.classList.remove("active"));
 const barEl = document.getElementById("docBreadcrumbBar");
 if (barEl) barEl.classList.remove("dropdown-open");
}

function promptCreateWorldview() {
 const name = prompt("請輸入新世界觀名稱：", "新世界觀");
 if (name && name.trim()) {
 const newWorld = {
 id: "w_" + Date.now(),
 name: name.trim(),
 icon: "🌐",
 canvas: { nodes: [], edges: [] }
 };
 appData.worldviews.push(newWorld);
 selectWorld(newWorld.id);
 saveData();
 }
}

function createFolderInCurrentContext() {
 promptCreateFolder(activeFolderId || null, activeWorldId);
}

/* 從目錄點一篇文檔之後要停在哪個檢視。
   在白板檢視下點目錄，使用者想看的是白板上的那個節點，不是被踢回編輯器，
   所以把畫面平移過去並highlight，留在白板。
   但這篇文檔不一定被投射到白板上——那種情況白板上沒有東西可以看，
   維持原本的行為切回編輯器，至少看得到內容。 */
function openDocFromDirectory(doc) {
 if (activeView === 'canvas' && typeof focusCanvasNode === 'function') {
  // 切換世界觀時白板畫的還是上一個世界觀的節點，要先重畫才找得到
  if (typeof renderCanvas === 'function') renderCanvas();
  if (focusCanvasNode(doc.id)) return;
 }
 if (activeView !== 'editor') switchView('editor');
}

/* 決定「新增文檔」要放在哪一層。優先順序：
   1. 有明確選取資料夾 → 放進那個資料夾（使用者剛剛點的，最能代表意圖）
   2. 否則若編輯器正開著一篇文檔 → 跟它放在同一層
   3. 都沒有 → 放在這個世界觀的最外層

   第 2 條是重點：從目錄點開一篇文檔時會把 activeFolderId 清成 null，
   所以在沒有這條的情況下，明明開著資料夾深處的文檔，新增出來的卻會
   掉到最外層。快速跳轉開的文檔反而會設 activeFolderId，兩條路徑行為
   不一致；把落點統一由這裡決定之後就不會再分岔。 */
function resolveNewDocFolderId() {
 if (activeFolderId) return activeFolderId;

 const openDoc = appData.docs.find(d => d.id === activeDocId);
 // 跨世界觀不沿用：切換世界觀後 activeDocId 可能還指著別的世界觀的文檔
 if (!openDoc || openDoc.worldId !== activeWorldId) return null;
 if (!openDoc.folderId) return null;

 // 資料夾可能已經被刪掉（文檔還在但父層沒了），落點要退回最外層
 const folder = appData.folders.find(f => f.id === openDoc.folderId);
 if (!folder || folder.worldId !== activeWorldId) return null;

 return folder.id;
}

function createDocInCurrentContext() {
 createNewDoc(resolveNewDocFolderId(), activeWorldId);
}

function promptCreateFolder(parentId = null, worldId = null) {
 const name = prompt("請輸入資料夾名稱：", "新分類");
 if (name && name.trim()) {
 appData.folders.push({
 id: "f_" + Date.now(),
 worldId: worldId || activeWorldId,
 parentId: parentId,
 name: name.trim(),
 icon: "📁"
 });
 saveData();
 renderSidebarTree();
 }
}

function createNewDoc(targetFolderId = null, worldId = null) {
 const wId = worldId || activeWorldId;
 const newDoc = {
 id: "doc_" + Date.now(),
 worldId: wId,
 folderId: targetFolderId,
 icon: "📄",
 title: "",
 content: "",
 tags: [],
 manualTags: [],
 images: [],
 wordCount: 0,
 updatedAt: formatTime(new Date())
 };
 appData.docs.unshift(newDoc);
 activeWorldId = wId;
 updateWorldBadge();
 saveData();
 renderSidebarTree();
 loadDocToEditor(newDoc.id);
 switchView('editor');
 if (isMobileLayout()) closeSidebarMobile();
}

function promptRenameItem(type, id, currentName) {
 const newName = prompt("請輸入新的名稱：", currentName);
 if (newName && newName.trim() && newName.trim() !== currentName) {
 const val = newName.trim();
 if (type === 'world') {
 const w = appData.worldviews.find(x => x.id === id);
 if (w) w.name = val;
 } else if (type === 'folder') {
 const f = appData.folders.find(x => x.id === id);
 if (f) f.name = val;
 } else if (type === 'doc') {
 const d = appData.docs.find(x => x.id === id);
 if (d) {
 d.title = val;
 if (d.id === activeDocId) document.getElementById("docTitleInput").value = val;
 }
 }
 saveData();
 renderSidebarTree();
 renderBreadcrumb();
 updateWorldBadge();
 // 白板上的節點顯示的就是這個標題，正在看白板時要一起更新
 refreshCanvasIfVisible();
 }
}

function toggleBatchDeleteMode() {
 isBatchDeleteMode = !isBatchDeleteMode;
 if (!isBatchDeleteMode) {
 batchSelectedFolders.clear();
 batchSelectedDocs.clear();
 }
 document.getElementById("batchActionBar").classList.toggle("active", isBatchDeleteMode);
 document.getElementById("appSidebar").classList.toggle("batch-mode", isBatchDeleteMode);
 updateBatchBarCount();
 renderSidebarTree();
}

function toggleBatchItemSelection(type, id) {
 const set = type === "folder" ? batchSelectedFolders : batchSelectedDocs;
 if (set.has(id)) set.delete(id);
 else set.add(id);
 updateBatchBarCount();
 renderSidebarTree();
}

function updateBatchBarCount() {
 const el = document.getElementById("batchSelectedCountText");
 if (!el) return;
 const count = batchSelectedFolders.size + batchSelectedDocs.size;
 el.textContent = count > 0 ? ("已選取 " + count + " 項") : "批量刪除模式：點選項目以選取";
}

function executeBatchDelete() {
 const totalCount = batchSelectedFolders.size + batchSelectedDocs.size;
 if (totalCount === 0) {
 alert("請先點選欲刪除的項目！");
 return;
 }

 const names = [];
 const folderIdsToDelete = Array.from(batchSelectedFolders);
 const docIdsToDelete = Array.from(batchSelectedDocs);

 folderIdsToDelete.forEach(function(id) {
 const f = appData.folders.find(x => x.id === id);
 if (f) names.push("📁 " + f.name);
 });
 docIdsToDelete.forEach(function(id) {
 const d = appData.docs.find(x => x.id === id);
 if (d) names.push("📄 " + (d.title || "無標題文檔"));
 });

 const confirmMsg = "確定要刪除選取的 " + totalCount + " 個項目嗎？（會移到垃圾桶，可以復原）\n\n" + names.join("\n");
 if (!confirm(confirmMsg)) return;

 const docsToTrash = appData.docs.filter(d => docIdsToDelete.includes(d.id));
 const foldersToTrash = appData.folders.filter(f => folderIdsToDelete.includes(f.id));

 appData.folders = appData.folders.filter(f => !folderIdsToDelete.includes(f.id));
 appData.docs = appData.docs.filter(d => !docIdsToDelete.includes(d.id));

 moveDocsToTrash(docsToTrash);
 moveFoldersToTrash(foldersToTrash);

 saveData();
 toggleBatchDeleteMode();
 renderSidebarTree();

 if (docIdsToDelete.includes(activeDocId)) {
 const remainingDocsInWorld = appData.docs.filter(d => d.worldId === activeWorldId);
 if (remainingDocsInWorld.length > 0) loadDocToEditor(remainingDocsInWorld[0].id);
 else clearEditorWorkspace();
 }
}

function deleteCurrentDocument() {
 if (!activeDocId) return;
 deleteDocById(activeDocId);
}

function deleteFolderById(folderId) {
 if (!confirm("確定要刪除此資料夾嗎？（內含子資料夾與文檔會一併移到垃圾桶，可以復原）")) return;

 const idsToDelete = [folderId];
 let changed = true;
 while (changed) {
 changed = false;
 appData.folders.forEach(function(f) {
 if (idsToDelete.includes(f.parentId) && !idsToDelete.includes(f.id)) {
 idsToDelete.push(f.id);
 changed = true;
 }
 });
 }

 const willDeleteActiveDoc = appData.docs.some(d => d.id === activeDocId && idsToDelete.includes(d.folderId));

 const docsToTrash = appData.docs.filter(d => idsToDelete.includes(d.folderId));
 const foldersToTrash = appData.folders.filter(f => idsToDelete.includes(f.id));

 appData.docs = appData.docs.filter(d => !idsToDelete.includes(d.folderId));
 appData.folders = appData.folders.filter(f => !idsToDelete.includes(f.id));

 moveDocsToTrash(docsToTrash);
 moveFoldersToTrash(foldersToTrash);

 if (activeFolderId && idsToDelete.includes(activeFolderId)) activeFolderId = null;

 saveData();
 renderSidebarTree();

 if (willDeleteActiveDoc || !appData.docs.find(d => d.id === activeDocId)) {
 const remainingDocsInWorld = appData.docs.filter(d => d.worldId === activeWorldId);
 if (remainingDocsInWorld.length > 0) loadDocToEditor(remainingDocsInWorld[0].id);
 else clearEditorWorkspace();
 }
}

function deleteDocById(docId) {
 const idx = appData.docs.findIndex(d => d.id === docId);
 if (idx === -1) return;
 if (!confirm("確定要刪除此文檔嗎？（會移到垃圾桶，可以復原）")) return;
 const wasActive = docId === activeDocId;

 const [doc] = appData.docs.splice(idx, 1);
 moveDocsToTrash([doc]);

 saveData();
 renderSidebarTree();

 if (wasActive) {
 const remainingDocsInWorld = appData.docs.filter(d => d.worldId === activeWorldId);
 if (remainingDocsInWorld.length > 0) loadDocToEditor(remainingDocsInWorld[0].id);
 else clearEditorWorkspace();
 }
}

function deleteWorldById(worldId) {
 if (appData.worldviews.length <= 1) {
 alert("這是最後一個世界觀，無法刪除！");
 return;
 }

 if (!confirm("確定要刪除此世界觀嗎？\n（底下的所有資料夾與文檔會被移至垃圾桶，可以復原，但世界觀本身將直接刪除）")) {
 return;
 }

 const docsToTrash = appData.docs.filter(d => d.worldId === worldId);
 const foldersToTrash = appData.folders.filter(f => f.worldId === worldId);

 appData.docs = appData.docs.filter(d => d.worldId !== worldId);
 appData.folders = appData.folders.filter(f => f.worldId !== worldId);

 if (typeof moveDocsToTrash === 'function') moveDocsToTrash(docsToTrash);
 if (typeof moveFoldersToTrash === 'function') moveFoldersToTrash(foldersToTrash);

 appData.worldviews = appData.worldviews.filter(w => w.id !== worldId);

 if (activeWorldId === worldId) {
 activeWorldId = appData.worldviews[0].id;
 activeFolderId = null;
 
 const remainingDocs = appData.docs.filter(d => d.worldId === activeWorldId);
 if (remainingDocs.length > 0) {
 loadDocToEditor(remainingDocs[0].id);
 } else {
 clearEditorWorkspace();
 }
 }

 saveData();
 updateWorldBadge();
 renderSidebarTree();
 if (activeView === 'canvas') {
 renderCanvas();
 }
}
