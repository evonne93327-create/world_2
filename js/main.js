/* ==========================================================
 核心與通用工具 (main.js)
 ========================================================== */

// 1. 格式化時間工具
function formatTime(d) {
 const y = d.getFullYear();
 const m = String(d.getMonth() + 1).padStart(2, '0');
 const day = String(d.getDate()).padStart(2, '0');
 const h = String(d.getHours()).padStart(2, '0');
 const min = String(d.getMinutes()).padStart(2, '0');
 return y + "-" + m + "-" + day + " " + h + ":" + min;
}

// 2. 核心防禦：跳脫 HTML 字元（就是這個變成 undefined 導致畫面出錯）
/* 版面是不是手機版。CSS 的 media query 條件必須跟這裡一致，
   否則會出現「CSS 已經是手機版、JS 還以為是電腦版」的錯亂——
   例如側邊欄該用抽屜開合，JS 卻去做電腦版的收合。

   高度條件是為了手機橫放（844×390）：寬度超過 768 但高度只有 390，
   只看寬度會把它當成電腦版。 */
function isMobileLayout() {
  return window.innerWidth <= 768 || window.innerHeight <= 500;
}

/* 圖片來源只接受 app 自己產生的 base64 資料 URI。

   這些字串會被放進 <img src>。匯入的 JSON 可以在 images 欄位塞任何東西，
   而原本沒有任何檢查——一個 x" onerror="..." 就跳出屬性、執行任意程式碼，
   讀得到 localStorage 裡的全部世界觀資料、Supabase 的 session token 與
   Google Drive 的 token。

   白名單的字元集刻意不含引號、角括號與空白，所以即使被字串拼接進
   屬性裡也跳不出來。 */
const SAFE_IMAGE_SRC = /^data:image\/(png|jpeg|jpg|gif|webp|avif);base64,[A-Za-z0-9+/]+={0,2}$/;

function isSafeImageSrc(src) {
  return typeof src === "string" && src.length < 12 * 1024 * 1024 && SAFE_IMAGE_SRC.test(src);
}

/* 匯入進來的圖片陣列一律過這一關，留下看得懂的、丟掉可疑的 */
function sanitizeImageList(list) {
  if (!Array.isArray(list)) return [];
  return list.filter(isSafeImageSrc);
}

/* 單引號也要跳脫：屬性不一定都用雙引號包，漏掉它等於留了一條跳脫屬性的路。 */
function escapeHtml(str) {
 if (!str) return '';
 return String(str)
 .replace(/&/g, '&amp;')
 .replace(/</g, '&lt;')
 .replace(/>/g, '&gt;')
 .replace(/"/g, '&quot;')
 .replace(/'/g, '&#39;');
}

// 3. 畫面切換 (編輯器 / 白板)
function switchView(view, pushHistory = true) {
 activeView = view;
 document.getElementById("tabEditorBtn").classList.toggle("active", view === 'editor');
 document.getElementById("tabCanvasBtn").classList.toggle("active", view === 'canvas');
 document.getElementById("editorView").style.display = (view === 'editor') ? 'flex' : 'none';
 document.getElementById("canvasView").style.display = (view === 'canvas') ? 'block' : 'none';
 document.getElementById("quickJumpFab").style.display = (view === 'editor') ? 'flex' : 'none';
 if (view !== 'editor') closeQuickJumpPanel();
 if (view === 'canvas') {
 renderCanvas();
 if (pushHistory) history.pushState({ view: 'canvas' }, "");
 } else {
 autoGrowTextarea(document.getElementById("docContentInput"));
 }
}

// 4. 側邊欄開關控制
function toggleSidebarMenu() {
 const isMobile = isMobileLayout();
 const sidebar = document.getElementById("appSidebar");
 const overlay = document.getElementById("sidebarOverlay");

 if (isMobile) {
 const isOpen = sidebar.classList.contains("drawer-open");
 if (isOpen) {
 closeSidebarMobile();
 } else {
 sidebar.classList.add("drawer-open");
 overlay.classList.add("active");
 history.pushState({ drawer: true }, "");
 }
 } else {
 sidebar.classList.toggle("collapsed");
 }
 scheduleAutoGrowAfterLayoutShift();
 scheduleCanvasViewBoxAfterLayoutShift();
}

function openSidebarMenu() {
 const isMobile = isMobileLayout();
 const sidebar = document.getElementById("appSidebar");
 const overlay = document.getElementById("sidebarOverlay");

 if (isMobile) {
 if (!sidebar.classList.contains("drawer-open")) {
 sidebar.classList.add("drawer-open");
 overlay.classList.add("active");
 history.pushState({ drawer: true }, "");
 }
 } else {
 sidebar.classList.remove("collapsed");
 }
 scheduleAutoGrowAfterLayoutShift();
 scheduleCanvasViewBoxAfterLayoutShift();
}

function closeSidebarMobile() {
 document.getElementById("appSidebar").classList.remove("drawer-open");
 document.getElementById("sidebarOverlay").classList.remove("active");
 scheduleCanvasViewBoxAfterLayoutShift();
}

function scheduleAutoGrowAfterLayoutShift() {
 setTimeout(function() {
 autoGrowTextarea(document.getElementById("docContentInput"));
 }, 260);
}

// 側邊欄展開／收起時，白板容器的寬度也會跟著變（CSS transition 0.25s），
// 但 SVG 的 viewBox／寬高只有在 resize 或縮放平移時才會重算，
// 導致收合目錄的過程中連線的位置跟比例跟畫面對不上、動畫結束當下才「跳」回正確位置。
// 這裡改成整個動畫期間（0.25s + 一點緩衝）用 requestAnimationFrame 逐格校正，
// 讓連線全程跟著側邊欄一起滑動，不會等動畫結束才突然對齊，也不怕單次 setTimeout 抓不準時間點。
let canvasViewBoxRafId = null;
function scheduleCanvasViewBoxAfterLayoutShift() {
 if (typeof activeView !== 'undefined' && activeView !== 'canvas') return;
 if (typeof applySvgViewBox !== 'function') return;

 if (canvasViewBoxRafId) cancelAnimationFrame(canvasViewBoxRafId);

 const duration = 300; // CSS transition 0.25s + 緩衝
 const start = performance.now();

 function tick(now) {
 applySvgViewBox();
 if (now - start < duration) {
 canvasViewBoxRafId = requestAnimationFrame(tick);
 } else {
 canvasViewBoxRafId = null;
 }
 }
 canvasViewBoxRafId = requestAnimationFrame(tick);
}

function handleBreadcrumbDblClick(e) {
 if (e.target.closest('.breadcrumb-item')) return;
 openSidebarMenu();
}

// 5. 瀏覽器歷史紀錄整合（支援手機版手勢返回）
function setupHistoryNavigation() {
 if (!history.state) {
 history.replaceState({ view: 'editor', drawer: false }, "");
 }

 window.addEventListener("popstate", function(e) {
 const sidebar = document.getElementById("appSidebar");
 const isDrawerOpen = sidebar && sidebar.classList.contains("drawer-open");

 if (isDrawerOpen) {
 closeSidebarMobile();
 return;
 }

 if (activeView === 'canvas') {
 switchView('editor', false);
 return;
 }

 const activeModal = document.querySelector(".modal-overlay.active");
 if (activeModal) {
 activeModal.classList.remove("active");
 return;
 }
 });
}

// 6. 快捷鍵設定
function setupDeleteKeyShortcut() {
 document.addEventListener("keydown", function(e) {
 if (e.key !== "Delete") return;

 const tag = (e.target.tagName || "").toLowerCase();
 if (tag === "input" || tag === "textarea" || e.target.isContentEditable) return;
 if (isBatchDeleteMode) return;

 if (activeFolderId) {
 deleteFolderById(activeFolderId);
 } else if (activeDocId) {
 deleteCurrentDocument();
 }
 });
}

function setupGlobalKeyboardShortcuts() {
 document.addEventListener("keydown", function(e) {
 const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
 const cmdKey = isMac ? e.metaKey : e.ctrlKey;
 if (!cmdKey) return;

 const key = e.key.toLowerCase();
 const activeEl = document.activeElement;
 const inContentEditor = !!activeEl && activeEl.id === "docContentInput";

 // Ctrl+Z：復原
 if (key === "z" && !e.shiftKey) {
 if (inContentEditor) {
 e.preventDefault();
 undoDocContent();
 }
 return;
 }

 // Ctrl+Y：取消復原
 if (key === "y") {
 if (inContentEditor) {
 e.preventDefault();
 redoDocContent();
 }
 return;
 }

 // Ctrl+F：全域搜尋
 if (key === "f") {
 e.preventDefault();
 const searchInput = document.getElementById("searchInput");
 if (!searchInput) return;

 openSidebarMenu();
 searchInput.focus();
 searchInput.select();
 }
 });
}

// 7. 點擊空白處自動關閉彈出式選單
function setupGlobalClickDismiss() {
 const closeMenus = function(e) {
 // 關閉 Hashtag 顏色選單
 const popover = document.getElementById("colorPickerPopover");
 if (popover && popover.classList.contains("active") && !popover.contains(e.target)) {
 popover.classList.remove("active");
 }
 
 // 關閉麵包屑下拉選單
 if (!e.target.closest('.breadcrumb-item')) {
 if (typeof closeAllBreadcrumbDropdowns === 'function') {
 closeAllBreadcrumbDropdowns();
 }
 }

 // 關閉「文件操作」浮動選單（投射白板／放圖片／刪除）
 if (!e.target.closest('.docactions-wrap')) {
 if (typeof closeDocActionsPanel === 'function') {
 closeDocActionsPanel();
 }
 }
 
 // 關閉自訂右鍵選單 (世界觀、資料夾等)
 const ctxMenu = document.getElementById("customContextMenu");
 if (ctxMenu && ctxMenu.classList.contains("active") && !ctxMenu.contains(e.target)) {
 if (typeof closeContextMenu === 'function') {
 closeContextMenu();
 }
 }
 };

 // 同時監聽 mousedown 與 click，確保點擊其他項目時能無縫關閉選單並觸發新動作
 document.addEventListener("mousedown", closeMenus);
 document.addEventListener("click", closeMenus);
}

/* ==========================================================
   彈窗的鍵盤與焦點

   原本十四個彈窗都只能用滑鼠點右上角的 ✕ 關掉：Esc 沒有作用、點外面的
   遮罩也沒有作用，而且打開的時候焦點還留在 body——鍵盤使用者要從頁面
   最上面一路 Tab 過來，而且 Tab 到底會跑出彈窗、走到後面被遮住的頁面上。

   這裡用 MutationObserver 攔「彈窗被加上 .active」這件事，而不是去改那
   十四個開啟函式。好處是以後新增的彈窗自動就有這些行為，不會有人忘記。

   關閉時刻意去「按下那個彈窗自己的關閉按鈕」而不是直接拿掉 .active：
   有些彈窗的關閉是有副作用的（標籤分類設定要存名稱、外觀關掉要回到
   設定總表），繞過它們會出事。
   ========================================================== */

/* 需要使用者明確做出選擇的，不給 Esc／點遮罩關掉——隨手關掉等於沒決定，
   而那些流程停在半路上會更難處理。 */
const MODALS_REQUIRING_CHOICE = ["syncConflictModal"];

function topMostModal() {
  const open = Array.from(document.querySelectorAll(".modal-overlay.active"));
  return open.length ? open[open.length - 1] : null;
}

function dismissModal(modal) {
  if (!modal) return;
  if (MODALS_REQUIRING_CHOICE.indexOf(modal.id) >= 0) return;

  // 1. 標題列的 ✕
  const closeBtn = modal.querySelector(".modal-head .icon-sm-btn");
  if (closeBtn) { closeBtn.click(); return; }

  // 2. 文字看起來是「取消／關閉」的按鈕
  const buttons = Array.from(modal.querySelectorAll("button"));
  const cancel = buttons.find(function(b) {
    return /取消|關閉|稍後|先不要|知道了/.test(b.textContent || "");
  });
  if (cancel) { cancel.click(); return; }

  // 3. 都沒有就直接收起來
  modal.classList.remove("active");
}

function focusablesIn(el) {
  return Array.from(el.querySelectorAll(
    'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), ' +
    'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )).filter(function(n) {
    return n.offsetWidth > 0 || n.offsetHeight > 0 || n === document.activeElement;
  });
}

let focusBeforeModal = null;

function setupModalKeyboard() {
  document.querySelectorAll(".modal-overlay").forEach(function(modal) {
    // 點遮罩本身（不是裡面的卡片）就關掉
    modal.addEventListener("mousedown", function(e) {
      if (e.target === modal) dismissModal(modal);
    });

    new MutationObserver(function() {
      if (!modal.classList.contains("active")) return;
      // 記住是從哪裡打開的，關掉之後要還回去
      if (!focusBeforeModal) focusBeforeModal = document.activeElement;

      const card = modal.querySelector(".modal-card") || modal;
      if (!card.hasAttribute("tabindex")) card.setAttribute("tabindex", "-1");

      const targets = focusablesIn(card);
      /* 優先聚焦輸入框——彈窗多半是要你填點什麼。沒有輸入框就聚焦卡片
         本身，讓 Tab 從這裡開始往下走，而不是從頁面最上面。 */
      const input = targets.find(function(n) { return /^(INPUT|TEXTAREA|SELECT)$/.test(n.tagName); });
      (input || card).focus();
    }).observe(modal, { attributes: true, attributeFilter: ["class"] });
  });

  document.addEventListener("keydown", function(e) {
    const modal = topMostModal();

    if (e.key === "Escape") {
      if (!modal) return;
      e.preventDefault();
      dismissModal(modal);
      return;
    }

    // Tab 不要跑出彈窗，在裡面繞回來
    if (e.key === "Tab" && modal) {
      const card = modal.querySelector(".modal-card") || modal;
      const targets = focusablesIn(card);
      if (!targets.length) return;
      const first = targets[0], last = targets[targets.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus();
      } else if (!card.contains(document.activeElement)) {
        e.preventDefault(); first.focus();
      }
    }
  });

  // 全部關掉之後把焦點還給原本的地方
  new MutationObserver(function() {
    if (document.querySelector(".modal-overlay.active")) return;
    if (focusBeforeModal && document.contains(focusBeforeModal)) {
      try { focusBeforeModal.focus(); } catch (err) {}
    }
    focusBeforeModal = null;
  }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ["class"] });
}
