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
 if (typeof clearJumpHighlight === "function") clearJumpHighlight();
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
 btn.title = world.desc ? (world.name + " — " + world.desc) : world.name;
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
 renderWorldDesc();
 renderWorldRail();
}

/* 目前世界觀的一句話簡介。

   一律用 textContent：這是使用者（或匯入檔）寫的字，拼進 innerHTML 就是
   一個洞（硬規則 5）。沒寫過的時候留一行淡的提示，讓人知道這裡可以寫。 */
function renderWorldDesc() {
 const line = document.getElementById("worldDescLine");
 if (!line) return;
 const world = appData.worldviews.find(w => w.id === activeWorldId);
 const desc = (world && typeof world.desc === "string") ? world.desc.trim() : "";
 line.textContent = desc || "＋ 一句話簡介";
 line.classList.toggle("is-empty", !desc);
 line.title = desc ? (desc + "（點一下可以改）") : "幫這個世界觀寫一句話簡介";
}

/* 沒指定就改目前這個世界觀（側欄那一行點下去走的是這條）。

   按「取消」＝不動；按「儲存」但留白＝清掉。簡介本來就可以清掉，不能像
   改名那樣把空字串當成取消。 */
function promptEditWorldDesc(worldId) {
 const id = worldId || activeWorldId;
 const world = appData.worldviews.find(w => w.id === id);
 if (!world) return;

 openTextInputModal({
 title: "📝 一句話簡介",
 fields: [{ label: (world.icon || "🌐") + " " + world.name, value: world.desc || "",
 placeholder: "清空就留白", maxLength: WORLD_DESC_MAX_LEN }],
 okText: "儲存",
 onSubmit: function(values) {
 applyWorldDesc(world, values[0]);
 saveData();
 updateWorldBadge();
 }
 });
}

/* 寫入簡介：去頭尾空白、截長度，空的就把欄位拿掉（不要留一個空字串）。 */
function applyWorldDesc(world, raw) {
 const val = String(raw || "").trim().slice(0, WORLD_DESC_MAX_LEN);
 if (val) world.desc = val; else delete world.desc;
}

/* ==========================================================
   世界觀清單

   側邊那一排（手機上是底部那一列）只看得到圖示，世界觀一多就認不出來
   哪個是哪個。這個清單把名稱、簡介、文件數、最後更新時間一次攤開。

   兩個入口、同一個面板：
   - 手機：從底部那一列往上滑
   - 電腦／平板：點上方那顆「目前的世界觀」徽章
   ========================================================== */

/* 一個世界觀的統計。純函式，餵陣列進去就能測。

   只算還在的文檔（垃圾桶裡的不算——那是「刪掉了」，不該讓數字看起來
   沒變）。updatedAt 是 "YYYY-MM-DD HH:mm" 這種固定寬度的字串，
   直接比字典序就是比時間，不必先 parse 成 Date。 */
function worldStats(docs, worldId) {
  let count = 0;
  let updatedAt = "";
  (docs || []).forEach(function(d) {
    if (!d || d.worldId !== worldId) return;
    count++;
    const t = typeof d.updatedAt === "string" ? d.updatedAt : "";
    if (t > updatedAt) updatedAt = t;
  });
  return { count: count, updatedAt: updatedAt };
}

function openWorldListModal() {
  renderWorldList();
  document.getElementById("worldListModal").classList.add("active");
}

function closeWorldListModal() {
  document.getElementById("worldListModal").classList.remove("active");
}

/* 一律 createElement + textContent，不要拼 innerHTML：名稱與簡介都是
   使用者寫的（或匯入來的）字（硬規則 5）。 */
function renderWorldList() {
  const list = document.getElementById("worldListBody");
  if (!list) return;
  list.innerHTML = "";

  appData.worldviews.forEach(function(world) {
    const stats = worldStats(appData.docs, world.id);

    const card = document.createElement("button");
    card.type = "button";
    card.className = "world-card" + (world.id === activeWorldId ? " active" : "");
    card.onclick = function() {
      closeWorldListModal();
      selectWorld(world.id);
    };

    const icon = document.createElement("span");
    icon.className = "world-card-icon";
    icon.textContent = world.icon || "🌐";

    const main = document.createElement("span");
    main.className = "world-card-main";

    const name = document.createElement("span");
    name.className = "world-card-name";
    name.textContent = world.name;

    const desc = document.createElement("span");
    const hasDesc = typeof world.desc === "string" && world.desc.trim();
    desc.className = "world-card-desc" + (hasDesc ? "" : " is-empty");
    desc.textContent = hasDesc ? world.desc.trim() : "還沒寫簡介";

    const meta = document.createElement("span");
    meta.className = "world-card-meta";
    meta.textContent = stats.count + " 篇文件　·　"
      + (stats.updatedAt ? "最後更新 " + stats.updatedAt : "還沒有內容");

    main.appendChild(name);
    main.appendChild(desc);
    main.appendChild(meta);
    card.appendChild(icon);
    card.appendChild(main);

    /* 長按（或右鍵）沿用世界觀原本那份選單：改名、寫簡介、換圖示、刪除。
       在這裡特別有用——這個畫面本來就是「一次看完所有世界觀」的地方。 */
    attachContextMenu(card,
      function() { return buildWorldMenuItems(world); },
      function() { return (world.icon || "🌐") + " " + world.name; });

    list.appendChild(card);
  });
}

function renderSidebarTree() {
 const container = document.getElementById("worldTreeContainer");
 const search = document.getElementById("searchInput").value.trim().toLowerCase();
 container.innerHTML = "";
 setupTreeRootDropZone(container);

 renderBreadcrumb();

 const currentWorld = appData.worldviews.find(w => w.id === activeWorldId);
 if (!currentWorld) return;

 if (search) {
 renderActiveDocSearchPin(container, search);
 }

 renderFolderLevel(currentWorld.id, null, container, search);
}

/* 整棵樹的容器自己也是一個放置目標＝「這個世界觀的根目錄」。

   原本只有資料夾那幾列收得到 drop，所以東西一旦拖進資料夾，在桌機上就再也
   拖不回最外層了（只能走「移動」彈窗）。用的是跟觸控同一套 dropTargetAt()，
   所以拖到「某個資料夾底下的文檔」上也會正確地落進那個資料夾，而不是根目錄。

   用屬性指派（on...）而不是 addEventListener：renderSidebarTree() 每次重畫
   都會經過這裡，屬性指派覆蓋掉舊的，不會越疊越多。 */
function setupTreeRootDropZone(container) {
 if (!container) return;

 container.ondragover = function(e) { e.preventDefault(); };
 container.ondragleave = function() { container.classList.remove("drop-hover"); };
 container.ondrop = function(e) {
 e.preventDefault();
 container.classList.remove("drop-hover");
 try {
 const target = dropTargetAt(e.clientX, e.clientY);
 moveItemInto(JSON.parse(e.dataTransfer.getData("text/plain")),
 target ? target.folderId : null, activeWorldId);
 } catch (err) {}
 };
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
 folderRow.dataset.folderId = folder.id;     // 觸控拖曳靠這個找放置目標
 folderRow.draggable = true;

 folderRow.ondragstart = function(e) {
 e.stopPropagation();
 e.dataTransfer.setData("text/plain", JSON.stringify({ type: "folder", id: folder.id }));
 };

 let rowStateClass = (folder.id === activeFolderId ? " selected" : "");
 if (isBatchDeleteMode && batchSelectedFolders.has(folder.id)) {
 rowStateClass += " batch-checked";
 }

 /* 點整列就收合／展開，不必瞄準那顆三角形。

    三角形只有十幾像素寬，用手指幾乎點不中；使用者要的是「點資料夾本人也
    可以收合／展開」。選取（決定新文檔開在哪一層）跟收合併成同一下，
    跟檔案總管、VS Code 的側欄一樣。

    沒有子項目的就不切換：它沒有東西可以收，切了只會讓箭頭閃一下。

    原本的 ondblclick 拿掉了——單擊已經在做同一件事，留著的話雙擊會變成
    切三次（click、click、dblclick），使用者看到的是隨機的開合。 */
 folderRow.onclick = function(e) {
 if (e.target.closest('.folder-caret')) return;
 if (isBatchDeleteMode) {
 toggleBatchItemSelection('folder', folder.id);
 return;
 }
 activeFolderId = folder.id;
 if (folderHasChildren(folder.id)) {
 collapsedFolders[folder.id] = !collapsedFolders[folder.id];
 }
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

 /* 圖示刻意不掛自己的 onclick、也不被上面那個 onclick 擋掉：點它就跟點這
    一列一樣（收合／展開）。原本點圖示會直接跳出圖示選擇器，在目錄裡上下
    滑動時很容易誤觸。要改圖示請長按（或右鍵）這一列，選「更換圖示」。 */

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

 attachContextMenu(folderRow,
 function() { return buildFolderMenuItems(folder); },
 function() { return (folder.icon || '📁') + ' ' + folder.name; },
 touchDragHooks("folder", folder.id, (folder.icon || '📁') + ' ' + folder.name));

 folderRow.ondragover = function(e) { e.preventDefault(); folderRow.classList.add("drop-hover"); };
 folderRow.ondragleave = function() { folderRow.classList.remove("drop-hover"); };
 folderRow.ondrop = function(e) {
 e.preventDefault();
 e.stopPropagation();
 folderRow.classList.remove("drop-hover");
 try {
 moveItemInto(JSON.parse(e.dataTransfer.getData("text/plain")), folder.id, worldId);
 } catch(err) {}
 };

 folderDiv.appendChild(folderRow);

 const childrenDiv = document.createElement("div");
 childrenDiv.className = "folder-children";
 /* 也標上 id：手指落在「這個資料夾底下的某一篇文檔」上時，closest() 會
    往上找到這裡，等於丟進同一個資料夾。目標區域因此從一列變成一整塊，
    在手機上差很多。 */
 childrenDiv.dataset.folderId = folder.id;
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

/* ==========================================================
   搬移：桌機的 HTML5 拖放與手機的觸控拖曳共用這一段

   為什麼要有觸控這條路：HTML5 的 draggable / dragstart / drop **在觸控
   裝置上根本不會觸發**（iOS Safari 完全不支援，Android 上也要先長按到
   系統認定是拖曳）。所以目錄樹在手機上只是看起來可以拖，實際上動不了——
   使用者回報的「手機端不能直接拖拽移動文件位置」就是這個。
   ========================================================== */

/* 真正把東西搬過去。兩條路（滑鼠放開、手指放開）都走這裡，規則才只有一份。

   回傳有沒有真的動到——沒動到就不要存檔、不要重畫，也不要震動回饋，
   不然「放回原處」看起來會像做了什麼事。 */
function moveItemInto(payload, targetFolderId, targetWorldId) {
  if (!payload || !payload.id) return false;
  const folderId = targetFolderId || null;
  const worldId = targetWorldId || activeWorldId;

  let leavingDocIds = [];

  if (payload.type === "doc") {
    const doc = appData.docs.find(d => d.id === payload.id);
    if (!doc) return false;
    if ((doc.folderId || null) === folderId && doc.worldId === worldId) return false;
    if (doc.worldId !== worldId) leavingDocIds = [doc.id];
    doc.folderId = folderId;
    doc.worldId = worldId;
  } else if (payload.type === "folder") {
    const f = appData.folders.find(x => x.id === payload.id);
    if (!f) return false;
    // 不能搬進自己，也不能搬進自己的子孫——那會把那一支從樹上切下來，
    // 資料還在但畫不出來，看起來就是憑空消失
    if (payload.id === folderId) return false;
    if (folderId && isDescendantOf(payload.id, folderId)) return false;
    if ((f.parentId || null) === folderId && f.worldId === worldId) return false;

    /* 換世界觀的時候，底下整棵子樹都要一起換。

       原本只改了資料夾自己的 worldId：它搬過去了，但裡面的子資料夾與文檔
       還留在原本的世界觀，而它們的上層已經不在那裡了——兩邊的目錄樹都
       畫不出它們。資料都還在，使用者看到的是「搬過去之後裡面全空了、
       原本那邊也不見了」。 */
    if (f.worldId !== worldId) {
      const sub = folderSubtree(f.id);
      appData.folders.forEach(function(x) {
        if (sub.folderIds.has(x.id)) x.worldId = worldId;
      });
      appData.docs.forEach(function(d) {
        if (sub.docIds.has(d.id)) d.worldId = worldId;
      });
      leavingDocIds = Array.from(sub.docIds);
    }
    f.parentId = folderId;
    f.worldId = worldId;
  } else {
    return false;
  }

  /* 搬去別的世界觀的文檔，在原本那張白板上的節點要收掉。

     白板畫節點時只看「這篇文檔還在不在」，不看它屬於哪個世界觀，所以不收
     的話原本那張白板會一直掛著別的世界觀的文檔。收進垃圾桶而不是直接丟：
     連線上寫的關係說明是使用者打的字，搬回來的時候還救得回來。 */
  if (leavingDocIds.length && typeof trashOrphanNodesForDocs === "function") {
    trashOrphanNodesForDocs(leavingDocIds, "（文檔搬到別的世界觀時留下的白板節點）");
    if (typeof refreshCanvasIfVisible === "function") refreshCanvasIfVisible();
  }

  saveData();
  renderSidebarTree();
  renderBreadcrumb();
  return true;
}

/* 一個資料夾底下的整棵子樹（含它自己）。

   從上往下找，不是對每個資料夾往上問 isDescendantOf()：那個是沿著
   parentId 一路往上走，資料損毀繞成圈又剛好沒經過起點時會走不完。
   這裡記著走過的，繞成圈也會停。 */
function folderSubtree(rootId) {
  const folderIds = new Set([rootId]);
  const queue = [rootId];
  while (queue.length) {
    const cur = queue.shift();
    appData.folders.forEach(function(f) {
      if (f.parentId === cur && !folderIds.has(f.id)) {
        folderIds.add(f.id);
        queue.push(f.id);
      }
    });
  }
  const docIds = new Set();
  appData.docs.forEach(function(d) {
    if (d.folderId && folderIds.has(d.folderId)) docIds.add(d.id);
  });
  return { folderIds: folderIds, docIds: docIds };
}

/* 同一毫秒內會產生很多個（複製一整個資料夾），所以一定要有隨機尾碼。 */
function newItemId(prefix) {
  return prefix + Date.now() + "_" + Math.random().toString(36).slice(2, 7);
}

/* 複製一份到別的地方。回傳新的那一份的 id，失敗回 null。

   資料夾是整棵子樹一起複製：每個子資料夾、每篇文檔都拿新的 id，
   上下層的關係照原本的對應過去。

   刻意不複製的：
   - 白板上的節點與連線。白板是一個世界觀一張，而連線的另一端在原本的
     世界觀裡，搬不過去。要的話到那邊用「批量投射白板」放上去。
   - 復原紀錄。那是「這一篇被怎麼改過」，複製出來的是新的一篇。 */
function copyItemInto(payload, targetFolderId, targetWorldId) {
  if (!payload || !payload.id) return null;
  const folderId = targetFolderId || null;
  const worldId = targetWorldId || activeWorldId;
  const now = formatTime(new Date());

  function cloneDoc(d, newFolderId) {
    const c = JSON.parse(JSON.stringify(d));
    c.id = newItemId("doc_");
    c.worldId = worldId;
    c.folderId = newFolderId;
    c.updatedAt = now;
    return c;
  }

  if (payload.type === "doc") {
    const doc = appData.docs.find(d => d.id === payload.id);
    if (!doc) return null;
    const c = cloneDoc(doc, folderId);
    appData.docs.unshift(c);
    return c.id;
  }

  if (payload.type === "folder") {
    const root = appData.folders.find(f => f.id === payload.id);
    if (!root) return null;
    // 跟搬移同一條規則：複製進自己的子孫會無止盡地長（複製的過程中子孫又多了一份）
    if (folderId && (folderId === root.id || isDescendantOf(root.id, folderId))) return null;

    const sub = folderSubtree(root.id);
    const idMap = {};
    sub.folderIds.forEach(function(id) { idMap[id] = newItemId("f_"); });

    const newFolders = [];
    appData.folders.forEach(function(f) {
      if (!sub.folderIds.has(f.id)) return;
      const c = JSON.parse(JSON.stringify(f));
      c.id = idMap[f.id];
      c.worldId = worldId;
      c.parentId = f.id === root.id ? folderId : idMap[f.parentId];
      newFolders.push(c);
    });

    const newDocs = [];
    appData.docs.forEach(function(d) {
      if (sub.docIds.has(d.id)) newDocs.push(cloneDoc(d, idMap[d.folderId]));
    });

    newFolders.forEach(function(f) { appData.folders.push(f); });
    newDocs.forEach(function(d) { appData.docs.push(d); });
    return idMap[root.id];
  }
  return null;
}

/* 「移動」彈窗裡的目的地清單，照這個順序：

     🌐 世界觀一（根目錄）
     　📁 它的資料夾
     　　📁 更深一層
     🌐 世界觀二（根目錄）
     　📁 它的資料夾

   原本是「先列全部的世界觀，再列全部的資料夾」，資料夾看不出是哪個世界觀
   的，同名的資料夾（每個世界觀都有一個「角色」）根本分不出來。

   資料夾不能搬進自己或自己的子孫，所以搬資料夾時那一整支不列。
   目前所在的位置會標出來，打開時也預設選它——這樣一眼就知道「現在在哪」。 */
function moveTargetOptions(ref) {
  const out = [];
  let currentWorldId = null, currentParentId = null, excluded = new Set();

  if (ref && ref.type === "doc") {
    const d = appData.docs.find(x => x.id === ref.id);
    if (d) { currentWorldId = d.worldId; currentParentId = d.folderId || null; }
  } else if (ref && ref.type === "folder") {
    const f = appData.folders.find(x => x.id === ref.id);
    if (f) { currentWorldId = f.worldId; currentParentId = f.parentId || null; }
    excluded = folderSubtree(ref.id).folderIds;
  }

  appData.worldviews.forEach(function(w) {
    out.push({
      worldId: w.id, parentId: null, depth: 0,
      label: (w.icon || "🌐") + " " + w.name + "（根目錄）",
      current: w.id === currentWorldId && currentParentId === null
    });

    const worldFolders = appData.folders.filter(f => f.worldId === w.id);
    const ids = new Set(worldFolders.map(f => f.id));
    const seen = {};
    function walk(folder, depth) {
      if (seen[folder.id] || excluded.has(folder.id)) return;
      seen[folder.id] = true;
      out.push({
        worldId: w.id, parentId: folder.id, depth: depth,
        label: "\u3000".repeat(depth) + (folder.icon || "📁") + " " + folder.name,
        current: w.id === currentWorldId && currentParentId === folder.id
      });
      worldFolders.filter(f => f.parentId === folder.id)
        .forEach(function(sub) { walk(sub, depth + 1); });
    }
    // 上層不在這個世界觀裡的（資料不一致）也當成最上層，不然那一支永遠選不到
    worldFolders.filter(f => !f.parentId || !ids.has(f.parentId))
      .forEach(function(f) { walk(f, 1); });
  });
  return out;
}

/* 手指底下是哪個資料夾。

   highlight 跟 folderId 分開回傳：手指落在「某個資料夾底下的文檔」上時，
   folderId 來自那個容器（.folder-children），但該亮起來的是資料夾那一列。
   回 null 代表這裡不能放（例如浮在側欄外面）。 */
function dropTargetAt(x, y) {
  const el = document.elementFromPoint(x, y);
  if (!el || !el.closest) return null;

  /* 右鍵選單與它的遮罩擋在前面時什麼都不算。正常情況下拖曳開始的那一刻就
     closeContextMenu() 了（display: none 之後 elementFromPoint 就看不到
     它們），這裡是防那一天有人幫關閉加上淡出動畫——那時候遮罩會多活幾十
     毫秒，而它是整片的，手指指到哪裡都會問到它。 */
  if (el.closest("#customContextMenu, #ctxMenuOverlay")) return null;

  const hit = el.closest("[data-folder-id]");
  if (hit) {
    const isRow = hit.classList.contains("node-row-outer");
    return {
      folderId: hit.dataset.folderId,
      highlight: isRow ? hit : hit.previousElementSibling
    };
  }

  // 樹的空白處＝這個世界觀的根目錄。桌機版原本沒有這個目標，
  // 也就是說東西一旦拖進資料夾就拖不回最外層了
  const tree = el.closest("#worldTreeContainer");
  if (tree) return { folderId: null, highlight: tree };

  return null;
}

/* 拖到側欄上下邊緣時自動捲動。

   拖曳期間 touchmove 被 preventDefault 了（不然側欄會跟著手指捲），所以
   原生的捲動在這段時間是停的——沒有這一段，收在畫面外的資料夾就永遠
   放不進去。手指停在邊緣不動也要繼續捲，所以用計時器而不是靠移動事件。 */
const DRAG_EDGE_PX = 48;
const DRAG_SCROLL_STEP_PX = 10;
const DRAG_SCROLL_TICK_MS = 16;

let touchDragState = null;

function touchDragHooks(type, id, label) {
  return {
    start: function(x, y) { startTouchDrag(type, id, label, x, y); },
    move: moveTouchDrag,
    end: endTouchDrag,
    cancel: cancelTouchDrag
  };
}

function startTouchDrag(type, id, label, x, y) {
  // 批次刪除模式下整棵樹是拿來勾選的，這時候拖曳只會讓人誤會
  if (isBatchDeleteMode) return;
  cancelTouchDrag();                       // 上一次沒收乾淨的話先收掉

  const ghost = document.createElement("div");
  ghost.className = "drag-ghost";
  ghost.textContent = label;               // 使用者寫的名字 → textContent（硬規則 5）
  document.body.appendChild(ghost);

  touchDragState = { type: type, id: id, ghost: ghost, highlight: null, scrollDir: 0, scrollTimer: null };
  document.documentElement.classList.add("is-touch-dragging");
  if (navigator.vibrate) { try { navigator.vibrate(8); } catch (e) {} }
  moveTouchDrag(x, y);
}

function moveTouchDrag(x, y) {
  const st = touchDragState;
  if (!st) return;
  /* 用 transform 而不是 left/top：拖曳期間每一次移動都要重畫，transform
     不會觸發版面重排。 -50%/-140% 是把幽靈提到手指上方，不然它整片都被
     手指蓋住，而且會擋住 elementFromPoint 要看的地方。 */
  st.ghost.style.transform = "translate(" + x + "px, " + y + "px) translate(-50%, -140%)";
  setDropHighlight(dropTargetAt(x, y));
  updateDragAutoScroll(y);
}

function setDropHighlight(target) {
  const st = touchDragState;
  if (!st) return;
  const next = target ? target.highlight : null;
  if (next === st.highlight) return;
  if (st.highlight) st.highlight.classList.remove("drop-hover");
  if (next) next.classList.add("drop-hover");
  st.highlight = next;
}

function updateDragAutoScroll(y) {
  const st = touchDragState;
  const tree = document.getElementById("worldTreeContainer");
  if (!st || !tree) return;

  const r = tree.getBoundingClientRect();
  let dir = 0;
  if (y < r.top + DRAG_EDGE_PX) dir = -1;
  else if (y > r.bottom - DRAG_EDGE_PX) dir = 1;
  if (dir === st.scrollDir) return;

  st.scrollDir = dir;
  if (st.scrollTimer) { clearInterval(st.scrollTimer); st.scrollTimer = null; }
  if (!dir) return;
  st.scrollTimer = setInterval(function() {
    tree.scrollTop += dir * DRAG_SCROLL_STEP_PX;
  }, DRAG_SCROLL_TICK_MS);
}

function endTouchDrag(x, y) {
  const st = touchDragState;
  if (!st) return;
  const target = dropTargetAt(x, y);
  const payload = { type: st.type, id: st.id };
  cancelTouchDrag();
  if (!target) return;
  if (moveItemInto(payload, target.folderId, activeWorldId)) {
    if (navigator.vibrate) { try { navigator.vibrate(12); } catch (e) {} }
  }
}

/* 收尾只有這一個出口：放開、系統收走手勢、重新開始一次拖曳，全部走這裡。
   漏掉任何一條，幽靈就會留在畫面上，而且側欄會一直自動捲。 */
function cancelTouchDrag() {
  const st = touchDragState;
  if (!st) return;
  if (st.scrollTimer) clearInterval(st.scrollTimer);
  if (st.highlight) st.highlight.classList.remove("drop-hover");
  if (st.ghost && st.ghost.parentNode) st.ghost.parentNode.removeChild(st.ghost);
  document.documentElement.classList.remove("is-touch-dragging");
  touchDragState = null;
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

 /* 同上：圖示不攔點擊，點它就是開這篇文檔（以前它會被擋掉，點了沒反應，
    跟旁邊的文字點起來不一樣）。改圖示走長按的選單。 */

 attachContextMenu(row,
 function() { return buildDocMenuItems(doc); },
 function() { return (doc.icon || '📄') + ' ' + (doc.title || '無標題文檔'); },
 touchDragHooks("doc", doc.id, (doc.icon || '📄') + ' ' + displayTitle));
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

/* 新的世界觀一建好，裡面就有一篇空白文檔。

   沒有這篇的話，建好之後看到的是一個空的編輯區，要先去找「新增文檔」
   那顆按鈕才能開始寫——而「建一個世界觀」的下一步幾乎一定是「開始寫」。
   selectWorld() 會打開這個世界觀的第一篇，所以建完就直接停在這篇上。

   文檔的形狀跟「新增文檔」共用 makeNewDoc()，兩邊不會各長各的。 */
function promptCreateWorldview() {
 openTextInputModal({
 title: "🌐 新增世界觀",
 fields: [
 { label: "名稱", value: "新世界觀" },
 { label: "一句話簡介（可以留白）", value: "", placeholder: "例如：劍與魔法的帝國",
 maxLength: WORLD_DESC_MAX_LEN }
 ],
 okText: "建立",
 onSubmit: function(values) {
 const name = values[0].trim();
 if (!name) { markTextInputInvalid(0); return false; }   // 名稱不能空，留著讓他補
 createWorldview(name, values[1]);
 }
 });
}

/* 真的建。拆出來是因為 openTextInputModal 是非同步的（按了按鈕才回來），
   而測試要能直接呼叫它。 */
function createWorldview(name, desc) {
 const newWorld = {
 id: "w_" + Date.now(),
 name: name,
 icon: "🌐",
 canvas: { nodes: [], edges: [] }
 };
 applyWorldDesc(newWorld, desc);
 appData.worldviews.push(newWorld);
 appData.docs.unshift(makeNewDoc(newWorld.id, null));
 selectWorld(newWorld.id);
 saveData();
 return newWorld;
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

/* 預設名稱「新分類」一打開就是反藍的，直接打字就取代掉。 */
function promptCreateFolder(parentId = null, worldId = null) {
 openTextInputModal({
 title: "📁 新增資料夾",
 fields: [{ label: "名稱", value: "新分類" }],
 okText: "建立",
 onSubmit: function(values) {
 const name = values[0].trim();
 if (!name) { markTextInputInvalid(0); return false; }
 createFolder(name, parentId, worldId);
 }
 });
}

function createFolder(name, parentId, worldId) {
 const folder = {
 id: newItemId("f_"),
 worldId: worldId || activeWorldId,
 parentId: parentId || null,
 name: name,
 icon: "📁"
 };
 appData.folders.push(folder);
 saveData();
 renderSidebarTree();
 return folder;
}

/* 一篇空白文檔長什麼樣子，只寫在這裡一份。

   「新增文檔」與「新世界觀附帶的那一篇」都從這裡拿。以前欄位是直接寫在
   createNewDoc() 裡的，第二個地方要用就只能複製一份——哪天加了新欄位
   （像 manualTags 當初就是後來加的），複製的那份不會跟著長，那一篇就會
   在某個地方被當成舊資料處理。 */
function makeNewDoc(worldId, folderId) {
 return {
 id: "doc_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7),
 worldId: worldId,
 folderId: folderId || null,
 icon: "📄",
 title: "",
 content: "",
 tags: [],
 manualTags: [],
 images: [],
 wordCount: 0,
 updatedAt: formatTime(new Date())
 };
}

function createNewDoc(targetFolderId = null, worldId = null) {
 const wId = worldId || activeWorldId;
 const newDoc = makeNewDoc(wId, targetFolderId);
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
 openTextInputModal({
 title: "✏️ 重新命名",
 fields: [{ label: "名稱", value: currentName || "" }],
 okText: "確定",
 onSubmit: function(values) {
 const val = values[0].trim();
 if (!val) { markTextInputInvalid(0); return false; }
 if (val !== currentName) renameItem(type, id, val);
 }
 });
}

function renameItem(type, id, val) {
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

/* 離開批量刪除模式（已經不在就什麼都不做）。

   目錄收起來的時候呼叫。批量刪除是「在目錄裡勾選」的狀態，目錄都關了還
   掛著的話：勾選清單留在記憶體裡看不到，下次打開目錄時那幾項還是勾著的，
   隨手按一下「刪除選取項」就把早就忘記的東西刪掉了。 */
function exitBatchDeleteMode() {
 if (!isBatchDeleteMode) return;
 toggleBatchDeleteMode();
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

/* 世界觀刪掉之後，它的名字就不在任何地方了（appData.worldviews 裡那一筆被
   拿掉），垃圾桶裡的東西只剩一個 worldId。垃圾桶要照「是哪個世界觀刪掉的」
   分組顯示，所以在刪的當下把名字蓋在垃圾桶的**每一筆**上。

   為什麼蓋在每一筆上，而不是另外存一份「已刪除的世界觀」清單：逐篇合併
   （sync-merge.js）只合併 trash.docs 與 trash.folders，trash 底下多出來的
   任何欄位在自動合併時都會被丟掉——另外存一份的話，同步一次名字就沒了。
   蓋在每一筆上，它就跟著那一筆一起被合併。

   不只蓋這次刪掉的：之前就從這個世界觀刪進垃圾桶的東西，現在也一起變成
   「世界觀已經不在」，一樣要知道自己是哪裡來的。 */
function stampDeletedWorldOnTrash(worldId, name, icon) {
 const t = appData.trash || {};
 ["docs", "folders", "canvas"].forEach(function(k) {
 (t[k] || []).forEach(function(item) {
 if (item.worldId !== worldId) return;
 item.fromWorldName = name;
 item.fromWorldIcon = icon || "🌐";
 });
 });
}

/* 從垃圾桶把整個世界觀復原回來。

   帶回來的是「刪世界觀的當下在裡面的東西」（trashedWithWorld 標記的）。
   在那之前就刪掉的留在垃圾桶——復原完它們就歸到這個（又存在了的）世界觀
   底下，要的話可以再個別復原。

   舊資料（刪的時候還沒有 trash.worlds）沒有整筆紀錄、也沒有標記：用蓋在
   項目上的名字重建一個（白板是空的），屬於它的全部帶回來——分不出哪些是
   早就刪掉的，寧可多帶。 */
function restoreWorldFromTrash(worldId) {
 const t = appData.trash;
 if (!Array.isArray(t.worlds)) t.worlds = [];
 if (appData.worldviews.some(w => w.id === worldId)) return;   // 已經在了（例如另一台先復原、同步過來）

 const idx = t.worlds.findIndex(w => w.id === worldId);
 let world;
 let belongs;
 if (idx !== -1) {
 world = t.worlds.splice(idx, 1)[0];
 belongs = function(x) { return x.worldId === worldId && x.trashedWithWorld === worldId; };
 } else {
 const any = (t.docs || []).concat(t.folders || [], t.canvas || [])
 .find(x => x.worldId === worldId && x.fromWorldName);
 world = {
 id: worldId,
 name: any ? any.fromWorldName : "復原的世界觀",
 icon: any ? (any.fromWorldIcon || "🌐") : "🌐"
 };
 belongs = function(x) { return x.worldId === worldId; };
 }
 delete world.deletedAt;
 delete world.deletedTs;
 if (!world.canvas || typeof world.canvas !== "object") world.canvas = {};
 ["nodes", "edges", "notes"].forEach(function(k) {
 if (!Array.isArray(world.canvas[k])) world.canvas[k] = [];
 });
 appData.worldviews.push(world);

 const clean = function(x) {
 ["deletedAt", "deletedTs", "trashedWithWorld", "fromWorldName", "fromWorldIcon"].forEach(function(k) { delete x[k]; });
 return x;
 };
 const backFolders = (t.folders || []).filter(belongs);
 const backDocs = (t.docs || []).filter(belongs);
 t.folders = (t.folders || []).filter(x => !belongs(x));
 t.docs = (t.docs || []).filter(x => !belongs(x));

 const folderIds = new Set(backFolders.map(f => f.id));
 backFolders.forEach(function(f) {
 clean(f);
 // 上層不在這一批裡（早就被個別刪掉了）就放到最外層，不然畫不出來
 if (f.parentId && !folderIds.has(f.parentId) && !appData.folders.some(x => x.id === f.parentId)) f.parentId = null;
 appData.folders.push(f);
 });
 backDocs.forEach(function(d) {
 clean(d);
 if (d.folderId && !folderIds.has(d.folderId) && !appData.folders.some(x => x.id === d.folderId)) d.folderId = null;
 if (!Array.isArray(d.manualTags) && typeof computeManualTagsFor === "function") {
 d.manualTags = computeManualTagsFor(d.content, d.tags);
 }
 appData.docs.push(d);
 });

 saveData();
 updateWorldBadge();
 renderSidebarTree();
 if (typeof renderTrashList === "function") renderTrashList();
 if (typeof refreshCanvasIfVisible === "function") refreshCanvasIfVisible();
 return world;
}

/* 整個世界觀永久刪除：紀錄，加上垃圾桶裡屬於它的全部（包括更早就刪掉的——
   世界觀都永久刪了，它們再也沒有地方可以回去）。 */
function permanentlyDeleteTrashWorld(worldId) {
 const t = appData.trash;
 const rec = (t.worlds || []).find(w => w.id === worldId);
 const name = rec ? rec.name : "這個世界觀";
 if (!confirm("確定要永久刪除「" + name + "」整個世界觀嗎？裡面的東西會一起刪除，此動作無法復原！")) return;
 const other = function(x) { return x.worldId !== worldId; };
 t.worlds = (t.worlds || []).filter(w => w.id !== worldId);
 t.docs = (t.docs || []).filter(other);
 t.folders = (t.folders || []).filter(other);
 t.canvas = (t.canvas || []).filter(other);
 saveData();
 if (typeof renderTrashList === "function") renderTrashList();
}

function deleteWorldById(worldId) {
 if (appData.worldviews.length <= 1) {
 alert("這是最後一個世界觀，無法刪除！");
 return;
 }

 if (!confirm("確定要刪除此世界觀嗎？\n（整個世界觀——資料夾、文檔、白板——會一起移到垃圾桶，可以整個復原）")) {
 return;
 }

 const world = appData.worldviews.find(w => w.id === worldId);
 if (!world) return;

 /* 整筆存下來，**在動任何東西之前**：名稱、圖示、簡介、整張白板（節點、
    連線、便條紙）。以前這一筆是直接丟掉的——文檔與資料夾進了垃圾桶，但
    白板上的便條紙與連線說明永遠回不來，世界觀本身也只能重建一個新的。 */
 const snapshot = JSON.parse(JSON.stringify(world));
 const now = formatTime(new Date());
 if (!Array.isArray(appData.trash.worlds)) appData.trash.worlds = [];
 appData.trash.worlds.push(Object.assign(snapshot, { deletedAt: now, deletedTs: Date.now() }));

 const docsToTrash = appData.docs.filter(d => d.worldId === worldId);
 const foldersToTrash = appData.folders.filter(f => f.worldId === worldId);

 appData.docs = appData.docs.filter(d => d.worldId !== worldId);
 appData.folders = appData.folders.filter(f => f.worldId !== worldId);

 /* 標記「隨世界觀一起進來的」：復原世界觀時只帶這些回去。在這之前就從
    這個世界觀刪掉的東西不該跟著復活——那是使用者本來就丟掉的。
    keepCanvas：白板節點已經在上面那一筆裡了，不要再拆一份進垃圾桶。 */
 const opts = { extra: { trashedWithWorld: worldId }, keepCanvas: true };
 if (typeof moveDocsToTrash === 'function') moveDocsToTrash(docsToTrash, opts);
 if (typeof moveFoldersToTrash === 'function') moveFoldersToTrash(foldersToTrash, opts);

 stampDeletedWorldOnTrash(worldId, world.name, world.icon);

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
