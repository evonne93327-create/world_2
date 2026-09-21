/* ==========================================================
   實機檢查（diag.html）

   只在這一頁用。它刻意不碰 localStorage、不呼叫任何會存檔的函式——
   這一頁跟正式 app 同源，寫下去就是寫到使用者的真實資料。
   ========================================================== */

const diagResults = {};

/* ---------- 畫面 ---------- */

function markOf(status) {
  return status === "ok" ? "✅" : status === "bad" ? "❌" : status === "warn" ? "⚠️" : "·";
}

/* 一列結果。status 用 ok / bad / warn / info；info 是「只是報數字，沒有對錯」。 */
function addRow(container, label, value, status, note, stack) {
  const row = document.createElement("div");
  row.className = "row" + (stack ? " stack" : "");
  row.innerHTML =
    '<span class="mark ' + status + '">' + markOf(status) + '</span>' +
    '<span class="k">' + escapeHtml(label) +
      (note ? '<br><span class="info" style="font-size:11px">' + escapeHtml(note) + '</span>' : '') +
    '</span>' +
    '<span class="v">' + escapeHtml(String(value)) + '</span>';
  container.appendChild(row);
  return row;
}

function section(id) {
  const el = document.getElementById(id);
  el.innerHTML = "";
  return el;
}

/* ---------- 0. 版本 ---------- */

async function checkVersion() {
  const out = section("versionOut");
  let swVersion = "（讀不到）";
  try {
    /* no-store：一定要拿線上最新的那一份，不然問的是快取、答的也是快取，
       整頁的結論都會建立在舊檔案上。 */
    const text = await (await fetch("sw.js", { cache: "no-store" })).text();
    const m = /const VERSION = '([^']+)'/.exec(text);
    if (m) swVersion = m[1];
  } catch (e) {
    swVersion = "（抓不到：" + e.message + "）";
  }
  diagResults.swVersion = swVersion;
  addRow(out, "伺服器上的 service worker 版本", swVersion, "info",
         "這是線上最新的版本號");

  const controlled = !!(navigator.serviceWorker && navigator.serviceWorker.controller);
  diagResults.swControlled = controlled;
  addRow(out, "目前由 service worker 接管", controlled ? "是" : "否", "info",
         "策略是網路優先，所以接管了也還是拿得到新版；離線時才回退快取");

  addRow(out, "這一頁載入的時間", new Date().toLocaleString("zh-TW"), "info");
}

/* ---------- 1. 裝置判斷 ---------- */

function checkDevice() {
  const out = section("deviceOut");
  const mq = function(q) {
    try { return window.matchMedia(q).matches; } catch (e) { return null; }
  };

  const hoverNone = mq("(hover: none)");
  const coarse = mq("(pointer: coarse)");
  const anyHoverNone = mq("(any-hover: none)");
  const anyCoarse = mq("(any-pointer: coarse)");
  const touchPrimary = isTouchPrimary();
  const mobileLayout = isMobileLayout();
  const zone = edgeSwipeZoneRight();

  diagResults.device = {
    ua: navigator.userAgent,
    inner: window.innerWidth + "×" + window.innerHeight,
    screen: screen.width + "×" + screen.height,
    dpr: window.devicePixelRatio,
    maxTouchPoints: navigator.maxTouchPoints,
    hoverNone: hoverNone, pointerCoarse: coarse,
    anyHoverNone: anyHoverNone, anyPointerCoarse: anyCoarse,
    isTouchPrimary: touchPrimary, isMobileLayout: mobileLayout,
    edgeZoneRight: zone
  };

  addRow(out, "視窗尺寸", window.innerWidth + " × " + window.innerHeight, "info");
  addRow(out, "螢幕尺寸 / 像素比", screen.width + "×" + screen.height + " @" + window.devicePixelRatio, "info");
  addRow(out, "最多同時幾點觸控", navigator.maxTouchPoints, "info");
  addRow(out, "(hover: none)", String(hoverNone), hoverNone ? "ok" : "bad",
         hoverNone ? "" : "偵測不到「沒有滑鼠指標」——接了觸控板？");
  addRow(out, "(pointer: coarse)", String(coarse), coarse ? "ok" : "bad",
         coarse ? "" : "偵測不到「粗指標（手指）」");
  addRow(out, "(any-hover: none)", String(anyHoverNone), "info", "備援用的判斷");
  addRow(out, "(any-pointer: coarse)", String(anyCoarse), "info", "備援用的判斷");

  addRow(out, "isTouchPrimary()", String(touchPrimary), touchPrimary ? "ok" : "bad",
         touchPrimary ? "右滑手勢會啟用" : "右滑手勢不會啟用 ← 如果右滑沒反應，就是這裡");
  addRow(out, "isMobileLayout()", String(mobileLayout), "info",
         mobileLayout ? "走手機抽屜那一套" : "走桌機收合那一套（平板應該是這個）");
  addRow(out, "右滑判定窄帶到 x =", zone + " px", zone > 40 ? "ok" : "warn",
         "世界觀直欄寬度 + 28。平板上應該是 90 上下");
  addRow(out, "User-Agent", navigator.userAgent, "info", null, true);
}

/* ---------- 2. CSS ---------- */

/* 量一個元素的樣式要真的把它放進畫面，否則算不出計算值。
   放在畫面外而不是 display:none——display:none 的東西沒有版面，
   有些屬性會量不到。 */
function withProbe(className, extraHtml, fn) {
  const host = document.createElement("div");
  host.style.cssText = "position:absolute;left:-9999px;top:0;width:200px;height:120px";
  host.innerHTML = '<div class="' + className + '">' + (extraHtml || "字") + '</div>';
  document.body.appendChild(host);
  try {
    return fn(host.firstElementChild, host);
  } finally {
    host.remove();
  }
}

function checkCss() {
  const out = section("cssOut");
  const read = function(el) {
    const cs = getComputedStyle(el);
    return {
      callout: cs.webkitTouchCallout,
      select: cs.webkitUserSelect || cs.userSelect,
      touchAction: cs.touchAction
    };
  };

  const node = withProbe("canvas-node", "節點文字", read);
  const note = withProbe("canvas-note", '<div class="canvas-note-body">便條紙文字</div>',
    function(el) { return { own: read(el), body: read(el.querySelector(".canvas-note-body")) }; });
  const editing = withProbe("canvas-note is-editing",
    '<div class="canvas-note-body">編輯中</div>',
    function(el) { return read(el.querySelector(".canvas-note-body")); });

  diagResults.css = { node: node, note: note, editing: editing };

  /* Chromium 不認得 -webkit-touch-callout，getComputedStyle 會回 undefined。
     Safari 才讀得到真值——這一項就是這一頁存在的理由之一。 */
  const calloutOk = function(v) { return v === "none"; };
  const calloutStatus = function(v) {
    if (v === undefined || v === "") return "warn";
    return calloutOk(v) ? "ok" : "bad";
  };
  const calloutNote = function(v) {
    if (v === undefined || v === "") return "這個瀏覽器不認得這個屬性（Safari 才讀得到）";
    return calloutOk(v) ? "" : "沒關掉 → 長按會跳出放大鏡與拷貝選單";
  };

  addRow(out, "節點 -webkit-touch-callout", String(node.callout), calloutStatus(node.callout), calloutNote(node.callout));
  addRow(out, "節點 user-select", String(node.select), node.select === "none" ? "ok" : "bad",
         node.select === "none" ? "" : "沒關掉 → 長按會變成選字");
  addRow(out, "便條紙 -webkit-touch-callout", String(note.own.callout), calloutStatus(note.own.callout), calloutNote(note.own.callout));
  addRow(out, "便條紙 user-select", String(note.own.select), note.own.select === "none" ? "ok" : "bad");
  addRow(out, "便條紙內文 user-select", String(note.body.select), note.body.select === "none" ? "ok" : "bad");
  addRow(out, "編輯中的便條紙 user-select", String(editing.select), editing.select === "text" ? "ok" : "bad",
         editing.select === "text" ? "編輯時還選得到字，正確" : "編輯時選不到字了 ← 過頭了");
}

/* ---------- 3. 長按實測 ---------- */

let pressLog = [];
let pressCurrent = null;

function longPressDelay() {
  return typeof LONG_PRESS_DELAY_MS === "number" ? LONG_PRESS_DELAY_MS : 480;
}
function longPressSlop() {
  return typeof LONG_PRESS_SLOP_PX === "number" ? LONG_PRESS_SLOP_PX : 18;
}

function resetPress() {
  pressLog = [];
  renderPress();
}

function setupLongPressProbe() {
  const target = document.getElementById("longPressTarget");

  /* 正式 app 是 setupDirectoryContextMenu() 幫遮罩接上關閉的，
     這一頁沒有載那一段，自己接一次，否則選單關不掉。 */
  const overlay = document.getElementById("ctxMenuOverlay");
  if (overlay) overlay.onclick = closeContextMenu;

  /* 掛真的長按程式，不是模擬的。itemsFn 回幾個假的項目，
     按下去什麼都不做——這一頁不碰任何資料。 */
  attachContextMenu(target, function() {
    return [
      { icon: "🔒", label: "鎖住位置", action: function() {} },
      { icon: "🎨", label: "節點底色", action: function() {} },
      { type: "divider" },
      { icon: "🗑️", label: "從白板移除", danger: true, action: function() {} }
    ];
  }, function() { return "🧩 測試節點"; });

  /* 另外自己記一份事件流水帳。重點是 touchcancel：iOS 啟動放大鏡／選字時
     會送這個，而它正是原本把長按計時器清掉的元兇。收到它＝callout 沒擋成功。 */
  target.addEventListener("touchstart", function(e) {
    const t = e.touches[0];
    pressCurrent = {
      t0: Date.now(), x0: t.clientX, y0: t.clientY,
      /* 幾根手指。app 的長按只認單指（雙指是縮放），所以多指的那幾次
         本來就不該跳選單——要分開算，不然會被誤當成失敗。
         橫放握著平板時手掌很容易多碰到一點，這不是少數情況。 */
      touchesAtStart: e.touches.length,
      maxMove: 0, cancelled: false, moves: 0
    };
  }, { passive: true });

  target.addEventListener("touchmove", function(e) {
    if (!pressCurrent) return;
    const t = e.touches[0];
    const d = Math.max(Math.abs(t.clientX - pressCurrent.x0), Math.abs(t.clientY - pressCurrent.y0));
    if (d > pressCurrent.maxMove) pressCurrent.maxMove = Math.round(d);
    pressCurrent.moves++;
  }, { passive: true });

  target.addEventListener("touchcancel", function() {
    if (pressCurrent) pressCurrent.cancelled = true;
  });

  /* 捕獲階段掛在 window 上：拖曳的收尾就是走這一階段，驗一下它真的收得到
     （長按之後 attachContextMenu 會 stopPropagation，冒泡那條路是斷的）。 */
  window.addEventListener("touchend", function() {
    if (pressCurrent) pressCurrent.windowCaptureGotEnd = true;
  }, true);

  window.addEventListener("touchend", function() {
    if (pressCurrent) pressCurrent.windowBubbleGotEnd = true;
  }, false);

  target.addEventListener("touchend", function() {
    if (!pressCurrent) return;
    const rec = pressCurrent;
    pressCurrent = null;
    rec.heldMs = Date.now() - rec.t0;
    // 選單是同步跳出來的，這時候已經可以問了
    rec.menuShown = document.getElementById("customContextMenu").classList.contains("active");
    /* 不要馬上關掉——使用者是來看「選單有沒有出現」的，關太快等於沒出現過。
       留一下下再收，下一次長按才不會被它擋著。 */
    setTimeout(closeContextMenu, 900);

    /* 門檻用 app 真正在用的那個數字，不要自己訂一個。

       這裡原本寫死 300ms，比實際的 480ms 還小——按在中間那一段的，會被
       算成「長按了但沒跳選單」，看起來像失敗，其實是本來就不該跳。
       實機報告因此出現過 13/17 這種嚇人的數字，查下去兩邊都沒問題。 */
    rec.tooShort = rec.heldMs < longPressDelay();
    rec.multiTouch = rec.touchesAtStart > 1;
    pressLog.push(rec);
    renderPress();
  });
}

function renderPress() {
  const out = section("pressOut");
  const delay = longPressDelay();
  const slop = longPressSlop();

  /* 三類分開算，不要混在一起：
     - 多指：app 的長按只認單指，本來就不該跳選單
     - 沒按滿：沒到 480ms，本來就不該跳選單
     剩下的才是「應該要跳而且我們在意它有沒有跳」的那一類。 */
  const multi = pressLog.filter(function(r) { return r.multiTouch; });
  const short = pressLog.filter(function(r) { return !r.multiTouch && r.tooShort; });
  const real = pressLog.filter(function(r) { return !r.multiTouch && !r.tooShort; });

  if (!pressLog.length) {
    addRow(out, "還沒有記錄到長按", "—", "info",
           "在上面的方塊按住約一秒再放開（要滿 " + delay + " 毫秒才算）");
    diagResults.longPress = null;
    return;
  }

  const shown = real.filter(function(r) { return r.menuShown; }).length;
  const cancelled = real.filter(function(r) { return r.cancelled; }).length;
  const maxMove = real.reduce(function(a, r) { return Math.max(a, r.maxMove); }, 0);
  const captureOk = real.filter(function(r) { return r.windowCaptureGotEnd; }).length;
  const bubbleOk = real.filter(function(r) { return r.windowBubbleGotEnd; }).length;
  const helds = real.map(function(r) { return r.heldMs; });

  diagResults.longPress = {
    delayMs: delay, slopPx: slop,
    totalTouches: pressLog.length,
    counted: real.length,
    skippedTooShort: short.length,
    skippedMultiTouch: multi.length,
    menuShown: shown,
    touchcancel: cancelled,
    maxMovePx: maxMove,
    heldMsMin: helds.length ? Math.min.apply(null, helds) : null,
    heldMsMax: helds.length ? Math.max.apply(null, helds) : null,
    windowCapture: captureOk,
    windowBubble: bubbleOk,
    /* 沒按滿的那幾次如果照樣跳了選單，那才是真的有問題 */
    menuOnShortPress: short.filter(function(r) { return r.menuShown; }).length
  };

  addRow(out, "總共碰了幾次", pressLog.length + " 次", "info");
  addRow(out, "沒按滿 " + delay + " 毫秒，不列入", short.length + " 次", "info",
         short.length ? "這幾次本來就不該跳選單，不算失敗" : "");
  addRow(out, "不只一根手指，不列入", multi.length + " 次", "info",
         multi.length ? "app 的長按只認單指（雙指是縮放），不算失敗" : "");

  if (!real.length) {
    addRow(out, "算得上長按的次數", "0 次", "warn",
           "按住久一點：要滿 " + delay + " 毫秒（大約一秒比較保險），而且只用一根手指");
    return;
  }

  addRow(out, "算得上長按的次數", real.length + " 次", "info",
         "按住 " + Math.min.apply(null, helds) + "～" + Math.max.apply(null, helds) + " 毫秒");

  addRow(out, "其中叫得出選單", shown + " / " + real.length,
         shown === real.length ? "ok" : "bad",
         shown === real.length ? "" : "真的有失敗 ← 這個要查");

  addRow(out, "收到 touchcancel（放大鏡的信號）", cancelled + " / " + real.length,
         cancelled === 0 ? "ok" : "bad",
         cancelled === 0 ? "系統沒有搶走這個手勢，callout 有擋成功"
                         : "系統搶走了手勢 ← 放大鏡／選字還沒被擋掉");

  /* 只看「整段觸控」的最大位移會誤導：選單在 480ms 就跳出來了，那之後
     再怎麼晃都不影響。所以超過容忍範圍但選單全都有跳，代表晃動發生在
     跳出來之後——那不是問題。 */
  const moveStatus = maxMove <= slop ? "ok" : (shown === real.length ? "info" : "warn");
  addRow(out, "手指最大晃動（整段觸控）", maxMove + " px", moveStatus,
         maxMove <= slop
           ? "容忍範圍是 " + slop + " px"
           : (shown === real.length
                ? "超過 " + slop + " px 但選單全都有跳 → 晃動發生在選單跳出來之後，不影響"
                : "超過 " + slop + " px，可能就是失敗的原因"));

  addRow(out, "放開時 window 捕獲階段收到 touchend", captureOk + " / " + real.length,
         captureOk === real.length ? "ok" : "bad",
         "拖曳的收尾靠這一條");

  addRow(out, "放開時 window 冒泡階段收到 touchend", bubbleOk + " / " + real.length,
         bubbleOk === 0 ? "ok" : "info",
         bubbleOk === 0 ? "被 stopPropagation 擋住了，正是預期的樣子" : "");

  if (short.length) {
    const leaked = short.filter(function(r) { return r.menuShown; }).length;
    addRow(out, "沒按滿卻跳出選單", leaked + " / " + short.length,
           leaked === 0 ? "ok" : "bad",
           leaked === 0 ? "短按不會誤觸選單，正確" : "短按也跳選單了 ← 這才是問題");
  }
}

/* ---------- 4. 右滑 ---------- */

let swipeRec = null;

function setupSwipeProbe() {
  const pad = document.getElementById("swipePad");

  document.addEventListener("touchstart", function(e) {
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    swipeRec = { x0: t.clientX, y0: t.clientY, dx: 0, dy: 0, overPad: false };
  }, true);

  document.addEventListener("touchmove", function(e) {
    if (!swipeRec || e.touches.length !== 1) return;
    const t = e.touches[0];
    swipeRec.dx = Math.round(t.clientX - swipeRec.x0);
    swipeRec.dy = Math.round(t.clientY - swipeRec.y0);
    const r = pad.getBoundingClientRect();
    if (t.clientY >= r.top && t.clientY <= r.bottom) swipeRec.overPad = true;
  }, true);

  document.addEventListener("touchend", function() {
    if (!swipeRec) return;
    const rec = swipeRec;
    swipeRec = null;
    if (Math.abs(rec.dx) < 12 && Math.abs(rec.dy) < 12) return;   // 那是點擊不是滑動
    if (!rec.overPad) return;                                      // 不是滑過測試框
    renderSwipe(rec);
  }, true);
}

function renderSwipe(rec) {
  const out = section("swipeOut");
  const zone = edgeSwipeZoneRight();
  const inZone = rec.x0 <= zone;
  const horizontal = Math.abs(rec.dx) > Math.abs(rec.dy) * EDGE_SWIPE_SLOPE;
  const farEnough = Math.abs(rec.dx) >= EDGE_SWIPE_MIN_PX;
  const rightward = rec.dx > 0;
  const wouldOpen = isTouchPrimary() || isMobileLayout();
  const pass = inZone && horizontal && farEnough && rightward && wouldOpen;

  diagResults.swipe = {
    startX: Math.round(rec.x0), dx: rec.dx, dy: rec.dy,
    zoneRight: zone, inZone: inZone, horizontal: horizontal,
    farEnough: farEnough, rightward: rightward,
    gestureEnabled: wouldOpen, wouldOpenDirectory: pass
  };

  addRow(out, "起手點 x", Math.round(rec.x0) + " px", inZone ? "ok" : "bad",
         inZone ? "落在窄帶內（≤ " + zone + "）" : "太靠右了，要從螢幕最左邊起手（≤ " + zone + "）");
  addRow(out, "水平位移", rec.dx + " px", farEnough && rightward ? "ok" : "bad",
         !rightward ? "方向是往左" : (farEnough ? "" : "不到 " + EDGE_SWIPE_MIN_PX + " px，太短"));
  addRow(out, "垂直位移", rec.dy + " px", horizontal ? "ok" : "bad",
         horizontal ? "" : "太斜了，會被當成捲動");
  addRow(out, "手勢有沒有啟用", String(wouldOpen), wouldOpen ? "ok" : "bad",
         wouldOpen ? "" : "isTouchPrimary() 是 false ← 根本沒啟用");
  addRow(out, "這一下會不會打開目錄", pass ? "會" : "不會", pass ? "ok" : "bad");
}

/* ---------- 5. 鍵盤 ---------- */

function setupKeyboardProbe() {
  const input = document.getElementById("kbInput");
  const render = function() {
    const out = section("kbOut");
    const vv = window.visualViewport;
    if (!vv) {
      addRow(out, "visualViewport", "不支援", "bad", "這台瀏覽器沒有這個 API，鍵盤高度算不出來");
      diagResults.keyboard = { supported: false };
      return;
    }
    const st = keyboardInsetState(vv, window.innerHeight);
    diagResults.keyboard = {
      supported: true,
      innerHeight: window.innerHeight,
      vvHeight: Math.round(vv.height),
      vvOffsetTop: Math.round(vv.offsetTop),
      vvScale: +vv.scale.toFixed(2),
      open: st.open, inset: Math.round(st.inset),
      cssKbInset: getComputedStyle(document.documentElement).getPropertyValue("--kb-inset").trim(),
      htmlHasKbOpen: document.documentElement.classList.contains("kb-open")
    };

    addRow(out, "window.innerHeight", window.innerHeight, "info", "iOS 上這個不會扣掉鍵盤");
    addRow(out, "visualViewport.height", Math.round(vv.height), "info", "真正看得見的高度");
    addRow(out, "visualViewport.offsetTop", Math.round(vv.offsetTop), "info");
    addRow(out, "visualViewport.scale", vv.scale.toFixed(2), vv.scale > 1.05 ? "warn" : "info",
           vv.scale > 1.05 ? "你現在是放大狀態，這時候會刻意不算鍵盤" : "");
    addRow(out, "算出來的鍵盤遮擋高度", Math.round(st.inset) + " px",
           st.open ? "ok" : "info",
           st.open ? "有偵測到鍵盤" : "現在沒有鍵盤（點上面的輸入框試試）");
    addRow(out, "CSS 變數 --kb-inset", diagResults.keyboard.cssKbInset || "（空的）", "info",
           "這是版面實際在用的值");
    addRow(out, "<html> 有沒有 .kb-open", String(diagResults.keyboard.htmlHasKbOpen), "info");
  };

  render();
  input.addEventListener("focus", function() { setTimeout(render, 300); });
  input.addEventListener("blur", function() { setTimeout(render, 300); });
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", render);
    window.visualViewport.addEventListener("scroll", render);
  }

  /* 讓 --kb-inset 真的會動：正式 app 是 app.js 在啟動時掛的，
     這一頁沒有載它，所以自己掛一次。 */
  if (typeof setupKeyboardInset === "function") setupKeyboardInset();
}

/* ---------- 報告 ---------- */

function buildReport() {
  const lines = [];
  lines.push("=== 世界觀架構工作台 實機檢查 ===");
  lines.push("時間：" + new Date().toLocaleString("zh-TW"));
  lines.push("");
  lines.push(JSON.stringify(diagResults, null, 1));
  document.getElementById("report").value = lines.join("\n");
  document.getElementById("copyNote").textContent = "";
}

function copyReport() {
  const ta = document.getElementById("report");
  const note = document.getElementById("copyNote");
  if (!ta.value) buildReport();
  const done = function(okMsg) { note.textContent = okMsg; };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(ta.value)
      .then(function() { done("複製好了。"); })
      .catch(function() { done("複製不了，請長按框內文字自己全選複製。"); });
    return;
  }
  done("這個瀏覽器不給程式複製，請長按框內文字自己全選複製。");
}

/* ---------- 啟動 ---------- */

window.addEventListener("DOMContentLoaded", function() {
  /* 主題：跟 index.html 的行為一致，而且只讀不寫——這一頁跟正式 app 同源，
     寫下去就是寫到使用者的真實設定。 */
  try {
    let p = localStorage.getItem("wb_theme");
    if (p !== "light" && p !== "dark") {
      p = (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light";
    }
    document.documentElement.setAttribute("data-theme", p);
  } catch (e) {
    document.documentElement.setAttribute("data-theme", "light");
  }

  checkVersion();
  checkDevice();
  checkCss();
  setupLongPressProbe();
  renderPress();
  setupSwipeProbe();
  setupKeyboardProbe();

  window.addEventListener("resize", function() {
    checkDevice();
  });
});
