/* ==========================================================
   存儲與資料遷移 (storage.js)
   ========================================================== */

const saved = localStorage.getItem("novel_multi_world_data_v5");
if (saved) {
  try {
    const parsed = JSON.parse(saved);
    if (parsed && Array.isArray(parsed.docs) && parsed.docs.length > 0) {
      appData = parsed;
    }
  } catch (e) { console.error(e); }
}

// 1. 讀取上一次的 UI 狀態 (停留在哪個世界/文檔/資料夾)
const savedState = localStorage.getItem("novel_ui_state");
if (savedState) {
  try {
    const parsedState = JSON.parse(savedState);
    if (parsedState.activeWorldId) activeWorldId = parsedState.activeWorldId;
    if (parsedState.activeDocId !== undefined) activeDocId = parsedState.activeDocId;
    if (parsedState.activeFolderId !== undefined) activeFolderId = parsedState.activeFolderId;
  } catch (e) { console.error(e); }
}

// 2. 防呆機制：如果載入的 activeDocId 已經被刪除，自動切換到第一個可用的文檔
if (activeDocId && !appData.docs.find(d => d.id === activeDocId)) {
  if (appData.docs.length > 0) {
    activeDocId = appData.docs[0].id;
    activeWorldId = appData.docs[0].worldId;
  } else {
    activeDocId = null;
  }
}

function computeManualTagsFor(content, tags) {
  const existingTags = Array.isArray(tags) ? tags : [];
  return existingTags.filter(function(t) {
    const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('#' + escaped + '(?=[\\s#]|$)');
    return !re.test(content || "");
  });
}

(function migrateDocTags() {
  (appData.docs || []).forEach(function(d) {
    if (Array.isArray(d.manualTags)) return;
    d.manualTags = computeManualTagsFor(d.content, d.tags);
  });
})();

if (!appData.trash || typeof appData.trash !== "object") {
  appData.trash = { docs: [], folders: [] };
}
if (!Array.isArray(appData.trash.docs)) appData.trash.docs = [];
if (!Array.isArray(appData.trash.folders)) appData.trash.folders = [];

function saveData() {
  localStorage.setItem("novel_multi_world_data_v5", JSON.stringify(appData));
  // 存檔時一併記錄當前的 UI 狀態
  localStorage.setItem("novel_ui_state", JSON.stringify({ activeWorldId, activeDocId, activeFolderId }));
  // 通知雲端同步（sync.js 載入順序在後，沒設定同步時這裡就是 no-op）
  if (typeof onDataSaved === "function") onDataSaved();
}

// 3. 確保重新整理或關閉分頁前，一定會記住最後的瀏覽位置
window.addEventListener("beforeunload", function() {
  localStorage.setItem("novel_ui_state", JSON.stringify({ activeWorldId, activeDocId, activeFolderId }));
});
