/* ==========================================================
   文檔編輯與狀態
   ========================================================== */

function isChapterHeadingLine(trimmedLine) {
  return MARKDOWN_HEADING_REGEX.test(trimmedLine) || CHAPTER_LINE_REGEX.test(trimmedLine);
}

function extractHashtagsFromLine(line) {
  const trimmed = line.trim();
  if (isChapterHeadingLine(trimmed)) return [];
  const tags = [];
  const tagRegex = /#([^\s#]+)/g;
  let m;
  while ((m = tagRegex.exec(line)) !== null) {
    const t = m[1].trim();
    if (t) tags.push(t);
  }
  return tags;
}

function extractHashtagsFromText(text) {
  const result = [];
  (text || "").split("\n").forEach(function(line) {
    extractHashtagsFromLine(line).forEach(function(t) {
      if (!result.includes(t)) result.push(t);
    });
  });
  return result;
}

function loadDocToEditor(docId) {
  flushPendingContentPersist();
  activeDocId = docId;
  const doc = appData.docs.find(d => d.id === docId);
  if (!doc) return;

  document.getElementById("docIconBtn").textContent = doc.icon || "📄";
  document.getElementById("docTitleInput").value = doc.title || "";
  document.getElementById("docContentInput").value = doc.content || "";
  document.getElementById("statWordCount").textContent = doc.wordCount || 0;
  document.getElementById("statUpdatedAt").textContent = doc.updatedAt || "--";
  autoGrowTextarea(document.getElementById("docContentInput"));

  renderBreadcrumb();
  renderTOC(doc.content || "");
  renderLiveHashtags(doc.tags || []);
  renderDocImages(doc.images || []);
  renderSidebarTree();
  closeQuickJumpPanel();

  ensureDocHistory(doc.id, doc.content || "");
}

function onTitleChange() {
  const doc = appData.docs.find(d => d.id === activeDocId);
  if (!doc) return;
  doc.title = document.getElementById("docTitleInput").value;
  doc.updatedAt = formatTime(new Date());
  document.getElementById("statUpdatedAt").textContent = doc.updatedAt;
  saveData();
  renderSidebarTree();
  renderBreadcrumb();
  if (document.getElementById("quickJumpPanel").classList.contains("active")) {
    document.getElementById("quickJumpDocTitle").textContent = doc.title || "未命名文檔";
    document.getElementById("quickJumpUpdatedAt").textContent = doc.updatedAt || "--";
  }
}

function recomputeDocFromContent(doc, text) {
  const cjk = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const eng = (text.replace(/[\u4e00-\u9fa5]/g, ' ').match(/\b[a-zA-Z0-9_]+\b/g) || []).length;
  doc.wordCount = cjk + eng;

  if (!Array.isArray(doc.manualTags)) doc.manualTags = [];
  const textTags = extractHashtagsFromText(text);
  const mergedTags = textTags.slice();
  doc.manualTags.forEach(function(t) {
    if (!mergedTags.includes(t)) mergedTags.push(t);
  });
  doc.tags = mergedTags;

  doc.tags.forEach(function(t) {
    if (!appData.tagSettings[t]) appData.tagSettings[t] = "c_gray";
  });
}

function onContentChange() {
  const doc = appData.docs.find(d => d.id === activeDocId);
  if (!doc) return;

  const textarea = document.getElementById("docContentInput");
  const text = textarea.value;
  doc.content = text;
  autoGrowTextarea(textarea);

  if (!document.getElementById("docTitleInput").value.trim()) {
    const firstLine = text.trim().split("\n")[0] || "";
    doc.title = firstLine.substring(0, 24);
  }

  recomputeDocFromContent(doc, text);
  document.getElementById("statWordCount").textContent = doc.wordCount;

  doc.updatedAt = formatTime(new Date());
  document.getElementById("statUpdatedAt").textContent = doc.updatedAt;

  renderBreadcrumb();
  renderTOC(text);
  renderLiveHashtags(doc.tags);
  if (document.getElementById("quickJumpPanel").classList.contains("active")) {
    renderQuickJumpList(text);
    document.getElementById("quickJumpWordCount").textContent = doc.wordCount;
    document.getElementById("quickJumpUpdatedAt").textContent = doc.updatedAt;
  }

  scheduleContentPersist(doc.id, text);
}

function autoGrowTextarea(el) {
  if (!el) return;
  // 「先歸零高度、再用 scrollHeight 量出真正需要的高度」這招本身沒問題，但每次量測都要
  // 先把 textarea 縮回瀏覽器預設高度（很矮，例如只有 2 行）才能重新量測，這一瞬間
  // .editor-content-area 能捲動的範圍會跟著大幅變小；如果當下已經捲到比較下面（例如
  // 內文長到第 10 行左右、畫面容不下、已經自動往下捲來跟著游標），瀏覽器會在這個縮小的
  // 瞬間把捲動位置強制夾回新的（很小的）上限，通常就是最頂端——textarea 隨後雖然馬上
  // 撐回原本高度，但被夾掉的捲動位置不會自動復原，畫面就會像「打字/貼上打到某個位置
  // 就自動跳回最上面」。這裡在量測前後記住／還原 .editor-content-area 的 scrollTop，
  // 把這個副作用抵銷掉。
  const scrollContainer = document.querySelector(".editor-content-area");
  const prevScrollTop = scrollContainer ? scrollContainer.scrollTop : null;

  el.style.height = "auto";
  el.style.height = el.scrollHeight + "px";

  if (scrollContainer && prevScrollTop !== null) {
    scrollContainer.scrollTop = prevScrollTop;
  }
}

function scheduleContentPersist(docId, text) {
  pendingPersistInfo = { docId: docId, text: text };

  if (contentPersistTimer) clearTimeout(contentPersistTimer);
  contentPersistTimer = setTimeout(function() {
    contentPersistTimer = null;
    flushPendingContentPersist();
  }, 400);

  if (!historySnapshotTimer) {
    historySnapshotTimer = setTimeout(function() {
      historySnapshotTimer = null;
      if (pendingPersistInfo) {
        pushHistorySnapshot(pendingPersistInfo.docId, pendingPersistInfo.text);
      }
    }, HISTORY_SNAPSHOT_THROTTLE_MS);
  }
}

function flushPendingContentPersist() {
  const hadPending = !!contentPersistTimer || !!historySnapshotTimer;

  if (contentPersistTimer) {
    clearTimeout(contentPersistTimer);
    contentPersistTimer = null;
  }
  if (historySnapshotTimer) {
    clearTimeout(historySnapshotTimer);
    historySnapshotTimer = null;
  }
  if (!hadPending) return;

  if (pendingPersistInfo) {
    pushHistorySnapshot(pendingPersistInfo.docId, pendingPersistInfo.text);
    pendingPersistInfo = null;
  }
  saveData();
  renderSidebarTree();
}

function ensureDocHistory(docId, content) {
  if (!docHistory[docId]) {
    docHistory[docId] = { stack: [content], index: 0 };
  }
  updateUndoRedoButtons(docId);
}

function pushHistorySnapshot(docId, content) {
  const h = docHistory[docId];
  if (!h) return;
  if (h.stack[h.index] === content) return;

  h.stack = h.stack.slice(0, h.index + 1);
  h.stack.push(content);
  h.index = h.stack.length - 1;

  if (h.stack.length > DOC_HISTORY_LIMIT) {
    h.stack.splice(1, 1);
    h.index--;
  }

  if (docId === activeDocId) updateUndoRedoButtons(docId);
}

function applyHistorySnapshot(doc, content) {
  doc.content = content;
  const textarea = document.getElementById("docContentInput");
  textarea.value = content;
  autoGrowTextarea(textarea);

  recomputeDocFromContent(doc, content);
  doc.updatedAt = formatTime(new Date());
  document.getElementById("statWordCount").textContent = doc.wordCount;
  document.getElementById("statUpdatedAt").textContent = doc.updatedAt;

  renderBreadcrumb();
  renderTOC(content);
  renderLiveHashtags(doc.tags);
  renderSidebarTree();
  if (document.getElementById("quickJumpPanel").classList.contains("active")) {
    renderQuickJumpList(content);
    document.getElementById("quickJumpWordCount").textContent = doc.wordCount;
    document.getElementById("quickJumpUpdatedAt").textContent = doc.updatedAt;
  }

  saveData();
}

function undoDocContent() {
  flushPendingContentPersist();
  const doc = appData.docs.find(d => d.id === activeDocId);
  if (!doc) return;
  const h = docHistory[doc.id];
  if (!h || h.index <= 0) return;

  h.index--;
  applyHistorySnapshot(doc, h.stack[h.index]);
  updateUndoRedoButtons(doc.id);
}

function redoDocContent() {
  flushPendingContentPersist();
  const doc = appData.docs.find(d => d.id === activeDocId);
  if (!doc) return;
  const h = docHistory[doc.id];
  if (!h || h.index >= h.stack.length - 1) return;

  h.index++;
  applyHistorySnapshot(doc, h.stack[h.index]);
  updateUndoRedoButtons(doc.id);
}

function updateUndoRedoButtons(docId) {
  const undoBtn = document.getElementById("docUndoBtn");
  const redoBtn = document.getElementById("docRedoBtn");
  if (!undoBtn || !redoBtn) return;

  const h = docHistory[docId];
  const canUndo = !!h && h.index > 0;
  const canRedo = !!h && h.index < h.stack.length - 1;
  undoBtn.disabled = !canUndo;
  redoBtn.disabled = !canRedo;
}

function renderTOC(content) {
  const container = document.getElementById("tocLinksContainer");
  const card = document.getElementById("tocCard");
  container.innerHTML = "";

  const lines = content.split("\n");
  const chapters = [];

  lines.forEach(function(line, idx) {
    const trimmed = line.trim();
    if (MARKDOWN_HEADING_REGEX.test(trimmed)) {
      chapters.push({ title: trimmed.replace(/^#\s+/, ''), lineIndex: idx, fullText: trimmed });
    } else if (CHAPTER_LINE_REGEX.test(trimmed)) {
      chapters.push({ title: trimmed.substring(0, 24), lineIndex: idx, fullText: trimmed });
    }
  });

  if (chapters.length === 0) {
    card.style.display = "none";
    return;
  }

  card.style.display = "block";
  chapters.forEach(function(ch) {
    const chip = document.createElement("span");
    chip.className = "toc-chip";
    chip.textContent = "📍 " + ch.title;
    chip.onclick = function() {
      const textarea = document.getElementById("docContentInput");
      const pos = textarea.value.indexOf(ch.fullText);
      if (pos !== -1) {
        textarea.focus();
        textarea.setSelectionRange(pos, pos + ch.fullText.length);
        const percent = pos / Math.max(1, textarea.value.length);
        textarea.scrollTop = (textarea.scrollHeight - textarea.clientHeight) * percent;
      }
    };
    container.appendChild(chip);
  });
}

function handleImageUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(evt) {
    const doc = appData.docs.find(d => d.id === activeDocId);
    if (doc) {
      if (!doc.images) doc.images = [];
      doc.images.push(evt.target.result);
      saveData();
      renderDocImages(doc.images);
    }
  };
  reader.readAsDataURL(file);
  e.target.value = "";
}

function renderDocImages(images) {
  const strip = document.getElementById("docImagesContainer");
  strip.innerHTML = "";
  if (!images || images.length === 0) return;

  images.forEach(function(imgSrc, index) {
    const box = document.createElement("div");
    box.className = "img-preview-box";
    box.innerHTML = 
      '<img src="' + imgSrc + '" alt="圖片">' +
      '<button class="img-del-btn" title="刪除圖片" onclick="deleteDocImage(' + index + ')">✕</button>';
    strip.appendChild(box);
  });
}

function deleteDocImage(index) {
  const doc = appData.docs.find(d => d.id === activeDocId);
  if (doc && doc.images) {
    doc.images.splice(index, 1);
    saveData();
    renderDocImages(doc.images);
  }
}
