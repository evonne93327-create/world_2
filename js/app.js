/* ==========================================================
   應用程式初始化進入點 (app.js)
   ========================================================== */
window.addEventListener("DOMContentLoaded", function() {
  buildEmojiPicker();
  renderWorldRail();
  renderSidebarTree();
  updateWorldBadge();
  if (activeDocId) loadDocToEditor(activeDocId);
  setupCanvasEvents();
  applyCanvasHintVisibility();
  setupGlobalClickDismiss();
  setupDirectoryContextMenu();
  setupDeleteKeyShortcut();
  setupGlobalKeyboardShortcuts();
  setupHistoryNavigation();

  window.addEventListener("resize", function() {
    autoGrowTextarea(document.getElementById("docContentInput"));
  });
});
