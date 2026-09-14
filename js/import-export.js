/* ==========================================================
   匯出與匯入功能
   ========================================================== */

function openBatchExportModal() {
  const container = document.getElementById("exportChecklistContainer");
  container.innerHTML = "";

  appData.worldviews.forEach(function(w) {
    const wTitle = document.createElement("div");
    wTitle.style.fontWeight = "700";
    wTitle.style.fontSize = "13px";
    wTitle.style.margin = "6px 0 2px 0";
    wTitle.innerHTML = "<span>" + escapeHtml(w.icon || '🌐') + " " + escapeHtml(w.name) + "</span>";
    container.appendChild(wTitle);

    const docs = appData.docs.filter(d => d.worldId === w.id);
    docs.forEach(function(d) {
      const row = document.createElement("div");
      row.style.padding = "4px 10px";
      row.innerHTML = `<input type="checkbox" class="export-checkbox" data-id="${d.id}" checked> <span>${escapeHtml(d.icon || '📄')} ${escapeHtml(d.title || '無標題')}</span>`;
      container.appendChild(row);
    });
  });

  document.getElementById("batchExportModal").classList.add("active");
}

function toggleExportAll(status) {
  document.querySelectorAll(".export-checkbox").forEach(cb => cb.checked = status);
}
function closeBatchExportModal() { document.getElementById("batchExportModal").classList.remove("active"); }

function confirmBatchExport() {
  const checkedBoxes = document.querySelectorAll(".export-checkbox:checked");
  if (checkedBoxes.length === 0) { alert("請至少選擇一個文檔！"); return; }

  const ids = Array.from(checkedBoxes).map(cb => cb.getAttribute("data-id"));
  const format = document.getElementById("exportFormatSelect").value;
  const docs = appData.docs.filter(d => ids.includes(d.id));

  if (format === "json") {
    downloadFile(JSON.stringify(docs, null, 2), "world_export_" + Date.now() + ".json", "application/json");
  } else if (format === "html") {
    downloadFile(buildExportHTML(docs), "world_export_" + Date.now() + ".html", "text/html;charset=utf-8");
  } else {
    let txt = "";
    docs.forEach(function(d) {
      txt += `【${d.title || '無標題'}】\n標籤：${d.tags.join(' ')}\n\n${d.content}\n\n====================\n\n`;
    });
    downloadFile(txt, "world_export_" + Date.now() + ".txt", "text/plain;charset=utf-8");
  }
  closeBatchExportModal();
}

function buildExportHTML(docs) {
  const body = docs.map(function(d) {
    return `<article class="wb-doc" data-icon="${escapeHtml(d.icon || '📄')}" data-tags="${escapeHtml((d.tags || []).join(','))}">
  <h1>${escapeHtml(d.title || '無標題')}</h1>
  <div class="wb-tags">${(d.tags || []).map(t => '#' + escapeHtml(t)).join(' ')}</div>
  <pre class="wb-content">${escapeHtml(d.content || '')}</pre>
</article>`;
  }).join("\n<hr>\n");

  return `<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="UTF-8">
<title>世界觀匯出文檔</title>
<style>
  body { font-family: "Noto Sans TC", "Plus Jakarta Sans", sans-serif; max-width: 760px; margin: 40px auto; padding: 0 20px; line-height: 1.7; color: #2A2420; }
  h1 { font-size: 22px; border-bottom: 2px solid #ddd; padding-bottom: 8px; }
  .wb-tags { color: #8A4F1F; font-size: 13px; margin-bottom: 12px; }
  .wb-content { white-space: pre-wrap; word-break: break-word; font-family: inherit; font-size: 15px; }
  hr { border: none; border-top: 1px dashed #ccc; margin: 36px 0; }
</style>
</head>
<body>
${body}
</body>
</html>`;
}

function exportFullDatabaseJSON() {
  downloadFile(JSON.stringify(appData, null, 2), "worldbuilder_full_db_" + Date.now() + ".json", "application/json");
}

function downloadFile(content, fileName, contentType) {
  const a = document.createElement("a");
  const file = new Blob([content], { type: contentType });
  a.href = URL.createObjectURL(file);
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(a.href);
}

function triggerImportFile() {
  document.getElementById("importFileInput").click();
}

function handleImportFileSelected(e) {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;

  const ext = (file.name.split(".").pop() || "").toLowerCase();
  const reader = new FileReader();
  reader.onload = function(evt) {
    const text = evt.target.result;
    try {
      if (ext === "json") {
        importFromJSON(text);
      } else if (ext === "html" || ext === "htm") {
        importFromHTML(text);
      } else {
        importFromTXT(text);
      }
    } catch (err) {
      console.error(err);
      alert("匯入失敗：檔案格式無法辨識或已損毀。");
    }
  };
  reader.onerror = function() {
    alert("讀取檔案時發生錯誤，請重試。");
  };
  reader.readAsText(file);
}

function importFromJSON(text) {
  const data = safeParseJSON(text);
  if (data === null) { alert("匯入失敗：JSON 格式錯誤。"); return; }

  if (data && !Array.isArray(data) && Array.isArray(data.worldviews) && Array.isArray(data.folders) && Array.isArray(data.docs)) {
    if (!confirm("偵測到這是「完整資料庫備份」檔案，匯入將會覆蓋目前所有資料，確定要繼續嗎？")) return;
    appData = data;
    if (!appData.colorPalette) appData.colorPalette = Object.assign({}, DEFAULT_PALETTES);
    if (!appData.tagSettings) appData.tagSettings = {};
    if (!appData.trash || typeof appData.trash !== "object") appData.trash = { docs: [], folders: [] };
    if (!Array.isArray(appData.trash.docs)) appData.trash.docs = [];
    if (!Array.isArray(appData.trash.folders)) appData.trash.folders = [];
    saveData();
    location.reload();
    return;
  }

  if (Array.isArray(data)) {
    importDocsArray(data);
    return;
  }

  alert("匯入失敗：無法辨識此 JSON 檔案的內容格式。");
}

function importFromTXT(text) {
  const blocks = text.split("====================").map(s => s.trim()).filter(Boolean);
  const docs = blocks.map(function(block) {
    const titleMatch = block.match(/^【([^】]*)】/);
    const tagsMatch = block.match(/標籤：([^\n]*)/);
    let content = block;
    if (titleMatch) content = content.replace(titleMatch[0], "");
    if (tagsMatch) content = content.replace(/標籤：[^\n]*/, "");
    content = content.replace(/^\s+/, "").trim();
    return {
      title: titleMatch ? titleMatch[1].trim() : "匯入文檔",
      tags: tagsMatch ? tagsMatch[1].trim().split(/\s+/).filter(Boolean) : [],
      content: content
    };
  });
  importDocsArray(docs);
}

function importFromHTML(text) {
  const parser = new DOMParser();
  const htmlDoc = parser.parseFromString(text, "text/html");
  const articles = htmlDoc.querySelectorAll(".wb-doc");
  const docs = [];
  articles.forEach(function(el) {
    const titleEl = el.querySelector("h1");
    const contentEl = el.querySelector(".wb-content");
    const tagsAttr = el.getAttribute("data-tags") || "";
    docs.push({
      title: titleEl ? titleEl.textContent.trim() : "匯入文檔",
      icon: el.getAttribute("data-icon") || "📄",
      tags: tagsAttr ? tagsAttr.split(",").map(s => s.trim()).filter(Boolean) : [],
      content: contentEl ? contentEl.textContent : ""
    });
  });
  if (docs.length === 0) {
    alert("匯入失敗：此 HTML 檔案不是本工具匯出的格式，找不到可匯入的文檔內容。");
    return;
  }
  importDocsArray(docs);
}

function importDocsArray(docsArray) {
  if (!docsArray || !docsArray.length) { alert("此檔案沒有可匯入的文檔。"); return; }
  if (!confirm(`即將匯入 ${docsArray.length} 篇文檔到「${getWorldName(activeWorldId)}」，確定嗎？`)) return;

  docsArray.forEach(function(d) {
    appData.docs.unshift({
      id: "doc_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7),
      worldId: activeWorldId,
      folderId: activeFolderId || null,
      icon: d.icon || "📄",
      title: d.title || "匯入文檔",
      content: d.content || "",
      tags: Array.isArray(d.tags) ? d.tags : [],
      manualTags: computeManualTagsFor(d.content, d.tags),
      images: Array.isArray(d.images) ? d.images : [],
      wordCount: (d.content || "").length,
      updatedAt: formatTime(new Date())
    });
  });
  saveData();
  renderSidebarTree();
  alert("匯入完成！");
}

function getWorldName(id) {
  const w = appData.worldviews.find(x => x.id === id);
  return w ? w.name : "目前世界觀";
}

function safeParseJSON(text) {
  try { return JSON.parse(text); } catch (e) { return null; }
}
