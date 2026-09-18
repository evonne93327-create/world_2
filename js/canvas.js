/* ==========================================================
   白板與圖片 (Graphs 邏輯)
   含：縮放 / 平移 / 長按編輯關係 / 提示自動隱藏
   ========================================================== */

const CANVAS_NODE_W = 200;   // 節點寬度（給連線端點計算用）

function getCurrentWorldCanvas() {
  const world = appData.worldviews.find(w => w.id === activeWorldId);
  if (!world.canvas) world.canvas = { nodes: [], edges: [] };
  return world.canvas;
}

/* ---------- 視圖變換工具 ---------- */

// 世界座標 → 螢幕座標
function worldToScreen(wx, wy) {
  return {
    x: wx * canvasTransform.scale + canvasTransform.x,
    y: wy * canvasTransform.scale + canvasTransform.y
  };
}

// 螢幕座標 → 世界座標
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

/* ---------- 提示隱藏 ---------- */

function dismissCanvasHint() {
  if (canvasHintDismissed) return;
  canvasHintDismissed = true;
  localStorage.setItem("worldbuilder_canvas_hint_dismissed", "1");
  applyCanvasHintVisibility();
}

function applyCanvasHintVisibility() {
  const hint = document.querySelector(".canvas-hint-text");
  if (!hint) return;
  hint.classList.toggle("is-hidden", canvasHintDismissed);
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

    const title = (doc.icon || '📄') + " " + (doc.title || "無標題文檔");
    const preview = (doc.content || "").replace(/\n/g, " ");

    let imgHtml = "";
    if (doc.images && doc.images.length > 0) {
      imgHtml = '<img style="width:100%; height:75px; object-fit:cover; border-radius:4px; margin-bottom:6px;" src="' + doc.images[0] + '">';
    }

    el.innerHTML =
      '<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">' +
        '<span style="font-size:12px; font-weight:700; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:130px;">' + escapeHtml(title) + '</span>' +
        '<button style="border-radius:50%; width:22px; height:22px; border:1px solid var(--border); background:#fff; cursor:pointer;" onclick="startConnect(\'' + node.id + '\', event)">🔗</button>' +
      '</div>' +
      imgHtml +
      '<div style="font-size:11px; color:var(--text-secondary); line-height:1.4; max-height:32px; overflow:hidden; margin-bottom:4px;">' + escapeHtml(preview) + '</div>' +
      '<div style="font-size:10px; color:var(--text-muted); text-align:right;">' + (doc.wordCount || 0) + ' 字</div>';

    el.ondblclick = function() {
      loadDocToEditor(doc.id);
      switchView('editor');
    };

    // 節點右鍵（桌面）/ 長按（手機）→ 節點選單
    attachContextMenu(
      el,
      function() { return buildCanvasNodeMenuItems(node, doc); },
      function() { return (doc.icon || '📄') + ' ' + (doc.title || '無標題文檔'); }
    );

    enableDualDrag(el, node);
    container.appendChild(el);
  });

  applyCanvasTransform();
  renderCanvasLines();
}

/* ---------- 套用 transform ---------- */

function applyCanvasTransform() {
  const container = document.getElementById("canvasNodesContainer");
  if (!container) return;
  container.style.transformOrigin = "0 0";
  container.style.transform =
    "translate(" + canvasTransform.x + "px," + canvasTransform.y + "px) scale(" + canvasTransform.scale + ")";
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

  function beginDrag(clientX, clientY) {
    dragging = true;
    startX = clientX; startY = clientY;
    initialLeft = nodeData.x; initialTop = nodeData.y;
  }
  function moveDrag(clientX, clientY) {
    nodeData.x = initialLeft + (clientX - startX) / canvasTransform.scale;
    nodeData.y = initialTop + (clientY - startY) / canvasTransform.scale;
    element.style.left = nodeData.x + "px";
    element.style.top = nodeData.y + "px";
    renderCanvasLines();
  }
  function endDrag() {
    if (!dragging) return;
    dragging = false;
    saveData();
    dismissCanvasHint();
  }

  // 滑鼠
  element.addEventListener("mousedown", function(e) {
    if (e.target.tagName === 'BUTTON') return;
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

  // 觸控（單指拖節點；雙指交給白板 pinch）
  element.addEventListener("touchstart", function(e) {
    if (e.target.tagName === 'BUTTON') return;
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
}

/* ---------- 連線 ---------- */

function startConnect(nodeId, event) {
  event.stopPropagation();
  const nodeEl = document.getElementById(nodeId);
  const canvas = getCurrentWorldCanvas();

  if (!connectingSourceNodeId) {
    connectingSourceNodeId = nodeId;
    nodeEl.classList.add("connecting");
  } else if (connectingSourceNodeId === nodeId) {
    connectingSourceNodeId = null;
    nodeEl.classList.remove("connecting");
  } else {
    const relation = prompt("請輸入兩者關係：", "盟友 / 敵對 / 密探");
    if (relation !== null) {
      canvas.edges.push({
        id: "edge_" + Date.now(),
        source: connectingSourceNodeId,
        target: nodeId,
        label: relation || "關聯"
      });
      saveData();
      dismissCanvasHint();
    }
    document.getElementById(connectingSourceNodeId)?.classList.remove("connecting");
    connectingSourceNodeId = null;
    renderCanvasLines();
  }
}

/* ---------- 渲染連線 ---------- */

function renderCanvasLines() {
  const svg = document.getElementById("canvasSvg");
  svg.innerHTML = "";
  const canvas = getCurrentWorldCanvas();

  canvas.edges.forEach(function(edge) {
    const srcNode = canvas.nodes.find(n => n.id === edge.source);
    const tgtNode = canvas.nodes.find(n => n.id === edge.target);
    if (!srcNode || !tgtNode) return;

    const x1 = srcNode.x + CANVAS_NODE_W / 2;
    const y1 = srcNode.y + 40;
    const x2 = tgtNode.x + CANVAS_NODE_W / 2;
    const y2 = tgtNode.y + 40;

    const dx = (x2 - x1) * 0.3;
    const d = "M " + x1 + " " + y1 + " C " + (x1 + dx) + " " + y1 + ", " + (x2 - dx) + " " + y2 + ", " + x2 + " " + y2;

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    path.setAttribute("class", "relation-line");
    path.style.pointerEvents = "stroke";
    path.onclick = function(e) {
      e.stopPropagation();
      openEdgeEditModal(edge.id);
    };

    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;
    const textWidth = Math.max((edge.label || '').length * 13, 36);

    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.style.pointerEvents = "all";

    const bgRect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    bgRect.setAttribute("x", midX - textWidth / 2);
    bgRect.setAttribute("y", midY - 11);
    bgRect.setAttribute("width", textWidth);
    bgRect.setAttribute("height", 22);
    bgRect.setAttribute("class", "line-label-bg");

    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", midX);
    text.setAttribute("y", midY);
    text.setAttribute("class", "line-label-box");
    text.textContent = edge.label;

    // 點擊標籤 → 編輯；右鍵 → 編輯；長按 → 編輯
    g.style.cursor = "pointer";
    g.onclick = function(e) { e.stopPropagation(); openEdgeEditModal(edge.id); };
    g.oncontextmenu = function(e) { e.preventDefault(); e.stopPropagation(); openEdgeEditModal(edge.id); };
    attachLongPressToSvgGroup(g, function() { openEdgeEditModal(edge.id); });

    g.appendChild(bgRect);
    g.appendChild(text);
    svg.appendChild(path);
    svg.appendChild(g);
  });

  applySvgTransform();
}

// 給 SVG <g> 用的長按偵測（手機）
function attachLongPressToSvgGroup(gEl, callback) {
  let timer = null, fired = false, sx = 0, sy = 0;
  const DURATION = 480, TOL = 10;

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
        if (connectingSourceNodeId) {
          document.getElementById(connectingSourceNodeId)?.classList.remove("connecting");
        }
        connectingSourceNodeId = node.id;
        document.getElementById(node.id)?.classList.add("connecting");
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

  // 點空白處：取消連線模式
  view.onclick = function(e) {
    if (!e.target.closest('.canvas-node')) {
      if (connectingSourceNodeId) {
        document.getElementById(connectingSourceNodeId)?.classList.remove("connecting");
        connectingSourceNodeId = null;
      }
    }
  };

  /* ===== 桌面：滾輪縮放（以滑鼠位置為中心） ===== */
  view.addEventListener("wheel", function(e) {
    if (e.target.closest('.canvas-bar')) return;
    e.preventDefault();
    const rect = view.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const zoomFactor = Math.exp(-e.deltaY * 0.0015);
    const newScale = clampScale(canvasTransform.scale * zoomFactor);
    if (newScale === canvasTransform.scale) return;

    const worldBefore = screenToWorld(mx, my);
    canvasTransform.scale = newScale;
    canvasTransform.x = mx - worldBefore.x * newScale;
    canvasTransform.y = my - worldBefore.y * newScale;

    applyCanvasTransform();
    applySvgTransform();
    dismissCanvasHint();
  }, { passive: false });

  /* ===== 桌面：拖曳空白平移 ===== */
  view.addEventListener("mousedown", function(e) {
    if (e.button !== 0) return;
    if (e.target.closest('.canvas-node')) return;
    if (e.target.closest('.canvas-bar')) return;
    // 點在 SVG 的線或標籤上：不啟動平移（交給它自己的點擊）
    if (e.target.closest('svg') && e.target.tagName !== 'svg') return;

    e.preventDefault();
    const startX = e.clientX, startY = e.clientY;
    const initX = canvasTransform.x, initY = canvasTransform.y;
    let moved = false;

    function onMove(m) {
      const dx = m.clientX - startX;
      const dy = m.clientY - startY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
      canvasTransform.x = initX + dx;
      canvasTransform.y = initY + dy;
      applyCanvasTransform();
      applySvgTransform();
    }
    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      if (moved) dismissCanvasHint();
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
  let mode = null;           // 'pan' | 'pinch' | null
  let panStartX = 0, panStartY = 0, panInitX = 0, panInitY = 0;
  let pinchStartDist = 0, pinchStartScale = 1, pinchWorldCenter = null;
  let moved = false;

  function getTouchCenter(t1, t2) {
    return { x: (t1.clientX + t2.clientX) / 2, y: (t1.clientY + t2.clientY) / 2 };
  }
  function getTouchDist(t1, t2) {
    return Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
  }

  view.addEventListener("touchstart", function(e) {
    if (e.target.closest('.canvas-bar')) return;
    const onNode = !!e.target.closest('.canvas-node');

    if (e.touches.length === 2) {
      mode = 'pinch';
      moved = true;
      pinchStartDist = getTouchDist(e.touches[0], e.touches[1]);
      pinchStartScale = canvasTransform.scale;
      const rect = view.getBoundingClientRect();
      const center = getTouchCenter(e.touches[0], e.touches[1]);
      pinchWorldCenter = screenToWorld(center.x - rect.left, center.y - rect.top);
      e.preventDefault();
    } else if (e.touches.length === 1 && !onNode) {
      mode = 'pan';
      moved = false;
      panStartX = e.touches[0].clientX;
      panStartY = e.touches[0].clientY;
      panInitX = canvasTransform.x;
      panInitY = canvasTransform.y;
    } else {
      mode = null;
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
      dismissCanvasHint();
    } else if (mode === 'pan' && e.touches.length === 1) {
      e.preventDefault();
      const dx = e.touches[0].clientX - panStartX;
      const dy = e.touches[0].clientY - panStartY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
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
        dismissCanvasHint();
      }
    } else if (mode === 'pan' && e.touches.length === 0) {
      mode = null;
      if (moved) dismissCanvasHint();
    }
  }
  view.addEventListener("touchend", endTouch);
  view.addEventListener("touchcancel", endTouch);
}
