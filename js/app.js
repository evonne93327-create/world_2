/* ==========================================================
   應用程式初始化進入點 (app.js)
   在所有模組載入完成後，於頁面載入時依序：
   1. 渲染畫面（世界觀導覽列、側邊欄目錄、當前世界徽章、編輯器內容）
   2. 綁定全域事件監聽器（白板、選單點擊關閉、右鍵選單、刪除鍵、
      快捷鍵、瀏覽器上一頁/下一頁手勢）
   ========================================================== */
window.addEventListener("DOMContentLoaded", function() {
  buildEmojiPicker();
  renderWorldRail();
  renderSidebarTree();
  updateWorldBadge();
  if (activeDocId) loadDocToEditor(activeDocId);
  setupCanvasEvents();
  setupGlobalClickDismiss();
  setupDirectoryContextMenu();
  setupDeleteKeyShortcut();
  setupGlobalKeyboardShortcuts();
  setupHistoryNavigation();

  // 側邊欄寬度、視窗寬度改變時，文字換行寬度也會變，需要重新計算內文框的自動撐高高度
  window.addEventListener("resize", function() {
    autoGrowTextarea(document.getElementById("docContentInput"));
  });
});
