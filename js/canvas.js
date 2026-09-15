/* ==========================================================
   白板與圖片 (Graphs 邏輯)
   ========================================================== */

function getCurrentWorldCanvas() {
  const world = appData.worldviews.find(w => w.id === activeWorldId);
  if (!world.canvas) world.canvas = { nodes: [], edges: [] };
  return world.canvas;
}

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
    x: Math.max(20, Math.min(window.innerWidth - 220, 50 + (canvas.nodes.length * 25) % 250)),
    y: Math.max(70, Math.min(window.innerHeight - 150, 80 + (canvas.nodes.length * 35) % 300))
  });

  saveData();
  switchView('canvas');
}

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

    enableDualDrag(el, node);
    container.appendChild(el);
  });

  renderCanvasLines();
}

function enableDualDrag(element, nodeData) {
  let startX, startY, initialLeft, initialTop;

  // 共用的拖曳邏輯，滑鼠與觸控都會呼叫這三個函式
  function beginDrag(clientX, clientY) {
    startX = clientX; startY = clientY;
    initialLeft = nodeData.x; initialTop = nodeData.y;
  }
  function moveDrag(clientX, clientY) {
    nodeData.x = initialLeft + (clientX - startX);
    nodeData.y = initialTop + (clientY - startY);
    element.style.left = nodeData.x + "px";
    element.style.top = nodeData.y + "px";
    renderCanvasLines();
  }
  function endDrag() {
    saveData();
  }

  // 滑鼠（桌面版，原本邏輯不變）
  element.addEventListener("mousedown", function(e) {
    if (e.target.tagName === 'BUTTON') return;
    e.preventDefault();
    beginDrag(e.clientX, e.clientY);

    function onMouseMove(m) {
      moveDrag(m.clientX, m.clientY);
    }
    function onMouseUp() {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      endDrag();
    }
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  });

  // 觸控（手機版，新增）
  element.addEventListener("touchstart", function(e) {
    if (e.target.tagName === 'BUTTON') return;
    if (e.touches.length !== 1) return; // 只處理單指拖曳，避免跟雙指縮放/多指手勢衝突
    const touch = e.touches[0];
    beginDrag(touch.clientX, touch.clientY);

    function onTouchMove(t) {
      if (t.touches.length !== 1) return;
      // 關鍵：擋掉預設行為，否則手指在畫面上移動會被瀏覽器判定成「捲動整頁」
      // 而不是「拖曳節點」，這就是手機上完全拖不動的原因
      t.preventDefault();
      moveDrag(t.touches[0].clientX, t.touches[0].clientY);
    }
    function onTouchEnd() {
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchcancel", onTouchEnd);
      endDrag();
    }
    // passive:false 是必要的，因為要在 touchmove 裡呼叫 preventDefault()
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", onTouchEnd);
    window.addEventListener("touchcancel", onTouchEnd);
  }, { passive: true });
}

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
    }
    document.getElementById(connectingSourceNodeId)?.classList.remove("connecting");
    connectingSourceNodeId = null;
    renderCanvasLines();
  }
}

function renderCanvasLines() {
  const svg = document.getElementById("canvasSvg");
  svg.innerHTML = "";
  const canvas = getCurrentWorldCanvas();

  canvas.edges.forEach(function(edge) {
    const srcNode = canvas.nodes.find(n => n.id === edge.source);
    const tgtNode = canvas.nodes.find(n => n.id === edge.target);
    if (!srcNode || !tgtNode) return;

    const x1 = srcNode.x + 95;
    const y1 = srcNode.y + 40;
    const x2 = tgtNode.x + 95;
    const y2 = tgtNode.y + 40;

    const dx = (x2 - x1) * 0.3;
    const d = "M " + x1 + " " + y1 + " C " + (x1 + dx) + " " + y1 + ", " + (x2 - dx) + " " + y2 + ", " + x2 + " " + y2;

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    path.setAttribute("class", "relation-line");
    path.onclick = function() {
      const val = prompt("修改關係說明（留空刪除連線）：", edge.label);
      if (val === null) return;
      if (val.trim() === "") canvas.edges = canvas.edges.filter(e => e.id !== edge.id);
      else edge.label = val.trim();
      saveData();
      renderCanvasLines();
    };

    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;
    const textWidth = Math.max(edge.label.length * 13, 36);

    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
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

    g.appendChild(bgRect);
    g.appendChild(text);
    svg.appendChild(path);
    svg.appendChild(g);
  });
}

function setupCanvasEvents() {
  document.getElementById("canvasView").onclick = function(e) {
    if (!e.target.closest('.canvas-node')) {
      if (connectingSourceNodeId) {
        document.getElementById(connectingSourceNodeId)?.classList.remove("connecting");
        connectingSourceNodeId = null;
      }
    }
  };
}
