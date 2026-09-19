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
  initSync();
  registerServiceWorker();

  window.addEventListener("resize", function() {
    autoGrowTextarea(document.getElementById("docContentInput"));
  });
});

/* 註冊 service worker，讓 app 可以安裝到主畫面並離線使用。
   只在 https 或 localhost 底下有效；用 file:// 直接開會靜默略過。 */
function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  if (location.protocol !== "https:" && location.hostname !== "localhost" &&
      location.hostname !== "127.0.0.1") return;

  navigator.serviceWorker.register("sw.js").catch(function(e) {
    // 註冊失敗只代表沒有離線能力，app 本身照常運作，不需要打擾使用者
    console.warn("Service worker 註冊失敗：", e);
  });
}
