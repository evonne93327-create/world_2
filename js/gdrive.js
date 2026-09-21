/* ==========================================================
   雲端同步 — Google 雲端硬碟 provider (gdrive.js)

   在使用者的雲端硬碟裡維護一個 JSON 檔，整包資料存在裡面。
   跟 Supabase 版最大的差別是使用者「看得到」這個檔案，
   可以自己下載、備份、分享。

   權限範圍只要 drive.file：app 只碰得到「自己建立的檔案」，
   碰不到使用者雲端硬碟裡的其他東西。這個範圍屬於非敏感，
   不需要送 Google 審查，而且 app 之後可以重新找回自己建立的檔案。

   取權杖要用 Google 的 Identity Services 腳本，所以這個 provider
   會打破專案原本零依賴的性質——這是做 Google OAuth 無法避免的。
   腳本採延遲載入：沒有選用這個後端就完全不會去抓。
   ========================================================== */

const GDRIVE_CONFIG_KEY = "world_gdrive_config_v1";
const GDRIVE_FILE_KEY = "world_gdrive_file_v1";
const GDRIVE_FILE_NAME = "worldbuilder_data.json";
/* drive.file：只碰得到 app 自己建立的檔案，碰不到你雲端硬碟裡的其他東西。
   openid email：只為了把「連到哪個 Google 帳號」顯示出來——原本
   gdriveEmail 從頭到尾沒有任何一行賦值，永遠顯示「已授權」，
   你不知道資料同步到誰的帳號去了。 */
const GDRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file openid email";
const GDRIVE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";
const GIS_SRC = "https://accounts.google.com/gsi/client";

/* 存取權杖只放在記憶體：它一小時就過期，寫進 localStorage
   只是徒增外洩面積，重新取得又通常是無感的。 */
let gdriveToken = null;
let gdriveTokenExpiresAt = 0;
let gdriveEmail = null;
let gisLoading = null;

function loadGdriveConfig() {
  try {
    return JSON.parse(safeStorageGet(GDRIVE_CONFIG_KEY)) || { clientId: "" };
  } catch (e) {
    return { clientId: "" };
  }
}

function saveGdriveConfig(clientId) {
  safeStorageSet(GDRIVE_CONFIG_KEY, JSON.stringify({ clientId: (clientId || "").trim() }));
}

function loadGdriveFileId() {
  return safeStorageGet(GDRIVE_FILE_KEY) || null;
}

function saveGdriveFileId(id) {
  if (id) safeStorageSet(GDRIVE_FILE_KEY, id);
  else safeStorageRemove(GDRIVE_FILE_KEY);
}

function gdriveError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/* ---------- 取得存取權杖 ---------- */

function loadGisScript() {
  if (window.google && window.google.accounts && window.google.accounts.oauth2) {
    return Promise.resolve();
  }
  if (gisLoading) return gisLoading;
  gisLoading = new Promise(function(resolve, reject) {
    const s = document.createElement("script");
    s.src = GIS_SRC;
    s.async = true;
    s.onload = resolve;
    s.onerror = function() {
      gisLoading = null;
      reject(gdriveError("載入 Google 登入元件失敗，請檢查網路或擋廣告的擴充功能"));
    };
    document.head.appendChild(s);
  });
  return gisLoading;
}

/* interactive=false 時用靜默模式：使用者若已經授權過且 Google 還記得他，
   就不會跳出任何視窗。瀏覽器會擋掉非使用者點擊觸發的彈窗，
   所以背景自動同步一定要走靜默這條路。 */
function requestGdriveToken(interactive) {
  const cfg = loadGdriveConfig();
  if (!cfg.clientId) return Promise.reject(gdriveError("尚未設定 Google 用戶端 ID"));

  return loadGisScript().then(function() {
    return new Promise(function(resolve, reject) {
      const client = google.accounts.oauth2.initTokenClient({
        client_id: cfg.clientId,
        scope: GDRIVE_SCOPE,
        prompt: interactive ? "consent" : "",
        callback: function(resp) {
          if (resp.error) {
            reject(gdriveError(resp.error_description || resp.error, 401));
            return;
          }
          gdriveToken = resp.access_token;
          gdriveTokenExpiresAt = Date.now() + (resp.expires_in || 3600) * 1000;
          // 撈帳號是附帶的，失敗不影響同步本身
          fetchGdriveEmail(gdriveToken);
          resolve(gdriveToken);
        },
        error_callback: function(err) {
          reject(gdriveError((err && err.message) || "Google 授權被取消或失敗", 401));
        }
      });
      client.requestAccessToken();
    });
  });
}

function fetchGdriveEmail(token) {
  return fetch(GDRIVE_USERINFO_URL, { headers: { "Authorization": "Bearer " + token } })
    .then(function(res) { return res.ok ? res.json() : null; })
    .then(function(info) {
      if (info && info.email) {
        gdriveEmail = info.email;
        if (typeof renderSyncIndicator === "function") renderSyncIndicator();
      }
    })
    .catch(function() { /* 顯示帳號是加分項，拿不到就維持「已授權」 */ });
}

/* 開啟 app 時試著靜默把權杖要回來。

   權杖刻意不存 localStorage（那是對的，權杖不該落地），但結果是每次重開
   記憶體裡就沒有了 → syncIsActive() 是 false → initSync() 直接 return →
   同步整個悄悄關掉，而且不會告訴你。你以為同步開著，其實整天都沒上傳。

   靜默模式（interactive=false）在使用者先前授權過、而且 Google 還記得他的
   時候不會跳任何視窗，正好適合開場時試一次。拿不到就安靜放棄，維持
   「未登入」讓使用者自己點——不要在開場彈一個授權視窗嚇人。 */
function restoreGdriveSessionQuietly() {
  if (!loadGdriveConfig().clientId) return Promise.resolve(false);
  if (gdriveToken) return Promise.resolve(true);
  return requestGdriveToken(false)
    .then(function() { return true; })
    .catch(function() { return false; });
}

/* 提早 60 秒換新的，免得請求送到一半剛好過期 */
async function ensureGdriveToken() {
  if (gdriveToken && Date.now() < gdriveTokenExpiresAt - 60000) return gdriveToken;
  return requestGdriveToken(false);
}

async function gdriveFetch(url, options) {
  const token = await ensureGdriveToken();
  const opts = options || {};
  const headers = Object.assign({ "Authorization": "Bearer " + token }, opts.headers || {});

  /* cache: "no-store" —— 不讓瀏覽器的 HTTP 快取插手。
     檔案內容（?alt=media）與 metadata 是兩次請求，只要其中一次吃到快取，
     就會出現「版本號是新的、內容是舊的」這種對不起來的組合，而且
     對帳會因為版本號相同而認定「已經是最新」，安靜地停在舊資料上。 */
  const init = Object.assign({}, opts, { headers: headers, cache: "no-store" });

  let res;
  try {
    res = await fetch(url, init);
  } catch (e) {
    throw gdriveError("連不上 Google 雲端硬碟，請確認網路狀態");
  }

  if (res.status === 401) {
    // 權杖失效：重取一次再試，還是不行就要使用者重新授權
    gdriveToken = null;
    const token2 = await requestGdriveToken(false);
    headers["Authorization"] = "Bearer " + token2;
    res = await fetch(url, Object.assign({}, init, { headers: headers }));
  }

  if (!res.ok) {
    let detail = "";
    try {
      const body = await res.json();
      detail = (body.error && (body.error.message || body.error.status)) || "";
    } catch (e) { /* 不是 JSON */ }
    throw gdriveError(detail || ("Google API 錯誤 HTTP " + res.status), res.status);
  }
  return res;
}

/* ---------- 找到／建立資料檔 ---------- */

/* 記在 localStorage 的 fileId 可能已經被使用者手動刪掉，
   所以找不到時要退回用檔名搜尋（drive.file 範圍下，
   搜尋結果只會有本 app 自己建立的檔案）。 */
async function findGdriveFile() {
  const cached = loadGdriveFileId();
  if (cached) {
    try {
      const res = await gdriveFetch(
        "https://www.googleapis.com/drive/v3/files/" + cached + "?fields=id,version,modifiedTime,trashed");
      const meta = await res.json();
      if (!meta.trashed) return meta;
    } catch (e) {
      if (e.status !== 404) throw e;
    }
    saveGdriveFileId(null);
  }

  const q = encodeURIComponent("name='" + GDRIVE_FILE_NAME + "' and trashed=false");
  const res = await gdriveFetch(
    "https://www.googleapis.com/drive/v3/files?q=" + q + "&fields=files(id,version,modifiedTime)");
  const body = await res.json();
  if (!body.files || !body.files.length) return null;
  saveGdriveFileId(body.files[0].id);
  return body.files[0];
}

async function createGdriveFile(dataObj) {
  const boundary = "-------wb" + Date.now();
  const metadata = { name: GDRIVE_FILE_NAME, mimeType: "application/json" };
  const body =
    "--" + boundary + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" +
    JSON.stringify(metadata) + "\r\n" +
    "--" + boundary + "\r\nContent-Type: application/json\r\n\r\n" +
    JSON.stringify(dataObj) + "\r\n" +
    "--" + boundary + "--";

  const res = await gdriveFetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,version,modifiedTime", {
      method: "POST",
      headers: { "Content-Type": "multipart/related; boundary=" + boundary },
      body: body
    });
  const meta = await res.json();
  saveGdriveFileId(meta.id);
  return meta;
}

async function updateGdriveFile(fileId, dataObj) {
  const res = await gdriveFetch(
    "https://www.googleapis.com/upload/drive/v3/files/" + fileId +
    "?uploadType=media&fields=id,version,modifiedTime", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(dataObj)
    });
  return res.json();
}

/* ---------- provider 介面 ---------- */

const gdriveProvider = {
  id: "gdrive",
  label: "Google 雲端硬碟",
  blurb: "資料存成你雲端硬碟裡的一個 JSON 檔，看得到也能自己下載。",

  isConfigured: function() {
    return !!loadGdriveConfig().clientId;
  },

  account: function() {
    // Drive 的權杖流程不會附帶身分資訊，有權杖就代表已授權
    return gdriveToken ? (gdriveEmail || "已授權") : null;
  },

  signOut: function() {
    if (gdriveToken && window.google && google.accounts && google.accounts.oauth2) {
      try { google.accounts.oauth2.revoke(gdriveToken); } catch (e) { /* 撤銷失敗不影響本機登出 */ }
    }
    gdriveToken = null;
    gdriveTokenExpiresAt = 0;
    gdriveEmail = null;
    saveGdriveFileId(null);
    saveSyncState(null, null);
  },

  /* 讓使用者點按鈕時走互動式授權（此時允許彈窗） */
  authorize: async function() {
    await requestGdriveToken(true);
  },

  pull: async function() {
    const meta = await findGdriveFile();
    if (!meta) return null;
    const res = await gdriveFetch(
      "https://www.googleapis.com/drive/v3/files/" + meta.id + "?alt=media");
    const data = await res.json();
    return { data: data, version: String(meta.version), at: meta.modifiedTime };
  },

  /* Drive 沒有「版本相符才寫入」這種條件式更新，只能寫入前先讀一次比對，
     中間存在很小的空窗期。這是相對 Supabase 版本的退步，但對個人
     單人使用而言，足以擋掉「另一台裝置改過卻被無聲蓋掉」這個主要風險。 */
  push: async function(dataObj, expectedVersion) {
    const meta = await findGdriveFile();

    if (!meta) {
      if (expectedVersion !== null && expectedVersion !== undefined) {
        // 本機以為雲端有檔案，實際卻不見了——可能被手動刪除，交給使用者決定
        return { conflict: true };
      }
      const created = await createGdriveFile(dataObj);
      return { conflict: false, version: String(created.version), at: created.modifiedTime };
    }

    if (expectedVersion === null || expectedVersion === undefined) {
      return { conflict: true }; // 本機以為沒檔案，雲端卻已經有了
    }
    if (String(meta.version) !== String(expectedVersion)) {
      return { conflict: true }; // 別台裝置在這之間寫過
    }

    const updated = await updateGdriveFile(meta.id, dataObj);
    return { conflict: false, version: String(updated.version), at: updated.modifiedTime };
  },

  overwrite: async function(dataObj) {
    const meta = await findGdriveFile();
    const result = meta
      ? await updateGdriveFile(meta.id, dataObj)
      : await createGdriveFile(dataObj);
    return { conflict: false, version: String(result.version), at: result.modifiedTime };
  },

  renderSetup: function() {
    const cfg = loadGdriveConfig();
    if (!cfg.clientId) {
      return '<p style="font-size:12px; color:var(--text-secondary); line-height:1.7;">' +
        '需要先到 Google Cloud Console 建立一組「OAuth 用戶端 ID」，把它貼進來。' +
        '用戶端 ID 可以公開，不是密碼。<br>' +
        '設定步驟見 <code>google-drive-setup.md</code>。</p>' +
        '<label style="font-size:12px; font-weight:600;">OAuth 用戶端 ID</label>' +
        '<input type="text" id="gdriveClientIdInput" class="form-input" placeholder="xxxxx.apps.googleusercontent.com">' +
        '<div id="syncModalMsg" style="font-size:12px; color:var(--danger); margin-top:8px;"></div>' +
        '<div style="display:flex; gap:8px; margin-top:8px;">' +
        '<button class="btn btn-primary" onclick="submitGdriveConfig()">儲存</button>' +
        '</div>';
    }
    return '<p style="font-size:12px; color:var(--text-secondary); line-height:1.7;">' +
      '按下授權後會跳出 Google 的登入視窗。本 app 只會取得' +
      '「存取自己建立的檔案」這個權限，碰不到你雲端硬碟裡的其他東西。</p>' +
      '<div id="syncModalMsg" style="font-size:12px; margin-top:8px;"></div>' +
      '<div style="display:flex; gap:8px; margin-top:8px;">' +
      '<button class="btn btn-primary" onclick="submitGdriveAuthorize()">授權 Google 雲端硬碟</button>' +
      '<button class="btn btn-secondary" onclick="clearGdriveConfig()">更改用戶端 ID</button>' +
      '</div>';
  }
};

/* ---------- Google 專屬的面板操作 ---------- */

function submitGdriveConfig() {
  const id = document.getElementById("gdriveClientIdInput").value.trim();
  if (!id) { setSyncModalMsg("請填入用戶端 ID。", true); return; }
  if (!/\.apps\.googleusercontent\.com$/.test(id)) {
    setSyncModalMsg("用戶端 ID 結尾應該是 .apps.googleusercontent.com", true);
    return;
  }
  saveGdriveConfig(id);
  renderSyncModal();
}

function clearGdriveConfig() {
  safeStorageRemove(GDRIVE_CONFIG_KEY);
  gdriveProvider.signOut();
  setSyncStatus("off");
  renderSyncModal();
}

async function submitGdriveAuthorize() {
  setSyncModalMsg("等待 Google 授權…");
  try {
    await gdriveProvider.authorize();
    renderSyncModal();
    await initSync();
  } catch (e) {
    setSyncModalMsg(e.message || "授權失敗", true);
  }
}
