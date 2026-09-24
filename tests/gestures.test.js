/* 手勢之間互相搶事件。

   左緣滑動（setupEdgeSwipe）接手一個手勢之後會 stopPropagation()，免得底下
   的白板跟著平移。它掛在 document 的捕獲階段，所以之後的 touchmove 與
   touchend 全都到不了底下的元素。任何「靠收到移動或放開來取消」的長按，
   計時器都沒人取消，時間一到就照樣觸發。實際發生過三種：

   - 白板上從左緣右滑開目錄 → 長出一張便利貼（使用者回報的）
   - 目錄開著、按在某一列上往左滑收起來 → 目錄收掉之後那一列的選單跳出來
   - 拿起來之後往左下拖 → 被當成「收目錄」搶走，拖曳被砍掉

   修法是讓長按的「取消」自己從 window 的捕獲階段聽——那排在 document 之前，
   誰 stopPropagation 都擋不到。這組測試釘住的就是「聽在哪一層」。

   合成事件跑得出這幾個情境（見 NOTES 的 Playwright 那一節），但 node --test
   沒有 DOM，所以這裡一半比程式碼、一半用假的 window 驗 watchTouchFromWindow。 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { loadApp, ROOT } = require("./helpers/load-app.js");

const canvasJs = fs.readFileSync(path.join(ROOT, "js", "canvas.js"), "utf8");
const modalJs = fs.readFileSync(path.join(ROOT, "js", "modal.js"), "utf8");
const mainJs = fs.readFileSync(path.join(ROOT, "js", "main.js"), "utf8");

function codeOnly(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");
}
function bodyOf(src, name) {
  const m = src.match(new RegExp("function\\s+" + name + "\\s*\\([\\s\\S]*?(?=\\nfunction )"));
  assert.ok(m, "找不到 " + name + "()");
  return m[0];
}

/* ---------- 白板：長按空白處新增便利貼 ---------- */

test("白板長按的「取消」聽在 window 的捕獲階段", function() {
  const body = codeOnly(bodyOf(canvasJs, "setupBlankLongPress"));

  assert.match(body, /window\.addEventListener\("touchmove",[\s\S]*?\{ capture: true, passive: true \}\)/,
    "touchmove 要掛在 window、而且是捕獲階段 —— 掛在 view 上的話，左緣滑動一接手就收不到");
  assert.match(body, /window\.addEventListener\("touchend", cancel, true\)/,
    "touchend 也是 —— 收不到放開，計時器就一直在跑");
  assert.match(body, /window\.addEventListener\("touchcancel", cancel, true\)/);

  /* 反向檢查：以前就是掛在這裡才出事的。 */
  assert.ok(!/view\.addEventListener\("touchmove"/.test(body),
    "不要再把 touchmove 掛回 view 上");
  assert.ok(!/view\.addEventListener\("touchend"/.test(body),
    "不要再把 touchend 掛回 view 上");
});

test("白板長按的 touchmove 監聽器沒有計時器就立刻返回", function() {
  /* 它現在掛在 window 上，整個 app 的每一次手指移動都會經過它。
     沒在計時的時候不能做任何事。 */
  const body = codeOnly(bodyOf(canvasJs, "setupBlankLongPress"));
  const move = body.match(/window\.addEventListener\("touchmove", function\(e\) \{([\s\S]*?)\}, \{ capture/);
  assert.ok(move, "找不到那個 touchmove");
  assert.match(move[1].trim(), /^if \(!timer\) return;/, "第一行就要看有沒有在計時");
});

/* ---------- 選單與拖曳：attachContextMenu ---------- */

test("watchTouchFromWindow()：掛在捕獲階段、結束就拆乾淨", function() {
  const app = loadApp(["js/state.js", "js/main.js", "js/storage.js", "js/modal.js"]);
  const log = app.run(`
    var __listeners = [];
    window.addEventListener = function(type, fn, opt) {
      __listeners.push({ type: type, fn: fn, capture: opt === true || !!(opt && opt.capture) });
    };
    window.removeEventListener = function(type, fn, opt) {
      __listeners = __listeners.filter(function(l) { return !(l.type === type && l.fn === fn); });
    };
    var __moves = 0, __ends = 0;
    var __stop = watchTouchFromWindow(function() { __moves++; }, function() { __ends++; });
    var __out = { afterStart: __listeners.map(function(l) { return l.type + (l.capture ? "@capture" : ""); }) };

    function fire(type) { __listeners.filter(function(l) { return l.type === type; })
                                      .forEach(function(l) { l.fn({ touches: [] }); }); }
    fire("touchmove"); fire("touchmove");
    fire("touchend");
    __out.afterEnd = __listeners.length;
    fire("touchend");            // 拆掉之後再來一次，不應該再被叫到
    __out.moves = __moves; __out.ends = __ends;
    JSON.stringify(__out);
  `);
  const out = JSON.parse(log);
  assert.deepStrictEqual(out.afterStart.sort(),
    ["touchcancel@capture", "touchend@capture", "touchmove@capture"],
    "三個都要掛在捕獲階段");
  assert.strictEqual(out.moves, 2);
  assert.strictEqual(out.ends, 1, "結束只通知一次");
  assert.strictEqual(out.afterEnd, 0,
    "結束就要全部拆掉 —— 目錄每重畫一次就對每一列 attach 一次，拆不乾淨會越疊越多");
});

test("attachContextMenu() 每一次觸碰都從 window 看著", function() {
  const body = codeOnly(bodyOf(modalJs, "attachContextMenu"));
  const start = body.match(/element\.addEventListener\("touchstart"[\s\S]*?\}, \{ passive: true \}\);/);
  assert.ok(start, "找不到 touchstart");
  assert.match(start[0], /stopWatch = watchTouchFromWindow\(onWatchedMove, onWatchedEnd\)/,
    "touchstart 要開始從 window 看著這一次觸碰");
  assert.match(start[0], /if \(stopWatch\) stopWatch\(\);/,
    "上一次沒收乾淨的要先拆掉，不然會同時有兩組在看");

  /* 反向檢查：以前取消計時器的那個 touchmove 是掛在元素上的（passive），
     左緣滑動一接手它就收不到。拖曳用的那一個（passive: false）留在元素上是
     對的——它要 preventDefault，而且拖曳時左緣滑動會讓路。 */
  const passiveMoves = body.match(/element\.addEventListener\("touchmove",[\s\S]*?\{ passive: true \}\)/g) || [];
  assert.strictEqual(passiveMoves.length, 0,
    "取消計時器的 touchmove 不要再掛回元素上");
});

test("放開的時候，計時器與「拿起來」一定歸零", function() {
  const end = codeOnly(bodyOf(modalJs, "attachContextMenu")).match(/function onWatchedEnd\(\) \{[\s\S]*?\n \}/);
  assert.ok(end, "找不到 onWatchedEnd()");
  assert.match(end[0], /clearTouchTimers\(\)/, "計時器要清");
  assert.match(end[0], /if \(!dragging\) \{ disarmDrag\(\); return; \}/,
    "沒在拖的話，「拿起來」的狀態也要在這裡清");

  /* 正在拖、而元素自己的 touchend 被攔掉的話，拖曳就永遠不會結束：
     幽靈掛在畫面上，touchDragOwner 一直不清，左緣滑動從此打不開目錄。 */
  assert.match(end[0], /setTimeout\(function\(\) \{[\s\S]*?if \(!dragging\) return;[\s\S]*?dragHooks\.cancel\(\)/,
    "要有一個退路：下一輪還在拖就強制收掉");
});

test("「拿起來」的登記一定會被清掉", function() {
  const body = codeOnly(bodyOf(modalJs, "attachContextMenu"));
  assert.match(body, /touchDragOwner = element;/, "拿起來時要登記");
  const disarm = body.match(/function disarmDrag\(\) \{[\s\S]*?\n \}/);
  assert.ok(disarm, "找不到 disarmDrag()");
  assert.match(disarm[0], /if \(touchDragOwner === element\) touchDragOwner = null;/,
    "收掉時要清登記，而且只清自己的 —— 清錯了會讓另一列的拖曳被左緣滑動搶走");
});

/* ---------- 左緣滑動：拖曳中要讓路 ---------- */

test("左緣滑動在有東西被拿起來時不接手", function() {
  const body = codeOnly(bodyOf(mainJs, "setupEdgeSwipe"));
  const guardAt = body.indexOf("touchDragInProgress()");
  const claimAt = body.indexOf("edgeSwipe.claimed = true");
  assert.ok(guardAt !== -1, "要問 touchDragInProgress()");
  assert.ok(claimAt !== -1, "找不到接手的那一行");
  assert.ok(guardAt < claimAt,
    "要在接手之前問 —— 接手之後已經 stopPropagation 了，拖曳收不到後面的移動");
  assert.match(body, /touchDragInProgress\(\)\) \{\s*edgeSwipe = null;\s*return;/,
    "讓路就是整個放手（edgeSwipe = null），不是只有這一次不處理");
});
