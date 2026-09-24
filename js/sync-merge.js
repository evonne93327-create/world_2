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

/* 上次同步當下的指紋。存進 localStorage 的就是這個。

   只存雜湊，不存內容：一篇文檔幾十位元組，跟文章多長無關。 */
function fingerprintOf(data) {
  const d = data || {};
  const trash = d.trash || {};
  return {
    docs: hashById(d.docs),
    folders: hashById(d.folders),
    worldviews: hashById(d.worldviews),
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

   回傳 { list, conflicts }。conflicts 裡放的是 id，呼叫端再去補標題。

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
  const conflicts = [];

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
      if (localHash === remoteHash) { list.push(localItem); return; }
      if (localChanged && remoteChanged) { conflicts.push(id); list.push(localItem); return; }
      list.push(localChanged ? localItem : remoteItem);
      return;
    }

    if (hasLocal) {
      // 雲端沒有：祖先有過就是那邊刪了，祖先沒有就是這邊剛新增
      if (!inBase) { list.push(localItem); return; }
      if (localChanged) { conflicts.push(id); list.push(localItem); return; }
      return;                                    // 跟著刪
    }

    if (hasRemote) {
      if (!inBase) { list.push(remoteItem); return; }
      if (remoteChanged) { conflicts.push(id); list.push(remoteItem); return; }
      return;                                    // 跟著刪
    }
  });

  return { list: list, conflicts: conflicts };
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

/* 三方合併整包資料。

   base   fingerprintOf() 存下來的指紋
   local  這台裝置現在的 appData
   remote 雲端那一份

   回傳 { data, conflicts, changedFromLocal, changedFromRemote }

   conflicts 是 [{ kind, id, title }]，非空就代表不能自己決定，要問使用者。
   沒有指紋（第一次、或換了後端）時回 null——呼叫端要退回原本「整包二選一」
   的路，不可以當成「沒有衝突」。 */
function mergeAppData(base, local, remote) {
  if (!base || !local || !remote) return null;

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
    return res.list;
  }

  const docTitle = function(d) { return d.title || "未命名文檔"; };
  const nameOf = function(x) { return x.name || "未命名"; };

  /* 先合併正文、再合併垃圾桶：conflicts 的順序就是衝突彈窗列出來的順序，
     使用者要先看到的是文檔本身，不是垃圾桶裡的東西。 */
  const merged = {
    docs: run("doc", base.docs, local.docs, remote.docs, docTitle),
    folders: run("folder", base.folders, local.folders, remote.folders, nameOf),
    worldviews: run("world", base.worldviews, local.worldviews, remote.worldviews, nameOf)
  };

  const trash = {
    docs: run("trashDoc", base.trashDocs, localTrash.docs, remoteTrash.docs, docTitle),
    folders: run("trashFolder", base.trashFolders, localTrash.folders, remoteTrash.folders, nameOf)
  };

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
    trash.canvas = keyed.map(function(w) { return w.entry; });
    // 組不出鍵的（資料缺欄位）沒辦法跟另一邊對應，照本機的留著，不要丟
    (localTrash.canvas || []).forEach(function(e) {
      if (!canvasTrashKey(e)) trash.canvas.push(e);
    });
  }

  /* 垃圾桶裡整筆的世界觀（刪世界觀時連白板一起存下來，才能整個復原）。
     有 id（就是世界觀的 id），直接走一般的三方合併。規則同上：兩邊都沒有
     就不加；舊指紋沒有 trashWorlds 時退成聯集。

     「照本機的留著」在這裡不夠：那只保得住這一台刪的，另一台刪的世界觀
     會永遠看不到、也復原不了。 */
  if (localTrash.worlds || remoteTrash.worlds) {
    trash.worlds = run("trashWorld", base.trashWorlds, localTrash.worlds, remoteTrash.worlds, nameOf);
  }

  /* trash 底下其他沒列到的欄位（以後加的）照本機的留著。跟下面頂層的規則
     一樣——trash.canvas 當初就是因為「後來才加、合併這裡沒跟著改」才不見的。 */
  Object.keys(localTrash).forEach(function(k) {
    if (!Object.prototype.hasOwnProperty.call(trash, k)) trash[k] = localTrash[k];
  });

  merged.trash = trash;

  const tags = mergeTagSettings(base.tagSettings, local.tagSettings, remote.tagSettings);
  merged.tagSettings = tags.value;

  /* 其他沒列到的頂層欄位（以後加的）照本機的留著，不要在合併時弄丟。
     它們不參與合併，所以也不會製造衝突。 */
  Object.keys(local).forEach(function(k) {
    if (!Object.prototype.hasOwnProperty.call(merged, k)) merged[k] = local[k];
  });

  return {
    data: merged,
    conflicts: conflicts,
    changedFromLocal: stableStringify(merged) !== stableStringify(local),
    changedFromRemote: stableStringify(merged) !== stableStringify(remote)
  };
}
