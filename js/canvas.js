/* ==========================================================
   白板 (Graphs) — viewBox 架構 + 扇形發散連線
   ========================================================== */

const CANVAS_NODE_W = 200;

let zoomIndicatorTimer = null;

function getCurrentWorldCanvas() {
  const world = appData.worldviews.find(w => w.id === activeWorldId);
  if (!world.canvas) world.canvas = { nodes: [], edges: [] };
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

/* ---------- 提示 ---------- */

function dismissCanvasHint() {}

function applyCanvasHintVisibility() {
  const hint = document.querySelector(".canvas-hint-text");
  if (!hint) return;
  hint.classList.remove("is-hidden");
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
  if (exists) { alert("此文檔已存在於當前白板！"); switchView('canvas'); return; }

  canvas.nodes.push({
    id: "node_" + currentDoc.id,
    docId: currentDoc.id,
    x: 40 + (canvas.nodes.length * 30) % 260,
    y: 60 + (canvas.nodes.length * 40) % 300
  });

  saveData();
  switchView('canvas');
}

/* ---------- 渲染節點 ----------
   節點現在是畫在 <canvasSvg> 裡的 <foreignObject>（內含一般 HTML），
   跟連線共用同一個 viewBox 做縮放，所以放大時是瀏覽器真的重新排版、
   重新描字，而不是把一張畫好的貼圖拉伸，因此不會糊。
   ------------------------------------------------------------- */

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
    fo.setAttribute("height", node._lastH || 80);

    const el = document.createElementNS(XHTML_NS, "div");
    el.className = "canvas-node";
    el.id = node.id;

    if (connectingSourceNodeId === node.id) el.classList.add("connecting");

    const title = (doc.icon || '📄') + " " + (doc.title || "無標題文檔");
    const preview = (doc.content || "").replace(/\n/g, " ");

    let imgHtml = "";
    if (doc.images && doc.images.length > 0) {
      imgHtml = '<img style="width:100%; height:75px; object-fit:cover; border-radius:4px; margin-bottom:6px;" src="' + doc.images[0] + '">';
    }

    el.innerHTML =
      '<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">' +
        '<span style="font-size:12px; font-weight:700; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:170px;">' + escapeHtml(title) + '</span>' +
      '</div>' +
      imgHtml +
      '<div style="font-size:11px; color:var(--text-secondary); line-height:1.4; max-height:32px; overflow:hidden; margin-bottom:4px;">' + escapeHtml(preview) + '</div>' +
      '<div style="font-size:10px; color:var(--text-muted); text-align:right;">' + (doc.wordCount || 0) + ' 字</div>';

    el.ondblclick = function() {
      if (connectingSourceNodeId) return;
      loadDocToEditor(doc.id);
      switchView('editor');
    };

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
    node._lastH = h;
    if (fo && fo.setAttribute) fo.setAttribute("height", h);
  });

  applySvgViewBox();
  renderCanvasLines();
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
  const w = rect.width / canvasTransform.scale;
  const h = rect.height / canvasTransform.scale;
  const x = -canvasTransform.x / canvasTransform.scale;
  const y = -canvasTransform.y / canvasTransform.scale;

  svg.setAttribute("viewBox", x + " " + y + " " + w + " " + h);
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("width", rect.width);
  svg.setAttribute("height", rect.height);
}

/* ---------- 節點拖曳 ---------- */

function enableDualDrag(element, nodeData) {
  let startX, startY, initialLeft, initialTop, dragging = false;
  let pointerMoved = false;

  function beginDrag(clientX, clientY) {
    dragging = true;
    pointerMoved = false;
    startX = clientX; startY = clientY;
    initialLeft = nodeData.x; initialTop = nodeData.y;
  }
  function moveDrag(clientX, clientY) {
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
    saveData();
  }

  element.addEventListener("mousedown", function(e) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    beginDrag(e.clientX, e.clientY);

    function onMouseMove(m) { moveDrag(m.clientX, m.clientY); }
    function onMouseUp() {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      endDrag();
    }
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  });

  element.addEventListener("touchstart", function(e) {
    if (e.touches.length !== 1) return;
    e.stopPropagation();
    const touch = e.touches[0];
    beginDrag(touch.clientX, touch.clientY);

    function onTouchMove(t) {
      if (t.touches.length !== 1) return;
      t.preventDefault();
      moveDrag(t.touches[0].clientX, t.touches[0].clientY);
    }
    function onTouchEnd() {
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchcancel", onTouchEnd);
      endDrag();
    }
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", onTouchEnd);
    window.addEventListener("touchcancel", onTouchEnd);
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

  const canvas = getCurrentWorldCanvas();
  const relation = prompt("請輸入兩者關係：", "盟友 / 敵對 / 密探");
  if (relation !== null) {
    canvas.edges.push({
      id: "edge_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
      source: sourceId,
      target: targetNodeId,
      label: relation || "關聯",
      color: "e_gray",
      dash: "solid",
      arrow: "none"
    });
    saveData();
  }
  cancelConnect();
  renderCanvasLines();
}

/* ---------- 顏色 ---------- */

function getEdgeColor(edge) {
  const id = edge.color || "e_gray";
  return EDGE_COLORS[id] || EDGE_COLORS["e_gray"];
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

/* 產生一條邊的曲線控制點：
   從 rectA 中心畫到 rectB 中心，沿中心連線的法線彎 bend，再裁掉兩端節點內部。 */
function buildEdgeCurve(rectA, rectB, bend) {
  const cA = nodeCenter(rectA);
  const cB = nodeCenter(rectB);
  const dx = cB.x - cA.x, dy = cB.y - cA.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const perpX = -uy, perpY = ux;

  // 控制點各往法線方向推 bend*4/3，曲線中點（t=0.5）的偏移量剛好等於 bend
  const h = bend * 4 / 3;
  const full = [
    cA,
    { x: cA.x + ux * len / 3 + perpX * h, y: cA.y + uy * len / 3 + perpY * h },
    { x: cB.x - ux * len / 3 + perpX * h, y: cB.y - uy * len / 3 + perpY * h },
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
    const col = EDGE_COLORS[colorId];
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
       多條線時 offset 落在 -1..+1，正負各往中心連線的一側彎、幅度相同，
       對稱展開成扇形。出發點是曲線跟邊框的交點，彎得越多交點越外側，
       所以出發順序必定跟彎曲順序一致，不會互相穿越。 */
    const cFrom = nodeCenter(rectFrom);
    const cTo = nodeCenter(rectTo);
    const centerDist = Math.hypot(cTo.x - cFrom.x, cTo.y - cFrom.y) || 1;
    const maxBend = Math.min(centerDist * 0.28, 90);
    const offset = edgeOffsetMap[edge.id] || 0;
    const bend = offset * 0.7 * maxBend;

    let curve = buildEdgeCurve(rectFrom, rectTo, bend);
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
    const col = EDGE_COLORS[colorId];
    const chip = document.createElement("div");
    chip.className = "edge-color-chip" + (colorId === currentColor ? " active" : "");
    chip.style.background = col.stroke;
    chip.style.borderColor = colorId === currentColor ? "#2A2420" : "transparent";
    chip.title = col.name;
    chip.dataset.colorId = colorId;
    chip.onclick = function() {
      colorRow.querySelectorAll(".edge-color-chip").forEach(c => {
        c.classList.remove("active");
        c.style.borderColor = "transparent";
      });
      chip.classList.add("active");
      chip.style.borderColor = "#2A2420";
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
    if (input && window.innerWidth > 768) { input.focus(); input.select(); }
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

  saveData();
  renderCanvasLines();
  closeEdgeEditModal();
}

function deleteEditingEdge() {
  if (!editingEdgeId) return;
  if (!confirm("確定要刪除此連線嗎？")) return;
  const canvas = getCurrentWorldCanvas();
  canvas.edges = canvas.edges.filter(e => e.id !== editingEdgeId);
  saveData();
  renderCanvasLines();
  closeEdgeEditModal();
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
    { type: "divider" },
    { icon: "🗑️", label: "從白板移除", danger: true, action: function() {
        const canvas = getCurrentWorldCanvas();
        canvas.nodes = canvas.nodes.filter(n => n.id !== node.id);
        canvas.edges = canvas.edges.filter(e => e.source !== node.id && e.target !== node.id);
        saveData();
        renderCanvas();
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

  svg.style.touchAction = "none";
  view.style.touchAction = "none";

  window.addEventListener("resize", applySvgViewBox);
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
