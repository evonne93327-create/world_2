/* ==========================================================
   白板與圖片 (Graphs 邏輯)
   含：縮放 / 平移 / 長按編輯關係 / 提示常駐 / 倍數指示
   ========================================================== */

const CANVAS_NODE_W = 200;

let zoomIndicatorTimer = null;

function getCurrentWorldCanvas() {
  const world = appData.worldviews.find(w => w.id === activeWorldId);
  if (!world.canvas) world.canvas = { nodes: [], edges: [] };
  return world.canvas;
}

/* ---------- 視圖變換工具 ---------- */

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
  applySvgTransform();
}

/* ---------- 提示：永遠顯示，不做任何隱藏 ---------- */

function dismissCanvasHint() {
  // 提示常駐顯示，不再隱藏
}

function applyCanvasHintVisibility() {
  const hint = document.querySelector(".canvas-hint-text");
  if (!hint) return;
  hint.classList.remove("is-hidden");
}

/* ---------- 倍數指示（1 秒後淡出） ---------- */

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
  if (!currentDoc) {
    alert("請先選擇或開啟一個文檔！");
    return;
  }

  const canvas = getCurrentWorldCanvas();
  const exists = canvas.nodes.find(n => n.docId === currentDoc.id);
  if (exists) {
    alert("此文檔已存在於當前白板！");
    switchView('canvas');
    return;
  }

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

  canvas.nodes.forEach(function(node) {
    const doc = appData.docs.find(d => d.id === node.docId);
    if (!doc) return;

    const el = document.createElement("div");
    el.className = "canvas-node";
    el.id = node.id;
    el.style.left = node.x + "px";
    el.style.top = node.y + "px";

    if (connectingSourceNodeId === node.id) {
      el.classList.add("connecting");
    }

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
      // 連線模式下雙擊不觸發開啟文檔
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

/* ---------- 套用 transform ---------- */

function applyCanvasTransform(silent) {
  const container = document.getElementById("canvasNodesContainer");
  if (!container) return;
  container.style.transformOrigin = "0 0";
  container.style.transform =
    "translate(" + canvasTransform.x + "px," + canvasTransform.y + "px) scale(" + canvasTransform.scale + ")";
  if (!silent) showZoomIndicator();
}

function applySvgTransform() {
  const svg = document.getElementById("canvasSvg");
  if (!svg) return;
  svg.style.transformOrigin = "0 0";
  svg.style.transform =
    "translate(" + canvasTransform.x + "px," + canvasTransform.y + "px) scale(" + canvasTransform.scale + ")";
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

  // 點擊節點：若處於連線模式，直接完成連線
  element.addEventListener("click", function(e) {
    if (pointerMoved) return;             // 拖曳過就不算點擊
    if (!connectingSourceNodeId) return;  // 非連線模式，什麼都不做
    e.stopPropagation();
    completeConnection(nodeData.id);
  });
}

/* ---------- 連線 ---------- */

function startConnect(nodeId) {
  if (connectingSourceNodeId === nodeId) {
    // 再點一次自己 = 取消連線模式
    cancelConnect();
    return;
  }
  connectingSourceNodeId = nodeId;
  // 更新所有節點的 connecting 樣式
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
  if (!sourceId || sourceId === targetNodeId) {
    cancelConnect();
    return;
  }
  const canvas = getCurrentWorldCanvas();
  const relation = prompt("請輸入兩者關係：", "盟友 / 敵對 / 密探");
  if (relation !== null) {
    canvas.edges.push({
      id: "edge_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
      source: sourceId,
      target: targetNodeId,
      label: relation || "關聯",
      color: "c_gray",     // 預設顏色
      dash: "solid",       // 預設樣式
      arrow: "none"        // 預設箭頭
    });
    saveData();
  }
  cancelConnect();
  renderCanvasLines();
}

/* ---------- 渲染連線 ---------- */

function renderCanvasLines() {
  const svg = document.getElementById("canvasSvg");
  svg.innerHTML = "";
  const canvas = getCurrentWorldCanvas();

  // 箭頭 marker 定義（每個顏色各一組，避免 marker 顏色無法動態套用）
  const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
  Object.keys(appData.colorPalette || DEFAULT_PALETTES).forEach(function(colorId) {
    const pal = (appData.colorPalette && appData.colorPalette[colorId]) || DEFAULT_PALETTES[colorId];
    const marker = document.createElementNS("http://www.w3.org/2000/svg", "marker");
    marker.setAttribute("id", "arrow_" + colorId);
    marker.setAttribute("viewBox", "0 0 10 10");
    marker.setAttribute("refX", "9");
    marker.setAttribute("refY", "5");
    marker.setAttribute("markerWidth", "6");
    marker.setAttribute("markerHeight", "6");
    marker.setAttribute("orient", "auto-start-reverse");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "M 0 0 L 10 5 L 0 10 z");
    path.setAttribute("fill", pal.text);
    marker.appendChild(path);
    defs.appendChild(marker);
  });
  svg.appendChild(defs);

  // 統計每一對 (source, target) 共有幾條邊
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
      if (total === 1) {
        offset = 0;
      } else {
        offset = (idx - (total - 1) / 2) / ((total - 1) / 2);
      }
      edgeOffsetMap[edge.id] = offset;
    });
  });

  canvas.edges.forEach(function(edge) {
    const srcNode = canvas.nodes.find(n => n.id === edge.source);
    const tgtNode = canvas.nodes.find(n => n.id === edge.target);
    if (!srcNode || !tgtNode) return;

    const x1 = srcNode.x + CANVAS_NODE_W / 2;
    const y1 = srcNode.y + 40;
    const x2 = tgtNode.x + CANVAS_NODE_W / 2;
    const y2 = tgtNode.y + 40;

    const dx = x2 - x1;
    const dy = y2 - y1;
    const dist = Math.hypot(dx, dy) || 1;

    const nx = -dy / dist;
    const ny = dx / dist;

    const offset = edgeOffsetMap[edge.id] || 0;
    const bendBase = Math.min(dist * 0.25, 90);
    const bend = offset * bendBase;

    // 依箭頭方向決定實際 path 的起訖點
    // arrow: "forward"  -> source → target
    // arrow: "backward" -> target → source（實際 path 反向繪製）
    // arrow: "none"     -> 無方向
    let px1 = x1, py1 = y1, px2 = x2, py2 = y2;
    if (edge.arrow === "backward") {
      px1 = x2; py1 = y2; px2 = x1; py2 = y1;
    }

    const pdx = px2 - px1;
    const pdy = py2 - py1;
    const pdist = Math.hypot(pdx, pdy) || 1;
    const pnx = -pdy / pdist;
    const pny = pdx / pdist;

    // 反向時 bend 也要跟著反向，避免弧線跑錯邊
    const realBend = (edge.arrow === "backward") ? -bend : bend;

    const cx1 = px1 + pdx * 0.25 + pnx * realBend;
    const cy1 = py1 + pdy * 0.25 + pny * realBend;
    const cx2 = px1 + pdx * 0.75 + pnx * realBend;
    const cy2 = py1 + pdy * 0.75 + pny * realBend;

    const d = "M " + px1 + " " + py1 + " C " + cx1 + " " + cy1 + ", " + cx2 + " " + cy2 + ", " + px2 + " " + py2;

    const colorId = edge.color || "c_gray";
    const pal = (appData.colorPalette && appData.colorPalette[colorId]) || DEFAULT_PALETTES[colorId];

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    path.setAttribute("class", "relation-line");
    path.style.stroke = pal.text;
    path.style.pointerEvents = "none";

    // 線條樣式
    const dash = edge.dash || "solid";
    if (dash === "dashed") path.setAttribute("stroke-dasharray", "10 6");
    else if (dash === "dotted") path.setAttribute("stroke-dasharray", "2 6");
    path.setAttribute("stroke-linecap", "round");

    // 箭頭
    const arrow = edge.arrow || "none";
    if (arrow === "forward") {
      path.setAttribute("marker-end", "url(#arrow_" + colorId + ")");
    } else if (arrow === "backward") {
      path.setAttribute("marker-end", "url(#arrow_" + colorId + ")");
    }

    // 標籤位置：取曲線中點（考慮反向時的 bend）
    const midX = (px1 + px2) / 2 + pnx * realBend;
    const midY = (py1 + py2) / 2 + pny * realBend;
    const textWidth = Math.max((edge.label || '').length * 13, 36);

    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.style.pointerEvents = "all";
    g.style.cursor = "pointer";

    const bgRect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    bgRect.setAttribute("x", midX - textWidth / 2);
    bgRect.setAttribute("y", midY - 11);
    bgRect.setAttribute("width", textWidth);
    bgRect.setAttribute("height", 22);
    bgRect.setAttribute("class", "line-label-bg");
    bgRect.style.stroke = pal.text;

    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", midX);
    text.setAttribute("y", midY);
    text.setAttribute("class", "line-label-box");
    text.textContent = edge.label;

    g.addEventListener("contextmenu", function(e) {
      e.preventDefault();
      e.stopPropagation();
      openEdgeEditModal(edge.id);
    });

    attachLongPressToSvgGroup(g, function() { openEdgeEditModal(edge.id); });

    g.appendChild(bgRect);
    g.appendChild(text);
    svg.appendChild(path);
    svg.appendChild(g);
  });

  applySvgTransform();
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

  // 顏色 chips
  const colorRow = document.getElementById("edgeColorRow");
  colorRow.innerHTML = "";
  const currentColor = edge.color || "c_gray";
  Object.keys(DEFAULT_PALETTES).forEach(function(colorId) {
    const pal = (appData.colorPalette && appData.colorPalette[colorId]) || DEFAULT_PALETTES[colorId];
    const chip = document.createElement("div");
    chip.className = "edge-color-chip" + (colorId === currentColor ? " active" : "");
    chip.style.background = pal.bg;
    chip.style.borderColor = colorId === currentColor ? pal.text : "transparent";
    chip.title = pal.name;
    chip.onclick = function() {
      colorRow.querySelectorAll(".edge-color-chip").forEach(c => {
        c.classList.remove("active");
        c.style.borderColor = "transparent";
      });
      chip.classList.add("active");
      chip.style.borderColor = pal.text;
    };
    colorRow.appendChild(chip);
  });

  // 線條樣式
  const dashRow = document.getElementById("edgeStyleRow");
  const currentDash = edge.dash || "solid";
  dashRow.querySelectorAll(".edge-opt-btn").forEach(function(btn) {
    btn.classList.toggle("active", btn.getAttribute("data-dash") === currentDash);
    btn.onclick = function() {
      dashRow.querySelectorAll(".edge-opt-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
    };
  });

  // 箭頭
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

  // 顏色
  const activeColorChip = document.querySelector("#edgeColorRow .edge-color-chip.active");
  if (activeColorChip) {
    // 從 title 反查 colorId
    const title = activeColorChip.title;
    const foundId = Object.keys(DEFAULT_PALETTES).find(k => {
      const pal = (appData.colorPalette && appData.colorPalette[k]) || DEFAULT_PALETTES[k];
      return pal.name === title;
    });
    if (foundId) edge.color = foundId;
  }

  // 樣式
  const activeDash = document.querySelector("#edgeStyleRow .edge-opt-btn.active");
  if (activeDash) edge.dash = activeDash.getAttribute("data-dash");

  // 箭頭
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

/* ---------- 白板事件：縮放 + 平移 ---------- */

function setupCanvasEvents() {
  const view = document.getElementById("canvasView");
  const svg = document.getElementById("canvasSvg");

  view.onclick = function(e) {
    if (!e.target.closest('.canvas-node')) {
      // 點空白處：取消連線模式
      if (connectingSourceNodeId) cancelConnect();
    }
  };

  /* ===== 桌面：滾輪縮放 =====
     支援三種觸發方式：
       1. 一般滑鼠滾輪（無 Ctrl）
       2. Ctrl + 滾輪（Windows / Linux 使用者習慣）
       3. Mac 觸控板雙指捏合（瀏覽器會送 ctrlKey=true 的 wheel 事件）
     全部走同一段邏輯，不需要另外區分。 */
  view.addEventListener("wheel", function(e) {
    if (e.target.closest('.canvas-floating-actions')) return;

    // 一定要 preventDefault，否則 Ctrl+滾輪會被瀏覽器拿去縮放整頁
    e.preventDefault();

    const rect = view.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    // Ctrl 按住時 deltaY 通常較小，給一點補償倍率讓手感一致
    const factor = e.ctrlKey ? 0.003 : 0.0015;
    const zoomFactor = Math.exp(-e.deltaY * factor);
    const newScale = clampScale(canvasTransform.scale * zoomFactor);
    if (newScale === canvasTransform.scale) return;

    const worldBefore = screenToWorld(mx, my);
    canvasTransform.scale = newScale;
    canvasTransform.x = mx - worldBefore.x * newScale;
    canvasTransform.y = my - worldBefore.y * newScale;

    applyCanvasTransform();
    applySvgTransform();
  }, { passive: false });

  /* ===== 桌面：拖曳空白平移 ===== */
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
      applySvgTransform();
    }
    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  });

  /* ===== 手機：單指拖空白平移 + 雙指 pinch 縮放 ===== */
  setupTouchPanZoom(view, svg);

  svg.style.touchAction = "none";
  view.style.touchAction = "none";
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

      if (onSvgChild) {
        mode = null;
        return;
      }
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
      applySvgTransform();
    } else if (mode === 'pan' && e.touches.length === 1) {
      e.preventDefault();
      const dx = e.touches[0].clientX - panStartX;
      const dy = e.touches[0].clientY - panStartY;
      canvasTransform.x = panInitX + dx;
      canvasTransform.y = panInitY + dy;
      applyCanvasTransform();
      applySvgTransform();
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
