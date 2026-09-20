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
  // 換了一篇文檔，上一篇的搜尋標示不該留著。
  // 從搜尋結果點進來的那條路徑會在這之後自己加回去。
  if (typeof clearSearchHighlight === "function") clearSearchHighlight();

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

  // 一開始編輯就把搜尋標示清掉：文字一動，標示的位置就不對了
  if (typeof clearSearchHighlight === "function") clearSearchHighlight();

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

  // 單篇的步數上限
  while (h.stack.length > DOC_HISTORY_MAX_STEPS) {
    h.stack.splice(1, 1);
    h.index--;
  }
  trimHistoryMemory(docId);

  if (docId === activeDocId) updateUndoRedoButtons(docId);
}

/* 全部文檔的復原紀錄加起來的字元總量上限。

   步數上限只擋得住單篇；docHistory 是全域的，開過的每一篇都留著自己那疊，
   寫一整天下來開了三十篇就是三十疊。所以另外算總量，超過就從「最舊、而且
   不是現在正在編輯的那篇」開始丟——正在寫的那篇不能被動，不然使用者會
   發現自己按不了復原。 */
function trimHistoryMemory(protectDocId) {
  const total = function() {
    let n = 0;
    Object.keys(docHistory).forEach(function(id) {
      docHistory[id].stack.forEach(function(t) { n += (t || "").length; });
    });
    return n;
  };

  if (total() <= DOC_HISTORY_MAX_CHARS) return;

  // 先砍別篇：整疊只留目前那一格，復原紀錄沒了但內容還在
  Object.keys(docHistory).forEach(function(id) {
    if (id === protectDocId || id === activeDocId) return;
    if (total() <= DOC_HISTORY_MAX_CHARS) return;
    const h = docHistory[id];
    h.stack = [h.stack[h.index]];
    h.index = 0;
  });

  // 還是超過，才動正在編輯這篇最舊的那幾步
  const h = docHistory[protectDocId] || docHistory[activeDocId];
  while (h && h.stack.length > 1 && total() > DOC_HISTORY_MAX_CHARS) {
    h.stack.splice(1, 1);
    if (h.index > 0) h.index--;
  }
}

function applyHistorySnapshot(doc, content) {
  doc.content = content;
  const textarea = document.getElementById("docContentInput");
  textarea.value = content;
  autoGrowTextarea(textarea);
  // 復原／取消復原是整段換掉內文，標示的位置會完全對不上
  if (typeof clearSearchHighlight === "function") clearSearchHighlight();

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
    /* 用行號定位，不要用 indexOf(fullText)。

       indexOf 找的是「全文裡第一個長這樣的字串」——兩章同名，或內文裡
       引用了章節標題，就會跳到錯的地方。章節物件上本來就帶著 lineIndex，
       而 jumpToLine() 已經是照行號精準定位的正確實作（快速跳轉用的就是它）。 */
    chip.onclick = function() {
      jumpToLine(ch.lineIndex);
    };
    container.appendChild(chip);
  });
}

/* 圖片在存進去之前先縮小。

   原本是 readAsDataURL 直接把原檔塞進 appData。手機拍的 4MB 照片轉成
   base64 大約 5.3MB——localStorage 總共才 5MB，一張就爆，而且爆掉的時候
   存檔是靜悄悄失敗的（見 storage.js 的 saveData）。

   縮到長邊 1600px、JPEG 品質 0.82，一般照片會落在 150～300KB，二三十張
   都還塞得下。1600px 是「白板縮圖與編輯器預覽都夠清楚」與「不要太大」
   之間的折衷；原檔本來就比較小的話不會放大。 */
const IMAGE_MAX_EDGE = 1600;
const IMAGE_JPEG_QUALITY = 0.82;
const IMAGE_MAX_BYTES = 1.5 * 1024 * 1024;   // 壓完還超過就擋下來

function handleImageUpload(e) {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;

  if (!/^image\//.test(file.type)) {
    alert("這不是圖片檔。");
    return;
  }

  compressImageFile(file).then(function(dataUrl) {
    if (!isSafeImageSrc(dataUrl)) { alert("圖片處理失敗，請換一張試試。"); return; }
    if (dataUrl.length > IMAGE_MAX_BYTES) {
      alert("這張圖片壓縮後仍然有 " + Math.round(dataUrl.length / 1024) + " KB，太大了。\n" +
            "瀏覽器的儲存空間只有約 5MB，請先用別的工具把它縮小再放進來。");
      return;
    }
    const doc = appData.docs.find(d => d.id === activeDocId);
    if (!doc) return;
    if (!doc.images) doc.images = [];
    doc.images.push(dataUrl);
    saveData();
    renderDocImages(doc.images);
  }).catch(function(err) {
    console.error(err);
    alert("讀取圖片時發生錯誤，請換一張試試。");
  });
}

function compressImageFile(file) {
  return new Promise(function(resolve, reject) {
    const reader = new FileReader();
    reader.onerror = function() { reject(new Error("讀不到檔案")); };
    reader.onload = function(evt) {
      const img = new Image();
      img.onerror = function() { reject(new Error("這個檔案不是瀏覽器認得的圖片")); };
      img.onload = function() {
        const scale = Math.min(1, IMAGE_MAX_EDGE / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));

        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        // JPEG 沒有透明度，先鋪白底，否則透明的地方會變成黑塊
        ctx.fillStyle = "#FFFFFF";
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);

        try {
          resolve(canvas.toDataURL("image/jpeg", IMAGE_JPEG_QUALITY));
        } catch (err) {
          reject(err);
        }
      };
      img.src = evt.target.result;
    };
    reader.readAsDataURL(file);
  });
}

function renderDocImages(images) {
  const strip = document.getElementById("docImagesContainer");
  strip.innerHTML = "";
  if (!images || images.length === 0) return;

  images.forEach(function(imgSrc, index) {
    // 來路不明的字串不要進 <img src>（見 isSafeImageSrc）。用 DOM 屬性
    // 設定而不是拼 HTML 字串，就算白名單哪天放寬了也跳不出屬性。
    if (!isSafeImageSrc(imgSrc)) return;

    const box = document.createElement("div");
    box.className = "img-preview-box";

    const img = document.createElement("img");
    img.src = imgSrc;
    img.alt = "圖片";

    const del = document.createElement("button");
    del.className = "img-del-btn";
    del.title = "刪除圖片";
    del.textContent = "✕";
    del.onclick = function() { deleteDocImage(index); };

    box.appendChild(img);
    box.appendChild(del);
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
