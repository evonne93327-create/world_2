/* ==========================================================
   日間／夜間模式

   偏好存在 localStorage，刻意不放進 appData：主題是「這台裝置」的事。
   iPad 晚上想用暗的、電腦想用亮的，放進 appData 會被雲端同步互相覆蓋。

   解析後的結果寫成 <html data-theme="light|dark">，CSS 與 JS 都只看這一個
   值（見 ui-tokens.css 的夜間區塊與 state.js 的 isDarkTheme）。讓 JS 成為
   唯一的判斷來源，是因為白板節點底色、連線顏色這些是 JS 直接寫進 style 的，
   CSS 的 @media (prefers-color-scheme) 管不到它們——兩邊各自解讀就會出現
   一半亮一半暗的畫面。

   index.html 的 <head> 裡有一份同樣邏輯的極短版，在 CSS 生效前先跑一次，
   避免夜間模式開場閃一下白畫面。兩邊的 key 必須一致。
   ========================================================== */

const THEME_KEY = "wb_theme";                     // 與 index.html <head> 內那份一致
const THEME_CHOICES = ["auto", "light", "dark"];

function getThemePref() {
  try {
    const v = safeStorageGet(THEME_KEY);
    return THEME_CHOICES.indexOf(v) >= 0 ? v : "auto";
  } catch (e) {
    return "auto";
  }
}

function systemPrefersDark() {
  return !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
}

function resolveTheme(pref) {
  if (pref === "light" || pref === "dark") return pref;
  return systemPrefersDark() ? "dark" : "light";
}

function applyTheme(pref) {
  const resolved = resolveTheme(pref || getThemePref());
  document.documentElement.setAttribute("data-theme", resolved);

  // 瀏覽器自己的外框（iOS 的狀態列、Android 的網址列）也要跟著換，
  // 不然深色的 app 頂著一條米色的列
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg-main").trim();
    if (bg) meta.setAttribute("content", bg);
  }
  return resolved;
}

function setThemePref(pref) {
  if (THEME_CHOICES.indexOf(pref) < 0) pref = "auto";
  try { safeStorageSet(THEME_KEY, pref); } catch (e) {}
  applyTheme(pref);
  repaintThemedContent();
  renderThemeChoice();
  renderSettingsRows();
}

/* CSS 變數換完畫面就跟著變了，但有幾處顏色是 JS 直接寫進 style 的：
   白板節點的底色、連線與箭頭、標籤色卡。那些得重畫才會換過來。 */
function repaintThemedContent() {
  if (typeof refreshCanvasIfVisible === "function") refreshCanvasIfVisible();
  if (typeof renderSidebarTree === "function") renderSidebarTree();

  if (typeof renderLiveHashtags === "function" && typeof appData !== "undefined" && appData.docs) {
    const doc = appData.docs.find(function(d) { return d.id === activeDocId; });
    if (doc) renderLiveHashtags(doc.tags || []);
  }

  const filter = document.getElementById("hashtagFilterModal");
  if (filter && filter.classList.contains("active") && typeof renderHashtagFilterModal === "function") {
    renderHashtagFilterModal();
  }
}

/* ---------- 設定視窗 ----------

   設定是一張總表，每一列點進去開各自的視窗。原本散在世界觀欄、目錄
   工具欄、目錄欄底部與頂部導覽列的四個入口都收到這裡來。

   點進子視窗時會先把設定關掉，不讓兩個彈窗疊著——它們的 z-index 一樣，
   疊起來只是靠 DOM 順序分勝負，很脆。

   子視窗關掉之後一律回到設定總表。從總表點進去的人心裡是「進了一層」，
   關掉那一層應該退回上一層，而不是整個關光回到主畫面——尤其是垃圾桶、
   匯出這種「處理完還想順手調別的」的地方。原本只有外觀會回來，其他四個
   關掉就直接掉回主畫面，同一個位置點進去的東西行為卻不一樣。
   ------------------------------------------------------------- */

function openSettingsModal() {
  renderSettingsRows();
  document.getElementById("settingsModal").classList.add("active");
}

function closeSettingsModal() {
  settingsChildModalId = null;   // 是使用者自己關掉總表，不要再回來
  document.getElementById("settingsModal").classList.remove("active");
}

/* 從設定點進去的那個子視窗的 id。只記一個：設定一次只會開出一層。 */
let settingsChildModalId = null;

function settingsGoTo(open) {
  closeSettingsModal();
  if (typeof open !== "function") return;
  open();

  /* 哪一個彈窗被打開了，由「開完之後誰是 active」決定，不用在每個
     settingsGoTo(...) 的呼叫點各自寫死 id——那種東西一定會有人漏掉。
     匯入是叫出檔案選擇器、根本沒開彈窗，這時候就什麼都不記。 */
  const opened = document.querySelectorAll(".modal-overlay.active");
  settingsChildModalId = opened.length ? opened[opened.length - 1].id : null;
  if (settingsChildModalId) watchSettingsChild(settingsChildModalId);
}

/* 子視窗關掉時把設定叫回來。

   用 MutationObserver 而不是去改每個 closeXxxModal()：那些關閉函式有五個，
   而且有些（垃圾桶）還會從別的入口打開，在裡面寫死「關掉就開設定」會讓
   從別處進來的人莫名其妙跳出設定。這裡只認「這一次是從設定點進去的」。 */
const settingsChildWatched = {};

function watchSettingsChild(id) {
  if (settingsChildWatched[id]) return;
  const modal = document.getElementById(id);
  if (!modal) return;
  settingsChildWatched[id] = true;

  new MutationObserver(function() {
    if (modal.classList.contains("active")) return;
    if (settingsChildModalId !== id) return;
    settingsChildModalId = null;

    /* 子視窗自己又開了別的彈窗（垃圾桶裡的「確定永久刪除？」）時不要插隊，
       等那一層也收掉了再回來——否則設定會蓋在確認視窗底下。 */
    if (document.querySelector(".modal-overlay.active")) return;
    openSettingsModal();
  }).observe(modal, { attributes: true, attributeFilter: ["class"] });
}

function renderSettingsRows() {
  const v = document.getElementById("appearanceRowValue");
  if (v) {
    const pref = getThemePref();
    v.textContent = pref === "light" ? "日間" : (pref === "dark" ? "夜間" : "跟隨系統");
  }
  if (typeof renderSyncIndicator === "function") renderSyncIndicator();
  renderVersionRow();
}

/* 目前跑的是哪一版。

   版號的單一來源是 sw.js 裡的 VERSION——它本來就得跟著每次改動加一號
   （見 NOTES.md 的硬規則 2），拿它當版本號就不會有「有人忘了同步」的問題。
   不在 HTML 裡另寫一份：那會變成第二個要記得改的地方，遲早對不上，
   而這一行存在的理由正是「不要用猜的」。

   兩個值要分清楚，混在一起這一行就會在最需要它的時候說謊：
     正在跑的 ＝ 問目前接管這一頁的 service worker（postMessage）
     伺服器上的 ＝ fetch sw.js 帶 no-store
   使用者還沒換版時這兩個不一樣，而那正是「為什麼我修好的東西他看不到」
   的答案。只顯示後者的話，會告訴他一個他根本還沒跑到的版號。 */

function askServiceWorkerVersion() {
  return new Promise(function(resolve) {
    const sw = navigator.serviceWorker && navigator.serviceWorker.controller;
    if (!sw || typeof MessageChannel === "undefined") { resolve(null); return; }
    const ch = new MessageChannel();
    /* 舊版的 worker 不認得這個訊息，不會回話——給個逾時，不要讓整行卡住 */
    const timer = setTimeout(function() { resolve(null); }, 1200);
    ch.port1.onmessage = function(e) {
      clearTimeout(timer);
      resolve(e.data && e.data.version ? e.data.version : null);
    };
    try {
      sw.postMessage({ type: "GET_VERSION" }, [ch.port2]);
    } catch (err) {
      clearTimeout(timer);
      resolve(null);
    }
  });
}

function fetchLatestVersion() {
  return fetch("sw.js", { cache: "no-store" })
    .then(function(res) { return res.text(); })
    .then(function(text) {
      const m = /const VERSION = '([^']+)'/.exec(text);
      return m ? m[1] : null;
    })
    .catch(function() { return null; });
}

function renderVersionRow() {
  const value = document.getElementById("versionRowValue");
  const desc = document.getElementById("versionRowDesc");
  if (!value) return;

  value.textContent = "…";
  Promise.all([askServiceWorkerVersion(), fetchLatestVersion()]).then(function(r) {
    const running = r[0];
    const latest = r[1];

    /* 沒有 service worker 接管時（第一次開、或使用者關掉了），跑的就是
       剛從網路拿到的那一份，所以伺服器上的版號就是正在跑的版號。 */
    const shown = running || latest;
    value.textContent = shown || "?";
    if (!desc) return;

    if (!shown) {
      desc.textContent = "連不上伺服器，也問不到本機的版本";
    } else if (running && latest && running !== latest) {
      desc.textContent = "有新版 " + latest + "，重新整理就會換過去";
    } else if (!latest) {
      desc.textContent = "離線中，無法確認是不是最新版";
    } else {
      desc.textContent = "已是最新版。回報問題時請附上這一行";
    }
  });
}

function openAppearanceModal() {
  /* 自己也把設定收起來，不倚賴呼叫端先做。settingsGoTo() 已經關過一次，
     重複關是無害的；但從別處直接呼叫這個函式時，少了這一行就會兩層疊著。 */
  closeSettingsModal();
  renderThemeChoice();
  document.getElementById("appearanceModal").classList.add("active");
}

function closeAppearanceModal() {
  /* 外觀視窗只有設定總表一個入口，所以在這裡直接回去就好，不用等監看器。
     從 settingsGoTo() 進來的情況也不會開兩次：監看器看到「已經有彈窗
     開著」就不會再動作。 */
  document.getElementById("appearanceModal").classList.remove("active");
  openSettingsModal();
}

function renderThemeChoice() {
  const pref = getThemePref();
  const row = document.getElementById("themeChoiceRow");
  if (!row) return;

  row.querySelectorAll(".theme-opt").forEach(function(btn) {
    const on = btn.getAttribute("data-theme") === pref;
    btn.classList.toggle("active", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  });

  // 選「跟隨系統」時，把現在實際是哪一邊講出來，否則使用者只看到一個
  // 沒有回饋的選項，不知道系統現在給的是什麼
  const hint = document.getElementById("themeAutoHint");
  if (hint) {
    hint.textContent = (pref === "auto")
      ? ("跟隨這台裝置的設定，目前是" + (resolveTheme("auto") === "dark" ? "夜間" : "日間"))
      : "";
  }
}

function initTheme() {
  applyTheme();

  // 選「跟隨系統」的時候，系統在半夜自己切換也要跟著換，
  // 不能只在開啟 app 的那一刻判斷一次
  if (!window.matchMedia) return;
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const onChange = function() {
    if (getThemePref() !== "auto") return;
    applyTheme("auto");
    repaintThemedContent();
    renderThemeChoice();
  };
  if (mq.addEventListener) mq.addEventListener("change", onChange);
  else if (mq.addListener) mq.addListener(onChange);   // 舊版 Safari
}
