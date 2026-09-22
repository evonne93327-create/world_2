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
  setupAnchoredPopoverFollow();
  setupDirectoryContextMenu();
  setupDeleteKeyShortcut();
  setupGlobalKeyboardShortcuts();
  setupEditorEnterIndent();
  setupHistoryNavigation();
  setupKeyboardInset();
  setupCaretRoomOnFocus();
  setupKbDiag();
  setupEdgeSwipe();
  initSync();
  initSyncRecovery();
  setupModalKeyboard();
  initTheme();
  initIdleBackupReminder();
  registerServiceWorker();

  window.addEventListener("resize", function() {
    autoGrowTextarea(document.getElementById("docContentInput"));
  });
});

/* 註冊 service worker，讓 app 可以安裝到主畫面並離線使用。
   只在 https 或 localhost 底下有效；用 file:// 直接開會靜默略過。 */

// 開著不動也要能發現新版，不然裝成 app 的人可能好幾天都停在舊版
const SW_UPDATE_CHECK_MS = 30 * 60 * 1000;

/* 註冊結果收著，設定裡那一列「檢查更新」要用它強制問一次伺服器。 */
let swRegistration = null;

/* 主動去問伺服器有沒有新版，回傳一個 promise。

   reg.update() 只是「去檢查」，檢查完不代表新的 worker 已經裝好——安裝是
   接著才跑的，而 sw.js 有 skipWaiting()，裝好就會接管並觸發
   controllerchange（那裡會 markPageCodeStale()）。所以這裡要等的不是
   update() 本身，是「有沒有冒出一個正在安裝的 worker，它裝完了沒」。

   等不到就放行：使用者按了按鈕，不能讓畫面卡在「檢查中…」下不來。
   反正真的有新版時 controllerchange 還是會來，那一行自己會更新。 */
function forceUpdateCheck() {
  if (!swRegistration) return Promise.resolve();

  return swRegistration.update().then(function() {
    const incoming = swRegistration.installing || swRegistration.waiting;
    if (!incoming) return;

    return new Promise(function(resolve) {
      const timer = setTimeout(resolve, 4000);
      incoming.addEventListener("statechange", function() {
        if (incoming.state === "installed" || incoming.state === "activated" ||
            incoming.state === "redundant") {
          clearTimeout(timer);
          resolve();
        }
      });
    });
  }).catch(function() { /* 離線或註冊失敗：讓呼叫端照常往下走 */ });
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  if (location.protocol !== "https:" && location.hostname !== "localhost" &&
      location.hostname !== "127.0.0.1") return;

  // 要在 register() 之前就抓，而且要抓在最前面。
  // sw.js 有 skipWaiting() + clients.claim()，新的 worker 一裝好就立刻接管，
  // 晚一步去看 controller 就分不出「第一次安裝」和「更新」了。
  let hadController = !!navigator.serviceWorker.controller;

  // 新 worker 接管的那一刻。第一次安裝與更新都會觸發，靠上面那個旗標區分。
  // 用這個而不是只靠 updatefound：register() 回傳時，第一次安裝的
  // updatefound 可能已經發生過了，監聽器掛上去也接不到。
  navigator.serviceWorker.addEventListener("controllerchange", function() {
    if (!hadController) { hadController = true; return; }
    markPageCodeStale();
    showUpdateModal();
  });

  navigator.serviceWorker.register("sw.js").then(function(reg) {
    swRegistration = reg;

    // 備援路徑：萬一哪天 sw.js 拿掉了 skipWaiting，新 worker 會停在 waiting
    // 不接管，controllerchange 就不會來，這時要靠 updatefound 才發現得到。
    reg.addEventListener("updatefound", function() {
      const incoming = reg.installing;
      if (!incoming || !hadController) return;
      incoming.addEventListener("statechange", function() {
        if (incoming.state === "installed" || incoming.state === "activated") {
          markPageCodeStale();
          showUpdateModal();
        }
      });
    });

    // 每次開起來先問一次伺服器有沒有新版
    reg.update().catch(function() {});
    setInterval(function() { reg.update().catch(function() {}); }, SW_UPDATE_CHECK_MS);
  }).catch(function(e) {
    // 註冊失敗只代表沒有離線能力，app 本身照常運作，不需要打擾使用者
    console.warn("Service worker 註冊失敗：", e);
  });
}

/* 這一頁載入之後，底下的程式碼被換掉了嗎。

   sw.js 有 skipWaiting() + clients.claim()，新的 worker 一裝好就**立刻接管
   已經開著的這一頁**。於是會出現一個很會騙人的狀態：

     設定裡的版本顯示 v60（那是問 worker 拿到的）
     但這一頁的 style.css / js 還是載入當下那一版的

   使用者看到 v60、以為在跑新版，回報「改了還是一樣」——而其實新版的
   CSS 根本還沒套用。這一輪就真的發生了，白查了一整輪。

   所以只要接管過，就把這一頁標記成「跑的是舊程式碼」，版本那一行要講出來。
   這比顯示哪個版號更重要：使用者要的答案是「我看到的是不是你改的那一版」。 */
let pageCodeStale = false;

function markPageCodeStale() {
  pageCodeStale = true;
  if (typeof renderVersionRow === "function") renderVersionRow();
}

/* 偵測到新版時提示，但不自動重載。

   靜默重載很誘人（反正資料都在 localStorage），但正在打字的人被硬生生
   重整會很惱火，而且捲動位置、展開的資料夾、白板的平移縮放都會跑掉。
   什麼時候換版讓使用者自己決定。 */

let updateModalShown = false;
let updatePendingTimer = null;

/* 有別的彈窗開著時不要疊上去。更新沒有急迫性，等對方關掉再說——
   使用者正在改標籤分類或解同步衝突，被蓋一層新彈窗只會讓人不知所措。 */
function otherModalOpen() {
  const open = document.querySelector(".modal-overlay.active");
  return !!open && open.id !== "updateModal";
}

/* force＝使用者自己按了「檢查更新」。

   底下那兩道閘門都是為了「不要吵人」而設的，對自動偵測是對的，但使用者
   主動問的時候必須讓路：按掉過一次就再也叫不出來、或者默默排隊等別的彈窗
   關掉——兩種都會變成「我按了按鈕卻什麼都沒發生」，比不做還糟。 */
function showUpdateModal(force) {
  if (updateModalShown && !force) return;     // 一次就好，不要每次檢查都跳
  const el = document.getElementById("updateModal");
  if (!el) return;

  if (otherModalOpen() && !force) {
    // 排隊重試，而不是直接放棄——放棄的話這次更新就再也不會通知了
    if (!updatePendingTimer) {
      updatePendingTimer = setInterval(function() {
        if (updateModalShown) { clearInterval(updatePendingTimer); updatePendingTimer = null; return; }
        if (!otherModalOpen()) showUpdateModal();
      }, 5000);
    }
    return;
  }

  if (updatePendingTimer) { clearInterval(updatePendingTimer); updatePendingTimer = null; }
  updateModalShown = true;
  el.classList.add("active");
}

function dismissUpdateModal() {
  const el = document.getElementById("updateModal");
  if (el) el.classList.remove("active");
}

function reloadForUpdate() {
  dismissUpdateModal();
  location.reload();
}
