/* ==========================================================
   匯出與匯入功能
   ========================================================== */

function openBatchExportModal() {
  const container = document.getElementById("exportChecklistContainer");
  container.innerHTML = "";

  appData.worldviews.forEach(function(w) {
    const wTitle = document.createElement("div");
    wTitle.style.fontWeight = "700";
    wTitle.style.fontSize = "13px";
    wTitle.style.margin = "6px 0 2px 0";
    wTitle.innerHTML = "<span>" + escapeHtml(w.icon || '🌐') + " " + escapeHtml(w.name) + "</span>";
    container.appendChild(wTitle);

    const docs = appData.docs.filter(d => d.worldId === w.id);
    docs.forEach(function(d) {
      /* 用 DOM 屬性設定，不要把 d.id 拼進 data-id="..."。

         id 是從匯入的檔案來的。原本這裡是字串拼接，一份動過手腳的備份檔
         只要把 id 寫成 x" onfocus="..." autofocus data-y=" 就能跳出屬性，
         在使用者打開匯出視窗時執行任意程式碼——讀得到 localStorage 裡的
         Supabase session token。已用 PoC 確認過可利用。 */
      const row = document.createElement("div");
      row.style.padding = "4px 10px";

      const box = document.createElement("input");
      box.type = "checkbox";
      box.className = "export-checkbox";
      box.dataset.id = d.id;
      box.checked = true;

      const label = document.createElement("span");
      label.textContent = " " + (d.icon || "📄") + " " + (d.title || "無標題");

      row.appendChild(box);
      row.appendChild(label);
      container.appendChild(row);
    });
  });

  document.getElementById("batchExportModal").classList.add("active");
}

function toggleExportAll(status) {
  document.querySelectorAll(".export-checkbox").forEach(cb => cb.checked = status);
}
function closeBatchExportModal() { document.getElementById("batchExportModal").classList.remove("active"); }

function confirmBatchExport() {
  const checkedBoxes = document.querySelectorAll(".export-checkbox:checked");
  if (checkedBoxes.length === 0) { alert("請至少選擇一個文檔！"); return; }

  const ids = Array.from(checkedBoxes).map(cb => cb.getAttribute("data-id"));
  const format = document.getElementById("exportFormatSelect").value;
  const docs = appData.docs.filter(d => ids.includes(d.id));

  if (format === "json") {
    downloadFile(JSON.stringify(docs, null, 2), "world_export_" + Date.now() + ".json", "application/json");
  } else if (format === "html") {
    downloadFile(buildExportHTML(docs), "world_export_" + Date.now() + ".html", "text/html;charset=utf-8");
  } else {
    let txt = "";
    docs.forEach(function(d) {
      txt += `【${d.title || '無標題'}】\n標籤：${d.tags.join(' ')}\n\n${d.content}\n\n====================\n\n`;
    });
    downloadFile(txt, "world_export_" + Date.now() + ".txt", "text/plain;charset=utf-8");
  }
  closeBatchExportModal();
}

function buildExportHTML(docs) {
  const body = docs.map(function(d) {
    return `<article class="wb-doc" data-icon="${escapeHtml(d.icon || '📄')}" data-tags="${escapeHtml((d.tags || []).join(','))}">
  <h1>${escapeHtml(d.title || '無標題')}</h1>
  <div class="wb-tags">${(d.tags || []).map(t => '#' + escapeHtml(t)).join(' ')}</div>
  <pre class="wb-content">${escapeHtml(d.content || '')}</pre>
</article>`;
  }).join("\n<hr>\n");

  return `<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="UTF-8">
<title>世界觀匯出文檔</title>
<style>
  body { font-family: "Noto Sans TC", "Plus Jakarta Sans", sans-serif; max-width: 760px; margin: 40px auto; padding: 0 20px; line-height: 1.7; color: #2A2420; }
  h1 { font-size: 22px; border-bottom: 2px solid #ddd; padding-bottom: 8px; }
  .wb-tags { color: #8A4F1F; font-size: 13px; margin-bottom: 12px; }
  .wb-content { white-space: pre-wrap; word-break: break-word; font-family: inherit; font-size: 15px; }
  hr { border: none; border-top: 1px dashed #ccc; margin: 36px 0; }
</style>
</head>
<body>
${body}
</body>
</html>`;
}

function exportFullDatabaseJSON() {
  downloadFile(JSON.stringify(appData, null, 2), "worldbuilder_full_db_" + Date.now() + ".json", "application/json");
}

function downloadFile(content, fileName, contentType) {
  const a = document.createElement("a");
  const file = new Blob([content], { type: contentType });
  a.href = URL.createObjectURL(file);
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(a.href);
}

function triggerImportFile() {
  document.getElementById("importFileInput").click();
}

function handleImportFileSelected(e) {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;

  const ext = (file.name.split(".").pop() || "").toLowerCase();
  const reader = new FileReader();
  reader.onload = function(evt) {
    const text = evt.target.result;
    try {
      if (ext === "json") {
        importFromJSON(text);
      } else if (ext === "html" || ext === "htm") {
        importFromHTML(text);
      } else {
        importFromTXT(text);
      }
    } catch (err) {
      console.error(err);
      alert("匯入失敗：檔案格式無法辨識或已損毀。");
    }
  };
  reader.onerror = function() {
    alert("讀取檔案時發生錯誤，請重試。");
  };
  reader.readAsText(file);
}

function importFromJSON(text) {
  const data = safeParseJSON(text);
  if (data === null) { alert("匯入失敗：JSON 格式錯誤。"); return; }

  if (looksLikeFullDatabase(data)) {
    const problem = validateFullDatabase(data);
    if (problem) { alert("匯入失敗：這個檔案的內容不完整或已損毀。\n\n" + problem); return; }

    if (!confirm("偵測到這是「完整資料庫備份」檔案，匯入將會覆蓋目前所有資料。\n\n" +
                 "為了保險，按下確定之後會先把你現在的資料下載一份備份檔，再進行匯入。\n\n" +
                 "確定要繼續嗎？")) return;

    /* 覆蓋之前先把現有資料存成檔案。原本是直接 appData = data 就洗掉了，
       匯到一半發現拿錯檔案就回不去。備份走下載而不是存進 localStorage，
       是因為這種時候 localStorage 很可能正好是滿的。 */
    try {
      // 檔名用 ASCII：實測非 ASCII 的檔名在 Chromium 下會變成沒有副檔名的
      // "download"，這份是救命用的備份，名字一定要認得出來
      downloadFile(JSON.stringify(appData, null, 2),
        "worldbuilder_backup_before_import_" + Date.now() + ".json", "application/json");
    } catch (e) {
      if (!confirm("自動備份失敗，繼續匯入會蓋掉現有資料而且無法復原。還是要繼續嗎？")) return;
    }

    appData = normalizeImportedDatabase(data);
    saveData();
    location.reload();
    return;
  }

  if (Array.isArray(data)) {
    importDocsArray(data);
    return;
  }

  alert("匯入失敗：無法辨識此 JSON 檔案的內容格式。");
}

function looksLikeFullDatabase(data) {
  return !!data && !Array.isArray(data) && typeof data === "object" &&
         Array.isArray(data.worldviews) && Array.isArray(data.folders) && Array.isArray(data.docs);
}

/* 回傳錯誤說明字串；沒問題就回傳 null。

   原本只確認那三個欄位是陣列就整包換掉 appData，裡面是什麼完全不管。
   一份缺欄位的檔案匯進來，app 會在之後某個地方才爆掉，而那時原本的資料
   已經被洗掉了。寧可在這裡擋下來。 */
/* id 會被放進 HTML 屬性、CSS 選擇器與 DOM 的 id。app 自己產生的 id 一律是
   英數字加底線／連字號，所以把其餘字元擋掉不會拒絕任何正常的備份檔，
   卻能在輸入端就堵死屬性注入（輸出端也已經改用 DOM API，兩層都有）。 */
const SAFE_ID = /^[A-Za-z0-9_-]+$/;

function validateFullDatabase(data) {
  if (!data.worldviews.length) return "檔案裡沒有任何世界觀。";

  for (let i = 0; i < data.worldviews.length; i++) {
    const w = data.worldviews[i];
    if (!w || typeof w !== "object" || typeof w.id !== "string" || !w.id) {
      return "第 " + (i + 1) + " 個世界觀缺少 id。";
    }
    if (!SAFE_ID.test(w.id)) return "第 " + (i + 1) + " 個世界觀的 id 含有不允許的字元。";
  }
  const worldIds = data.worldviews.map(function(w) { return w.id; });

  for (let i = 0; i < data.docs.length; i++) {
    const d = data.docs[i];
    if (!d || typeof d !== "object" || typeof d.id !== "string" || !d.id) {
      return "第 " + (i + 1) + " 篇文檔缺少 id。";
    }
    if (!SAFE_ID.test(d.id)) return "文檔「" + (d.title || d.id) + "」的 id 含有不允許的字元。";
    if (worldIds.indexOf(d.worldId) === -1) {
      return "文檔「" + (d.title || d.id) + "」指向一個不存在的世界觀。";
    }
  }
  for (let i = 0; i < data.folders.length; i++) {
    const f = data.folders[i];
    if (!f || typeof f !== "object" || typeof f.id !== "string" || !f.id) {
      return "第 " + (i + 1) + " 個資料夾缺少 id。";
    }
    if (!SAFE_ID.test(f.id)) return "第 " + (i + 1) + " 個資料夾的 id 含有不允許的字元。";
  }
  return null;
}

/* 補齊可選欄位，並把每一篇的圖片過一次白名單。

   __proto__ / constructor 這類鍵用 JSON.parse 讀進來只是普通屬性，不會
   污染原型；但還是只挑認得的欄位重建，不要把整個外來物件當成自己的狀態。 */
/* 把一筆文檔補成 app 各處都能直接用的形狀。

   結構驗證只確認 id 跟歸屬正確，欄位缺不缺它不管——少一個 tags 陣列，
   之後某個 .forEach 就會爆，而那時原本的資料已經被覆蓋掉了。
   storage.js 的 migration 是同樣的思路，這裡做一次等於把那套前移到匯入時。 */
function normalizeImportedDoc(d) {
  const str = function(v, fallback) { return typeof v === "string" ? v : (fallback || ""); };
  const doc = {
    id: d.id,
    worldId: d.worldId,
    folderId: typeof d.folderId === "string" ? d.folderId : null,
    icon: str(d.icon, "📄"),
    title: str(d.title, "無標題文檔"),
    content: str(d.content),
    tags: Array.isArray(d.tags) ? d.tags.filter(function(t) { return typeof t === "string"; }) : [],
    manualTags: Array.isArray(d.manualTags)
      ? d.manualTags.filter(function(t) { return typeof t === "string"; }) : [],
    images: sanitizeImageList(d.images),
    wordCount: 0,
    // 「段首空兩格」是文檔自己的設定，不帶過來的話匯入之後按 Enter 就不會再縮排
    autoIndent: !!d.autoIndent,
    updatedAt: str(d.updatedAt, formatTime(new Date()))
  };
  if (d.createdAt) doc.createdAt = d.createdAt;
  // 字數與標籤一律重算，不要相信檔案裡寫的
  recomputeDocFromContent(doc, doc.content);
  return doc;
}

function normalizeImportedFolder(f) {
  return {
    id: f.id,
    worldId: f.worldId,
    parentId: typeof f.parentId === "string" ? f.parentId : null,
    name: typeof f.name === "string" ? f.name : "未命名資料夾",
    icon: typeof f.icon === "string" ? f.icon : "📁"
  };
}

function normalizeImportedWorld(w) {
  const c = (w.canvas && typeof w.canvas === "object") ? w.canvas : {};
  const out = Object.assign({}, w, {
    name: typeof w.name === "string" ? w.name : "未命名世界觀",
    icon: typeof w.icon === "string" ? w.icon : "🌐",
    canvas: {
      nodes: Array.isArray(c.nodes) ? c.nodes : [],
      edges: Array.isArray(c.edges) ? c.edges : [],
      /* 位置鎖是掛在每個節點／便利貼上的（node.locked / note.locked），
         這兩個陣列是整包帶過來的，所以不用另外處理。 */
      notes: Array.isArray(c.notes) ? c.notes : []
    }
  });

  /* 一句話簡介是選填的，所以只在「有、而且是字串」時留著。匯入的 JSON 可以
     在這裡塞物件或陣列，那些東西畫出來會是 [object Object]。
     （長度也截一下，理由同 WORLD_DESC_MAX_LEN。） */
  if (typeof out.desc === "string") out.desc = out.desc.trim().slice(0, WORLD_DESC_MAX_LEN);
  else delete out.desc;

  // 最愛、自訂順序、建立時間：型別不對就拿掉，排序那邊會退回預設
  if (out.starred !== true) delete out.starred;
  if (typeof out.order !== "number" || !isFinite(out.order)) delete out.order;
  if (typeof out.createdAt !== "string" || !isFinite(Date.parse(out.createdAt))) delete out.createdAt;

  return out;
}

function normalizeImportedDatabase(data) {
  const clean = {
    worldviews: data.worldviews.map(normalizeImportedWorld),
    folders: data.folders.map(normalizeImportedFolder),
    docs: data.docs.map(normalizeImportedDoc),
    colorPalette: (data.colorPalette && typeof data.colorPalette === "object")
      ? data.colorPalette : Object.assign({}, DEFAULT_PALETTES),
    tagSettings: (data.tagSettings && typeof data.tagSettings === "object") ? data.tagSettings : {},
    trash: { docs: [], folders: [], canvas: [] }
  };
  if (data.trash && typeof data.trash === "object") {
    if (Array.isArray(data.trash.docs)) {
      clean.trash.docs = data.trash.docs.map(function(d) {
        return Object.assign({}, d, { images: sanitizeImageList(d.images) });
      });
    }
    if (Array.isArray(data.trash.folders)) clean.trash.folders = data.trash.folders;
    if (Array.isArray(data.trash.canvas)) clean.trash.canvas = data.trash.canvas;
    /* 整筆刪掉的世界觀：跟現有的世界觀過同一道整理（名稱、圖示、白板的
       形狀、簡介），再把刪除時間補回去。不帶的話，從備份還原之後那些世界觀
       就只剩散落在垃圾桶裡的文檔，沒辦法整個復原。 */
    if (Array.isArray(data.trash.worlds)) {
      clean.trash.worlds = data.trash.worlds
        .filter(function(w) { return w && typeof w === "object" && typeof w.id === "string"; })
        .map(function(w) {
          return Object.assign(normalizeImportedWorld(w), { deletedAt: w.deletedAt, deletedTs: w.deletedTs });
        });
    }
  }
  return clean;
}

function importFromTXT(text) {
  const blocks = text.split("====================").map(s => s.trim()).filter(Boolean);
  const docs = blocks.map(function(block) {
    const titleMatch = block.match(/^【([^】]*)】/);
    const tagsMatch = block.match(/標籤：([^\n]*)/);
    let content = block;
    if (titleMatch) content = content.replace(titleMatch[0], "");
    if (tagsMatch) content = content.replace(/標籤：[^\n]*/, "");
    content = content.replace(/^\s+/, "").trim();
    return {
      title: titleMatch ? titleMatch[1].trim() : "匯入文檔",
      tags: tagsMatch ? tagsMatch[1].trim().split(/\s+/).filter(Boolean) : [],
      content: content
    };
  });
  importDocsArray(docs);
}

function importFromHTML(text) {
  const parser = new DOMParser();
  const htmlDoc = parser.parseFromString(text, "text/html");
  const articles = htmlDoc.querySelectorAll(".wb-doc");
  const docs = [];
  articles.forEach(function(el) {
    const titleEl = el.querySelector("h1");
    const contentEl = el.querySelector(".wb-content");
    const tagsAttr = el.getAttribute("data-tags") || "";
    docs.push({
      title: titleEl ? titleEl.textContent.trim() : "匯入文檔",
      icon: el.getAttribute("data-icon") || "📄",
      tags: tagsAttr ? tagsAttr.split(",").map(s => s.trim()).filter(Boolean) : [],
      content: contentEl ? contentEl.textContent : ""
    });
  });
  if (docs.length === 0) {
    alert("匯入失敗：此 HTML 檔案不是本工具匯出的格式，找不到可匯入的文檔內容。");
    return;
  }
  importDocsArray(docs);
}

/* 把外來的一筆資料整成一篇能用的文檔；整不出來就回傳 null。

   模糊測試丟了 31 種畸形檔案進來，發現這裡原本完全不檢查每一筆的內容：
   [1,2,3] 會匯入三篇空白垃圾文檔、[{}] 會匯入一篇全空的、title 是物件
   會變成 [object Object]、十萬字元的標題會整條塞進目錄欄。
   另外 [null,null] 會先說「即將匯入 2 篇」再跳「匯入失敗」，訊息自相矛盾。 */
const IMPORT_MAX_TITLE = 200;

function coerceImportedDoc(d) {
  if (!d || typeof d !== "object" || Array.isArray(d)) return null;

  const str = function(v) { return typeof v === "string" ? v : ""; };
  const title = str(d.title).trim().slice(0, IMPORT_MAX_TITLE);
  const content = str(d.content);
  const icon = str(d.icon).slice(0, 8);
  const tags = Array.isArray(d.tags) ? d.tags.filter(function(t) { return typeof t === "string"; }) : [];
  const images = sanitizeImageList(d.images);   // 來路不明的字串不要進 <img src>

  // 標題、內文、圖片全空的就不是一篇文檔，只是雜訊
  if (!title && !content && !images.length) return null;

  return { title: title || "匯入文檔", content: content, icon: icon || "📄", tags: tags, images: images };
}

function importDocsArray(docsArray) {
  if (!Array.isArray(docsArray) || !docsArray.length) { alert("此檔案沒有可匯入的文檔。"); return; }

  const usable = [];
  let skipped = 0;
  docsArray.forEach(function(d) {
    const doc = coerceImportedDoc(d);
    if (doc) usable.push(doc); else skipped++;
  });

  if (!usable.length) {
    alert("此檔案沒有可匯入的文檔。" + (skipped ? "（有 " + skipped + " 筆資料無法辨識）" : ""));
    return;
  }

  // 數量要在檢查之後才報，不然會出現「即將匯入 2 篇」後面接「匯入失敗」
  if (!confirm("即將匯入 " + usable.length + " 篇文檔到「" + getWorldName(activeWorldId) + "」"
        + (skipped ? "（另有 " + skipped + " 筆資料無法辨識，會略過）" : "") + "，確定嗎？")) return;

  usable.forEach(function(d) {
    const doc = {
      id: "doc_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7),
      worldId: activeWorldId,
      folderId: activeFolderId || null,
      icon: d.icon || "📄",
      title: d.title || "匯入文檔",
      content: d.content || "",
      tags: Array.isArray(d.tags) ? d.tags : [],
      manualTags: computeManualTagsFor(d.content, d.tags),
      images: sanitizeImageList(d.images),   // 來路不明的字串不要進 <img src>
      wordCount: 0,
      updatedAt: formatTime(new Date())
    };
    /* 字數與標籤一律交給編輯器用的同一個函式算。

       原本這裡寫 wordCount: content.length（字串長度），但編輯器算的是
       「中文字數 + 英文單詞數」。匯入一篇 "Hello world" 會顯示 11 而不是 2，
       標點與換行也全算進去，直到使用者去編輯它一次才會自己修正。 */
    recomputeDocFromContent(doc, doc.content);
    appData.docs.unshift(doc);
  });
  saveData();
  renderSidebarTree();
  alert("匯入完成！已匯入 " + usable.length + " 篇"
    + (skipped ? "，略過 " + skipped + " 筆無法辨識的資料" : "") + "。");
}

function getWorldName(id) {
  const w = appData.worldviews.find(x => x.id === id);
  return w ? w.name : "目前世界觀";
}

function safeParseJSON(text) {
  try { return JSON.parse(text); } catch (e) { return null; }
}
