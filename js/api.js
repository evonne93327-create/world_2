/* ==========================================================
   雲端同步 — Supabase 串接 (api.js)

   直接用 fetch 打 Supabase 的 REST API，不引入 SDK：
   這個專案目前零依賴、沒有打包步驟，為了幾支 API 掛一個 CDN
   反而多了一種「CDN 掛掉整個功能就壞掉」的失敗模式。

   設定（Project URL / anon key）與登入後的 session 都存在
   localStorage，所以只影響使用者自己的瀏覽器。
   anon key 設計上就是可以公開的，真正的防線是資料庫的
   Row Level Security（見 supabase/schema.sql）。
   ========================================================== */

const SYNC_CONFIG_KEY = "world_sync_config_v1";
const SYNC_SESSION_KEY = "world_sync_session_v1";
const SYNC_STATE_KEY = "world_sync_state_v1";

/* ---------- 設定與 session 的存取 ---------- */

function loadSyncConfig() {
  try {
    const raw = localStorage.getItem(SYNC_CONFIG_KEY);
    if (!raw) return { url: "", anonKey: "" };
    const parsed = JSON.parse(raw);
    return { url: parsed.url || "", anonKey: parsed.anonKey || "" };
  } catch (e) {
    return { url: "", anonKey: "" };
  }
}

function saveSyncConfig(url, anonKey) {
  // 結尾多打一個斜線是很常見的貼上失誤，這裡直接吸收掉
  const clean = (url || "").trim().replace(/\/+$/, "");
  localStorage.setItem(SYNC_CONFIG_KEY, JSON.stringify({
    url: clean,
    anonKey: (anonKey || "").trim()
  }));
}

function loadSyncSession() {
  try {
    return JSON.parse(localStorage.getItem(SYNC_SESSION_KEY)) || null;
  } catch (e) {
    return null;
  }
}

function saveSyncSession(session) {
  if (!session) localStorage.removeItem(SYNC_SESSION_KEY);
  else localStorage.setItem(SYNC_SESSION_KEY, JSON.stringify(session));
}

/* 這台裝置上一次同步到的版本號。推送時拿它跟雲端比對，
   不一致就代表別台裝置在這之間改過，必須先問使用者。 */
function loadSyncState() {
  try {
    return JSON.parse(localStorage.getItem(SYNC_STATE_KEY)) || { version: null, at: null };
  } catch (e) {
    return { version: null, at: null };
  }
}

function saveSyncState(version, at) {
  localStorage.setItem(SYNC_STATE_KEY, JSON.stringify({ version: version, at: at }));
}

function isSyncConfigured() {
  const cfg = loadSyncConfig();
  return !!(cfg.url && cfg.anonKey);
}

/* ---------- 底層請求 ---------- */

function syncApiError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

// 盡量從 Supabase 的錯誤回應裡撈出可讀的訊息，不要只丟 HTTP 狀態碼給使用者
async function describeErrorResponse(res) {
  let detail = "";
  try {
    const body = await res.json();
    detail = body.error_description || body.msg || body.message || body.error || body.hint || "";
  } catch (e) {
    /* 回應不是 JSON，維持空字串 */
  }
  if (!detail) {
    if (res.status === 401 || res.status === 403) detail = "認證失敗，請確認 anon key 與登入狀態";
    else if (res.status === 404) detail = "找不到資料表，請確認 schema.sql 已執行";
    else detail = "HTTP " + res.status;
  }
  return syncApiError(detail, res.status);
}

async function supabaseFetch(path, options, useAccessToken) {
  const cfg = loadSyncConfig();
  if (!cfg.url || !cfg.anonKey) throw syncApiError("尚未設定 Supabase 連線資訊");

  const opts = options || {};
  const headers = Object.assign({
    "apikey": cfg.anonKey,
    "Content-Type": "application/json"
  }, opts.headers || {});

  if (useAccessToken) {
    const session = loadSyncSession();
    if (!session || !session.access_token) throw syncApiError("尚未登入");
    headers["Authorization"] = "Bearer " + session.access_token;
  } else {
    headers["Authorization"] = "Bearer " + cfg.anonKey;
  }

  let res;
  try {
    res = await fetch(cfg.url + path, Object.assign({}, opts, { headers: headers }));
  } catch (e) {
    // fetch 只有在網路層失敗才 reject，這裡多半是網址打錯或斷線
    throw syncApiError("連不上 Supabase，請確認 Project URL 與網路狀態");
  }
  if (!res.ok) throw await describeErrorResponse(res);
  return res;
}

/* 存取權杖過期就自動換新的；換不成就當作登出，讓使用者重新登入。 */
async function withFreshSession(run) {
  try {
    return await run();
  } catch (e) {
    if (e.status !== 401) throw e;
    const refreshed = await refreshSyncSession();
    if (!refreshed) throw syncApiError("登入已過期，請重新登入", 401);
    return await run();
  }
}

async function refreshSyncSession() {
  const session = loadSyncSession();
  if (!session || !session.refresh_token) return false;
  try {
    const res = await supabaseFetch("/auth/v1/token?grant_type=refresh_token", {
      method: "POST",
      body: JSON.stringify({ refresh_token: session.refresh_token })
    }, false);
    saveSyncSession(await res.json());
    return true;
  } catch (e) {
    saveSyncSession(null);
    return false;
  }
}

/* ---------- 帳號 ---------- */

const syncAuth = {
  currentUser: function() {
    const session = loadSyncSession();
    return session && session.user ? session.user : null;
  },

  signUp: async function(email, password) {
    const res = await supabaseFetch("/auth/v1/signup", {
      method: "POST",
      body: JSON.stringify({ email: email, password: password })
    }, false);
    const body = await res.json();
    // 專案若開啟了信箱驗證，這時候還不會拿到 session
    if (body.access_token) {
      saveSyncSession(body);
      return { signedIn: true };
    }
    return { signedIn: false, needsConfirmation: true };
  },

  signIn: async function(email, password) {
    const res = await supabaseFetch("/auth/v1/token?grant_type=password", {
      method: "POST",
      body: JSON.stringify({ email: email, password: password })
    }, false);
    saveSyncSession(await res.json());
  },

  signOut: function() {
    saveSyncSession(null);
    saveSyncState(null, null);
  }
};

/* ---------- 資料讀寫 ---------- */

const syncData = {
  /* 讀回雲端那一列；從來沒同步過會拿到 null。 */
  pull: async function() {
    return withFreshSession(async function() {
      const res = await supabaseFetch(
        "/rest/v1/world_data?select=data,version,updated_at", { method: "GET" }, true);
      const rows = await res.json();
      return rows.length ? rows[0] : null;
    });
  },

  /* 寫入雲端。expectedVersion 是這台裝置上次同步到的版本：
     null 代表「我以為雲端還沒有資料」，其他值代表「我以為雲端還停在這一版」。
     實際版本對不上就回 {conflict:true}，交給上層去問使用者，
     絕不默默覆蓋別台裝置寫進去的東西。 */
  push: async function(appDataObj, expectedVersion) {
    const user = syncAuth.currentUser();
    if (!user) throw syncApiError("尚未登入");

    return withFreshSession(async function() {
      if (expectedVersion === null || expectedVersion === undefined) {
        try {
          const res = await supabaseFetch("/rest/v1/world_data", {
            method: "POST",
            headers: { "Prefer": "return=representation" },
            body: JSON.stringify({ user_id: user.id, data: appDataObj })
          }, true);
          const rows = await res.json();
          return { conflict: false, row: rows[0] };
        } catch (e) {
          // 409 = 這個帳號其實已經有資料了，代表別處先寫過
          if (e.status === 409) return { conflict: true };
          throw e;
        }
      }

      // 條件式更新：版本對得上才會真的改到列。
      // 用資料庫端的條件判斷而不是「先讀再寫」，才不會有競態。
      const res = await supabaseFetch(
        "/rest/v1/world_data?user_id=eq." + encodeURIComponent(user.id) +
        "&version=eq." + encodeURIComponent(expectedVersion), {
          method: "PATCH",
          headers: { "Prefer": "return=representation" },
          body: JSON.stringify({ data: appDataObj })
        }, true);
      const rows = await res.json();
      if (!rows.length) return { conflict: true }; // 版本不符，一列都沒改到
      return { conflict: false, row: rows[0] };
    });
  },

  /* 不管雲端現在是什麼版本，直接覆蓋過去。
     只在使用者於衝突對話框明確選擇「以本機為準」時才會走到這裡。 */
  overwrite: async function(appDataObj) {
    const user = syncAuth.currentUser();
    if (!user) throw syncApiError("尚未登入");

    return withFreshSession(async function() {
      const res = await supabaseFetch("/rest/v1/world_data", {
        method: "POST",
        headers: {
          "Prefer": "return=representation,resolution=merge-duplicates"
        },
        body: JSON.stringify({ user_id: user.id, data: appDataObj })
      }, true);
      const rows = await res.json();
      return { conflict: false, row: rows[0] };
    });
  }
};

/* ==========================================================
   provider 介面

   sync.js 只透過下面這組方法跟後端講話（pull / push / overwrite
   / account / isConfigured / signOut / renderSetup），所以衝突偵測、
   debounce、狀態顯示那些流程不必知道自己接的是誰，換後端也不用動。
   ========================================================== */

const supabaseProvider = {
  id: "supabase",
  label: "Supabase",
  blurb: "資料存在 Supabase 資料庫。設定簡單，衝突保護最完整。",

  isConfigured: isSyncConfigured,

  account: function() {
    const u = syncAuth.currentUser();
    return u ? (u.email || "已登入") : null;
  },

  signOut: function() { syncAuth.signOut(); },

  pull: async function() {
    const row = await syncData.pull();
    return row ? { data: row.data, version: row.version, at: row.updated_at } : null;
  },

  push: async function(data, expectedVersion) {
    const r = await syncData.push(data, expectedVersion);
    if (r.conflict) return { conflict: true };
    return { conflict: false, version: r.row.version, at: r.row.updated_at };
  },

  overwrite: async function(data) {
    const r = await syncData.overwrite(data);
    return { conflict: false, version: r.row.version, at: r.row.updated_at };
  },

  /* 尚未設定或尚未登入時，面板要顯示的內容 */
  renderSetup: function() {
    const cfg = loadSyncConfig();
    if (!cfg.url || !cfg.anonKey) {
      return '<p style="font-size:12px; color:var(--text-secondary); line-height:1.7;">' +
        '填入你的 Supabase 專案資訊。只需要 <b>anon public</b> 那把金鑰，' +
        '它設計上就可以公開；<b>service_role</b> 那把絕對不要貼在這裡。<br>' +
        '這些資訊只會存在這台裝置的瀏覽器裡。</p>' +
        '<label style="font-size:12px; font-weight:600;">Project URL</label>' +
        '<input type="text" id="syncUrlInput" class="form-input" placeholder="https://xxxxx.supabase.co" value="' + escapeHtml(cfg.url) + '">' +
        '<label style="font-size:12px; font-weight:600; margin-top:8px; display:block;">anon public key</label>' +
        '<input type="password" id="syncKeyInput" class="form-input" placeholder="eyJhbGciOi..." value="' + escapeHtml(cfg.anonKey) + '">' +
        '<div id="syncModalMsg" style="font-size:12px; color:var(--danger); margin-top:8px;"></div>' +
        '<button class="btn btn-primary" style="margin-top:10px;" onclick="submitSyncConfig()">儲存連線資訊</button>';
    }
    return '<p style="font-size:12px; color:var(--text-secondary); line-height:1.7;">' +
      '用信箱建立帳號或登入。資料綁在這個帳號底下，' +
      '在別台裝置登入同一個帳號就能取得同一份資料。</p>' +
      '<label style="font-size:12px; font-weight:600;">信箱</label>' +
      '<input type="email" id="syncEmailInput" class="form-input" placeholder="you@example.com">' +
      '<label style="font-size:12px; font-weight:600; margin-top:8px; display:block;">密碼</label>' +
      '<input type="password" id="syncPasswordInput" class="form-input" placeholder="至少 6 個字元">' +
      '<div id="syncModalMsg" style="font-size:12px; margin-top:8px;"></div>' +
      '<div style="display:flex; gap:8px; margin-top:10px;">' +
      '<button class="btn btn-primary" style="flex:1;" onclick="submitSyncSignIn()">登入</button>' +
      '<button class="btn btn-secondary" style="flex:1;" onclick="submitSyncSignUp()">建立帳號</button>' +
      '</div>' +
      '<button class="btn btn-secondary" style="margin-top:10px; font-size:11px;" onclick="clearSyncConfig()">更改連線資訊</button>';
  }
};

/* ---------- Supabase 專屬的面板操作 ---------- */

function submitSyncConfig() {
  const url = document.getElementById("syncUrlInput").value.trim();
  const key = document.getElementById("syncKeyInput").value.trim();
  if (!url || !key) { setSyncModalMsg("兩個欄位都要填。", true); return; }
  if (!/^https:\/\/.+/.test(url)) { setSyncModalMsg("Project URL 應該長得像 https://xxxxx.supabase.co", true); return; }
  saveSyncConfig(url, key);
  renderSyncModal();
}

function clearSyncConfig() {
  localStorage.removeItem(SYNC_CONFIG_KEY);
  syncAuth.signOut();
  setSyncStatus("off");
  renderSyncModal();
}

async function submitSyncSignIn() {
  const email = document.getElementById("syncEmailInput").value.trim();
  const password = document.getElementById("syncPasswordInput").value;
  if (!email || !password) { setSyncModalMsg("請填入信箱與密碼。", true); return; }
  setSyncModalMsg("登入中…");
  try {
    await syncAuth.signIn(email, password);
    renderSyncModal();
    await initSync();
  } catch (e) {
    setSyncModalMsg(e.message || "登入失敗", true);
  }
}

async function submitSyncSignUp() {
  const email = document.getElementById("syncEmailInput").value.trim();
  const password = document.getElementById("syncPasswordInput").value;
  if (!email || !password) { setSyncModalMsg("請填入信箱與密碼。", true); return; }
  setSyncModalMsg("建立中…");
  try {
    const result = await syncAuth.signUp(email, password);
    if (!result.signedIn) {
      setSyncModalMsg("帳號已建立，請先到信箱收驗證信，完成後再回來登入。");
      return;
    }
    renderSyncModal();
    await initSync();
  } catch (e) {
    setSyncModalMsg(e.message || "建立帳號失敗", true);
  }
}
