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

/* ---------- 依「兩矩形真正最短距離」決定連線要從哪一側出發 ----------
   跟舊版不同：這裡不再強迫兩端用同一軸（例如一定 bottom<->top 或
   right<->left），而是各自列出「合理候選邊」，把兩邊所有候選組合都
   算出實際距離，取距離最短的那組——所以斜向擺放、大小不同的兩個節點，
   可能會選出「一邊用長邊（top/bottom）、另一邊用短邊（left/right）」
   這種不對稱組合，真正做到長邊接短邊。
------------------------------------------------------------------ */
function clampNum(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

// 某矩形面向另一個矩形時，「合理」（面朝對方）的候選邊，通常 1~2 個
function candidateSidesForDirection(rect, otherRect) {
  const overlapX = rect.left < otherRect.right && rect.right > otherRect.left;
  const overlapY = rect.top < otherRect.bottom && rect.bottom > otherRect.top;
  const otherIsRight = otherRect.left >= rect.right;
  const otherIsLeft = otherRect.right <= rect.left;
  const otherIsBelow = otherRect.top >= rect.bottom;
  const otherIsAbove = otherRect.bottom <= rect.top;

  const sides = [];
  if (!overlapY) {
    if (otherIsBelow) sides.push('bottom');
    else if (otherIsAbove) sides.push('top');
  }
  if (!overlapX) {
    if (otherIsRight) sides.push('right');
    else if (otherIsLeft) sides.push('left');
  }
  if (sides.length === 0) {
    // 兩矩形重疊（罕見情況）：退回中心點比較
    const cxA = (rect.left + rect.right) / 2, cyA = (rect.top + rect.bottom) / 2;
    const cxB = (otherRect.left + otherRect.right) / 2, cyB = (otherRect.top + otherRect.bottom) / 2;
    const dx = cxB - cxA, dy = cyB - cyA;
    sides.push(Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 'right' : 'left') : (dy >= 0 ? 'bottom' : 'top'));
  }
  return sides;
}

// 某邊上、面向對方矩形最近的一點（投影 + clamp，近似最近點）
function anchorForSide(rect, side, otherRect) {
  const ocx = (otherRect.left + otherRect.right) / 2;
  const ocy = (otherRect.top + otherRect.bottom) / 2;
  if (side === 'right') return { x: rect.right, y: clampNum(ocy, rect.top, rect.bottom) };
  if (side === 'left') return { x: rect.left, y: clampNum(ocy, rect.top, rect.bottom) };
  if (side === 'bottom') return { x: clampNum(ocx, rect.left, rect.right), y: rect.bottom };
  return { x: clampNum(ocx, rect.left, rect.right), y: rect.top }; // 'top'
}

// 列出 A、B 各自候選邊的所有組合，依實際距離由近到遠排序。
// 斜向擺放時兩端各有兩個候選邊（一個長邊、一個短邊），組合起來共四種：
// 長→長、長→短、短→長、短→短。只取最近的一組會讓同一對節點的多條線
// 全擠在同一個邊框上（常常正好是最短的那個短邊）；保留整份清單，
// 就能把多條線分配到不同組合上，讓它們從不同邊框出發而自然錯開。
function listSidePairsByDistance(rectA, rectB) {
  const sidesA = candidateSidesForDirection(rectA, rectB);
  const sidesB = candidateSidesForDirection(rectB, rectA);

  const combos = [];
  sidesA.forEach(function(sa) {
    sidesB.forEach(function(sb) {
      const pa = anchorForSide(rectA, sa, rectB);
      const pb = anchorForSide(rectB, sb, rectA);
      combos.push({ d: Math.hypot(pa.x - pb.x, pa.y - pb.y), sideA: sa, sideB: sb });
    });
  });
  combos.sort(function(a, b) { return a.d - b.d; });
  return combos;
}

/* ---------- 節點邊框交點（沿該邊 30%~70% 分散）---------- */
function getNodeBorderPoint(node, side, slotInfo) {
  const rect = getNodeRect(node);
  const w = rect.w, h = rect.h;

  const cx = node.x + w / 2;
  const cy = node.y + h / 2;

  // 分散範圍 0.3 ~ 0.7（依你指定）
  let t = 0.5;
  if (slotInfo && slotInfo.total > 1) {
    const lo = 0.3, hi = 0.7;
    const step = (hi - lo) / (slotInfo.total - 1);
    t = lo + step * slotInfo.index;
  }

  const halfW = w / 2 + 2;
  const halfH = h / 2 + 2;

  let px, py;
  if (side === 'right') {
    px = cx + halfW; py = cy - halfH + t * (2 * halfH);
  } else if (side === 'left') {
    px = cx - halfW; py = cy - halfH + t * (2 * halfH);
  } else if (side === 'bottom') {
    px = cx - halfW + t * (2 * halfW); py = cy + halfH;
  } else {
    px = cx - halfW + t * (2 * halfW); py = cy - halfH;
  }

  return { x: px, y: py, t: t, side: side };
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

  /* ---------- 把「連結同一對節點」的邊先分組 ----------
     同一對節點之間的多條邊，需要一起決定要用哪些邊框組合、彎多少，
     所以分組必須在決定側邊之前就先做好。
  ------------------------------------------------------------- */
  const pairGroups = {};
  canvas.edges.forEach(function(edge) {
    const key = [edge.source, edge.target].sort().join("|");
    if (!pairGroups[key]) pairGroups[key] = [];
    pairGroups[key].push(edge);
  });

  /* ---------- 決定側邊：同一對節點的多條邊輪流使用不同的邊框組合 ----------
     兩節點斜向擺放時，兩端各有一個長邊（上/下）和一個短邊（左/右）可用，
     組合起來有長→長、長→短、短→長、短→短四種。如果所有邊都取「距離最短」
     的那一種（常常是短邊→短邊），多條線就會全擠在同一個只有幾十像素高的
     短邊上，變成緊緊一束。這裡改成把同一對節點的邊依序分配到不同組合上，
     線就會從不同邊框出發，自然錯開。
     非斜向（正上下或正左右）時只會有一種組合，行為跟原本一樣。
  ------------------------------------------------------------- */
  const edgeSideCombo = {};
  Object.keys(pairGroups).forEach(function(key) {
    const ids = key.split("|");
    const nodeA = canvas.nodes.find(n => n.id === ids[0]);
    const nodeB = canvas.nodes.find(n => n.id === ids[1]);
    if (!nodeA || !nodeB) return;

    const combos = listSidePairsByDistance(getNodeRect(nodeA), getNodeRect(nodeB));
    pairGroups[key].forEach(function(edge, idx) {
      const combo = combos[idx % combos.length];
      // combo.sideA 屬於 nodeA、sideB 屬於 nodeB，依這條邊自己的方向對應回 source/target
      const srcIsA = edge.source === nodeA.id;
      edgeSideCombo[edge.id] = {
        sourceSide: srcIsA ? combo.sideA : combo.sideB,
        targetSide: srcIsA ? combo.sideB : combo.sideA,
        // 與線的儲存方向無關的識別字串（永遠照 key 裡 nodeA、nodeB 的順序寫），
        // 這樣 A→B 與 B→A 只要用的是同一組邊框，就會被認成同一組。
        comboKey: combo.sideA + ">" + combo.sideB
      };
    });
  });

  /* ---------- 決定每側連線的排列順序 ----------
     同一節點同一側若有多條線，port 順序不能只依邊的建立先後，
     否則一旦線的「目標」在空間上的左右／上下順序跟建立順序對不上，
     線一出節點邊框就會先天互相交叉。
     這裡改成：每條邊在某節點某側的位置，依照「對面那個節點中心」
     沿該側分散軸（上/下側看 x、左/右側看 y）的座標排序，
     port 順序自然貼合對面節點的實際空間分佈，才能避免無謂的交叉。
  ------------------------------------------------------------- */
  const edgeSideInfo = {};
  const sideGroups = {}; // key: nodeId + "|" + side -> [{ edgeId, endpoint, otherX, otherY }]
  function pushToSideGroup(nodeId, side, edgeId, endpoint, otherCenter) {
    const key = nodeId + "|" + side;
    if (!sideGroups[key]) sideGroups[key] = [];
    sideGroups[key].push({ edgeId: edgeId, endpoint: endpoint, otherX: otherCenter.x, otherY: otherCenter.y });
  }

  canvas.edges.forEach(function(edge) {
    const srcNode = canvas.nodes.find(n => n.id === edge.source);
    const tgtNode = canvas.nodes.find(n => n.id === edge.target);
    if (!srcNode || !tgtNode) return;

    const combo = edgeSideCombo[edge.id];
    if (!combo) return;
    const srcSide = combo.sourceSide;
    const tgtSide = combo.targetSide;

    edgeSideInfo[edge.id] = { sourceSide: srcSide, targetSide: tgtSide };

    const srcRect = getNodeRect(srcNode);
    const tgtRect = getNodeRect(tgtNode);
    const srcCenter = { x: (srcRect.left + srcRect.right) / 2, y: (srcRect.top + srcRect.bottom) / 2 };
    const tgtCenter = { x: (tgtRect.left + tgtRect.right) / 2, y: (tgtRect.top + tgtRect.bottom) / 2 };

    pushToSideGroup(srcNode.id, srcSide, edge.id, 'source', tgtCenter);
    pushToSideGroup(tgtNode.id, tgtSide, edge.id, 'target', srcCenter);
  });

  const edgeSlotInfo = {};
  Object.keys(sideGroups).forEach(function(key) {
    const group = sideGroups[key];
    const side = key.slice(key.lastIndexOf("|") + 1);
    const axisKey = (side === 'bottom' || side === 'top') ? 'otherX' : 'otherY';
    group.sort(function(a, b) { return a[axisKey] - b[axisKey]; });
    group.forEach(function(item, idx) {
      if (!edgeSlotInfo[item.edgeId]) edgeSlotInfo[item.edgeId] = {};
      edgeSlotInfo[item.edgeId][item.endpoint + "Slot"] = { index: idx, total: group.length, side: side };
    });
  });

  /* ---------- 彎曲偏移值：只在「共用同一組邊框」的邊之間分開 ----------
     offset 落在 -1..+1，正負各往對稱軸的一側彎、幅度相同，讓這些邊沿著
     兩節點中心連線對稱展開。
     分組的依據是「節點對 + 邊框組合」而不是只看節點對：已經被分配到不同
     邊框組合的邊，起點終點本來就分開了，再額外把它們往兩側推反而會把它們
     推向彼此、在中段交叉。只有真的共用同一組邊框、會完全重疊的邊才需要彎。
     這個值同時也決定標籤沿曲線長度的錯開量（見下方 tt 的計算）。
  ------------------------------------------------------------- */
  const edgeOffsetMap = {};
  const edgeGroupTotalMap = {};
  const bendGroups = {};
  canvas.edges.forEach(function(edge) {
    const combo = edgeSideCombo[edge.id];
    if (!combo) return;
    const key = [edge.source, edge.target].sort().join("|") + "|" + combo.comboKey;
    if (!bendGroups[key]) bendGroups[key] = [];
    bendGroups[key].push(edge);
  });

  Object.keys(bendGroups).forEach(function(key) {
    const group = bendGroups[key];
    const total = group.length;
    group.forEach(function(edge, idx) {
      let offset;
      if (total === 1) offset = 0;
      else offset = (idx - (total - 1) / 2) / ((total - 1) / 2); // -1 .. 1
      edgeOffsetMap[edge.id] = offset;
      edgeGroupTotalMap[edge.id] = total;
    });
  });

  /* ---------- 同一對節點的共用基準：由「目錄樹上方者」指向「下方者」----------
     這個基準方向必須固定、可預期，不能取決於使用者剛好先畫了哪一條線、
     或線段實際儲存的 source/target 是誰。這裡固定用側邊欄目錄樹的顯示
     順序決定：目錄樹排序較前面的那個節點視為起點，較後面的視為終點。
     它提供兩件事：
     （1）pairPerpMap：兩節點中心連線的垂直方向，也就是彎曲的對稱軸法線，
          同一對節點的所有邊共用，斜向擺放時也能真正左右撐開。
     （2）pairUpperNodeIdMap：用來把標籤的 t 統一以「目錄樹上方者」為
          起點量測，反向存的邊才不會跟正向的邊疊在同一個位置。
  ------------------------------------------------------------- */
  const docTreeOrderIndex = computeDocTreeOrderIndex(activeWorldId);
  function nodeTreeOrder(node) {
    const idx = docTreeOrderIndex[node.docId];
    return (idx === undefined) ? Infinity : idx;
  }

  const pairPerpMap = {};
  const pairUpperNodeIdMap = {}; // 記錄每一對節點裡，目錄樹順序較前面的那個節點 id
  Object.keys(pairGroups).forEach(function(key) {
    const ids = key.split("|");
    const nodeX = canvas.nodes.find(n => n.id === ids[0]);
    const nodeY = canvas.nodes.find(n => n.id === ids[1]);
    if (!nodeX || !nodeY) return;
    const xIsUpper = nodeTreeOrder(nodeX) <= nodeTreeOrder(nodeY);
    const upperNode = xIsUpper ? nodeX : nodeY;
    const lowerNode = xIsUpper ? nodeY : nodeX;
    pairUpperNodeIdMap[key] = upperNode.id;
    const rectU = getNodeRect(upperNode), rectL = getNodeRect(lowerNode);
    const cU = { x: (rectU.left + rectU.right) / 2, y: (rectU.top + rectU.bottom) / 2 };
    const cL = { x: (rectL.left + rectL.right) / 2, y: (rectL.top + rectL.bottom) / 2 };
    const pdx = cL.x - cU.x, pdy = cL.y - cU.y;
    const plen = Math.hypot(pdx, pdy) || 1;
    pairPerpMap[key] = { x: -pdy / plen, y: pdx / plen };
  });

  /* ---------- 畫 ---------- */
  const labelJobs = []; // 先收集所有標籤候選位置，畫完全部連線後再統一防重疊
  canvas.edges.forEach(function(edge) {
    const srcNode = canvas.nodes.find(n => n.id === edge.source);
    const tgtNode = canvas.nodes.find(n => n.id === edge.target);
    if (!srcNode || !tgtNode) return;

    const srcEl = document.getElementById(srcNode.id);
    const tgtEl = document.getElementById(tgtNode.id);
    const srcW = srcEl ? srcEl.offsetWidth : CANVAS_NODE_W;
    const srcH = srcEl ? srcEl.offsetHeight : 80;
    const tgtW = tgtEl ? tgtEl.offsetWidth : CANVAS_NODE_W;
    const tgtH = tgtEl ? tgtEl.offsetHeight : 80;

    const srcCenter = { x: srcNode.x + srcW / 2, y: srcNode.y + srcH / 2 };
    const tgtCenter = { x: tgtNode.x + tgtW / 2, y: tgtNode.y + tgtH / 2 };

    const slot = edgeSlotInfo[edge.id] || {};
    const sides = edgeSideInfo[edge.id] || {};
    const p1 = getNodeBorderPoint(srcNode, sides.sourceSide, slot.sourceSlot);
    const p2 = getNodeBorderPoint(tgtNode, sides.targetSide, slot.targetSlot);

    const x1 = p1.x, y1 = p1.y;
    const x2 = p2.x, y2 = p2.y;

    const dx = x2 - x1;
    const dy = y2 - y1;
    const dist = Math.hypot(dx, dy) || 1;

    /* ----- 弧度：用 offset 強制給定 ----- */
    // 同一對節點只有一條線時維持直線。
    // 多條線時（offset 落在 -1..+1），彎曲幅度最大到 maxBend 的 0.7 倍，
    // 正負兩側幅度相同，沿兩節點中心連線左右對稱撐開。
    const maxBend = Math.min(dist * 0.28, 90);
    const total = edgeGroupTotalMap[edge.id] || 1;
    const offset = edgeOffsetMap[edge.id] || 0;

    // 同一對節點的所有邊共用同一把 key，判斷「這條邊自己的 source」
    // 跟目錄樹順序較前面的那個節點是不是同一個——如果不是（也就是這條邊
    // 實際上是反向存的，例如 B→A），底下算標籤 t 的時候要把方向反過來，
    // 否則兩條反向的邊會各自從自己的 source 起算 t，物理位置反而重疊。
    const pairKey = [edge.source, edge.target].sort().join("|");
    const canonicalUpperId = pairUpperNodeIdMap[pairKey];
    const matchesCanonicalDir = !canonicalUpperId || edge.source === canonicalUpperId;

    let bendMag = 0;
    let spreadX = 0, spreadY = 0;
    if (total > 1) {
      const BEND_MIN_RATIO = 0;
      const BEND_MAX_RATIO = 0.7;
      const ratio = BEND_MIN_RATIO + (BEND_MAX_RATIO - BEND_MIN_RATIO) * Math.abs(offset);
      const sign = offset === 0 ? 1 : Math.sign(offset);
      bendMag = sign * ratio * maxBend;

      // 對稱軸的法線用這一對節點共用的垂直方向（見上方 pairPerpMap），
      // offset 的正負決定往哪一側彎，兩側幅度相同，所以是沿著兩節點
      // 中心連線做對稱；斜向擺放時也能真正左右撐開，而不是只在單一軸上微幅錯開。
      const perp = pairPerpMap[pairKey] || { x: 0, y: 1 };
      spreadX = perp.x;
      spreadY = perp.y;
    }

    const ext1 = dist * 0.35;
    const ext2 = dist * 0.35;

    const cx1 = x1 + (dx / dist) * ext1 + spreadX * bendMag;
    const cy1 = y1 + (dy / dist) * ext1 + spreadY * bendMag;

    const cx2 = x2 - (dx / dist) * ext2 + spreadX * bendMag;
    const cy2 = y2 - (dy / dist) * ext2 + spreadY * bendMag;

    const d = "M " + x1 + " " + y1 + " C " + cx1 + " " + cy1 + ", " + cx2 + " " + cy2 + ", " + x2 + " " + y2;

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

    /* ----- 標籤：先算出曲線上的候選落點，稍後統一防重疊再畫 ----- */
    // 依 offset 把 t 沿曲線長度錯開：-1 → 0.35、0 → 0.5、+1 → 0.65。
    // 若這條邊的 source 不是目錄樹順序較前面的那個節點（即反向存的邊），
    // 把錯開量反過來，讓 t 統一以「目錄樹上方者」為起點量測，兩條反向邊
    // 才不會因為各自從自己的 source 起算，落在同一個物理位置。
    const effectiveLabelSpread = matchesCanonicalDir ? offset : -offset;
    const tt = 0.5 + effectiveLabelSpread * 0.15;
    const mt = 1 - tt;
    const bezX = mt*mt*mt*x1 + 3*mt*mt*tt*cx1 + 3*mt*tt*tt*cx2 + tt*tt*tt*x2;
    const bezY = mt*mt*mt*y1 + 3*mt*mt*tt*cy1 + 3*mt*tt*tt*cy2 + tt*tt*tt*y2;

    labelJobs.push({ edge: edge, col: col, x: bezX, y: bezY, cx: bezX, cy: bezY });
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
