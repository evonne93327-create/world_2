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
   疊起來只是靠 DOM 順序分勝負，很脆。外觀子視窗關掉會回到設定，
   因為那是唯一一個「改完還想看一眼總表」的。
   ------------------------------------------------------------- */

function openSettingsModal() {
  renderSettingsRows();
  document.getElementById("settingsModal").classList.add("active");
}

function closeSettingsModal() {
  document.getElementById("settingsModal").classList.remove("active");
}

function settingsGoTo(open) {
  closeSettingsModal();
  if (typeof open === "function") open();
}

function renderSettingsRows() {
  const v = document.getElementById("appearanceRowValue");
  if (v) {
    const pref = getThemePref();
    v.textContent = pref === "light" ? "日間" : (pref === "dark" ? "夜間" : "跟隨系統");
  }
  if (typeof renderSyncIndicator === "function") renderSyncIndicator();
}

function openAppearanceModal() {
  closeSettingsModal();
  renderThemeChoice();
  document.getElementById("appearanceModal").classList.add("active");
}

function closeAppearanceModal() {
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
