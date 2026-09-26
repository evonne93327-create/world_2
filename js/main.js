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

/* 這台裝置主要是用手指操作的嗎。

   跟 isMobileLayout() 不是同一件事：iPad 橫放時寬度超過 768，版面算桌機，
   但它還是沒有實體鍵盤——自動聚焦輸入框一樣會把軟體鍵盤叫出來。凡是
   「會不會吵到使用者」的判斷都要看這個，不要看寬度。 */
function isTouchPrimary() {
  try {
    return window.matchMedia("(hover: none) and (pointer: coarse)").matches;
  } catch (e) {
    return "ontouchstart" in window;
  }
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

/* 世界觀的「一句話簡介」上限。

   它顯示在側欄一行、以及滑鼠提示裡，太長會把版面撐開。一句話的長度，
   不是簡介欄。放在這裡而不是 directory.js：匯入那條路（import-export.js）
   也要用它截斷，而測試沙箱不載 directory.js。 */
const WORLD_DESC_MAX_LEN = 60;

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
 } else {
 autoGrowTextarea(document.getElementById("docContentInput"));
 }
 /* 歷史紀錄由 scheduleUiHistorySync() 統一對齊。原本這裡自己推一筆，
    但切回編輯器時沒有人把它收回來——按「編輯」分頁離開白板之後，
    那一筆就永遠留在歷史裡，變成一次不會有任何反應的返回鍵。 */
 if (pushHistory) scheduleUiHistorySync();

 // 在 app 裡換了地方看，順便對一次帳（政策見 sync.js）
 if (typeof syncOnUserNavigation === "function") syncOnUserNavigation();
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
 // 同 openSidebarMenu()：回到目錄也算一次「我要看這份資料」
 if (typeof syncOnUserNavigation === "function") syncOnUserNavigation();
 }
 } else {
 sidebar.classList.toggle("collapsed");
 if (sidebar.classList.contains("collapsed")) afterSidebarClosed();
 }
 scheduleAutoGrowAfterLayoutShift();
 scheduleCanvasViewBoxAfterLayoutShift();
}

function openSidebarMenu() {
 const isMobile = isMobileLayout();
 const sidebar = document.getElementById("appSidebar");
 const overlay = document.getElementById("sidebarOverlay");

 // 回到目錄＝「我現在要看這份資料」，順便對一次帳（政策見 sync.js）
 if (typeof syncOnUserNavigation === "function") syncOnUserNavigation();

 if (isMobile) {
 if (!sidebar.classList.contains("drawer-open")) {
 sidebar.classList.add("drawer-open");
 overlay.classList.add("active");
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
 afterSidebarClosed();
 scheduleCanvasViewBoxAfterLayoutShift();
}

/* 目錄收起來之後要做的事。收起來的路有三條（手機抽屜、桌機收合、
   左緣滑動收回），全部都會經過這裡；以後要加「關目錄時順便…」也加在這。 */
function afterSidebarClosed() {
 if (typeof exitBatchDeleteMode === "function") exitBatchDeleteMode();
}

/* 不管哪一種版面，目錄欄現在是開著的嗎。

   兩種版面用的是完全不同的機制：手機版是抽屜（drawer-open），電腦／平板
   版是把寬度收成 0（collapsed）。右滑手勢兩邊都要用，所以需要一個問得到
   「現在到底開著沒有」的地方，不要在手勢那裡自己判斷版面。

   （uiLayerDepth() 仍然只看 drawerIsOpen()：返回鍵要收的是「蓋在畫面上的
   那一層」，平板的目錄欄是版面的一部分，不是疊上去的一層。） */
function sidebarIsOpen() {
 const sidebar = document.getElementById("appSidebar");
 if (!sidebar) return false;
 return isMobileLayout() ? sidebar.classList.contains("drawer-open")
                         : !sidebar.classList.contains("collapsed");
}

/* 收起目錄欄，兩種版面都適用。 */
function closeSidebarMenu() {
 if (isMobileLayout()) { closeSidebarMobile(); return; }
 const sidebar = document.getElementById("appSidebar");
 if (sidebar) sidebar.classList.add("collapsed");
 afterSidebarClosed();
 scheduleAutoGrowAfterLayoutShift();
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

// 5. 瀏覽器歷史紀錄整合（支援手機版手勢返回）— 實作在檔案最下方的
//    「手機的返回鍵」一節，這裡只留進入點
function setupHistoryNavigation() {
 if (!history.state) {
 history.replaceState({ wbBase: true }, "");
 }
 setupUiBackButton();
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
 closeAnchoredPopover();
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
 
 /* 關閉自訂右鍵選單 (世界觀、資料夾等)

    平板／手機上有一個例外：長按叫出選單之後放開手指，iOS 會補一串合成的
    mouse 事件，目標是手指底下那個元素——不是選單。沒有這個例外的話，選單
    會在鬆手的瞬間自己關掉（使用者回報過「長按看到清單，鬆手之後就不見了」）。
    理由詳見 js/modal.js 裡 guardContextMenuFromTouchEcho() 前面的說明。 */
 const ctxMenu = document.getElementById("customContextMenu");
 if (ctxMenu && ctxMenu.classList.contains("active") && !ctxMenu.contains(e.target)) {
 const guarded = typeof contextMenuGuardActive === 'function' && contextMenuGuardActive();
 if (!guarded && typeof closeContextMenu === 'function') {
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

      /* 開彈窗的人已經刻意把焦點放在裡面了（輸入名稱的彈窗會直接聚焦並
         全選名稱欄，讓人一打字就取代），這裡就不要再搶。不然在觸控裝置上
         下面那段會把焦點移到卡片本身——名稱欄的反藍跟著消失，而且軟體
         鍵盤剛升起又收回去。 */
      const active = document.activeElement;
      if (active && active !== document.body && active !== modal && modal.contains(active)) return;

      // 記住是從哪裡打開的，關掉之後要還回去
      if (!focusBeforeModal) focusBeforeModal = document.activeElement;

      const card = modal.querySelector(".modal-card") || modal;
      if (!card.hasAttribute("tabindex")) card.setAttribute("tabindex", "-1");

      const targets = focusablesIn(card);
      /* 優先聚焦輸入框——彈窗多半是要你填點什麼。沒有輸入框就聚焦卡片
         本身，讓 Tab 從這裡開始往下走，而不是從頁面最上面。

         但觸控裝置不能這樣做：聚焦輸入框會把軟體鍵盤叫出來，鍵盤又會把
         彈窗往上擠掉半個畫面。像「編輯人物關係」這種一打開就先想看內容、
         未必要改字的彈窗，鍵盤是純粹的干擾——手機上沒有 Tab 鍵要導航，
         聚焦本來就沒有它在桌機上的價值。所以這裡只在有實體鍵盤的裝置
         才自動聚焦輸入框；觸控裝置一律聚焦卡片本身，使用者真的要打字時
         自己點那個欄位。

         data-no-autofocus：不是「要你填」的欄位（例如世界觀清單上方的排序
         選單）不要搶焦點——聚焦之後按上下鍵會直接改掉排序。 */
      const input = isTouchPrimary()
        ? null
        : targets.find(function(n) {
            return /^(INPUT|TEXTAREA|SELECT)$/.test(n.tagName) && !n.hasAttribute("data-no-autofocus");
          });
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

/* ==========================================================
   手機的返回鍵

   在手機上，看到一個蓋住畫面的東西，第一個反射動作就是按返回鍵。原本
   按下去會直接離開這個 app——彈窗還開著、正在編輯的東西就這樣丟了。

   （原本是有一段程式想做這件事的：切到白板、拉開抽屜時各自推一筆歷史，
   popstate 時關掉最上層。但關掉的那一路完全沒有人把推出去的那一筆收回來，
   於是按「編輯」分頁離開白板、按 ✕ 關掉抽屜之後，歷史裡就留著一筆空的
   紀錄，變成一次「按了沒反應」的返回鍵，按三四次才真的退出去。彈窗更是
   從頭到尾沒推過任何一筆，所以在彈窗上按返回鍵一律直接離開 app。）

   這裡改成單一的模型：算出「現在有幾層東西是返回鍵該收掉的」，然後讓
   瀏覽器的歷史深度跟這個數字對齊。誰開的、怎麼開的都不用管——不管是
   點 ✕、點遮罩、按 Esc 還是程式自己關掉，層數一變就會自動對齊。

   由外而內三層：白板檢視 → 側邊抽屜 → 彈窗（可以疊很多層）。
   返回鍵一次只收掉最內層的那一個。
   ========================================================== */

function openModalCount() {
  return document.querySelectorAll(".modal-overlay.active").length;
}

function drawerIsOpen() {
  const sidebar = document.getElementById("appSidebar");
  return !!sidebar && sidebar.classList.contains("drawer-open");
}

/* 現在疊了幾層。歷史深度要跟這個數字一樣。 */
function uiLayerDepth() {
  return (activeView === "canvas" ? 1 : 0) +
         (drawerIsOpen() ? 1 : 0) +
         openModalCount();
}

/* 收掉最內層的那一層。回傳有沒有真的收掉東西。 */
function closeTopUiLayer() {
  const modal = topMostModal();
  if (modal) {
    dismissModal(modal);
    return true;
  }
  if (drawerIsOpen()) {
    closeSidebarMobile();
    return true;
  }
  if (activeView === "canvas") {
    switchView("editor", false);
    return true;
  }
  return false;
}

let uiHistoryDepth = 0;    // 我們往歷史推了幾筆
let uiHistoryPending = 0;  // 還有幾次 popstate 是 history.go() 自己的回音
let uiHistorySyncTimer = null;

function syncUiHistory() {
  const n = uiLayerDepth();
  if (n === uiHistoryDepth) return;

  if (n > uiHistoryDepth) {
    for (let i = uiHistoryDepth; i < n; i++) {
      // 不給 URL：網址不變，重新整理還是回到同一頁
      history.pushState({ wbLayer: i + 1 }, "");
    }
    uiHistoryDepth = n;
    return;
  }

  /* 層數變少了（使用者自己按 ✕ 關掉的）。把多出來的歷史吐回去，
     否則會越積越多——按了三次返回鍵都沒反應，第四次才真的離開。
     history.go() 會觸發 popstate，先記下「接下來這幾次不是使用者按的」。 */
  const diff = uiHistoryDepth - n;
  uiHistoryDepth = n;
  uiHistoryPending += diff;
  history.go(-diff);
}

/* 一次操作可能連續改好幾層（關掉設定、同時開啟子視窗），
   等這一輪跑完再一次對齊，不要中間每一步都去動歷史。 */
function scheduleUiHistorySync() {
  if (uiHistorySyncTimer) return;
  uiHistorySyncTimer = setTimeout(function() {
    uiHistorySyncTimer = null;
    syncUiHistory();
  }, 0);
}

function setupUiBackButton() {
  /* 彈窗與抽屜的開關都是加減 class，統一用一個觀察器接住，
     不用去每個開啟／關閉函式裡各補一行（那種一定會有人漏掉）。 */
  new MutationObserver(scheduleUiHistorySync)
    .observe(document.body, { subtree: true, attributes: true, attributeFilter: ["class"] });

  window.addEventListener("popstate", function() {
    if (uiHistoryPending > 0) { uiHistoryPending--; return; }

    /* 先把計數減掉：瀏覽器已經幫我們吐掉那一筆了，
       這裡再去 history.go() 會多退一步，直接跳出 app。 */
    if (uiHistoryDepth > 0) uiHistoryDepth--;

    // 沒東西可收就讓它正常往回走（真的離開 app）
    if (!closeTopUiLayer()) return;

    /* 收尾。關不掉的（同步衝突那種一定要做選擇的）會被補回一筆；
       關掉之後又開了別的（設定的子視窗關掉會回到設定總表）也在這裡對齊。 */
    scheduleUiHistorySync();
  });
}

/* ==========================================================
   浮動選單跟著它的錨點跑

   顏色選單是 position:absolute，開啟時算一次位置就固定在那裡。但標籤
   chip 是長在編輯區裡的，而編輯區自己是一個會捲動的容器——捲動它並不會
   改變頁面的 scrollY，所以選單原地不動，內容卻跑掉了，選單就浮在半空中
   指著錯的東西（甚至指到別的標籤）。

   改成 position:fixed（直接用視窗座標，不用管中間有幾層捲動容器），
   並且在開啟期間盯著捲動與視窗尺寸變化，每次都重新貼回錨點旁邊。
   錨點被捲出可視範圍、或整個從畫面上消失時就把選單收起來——它已經
   沒有東西可以指了。

   scroll 用捕獲階段監聽：捲動事件不會冒泡到 window，只有在捕獲階段
   才接得到內層容器（編輯區）的捲動。
   ========================================================== */

let anchoredPopoverEl = null;
let anchoredPopoverAnchor = null;

function positionAnchoredPopover() {
  const popover = anchoredPopoverEl;
  const anchor = anchoredPopoverAnchor;
  if (!popover || !popover.classList.contains("active")) return;

  // 錨點被重繪掉了（例如標籤列重畫）就沒有東西好指
  if (!anchor || !document.contains(anchor)) { closeAnchoredPopover(); return; }

  const r = anchor.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) { closeAnchoredPopover(); return; }

  /* 錨點捲出可視範圍就收起來。留 4px 容忍值，免得剛好貼齊邊界時
     因為次像素誤差一直開開關關。 */
  if (r.bottom < 4 || r.top > window.innerHeight - 4) { closeAnchoredPopover(); return; }

  const pr = popover.getBoundingClientRect();
  let left = r.left;
  let top = r.bottom + 6;
  if (left + pr.width > window.innerWidth - 8) left = window.innerWidth - pr.width - 8;
  // 下面放不下就翻到錨點上方
  if (top + pr.height > window.innerHeight - 8) top = r.top - pr.height - 6;

  popover.style.left = Math.max(8, left) + "px";
  popover.style.top = Math.max(8, Math.min(top, window.innerHeight - pr.height - 8)) + "px";
}

function openAnchoredPopover(popover, anchor) {
  anchoredPopoverEl = popover;
  anchoredPopoverAnchor = anchor || null;

  // 先移到畫面外量尺寸，免得使用者看到它先閃在左上角再跳到正確位置
  popover.style.left = "-9999px";
  popover.style.top = "-9999px";
  popover.classList.add("active");
  requestAnimationFrame(positionAnchoredPopover);
}

function closeAnchoredPopover() {
  if (anchoredPopoverEl) anchoredPopoverEl.classList.remove("active");
  anchoredPopoverEl = null;
  anchoredPopoverAnchor = null;
}

function setupAnchoredPopoverFollow() {
  // 捕獲階段才接得到內層捲動容器的 scroll
  document.addEventListener("scroll", positionAnchoredPopover, true);
  window.addEventListener("resize", positionAnchoredPopover);
}

/* ==========================================================
   軟體鍵盤打開時把版面縮到看得見的高度

   問題：在 iOS Safari 上連按幾次 Enter，游標就跑到鍵盤底下看不見了。

   原因不在捲動，在版面高度。body 是 height:100dvh，而 iOS 的 dvh
   只扣掉瀏覽器自己的網址列，不扣掉軟體鍵盤——鍵盤是「蓋」在畫面上的。
   （viewport 的 interactive-widget=resizes-content 只有 Chrome/Android
   看得懂，iOS 直接忽略。）

   於是 .editor-content-area 這個捲動容器的下半截其實藏在鍵盤後面，
   而瀏覽器「把游標捲進視野」的視野指的就是那個容器的框——它以為游標
   已經看得到了，實際上被鍵盤遮住。

   解法是把根本原因修掉：鍵盤打開時，用 visualViewport 量出真正看得見的
   高度，把版面縮到那個高度。瀏覽器原本的捲動行為就會落在對的範圍裡，
   不需要自己算游標位置（實測在一萬行的文檔上算一次游標要 106ms，
   每按一次 Enter 都卡那麼久是不能接受的）。

   縮的方式是在 <html> 加一個 class，CSS 只在那個 class 在的時候覆蓋高度。
   沒有鍵盤時完全走原本的規則，不會動到既有的版面。

   有一類東西縮 body 救不到：position:fixed 的元素貼的是「版面視窗」，
   而那個視窗在 iOS 上本來就延伸到鍵盤後面，body 變矮它們不會跟著動。
   浮動的復原／快速跳轉按鈕就是這種——它們其實一直都被鍵盤蓋著。
   所以另外給一個 --kb-inset（被鍵盤蓋掉的高度），讓它們自己往上讓。

   還有一件事光靠「縮高度」救不到：iOS 為了讓游標露出來，會把整個
   **版面視窗往上推** offsetTop（`visualViewport.offsetTop` 變成非 0）。
   body 是從版面視窗的頂端長下來的，被推上去的那一段就是最上面的工具列
   ——使用者看到的就是「上面的東西被吃掉了」。

   先前的版本只把 body 的高度設成 offsetTop + 可視高度，讓它的**下緣**
   停在鍵盤上方；上緣就活該被推出畫面。這一版改成連上緣一起顧：body 再加
   一段 padding-top: offsetTop，把內容整個往下讓開被推掉的那一段。
   body 的外框仍然是 offsetTop + 可視高度（文件不會變高、不會多出可捲的
   空間），但**內容盒剛好等於看得見的那一塊**，工具列就留在畫面上。

   所以一共餵四個值給 CSS：

     --kb-h    版面頂端 → 看得見的底端（body 的外框高度）
     --kb-top  被推掉的高度 offsetTop（body 的 padding-top；
               position:fixed 的整頁圖層也要用它讓開）
     --kb-vh   真正看得見的高度（body 的內容盒，也就是所有子結構的高度）
     --kb-inset 版面底端被鍵盤蓋掉的高度（position:fixed 的東西往上讓的量）

   offsetTop 會被 iOS 夾在 0 ~ 鍵盤高度之間（可視區不可能被推出版面視窗
   之外），所以「跟著 offsetTop 讓開」不會跟 iOS 互推到失控——最多就是
   讓到鍵盤高度，那時 app 正好貼齊可視區。
   ========================================================== */

/* 少於這個就不是鍵盤——網址列收合、分頁列變化都只有幾十 px */
const KB_MIN_INSET = 80;

/* 鍵盤的進場動畫大約 250~300ms，中間會連發好幾次 resize。等它安靜這麼久
   才算「到定位了」。太短會又開始一格一格捲，太長則是游標晚回來。 */
const KB_SETTLE_MS = 180;

/* 把判斷抽成純函式，才測得到（visualViewport 沒辦法在測試裡偽造）。
   vv 傳 { height, offsetTop, scale }，innerH 傳 window.innerHeight。 */
function keyboardInsetState(vv, innerH) {
  if (!vv) return { open: false, height: 0, top: 0, viewHeight: 0, inset: 0 };

  /* 使用者雙指放大時 visualViewport 也會變小，那不是鍵盤。
     我們是刻意拿掉 user-scalable=no 讓他可以放大的，所以這個情況一定要
     排除——否則一放大整個版面就縮掉，比原本的問題更糟。 */
  if (vv.scale > 1.05) return { open: false, height: 0, top: 0, viewHeight: 0, inset: 0 };

  /* 這裡有兩個不同的量，不能用同一條式子算——混在一起正是上一版的 bug。

     (1)「有沒有鍵盤」＝ innerHeight − vv.height
        這是螢幕上被鍵盤蓋住的高度。頁面捲到哪裡都不會改變它，所以偵測
        一定要用這一條。

     (2)「固定定位的東西要往上讓多少」＝ innerHeight − offsetTop − vv.height
        固定定位的元素貼的是版面視窗底部，而鍵盤升起時 iOS 會把整個版面
        視窗往上推 offsetTop（好讓游標露出來），所以要扣掉那一段。

     上一版把 offsetTop 折進了 (1)。橫放時可視區只有 364px 左右，iOS 得捲
     很多才能讓游標露出來，那個值就掉到 KB_MIN_INSET 以下——判定成「沒有
     鍵盤」，.kb-open 整個被拿掉，按鈕退回原位躲到鍵盤後面。直放可視區有
     704px，捲的量小，僥倖沒跨過門檻，所以當時只有橫的壞。

     offsetTop 取不到就當 0：少了這道保險，undefined 會讓整串變成 NaN，
     而 NaN <= KB_MIN_INSET 是 false，會一路往下寫進 --kb-h: NaNpx。 */
  const rawOffsetTop = Number(vv.offsetTop) || 0;
  const visibleH = Number(vv.height);
  const covered = innerH - visibleH;                    // (1) 偵測用
  if (!isFinite(covered) || covered <= KB_MIN_INSET) {
    return { open: false, height: 0, top: 0, viewHeight: 0, inset: 0 };
  }

  /* offsetTop 夾在 0 ~ covered 之間。可視區不可能被推到版面視窗外面，
     量到超出範圍的值只會是橡皮筋捲動之類的暫態。
     夾住之後下面幾個值就自動都是合理的：hidden 不會變負（負的 bottom 會把
     浮動按鈕推到鍵盤底下，比不動還糟），visibleBottom 也不會超出畫面。 */
  const offsetTop = Math.min(Math.max(0, rawOffsetTop), covered);

  const visibleBottom = offsetTop + visibleH;
  const hidden = covered - offsetTop;                   // (2) 讓位用
  /* height    ＝版面視窗頂端 → 看得見的底端（body 的外框高度，這樣它的下緣
                 就正好停在鍵盤上緣，而且文件不會長到可以捲）
     top       ＝被 iOS 推掉的那一段（body 的 padding-top，讓內容整個下移，
                 最上面的工具列才不會被推出畫面）
     viewHeight＝真正看得見的高度（body 的內容盒＝所有子結構的高度）
     inset     ＝版面視窗底下被鍵盤蓋掉的高度（給 position:fixed 的東西閃用） */
  return {
    open: true,
    height: visibleBottom,
    top: offsetTop,
    viewHeight: visibleH,
    inset: hidden
  };
}

/* 最後一次量到的鍵盤高度。聚焦的那一刻鍵盤還沒升起，量不到，只能用記得的。
   見 js/documents.js 的 setupCaretRoomOnFocus()。 */
let lastKnownKeyboardInset = 0;

/* 記得的鍵盤高度要存下來，理由跟上面同一條：聚焦的那一刻量不到。

   不存的話，每次重新開啟 app 的**第一次**聚焦都沒有值可以用，只能退回
   保底的十行——而十行在橫放時不夠（橫放鍵盤佔 456px）。存著就只有真正的
   第一次（剛裝好）會用到保底值。

   直放跟橫放分開存：實測 iPad 直放約 420、橫放約 456。存成同一個數字的話，
   轉向之後的第一次聚焦會拿到另一個方向的值——少算就讓不夠位（游標還是被
   鍵盤蓋到），多算就是文章結尾多出一塊沒必要的空白。 */
const KB_HEIGHT_KEY_PREFIX = "wb_kbh_";

/* 分開存之前只有這一個鍵。留著當退路，見 restoreKeyboardHeight()。 */
const KB_HEIGHT_KEY_LEGACY = "wb_kbh";

/* 現在是直的還是橫的。抽成純函式才測得到（innerWidth/Height 偽造不了）。

   用版面的寬高比就夠，不需要 screen.orientation（Safari 16.4 才有）：
   這個值只有在「鍵盤是蓋上來、版面不會縮」的平台上才會被寫入，也就是
   innerHeight 不受鍵盤影響的那些。Android 的版面會自己 resize，但那裡
   根本不會走到這條路（covered 算出來是 0，量不到鍵盤）。 */
function keyboardHeightKey(w, h) {
  return KB_HEIGHT_KEY_PREFIX + (w > h ? "l" : "p");
}

function rememberKeyboardHeight(px) {
  if (!(px > 0)) return;
  lastKnownKeyboardInset = px;
  document.documentElement.style.setProperty("--kb-reserve", Math.round(px) + "px");
  try {
    localStorage.setItem(
      keyboardHeightKey(window.innerWidth, window.innerHeight), String(Math.round(px)));
  } catch (e) {}
}

function restoreKeyboardHeight() {
  let px = 0;
  try {
    px = parseInt(localStorage.getItem(
      keyboardHeightKey(window.innerWidth, window.innerHeight)), 10);

    /* 分開存之前的人只有舊的那一個鍵。讀不到新的就退回去用它——不然這些人
       等於回到「第一次聚焦沒有值可用」的狀態，白白退步一次。
       下次鍵盤升起就會寫進新的鍵，這條退路每個方向只會走一次。 */
    if (!isFinite(px) || px <= 0) {
      px = parseInt(localStorage.getItem(KB_HEIGHT_KEY_LEGACY), 10);
    }
  } catch (e) {}
  if (!isFinite(px) || px <= 0) return;
  lastKnownKeyboardInset = px;
  document.documentElement.style.setProperty("--kb-reserve", px + "px");
}

function applyKeyboardInset() {
  const vv = window.visualViewport;
  if (!vv) return;
  const root = document.documentElement;
  const state = keyboardInsetState(vv, window.innerHeight);

  if (state.open) {
    /* 記的是「螢幕上被鍵盤蓋住的高度」，不是 state.inset——後者已經扣掉
       版面被推上去的量，下次聚焦時那個量還不存在，用它會低估。 */
    const covered = window.innerHeight - Number(vv.height);
    rememberKeyboardHeight(covered);
    root.style.setProperty("--kb-h", state.height + "px");
    root.style.setProperty("--kb-top", state.top + "px");
    root.style.setProperty("--kb-vh", state.viewHeight + "px");
    root.style.setProperty("--kb-inset", state.inset + "px");
    root.classList.add("kb-open");
  } else {
    root.classList.remove("kb-open");
    root.style.removeProperty("--kb-h");
    root.style.removeProperty("--kb-top");
    root.style.removeProperty("--kb-vh");
    root.style.removeProperty("--kb-inset");
  }
}

function setupKeyboardInset() {
  /* 這一行要在 !vv 的守門之前：--kb-reserve 是給編輯區預留捲動空間用的，
     那條 CSS 只看 .kb-pending（聚焦就掛），完全不依賴 visualViewport。
     沒有這個 API 的瀏覽器一樣要拿得到記得的鍵盤高度。 */
  restoreKeyboardHeight();

  const vv = window.visualViewport;
  if (!vv) return;   // 沒有這個 API 的瀏覽器維持原本的行為

  vv.addEventListener("resize", applyKeyboardInset);

  /* offsetTop 改變時 iOS 發的是 scroll，不是 resize。

     鍵盤升起之後，iOS 還會為了讓游標露出來把整個版面視窗再往上推，那一下
     只有 scroll 會通知我們。少聽這一個的話，鍵盤剛升起的那一刻算出來的值
     是對的，接下來被推上去多少就錯多少——浮動按鈕浮在半空、畫面下方露出
     一條黑帶。 */
  vv.addEventListener("scroll", applyKeyboardInset);

  /* 鍵盤升起／收起都會改變「看得見的底」在哪裡，游標的位置要重新確認一次。

     這裡一定要等動畫停下來再做，不能每個 resize 都做。

     鍵盤是**滑上來**的，滑的過程中 visualViewport 會連續發好幾次 resize，
     每一次量到的 vv.height 都不一樣（鍵盤還沒到定位）。照著每一次的值去補
     捲，就會捲一點、再捲一點、再捲一點——使用者看到的就是「捲上去的時候
     會跳動」。兩個平台都有，因為兩邊的鍵盤都是動畫進場的。

     改成只在「最後一次 resize 之後還安靜了 180ms」才做一次。動畫期間游標
     可能短暫看不到，但那只有幾百毫秒，而且聚焦當下已經用記得的鍵盤高度
     先捲到最終位置了（setupCaretRoomOnFocus），這一次多半根本不用動。 */
  let caretSettleTimer = null;
  vv.addEventListener("resize", function() {
    if (caretSettleTimer) clearTimeout(caretSettleTimer);
    caretSettleTimer = setTimeout(function() {
      caretSettleTimer = null;
      /* 動畫已經停了，游標可能落在任何地方，所以用精準的量法（允許重排）。
         這是一次性的時機，不是每一鍵，成本付得起。 */
      if (typeof scheduleCaretRoomCheck === "function") scheduleCaretRoomCheck(true);
    }, KB_SETTLE_MS);
  });
  window.addEventListener("orientationchange", function() {
    /* 轉向之後換一個方向的鍵盤高度。要等版面轉完再讀，不然 innerWidth /
       innerHeight 還是舊的，會挑到同一個鍵。
       排在 applyKeyboardInset 之前：鍵盤當下就開著的話，那邊會重新量一次
       把值蓋掉，那是更準的。 */
    setTimeout(function() {
      restoreKeyboardHeight();
      applyKeyboardInset();
    }, 250);
  });

  /* iOS 的鍵盤是動畫升上來的，resize 有時候在動畫跑完之前就先發了一次，
     那一次量到的高度是中途的值。延遲再對一次，收斂到最後的狀態。 */
  vv.addEventListener("resize", function() {
    setTimeout(applyKeyboardInset, 300);
  });

  applyKeyboardInset();
}

/* ==========================================================
   右滑打開目錄欄

   手機上要開目錄只能點左上角那顆 ☰，單手拿著的時候拇指構不到。
   從畫面左緣往右滑是這個位置最自然的手勢。

   為什麼只認「從左緣起手」，不是整片都能右滑：
   白板的平移、內文的選字、目錄的左右捲動本來就都是水平拖曳，整片都攔
   的話那些全部會失效。左緣那一條窄帶沒有別的東西要用，iOS 自己的返回
   手勢也是同一個做法。

   為什麼在 touchmove 才決定要不要接手，而不是 touchstart：
   在 touchstart 就攔掉的話，點在最左邊那一條（例如想把游標放在某一行的
   開頭）會被吃掉。改成等第一次真的移動、而且方向是橫的，才把事件擋下來
   ——這樣白板連一格都不會先平移，點擊也不受影響。
   ========================================================== */

const EDGE_SWIPE_ZONE_PX = 28;   // 左緣多寬算「從邊緣起手」
const EDGE_SWIPE_MIN_PX = 56;    // 滑多遠才算數
const EDGE_SWIPE_SLOPE = 1.2;    // 水平位移要比垂直明顯這麼多倍
const EDGE_SWIPE_DECIDE_PX = 4;  // 移動超過這麼多才判斷方向

let edgeSwipe = null;

/* 左緣那一條窄帶到哪裡為止。

   手機版世界觀那一欄會轉成底部橫列，畫面最左邊就是內容，所以從 0 算起。
   平板／電腦版它是最左邊的直欄（62px），從螢幕邊緣起手的手指一定先碰到
   它——窄帶要從它的右緣再往右算，不然平板上永遠滑不開。 */
function edgeSwipeZoneRight() {
  if (isMobileLayout()) return EDGE_SWIPE_ZONE_PX;
  const rail = document.getElementById("appWorldRail");
  const w = rail ? rail.getBoundingClientRect().width : 0;
  return w + EDGE_SWIPE_ZONE_PX;
}

/* 手勢結束之後，把瀏覽器可能補上的那一下 click 吃掉。

   平板上這條窄帶蓋在世界觀直欄上，起手點常常正好落在某顆世界觀按鈕上。
   沒有這一段的話，滑開目錄的同時會順手切換世界觀。

   只吃一下、而且 400ms 後自動拆掉，免得之後的正常點擊被牽連。 */
function swallowNextClick() {
  let timer = null;
  const kill = function(ev) {
    ev.preventDefault();
    ev.stopPropagation();
    cleanup();
  };
  const cleanup = function() {
    clearTimeout(timer);
    document.removeEventListener("click", kill, true);
  };
  document.addEventListener("click", kill, true);
  timer = setTimeout(cleanup, 400);
}

function setupEdgeSwipe() {
  document.addEventListener("touchstart", function(e) {
    edgeSwipe = null;
    /* 用手指操作的裝置才要這個手勢。原本寫的是 !isMobileLayout() 就跳出，
       於是 iPad（1024×768、820×1180）永遠不算——它的版面是桌機版。
       「有沒有手指」跟「版面寬不寬」是兩件事。 */
    if (!isMobileLayout() && !isTouchPrimary()) return;
    if (e.touches.length !== 1) return;                  // 雙指是縮放，不是滑開目錄
    if (document.querySelector(".modal-overlay.active")) return;

    const t = e.touches[0];
    const open = sidebarIsOpen();

    if (!open) {
      if (t.clientX > edgeSwipeZoneRight()) return;      // 沒有從左緣起手
    } else {
      // 開著的時候，在目錄欄或它的遮罩上往左滑可以收起來
      if (!e.target.closest("#appSidebar, #sidebarOverlay")) return;
    }

    edgeSwipe = { x0: t.clientX, y0: t.clientY, open: open, claimed: false, done: false };
  }, true);

  document.addEventListener("touchmove", function(e) {
    if (!edgeSwipe) return;

    /* 已經接手過的手勢，剩下的移動也要一路擋到放手為止。

       只擋到「抽屜打開為止」是不夠的：一次滑動會送出好幾個 touchmove，
       抽屜在中途就開了，後面那幾個如果放行，白板會拿它們去平移——而且
       它算的位移是從手指按下的位置起算的，所以會一口氣跳一大段
       （實測滑 132px，白板就平移了 132px）。 */
    if (edgeSwipe.done) {
      e.stopPropagation();
      if (e.cancelable) e.preventDefault();
      return;
    }

    const t = e.touches[0];
    const dx = t.clientX - edgeSwipe.x0;
    const dy = t.clientY - edgeSwipe.y0;

    if (!edgeSwipe.claimed) {
      if (Math.abs(dx) < EDGE_SWIPE_DECIDE_PX && Math.abs(dy) < EDGE_SWIPE_DECIDE_PX) return;

      /* 目錄裡有一列已經被拿起來了（或正在拖）：這一段移動是在搬東西，
         不是要收目錄。不讓的話，拿起來之後往左下拖，目錄會被收掉、
         拖曳被砍掉。 */
      if (typeof touchDragInProgress === "function" && touchDragInProgress()) {
        edgeSwipe = null;
        return;
      }

      // 方向不對（往上下捲、或往反方向）就整個放手，讓原本的行為照常
      const wantRight = !edgeSwipe.open;
      const horizontal = Math.abs(dx) > Math.abs(dy) * EDGE_SWIPE_SLOPE;
      const rightDirection = wantRight ? dx > 0 : dx < 0;
      if (!horizontal || !rightDirection) { edgeSwipe = null; return; }
      edgeSwipe.claimed = true;
    }

    /* 接手之後這一連串事件都不要再往下傳，白板才不會同時平移。
       preventDefault 擋掉捲動；touchmove 必須是 passive:false 才擋得掉。 */
    e.stopPropagation();
    if (e.cancelable) e.preventDefault();

    if (Math.abs(dx) < EDGE_SWIPE_MIN_PX) return;
    edgeSwipe.done = true;
    if (edgeSwipe.open) closeSidebarMenu();
    else openSidebarMenu();
  }, { capture: true, passive: false });

  const finish = function(e) {
    if (edgeSwipe && edgeSwipe.claimed) {
      e.stopPropagation();
      swallowNextClick();
    }
    edgeSwipe = null;
  };
  document.addEventListener("touchend", finish, true);
  document.addEventListener("touchcancel", finish, true);
}

/* ==========================================================
   從底部那一列往上滑 → 世界觀清單

   手機版世界觀那一欄會轉成底部的橫列，上面只有圖示。世界觀一多就認不出
   哪個是哪個，而那一列本身沒有空間放名稱。往上滑把完整清單拉出來。

   那一列的手勢預算：橫向捲動（世界觀多的時候本來就會捲）、點按鈕切換。
   **往上**沒有人用，所以拿它不會打到任何東西。

   跟左緣右滑（setupEdgeSwipe）同一套寫法，理由也一樣：

   - 在 touchmove 才決定要不要接手，不在 touchstart。在 touchstart 就攔掉
     的話，點那一列上的按鈕會被吃掉。
   - 方向不對（橫的、或往下）就整個放手，讓那一列照常橫向捲動。
   - 接手之後要 swallowNextClick()。起手點幾乎一定落在某顆世界觀按鈕上，
     沒有這一段的話，滑開清單的同時會順手切換世界觀。
   ========================================================== */

const RAIL_SWIPE_MIN_PX = 40;     // 往上滑多遠才算數
const RAIL_SWIPE_SLOPE = 1.2;     // 垂直位移要比水平明顯這麼多倍
const RAIL_SWIPE_DECIDE_PX = 4;   // 移動超過這麼多才判斷方向

let railSwipe = null;

function setupRailSwipeUp() {
  const rail = document.getElementById("appWorldRail");
  if (!rail) return;

  rail.addEventListener("touchstart", function(e) {
    railSwipe = null;
    /* 只有「那一列在底下」的時候才有這個手勢。桌機／平板版它是左邊的直欄，
       往上滑在那裡的意思是捲動世界觀清單本身。 */
    if (!isMobileLayout()) return;
    if (e.touches.length !== 1) return;
    if (document.querySelector(".modal-overlay.active")) return;

    const t = e.touches[0];
    railSwipe = { x0: t.clientX, y0: t.clientY, claimed: false, done: false };
  }, { passive: true });

  rail.addEventListener("touchmove", function(e) {
    if (!railSwipe || railSwipe.done) return;

    const t = e.touches[0];
    const dx = t.clientX - railSwipe.x0;
    const dy = t.clientY - railSwipe.y0;

    if (!railSwipe.claimed) {
      if (Math.abs(dx) < RAIL_SWIPE_DECIDE_PX && Math.abs(dy) < RAIL_SWIPE_DECIDE_PX) return;
      const upward = dy < 0 && Math.abs(dy) > Math.abs(dx) * RAIL_SWIPE_SLOPE;
      if (!upward) { railSwipe = null; return; }
      railSwipe.claimed = true;
    }

    // 接手之後不要讓那一列同時橫向捲動
    e.stopPropagation();
    if (e.cancelable) e.preventDefault();

    if (Math.abs(dy) < RAIL_SWIPE_MIN_PX) return;
    railSwipe.done = true;
    openWorldListModal();
  }, { passive: false });

  const finish = function() {
    if (railSwipe && railSwipe.claimed) swallowNextClick();
    railSwipe = null;
  };
  rail.addEventListener("touchend", finish);
  rail.addEventListener("touchcancel", finish);
}

/* ==========================================================
   鍵盤診斷

   這個環境裝不起 WebKit，iOS 上鍵盤到底發生什麼事只有使用者的機器知道。
   前面已經有三輪是靠推理猜出來的，猜錯一次就是整輪白查（見 NOTES.md
   的 3c）。與其再猜，不如讓那台機器自己把數字講出來。

   決定性的三個問題，這面板一眼就答得出來：

     kbOpen=false          → 根本沒偵測到鍵盤（vv.height 沒縮）
     kbOpen=true, padTop=0, vvTop>0
                           → 偵測到了，但讓位的 CSS 沒生效（多半是跑著舊版）
     navTop < 0            → 上面的工具列還是被推出畫面
     fabTop > vvH          → 浮動按鈕還藏在鍵盤後面

   狀態記在 localStorage——使用者要先打開、關掉設定、點進內文把鍵盤叫出來，
   中間隔了好幾步，不記著就白開了。

   開關藏在設定裡「版本」那一列的長按選單裡，不佔一列：這是回報問題時才用
   得到的工具，平常不該一直在那邊。藏在版本那一列是因為那裡本來就是
   「回報問題時請附上」的那一列。
   ========================================================== */

const KB_DIAG_KEY = "wb_kbdiag";

function kbDiagEnabled() {
  try { return localStorage.getItem(KB_DIAG_KEY) === "1"; } catch (e) { return false; }
}

function toggleKbDiag() {
  const next = !kbDiagEnabled();
  try { localStorage.setItem(KB_DIAG_KEY, next ? "1" : "0"); } catch (e) {}
  applyKbDiagVisibility();
}

/* 把開關掛到設定裡「版本」那一列的長按（或右鍵）選單。

   用 attachContextMenu() 而不是自己寫長按：它已經處理過 iPad 上那一串麻煩
   事——長按之後放開手指會補一個假的 click，不擋掉的話會順便觸發那一列原本
   的「檢查更新」（見 NOTES 的 3a）。 */
function setupKbDiagEntry() {
  const row = document.getElementById("versionRow");
  if (!row || typeof attachContextMenu !== "function") return;

  attachContextMenu(row, function() {
    return [{
      icon: "\u{1FA7A}",
      label: kbDiagEnabled() ? "關掉鍵盤診斷" : "打開鍵盤診斷",
      action: toggleKbDiag
    }];
  }, function() { return "\u{1FA7A} 疑難排解"; });
}

function applyKbDiagVisibility() {
  const panel = document.getElementById("kbDiagPanel");
  if (!panel) return;
  panel.classList.toggle("active", kbDiagEnabled());
  if (kbDiagEnabled()) updateKbDiag();
}

/* 量一個數字，量不到就回 "?"。整個面板不能因為某一項拿不到就整個消失——
   拿不到本身就是情報。 */
function kbDiagNum(fn) {
  try {
    const v = fn();
    if (v === null || v === undefined) return "?";
    return typeof v === "number" ? Math.round(v) : String(v);
  } catch (e) { return "?"; }
}

function kbDiagLines() {
  const root = document.documentElement;
  const cs = getComputedStyle(root);
  const bs = getComputedStyle(document.body);
  const vv = window.visualViewport;
  const nav = document.querySelector("header.top-nav-bar");
  const fab = document.getElementById("quickJumpFab");

  function cssVar(name) {
    const raw = cs.getPropertyValue(name).trim();
    return raw === "" ? "—" : raw;
  }

  return [
    ["standalone", kbDiagNum(function() {
      return (window.navigator.standalone === true ||
              window.matchMedia("(display-mode: standalone)").matches) ? "yes" : "no";
    })],
    ["stale", (typeof pageCodeStale !== "undefined" && pageCodeStale) ? "YES 舊程式碼" : "no"],
    ["inner", kbDiagNum(function() { return window.innerWidth; }) + "x" +
              kbDiagNum(function() { return window.innerHeight; })],
    ["vv", kbDiagNum(function() { return vv.width; }) + "x" +
           kbDiagNum(function() { return vv.height; })],
    ["vvTop", kbDiagNum(function() { return vv.offsetTop; })],
    ["scale", kbDiagNum(function() { return Math.round(vv.scale * 100) / 100; })],
    ["scrollY", kbDiagNum(function() { return window.scrollY; })],
    ["kbOpen", root.classList.contains("kb-open") ? "true" : "FALSE"],
    ["kbPending", root.classList.contains("kb-pending") ? "true" : "false"],
    ["--kb-h/top/vh/inset", cssVar("--kb-h") + " / " + cssVar("--kb-top") + " / " +
                            cssVar("--kb-vh") + " / " + cssVar("--kb-inset")],
    ["--kb-reserve", cssVar("--kb-reserve")],
    ["padBottom", kbDiagNum(function() {
      return getComputedStyle(document.querySelector(".editor-content-area")).paddingBottom;
    })],
    ["bodyPadTop", bs.paddingTop],
    ["bodyH", bs.height],
    ["navTop", kbDiagNum(function() { return nav.getBoundingClientRect().top; })],
    ["fabTop", kbDiagNum(function() { return fab.getBoundingClientRect().top; })],
    ["focus", document.activeElement ? (document.activeElement.id || document.activeElement.tagName) : "—"],
    /* 這次聚焦一共補捲了幾次、每次多少。會跳動就是這裡不只一筆。 */
    /* 上一次是用哪一種方法量游標的。寫 mirror 幾 ms 就代表主執行緒被鎖了
       那麼久——使用者說的「卡」就是它。 */
    ["caretMeasure", (typeof caretMeasureHow !== "undefined") ? caretMeasureHow : "?"],
    ["caretScrolls", (typeof caretScrollLog !== "undefined")
      ? (caretScrollLog.length + (caretScrollLog.length ? " (" + caretScrollLog.join(", ") + ")" : ""))
      : "?"]
  ];
}

function updateKbDiag() {
  const panel = document.getElementById("kbDiagPanel");
  if (!panel || !kbDiagEnabled()) return;

  const body = document.getElementById("kbDiagBody");
  if (body) {
    body.textContent = kbDiagLines().map(function(r) { return r[0] + ": " + r[1]; }).join("\n");
  }

  /* 面板自己也要閃開被推掉的那一段，否則它會跟工具列一起被推出畫面——
     而那正是最需要看到它的時候。這裡不用 --kb-top：那個變數只有在偵測到
     鍵盤時才有值，而「沒偵測到」正是要診斷的情況之一。 */
  const vv = window.visualViewport;
  const top = vv ? (Number(vv.offsetTop) || 0) : 0;
  panel.style.top = (top + 8) + "px";
}

function copyKbDiag() {
  const text = kbDiagLines().map(function(r) { return r[0] + ": " + r[1]; }).join("\n");
  const btn = document.getElementById("kbDiagCopyBtn");
  function done(ok) { if (btn) btn.textContent = ok ? "已複製" : "複製失敗"; }

  try {
    navigator.clipboard.writeText(text).then(function() { done(true); }, function() { done(false); });
  } catch (e) {
    done(false);
  }
}

function setupKbDiag() {
  setupKbDiagEntry();
  applyKbDiagVisibility();
  if (!kbDiagEnabled()) return;

  const vv = window.visualViewport;
  if (vv) {
    vv.addEventListener("resize", updateKbDiag);
    vv.addEventListener("scroll", updateKbDiag);
  }
  window.addEventListener("resize", updateKbDiag);
  document.addEventListener("focusin", updateKbDiag);
  document.addEventListener("focusout", updateKbDiag);

  /* iOS 的鍵盤是動畫升上來的，事件未必落在最後的狀態；而且我們要的是
     「穩定之後的數字」。只有開著診斷時才跑這個計時器。 */
  setInterval(updateKbDiag, 500);
}
