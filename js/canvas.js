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

// 列出 A、B 各自的候選邊，取所有組合中距離最短的一組
function pickClosestSidePair(rectA, rectB) {
  const sidesA = candidateSidesForDirection(rectA, rectB);
  const sidesB = candidateSidesForDirection(rectB, rectA);

  let best = null;
  sidesA.forEach(function(sa) {
    sidesB.forEach(function(sb) {
      const pa = anchorForSide(rectA, sa, rectB);
      const pb = anchorForSide(rectB, sb, rectA);
      const d = Math.hypot(pa.x - pb.x, pa.y - pb.y);
      if (!best || d < best.d) best = { d: d, sideA: sa, sideB: sb };
    });
  });
  return best;
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

  /* ---------- 決定側邊（兩端各自可能不同軸，允許長邊接短邊）---------- */
  function determineSidePair(nodeA, nodeB) {
    return pickClosestSidePair(getNodeRect(nodeA), getNodeRect(nodeB));
  }

  /* ---------- 統計每節點每側條數 ---------- */
  const nodeSideCount = {};
  function ensureCount(nodeId) {
    if (!nodeSideCount[nodeId]) {
      nodeSideCount[nodeId] = { right: 0, left: 0, bottom: 0, top: 0 };
    }
  }

  const edgeSideInfo = {};
  canvas.edges.forEach(function(edge) {
    const srcNode = canvas.nodes.find(n => n.id === edge.source);
    const tgtNode = canvas.nodes.find(n => n.id === edge.target);
    if (!srcNode || !tgtNode) return;

    const sidePair = determineSidePair(srcNode, tgtNode);
    const srcSide = sidePair.sideA;
    const tgtSide = sidePair.sideB;

    edgeSideInfo[edge.id] = { sourceSide: srcSide, targetSide: tgtSide };

    ensureCount(srcNode.id);
    ensureCount(tgtNode.id);
    nodeSideCount[srcNode.id][srcSide]++;
    nodeSideCount[tgtNode.id][tgtSide]++;
  });

  /* ---------- 分配 slot：source 順序、target 鏡像反轉 ---------- */
  const nodeSideUsed = {};
  function nextSlot(nodeId, side) {
    if (!nodeSideUsed[nodeId]) {
      nodeSideUsed[nodeId] = { right: 0, left: 0, bottom: 0, top: 0 };
    }
    const idx = nodeSideUsed[nodeId][side];
    nodeSideUsed[nodeId][side]++;
    return { index: idx, total: nodeSideCount[nodeId][side], side: side };
  }

  const edgeSlotInfo = {};
  canvas.edges.forEach(function(edge) {
    if (!edgeSideInfo[edge.id]) return;
    const info = edgeSideInfo[edge.id];
    const sSlot = nextSlot(edge.source, info.sourceSide);
    const tSlot = nextSlot(edge.target, info.targetSide);

    // source、target 兩端維持同一個順序（不反轉），避免多條線因兩端配對錯開而互相交叉
    edgeSlotInfo[edge.id] = { sourceSlot: sSlot, targetSlot: tSlot };
  });

  /* ---------- 同一對節點多條邊的偏移值（給弧度用）---------- */
  const pairGroups = {};
  canvas.edges.forEach(function(edge) {
    const key = [edge.source, edge.target].sort().join("|");
    if (!pairGroups[key]) pairGroups[key] = [];
    pairGroups[key].push(edge);
  });

  const edgeOffsetMap = {};
  const edgeGroupTotalMap = {};
  Object.keys(pairGroups).forEach(function(key) {
    const group = pairGroups[key];
    const total = group.length;
    group.forEach(function(edge, idx) {
      let offset;
      if (total === 1) offset = 0;
      else offset = (idx - (total - 1) / 2) / ((total - 1) / 2); // -1 .. 1
      edgeOffsetMap[edge.id] = offset;
      edgeGroupTotalMap[edge.id] = total;
    });
  });

  /* ---------- 畫 ---------- */
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
    // 多條線時（offset = -1 / 0 / +1），彎曲幅度統一落在 maxBend 的 0.3～0.7 倍範圍，
    // 中間那條（offset=0）取最小值 0.3，最外側（offset=±1）取最大值 0.7。
    const maxBend = Math.min(dist * 0.28, 90);
    const total = edgeGroupTotalMap[edge.id] || 1;
    const offset = edgeOffsetMap[edge.id] || 0;

    let bendMag = 0;
    let spreadX = 0, spreadY = 0;
    if (total > 1) {
      const BEND_MIN_RATIO = 0;
      const BEND_MAX_RATIO = 0.7;
      const ratio = BEND_MIN_RATIO + (BEND_MAX_RATIO - BEND_MIN_RATIO) * Math.abs(offset);
      const sign = offset === 0 ? 1 : Math.sign(offset);
      bendMag = sign * ratio * maxBend;

      // 彎曲方向要跟「這條線在節點邊框上排列的分散軸」完全同步，
      // 而不是用兩點連線的垂直方向。斜向連線時這兩個方向會不一樣，
      // 只要彎曲方向跟分散順序對不上，線就會在中途互相穿越。
      // 上/下側：邊框上是左右排開 → 分散軸是水平（x）
      // 左/右側：邊框上是上下排開 → 分散軸是垂直（y）
      const srcSide = (edgeSideInfo[edge.id] || {}).sourceSide;
      if (srcSide === 'bottom' || srcSide === 'top') {
        spreadX = 1;
      } else {
        spreadY = 1;
      }
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

    /* ----- 標籤：沿曲線 t 錯開，避免重疊 ----- */
    // 依 offset 把 t 錯開：-1 → 0.35、0 → 0.5、+1 → 0.65
    const tt = 0.5 + offset * 0.15;
    const mt = 1 - tt;
    const bezX = mt*mt*mt*x1 + 3*mt*mt*tt*cx1 + 3*mt*tt*tt*cx2 + tt*tt*tt*x2;
    const bezY = mt*mt*mt*y1 + 3*mt*mt*tt*cy1 + 3*mt*tt*tt*cy2 + tt*tt*tt*y2;

    const g = document.createElementNS(NS, "g");
    g.style.pointerEvents = "all";
    g.style.cursor = "pointer";

    const text = document.createElementNS(NS, "text");
    text.setAttribute("x", bezX);
    text.setAttribute("y", bezY);
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
      bbox = { x: bezX - w / 2, y: bezY - 8, width: w, height: 16 };
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
