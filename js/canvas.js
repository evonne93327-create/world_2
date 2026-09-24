/* ==========================================================
   白板 (Graphs) — viewBox 架構 + 扇形發散連線
   ========================================================== */

const CANVAS_NODE_W = 200;

let zoomIndicatorTimer = null;

/* ---------- 白板物件的身分與時間 ----------

   節點、連線、便條紙各自有一個永久的 id（建立時產生，之後不再改變），
   新增／修改／刪除一律照 id 找物件，不用陣列索引——同步會逐個物件
   合併，索引在兩台裝置上不會一樣。

   createdAt／updatedAt 是 ISO 時間字串。只在「真的建立／改了內容」時
   蓋章：舊資料沒有這兩欄也不補，補了的話每個物件在每台裝置上都會同時
   「被改過」，下次同步就全部變成衝突。 */
function canvasTimestamp() {
  return new Date().toISOString();
}

function stampCanvasCreated(obj) {
  const t = canvasTimestamp();
  obj.createdAt = t;
  obj.updatedAt = t;
  return obj;
}

function touchCanvasObject(obj) {
  if (obj) obj.updatedAt = canvasTimestamp();
}

function getCurrentWorldCanvas() {
  const world = appData.worldviews.find(w => w.id === activeWorldId);
  if (!world.canvas) world.canvas = { nodes: [], edges: [], notes: [] };
  // 便條紙是後來才加的，舊資料沒有這個欄位
  if (!world.canvas.notes) world.canvas.notes = [];
  return world.canvas;
}

/* ---------- 座標轉換 ---------- */

function worldToScreen(wx, wy) {
  return {
    x: wx * canvasTransform.scale + canvasTransform.x,
    y: wy * canvasTransform.scale + canvasTransform.y
  };
}

function screenToWorld(sx, sy) {
  return {
    x: (sx - canvasTransform.x) / canvasTransform.scale,
    y: (sy - canvasTransform.y) / canvasTransform.scale
  };
}

function clampScale(s) {
  return Math.max(CANVAS_MIN_SCALE, Math.min(CANVAS_MAX_SCALE, s));
}

/* ---------- 重置視圖 ---------- */

function resetCanvasView() {
  canvasTransform = { x: 0, y: 0, scale: 1 };
  applyCanvasTransform();
  applySvgViewBox();
}

/* ---------- 操作提示橫幅 ----------
   收合狀態記在 localStorage：使用者關掉它通常是因為已經記住操作了，
   每次開啟又跳回來只會讓人再關一次。 */

const CANVAS_HINT_KEY = "world_canvas_hint_hidden_v1";

function isCanvasHintHidden() {
  try {
    return safeStorageGet(CANVAS_HINT_KEY) === "1";
  } catch (e) {
    // 隱私模式之類讀不到 localStorage 的情況，就當作沒收起來
    return false;
  }
}

function applyCanvasHintVisibility() {
  const hint = document.getElementById("canvasHint");
  const toggle = document.getElementById("canvasHintToggle");
  const hidden = isCanvasHintHidden();

  if (hint) hint.classList.toggle("is-hidden", hidden);
  if (toggle) {
    toggle.classList.toggle("is-active", !hidden);
    toggle.setAttribute("aria-expanded", hidden ? "false" : "true");
    toggle.title = hidden ? "顯示操作提示" : "隱藏操作提示";
  }
}

function toggleCanvasHint() {
  try {
    safeStorageSet(CANVAS_HINT_KEY, isCanvasHintHidden() ? "0" : "1");
  } catch (e) { /* 存不了就只有這次有效，不影響操作 */ }
  applyCanvasHintVisibility();
}

/* ---------- 倍數指示 ---------- */

function showZoomIndicator() {
  const el = document.getElementById("canvasZoomIndicator");
  if (!el) return;
  el.textContent = Math.round(canvasTransform.scale * 100) + "%";
  el.classList.add("is-visible");
  if (zoomIndicatorTimer) clearTimeout(zoomIndicatorTimer);
  zoomIndicatorTimer = setTimeout(function() {
    el.classList.remove("is-visible");
    zoomIndicatorTimer = null;
  }, 1000);
}

/* ---------- 加入白板 ---------- */

function addCurrentDocToCanvas() {
  const currentDoc = appData.docs.find(d => d.id === activeDocId);
  if (!currentDoc) { alert("請先選擇或開啟一個文檔！"); return; }

  const canvas = getCurrentWorldCanvas();
  const exists = canvas.nodes.find(n => n.docId === currentDoc.id);
  if (exists) {
    alert("此文檔已存在於當前白板！");
    switchView('canvas');
    // 已經在白板上了，那就帶使用者去看它在哪——光說「已存在」不夠，
    // 白板拉遠或平移過的時候根本找不到那個節點
    focusCanvasNode(currentDoc.id);
    return;
  }

  canvas.nodes.push(stampCanvasCreated({
    id: "node_" + currentDoc.id,
    docId: currentDoc.id,
    x: 40 + (canvas.nodes.length * 30) % 260,
    y: 60 + (canvas.nodes.length * 40) % 300
  }));

  saveData();
  switchView('canvas');
  // 新節點是照既有數量排位置的，白板平移縮放過之後它不一定落在看得見的
  // 地方。投射完直接對準它，跟在白板檢視下點目錄同樣的感覺。
  focusCanvasNode(currentDoc.id);
}

/* ---------- 批量投射 ----------

   一篇一篇投射的話，二十篇角色就要開二十次文檔、按二十次「投射白板」。
   這裡一次勾選、一次放上去。

   只列「目前這個世界觀」的文檔：白板是一個世界觀一張，列別的世界觀的
   文檔只會讓人以為可以把它們放到這張白板上。 */

/* 新節點要放在哪裡。純函式，不碰 DOM。

   放在既有節點的**下方**、排成網格：
   - 不會疊在任何既有節點上（原本單篇投射是照數量斜斜地錯開，一次放十幾篇
     的話會疊成一坨，而且會壓在使用者已經排好的節點上）
   - 欄數取接近正方形（上限 4 欄）。3 篇排成一橫排太長、20 篇排成一直排
     太高，都要捲很久才看得完

   既有節點的高度這裡不知道（要量 DOM），用一個保守的估計值往下讓。
   估大了只是多空一點，估小了才會疊到。 */
const BATCH_GAP_X = 40;
const BATCH_ROW_H = 150;
const BATCH_MAX_COLS = 4;
const BATCH_EST_NODE_H = 120;

function batchNodePositions(existingNodes, count) {
  if (!count || count < 1) return [];
  const cols = Math.min(BATCH_MAX_COLS, Math.max(1, Math.ceil(Math.sqrt(count))));

  let originX = 40, originY = 60;
  const nodes = existingNodes || [];
  if (nodes.length) {
    let minX = Infinity, maxBottom = -Infinity;
    nodes.forEach(function(n) {
      if (typeof n.x === "number" && n.x < minX) minX = n.x;
      if (typeof n.y === "number" && n.y + BATCH_EST_NODE_H > maxBottom) maxBottom = n.y + BATCH_EST_NODE_H;
    });
    if (isFinite(minX)) originX = minX;
    if (isFinite(maxBottom)) originY = maxBottom + BATCH_GAP_X;
  }

  const out = [];
  for (let i = 0; i < count; i++) {
    out.push({
      x: originX + (i % cols) * (CANVAS_NODE_W + BATCH_GAP_X),
      y: originY + Math.floor(i / cols) * BATCH_ROW_H
    });
  }
  return out;
}

/* 真的放上去。回傳實際新增的文檔 id（已經在白板上的、不屬於這個世界觀
   的、重複的都會跳過）——呼叫端要拿它來決定畫面要對準哪裡。 */
function projectDocsToCanvas(docIds) {
  const canvas = getCurrentWorldCanvas();
  const onBoard = new Set(canvas.nodes.map(function(n) { return n.docId; }));
  const ids = (docIds || []).filter(function(id, i, arr) {
    return !onBoard.has(id) && arr.indexOf(id) === i &&
      appData.docs.some(function(d) { return d.id === id && d.worldId === activeWorldId; });
  });
  if (!ids.length) return [];

  const spots = batchNodePositions(canvas.nodes, ids.length);
  ids.forEach(function(id, i) {
    canvas.nodes.push(stampCanvasCreated({ id: "node_" + id, docId: id, x: spots[i].x, y: spots[i].y }));
  });
  saveData();
  return ids;
}

function openBatchProjectModal() {
  renderBatchProjectList();
  document.getElementById("batchProjectModal").classList.add("active");
}

function closeBatchProjectModal() {
  document.getElementById("batchProjectModal").classList.remove("active");
}

/* 依資料夾的樹狀結構列出來，資料夾那一列的勾勾一次切換底下所有文檔
   （含更深的子資料夾）。

   已經在白板上的文檔照樣列出來、勾著但不能動，並標「已在白板上」——
   直接藏起來的話，使用者會以為那篇不見了，或是以為沒列到是漏掉。

   一律 createElement + textContent（硬規則 5；批量匯出那邊以前就是拼 HTML
   被做出一個可利用的洞，見 openBatchExportModal 的註解）。 */
function renderBatchProjectList() {
  const box = document.getElementById("batchProjectList");
  if (!box) return;
  box.innerHTML = "";

  const onBoard = new Set(getCurrentWorldCanvas().nodes.map(function(n) { return n.docId; }));
  const worldDocs = appData.docs.filter(function(d) { return d.worldId === activeWorldId; });
  const worldFolders = appData.folders.filter(function(f) { return f.worldId === activeWorldId; });
  const folderIds = new Set(worldFolders.map(function(f) { return f.id; }));

  if (!worldDocs.length) {
    const empty = document.createElement("div");
    empty.className = "batch-project-empty";
    empty.textContent = "這個世界觀還沒有文檔。";
    box.appendChild(empty);
    updateBatchProjectCount();
    return;
  }

  function docRow(d, depth) {
    const row = document.createElement("label");
    row.className = "batch-project-row";
    row.style.paddingLeft = (8 + depth * 18) + "px";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.className = "batch-project-doc";
    cb.dataset.id = d.id;
    const already = onBoard.has(d.id);
    cb.checked = already;
    cb.disabled = already;
    cb.onchange = updateBatchProjectCount;

    const name = document.createElement("span");
    name.className = "batch-project-name";
    name.textContent = (d.icon || "📄") + " " + (d.title || "無標題文檔");

    row.appendChild(cb);
    row.appendChild(name);
    if (already) {
      row.classList.add("is-on-board");
      const tag = document.createElement("span");
      tag.className = "batch-project-tag";
      tag.textContent = "已在白板上";
      row.appendChild(tag);
    }
    return row;
  }

  /* seen 防資料損毀時 parentId 繞成圈（跟 folderSubtreeHasMatch 同一招）。 */
  const seen = {};
  function folderGroup(folder, depth) {
    if (seen[folder.id]) return null;
    seen[folder.id] = true;

    const group = document.createElement("div");
    group.className = "batch-project-group";

    const head = document.createElement("label");
    head.className = "batch-project-row is-folder";
    head.style.paddingLeft = (8 + depth * 18) + "px";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.className = "batch-project-folder";
    const name = document.createElement("span");
    name.className = "batch-project-name";
    name.textContent = (folder.icon || "📁") + " " + folder.name;
    head.appendChild(cb);
    head.appendChild(name);
    group.appendChild(head);

    worldFolders.filter(function(f) { return f.parentId === folder.id; })
      .forEach(function(sub) {
        const g = folderGroup(sub, depth + 1);
        if (g) group.appendChild(g);
      });
    worldDocs.filter(function(d) { return d.folderId === folder.id; })
      .forEach(function(d) { group.appendChild(docRow(d, depth + 1)); });

    cb.onchange = function() {
      group.querySelectorAll(".batch-project-doc:not(:disabled)")
        .forEach(function(x) { x.checked = cb.checked; });
      updateBatchProjectCount();
    };
    return group;
  }

  /* 最上層＝沒有上層、或上層不在這個世界觀裡的資料夾。後者是資料不一致
     （上層被刪掉、或被搬到別的世界觀），不當成最上層的話那一整支就永遠
     列不出來。 */
  worldFolders
    .filter(function(f) { return !f.parentId || !folderIds.has(f.parentId); })
    .forEach(function(f) {
      const g = folderGroup(f, 0);
      if (g) box.appendChild(g);
    });

  /* 根目錄的文檔，以及「資料夾不見了」的文檔。後者在目錄樹裡是畫不出來的
     （那邊只從資料夾往下找），這裡至少讓它們被看見、被放上白板。 */
  worldDocs
    .filter(function(d) { return !d.folderId || !seen[d.folderId]; })
    .forEach(function(d) { box.appendChild(docRow(d, 0)); });

  updateBatchProjectCount();
}

/* 按鈕上的數字，以及每個資料夾勾勾的三種狀態（全勾／部分／沒勾）。
   「部分」用 indeterminate 畫那條橫線，不然勾了一半的資料夾看起來跟
   沒勾一樣，使用者會以為點一下是「全勾」，結果是「全取消」。 */
function updateBatchProjectCount() {
  const box = document.getElementById("batchProjectList");
  const btn = document.getElementById("batchProjectConfirmBtn");
  if (!box) return;

  const n = box.querySelectorAll(".batch-project-doc:checked:not(:disabled)").length;
  if (btn) {
    btn.textContent = n ? ("📌 投射 " + n + " 篇") : "📌 投射";
    btn.disabled = n === 0;
  }

  box.querySelectorAll(".batch-project-group").forEach(function(group) {
    const cb = group.querySelector(".batch-project-folder");
    const docs = group.querySelectorAll(".batch-project-doc:not(:disabled)");
    const on = group.querySelectorAll(".batch-project-doc:checked:not(:disabled)").length;
    cb.disabled = docs.length === 0;          // 底下全都已經在白板上了
    cb.checked = docs.length > 0 && on === docs.length;
    cb.indeterminate = on > 0 && on < docs.length;
  });
}

function toggleBatchProjectAll(status) {
  document.querySelectorAll("#batchProjectList .batch-project-doc:not(:disabled)")
    .forEach(function(x) { x.checked = status; });
  updateBatchProjectCount();
}

function confirmBatchProject() {
  const ids = Array.from(document.querySelectorAll("#batchProjectList .batch-project-doc:checked:not(:disabled)"))
    .map(function(x) { return x.dataset.id; });
  const added = projectDocsToCanvas(ids);
  closeBatchProjectModal();
  if (!added.length) return;

  switchView("canvas");
  // 新的一批放在既有節點下方，可能完全在畫面外。對準第一個，跟單篇投射一樣
  focusCanvasNode(added[0]);
}

/* ---------- 渲染節點 ----------
   節點現在是畫在 <canvasSvg> 裡的 <foreignObject>（內含一般 HTML），
   跟連線共用同一個 viewBox 做縮放，所以放大時是瀏覽器真的重新排版、
   重新描字，而不是把一張畫好的貼圖拉伸，因此不會糊。
   ------------------------------------------------------------- */

/* 節點量出來的高度。

   原本是掛在 appData 裡的 node 物件上（node._lastH），那是量測用的暫存值，
   卻會跟著被序列化進 localStorage、也會被同步上雲、匯出檔案裡也有。
   改存在一個獨立的 Map，跟資料完全分開。

   不需要清理：節點被刪掉之後那一筆留著也只是幾個位元組，而且 id 不重複，
   下次用到同一個 id 一定是同一個節點。 */
const nodeHeightCache = new Map();

const SVG_NS = "http://www.w3.org/2000/svg";
const XHTML_NS = "http://www.w3.org/1999/xhtml";

function getCanvasNodesLayer(svg) {
  let layer = document.getElementById("canvasNodesLayer");
  if (!layer) {
    layer = document.createElementNS(SVG_NS, "g");
    layer.setAttribute("id", "canvasNodesLayer");
  }
  // 一定要放在 canvasEdgesLayer 之後，節點才會畫在連線上方
  svg.appendChild(layer);
  return layer;
}

function renderCanvas() {
  const svg = document.getElementById("canvasSvg");
  if (!svg) return;
  const canvas = getCurrentWorldCanvas();
  const nodesLayer = getCanvasNodesLayer(svg);
  nodesLayer.innerHTML = "";

  canvas.nodes.forEach(function(node) {
    const doc = appData.docs.find(d => d.id === node.docId);
    if (!doc) return;

    const fo = document.createElementNS(SVG_NS, "foreignObject");
    fo.setAttribute("x", node.x);
    fo.setAttribute("y", node.y);
    fo.setAttribute("width", CANVAS_NODE_W);
    fo.setAttribute("height", nodeHeightCache.get(node.id) || 80);

    const el = document.createElementNS(XHTML_NS, "div");
    el.className = "canvas-node";
    el.id = node.id;

    if (connectingSourceNodeId === node.id) el.classList.add("connecting");

    applyNodeColor(el, node);

    const title = (doc.icon || '📄') + " " + (doc.title || "無標題文檔");
    /* 只取前面一小段。原本是把整篇內文塞進 DOM，只靠 CSS 的
       max-height:32px 裁掉——節點多又都是長文時，DOM 裡會有大量根本
       看不到的文字。120 字已經比那兩行塞得下的還多。 */
    const preview = (doc.content || "").replace(/\n/g, " ").slice(0, 120);

    // 白名單擋第一層；圖片本身改用 DOM 屬性掛上去，不拼進 HTML 字串（第二層）
    const thumbSrc = (doc.images && doc.images.length > 0 && isSafeImageSrc(doc.images[0]))
      ? doc.images[0] : null;
    const imgHtml = thumbSrc ? '<div class="canvas-node-thumb"></div>' : "";

    el.innerHTML =
      '<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">' +
        '<span style="font-size:12px; font-weight:700; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:170px;">' + escapeHtml(title) + '</span>' +
      '</div>' +
      imgHtml +
      '<div style="font-size:11px; color:var(--text-secondary); line-height:1.4; max-height:32px; overflow:hidden; margin-bottom:4px;">' + escapeHtml(preview) + '</div>' +
      /* 最後這一列同時放小鎖（左）與字數（右）。包成橫排是為了讓小鎖
         不用定位就能靠左下角——理由見 applyCanvasLockBadge 的註解。 */
      '<div class="canvas-node-foot"><span class="canvas-node-words">' + (doc.wordCount || 0) + ' 字</span></div>';

    if (thumbSrc) {
      const holder = el.querySelector(".canvas-node-thumb");
      if (holder) {
        const thumb = document.createElementNS(XHTML_NS, "img");
        thumb.setAttribute("style",
          "width:100%; height:75px; object-fit:cover; border-radius:4px; margin-bottom:6px;");
        thumb.src = thumbSrc;
        holder.replaceWith(thumb);
      }
    }

    el.ondblclick = function() {
      if (connectingSourceNodeId) return;
      loadDocToEditor(doc.id);
      switchView('editor');
    };

    // 鎖住的話在左下角放一個小鎖，跟便條紙同一個位置
    applyCanvasLockBadge(el, node, el.querySelector(".canvas-node-foot"), true);

    attachContextMenu(
      el,
      function() { return buildCanvasNodeMenuItems(node, doc); },
      function() { return (doc.icon || '📄') + ' ' + (doc.title || '無標題文檔'); }
    );

    enableDualDrag(el, node);
    fo.appendChild(el);
    nodesLayer.appendChild(fo);
  });

  // 量測每個節點實際內容高度，修正 foreignObject 的 height，
  // 避免內容被裁切，也讓 getNodeRect() 拿到正確高度。
  canvas.nodes.forEach(function(node) {
    const el = document.getElementById(node.id);
    if (!el) return;
    const fo = el.parentNode;
    const h = el.offsetHeight || 80;
    nodeHeightCache.set(node.id, h);
    if (fo && fo.setAttribute) fo.setAttribute("height", h);
  });

  renderCanvasNotes();
  applySvgViewBox();
  renderCanvasLines();
}

/* 節點上顯示的是文檔的標題、圖示、內文摘要與字數，但改這些欄位的程式
   都在白板以外（目錄改名、換圖示…），很容易忘記通知白板重畫。包成一個
   函式讓那些地方呼叫，不用各自判斷現在是不是在看白板。

   右下角的「重整白板」按鈕留著當保險：這類「某條路徑忘了重畫」的漏洞
   不會只發生一次，留一個使用者自己救得回來的出口比較實際。 */
function refreshCanvasIfVisible() {
  if (typeof activeView !== "undefined" && activeView !== "canvas") return;
  renderCanvas();
}

/* ---------- 節點底色 ----------

   用的是標籤那一套調色盤（appData.colorPalette），同一組顏色、同一組
   分類名稱，所以白板上的顏色跟文檔裡的標籤講的是同一種語言。

   沒設定 color 的節點完全不碰 style，維持 CSS 裡原本的米白，
   以後改 .canvas-node 的預設樣式也不會被這裡蓋掉。
   ------------------------------------------------------------- */

function getNodePalette(node) {
  if (!node || !node.color || !DEFAULT_PALETTES[node.color]) return null;
  return getPalette(node.color);
}

/* 調色盤只存了 bg 與 text 兩色，邊框用 text 淡化出來，
   免得深色邊框把整張卡片壓得太重。 */
function paletteBorderColor(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return "";
  const n = parseInt(m[1], 16);
  return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + ",0.32)";
}

function applyNodeColor(el, node) {
  const pal = getNodePalette(node);
  if (!pal) {
    el.style.background = "";
    el.style.borderColor = "";
    el.style.color = "";
    return;
  }
  el.style.background = pal.bg;
  el.style.borderColor = paletteBorderColor(pal.text);
  // 標題沒有自己的顏色，會繼承這個；摘要與字數各自帶著 --text-secondary
  // 與 --text-muted，在七個淺色底上都還讀得清楚，不用另外處理。
  el.style.color = pal.text;
}

/* 沿用標籤的選色彈窗：圓點＋分類名稱，點下去直接套用。
   節點的右鍵選單沒有錨點元素可用（選單自己會先關掉），所以錨在節點上。 */
function openNodeColorPicker(node) {
  const popover = document.getElementById("colorPickerPopover");
  if (!popover) return;

  popover.innerHTML =
    '<div style="font-size:11px; font-weight:700; color:var(--text-muted); margin-bottom:4px;">節點底色：</div>';

  Object.keys(DEFAULT_PALETTES).forEach(function(key) {
    const pal = getPalette(key);
    const opt = document.createElement("div");
    opt.className = "picker-option";
    opt.dataset.colorId = key;
    opt.innerHTML =
      '<span style="width:14px; height:14px; border-radius:50%; background:' + pal.bg +
      '; border:1.5px solid ' + pal.text + '; flex:none;"></span>' +
      '<span style="color:' + pal.text + '; font-weight:600;">' + escapeHtml(pal.name) + '</span>' +
      (node.color === key ? '<span style="margin-left:auto; color:' + pal.text + ';">✓</span>' : '');
    opt.onclick = function() {
      node.color = key;
      touchCanvasObject(node);
      saveData();
      renderCanvas();
      popover.classList.remove("active");
    };
    popover.appendChild(opt);
  });

  const divider = document.createElement("div");
  divider.className = "picker-option-divider";
  popover.appendChild(divider);

  const resetOpt = document.createElement("div");
  resetOpt.className = "picker-option";
  resetOpt.dataset.colorId = "";
  resetOpt.innerHTML =
    '<span style="width:14px; text-align:center; flex:none;">↺</span><span>恢復預設底色</span>' +
    (node.color ? '' : '<span style="margin-left:auto; color:var(--text-muted);">✓</span>');
  resetOpt.onclick = function() {
    delete node.color;
    saveData();
    renderCanvas();
    popover.classList.remove("active");
  };
  popover.appendChild(resetOpt);

  showPickerNear(popover, document.getElementById(node.id));
}

/* 彈窗要夾在畫面裡。節點可能被拖到邊邊，或在手機上佔掉大半個螢幕，
   直接貼在節點下方常常會掉出去。 */
/* 白板的節點顏色選單跟標籤的顏色選單是同一個 DOM 元素，定位規則也該一樣。
   共用 openAnchoredPopover() 之後，白板平移縮放時它也會跟著節點跑。 */
function showPickerNear(popover, anchor) {
  openAnchoredPopover(popover, anchor);
}

/* ---------- 縮放指示（節點/連線都已在 SVG 裡，viewBox 自動處理縮放）---------- */

function applyCanvasTransform(silent) {
  if (!silent) showZoomIndicator();
}

/* ---------- SVG viewBox ---------- */

function applySvgViewBox() {
  const svg = document.getElementById("canvasSvg");
  if (!svg) return;
  const view = document.getElementById("canvasView");
  const rect = view.getBoundingClientRect();
  // 白板沒顯示時（切到文檔檢視）量到的是 0×0，寫進去會得到一個退化的
  // viewBox，之後切回白板前都是壞的。寧可保留上一次的值。
  if (rect.width === 0 || rect.height === 0) return;
  const w = rect.width / canvasTransform.scale;
  const h = rect.height / canvasTransform.scale;
  const x = -canvasTransform.x / canvasTransform.scale;
  const y = -canvasTransform.y / canvasTransform.scale;

  svg.setAttribute("viewBox", x + " " + y + " " + w + " " + h);
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("width", rect.width);
  svg.setAttribute("height", rect.height);
}

/* ==========================================================
   便條紙

   長按白板空白處新增。便條紙跟節點一樣是畫在 SVG 裡的 foreignObject，
   所以會跟著平移縮放一起動，座標存的是白板世界座標而不是畫面座標。

   圖層刻意放在最底下（連線與節點之下）：便條紙是背景註記，蓋在連線上
   會擋住關係圖本身。
   ========================================================== */

const NOTE_MIN_W = 120;
const NOTE_MIN_H = 80;
const NOTE_DEFAULT_W = 180;
const NOTE_DEFAULT_H = 120;

function getCanvasNotesLayer(svg) {
  let layer = document.getElementById("canvasNotesLayer");
  if (!layer) {
    layer = document.createElementNS(SVG_NS, "g");
    layer.setAttribute("id", "canvasNotesLayer");
  }
  // 插在最前面＝畫在最底下
  if (svg.firstChild !== layer) svg.insertBefore(layer, svg.firstChild);
  return layer;
}

function createCanvasNote(wx, wy) {
  const canvas = getCurrentWorldCanvas();
  const note = {
    id: "note_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7),
    // 以長按的點為中心放置，手指／滑鼠按在哪就長在哪
    x: wx - NOTE_DEFAULT_W / 2,
    y: wy - NOTE_DEFAULT_H / 2,
    w: NOTE_DEFAULT_W,
    h: NOTE_DEFAULT_H,
    text: ""
  };
  stampCanvasCreated(note);
  canvas.notes.push(note);
  saveData();
  renderCanvas();
  // 新的便條紙是空的，直接進入編輯狀態，不用再多按一次
  startEditCanvasNote(note.id);
  return note;
}

function deleteCanvasNote(noteId) {
  trashCanvasNote(noteId);   // 收進垃圾桶，不是直接丟掉
}

function startEditCanvasNote(noteId) {
  const el = document.getElementById(noteId);
  if (!el) return;
  const body = el.querySelector(".canvas-note-body");
  if (!body) return;
  body.setAttribute("contenteditable", "true");
  el.classList.add("is-editing");
  body.focus();

  // 游標移到最後，不然點進去會停在開頭
  const range = document.createRange();
  range.selectNodeContents(body);
  range.collapse(false);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);

  watchCaretVisibility();
}

/* ---------- 讓游標不要被鍵盤蓋住 ----------

   手機打開虛擬鍵盤時，viewport meta 設的是 interactive-widget=resizes-content，
   所以版面（100dvh）會跟著縮短，白板容器也跟著變矮。便條紙的座標是世界座標
   不會動，結果就是正在打字的那一行可能落在鍵盤底下，看不到自己在打什麼。

   解法是把白板往上平移，讓游標落回看得見的範圍。動的是 canvasTransform，
   不是便條紙本身的座標——使用者的資料不該因為鍵盤跳出來就被改掉。
   ------------------------------------------------------------- */

const CARET_MARGIN = 24;   // 游標離可視邊界至少留這麼多，貼著邊很難讀
let caretWatchBound = false;
let caretRafId = null;

function caretClientRect(container) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!container.contains(range.startContainer)) return null;

  const r = range.getBoundingClientRect();
  // 空行的 collapsed range 可能回傳全 0。不塞臨時節點去量——那會改動
  // 內容並觸發 input，把零寬字元存進使用者的便條紙裡。退而用整張便條紙，
  // 便條紙本來就不大，夠用了。
  if (r && (r.width > 0 || r.height > 0)) return r;
  return null;
}

function keepCaretAboveKeyboard() {
  const el = document.querySelector(".canvas-note.is-editing");
  if (!el) return;
  const view = document.getElementById("canvasView");
  if (!view) return;

  const viewRect = view.getBoundingClientRect();
  if (viewRect.width === 0 || viewRect.height === 0) return;

  const body = el.querySelector(".canvas-note-body");
  const target = (body && caretClientRect(body)) || el.getBoundingClientRect();

  // 可視區域：白板容器與 visual viewport 的交集。
  // 有些瀏覽器不縮版面而是蓋上去，那時候只有 visualViewport 反映得出鍵盤。
  const vv = window.visualViewport;
  const vvTop = vv ? vv.offsetTop : 0;
  const vvBottom = vv ? vv.offsetTop + vv.height : window.innerHeight;

  const limitTop = Math.max(viewRect.top, vvTop) + CARET_MARGIN;
  const limitBottom = Math.min(viewRect.bottom, vvBottom) - CARET_MARGIN;
  if (limitBottom <= limitTop) return;   // 空間比邊界還小，硬移沒有意義

  let dy = 0;
  if (target.bottom > limitBottom) dy = limitBottom - target.bottom;
  else if (target.top < limitTop) dy = limitTop - target.top;

  if (Math.abs(dy) < 1) return;
  canvasTransform.y += dy;
  applySvgViewBox();
}

function scheduleCaretCheck() {
  if (caretRafId) return;              // 打字與 selectionchange 會連發，一格算一次就好
  caretRafId = requestAnimationFrame(function() {
    caretRafId = null;
    keepCaretAboveKeyboard();
  });
}

function watchCaretVisibility() {
  // 鍵盤是非同步跳出來的，進入編輯的當下量不到，要等 viewport 真的變了
  scheduleCaretCheck();
  if (caretWatchBound) return;
  caretWatchBound = true;

  document.addEventListener("selectionchange", scheduleCaretCheck);
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", scheduleCaretCheck);
    window.visualViewport.addEventListener("scroll", scheduleCaretCheck);
  } else {
    window.addEventListener("resize", scheduleCaretCheck);
  }
}

/* 打字期間每個鍵都 saveData() 會把整包資料序列化一次，太浪費，所以節流。
   離開編輯時再 flush 一次，確保最後幾個字一定落地。 */
let noteSaveTimer = null;

function scheduleNoteSave() {
  if (noteSaveTimer) clearTimeout(noteSaveTimer);
  noteSaveTimer = setTimeout(function() {
    noteSaveTimer = null;
    saveData();
  }, 600);
}

function flushNoteSave() {
  if (noteSaveTimer) { clearTimeout(noteSaveTimer); noteSaveTimer = null; }
  saveData();
}

/* 按到便條紙以外的地方就結束編輯。

   平常瀏覽器會自己處理（點別處就失焦），但白板的平移處理器在 mousedown
   時 preventDefault，把預設的焦點轉移擋掉了，所以這裡必須自己收尾，
   否則便條紙會一直停在編輯狀態、連帶拖不動。 */
function finishEditingNotes(except) {
  const editing = document.querySelector(".canvas-note.is-editing");
  if (!editing) return;
  if (except && editing.contains(except)) return;
  const body = editing.querySelector(".canvas-note-body");
  if (body) body.blur();
}

function renderCanvasNotes() {
  const svg = document.getElementById("canvasSvg");
  if (!svg) return;
  const canvas = getCurrentWorldCanvas();
  const layer = getCanvasNotesLayer(svg);
  layer.innerHTML = "";

  canvas.notes.forEach(function(note) {
    const fo = document.createElementNS(SVG_NS, "foreignObject");
    fo.setAttribute("x", note.x);
    fo.setAttribute("y", note.y);
    fo.setAttribute("width", note.w);
    fo.setAttribute("height", note.h);

    const el = document.createElementNS(XHTML_NS, "div");
    el.className = "canvas-note";
    el.id = note.id;

    const body = document.createElementNS(XHTML_NS, "div");
    body.className = "canvas-note-body";
    body.setAttribute("contenteditable", "false");
    // 用 textContent 而不是 innerHTML：便條紙內容是純文字，
    // 不該讓貼進來的東西變成可執行的標記
    body.textContent = note.text || "";
    body.setAttribute("data-placeholder", "寫點什麼…");

    const handle = document.createElementNS(XHTML_NS, "div");
    handle.className = "canvas-note-resize";
    handle.setAttribute("title", "拖曳調整大小");

    /* 底下那一列同時放小鎖與調整大小的把手。包一層橫排是為了讓小鎖
       不用定位就能靠左、把手靠右——理由見 applyCanvasLockBadge 的註解。 */
    const footer = document.createElementNS(XHTML_NS, "div");
    footer.className = "canvas-note-foot";

    el.appendChild(body);
    footer.appendChild(handle);
    el.appendChild(footer);
    applyCanvasLockBadge(el, note, footer, true);
    fo.appendChild(el);
    layer.appendChild(fo);

    // 邊打邊存，不要只靠 blur。白板空白處的平移處理器在 mousedown 時會
    // preventDefault，那會擋掉瀏覽器預設的焦點轉移，contenteditable 因此
    // 可能一直不 blur——只靠 blur 存檔的話，打完字點一下白板就會整段不見。
    body.addEventListener("input", function() {
      note.text = body.innerText.replace(/\u00a0/g, " ");
      touchCanvasObject(note);
      scheduleNoteSave();
    });

    body.addEventListener("blur", function() {
      body.setAttribute("contenteditable", "false");
      el.classList.remove("is-editing");
      const next = body.innerText.replace(/\u00a0/g, " ");
      if (next !== note.text) { note.text = next; touchCanvasObject(note); }
      flushNoteSave();
    });

    body.addEventListener("keydown", function(e) {
      // 編輯中不要讓按鍵傳到白板的快捷鍵（例如 Delete 會刪節點）
      e.stopPropagation();
      if (e.key === "Escape") { e.preventDefault(); body.blur(); }
    });

    el.addEventListener("dblclick", function(e) {
      e.stopPropagation();
      startEditCanvasNote(note.id);
    });

    enableNoteDrag(el, note, fo);
    enableNoteResize(handle, el, note, fo);

    attachContextMenu(
      el,
      function() { return buildCanvasNoteMenuItems(note); },
      function() { return "🗒️ 便條紙"; }
    );
  });
}

function buildCanvasNoteMenuItems(note) {
  return [
    { icon: "✏️", label: "編輯文字", action: function() { startEditCanvasNote(note.id); } },
    { icon: canvasItemLocked(note) ? "🔓" : "🔒",
      label: canvasItemLocked(note) ? "解除位置鎖定" : "鎖住位置",
      action: function() { toggleCanvasItemLock(note, "這張便條紙"); } },
    { type: "divider" },
    { icon: "🗑️", label: "刪除便條紙", danger: true, action: function() {
        deleteCanvasNote(note.id);
    }}
  ];
}

/* 拖曳搬移。編輯中或抓在調整大小的角落時不啟動，
   否則想選字或想拉大小的時候便條紙會整張跑掉。 */
function enableNoteDrag(el, note, fo) {
  let startX = 0, startY = 0, initX = 0, initY = 0, dragging = false;

  function begin(clientX, clientY) {
    if (canvasItemLocked(note)) return;
    dragging = true;
    startX = clientX; startY = clientY;
    initX = note.x; initY = note.y;
  }
  function move(clientX, clientY) {
    if (!dragging) return;
    note.x = initX + (clientX - startX) / canvasTransform.scale;
    note.y = initY + (clientY - startY) / canvasTransform.scale;
    fo.setAttribute("x", note.x);
    fo.setAttribute("y", note.y);
  }
  function end() {
    if (!dragging) return;
    dragging = false;
    if (note.x !== initX || note.y !== initY) touchCanvasObject(note);
    saveData();
  }
  /* 取消：座標倒回去，而且不存檔。長按叫出選單時用——理由見
     cancelCanvasDragForMenu()。 */
  function cancel() {
    if (!dragging) return;
    dragging = false;
    note.x = initX;
    note.y = initY;
    fo.setAttribute("x", note.x);
    fo.setAttribute("y", note.y);
  }
  function blocked(e) {
    return el.classList.contains("is-editing") ||
           (e.target.closest && e.target.closest(".canvas-note-resize"));
  }

  el.addEventListener("mousedown", function(e) {
    if (e.button !== 0 || blocked(e)) return;
    e.stopPropagation();
    e.preventDefault();
    begin(e.clientX, e.clientY);
    function onMove(m) {
      // 理由見 enableDualDrag 前面那段
      if (m.buttons === 0) { detach(); end(); return; }
      move(m.clientX, m.clientY);
    }
    function detach() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp, true);
      clearActiveCanvasDrag(handle);
    }
    function onUp() { detach(); end(); }
    const handle = { cancel: function() { detach(); cancel(); } };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp, true);
    setActiveCanvasDrag(handle);
  });

  el.addEventListener("touchstart", function(e) {
    if (e.touches.length !== 1 || blocked(e)) return;
    e.stopPropagation();
    const touchId = e.touches[0].identifier;
    begin(e.touches[0].clientX, e.touches[0].clientY);
    function onMove(m) {
      if (m.touches.length !== 1) return;
      // 理由見 enableDualDrag 前面那段
      if (m.touches[0].identifier !== touchId) { detach(); end(); return; }
      m.preventDefault();
      move(m.touches[0].clientX, m.touches[0].clientY);
    }
    function detach() {
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd, true);
      window.removeEventListener("touchcancel", onEnd, true);
      clearActiveCanvasDrag(handle);
    }
    function onEnd() { detach(); end(); }
    const handle = { cancel: function() { detach(); cancel(); } };
    window.addEventListener("touchmove", onMove, { passive: false });
    // 捕獲階段：理由跟節點那邊一樣，見 enableDualDrag 裡的註解
    window.addEventListener("touchend", onEnd, true);
    window.addEventListener("touchcancel", onEnd, true);
    setActiveCanvasDrag(handle);
  }, { passive: true });
}

/* 右下角拖曳調整大小。位移要除以縮放倍率，否則放大時手拉一格會變很多格。 */
function enableNoteResize(handle, el, note, fo) {
  let startX = 0, startY = 0, initW = 0, initH = 0, resizing = false;

  function begin(clientX, clientY) {
    resizing = true;
    startX = clientX; startY = clientY;
    initW = note.w; initH = note.h;
  }
  function move(clientX, clientY) {
    if (!resizing) return;
    note.w = Math.max(NOTE_MIN_W, initW + (clientX - startX) / canvasTransform.scale);
    note.h = Math.max(NOTE_MIN_H, initH + (clientY - startY) / canvasTransform.scale);
    fo.setAttribute("width", note.w);
    fo.setAttribute("height", note.h);
  }
  function end() {
    if (!resizing) return;
    resizing = false;
    if (note.w !== initW || note.h !== initH) touchCanvasObject(note);
    saveData();
  }

  handle.addEventListener("mousedown", function(e) {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    begin(e.clientX, e.clientY);
    function onMove(m) { move(m.clientX, m.clientY); }
    function onUp() {
      end();
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  });

  handle.addEventListener("touchstart", function(e) {
    if (e.touches.length !== 1) return;
    e.stopPropagation();
    begin(e.touches[0].clientX, e.touches[0].clientY);
    function onMove(m) {
      if (m.touches.length !== 1) return;
      m.preventDefault();
      move(m.touches[0].clientX, m.touches[0].clientY);
    }
    function onEnd() {
      end();
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
    }
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onEnd);
    window.addEventListener("touchcancel", onEnd);
  }, { passive: true });
}

/* 長按白板空白處新增便條紙。

   跟「拖空白處平移」共存的方式是靠位移容忍值：手一移動就取消計時，
   所以想平移的人不會莫名其妙長出便條紙。兩根手指（縮放）也直接取消。 */
function setupBlankLongPress(view) {
  let timer = null, sx = 0, sy = 0;
  // 容忍值給手指用，不是給滑鼠用。真手指按住 500ms 很容易飄十幾 px，
  // 原本設 8px 在手機上幾乎按不出來。滑鼠本來就不太會晃，放寬不影響。
  const DURATION = 500, TOL = 16;

  function isBlank(target) {
    if (!target || !target.closest) return false;
    if (target.closest(".canvas-node")) return false;
    if (target.closest(".canvas-note")) return false;
    if (target.closest(".canvas-floating-actions")) return false;
    if (target.closest(".canvas-hint-floating")) return false;
    if (target.closest(".canvas-zoom-indicator")) return false;
    // SVG 裡的連線、節點等等都不算空白
    if (target.closest("svg") && target.tagName !== "svg") return false;
    return true;
  }

  function cancel() {
    if (timer) { clearTimeout(timer); timer = null; }
  }

  function start(clientX, clientY, target) {
    cancel();
    if (!isBlank(target)) return;
    sx = clientX; sy = clientY;
    timer = setTimeout(function() {
      timer = null;
      const rect = view.getBoundingClientRect();
      const world = screenToWorld(sx - rect.left, sy - rect.top);
      if (navigator.vibrate) { try { navigator.vibrate(12); } catch (err) {} }
      createCanvasNote(world.x, world.y);
    }, DURATION);
  }

  function moved(clientX, clientY) {
    if (!timer) return;
    if (Math.abs(clientX - sx) > TOL || Math.abs(clientY - sy) > TOL) cancel();
  }

  view.addEventListener("mousedown", function(e) {
    finishEditingNotes(e.target);
    if (e.button !== 0) return;
    start(e.clientX, e.clientY, e.target);
  });
  window.addEventListener("mousemove", function(e) { moved(e.clientX, e.clientY); });
  window.addEventListener("mouseup", cancel);

  view.addEventListener("touchstart", function(e) {
    finishEditingNotes(e.target);
    if (e.touches.length !== 1) { cancel(); return; }
    start(e.touches[0].clientX, e.touches[0].clientY, e.target);
  }, { passive: true });

  /* 「取消」這一半要掛在 window 的捕獲階段，不能掛在 view 上。

     使用者回報：手機上在白板從左緣往右滑打開目錄，會長出一張便利貼。
     左緣右滑（setupEdgeSwipe）接手之後會 stopPropagation()，免得白板跟著
     平移——它是掛在 document 的捕獲階段，所以接下來的 touchmove 與
     touchend 全都到不了 view。這裡收不到「手指移動了」也收不到「手指放開
     了」，計時器沒人取消，500ms 一到就在起手的位置長出便利貼。

     window 的捕獲階段排在 document 之前，誰 stopPropagation 都擋不到這裡。
     這一段只看位移、只會取消，不會攔任何東西，所以排在最前面沒有副作用。

     開始（touchstart）留在 view 上是對的：它本來就只該管在白板上起手的
     手勢，而且起手的那一下沒有人會攔。 */
  window.addEventListener("touchmove", function(e) {
    if (!timer) return;
    if (e.touches.length !== 1) { cancel(); return; }
    moved(e.touches[0].clientX, e.touches[0].clientY);
  }, { capture: true, passive: true });
  window.addEventListener("touchend", cancel, true);
  window.addEventListener("touchcancel", cancel, true);
}

/* ---------- 定位到某個節點 ----------
   在白板檢視下從目錄點文檔時用的：把畫面平移到該節點置中，並短暫highlight。
   縮放倍率不動——使用者自己調過的倍率不該被我們蓋掉。
   回傳 false 代表這篇文檔還沒被投射到白板上，呼叫端要自己決定怎麼辦。 */

function focusCanvasNode(docId) {
  const canvas = getCurrentWorldCanvas();
  const node = canvas.nodes.find(function(n) { return n.docId === docId; });
  if (!node) return false;

  const view = document.getElementById("canvasView");
  if (!view) return false;
  const rect = view.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return false;

  const nr = getNodeRect(node);
  const cx = nr.left + nr.w / 2;
  const cy = nr.top + nr.h / 2;

  // worldToScreen 是 wx * scale + tx，要讓節點中心落在容器正中間
  canvasTransform.x = rect.width / 2 - cx * canvasTransform.scale;
  canvasTransform.y = rect.height / 2 - cy * canvasTransform.scale;

  applySvgViewBox();
  renderCanvasLines();
  highlightCanvasNode(node.id);
  return true;
}

let canvasHighlightTimer = null;

function highlightCanvasNode(nodeId) {
  const prev = document.querySelector(".canvas-node.is-focused");
  if (prev) prev.classList.remove("is-focused");
  if (canvasHighlightTimer) clearTimeout(canvasHighlightTimer);

  const el = document.getElementById(nodeId);
  if (!el) return;
  el.classList.add("is-focused");
  canvasHighlightTimer = setTimeout(function() {
    el.classList.remove("is-focused");
    canvasHighlightTimer = null;
  }, 1600);
}

/* ==========================================================
   鎖住位置（每個節點、每張便利貼各自鎖）

   排好的白板很容易在捲動、縮放、或單純想點開一篇文檔的時候被手指帶著
   移動一點點——而且移動了不會有提示，等發現時已經不知道原本在哪。

   鎖是掛在「那一個物件」上（node.locked / note.locked），不是整塊白板：
   實際在用的時候多半是「這幾個定位好了不要再動，其他的還在排」。
   從長按（或右鍵）的選單開關，鎖住的物件上會出現一個小鎖。

   只鎖「位置」：點開文檔、拉連線、改底色、編輯便利貼的文字、調整便利貼
   的大小都照常——那些不會讓東西跑掉，事後也看得出來改了什麼。
   ========================================================== */

function canvasItemLocked(item) {
  return !!(item && item.locked);
}

/* 節點與便利貼共用同一套切換，差別只在存檔後要重畫哪一塊。 */
function toggleCanvasItemLock(item, label) {
  if (!item) return;
  item.locked = !item.locked;
  touchCanvasObject(item);
  saveData();
  renderCanvas();
  showDocToolHint(item.locked
    ? label + "已鎖住位置（長按可以解鎖）"
    : label + "已解鎖，可以拖動了");
}

/* 鎖住的物件要看得出來，不然使用者只會覺得「這個怎麼拖不動」。

   小鎖刻意排在「正常流」裡，不用 position:absolute 疊上去——節點與
   便條紙都住在 SVG 的 foreignObject 裡，而 WebKit 會把 foreignObject
   裡「有定位」的內容畫在沒有縮放的螢幕座標上（之前 iPad 上便條紙不管
   怎麼縮放都黏在螢幕同一個位置，就是這個原因）。所以這裡只把它當成
   一般的行內元素塞進既有的那一列。

   兩種都放在左下角，位置一致：節點是字數那一列的左邊，便條紙是調整
   大小把手那一列的左邊——兩列本來就存在，所以不會多佔一行高度。 */
function applyCanvasLockBadge(el, item, slot, prepend) {
  const old = el.querySelector(".canvas-lock-badge");
  if (old) old.remove();
  el.classList.toggle("is-locked", canvasItemLocked(item));
  if (!canvasItemLocked(item)) return;

  const badge = document.createElementNS(XHTML_NS, "span");
  badge.className = "canvas-lock-badge";
  badge.textContent = "🔒";
  badge.setAttribute("title", "位置已鎖住（長按可以解鎖）");

  const target = slot || el;
  // 插在最前面才會在左邊；那一列的另一個東西用 margin-left:auto 靠右
  if (prepend && target.firstChild) target.insertBefore(badge, target.firstChild);
  else target.appendChild(badge);
}

/* ---------- 節點拖曳 ---------- */

/* 目前正在進行的那一次拖曳。只會有一個——白板上同時只有一隻手指
   在搬東西。 */
let activeCanvasDrag = null;

function setActiveCanvasDrag(handle) { activeCanvasDrag = handle; }
function clearActiveCanvasDrag(handle) {
  if (activeCanvasDrag === handle) activeCanvasDrag = null;
}

/* 長按（或右鍵）叫出選單的那一刻，把正在進行的拖曳整個收掉，
   並且把位置還原成按下去之前的樣子。

   兩件實際回報的災情都是少了這一步：

   1. 「點旁邊關掉選單的時候，節點會移動到點的位置。」
      長按叫出選單之後手指還按在節點上，放開時 attachContextMenu 會
      stopPropagation()（它要擋掉長按後那個假的 click），於是負責結束
      拖曳的監聽器收不到 touchend——拖曳就一直掛在那裡。下一次碰畫面，
      那一連串 touchmove 還是會被算成同一次拖曳，而位移是從最初按下的
      位置起算的，所以節點會一口氣跳到新的手指位置。
      （iPad 上才看得到：Chromium 自己的長按會補一個 touchcancel 把拖曳
      收掉，iOS 因為我們關掉了 callout，那個 touchcancel 不會來。）

   2. 長按的容忍範圍放寬到手指抖得動之後，那十幾像素已經把節點拖走了。
      還原位置才能「叫得出選單」與「節點不要跑掉」兩者兼得。 */
function cancelCanvasDragForMenu() {
  const handle = activeCanvasDrag;
  activeCanvasDrag = null;
  if (handle) handle.cancel();
}

/* 一次拖曳只屬於「開始它的那一根手指／那一次按住」。

   為什麼需要這道防線：選單跳出來時我們已經會主動取消拖曳，收尾也改走捕獲
   階段了，但 iPad 上「長按叫出選單 → 點旁邊關掉 → 節點跳到點的位置」還是
   復發。那代表拖曳是在取消之後才又活過來的——iOS 在觸控結束後會補一串
   合成的 mouse 事件，而且長按這種被系統特別對待的手勢，補出來的序列不保證
   完整（可能有 mousedown 沒有 mouseup）。

   與其一條一條去堵那些路徑，不如從根本上問：「現在這個移動事件，跟當初
   開始拖曳的那一次，是同一次互動嗎？」不是的話就收掉。

   觸控看 identifier：每一根手指有自己的編號，新的一次點擊必定是不同的編號。
   滑鼠看 buttons：沒有按著任何鍵卻在移動，那就不可能是拖曳。

   這兩個判斷都不依賴「是誰讓拖曳殘留下來的」，所以不管之後又冒出哪一條
   沒想到的路徑，節點都不會再跟著亂跑。

   發現不對的時候是收掉（end）不是倒回去（cancel）：在那之前的移動是使用者
   真的拖出來的，要留著存檔。倒回去只用在「選單跳出來」那一種情形——那裡
   要抹掉的是長按時手指的抖動，不是一次真的拖曳。 */
function enableDualDrag(element, nodeData) {
  let startX, startY, initialLeft, initialTop, dragging = false;
  let pointerMoved = false;

  function beginDrag(clientX, clientY) {
    // 鎖住時完全不進入拖曳狀態——只是不更新座標的話，放開手仍然會存檔
    if (canvasItemLocked(nodeData)) return;
    dragging = true;
    pointerMoved = false;
    startX = clientX; startY = clientY;
    initialLeft = nodeData.x; initialTop = nodeData.y;
  }
  function moveDrag(clientX, clientY) {
    /* 沒有進入拖曳狀態就什麼都不做。

       少了這一行，鎖住位置時會出事：beginDrag 被擋掉、startX / initialLeft
       都還是 undefined，但 mousemove 照樣呼叫這裡，算出來的座標是 NaN，
       節點的 x/y 直接被寫成 NaN——比不鎖還糟。
       （便利貼那邊的 move() 本來就有這個檢查，所以沒事。） */
    if (!dragging) return;
    const dx = clientX - startX;
    const dy = clientY - startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) pointerMoved = true;
    nodeData.x = initialLeft + dx / canvasTransform.scale;
    nodeData.y = initialTop + dy / canvasTransform.scale;
    const fo = element.parentNode;
    if (fo && fo.setAttribute) {
      fo.setAttribute("x", nodeData.x);
      fo.setAttribute("y", nodeData.y);
    }
    renderCanvasLines();
  }
  function endDrag() {
    if (!dragging) return;
    dragging = false;
    if (nodeData.x !== initialLeft || nodeData.y !== initialTop) touchCanvasObject(nodeData);
    saveData();
  }
  /* 取消：跟 endDrag 不同，這裡把座標倒回去，而且不存檔。 */
  function cancelDrag() {
    if (!dragging) return;
    dragging = false;
    nodeData.x = initialLeft;
    nodeData.y = initialTop;
    const fo = element.parentNode;
    if (fo && fo.setAttribute) {
      fo.setAttribute("x", nodeData.x);
      fo.setAttribute("y", nodeData.y);
    }
    renderCanvasLines();
  }

  element.addEventListener("mousedown", function(e) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    beginDrag(e.clientX, e.clientY);

    function onMouseMove(m) {
      // 沒有按著任何鍵卻在移動 → 這不是拖曳，是殘留下來的監聽器
      if (m.buttons === 0) { detach(); endDrag(); return; }
      moveDrag(m.clientX, m.clientY);
    }
    function detach() {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp, true);
      clearActiveCanvasDrag(handle);
    }
    function onMouseUp() { detach(); endDrag(); }
    const handle = { cancel: function() { detach(); cancelDrag(); } };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp, true);
    setActiveCanvasDrag(handle);
  });

  element.addEventListener("touchstart", function(e) {
    if (e.touches.length !== 1) return;
    e.stopPropagation();
    const touch = e.touches[0];
    const touchId = touch.identifier;
    beginDrag(touch.clientX, touch.clientY);

    function onTouchMove(t) {
      if (t.touches.length !== 1) return;
      // 換了一根手指 → 這是新的一次互動，不是同一次拖曳
      if (t.touches[0].identifier !== touchId) { detach(); endDrag(); return; }
      t.preventDefault();
      moveDrag(t.touches[0].clientX, t.touches[0].clientY);
    }
    function detach() {
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd, true);
      window.removeEventListener("touchcancel", onTouchEnd, true);
      clearActiveCanvasDrag(handle);
    }
    function onTouchEnd() { detach(); endDrag(); }
    const handle = { cancel: function() { detach(); cancelDrag(); } };

    window.addEventListener("touchmove", onTouchMove, { passive: false });
    /* 收尾的兩個走「捕獲」階段，不能走冒泡。

       長按叫出選單之後，attachContextMenu 的 touchend 會 stopPropagation()
       ——它要擋掉長按後那個假的 click。冒泡階段掛在 window 上的監聽器排在
       它後面，於是永遠收不到 touchend，拖曳就一直掛著沒有結束。捕獲階段在
       目標元素之前，擋不掉。 */
    window.addEventListener("touchend", onTouchEnd, true);
    window.addEventListener("touchcancel", onTouchEnd, true);
    setActiveCanvasDrag(handle);
  }, { passive: true });

  element.addEventListener("click", function(e) {
    if (pointerMoved) return;
    if (!connectingSourceNodeId) return;
    e.stopPropagation();
    completeConnection(nodeData.id);
  });
}

/* ---------- 連線 ---------- */

function startConnect(nodeId) {
  if (connectingSourceNodeId === nodeId) { cancelConnect(); return; }
  connectingSourceNodeId = nodeId;
  document.querySelectorAll(".canvas-node").forEach(function(el) {
    el.classList.toggle("connecting", el.id === nodeId);
  });
}

function cancelConnect() {
  connectingSourceNodeId = null;
  document.querySelectorAll(".canvas-node.connecting").forEach(function(el) {
    el.classList.remove("connecting");
  });
}

function completeConnection(targetNodeId) {
  const sourceId = connectingSourceNodeId;
  if (!sourceId || sourceId === targetNodeId) { cancelConnect(); return; }

  /* 連線模式在打開彈窗的當下就收掉，不等彈窗關閉。

     彈窗是非同步的：按「取消」、按 Escape、點遮罩都會關掉它，但只有「建立」
     會回到這裡。等回來才收的話，從另外三條路關掉時連線模式會一直掛著——
     下一次點節點會莫名其妙地拉出一條線。 */
  cancelConnect();

  // 標籤寫出是哪兩個，彈窗蓋住白板之後才知道自己在連什麼
  const nameOf = function(nodeId) {
    const n = getCurrentWorldCanvas().nodes.find(function(x) { return x.id === nodeId; });
    const d = n && appData.docs.find(function(x) { return x.id === n.docId; });
    return d ? (d.title || "無標題文檔") : "？";
  };

  openTextInputModal({
    title: "🔗 兩者關係",
    fields: [{ label: nameOf(sourceId) + " ↔ " + nameOf(targetNodeId),
               value: "盟友 / 敵對 / 密探", placeholder: "留白就寫「關聯」" }],
    okText: "連線",
    onSubmit: function(values) {
      addCanvasEdge(sourceId, targetNodeId, values[0]);
    }
  });
}

/* 真的加一條線。留白就是「關聯」（原本 prompt() 版本就是這樣）。 */
function addCanvasEdge(sourceId, targetNodeId, relation) {
  const canvas = getCurrentWorldCanvas();
  const edge = {
    id: "edge_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
    source: sourceId,
    target: targetNodeId,
    label: String(relation || "").trim() || "關聯",
    color: "e_gray",
    dash: "solid",
    arrow: "none"
  };
  stampCanvasCreated(edge);
  canvas.edges.push(edge);
  saveData();
  renderCanvasLines();
  return edge;
}

/* ---------- 顏色 ---------- */

function getEdgeColor(edge) {
  return { stroke: getEdgeStroke(edge.color || "e_gray") };
}

/* ---------- 節點矩形（含 DOM 量測）---------- */
function getNodeRect(node) {
  const el = document.getElementById(node.id);
  const w = el ? (el.offsetWidth || CANVAS_NODE_W) : CANVAS_NODE_W;
  const h = el ? (el.offsetHeight || 80) : 80;
  return { left: node.x, top: node.y, right: node.x + w, bottom: node.y + h, w: w, h: h };
}

/* ---------- 連線幾何：中心到中心畫曲線，再裁掉節點內部那一段 ----------
   關鍵在於「出發點」不是另外挑的，而是曲線跟節點邊框的交點。
   舊作法是先挑一條邊框、在上面排出發點，再另外決定往哪邊彎；出發點是沿
   邊框排開的、彎曲卻是沿兩節點中心連線的法線，斜向時這兩個方向不一致，
   排列順序一旦相反，線就一定會在中段互相穿越——彎曲與出發點永遠在打架。
   改成先畫完整的中心到中心曲線再裁掉兩端，出發點就由曲線自己決定：
   彎得越多的線，交點自然落在越外側（甚至自動從長邊換到短邊），
   順序必定跟彎曲一致，結構上不可能交叉，而且每條線都嚴格對稱於中心連線。
------------------------------------------------------------------ */
function clampNum(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function nodeCenter(rect) {
  return { x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2 };
}

// 節點矩形外擴一點點，讓線頭（箭頭）不會貼死在邊框上
const NODE_EDGE_PAD = 2;
function pointInRect(p, rect) {
  return p.x >= rect.left - NODE_EDGE_PAD && p.x <= rect.right + NODE_EDGE_PAD &&
         p.y >= rect.top - NODE_EDGE_PAD && p.y <= rect.bottom + NODE_EDGE_PAD;
}

function lerpPoint(a, b, t) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function cubicPointAt(c, t) {
  const mt = 1 - t;
  return {
    x: mt*mt*mt*c[0].x + 3*mt*mt*t*c[1].x + 3*mt*t*t*c[2].x + t*t*t*c[3].x,
    y: mt*mt*mt*c[0].y + 3*mt*mt*t*c[1].y + 3*mt*t*t*c[2].y + t*t*t*c[3].y
  };
}

// De Casteljau：把三次貝茲曲線在 t 處切開，回傳左右兩段的控制點
function splitCubic(c, t) {
  const a = lerpPoint(c[0], c[1], t);
  const b = lerpPoint(c[1], c[2], t);
  const d = lerpPoint(c[2], c[3], t);
  const e = lerpPoint(a, b, t);
  const f = lerpPoint(b, d, t);
  const g = lerpPoint(e, f, t);
  return { left: [c[0], a, e, g], right: [g, f, d, c[3]] };
}

// 取出 [t0, t1] 這一段子曲線的控制點
function subCubic(c, t0, t1) {
  if (t0 > 0) c = splitCubic(c, t0).right;
  if (t1 < 1) {
    const s = t0 < 1 ? (t1 - t0) / (1 - t0) : 0;
    c = splitCubic(c, clampNum(s, 0, 1)).left;
  }
  return c;
}

// 找曲線離開 rect 的那個 t（from = 0 從頭找、from = 1 從尾找），二分逼近
function findExitT(c, rect, fromStart) {
  const STEPS = 48;
  let inside = fromStart ? 0 : 1;
  let outside = null;
  for (let i = 1; i <= STEPS; i++) {
    const t = fromStart ? i / STEPS : 1 - i / STEPS;
    if (!pointInRect(cubicPointAt(c, t), rect)) { outside = t; break; }
    inside = t;
  }
  if (outside === null) return fromStart ? 0 : 1; // 整條都在框內（節點重疊等狀況）
  for (let i = 0; i < 14; i++) {
    const mid = (inside + outside) / 2;
    if (pointInRect(cubicPointAt(c, mid), rect)) inside = mid;
    else outside = mid;
  }
  return outside;
}

/* 每條線離開節點中心的方向，相對中心連線最多轉這個角度（約 32 度）。
   用「出發角度」而不是「中段彎曲量」當控制參數是關鍵：彎曲量必須有上限，
   否則長線會鼓得太誇張；可是一旦設了上限，節點拉遠時控制桿變長、出發方向
   就趨近平行，兩條線在邊框上的交點會擠成同一點。固定角度的話，交點間距
   只跟節點大小有關，不管節點離多遠都一樣分得開。 */
const MAX_DEPART_ANGLE = 0.56;
const MAX_HANDLE_LEN = 260;

/* 產生一條邊的曲線控制點：從 rectA 中心畫到 rectB 中心，兩端各往同一側轉開
   spread（-1..+1）對應的角度，再裁掉兩端節點內部那一段。
   兩端轉的角度一正一負、大小相同，所以曲線對稱於兩節點中心的連線。 */
function buildEdgeCurve(rectA, rectB, spread) {
  const cA = nodeCenter(rectA);
  const cB = nodeCenter(rectB);
  const dx = cB.x - cA.x, dy = cB.y - cA.y;
  const dist = Math.hypot(dx, dy);

  /* 兩個節點被拖到幾乎完全重疊時，中心連線沒有方向可言。原本靠
     `|| 1` 兜過去，結果下面的 t1 > t0 檢查會通過，回傳四個點全部重合的
     退化曲線——底下那行註解本來就打算回傳 null，只是遮住了沒生效。
     退化的路徑本身看不見，但箭頭標記會在那個點上畫出一個孤零零的箭頭。 */
  if (dist < 1) return null;
  const len = dist;
  const ux = dx / len, uy = dy / len;

  const theta = spread * MAX_DEPART_ANGLE;
  const cos = Math.cos(theta), sin = Math.sin(theta);
  const k = Math.min(len / 3, MAX_HANDLE_LEN);

  const full = [
    cA,
    // 起點：方向 = 中心連線轉 +theta
    { x: cA.x + (ux * cos - uy * sin) * k, y: cA.y + (ux * sin + uy * cos) * k },
    // 終點：方向 = 中心連線轉 -theta（反向延伸回來）
    { x: cB.x - (ux * cos + uy * sin) * k, y: cB.y - (uy * cos - ux * sin) * k },
    cB
  ];

  const t0 = findExitT(full, rectA, true);
  const t1 = findExitT(full, rectB, false);
  if (!(t1 > t0)) return null; // 兩節點重疊到沒有可畫的區段
  return subCubic(full, t0, t1);
}


/* ---------- 依側邊欄目錄樹的顯示順序，取得每個文件的排序索引 ----------
   用來決定「連結同一對節點的多條線」該往哪個方向撐開：這個方向不該
   取決於使用者剛好先畫了哪一條線（忽左忽右、不穩定），而是取一個
   跟連線方向、節點拖曳位置都無關的穩定依據——側邊欄目錄樹的顯示順序。
   邏輯跟 renderFolderLevel() 的遞迴順序保持一致（子資料夾优先於
   該資料夾自己的直屬文件，最後才是世界觀根層的未分類文件）。
------------------------------------------------------------- */
function computeDocTreeOrderIndex(worldId) {
  const order = {};
  let counter = 0;

  function walk(parentId) {
    const folders = appData.folders.filter(f => f.worldId === worldId && f.parentId === parentId);
    folders.forEach(function(folder) {
      walk(folder.id);
      const docsInFolder = appData.docs.filter(d => d.worldId === worldId && d.folderId === folder.id);
      docsInFolder.forEach(function(doc) { order[doc.id] = counter++; });
    });
  }
  walk(null);

  const rootDocs = appData.docs.filter(d => d.worldId === worldId && !d.folderId);
  rootDocs.forEach(function(doc) { order[doc.id] = counter++; });

  return order;
}

/* ---------- 渲染連線 ---------- */

function renderCanvasLines() {
  const svg = document.getElementById("canvasSvg");
  if (!svg) return;
  const canvas = getCurrentWorldCanvas();
  const NS = SVG_NS;

  // 連線只清空、重畫「連線圖層」，不動到 svg 裡的節點 foreignObject，
  // 否則拖曳節點時每次都會把整個白板重建一次。
  let edgesLayer = document.getElementById("canvasEdgesLayer");
  if (!edgesLayer) {
    edgesLayer = document.createElementNS(NS, "g");
    edgesLayer.setAttribute("id", "canvasEdgesLayer");
  } else {
    edgesLayer.innerHTML = "";
  }
  // 確保連線圖層一定排在節點圖層「之前」，節點才會畫在連線上方
  const nodesLayer = document.getElementById("canvasNodesLayer");
  svg.insertBefore(edgesLayer, nodesLayer || null);

  // 箭頭 marker
  const defs = document.createElementNS(NS, "defs");
  Object.keys(EDGE_COLORS).forEach(function(colorId) {
    const col = { stroke: getEdgeStroke(colorId) };
    const marker = document.createElementNS(NS, "marker");
    marker.setAttribute("id", "arrow_" + colorId);
    marker.setAttribute("viewBox", "0 0 10 10");
    marker.setAttribute("refX", "9");
    marker.setAttribute("refY", "5");
    marker.setAttribute("markerWidth", "6");
    marker.setAttribute("markerHeight", "6");
    marker.setAttribute("orient", "auto-start-reverse");
    const p = document.createElementNS(NS, "path");
    p.setAttribute("d", "M 0 0 L 10 5 L 0 10 z");
    p.setAttribute("fill", col.stroke);
    marker.appendChild(p);
    defs.appendChild(marker);
  });
  edgesLayer.appendChild(defs);

  const linesLayer = document.createElementNS(NS, "g");
  edgesLayer.appendChild(linesLayer);

  const labelsLayer = document.createElementNS(NS, "g");
  edgesLayer.appendChild(labelsLayer);

  /* ---------- 同一對節點多條邊的偏移值：以兩節點中心連線為對稱軸左右分開 ----------
     offset 落在 -1..+1，正負各往對稱軸的一側彎、幅度相同，所以同一對
     節點的多條線會沿著兩節點中心連線對稱展開成扇形。
     出發點不需要另外分配——曲線彎多少，跟節點邊框的交點就落在哪裡，
     順序必定跟彎曲一致（見 buildEdgeCurve）。
     這個值同時也決定標籤沿曲線長度的錯開量（見下方 tt 的計算）。
  ------------------------------------------------------------- */
  const pairGroups = {};
  canvas.edges.forEach(function(edge) {
    const key = [edge.source, edge.target].sort().join("|");
    if (!pairGroups[key]) pairGroups[key] = [];
    pairGroups[key].push(edge);
  });

  const edgeOffsetMap = {};
  Object.keys(pairGroups).forEach(function(key) {
    const group = pairGroups[key];
    const total = group.length;
    group.forEach(function(edge, idx) {
      let offset;
      if (total === 1) offset = 0;
      else offset = (idx - (total - 1) / 2) / ((total - 1) / 2); // -1 .. 1
      edgeOffsetMap[edge.id] = offset;
    });
  });

  /* ---------- 每一對節點的基準方向：由「目錄樹上方者」指向「下方者」----------
     曲線要算得穩定、可預期，就不能取決於使用者剛好先畫了哪一條線、或線段
     實際儲存的 source/target 是誰。這裡固定用側邊欄目錄樹的顯示順序決定：
     目錄樹排序較前面的那個節點當起點，較後面的當終點。同一對節點的所有邊
     都以這個方向算曲線與標籤位置，最後才依各自的方向反轉控制點畫箭頭。
  ------------------------------------------------------------- */
  const docTreeOrderIndex = computeDocTreeOrderIndex(activeWorldId);
  function nodeTreeOrder(node) {
    const idx = docTreeOrderIndex[node.docId];
    return (idx === undefined) ? Infinity : idx;
  }

  const pairUpperNodeIdMap = {}; // 每一對節點裡，目錄樹順序較前面的那個節點 id
  Object.keys(pairGroups).forEach(function(key) {
    const ids = key.split("|");
    const nodeX = canvas.nodes.find(n => n.id === ids[0]);
    const nodeY = canvas.nodes.find(n => n.id === ids[1]);
    if (!nodeX || !nodeY) return;
    pairUpperNodeIdMap[key] = nodeTreeOrder(nodeX) <= nodeTreeOrder(nodeY) ? nodeX.id : nodeY.id;
  });

  /* ---------- 畫 ---------- */
  const labelJobs = []; // 先收集所有標籤候選位置，畫完全部連線後再統一防重疊
  canvas.edges.forEach(function(edge) {
    const srcNode = canvas.nodes.find(n => n.id === edge.source);
    const tgtNode = canvas.nodes.find(n => n.id === edge.target);
    if (!srcNode || !tgtNode) return;

    // 一律以「目錄樹上方者 → 下方者」為基準方向算曲線，跟這條邊實際存的
    // source/target 是誰無關；A→B 與 B→A 因此共用同一條對稱基準，
    // 只在最後依需要反轉控制點，讓箭頭指向正確的一端。
    const pairKey = [edge.source, edge.target].sort().join("|");
    const canonicalUpperId = pairUpperNodeIdMap[pairKey];
    const matchesCanonicalDir = !canonicalUpperId || edge.source === canonicalUpperId;

    const srcRect = getNodeRect(srcNode);
    const tgtRect = getNodeRect(tgtNode);
    const rectFrom = matchesCanonicalDir ? srcRect : tgtRect;
    const rectTo = matchesCanonicalDir ? tgtRect : srcRect;

    /* ----- 弧度 -----
       同一對節點只有一條線時 offset = 0，就是中心到中心的直線。
       多條線時 offset 落在 -1..+1，決定這條線離開中心的角度往哪一側轉、
       轉多少，兩側角度相同所以對稱展開成扇形。出發點是曲線跟邊框的交點，
       轉得越開交點越外側，出發順序必定跟彎曲順序一致，不會互相穿越。 */
    const offset = edgeOffsetMap[edge.id] || 0;

    let curve = buildEdgeCurve(rectFrom, rectTo, offset);
    if (!curve) return;

    // 標籤落點取在「基準方向」的曲線上，跟這條邊存的方向無關，
    // 所以一來一回的兩條邊會落在不同位置，不會因為各自從自己的 source
    // 起算 t 而互相抵銷、疊在同一個高度。
    const labelPoint = cubicPointAt(curve, 0.5 + offset * 0.15);

    if (!matchesCanonicalDir) curve = [curve[3], curve[2], curve[1], curve[0]];

    const d = "M " + curve[0].x + " " + curve[0].y +
              " C " + curve[1].x + " " + curve[1].y +
              ", " + curve[2].x + " " + curve[2].y +
              ", " + curve[3].x + " " + curve[3].y;

    const col = getEdgeColor(edge);

    const path = document.createElementNS(NS, "path");
    path.setAttribute("d", d);
    path.setAttribute("class", "relation-line");
    path.style.stroke = col.stroke;
    path.style.strokeWidth = "2.5";
    path.style.fill = "none";
    path.style.pointerEvents = "none";

    const dash = edge.dash || "solid";
    if (dash === "dashed") path.setAttribute("stroke-dasharray", "10 6");
    else if (dash === "dotted") path.setAttribute("stroke-dasharray", "2 6");
    path.setAttribute("stroke-linecap", "round");

    const arrow = edge.arrow || "none";
    const markerUrl = "url(#arrow_" + (edge.color || "e_gray") + ")";
    if (arrow === "forward") {
      path.setAttribute("marker-end", markerUrl);
    } else if (arrow === "backward") {
      path.setAttribute("marker-start", markerUrl);
    } else if (arrow === "both") {
      path.setAttribute("marker-start", markerUrl);
      path.setAttribute("marker-end", markerUrl);
    }

    linesLayer.appendChild(path);

    // 標籤落點在上面已經算好（labelPoint），這裡只是登記，
    // 等所有線都畫完再統一做防重疊的推擠。
    labelJobs.push({
      edge: edge, col: col,
      x: labelPoint.x, y: labelPoint.y,
      cx: labelPoint.x, cy: labelPoint.y
    });
  });

  /* ----- 標籤防重疊：量測每個標籤實際尺寸，再用簡單的推擠鬆弛法互相讓開 -----
     單一條邊自己算出來的落點只跟「這條邊自己」有關，遇到同一個節點扇形發散
     出去的一大堆邊時，各自的中點常常仍然彼此靠得很近而互疊。這裡改成：
     所有標籤位置先收集起來，量出各自的寬高後，成對檢查是否重疊，
     重疊就把兩者沿重疊量較小的那個軸推開，反覆幾輪直到不再重疊為止。
     若某個標籤因此被推離原本落點太多，改畫一條細虛線指回原本的線段位置，
     讓使用者仍能看出這個標籤屬於哪一條連線。
  ------------------------------------------------------------- */
  labelJobs.forEach(function(job) {
    const text = document.createElementNS(NS, "text");
    text.setAttribute("x", job.x);
    text.setAttribute("y", job.y);
    text.setAttribute("font-size", "12");
    text.setAttribute("font-weight", "600");
    text.setAttribute("font-family", "var(--font-ui)");
    text.textContent = job.edge.label || "關聯";
    labelsLayer.appendChild(text);

    let bbox;
    try { bbox = text.getBBox(); } catch (err) { bbox = null; }
    labelsLayer.removeChild(text);

    if (!bbox || bbox.width === 0) {
      const w = Math.max((job.edge.label || '').length * 14, 30);
      bbox = { width: w, height: 16 };
    }

    const padX = 8, padY = 4;
    job.w = bbox.width + padX * 2;
    job.h = bbox.height + padY * 2;
  });

  const DECLUTTER_ITER = 60;
  for (let iter = 0; iter < DECLUTTER_ITER; iter++) {
    let moved = false;
    for (let i = 0; i < labelJobs.length; i++) {
      for (let j = i + 1; j < labelJobs.length; j++) {
        const a = labelJobs[i], b = labelJobs[j];
        const gap = 4;
        const overlapX = (a.w / 2 + b.w / 2 + gap) - Math.abs(a.cx - b.cx);
        const overlapY = (a.h / 2 + b.h / 2 + gap) - Math.abs(a.cy - b.cy);
        if (overlapX > 0 && overlapY > 0) {
          moved = true;
          if (overlapX < overlapY) {
            const dir = (a.cx <= b.cx) ? -1 : 1;
            const push = overlapX / 2 + 0.5;
            a.cx += dir * push;
            b.cx -= dir * push;
          } else {
            const dir = (a.cy <= b.cy) ? -1 : 1;
            const push = overlapY / 2 + 0.5;
            a.cy += dir * push;
            b.cy -= dir * push;
          }
        }
      }
    }
    if (!moved) break;
  }

  labelJobs.forEach(function(job) {
    const edge = job.edge;
    const col = job.col;

    const g = document.createElementNS(NS, "g");
    g.style.pointerEvents = "all";
    g.style.cursor = "pointer";

    const displaced = Math.hypot(job.cx - job.x, job.cy - job.y) > 10;
    if (displaced) {
      const leader = document.createElementNS(NS, "line");
      leader.setAttribute("x1", job.x);
      leader.setAttribute("y1", job.y);
      leader.setAttribute("x2", job.cx);
      leader.setAttribute("y2", job.cy);
      leader.setAttribute("stroke", col.stroke);
      leader.setAttribute("stroke-width", "1");
      leader.setAttribute("stroke-dasharray", "2 3");
      leader.setAttribute("opacity", "0.6");
      leader.style.pointerEvents = "none";
      g.appendChild(leader);
    }

    const text = document.createElementNS(NS, "text");
    text.setAttribute("x", job.cx);
    text.setAttribute("y", job.cy);
    text.setAttribute("class", "line-label-box");
    text.setAttribute("fill", "var(--text-primary)");
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("dominant-baseline", "central");
    text.setAttribute("font-size", "12");
    text.setAttribute("font-weight", "600");
    text.setAttribute("font-family", "var(--font-ui)");
    text.style.pointerEvents = "none";
    text.style.userSelect = "none";
    text.textContent = edge.label || "關聯";

    g.appendChild(text);
    labelsLayer.appendChild(g);

    let bbox;
    try { bbox = text.getBBox(); } catch (err) { bbox = null; }
    if (!bbox || bbox.width === 0) {
      const w = Math.max((edge.label || '').length * 14, 30);
      bbox = { x: job.cx - w / 2, y: job.cy - 8, width: w, height: 16 };
    }

    const padX = 8;
    const padY = 4;

    const bgRect = document.createElementNS(NS, "rect");
    bgRect.setAttribute("x", bbox.x - padX);
    bgRect.setAttribute("y", bbox.y - padY);
    bgRect.setAttribute("width", bbox.width + padX * 2);
    bgRect.setAttribute("height", bbox.height + padY * 2);
    bgRect.setAttribute("rx", 6);
    bgRect.setAttribute("ry", 6);
    bgRect.setAttribute("fill", "var(--bg-card)");
    bgRect.setAttribute("stroke", col.stroke);
    bgRect.setAttribute("stroke-width", "1.5");
    bgRect.style.pointerEvents = "all";

    g.insertBefore(bgRect, text);

    g.addEventListener("contextmenu", function(e) {
      e.preventDefault();
      e.stopPropagation();
      openEdgeEditModal(edge.id);
    });

    attachLongPressToSvgGroup(g, function() { openEdgeEditModal(edge.id); });
  });

  applySvgViewBox();
}
function attachLongPressToSvgGroup(gEl, callback) {
  let timer = null, fired = false, sx = 0, sy = 0;
  const DURATION = 280, TOL = 10;

  function start(e) {
    const p = (e.touches && e.touches[0]) || e;
    fired = false;
    sx = p.clientX; sy = p.clientY;
    clearTimeout(timer);
    timer = setTimeout(function() {
      fired = true;
      timer = null;
      if (navigator.vibrate) { try { navigator.vibrate(12); } catch (err) {} }
      callback();
    }, DURATION);
  }
  function move(e) {
    if (!timer) return;
    const p = (e.touches && e.touches[0]) || e;
    if (Math.abs(p.clientX - sx) > TOL || Math.abs(p.clientY - sy) > TOL) {
      clearTimeout(timer); timer = null;
    }
  }
  function cancel() {
    if (timer) { clearTimeout(timer); timer = null; }
  }
  function suppressClick(e) {
    if (fired) { e.preventDefault(); e.stopPropagation(); fired = false; }
  }

  gEl.addEventListener("touchstart", start, { passive: true });
  gEl.addEventListener("touchmove", move, { passive: true });
  gEl.addEventListener("touchend", cancel);
  gEl.addEventListener("touchcancel", cancel);
  gEl.addEventListener("click", suppressClick, true);
}

/* ---------- 關係編輯彈窗 ---------- */

function openEdgeEditModal(edgeId) {
  const canvas = getCurrentWorldCanvas();
  const edge = canvas.edges.find(e => e.id === edgeId);
  if (!edge) return;

  editingEdgeId = edgeId;

  const srcNode = canvas.nodes.find(n => n.id === edge.source);
  const tgtNode = canvas.nodes.find(n => n.id === edge.target);
  const srcDoc = srcNode ? appData.docs.find(d => d.id === srcNode.docId) : null;
  const tgtDoc = tgtNode ? appData.docs.find(d => d.id === tgtNode.docId) : null;

  document.getElementById("edgeEditFromName").textContent =
    srcDoc ? ((srcDoc.icon || '📄') + ' ' + (srcDoc.title || '無標題')) : '（未知）';
  document.getElementById("edgeEditToName").textContent =
    tgtDoc ? ((tgtDoc.icon || '📄') + ' ' + (tgtDoc.title || '無標題')) : '（未知）';
  document.getElementById("edgeEditLabelInput").value = edge.label || '';

  const colorRow = document.getElementById("edgeColorRow");
  colorRow.innerHTML = "";
  const currentColor = edge.color || "e_gray";
  Object.keys(EDGE_COLORS).forEach(function(colorId) {
    const col = { stroke: getEdgeStroke(colorId), name: EDGE_COLORS[colorId].name };
    const chip = document.createElement("div");
    chip.className = "edge-color-chip" + (colorId === currentColor ? " active" : "");
    chip.style.background = col.stroke;
    chip.style.borderColor = colorId === currentColor ? "var(--text-primary)" : "transparent";
    chip.title = col.name;
    chip.dataset.colorId = colorId;
    chip.onclick = function() {
      colorRow.querySelectorAll(".edge-color-chip").forEach(c => {
        c.classList.remove("active");
        c.style.borderColor = "transparent";
      });
      chip.classList.add("active");
      chip.style.borderColor = "var(--text-primary)";
    };
    colorRow.appendChild(chip);
  });

  const dashRow = document.getElementById("edgeStyleRow");
  const currentDash = edge.dash || "solid";
  dashRow.querySelectorAll(".edge-opt-btn").forEach(function(btn) {
    btn.classList.toggle("active", btn.getAttribute("data-dash") === currentDash);
    btn.onclick = function() {
      dashRow.querySelectorAll(".edge-opt-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
    };
  });

  const arrowRow = document.getElementById("edgeArrowRow");
  const currentArrow = edge.arrow || "none";
  arrowRow.querySelectorAll(".edge-opt-btn").forEach(function(btn) {
    btn.classList.toggle("active", btn.getAttribute("data-arrow") === currentArrow);
    btn.onclick = function() {
      arrowRow.querySelectorAll(".edge-opt-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
    };
  });

  document.getElementById("edgeEditModal").classList.add("active");
  setTimeout(function() {
    const input = document.getElementById("edgeEditLabelInput");
    // 觸控裝置不自動聚焦：一打開就跳軟體鍵盤，把彈窗擠掉半個畫面
    if (input && !isMobileLayout() && !isTouchPrimary()) { input.focus(); input.select(); }
  }, 50);
}

function closeEdgeEditModal() {
  document.getElementById("edgeEditModal").classList.remove("active");
  editingEdgeId = null;
}

function saveEditingEdge() {
  if (!editingEdgeId) return;
  const canvas = getCurrentWorldCanvas();
  const edge = canvas.edges.find(e => e.id === editingEdgeId);
  if (!edge) { closeEdgeEditModal(); return; }
  const before = JSON.stringify(edge);

  const val = document.getElementById("edgeEditLabelInput").value.trim();
  edge.label = val || "關聯";

  const activeColorChip = document.querySelector("#edgeColorRow .edge-color-chip.active");
  if (activeColorChip && activeColorChip.dataset.colorId) {
    edge.color = activeColorChip.dataset.colorId;
  }

  const activeDash = document.querySelector("#edgeStyleRow .edge-opt-btn.active");
  if (activeDash) edge.dash = activeDash.getAttribute("data-dash");

  const activeArrow = document.querySelector("#edgeArrowRow .edge-opt-btn.active");
  if (activeArrow) edge.arrow = activeArrow.getAttribute("data-arrow");
  // 按「儲存」但什麼都沒改，不算修改（不然同步時會變成白白的衝突）
  if (JSON.stringify(edge) !== before) touchCanvasObject(edge);

  saveData();
  renderCanvasLines();
  closeEdgeEditModal();
}

function deleteEditingEdge() {
  if (!editingEdgeId) return;
  if (!confirm("確定要刪除此連線嗎？（可以到垃圾桶復原）")) return;
  trashCanvasEdge(editingEdgeId);
  closeEdgeEditModal();
}

/* ---------- 白板物件的垃圾桶 ----------

   節點、連線、便條紙原本刪了就沒了，沒有垃圾桶也沒有復原——但文檔那邊
   刪掉是可以復原的。同一個 app 兩套規則，使用者會照文檔的習慣去按，
   然後發現救不回來。

   收進 appData.trash.canvas，跟文檔共用同一個垃圾桶視窗與 60 天清理。
   刪節點時連著它的線要一起收走，復原時才能一起回來——不然復原了一個
   沒有任何連線的孤零零節點。
   ------------------------------------------------------------- */

function pushCanvasTrash(entry) {
  if (!appData.trash) appData.trash = { docs: [], folders: [], canvas: [] };
  if (!Array.isArray(appData.trash.canvas)) appData.trash.canvas = [];
  appData.trash.canvas.push(Object.assign({
    worldId: activeWorldId,
    deletedAt: formatTime(new Date()),
    deletedTs: Date.now()
  }, entry));
}

function trashCanvasNode(nodeId) {
  const canvas = getCurrentWorldCanvas();
  const node = canvas.nodes.find(n => n.id === nodeId);
  if (!node) return;
  const edges = canvas.edges.filter(e => e.source === nodeId || e.target === nodeId);
  const doc = appData.docs.find(d => d.id === node.docId);

  pushCanvasTrash({
    kind: "node",
    label: (doc ? (doc.icon || "📄") + " " + (doc.title || "無標題文檔") : "（文檔已不存在）"),
    node: node,
    edges: edges
  });

  canvas.nodes = canvas.nodes.filter(n => n.id !== nodeId);
  canvas.edges = canvas.edges.filter(e => e.source !== nodeId && e.target !== nodeId);
  saveData();
  renderCanvas();
}

function trashCanvasEdge(edgeId) {
  const canvas = getCurrentWorldCanvas();
  const edge = canvas.edges.find(e => e.id === edgeId);
  if (!edge) return;

  const nameOf = function(nid) {
    const n = canvas.nodes.find(x => x.id === nid);
    const d = n && appData.docs.find(x => x.id === n.docId);
    return d ? (d.title || "無標題") : "?";
  };

  pushCanvasTrash({
    kind: "edge",
    label: nameOf(edge.source) + " → " + nameOf(edge.target) + (edge.label ? "（" + edge.label + "）" : ""),
    edge: edge
  });

  canvas.edges = canvas.edges.filter(e => e.id !== edgeId);
  saveData();
  renderCanvas();
}

function trashCanvasNote(noteId) {
  const canvas = getCurrentWorldCanvas();
  const note = (canvas.notes || []).find(n => n.id === noteId);
  if (!note) return;

  pushCanvasTrash({
    kind: "note",
    label: (note.text || "").slice(0, 20) || "（空白便條紙）",
    note: note
  });

  canvas.notes = canvas.notes.filter(n => n.id !== noteId);
  saveData();
  renderCanvas();
}

/* 從垃圾桶把白板物件放回去。節點連同它的線一起回來；線要回去的話兩端的
   節點都還得在，否則會出現連到空氣的線。 */
/* 舊版刪文檔時拆出來的節點用的標籤。那時候還沒有 withDoc 標記，只能靠它
   認出「這一筆是跟著某篇文檔的」。 */
const TRASH_NODE_WITH_DOC_LABEL = "（隨文檔一起刪除的白板節點）";

/* 這一筆白板垃圾跟著哪一篇文檔（因為那篇被刪才進來的）。不是就回 null。
   只有節點會跟著文檔；便條紙與連線、使用者在白板上自己刪的節點都不算。 */
function canvasTrashFollowsDoc(entry) {
  if (!entry || entry.kind !== "node") return null;
  if (entry.withDoc) return entry.withDoc;
  if (entry.label === TRASH_NODE_WITH_DOC_LABEL && entry.node && entry.node.docId) return entry.node.docId;
  return null;
}

/* 復原一篇文檔時，把跟著它的節點（連同兩端都在的連線）一起放回白板。
   從後面往前做：restoreCanvasTrashItem 會把那一筆從陣列裡拿掉，往前走索引
   才不會錯位。放不回去的（例如它的世界觀已經不在了）安靜地留在垃圾桶，
   那時候它就會變成獨立的一列，還看得到。 */
function restoreNodesFollowingDoc(docId) {
  const list = (appData.trash && appData.trash.canvas) || [];
  for (let i = list.length - 1; i >= 0; i--) {
    if (canvasTrashFollowsDoc(list[i]) === docId) restoreCanvasTrashItem(i, true);
  }
}

/* 永久刪除一篇文檔時，跟著它的節點一起刪掉——不然垃圾桶裡會剩一筆再也
   復原不了的節點。 */
function dropNodesFollowingDoc(docId) {
  if (!appData.trash || !Array.isArray(appData.trash.canvas)) return;
  appData.trash.canvas = appData.trash.canvas.filter(function(e) { return canvasTrashFollowsDoc(e) !== docId; });
}

/* 垃圾桶列表上那一筆現在在陣列的第幾個。

   列表畫好之後，同步可能已經把 trash.canvas 換過（另一台刪了或還原了東西），
   畫的時候記下的索引就會指到別筆。所以點下去的那一刻才照 id（見
   canvasTrashKey）重新找；組不出鍵的舊資料才退回原本的索引，而且那一格
   必須還是同一筆。找不到回 -1。 */
function canvasTrashIndexOf(entry, fallbackIndex) {
  const list = (appData.trash && appData.trash.canvas) || [];
  const key = typeof canvasTrashKey === "function" ? canvasTrashKey(entry) : null;
  if (!key) return list[fallbackIndex] === entry ? fallbackIndex : -1;
  for (let i = 0; i < list.length; i++) {
    if (canvasTrashKey(list[i]) === key) return i;
  }
  return -1;
}

/* quiet：跟著文檔一起復原時用，失敗就安靜地回 false，不跳提示。 */
function restoreCanvasTrashItem(index, quiet) {
  const list = (appData.trash && appData.trash.canvas) || [];
  const entry = list[index];
  if (!entry) return false;
  const say = function(msg) { if (!quiet) alert(msg); };

  const world = appData.worldviews.find(w => w.id === entry.worldId);
  if (!world) { say("這個項目所屬的世界觀已經不存在了，無法復原。"); return false; }
  if (!world.canvas) world.canvas = { nodes: [], edges: [], notes: [] };
  const c = world.canvas;
  if (!Array.isArray(c.nodes)) c.nodes = [];
  if (!Array.isArray(c.edges)) c.edges = [];
  if (!Array.isArray(c.notes)) c.notes = [];

  if (entry.kind === "node") {
    if (!appData.docs.find(d => d.id === entry.node.docId)) {
      say("這個節點對應的文檔已經不在了（可能還在垃圾桶裡）。請先復原那篇文檔。");
      return false;
    }
    if (!c.nodes.find(n => n.id === entry.node.id)) c.nodes.push(entry.node);
    (entry.edges || []).forEach(function(e) {
      const bothEnds = c.nodes.find(n => n.id === e.source) && c.nodes.find(n => n.id === e.target);
      if (bothEnds && !c.edges.find(x => x.id === e.id)) c.edges.push(e);
    });
  } else if (entry.kind === "edge") {
    const e = entry.edge;
    if (!c.nodes.find(n => n.id === e.source) || !c.nodes.find(n => n.id === e.target)) {
      say("這條連線兩端的節點不是都還在白板上，無法復原。");
      return false;
    }
    if (!c.edges.find(x => x.id === e.id)) c.edges.push(e);
  } else if (entry.kind === "note") {
    if (!c.notes.find(n => n.id === entry.note.id)) c.notes.push(entry.note);
  } else {
    return false;
  }

  appData.trash.canvas.splice(index, 1);
  saveData();
  refreshCanvasIfVisible();
  return true;
}

/* 文檔被刪掉之後，白板上指向它的節點與連線原本還留在資料裡——畫的時候
   只是跳過不畫（見 renderCanvas 的 if (!doc) return），資料本身沒清，
   用久了會一直累積，佔著本來就只有 5MB 的空間。

   跟著文檔一起收進垃圾桶：這樣復原文檔之後，節點也回得來。 */
/* label 是垃圾桶裡那一筆顯示的說明。刪文檔與「文檔搬到別的世界觀」都會
   走這裡，兩種情況給使用者看的原因不一樣。 */
/* followsDoc（預設 true）：這些節點是「因為文檔被刪」才進垃圾桶的，標上
   withDoc 讓它們跟著那篇文檔——垃圾桶裡不獨立列出，復原文檔時一起回來，
   永久刪除文檔時一起刪掉（使用者：「直接跟著文檔本身，不用獨立出來」）。

   文檔搬到別的世界觀時留下的節點要傳 false：那篇文檔沒有被刪，還活在另一個
   世界觀。標成跟著它的話，之後它在新的世界觀被刪、再復原時，會把舊世界觀的
   節點也帶回舊白板——指著一篇已經不屬於那裡的文檔。 */
function trashOrphanNodesForDocs(docIds, label, followsDoc) {
  if (!docIds || !docIds.length) return;
  if (followsDoc === undefined) followsDoc = true;
  const ids = {};
  docIds.forEach(function(id) { ids[id] = true; });

  appData.worldviews.forEach(function(w) {
    const c = w.canvas;
    if (!c || !Array.isArray(c.nodes)) return;
    const doomed = c.nodes.filter(function(n) { return ids[n.docId]; });
    if (!doomed.length) return;

    doomed.forEach(function(node) {
      const edges = (c.edges || []).filter(e => e.source === node.id || e.target === node.id);
      const entry = {
        kind: "node",
        worldId: w.id,
        label: label || TRASH_NODE_WITH_DOC_LABEL,
        node: node,
        edges: edges
      };
      if (followsDoc) entry.withDoc = node.docId;
      pushCanvasTrash(entry);
    });

    const doomedIds = {};
    doomed.forEach(function(n) { doomedIds[n.id] = true; });
    c.nodes = c.nodes.filter(n => !doomedIds[n.id]);
    c.edges = (c.edges || []).filter(e => !doomedIds[e.source] && !doomedIds[e.target]);
  });
}

/* ---------- 節點右鍵 / 長按選單 ---------- */

function buildCanvasNodeMenuItems(node, doc) {
  return [
    { icon: "📄", label: "開啟文檔", action: function() {
        loadDocToEditor(doc.id);
        switchView('editor');
    }},
    { icon: "🔗", label: "從此節點連線", action: function() {
        startConnect(node.id);
    }},
    { icon: "🎨", label: "節點底色", action: function() {
        openNodeColorPicker(node);
    }},
    { icon: canvasItemLocked(node) ? "🔓" : "🔒",
      label: canvasItemLocked(node) ? "解除位置鎖定" : "鎖住位置",
      action: function() { toggleCanvasItemLock(node, "這個節點"); } },
    { type: "divider" },
    { icon: "🗑️", label: "從白板移除", danger: true, action: function() {
        trashCanvasNode(node.id);
    }}
  ];
}

/* ---------- 白板事件 ---------- */

function setupCanvasEvents() {
  const view = document.getElementById("canvasView");
  const svg = document.getElementById("canvasSvg");

  view.onclick = function(e) {
    if (!e.target.closest('.canvas-node')) {
      if (connectingSourceNodeId) cancelConnect();
    }
  };

  view.addEventListener("wheel", function(e) {
    if (e.target.closest('.canvas-floating-actions')) return;
    e.preventDefault();

    const rect = view.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const factor = e.ctrlKey ? 0.003 : 0.0015;
    const zoomFactor = Math.exp(-e.deltaY * factor);
    const newScale = clampScale(canvasTransform.scale * zoomFactor);
    if (newScale === canvasTransform.scale) return;

    const worldBefore = screenToWorld(mx, my);
    canvasTransform.scale = newScale;
    canvasTransform.x = mx - worldBefore.x * newScale;
    canvasTransform.y = my - worldBefore.y * newScale;

    applyCanvasTransform();
    applySvgViewBox();
  }, { passive: false });

  view.addEventListener("mousedown", function(e) {
    if (e.button !== 0) return;
    if (e.target.closest('.canvas-node')) return;
    if (e.target.closest('.canvas-floating-actions')) return;
    if (e.target.closest('.canvas-hint-floating')) return;
    if (e.target.closest('.canvas-zoom-indicator')) return;
    if (e.target.closest('svg') && e.target.tagName !== 'svg') return;

    e.preventDefault();
    const startX = e.clientX, startY = e.clientY;
    const initX = canvasTransform.x, initY = canvasTransform.y;

    function onMove(m) {
      const dx = m.clientX - startX;
      const dy = m.clientY - startY;
      canvasTransform.x = initX + dx;
      canvasTransform.y = initY + dy;
      applyCanvasTransform();
      applySvgViewBox();
    }
    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  });

  setupTouchPanZoom(view, svg);
  setupBlankLongPress(view);

  svg.style.touchAction = "none";
  view.style.touchAction = "none";

  // 白板容器的大小會因為很多原因改變，而且多半不是瞬間完成的：
  // 視窗縮放、側邊欄 0.25s 的寬度過場、跨過 768px 斷點時整個版面重排。
  // 只聽 window 的 resize 事件會出事——事件只觸發一次，量到的是版面
  // 還在動的中途尺寸，之後就沒人再算了。而 .canvas-svg 的 CSS 是
  // width/height 100%，元素實際大小永遠跟著容器跑，viewBox 卻停在舊值，
  // 配上 preserveAspectRatio="none" 就會把整個白板橫向拉長。
  //
  // 改成觀察容器本身：不管誰、因為什麼原因改變了它的大小，每一次變化
  // 都會重算，過場中途的每一格也算得到。
  if (typeof ResizeObserver === "function") {
    // 只改 svg 子元素的屬性，不會回頭影響容器大小，不會造成觀察迴圈
    new ResizeObserver(function() {
      applySvgViewBox();
      // 容器變矮多半就是鍵盤跳出來了。這裡是最可靠的訊號：不管版面縮到
      // 哪一格都會通知，不像 visualViewport 的單次事件可能量到中途尺寸。
      scheduleCaretCheck();
    }).observe(view);
  } else {
    window.addEventListener("resize", function() {
      applySvgViewBox();
      scheduleCaretCheck();
    });
  }
}

function setupTouchPanZoom(view, svg) {
  let mode = null;
  let panStartX = 0, panStartY = 0, panInitX = 0, panInitY = 0;
  let pinchStartDist = 0, pinchStartScale = 1, pinchWorldCenter = null;

  function getTouchCenter(t1, t2) {
    return { x: (t1.clientX + t2.clientX) / 2, y: (t1.clientY + t2.clientY) / 2 };
  }
  function getTouchDist(t1, t2) {
    return Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
  }

  view.addEventListener("touchstart", function(e) {
    if (e.target.closest('.canvas-floating-actions')) return;
    if (e.target.closest('.canvas-hint-floating')) return;

    if (e.touches.length === 2) {
      mode = 'pinch';
      pinchStartDist = getTouchDist(e.touches[0], e.touches[1]);
      pinchStartScale = canvasTransform.scale;
      const rect = view.getBoundingClientRect();
      const center = getTouchCenter(e.touches[0], e.touches[1]);
      pinchWorldCenter = screenToWorld(center.x - rect.left, center.y - rect.top);
      e.preventDefault();
      return;
    }

    if (e.touches.length === 1) {
      const onNode = !!e.target.closest('.canvas-node');
      const onSvgChild = !!(e.target.closest && e.target.closest('svg') && e.target.tagName !== 'svg');

      if (onSvgChild) { mode = null; return; }
      if (!onNode) {
        mode = 'pan';
        panStartX = e.touches[0].clientX;
        panStartY = e.touches[0].clientY;
        panInitX = canvasTransform.x;
        panInitY = canvasTransform.y;
      } else {
        mode = null;
      }
    }
  }, { passive: false });

  view.addEventListener("touchmove", function(e) {
    if (mode === 'pinch' && e.touches.length === 2) {
      e.preventDefault();
      const dist = getTouchDist(e.touches[0], e.touches[1]);
      const newScale = clampScale(pinchStartScale * (dist / pinchStartDist));
      const rect = view.getBoundingClientRect();
      const center = getTouchCenter(e.touches[0], e.touches[1]);
      const cx = center.x - rect.left, cy = center.y - rect.top;

      canvasTransform.scale = newScale;
      canvasTransform.x = cx - pinchWorldCenter.x * newScale;
      canvasTransform.y = cy - pinchWorldCenter.y * newScale;

      applyCanvasTransform();
      applySvgViewBox();
    } else if (mode === 'pan' && e.touches.length === 1) {
      e.preventDefault();
      const dx = e.touches[0].clientX - panStartX;
      const dy = e.touches[0].clientY - panStartY;
      canvasTransform.x = panInitX + dx;
      canvasTransform.y = panInitY + dy;
      applyCanvasTransform();
      applySvgViewBox();
    }
  }, { passive: false });

  function endTouch(e) {
    if (mode === 'pinch' && e.touches.length < 2) {
      if (e.touches.length === 1) {
        mode = 'pan';
        panStartX = e.touches[0].clientX;
        panStartY = e.touches[0].clientY;
        panInitX = canvasTransform.x;
        panInitY = canvasTransform.y;
      } else {
        mode = null;
      }
    } else if (mode === 'pan' && e.touches.length === 0) {
      mode = null;
    }
  }
  view.addEventListener("touchend", endTouch);
  view.addEventListener("touchcancel", endTouch);
}
