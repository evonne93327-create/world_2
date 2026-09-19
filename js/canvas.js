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

/* ---------- 渲染節點 ---------- */

function renderCanvas() {
  const container = document.getElementById("canvasNodesContainer");
  container.innerHTML = "";
  const canvas = getCurrentWorldCanvas();
  applySvgViewBox();

  canvas.nodes.forEach(function(node) {
    const doc = appData.docs.find(d => d.id === node.docId);
    if (!doc) return;

    const el = document.createElement("div");
    el.className = "canvas-node";
    el.id = node.id;
    el.style.left = node.x + "px";
    el.style.top = node.y + "px";

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
    container.appendChild(el);
  });

  applyCanvasTransform(true);
  renderCanvasLines();
}

/* ---------- 節點定位 ---------- */

function applyCanvasTransform(silent) {
  const container = document.getElementById("canvasNodesContainer");
  if (!container) return;
  container.style.transformOrigin = "0 0";
  container.style.transform =
    "translate(" + canvasTransform.x + "px," + canvasTransform.y + "px) scale(" + canvasTransform.scale + ")";
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
    element.style.left = nodeData.x + "px";
    element.style.top = nodeData.y + "px";
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

/* ---------- 節點邊框交點（沿該邊 30%~70% 分散）---------- */
function getNodeBorderPoint(node, targetX, targetY, slotInfo) {
  const el = document.getElementById(node.id);
  let w, h;
  if (el) {
    w = el.offsetWidth || CANVAS_NODE_W;
    h = el.offsetHeight || 80;
  } else {
    w = CANVAS_NODE_W;
    h = 80;
  }

  const cx = node.x + w / 2;
  const cy = node.y + h / 2;

  const dx = targetX - cx;
  const dy = targetY - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy, t: 0.5, side: 'right' };

  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);

  // 用「相對於自己長寬」的比例來判斷要接哪一邊，而不是直接比較 dx、dy 的絕對值。
  // 這樣長方形節點對角線方向的連線，即使角度差不多，寬的節點還是偏好接上/下（長邊），
  // 窄的節點偏好接左/右（短邊）——兩端不用被迫接同一種邊（都水平或都垂直）。
  const halfW = w / 2 + 2;
  const halfH = h / 2 + 2;

  let side;
  if (absDx / halfW >= absDy / halfH) side = dx > 0 ? 'right' : 'left';
  else side = dy > 0 ? 'bottom' : 'top';

  // 分散範圍 0.3 ~ 0.7（依你指定）：用「跟兩節點連心線垂直方向同向還是反向」（os）
  // 決定往哪邊分散，而不是單純照 index 遞增排 —— 這樣就算兩端接的是不同種邊
  // （一個上/下、一個左/右，長邊接短邊時常發生），排列順序在空間中還是對得起來，不會互相穿越。
  let t = 0.5;
  let os = 1;
  if (slotInfo && slotInfo.total > 1) {
    const axisX = (side === 'bottom' || side === 'top') ? 1 : 0;
    const axisY = axisX ? 0 : 1;
    const pnx = typeof slotInfo.pnx === 'number' ? slotInfo.pnx : 0;
    const pny = typeof slotInfo.pny === 'number' ? slotInfo.pny : 0;
    os = (axisX * pnx + axisY * pny) >= 0 ? 1 : -1;

    const hi = 0.7;
    const posOffset = (slotInfo.index - (slotInfo.total - 1) / 2) / ((slotInfo.total - 1) / 2); // -1..1
    t = 0.5 + os * posOffset * (hi - 0.5);
  }

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

  return { x: px, y: py, t: t, side: side, os: os };
}

/* ---------- 渲染連線 ---------- */

function renderCanvasLines() {
  const svg = document.getElementById("canvasSvg");
  svg.innerHTML = "";
  const canvas = getCurrentWorldCanvas();
  const NS = "http://www.w3.org/2000/svg";

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
  svg.appendChild(defs);

  const linesLayer = document.createElementNS(NS, "g");
  svg.appendChild(linesLayer);

  const labelsLayer = document.createElementNS(NS, "g");
  svg.appendChild(labelsLayer);

  /* ---------- 決定側邊 ---------- */
  // 跟 getNodeBorderPoint 用同一套「相對長寬比例」判斷法，確保這裡算出來的側邊
  // 跟實際畫連線用的側邊一致（不然分散順序跟彎曲方向會對不上）
  function determineSide(node, otherCenter) {
    const el = document.getElementById(node.id);
    const w = el ? el.offsetWidth : CANVAS_NODE_W;
    const h = el ? el.offsetHeight : 80;
    const cx = node.x + w / 2;
    const cy = node.y + h / 2;
    const dx = otherCenter.x - cx;
    const dy = otherCenter.y - cy;
    const halfW = w / 2 + 2;
    const halfH = h / 2 + 2;
    if (Math.abs(dx) / halfW >= Math.abs(dy) / halfH) return dx > 0 ? 'right' : 'left';
    return dy > 0 ? 'bottom' : 'top';
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

    const srcEl = document.getElementById(srcNode.id);
    const tgtEl = document.getElementById(tgtNode.id);
    const srcW = srcEl ? srcEl.offsetWidth : CANVAS_NODE_W;
    const srcH = srcEl ? srcEl.offsetHeight : 80;
    const tgtW = tgtEl ? tgtEl.offsetWidth : CANVAS_NODE_W;
    const tgtH = tgtEl ? tgtEl.offsetHeight : 80;

    const srcCenter = { x: srcNode.x + srcW / 2, y: srcNode.y + srcH / 2 };
    const tgtCenter = { x: tgtNode.x + tgtW / 2, y: tgtNode.y + tgtH / 2 };

    const srcSide = determineSide(srcNode, tgtCenter);
    const tgtSide = determineSide(tgtNode, srcCenter);

    // 兩節點連心線的垂直方向，整組（同一對節點）共用同一個值，
    // 用來判斷「邊框分散軸」實際上是跟這個方向同向還是反向 —— 這是斜向、
    // 兩端接不同種邊（一個上/下、一個左/右）時，避免線互相穿越的關镵。
    const cdx = tgtCenter.x - srcCenter.x;
    const cdy = tgtCenter.y - srcCenter.y;
    const cdist = Math.hypot(cdx, cdy) || 1;
    const pnx = -cdy / cdist;
    const pny = cdx / cdist;

    edgeSideInfo[edge.id] = { sourceSide: srcSide, targetSide: tgtSide, pnx: pnx, pny: pny };

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
    // 把這條邊自己的「連心線垂直方向」一併帶給兩端的 slot，
    // 讓 getNodeBorderPoint 能各自判斷邊框分散軸跟這個方向是同向還是反向
    sSlot.pnx = info.pnx; sSlot.pny = info.pny;
    tSlot.pnx = info.pnx; tSlot.pny = info.pny;

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
      // 同一組線全部往同一個方向彎，彎曲幅度隨順序遞增（0 ~ 1），
      // 而不是從中間對稱往兩側展開；這樣一組線裡只有最後一條會
      // 大幅度繞出去，其餘幾條會靠在一起、貼近直線路徑。
      const offset = total === 1 ? 0 : idx / (total - 1); // 0 .. 1
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
    const p1 = getNodeBorderPoint(srcNode, tgtCenter.x, tgtCenter.y, slot.sourceSlot);
    const p2 = getNodeBorderPoint(tgtNode, srcCenter.x, srcCenter.y, slot.targetSlot);

    const x1 = p1.x, y1 = p1.y;
    const x2 = p2.x, y2 = p2.y;

    const dx = x2 - x1;
    const dy = y2 - y1;
    const dist = Math.hypot(dx, dy) || 1;

    /* ----- 弧度：用 offset 強制給定 ----- */
    // 同一對節點只有一條線時維持直線。
    // 多條線時（offset = 0 ~ 1，依順序遞增），彎曲幅度統一往同一個方向
    // 從 0 線性增加到 maxBend 的 0.7 倍：第一條幾乎貼著直線，最後一條彎最多。
    const maxBend = Math.min(dist * 0.28, 90);
    const total = edgeGroupTotalMap[edge.id] || 1;
    const offset = edgeOffsetMap[edge.id] || 0;

    let bendMag = 0;
    let srcSpreadX = 0, srcSpreadY = 0;
    let tgtSpreadX = 0, tgtSpreadY = 0;
    if (total > 1) {
      const BEND_MAX_RATIO = 0.7;
      bendMag = BEND_MAX_RATIO * offset * maxBend;

      // 彎曲方向要跟「這條線在節點邊框上排列的分散軸」完全同步，
      // 而且兩端要各自用自己那端的分散軸、各自的 os（跟連心線垂直方向同向還是反向）。
      // 長邊接短邊時，兩端的分散軸不一樣（一個水平、一個垂直），
      // 只用單一邊的方向兩端一起套，線在中途還是會互相穿越。
      // 上/下側：邊框上是左右排開 → 分散軸是水平（x）
      // 左/右側：邊框上是上下排開 → 分散軸是垂直（y）
      const srcSide = (edgeSideInfo[edge.id] || {}).sourceSide;
      const tgtSide = (edgeSideInfo[edge.id] || {}).targetSide;
      const srcOs = typeof p1.os === 'number' ? p1.os : 1;
      const tgtOs = typeof p2.os === 'number' ? p2.os : 1;

      if (srcSide === 'bottom' || srcSide === 'top') srcSpreadX = srcOs;
      else srcSpreadY = srcOs;

      if (tgtSide === 'bottom' || tgtSide === 'top') tgtSpreadX = tgtOs;
      else tgtSpreadY = tgtOs;
    }

    const ext1 = dist * 0.35;
    const ext2 = dist * 0.35;

    const cx1 = x1 + (dx / dist) * ext1 + srcSpreadX * bendMag;
    const cy1 = y1 + (dy / dist) * ext1 + srcSpreadY * bendMag;

    const cx2 = x2 - (dx / dist) * ext2 + tgtSpreadX * bendMag;
    const cy2 = y2 - (dy / dist) * ext2 + tgtSpreadY * bendMag;

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
