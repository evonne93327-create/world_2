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
         本身，讓 Tab 從這裡開始往下走，而不是從頁面最上面。

         但觸控裝置不能這樣做：聚焦輸入框會把軟體鍵盤叫出來，鍵盤又會把
         彈窗往上擠掉半個畫面。像「編輯人物關係」這種一打開就先想看內容、
         未必要改字的彈窗，鍵盤是純粹的干擾——手機上沒有 Tab 鍵要導航，
         聚焦本來就沒有它在桌機上的價值。所以這裡只在有實體鍵盤的裝置
         才自動聚焦輸入框；觸控裝置一律聚焦卡片本身，使用者真的要打字時
         自己點那個欄位。 */
      const input = isTouchPrimary()
        ? null
        : targets.find(function(n) { return /^(INPUT|TEXTAREA|SELECT)$/.test(n.tagName); });
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
   ========================================================== */

/* 少於這個就不是鍵盤——網址列收合、分頁列變化都只有幾十 px */
const KB_MIN_INSET = 80;

/* 把判斷抽成純函式，才測得到（visualViewport 沒辦法在測試裡偽造）。
   vv 傳 { height, scale }，innerH 傳 window.innerHeight。 */
function keyboardInsetState(vv, innerH) {
  if (!vv) return { open: false, height: 0 };

  /* 使用者雙指放大時 visualViewport 也會變小，那不是鍵盤。
     我們是刻意拿掉 user-scalable=no 讓他可以放大的，所以這個情況一定要
     排除——否則一放大整個版面就縮掉，比原本的問題更糟。 */
  if (vv.scale > 1.05) return { open: false, height: 0 };

  const hidden = innerH - vv.height;
  if (hidden <= KB_MIN_INSET) return { open: false, height: 0 };
  return { open: true, height: vv.height };
}

function applyKeyboardInset() {
  const vv = window.visualViewport;
  if (!vv) return;
  const root = document.documentElement;
  const state = keyboardInsetState(vv, window.innerHeight);

  if (state.open) {
    root.style.setProperty("--kb-h", state.height + "px");
    root.classList.add("kb-open");
  } else {
    root.classList.remove("kb-open");
    root.style.removeProperty("--kb-h");
  }
}

function setupKeyboardInset() {
  const vv = window.visualViewport;
  if (!vv) return;   // 沒有這個 API 的瀏覽器維持原本的行為

  vv.addEventListener("resize", applyKeyboardInset);
  window.addEventListener("orientationchange", function() {
    setTimeout(applyKeyboardInset, 250);
  });

  /* iOS 的鍵盤是動畫升上來的，resize 有時候在動畫跑完之前就先發了一次，
     那一次量到的高度是中途的值。延遲再對一次，收斂到最後的狀態。 */
  vv.addEventListener("resize", function() {
    setTimeout(applyKeyboardInset, 300);
  });

  applyKeyboardInset();
}
