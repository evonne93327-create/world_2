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

/* 垃圾桶超過保留天數就自動清掉。

   不清的話，刪掉的文檔會永遠佔著 localStorage 那 5MB——帶圖片的更兇，
   一篇就可能幾百 KB。使用者以為刪掉了，空間卻沒還回來。

   舊資料只有 deletedAt（給人看的 "2026-09-20 22:43" 字串），沒有
   deletedTs。那種就拿 deletedAt 去 parse；連 parse 都失敗的（格式不明）
   一律保留，寧可留著也不要誤刪別人的東西。 */
(function purgeExpiredTrash() {
  if (!appData.trash || typeof appData.trash !== "object") return;
  const cutoff = Date.now() - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;

  const expired = function(item) {
    if (!item) return false;
    if (typeof item.deletedTs === "number") return item.deletedTs < cutoff;
    if (typeof item.deletedAt === "string") {
      // "2026-09-20 22:43" → Safari 不吃空白分隔，要換成 T
      const t = Date.parse(item.deletedAt.replace(" ", "T"));
      if (!isNaN(t)) return t < cutoff;
    }
    return false;   // 看不懂的一律保留
  };

  let removed = 0;
  ["docs", "folders", "canvas"].forEach(function(kind) {
    if (!Array.isArray(appData.trash[kind])) return;
    const before = appData.trash[kind].length;
    appData.trash[kind] = appData.trash[kind].filter(function(item) { return !expired(item); });
    removed += before - appData.trash[kind].length;
  });

  if (removed) {
    try { localStorage.setItem("novel_multi_world_data_v5", JSON.stringify(appData)); } catch (err) {}
  }
})();

/* 連線的「玫紅」拿掉了（改成跟標籤同一組七色：灰紅橙黃綠藍紫）。
   直接不管的話，原本用玫紅的線會掉回灰色，使用者本來想表達的區別就沒了。
   換成色相最接近的紅色，至少那條線還是「紅系」的。只跑一次，換完就存回去。 */
(function migrateEdgeRoseToRed() {
  let changed = 0;
  (appData.worldviews || []).forEach(function(w) {
    if (!w.canvas || !Array.isArray(w.canvas.edges)) return;
    w.canvas.edges.forEach(function(e) {
      if (e.color === "e_rose") { e.color = "e_red"; changed++; }
    });
  });
  if (changed) {
    try { localStorage.setItem("novel_multi_world_data_v5", JSON.stringify(appData)); } catch (err) {}
  }
})();

if (!appData.trash || typeof appData.trash !== "object") {
  appData.trash = { docs: [], folders: [], canvas: [] };
}
if (!Array.isArray(appData.trash.docs)) appData.trash.docs = [];
if (!Array.isArray(appData.trash.folders)) appData.trash.folders = [];
// 白板的節點與連線原本刪了就沒了，跟文檔「都能復原」的預期不一致
if (!Array.isArray(appData.trash.canvas)) appData.trash.canvas = [];

/* localStorage 滿了的時候只提醒一次，不要每敲一個字就跳一次。
   等到真的存成功了才把旗標放掉——中間都還在危險狀態。 */
let storageFullNotified = false;

function saveData() {
  let ok = true;
  try {
    localStorage.setItem("novel_multi_world_data_v5", JSON.stringify(appData));
    // 存檔時一併記錄當前的 UI 狀態
    localStorage.setItem("novel_ui_state", JSON.stringify({ activeWorldId, activeDocId, activeFolderId }));
    storageFullNotified = false;
  } catch (err) {
    /* localStorage 大約只有 5MB，而圖片是整張 base64 存進去的。滿了之後
       setItem 會丟 QuotaExceededError——原本沒有接，於是：畫面上還是
       使用者剛打的字、硬碟上卻還是上一次成功存檔的版本，而且完全沒有
       任何提示。關掉分頁就沒了。

       這裡一定要讓它浮出水面。 */
    ok = false;
    console.error("saveData 失敗：", err);
    notifyStorageFull(err);
  }

  /* 就算本機存不下，還是要通知雲端同步。

     原本例外會在這一行之前就中斷 saveData，連帶讓 onDataSaved() 不會被
     呼叫——唯一還救得回資料的那條路剛好也啞了。雲端上傳讀的是記憶體裡
     的 appData，不經過 localStorage，所以這條路還是通的。 */
  if (typeof onDataSaved === "function") onDataSaved();
  return ok;
}

function notifyStorageFull(err) {
  const isQuota = err && (err.name === "QuotaExceededError" ||
                          err.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
                          err.code === 22);
  if (storageFullNotified) return;
  storageFullNotified = true;

  const modal = document.getElementById("storageFullModal");
  if (!modal) {
    // 極端狀況（彈窗還沒載入）至少要吵一下，不能靜悄悄
    alert(isQuota
      ? "儲存空間已滿，這次的修改沒有存進這台裝置！請立刻備份。"
      : "存檔失敗：" + (err && err.message ? err.message : "未知錯誤"));
    return;
  }

  const detail = document.getElementById("storageFullDetail");
  if (detail) {
    detail.textContent = isQuota
      ? "這台裝置的瀏覽器儲存空間（約 5MB）已經滿了，通常是文檔裡的圖片佔掉的。"
      : "存檔時發生錯誤：" + (err && err.message ? err.message : "未知錯誤");
  }
  modal.classList.add("active");
}

function closeStorageFullModal() {
  document.getElementById("storageFullModal").classList.remove("active");
}

/* 目前用掉多少 localStorage，給提示視窗顯示用 */
function localStorageUsage() {
  let used = 0;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      used += k.length + (localStorage.getItem(k) || "").length;
    }
  } catch (e) { return null; }
  return used;
}

/* 離開／切到背景之前，把還沒寫進去的東西補存。

   內文是打完停手 400ms 才存的，所以打完最後一句立刻關掉分頁，那 400ms
   的字會掉。原本這裡只存了「停在哪個文檔」這種畫面狀態，沒有補存內文。

   而且不能只靠 beforeunload：iOS 的 PWA 幾乎不觸發它（系統把 app 從背景
   回收時根本不會跑）。visibilitychange 的 hidden 才是 iOS 上可靠的那一個，
   pagehide 則補桌面版關分頁的情況。三個都掛上，重複存一次沒有壞處。

   localStorage 是同步寫入的，在這些事件裡寫得完，不用擔心來不及。 */
function flushBeforeLeaving() {
  try {
    if (typeof flushPendingContentPersist === "function") flushPendingContentPersist();
  } catch (e) { console.error(e); }
  try {
    localStorage.setItem("novel_ui_state", JSON.stringify({ activeWorldId, activeDocId, activeFolderId }));
  } catch (e) { /* 空間滿了的話 saveData 那邊已經提醒過了 */ }
}

/* 多分頁互相覆蓋。

   兩個分頁同時開著，各自的 appData 在記憶體裡分岔，誰後存誰贏——先寫的
   那邊整段進度會被另一邊的舊狀態蓋掉，而且兩邊都不知道發生過這件事。

   storage 事件只會在「其他分頁」寫入時觸發（自己寫不會收到），正好拿來
   偵測。刻意不自動採用：這個分頁可能正打到一半，直接換掉會把使用者
   手上的東西弄丟。跳出來讓他自己選，並且講清楚兩邊各是什麼狀態。 */
let otherTabNoticeShown = false;

window.addEventListener("storage", function(e) {
  if (e.key !== "novel_multi_world_data_v5" || !e.newValue) return;
  if (otherTabNoticeShown) return;
  otherTabNoticeShown = true;

  let theirDocs = "?";
  try { theirDocs = (JSON.parse(e.newValue).docs || []).length; } catch (err) {}

  const modal = document.getElementById("otherTabModal");
  if (!modal) {
    if (confirm("另一個分頁修改了資料。要重新載入以採用那一份嗎？\n（這個分頁尚未存檔的修改會遺失）")) {
      location.reload();
    }
    otherTabNoticeShown = false;
    return;
  }

  const info = document.getElementById("otherTabInfo");
  if (info) {
    info.textContent = "另一個分頁剛剛存了一份有 " + theirDocs + " 篇文檔的資料；" +
      "這個分頁目前是 " + (appData.docs || []).length + " 篇。" +
      "兩邊繼續各自編輯的話，後存的那一份會蓋掉先存的。";
  }
  modal.classList.add("active");
});

function closeOtherTabModal() {
  document.getElementById("otherTabModal").classList.remove("active");
  otherTabNoticeShown = false;   // 下次別的分頁再寫入時還要再提醒
}

function reloadForOtherTab() {
  location.reload();
}

window.addEventListener("beforeunload", flushBeforeLeaving);
window.addEventListener("pagehide", flushBeforeLeaving);
document.addEventListener("visibilitychange", function() {
  if (document.visibilityState === "hidden") flushBeforeLeaving();
});
