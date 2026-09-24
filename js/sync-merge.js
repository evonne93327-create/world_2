/* ==========================================================
   逐篇合併（三方合併）

   為什麼需要

   雲端存的是「整包 appData 的一筆記錄」，版本號只有一個。原本的判斷是整包
   二選一：平板改了第 1 篇、手機改了第 2 篇，兩邊都算「有改過」，於是跳出
   衝突視窗要你挑一邊——挑哪邊都會丟掉另一台的那一篇。

   使用者要的是「在不同裝置上同時處理兩個檔案」。真正該改的不是同步的範圍
   （只同步目前這篇的話，其他篇就永遠不會同步了），而是**衝突的粒度**：
   只有「同一篇兩邊都改」才算衝突。

   怎麼判斷「這一邊改了沒」

   三方合併要有一個共同祖先。但把上次同步的整包快照存進 localStorage 會讓
   佔用直接翻倍——這個 app 的圖片是 base64 存在文檔裡的，很容易就撐爆
   5MB 的額度。

   其實不需要祖先的「內容」，只需要回答「這一邊跟祖先一不一樣」。所以只存
   **每一項的雜湊**：一篇文檔幾十個位元組，跟內容長度無關。

   於是每一項都問得出四個事實：在不在祖先裡、在不在本機、在不在雲端、
   兩邊各自改了沒。剩下的就是查表。

   刪除不需要墓碑：祖先裡有、這一邊沒有，就是這一邊刪掉了。
   （這個 app 的刪除是搬到 trash，trash 本身也走同一套合併，所以「從垃圾桶
   還原」也會自然正確——它在 trash 那一邊是刪除，在 docs 那一邊是新增。）

   不確定的一律算衝突，交給使用者。這份檔案寧可多問，不可以自己猜。

   衝突是「逐筆」的

   同一筆兩邊都改了，那一筆兩邊都不動：本機照樣看得到自己的版本，推上雲端
   的那一份則保留雲端原本的版本——所以合併會算出兩份結果：data（這台要顯示
   的）與 upload（要推上去的），差別只在還沒決定的那幾筆。其他沒撞到的照常
   同步。使用者選了之後（applyRecordChoice）那一筆才重新跟著走。

   白板逐個物件

   世界觀拆成「本身的欄位」（名稱、簡介…）與白板上的每一個節點／連線／
   便條紙，各自有自己的雜湊，用 世界觀id|nodes|物件id 當鍵。兩台在同一塊
   白板上各動一張便條紙不會互相衝突。
   ========================================================== */

/* 穩定的序列化：鍵一律照字母排序。

   不能直接用 JSON.stringify——它照的是屬性的插入順序。同一篇文檔在兩台
   裝置上經過不同的程式路徑（新增 vs 匯入 vs 從雲端還原），屬性順序可能不同，
   內容明明一樣卻算出不同的雜湊，於是被判定成「兩邊都改了」→ 假衝突。 */
function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return "[" + value.map(stableStringify).join(",") + "]";
  }
  const keys = Object.keys(value).sort();
  return "{" + keys.map(function(k) {
    return JSON.stringify(k) + ":" + stableStringify(value[k]);
  }).join(",") + "}";
}

/* cyrb53：兩個 32 位元湊成 53 位元。

   碰撞的後果是「以為這一邊沒改」→ 採用另一邊 → 丟掉一次編輯，所以不能用
   那種只有 32 位元的簡單雜湊。53 位元在這個量級（一個人的文檔數）下，
   碰撞機率低到不用考慮。 */
function hashString(str) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

function hashItem(item) {
  return hashString(stableStringify(item));
}

/* 把一個陣列變成 { id: 雜湊 }。沒有 id 的項目直接略過——沒有 id 就沒辦法
   在兩邊之間對應起來，只能當成不可合併（呼叫端會因此判成衝突）。 */
function hashById(list) {
  const out = {};
  (list || []).forEach(function(item) {
    if (item && item.id) out[item.id] = hashItem(item);
  });
  return out;
}

function byId(list) {
  const out = {};
  (list || []).forEach(function(item) {
    if (item && item.id) out[item.id] = item;
  });
  return out;
}

/* 垃圾桶裡的白板項目（trash.canvas）拿來合併用的鍵。

   這些項目本身沒有 id，但它們裝著的節點／連線／便條紙有（entry.node.id 之類），
   再加上刪除的時間戳：每台裝置上都一樣，而且同一個節點刪兩次也分得開——
   節點 id 是 "node_" + 文檔 id，投射、刪掉、再投射、再刪掉，兩次的 id 一樣。

   組不出來（缺 kind 或內容沒有 id）回 null，呼叫端要自己決定怎麼處理，
   不可以直接丟掉。 */
function canvasTrashKey(entry) {
  if (!entry || !entry.kind) return null;
  const payload = entry[entry.kind];
  if (!payload || !payload.id) return null;
  return entry.kind + ":" + payload.id + ":" + (entry.deletedTs || 0);
}

/* 包成 { id, entry }，讓 mergeCollection() 能照 id 對應。組不出鍵的不包。 */
function keyedCanvasTrash(list) {
  const out = [];
  (list || []).forEach(function(e) {
    const k = canvasTrashKey(e);
    if (k) out.push({ id: k, entry: e });
  });
  return out;
}

/* ---------- 世界觀拆成「本身」與「白板上的物件」 ---------- */

const CANVAS_COLLECTIONS = ["nodes", "edges", "notes"];
const CANVAS_CONFLICT_KIND = { nodes: "canvasNode", edges: "canvasEdge", notes: "canvasNote" };

/* 世界觀本身的欄位：除了白板上那三個陣列以外的全部（canvas 底下其他欄位
   也算在這裡，以後加的東西不會漏掉）。 */
function worldMetaOf(world) {
  const out = {};
  Object.keys(world || {}).forEach(function(k) {
    if (k !== "canvas") out[k] = world[k];
  });
  if (world && world.canvas && typeof world.canvas === "object") {
    const c = {};
    Object.keys(world.canvas).forEach(function(k) {
      if (CANVAS_COLLECTIONS.indexOf(k) === -1) c[k] = world.canvas[k];
    });
    out.canvas = c;
  }
  return out;
}

function canvasObjectKey(worldId, coll, id) {
  return worldId + "|" + coll + "|" + id;
}

/* 反過來拆。物件 id 本身不含 "|"，但保險起見第三段之後全部接回去。 */
function parseCanvasObjectKey(key) {
  const parts = String(key).split("|");
  if (parts.length < 3) return null;
  return { worldId: parts[0], coll: parts[1], id: parts.slice(2).join("|") };
}

function canvasHashes(worldviews) {
  const out = {};
  (worldviews || []).forEach(function(w) {
    if (!w || !w.id || !w.canvas) return;
    CANVAS_COLLECTIONS.forEach(function(coll) {
      (w.canvas[coll] || []).forEach(function(obj) {
        if (obj && obj.id) out[canvasObjectKey(w.id, coll, obj.id)] = hashItem(obj);
      });
    });
  });
  return out;
}

function worldMetaHashes(worldviews) {
  const out = {};
  (worldviews || []).forEach(function(w) {
    if (w && w.id) out[w.id] = hashItem(worldMetaOf(w));
  });
  return out;
}

/* 上次同步當下的指紋。存進 localStorage 的就是這個。

   只存雜湊，不存內容：一篇文檔幾十位元組，跟文章多長無關。

   worldviews 是整個世界觀（連白板）的雜湊，只在「一邊有、一邊沒有」的時候
   用（一邊刪了世界觀、另一邊改了它的白板，要能判成衝突）；兩邊都有的時候
   看 worldMeta 與 canvas，逐個物件合併。 */
function fingerprintOf(data) {
  const d = data || {};
  const trash = d.trash || {};
  return {
    docs: hashById(d.docs),
    folders: hashById(d.folders),
    worldviews: hashById(d.worldviews),
    worldMeta: worldMetaHashes(d.worldviews),
    canvas: canvasHashes(d.worldviews),
    trashDocs: hashById(trash.docs),
    trashFolders: hashById(trash.folders),
    trashCanvas: hashById(keyedCanvasTrash(trash.canvas)),
    trashWorlds: hashById(trash.worlds),
    tagSettings: hashItem(d.tagSettings || {})
  };
}

/* 一個集合的三方合併。

   baseHashes：上次同步時每一項的雜湊（祖先）
   localList / remoteList：現在的兩邊

   回傳 { list, upload, conflicts }。conflicts 裡放的是 id，呼叫端再去補標題。
   list 是這台要顯示的、upload 是要推上雲端的；兩者只在衝突的那幾筆不同：
   list 照本機（本機刪了就沒有）、upload 照雲端（雲端刪了就沒有）——
   還沒決定之前，兩邊都不被對方蓋掉。

   查表（present = 在這一邊看得到，changed = 跟祖先不一樣）：

     兩邊都有 ─ 兩邊都改且內容不同 → 衝突
              ├ 只有本機改         → 本機
              ├ 只有雲端改         → 雲端
              └ 都沒改             → 隨便一邊（內容一樣）
     只有本機 ─ 祖先有 → 雲端刪掉了 ─ 本機也改過 → 衝突（一邊改一邊刪）
              │                    └ 沒改       → 跟著刪
              └ 祖先沒有 → 本機新增的 → 留著
     只有雲端 ─ 對稱處理
*/
function mergeCollection(baseHashes, localList, remoteList) {
  const base = baseHashes || {};
  const localMap = byId(localList);
  const remoteMap = byId(remoteList);

  const ids = [];
  const seen = {};
  /* 順序以本機為主、雲端新增的接在後面。使用者看到的排列不會因為一次合併
     就整個重洗——目錄是照這個陣列的順序畫的。 */
  (localList || []).forEach(function(it) {
    if (it && it.id && !seen[it.id]) { seen[it.id] = true; ids.push(it.id); }
  });
  (remoteList || []).forEach(function(it) {
    if (it && it.id && !seen[it.id]) { seen[it.id] = true; ids.push(it.id); }
  });

  const list = [];
  const upload = [];
  const conflicts = [];
  function both(item) { list.push(item); upload.push(item); }

  ids.forEach(function(id) {
    const inBase = Object.prototype.hasOwnProperty.call(base, id);
    const localItem = localMap[id];
    const remoteItem = remoteMap[id];
    const hasLocal = localItem !== undefined;
    const hasRemote = remoteItem !== undefined;

    const localHash = hasLocal ? hashItem(localItem) : null;
    const remoteHash = hasRemote ? hashItem(remoteItem) : null;
    const localChanged = hasLocal && (!inBase || localHash !== base[id]);
    const remoteChanged = hasRemote && (!inBase || remoteHash !== base[id]);

    if (hasLocal && hasRemote) {
      if (localHash === remoteHash) { both(localItem); return; }
      if (localChanged && remoteChanged) {
        conflicts.push(id); list.push(localItem); upload.push(remoteItem); return;
      }
      both(localChanged ? localItem : remoteItem);
      return;
    }

    if (hasLocal) {
      // 雲端沒有：祖先有過就是那邊刪了，祖先沒有就是這邊剛新增
      if (!inBase) { both(localItem); return; }
      if (localChanged) { conflicts.push(id); list.push(localItem); return; }
      return;                                    // 跟著刪
    }

    if (hasRemote) {
      if (!inBase) { both(remoteItem); return; }
      if (remoteChanged) { conflicts.push(id); upload.push(remoteItem); return; }
      return;                                    // 跟著刪
    }
  });

  return { list: list, upload: upload, conflicts: conflicts };
}

/* tagSettings 是 { 標籤: 顏色 } 的物件，用同一套規則逐鍵合併。
   祖先只存了整包的雜湊，所以這裡只分得出「整包有沒有變」——兩邊都變的話
   就逐鍵取「有改的那一邊」，同一個鍵兩邊都改成不同顏色才算衝突。 */
function mergeTagSettings(baseHash, localTags, remoteTags) {
  const l = localTags || {};
  const r = remoteTags || {};
  const localChanged = hashItem(l) !== baseHash;
  const remoteChanged = hashItem(r) !== baseHash;

  if (!localChanged) return { value: r, conflicts: [] };
  if (!remoteChanged) return { value: l, conflicts: [] };

  /* 兩邊都動過。逐鍵合併：只有一邊有的就收進來，兩邊都有且不同的，
     顏色這種東西挑一邊不會毀掉內容，取本機的並記一筆（不升級成擋下整次
     合併的衝突——為了標籤顏色讓使用者去選整包太重了）。 */
  const out = {};
  Object.keys(r).forEach(function(k) { out[k] = r[k]; });
  Object.keys(l).forEach(function(k) { out[k] = l[k]; });
  return { value: out, conflicts: [] };
}

/* ---------- 還沒決定的衝突 ----------

   使用者按「稍後再決定」之後，那幾筆要一直算衝突，直到他選了為止。
   不能只靠「兩邊跟祖先都不一樣」自然再判一次：推上去的是雲端那一版，
   推完之後祖先就記成雲端那一版，下一輪看起來變成「只有本機改」——
   然後安靜地把本機那一版推上去，等於沒問就覆蓋了雲端。

   所以合併前把這幾筆在祖先裡的雜湊換成一個誰都對不上的記號：兩邊都一定
   「跟祖先不一樣」，還是衝突。兩邊後來剛好改成一模一樣的話，mergeCollection
   那條「內容相同」會先接住，衝突就自然消失——那也是對的。 */
const CONFLICT_SENTINEL = "!conflict";

/* 衝突的種類 → 它在指紋裡是哪幾個鍵 */
const CONFLICT_FP_KEYS = {
  doc: ["docs"], folder: ["folders"], world: ["worldviews", "worldMeta"],
  trashDoc: ["trashDocs"], trashFolder: ["trashFolders"],
  trashCanvas: ["trashCanvas"], trashWorld: ["trashWorlds"],
  canvasNode: ["canvas"], canvasEdge: ["canvas"], canvasNote: ["canvas"]
};

function withPendingSentinels(base, pending) {
  if (!pending || !pending.length) return base;
  const out = {};
  Object.keys(base).forEach(function(k) {
    const v = base[k];
    out[k] = (v && typeof v === "object") ? Object.assign({}, v) : v;
  });
  pending.forEach(function(c) {
    (CONFLICT_FP_KEYS[c && c.kind] || []).forEach(function(k) {
      /* 舊指紋沒有 worldMeta 就不要憑空加一個：有沒有這一欄決定了世界觀
         要不要逐個物件合併（見 mergeWorlds），加了等於假裝有祖先。 */
      if (k === "worldMeta" && !out.worldMeta) return;
      if (!out[k] || typeof out[k] !== "object") out[k] = {};
      out[k][c.id] = CONFLICT_SENTINEL;
    });
  });
  return out;
}

/* ---------- 世界觀的合併 ----------

   兩邊都有：本身的欄位當一筆、白板上每個物件各當一筆，各自三方合併。
   只有一邊有：整個世界觀當一筆，走一般的規則（一邊刪、另一邊改＝衝突）。

   舊的指紋（升級前存的）沒有 worldMeta／canvas：先用整個世界觀的雜湊看
   是不是只有一邊動過；兩邊都動過才逐個物件合併，而那時白板沒有祖先，
   只能取兩邊的聯集——分不出刪除的時候寧可多留。 */
function mergeWorlds(base, localList, remoteList, titleOf) {
  const wholeBase = base.worldviews || {};
  const newStyle = !!(base.worldMeta && typeof base.worldMeta === "object");
  const metaBase = base.worldMeta || {};
  const canvasBase = base.canvas || {};
  const localMap = byId(localList);
  const remoteMap = byId(remoteList);

  const ids = [];
  const seen = {};
  (localList || []).concat(remoteList || []).forEach(function(w) {
    if (w && w.id && !seen[w.id]) { seen[w.id] = true; ids.push(w.id); }
  });

  const list = [];
  const upload = [];
  const conflicts = [];

  ids.forEach(function(id) {
    const L = localMap[id];
    const R = remoteMap[id];

    if (!L || !R) {
      const whole = {};
      if (Object.prototype.hasOwnProperty.call(wholeBase, id)) whole[id] = wholeBase[id];
      const res = mergeCollection(whole, L ? [L] : [], R ? [R] : []);
      res.list.forEach(function(w) { list.push(w); });
      res.upload.forEach(function(w) { upload.push(w); });
      res.conflicts.forEach(function() {
        conflicts.push({ kind: "world", id: id, title: titleOf.world(L || R) });
      });
      return;
    }

    const hl = hashItem(L);
    const hr = hashItem(R);
    if (hl === hr) { list.push(L); upload.push(L); return; }

    let metaBaseOne = {};
    let objBase = canvasBase;
    if (!newStyle) {
      const inBase = Object.prototype.hasOwnProperty.call(wholeBase, id);
      if (inBase && wholeBase[id] === hl) { list.push(R); upload.push(R); return; }
      if (inBase && wholeBase[id] === hr) { list.push(L); upload.push(L); return; }
      objBase = {};
    } else if (Object.prototype.hasOwnProperty.call(metaBase, id)) {
      metaBaseOne[id] = metaBase[id];
    }

    // 世界觀本身（名稱、簡介…）
    const meta = mergeCollection(metaBaseOne, [worldMetaOf(L)], [worldMetaOf(R)]);
    if (meta.conflicts.length) conflicts.push({ kind: "world", id: id, title: titleOf.world(L) });
    const metaLocal = meta.list[0] || worldMetaOf(L);
    const metaUpload = meta.upload[0] || worldMetaOf(R);

    // 白板上的每一個物件
    const lc = L.canvas || {};
    const rc = R.canvas || {};
    const canvasLocal = {};
    const canvasUpload = {};
    CANVAS_COLLECTIONS.forEach(function(coll) {
      const prefix = id + "|" + coll + "|";
      const bh = {};
      Object.keys(objBase).forEach(function(k) {
        if (k.indexOf(prefix) === 0) bh[k.slice(prefix.length)] = objBase[k];
      });
      const res = mergeCollection(bh, lc[coll], rc[coll]);
      const lm = byId(lc[coll]);
      const rm = byId(rc[coll]);
      res.conflicts.forEach(function(oid) {
        conflicts.push({
          kind: CANVAS_CONFLICT_KIND[coll], id: canvasObjectKey(id, coll, oid),
          title: titleOf.canvas(L, coll, lm[oid] || rm[oid] || {})
        });
      });
      // 兩邊原本都沒有這個陣列、合併完也是空的，就不要平白多一個欄位
      const had = Array.isArray(lc[coll]) || Array.isArray(rc[coll]);
      if (had || res.list.length) canvasLocal[coll] = res.list;
      if (had || res.upload.length) canvasUpload[coll] = res.upload;
    });

    list.push(assembleWorld(metaLocal, canvasLocal, L.canvas || R.canvas));
    upload.push(assembleWorld(metaUpload, canvasUpload, R.canvas || L.canvas));
  });

  return { list: list, upload: upload, conflicts: conflicts };
}

function assembleWorld(meta, arrays, hadCanvas) {
  const w = {};
  Object.keys(meta).forEach(function(k) { if (k !== "canvas") w[k] = meta[k]; });
  if (hadCanvas || meta.canvas || Object.keys(arrays).length) {
    w.canvas = Object.assign({}, meta.canvas || {}, arrays);
  }
  return w;
}

/* 三方合併整包資料。

   base    fingerprintOf() 存下來的指紋
   local   這台裝置現在的 appData
   remote  雲端那一份
   pending 之前已經發現、使用者還沒決定的衝突 [{ kind, id }]（見上面的記號）

   回傳 { data, upload, conflicts, changedFromLocal, changedFromRemote }

   data 是這台要顯示的、upload 是要推上雲端的——兩者只在 conflicts 那幾筆
   不同（見 mergeCollection）。conflicts 是 [{ kind, id, title }]。
   changedFromRemote 看的是 upload：雲端要不要更新。

   沒有指紋（第一次、或換了後端）時回 null——呼叫端要退回原本「整包二選一」
   的路，不可以當成「沒有衝突」。 */
function mergeAppData(base, local, remote, pending) {
  if (!base || !local || !remote) return null;
  base = withPendingSentinels(base, pending);

  const conflicts = [];
  const localTrash = local.trash || {};
  const remoteTrash = remote.trash || {};

  function run(kind, baseHashes, l, r, titleOf) {
    const res = mergeCollection(baseHashes, l, r);
    const localMap = byId(l);
    const remoteMap = byId(r);
    res.conflicts.forEach(function(id) {
      const item = localMap[id] || remoteMap[id] || {};
      conflicts.push({ kind: kind, id: id, title: titleOf(item) });
    });
    return res;
  }

  const docTitle = function(d) { return d.title || "未命名文檔"; };
  const nameOf = function(x) { return x.name || "未命名"; };

  /* 白板物件的標題：使用者要看得出是哪一個。節點用它對應的文檔標題。 */
  const allDocs = byId((remote.docs || []).concat(local.docs || []));
  const canvasTitle = function(world, coll, obj) {
    const where = (world.name || "未命名") + "・";
    if (coll === "nodes") {
      const d = allDocs[obj.docId];
      return where + "白板節點：" + (d ? docTitle(d) : "（文檔不在了）");
    }
    if (coll === "edges") return where + "白板連線：" + (obj.label || "關聯");
    const text = String(obj.text || "").trim();
    return where + "便條紙：" + (text ? text.slice(0, 20) : "（空白）");
  };

  /* 先合併正文、再合併垃圾桶：conflicts 的順序就是衝突彈窗列出來的順序，
     使用者要先看到的是文檔本身，不是垃圾桶裡的東西。 */
  const docs = run("doc", base.docs, local.docs, remote.docs, docTitle);
  const folders = run("folder", base.folders, local.folders, remote.folders, nameOf);
  const worlds = mergeWorlds(base, local.worldviews, remote.worldviews,
    { world: nameOf, canvas: canvasTitle });
  worlds.conflicts.forEach(function(c) { conflicts.push(c); });

  const merged = { docs: docs.list, folders: folders.list, worldviews: worlds.list };
  const up = { docs: docs.upload, folders: folders.upload, worldviews: worlds.upload };

  const tDocs = run("trashDoc", base.trashDocs, localTrash.docs, remoteTrash.docs, docTitle);
  const tFolders = run("trashFolder", base.trashFolders, localTrash.folders, remoteTrash.folders, nameOf);
  const trash = { docs: tDocs.list, folders: tFolders.list };
  const trashUp = { docs: tDocs.upload, folders: tFolders.upload };

  /* 白板的垃圾。以前這裡沒有這一段，trash.canvas 在任何一次自動合併之後都
     會整個消失（兩台各改一篇就會觸發自動合併，非常常見）。

     兩邊都沒有這一欄就不要平白加一個空陣列——多出來的話 changedFromLocal
     會變成 true，每次合併都多一次上傳。

     base.trashCanvas 不存在（升級前存的舊指紋）時，mergeCollection 會把每一筆
     都當成「這一邊新增的」，結果就是兩邊的聯集。分不出「刪了」還是「從來
     沒有」的時候，寧可多留一筆。 */
  if (localTrash.canvas || remoteTrash.canvas) {
    const keyed = run("trashCanvas", base.trashCanvas,
      keyedCanvasTrash(localTrash.canvas), keyedCanvasTrash(remoteTrash.canvas),
      function(w) { return (w.entry && w.entry.label) || "白板項目"; });
    const unwrap = function(w) { return w.entry; };
    trash.canvas = keyed.list.map(unwrap);
    trashUp.canvas = keyed.upload.map(unwrap);
    // 組不出鍵的（資料缺欄位）沒辦法跟另一邊對應，照本機的留著，不要丟
    (localTrash.canvas || []).forEach(function(e) {
      if (!canvasTrashKey(e)) { trash.canvas.push(e); trashUp.canvas.push(e); }
    });
  }

  /* 垃圾桶裡整筆的世界觀（刪世界觀時連白板一起存下來，才能整個復原）。
     有 id（就是世界觀的 id），直接走一般的三方合併。規則同上：兩邊都沒有
     就不加；舊指紋沒有 trashWorlds 時退成聯集。

     「照本機的留著」在這裡不夠：那只保得住這一台刪的，另一台刪的世界觀
     會永遠看不到、也復原不了。 */
  if (localTrash.worlds || remoteTrash.worlds) {
    const tWorlds = run("trashWorld", base.trashWorlds, localTrash.worlds, remoteTrash.worlds, nameOf);
    trash.worlds = tWorlds.list;
    trashUp.worlds = tWorlds.upload;
  }

  /* trash 底下其他沒列到的欄位（以後加的）照本機的留著。跟下面頂層的規則
     一樣——trash.canvas 當初就是因為「後來才加、合併這裡沒跟著改」才不見的。 */
  Object.keys(localTrash).forEach(function(k) {
    if (!Object.prototype.hasOwnProperty.call(trash, k)) {
      trash[k] = localTrash[k];
      trashUp[k] = localTrash[k];
    }
  });

  merged.trash = trash;
  up.trash = trashUp;

  const tags = mergeTagSettings(base.tagSettings, local.tagSettings, remote.tagSettings);
  merged.tagSettings = tags.value;
  up.tagSettings = tags.value;

  /* 其他沒列到的頂層欄位（以後加的）照本機的留著，不要在合併時弄丟。
     它們不參與合併，所以也不會製造衝突。 */
  Object.keys(local).forEach(function(k) {
    if (!Object.prototype.hasOwnProperty.call(merged, k)) {
      merged[k] = local[k];
      up[k] = local[k];
    }
  });

  return {
    data: merged,
    upload: up,
    conflicts: conflicts,
    changedFromLocal: stableStringify(merged) !== stableStringify(local),
    changedFromRemote: stableStringify(up) !== stableStringify(remote)
  };
}

/* ==========================================================
   使用者對某一筆衝突做了決定

   choice：
     "local"  用這台的：本機不動，把這一筆的祖先記成雲端現在的樣子——
              下一輪合併看起來就是「只有本機改」，這台的版本會被推上去。
     "remote" 用雲端的：把本機這一筆換成雲端的（雲端刪了就跟著刪）。
     "both"   兩份都留（只有兩邊都有的文檔可以）：本機這一篇另存成一篇
              「（衝突副本）」，原本那篇換成雲端的。

   回傳 { data, fp }，都是新的物件，不動傳進來的那兩份。呼叫端存好之後
   再跑一次合併把結果推上去。
   ========================================================== */

const LIVE_TRASH_PAIRS = {
  doc: ["docs", "trashDocs"], trashDoc: ["trashDocs", "docs"],
  folder: ["folders", "trashFolders"], trashFolder: ["trashFolders", "folders"],
  world: ["worldviews", "trashWorlds"], trashWorld: ["trashWorlds", "worldviews"]
};

function recordListRef(data, where) {
  if (where === "docs" || where === "folders" || where === "worldviews") {
    if (!Array.isArray(data[where])) data[where] = [];
    return data[where];
  }
  if (!data.trash) data.trash = {};
  const k = { trashDocs: "docs", trashFolders: "folders", trashWorlds: "worlds", trashCanvas: "canvas" }[where];
  if (!Array.isArray(data.trash[k])) data.trash[k] = [];
  return data.trash[k];
}

function recordWhere(kind) {
  return { doc: "docs", folder: "folders", world: "worldviews", trashDoc: "trashDocs",
           trashFolder: "trashFolders", trashWorld: "trashWorlds", trashCanvas: "trashCanvas" }[kind];
}

/* 某一筆在這份資料裡的樣子；沒有回 undefined。 */
function getRecord(data, kind, id) {
  if (!data) return undefined;
  if (CANVAS_CONFLICT_KIND.nodes === kind || CANVAS_CONFLICT_KIND.edges === kind ||
      CANVAS_CONFLICT_KIND.notes === kind) {
    const k = parseCanvasObjectKey(id);
    if (!k) return undefined;
    const w = (data.worldviews || []).find(function(x) { return x && x.id === k.worldId; });
    const arr = w && w.canvas && w.canvas[k.coll];
    return (arr || []).find(function(o) { return o && o.id === k.id; });
  }
  const where = recordWhere(kind);
  if (!where) return undefined;
  const arr = where === "trashCanvas"
    ? ((data.trash && data.trash.canvas) || [])
    : (where.indexOf("trash") === 0
        ? ((data.trash && data.trash[{ trashDocs: "docs", trashFolders: "folders", trashWorlds: "worlds" }[where]]) || [])
        : (data[where] || []));
  return arr.find(function(x) {
    return where === "trashCanvas" ? canvasTrashKey(x) === id : (x && x.id === id);
  });
}

/* 把某一筆設成 value（undefined＝移除）。回傳有沒有放得進去。 */
function setRecord(data, kind, id, value) {
  const k = parseCanvasObjectKey(id);
  if (kind === "canvasNode" || kind === "canvasEdge" || kind === "canvasNote") {
    if (!k) return false;
    const w = (data.worldviews || []).find(function(x) { return x && x.id === k.worldId; });
    if (!w) return false;
    if (!w.canvas) w.canvas = {};
    if (!Array.isArray(w.canvas[k.coll])) w.canvas[k.coll] = [];
    return replaceIn(w.canvas[k.coll], function(o) { return o && o.id === k.id; }, value);
  }
  const where = recordWhere(kind);
  if (!where) return false;
  const arr = recordListRef(data, where);
  const match = where === "trashCanvas"
    ? function(x) { return canvasTrashKey(x) === id; }
    : function(x) { return x && x.id === id; };
  return replaceIn(arr, match, value);
}

function replaceIn(arr, match, value) {
  const i = arr.findIndex(match);
  if (value === undefined) { if (i >= 0) arr.splice(i, 1); return true; }
  if (i >= 0) arr[i] = value; else arr.push(value);
  return true;
}

/* 這一筆在指紋裡該記成什麼：照雲端現在的樣子。雲端沒有就把鍵拿掉。 */
function fpSetRecord(fp, kind, id, remoteValue) {
  function put(key, hash) {
    if (!fp[key] || typeof fp[key] !== "object") fp[key] = {};
    if (hash === undefined) delete fp[key][id];
    else fp[key][id] = hash;
  }
  const has = remoteValue !== undefined;
  if (kind === "world") {
    put("worldviews", has ? hashItem(remoteValue) : undefined);
    put("worldMeta", has ? hashItem(worldMetaOf(remoteValue)) : undefined);
    return;
  }
  if (kind === "trashCanvas") {
    put("trashCanvas", has ? hashItem({ id: id, entry: remoteValue }) : undefined);
    return;
  }
  const keys = CONFLICT_FP_KEYS[kind];
  if (!keys) return;
  put(keys[0], has ? hashItem(remoteValue) : undefined);
}

function applyRecordChoice(local, fp, remoteData, conflict, choice, newDocId) {
  const data = JSON.parse(JSON.stringify(local));
  const nextFp = JSON.parse(JSON.stringify(fp || {}));
  const kind = conflict.kind;
  const id = conflict.id;
  const remoteValue = getRecord(remoteData, kind, id);
  const localValue = getRecord(data, kind, id);
  const clone = function(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); };

  fpSetRecord(nextFp, kind, id, remoteValue);
  if (choice === "local") return { data: data, fp: nextFp };

  if (choice === "both" && kind === "doc" && localValue && remoteValue && newDocId) {
    const copy = clone(localValue);
    copy.id = newDocId;
    copy.title = (localValue.title || "未命名文檔") + "（衝突副本）";
    const i = data.docs.findIndex(function(d) { return d.id === id; });
    data.docs.splice(i + 1, 0, copy);
  }

  let value = clone(remoteValue);
  /* 世界觀兩邊都在：這一筆衝突只是「世界觀本身」（名稱、簡介…），白板上的
     物件各自有各自的衝突，不能跟著整個被換掉。 */
  if (kind === "world" && localValue && value) {
    value = assembleWorld(worldMetaOf(value), pickCanvasArrays(localValue), localValue.canvas || value.canvas);
  }
  setRecord(data, kind, id, value);

  /* 同一個 id 不可以同時是「正在用的」又在垃圾桶裡：換成雲端版本之後，
     另一邊那一份要拿掉，不然還原的時候會多出一模一樣的一份。 */
  const pair = LIVE_TRASH_PAIRS[kind];
  if (pair && value !== undefined) {
    const other = recordListRef(data, pair[1]);
    const j = other.findIndex(function(x) { return x && x.id === id; });
    if (j >= 0) other.splice(j, 1);
  }
  return { data: data, fp: nextFp };
}

function pickCanvasArrays(world) {
  const out = {};
  const c = (world && world.canvas) || {};
  CANVAS_COLLECTIONS.forEach(function(coll) {
    if (Array.isArray(c[coll])) out[coll] = c[coll];
  });
  return out;
}
