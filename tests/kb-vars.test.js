/* 軟體鍵盤那組 CSS 變數，兩邊要對得起來。

   js/main.js 的 applyKeyboardInset() 負責寫入 --kb-*，style.css 負責用它們。
   這兩份清單是分開維護的，而且對不上時**完全沒有錯誤訊息**：

   - JS 寫了、CSS 沒用 → 白算一場，版面還是壞的
   - CSS 用了、JS 沒寫 → var() 取不到值，那一條宣告被整個丟掉

   兩種都只有在 iOS 上開鍵盤才看得出來，而這個環境驗不了 Safari。
   用比對擋掉是唯一擋得住的方法。 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { ROOT } = require("./helpers/load-app.js");

const mainJs = fs.readFileSync(path.join(ROOT, "js", "main.js"), "utf8");
const css = fs.readFileSync(path.join(ROOT, "style.css"), "utf8");

/* 所有 js 串起來：掛 class 的是 documents.js，寫變數的是 main.js，
   以後搬家也不用回來改這份清單。 */
const allJs = fs.readdirSync(path.join(ROOT, "js"))
  .filter(function(f) { return f.endsWith(".js"); })
  .map(function(f) { return fs.readFileSync(path.join(ROOT, "js", f), "utf8"); })
  .join("\n");

function matchAll(text, re) {
  const out = new Set();
  let m;
  while ((m = re.exec(text))) out.add(m[1]);
  return out;
}

const written = matchAll(mainJs, /setProperty\("(--kb-[a-z-]+)"/g);
const removed = matchAll(mainJs, /removeProperty\("(--kb-[a-z-]+)"/g);
const used = matchAll(css, /var\((--kb-[a-z-]+)/g);

test("js/main.js 寫進去的每一個 --kb-* 都有人用", function() {
  assert.ok(written.size >= 4, "應該抓得到四個變數（實得 " + written.size + "）");
  written.forEach(function(name) {
    assert.ok(used.has(name),
      "js/main.js 寫了 " + name + "，但 style.css 沒有任何地方 var() 它 —— 白算一場");
  });
});

test("style.css 用到的每一個 --kb-* 都有人寫進去", function() {
  used.forEach(function(name) {
    assert.ok(written.has(name),
      "style.css 用了 " + name + "，但 applyKeyboardInset() 沒有寫它 —— " +
      "var() 取不到值，整條宣告會被丟掉");
  });
});

/* 刻意不清掉的那些。--kb-reserve 是「上一次量到的鍵盤高度」，它的用途就是
   在鍵盤還沒升起時先把捲動空間留出來——收鍵盤時清掉的話，下一次聚焦又沒有
   值可以用，等於這個機制不存在。

   這份豁免名單本身要被檢查：下面會反過來確認它真的沒被清除，免得有一天
   清除的程式碼加回去了、名單卻還掛在這裡，變成一個測不到的洞。 */
const KEPT_ON_CLOSE = ["--kb-reserve"];

test("鍵盤收起來時，寫進去的每一個都要清掉（記得的值除外）", function() {
  written.forEach(function(name) {
    if (KEPT_ON_CLOSE.includes(name)) return;
    assert.ok(removed.has(name),
      name + " 只有寫入沒有清除 —— 鍵盤收起來之後會留著上一次的值");
  });

  KEPT_ON_CLOSE.forEach(function(name) {
    assert.ok(written.has(name), name + " 在豁免名單裡，卻沒有任何地方寫它");
    assert.ok(!removed.has(name),
      name + " 被清除了，但它在「刻意不清」的名單裡 —— 兩邊對不上，" +
      "要嘛把清除拿掉，要嘛把它移出名單");
  });
});

test("body 的鍵盤規則：外框用 --kb-h，上緣讓開用 --kb-top", function() {
  const m = css.match(/:root\.kb-open body\s*\{([\s\S]*?)\}/);
  assert.ok(m, "找不到 :root.kb-open body 這條規則");
  const body = m[1];

  assert.match(body, /height:\s*var\(--kb-h\)/,
    "外框要用 --kb-h（版面頂端 → 看得見的底端），文件才不會長到可以捲");
  assert.match(body, /padding-top:\s*var\(--kb-top\)/,
    "少了 padding-top，iOS 把版面視窗推上去時最上面的工具列會被推出畫面");
});

test("子結構的高度要用 --kb-vh，不能再用 --kb-h", function() {
  /* body 加了 padding-top 之後，它的內容盒是 --kb-vh 而不是 --kb-h。
     子結構若還用 --kb-h 就會比 body 高出「被推掉的那一段」，下緣又落回
     鍵盤後面。 */
  const kbOpenRules = css.match(/:root\.kb-open [^{]*\{[^}]*\}/g) || [];
  kbOpenRules.forEach(function(rule) {
    if (/^:root\.kb-open body\b/.test(rule.trim())) return;   // body 自己例外
    assert.ok(!/var\(--kb-h\)/.test(rule),
      "這條規則還在用 --kb-h，應該是 --kb-vh：\n" + rule);
  });
});

/* 把 CSS 拆成一條一條規則。巢狀在 @media 裡的也拆得到（內層規則會各自
   成為一筆），這裡只需要「某個選擇器的某個宣告是什麼」。 */
function declarationsFor(selector) {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(stripped))) {
    const selectors = m[1].split(",").map(function(x) { return x.trim().replace(/\s+/g, " "); });
    if (selectors.includes(selector)) out.push(m[2]);
  }
  return out;
}

function valueOf(selector, prop) {
  const re = new RegExp("(?:^|;)\\s*" + prop + "\\s*:([^;]+)");
  const found = [];
  declarationsFor(selector).forEach(function(body) {
    const m = body.match(re);
    if (m) found.push(m[1].trim().replace(/\s+/g, " "));
  });
  return found;
}

/* ==========================================================
   .kb-pending：聚焦了、鍵盤還沒來
   ========================================================== */
test("kb-* 的 class：JS 掛上去的與 CSS 用到的要對得上", function() {
  const added = matchAll(allJs, /classList\.add\("(kb-[a-z-]+)"\)/g);
  const removedCls = matchAll(allJs, /classList\.remove\("(kb-[a-z-]+)"\)/g);
  const styled = matchAll(css, /:root\.(kb-[a-z-]+)/g);

  assert.ok(added.has("kb-open"), "kb-open 應該由 applyKeyboardInset() 掛上");
  assert.ok(added.has("kb-pending"), "kb-pending 應該由 setupCaretRoomOnFocus() 掛上");

  added.forEach(function(cls) {
    assert.ok(styled.has(cls),
      "JS 掛了 ." + cls + "，但 style.css 沒有任何規則吃它 —— 白掛一場");
    assert.ok(removedCls.has(cls),
      "." + cls + " 只有掛上沒有拿掉 —— 會一直留在 <html> 上");
  });

  styled.forEach(function(cls) {
    assert.ok(added.has(cls),
      "style.css 為 ." + cls + " 寫了規則，但沒有任何 js 掛這個 class —— 永遠不會生效");
  });
});

test("kb-pending 的底部空間要跟 kb-open 一模一樣", function() {
  /* 晚一步給等於沒給：最需要這塊空間的就是鍵盤升起前的那一刻（要捲走的
     量最大，而那時 kb-open 還沒掛上）。值不一樣的話，聚焦當下先捲的那一下
     會用錯的可捲範圍算，捲完鍵盤一上來又得重算。 */
  ["padding-bottom", "scroll-padding-bottom"].forEach(function(prop) {
    const open = valueOf(":root.kb-open .editor-content-area", prop);
    const pending = valueOf(":root.kb-pending .editor-content-area", prop);

    assert.strictEqual(open.length, 1, ":root.kb-open 的 " + prop + " 應該只有一條");
    assert.strictEqual(pending.length, 1, ":root.kb-pending 的 " + prop + " 應該只有一條");
    assert.strictEqual(pending[0], open[0],
      prop + " 兩邊不一樣：kb-open=" + open[0] + "，kb-pending=" + pending[0]);
  });
});

test("kb-pending 只管編輯區的空間，不要去動版面高度", function() {
  /* 鍵盤還沒升起，可視區就是整個畫面。這時候若把 body 或主結構縮成
     --kb-vh，畫面會先縮一次、鍵盤上來再縮一次，閃兩下。
     那些是 kb-open 的事，kb-pending 只負責「先把底下的空間讓出來」。 */
  ["--kb-h", "--kb-vh", "--kb-top", "--kb-inset"].forEach(function(name) {
    const rules = (css.replace(/\/\*[\s\S]*?\*\//g, "").match(/[^{}]+\{[^{}]*\}/g) || [])
      .filter(function(r) { return /:root\.kb-pending/.test(r.split("{")[0]); });
    rules.forEach(function(rule) {
      assert.ok(!new RegExp("var\\(" + name + "\\)").test(rule),
        "kb-pending 的規則用到了 " + name + "，那是鍵盤升起之後才有意義的值：\n" + rule);
    });
  });
});

test("編輯時的底部空間要取 max(保底十行, 記得的鍵盤高度)", function() {
  /* 游標要能被捲到鍵盤上方，底下就得有「一個鍵盤的高度」可以捲。寫死十行
     （約 304px）在橫放時不夠——橫放的鍵盤佔 456px。 */
  const pad = valueOf(":root.kb-pending .editor-content-area", "padding-bottom");
  assert.strictEqual(pad.length, 1);

  assert.match(pad[0], /max\(/, "要用 max()，不能只寫死行數");
  assert.match(pad[0], /var\(--editor-line\) \* 10/, "保底十行");
  assert.match(pad[0], /var\(--kb-reserve, 0px\)/,
    "要吃記得的鍵盤高度，而且要有 0px 的 fallback —— 第一次還沒量過時 " +
    "var() 取不到值會讓整條宣告被丟掉，連保底的十行都沒有");

  // 按鈕那一排與兩行的讓位不能因為改寫而掉了
  assert.match(pad[0], /var\(--icon-44\)/, "浮動按鈕那一排的高度");
});

test("底部空間不可以只掛在 kb-open 上", function() {
  /* kb-open 依賴 visualViewport 偵測得到鍵盤。萬一偵測失效（實際發生過），
     只掛在它上面的話這塊空間就永遠不會出現。kb-pending 只看有沒有聚焦。 */
  ["padding-bottom", "scroll-padding-bottom"].forEach(function(prop) {
    assert.strictEqual(valueOf(":root.kb-pending .editor-content-area", prop).length, 1,
      prop + " 也要掛在 kb-pending 上，不能只有 kb-open");
  });
});

/* ==========================================================
   鍵盤動畫期間不可以一格一格補捲
   ========================================================== */
test("visualViewport 的 resize 要等動畫停了才校正游標", function() {
  /* 鍵盤是滑上來的，滑的過程中會連發好幾次 resize，每次量到的可視底都不同。
     照著每一次去補捲，就會捲一點、再捲一點——使用者看到的「捲上去會跳動」
     就是這個。兩個平台都會，因為兩邊的鍵盤都是動畫進場的。 */
  const callAt = mainJs.indexOf("scheduleCaretRoomCheck(true)");
  assert.ok(callAt !== -1, "main.js 應該有一處在鍵盤變化後校正游標");

  const listenerAt = mainJs.lastIndexOf('addEventListener("resize"', callAt);
  assert.ok(listenerAt !== -1, "那一處應該掛在 resize 監聽器裡");

  const between = mainJs.slice(listenerAt, callAt);
  assert.match(between, /setTimeout\(/,
    "resize 一來就直接校正游標 —— 鍵盤動畫期間會連發好幾次，" +
    "每次補捲一點就是使用者看到的跳動。要等它安靜下來再做一次");
  assert.match(between, /clearTimeout\(/,
    "每次 resize 要把上一個計時器取消掉，不然還是會做好幾次");
});

test("等待的時間要夠長蓋過鍵盤動畫，又不能久到游標晚回來", function() {
  const m = mainJs.match(/const KB_SETTLE_MS = (\d+);/);
  assert.ok(m, "要有一個具名常數，不要把毫秒數散在程式碼裡");
  const ms = parseInt(m[1], 10);
  assert.ok(ms >= 120, "太短會蓋不過鍵盤動畫（約 250~300ms 的進場），又開始一格一格捲");
  assert.ok(ms <= 400, "太長的話游標會晚很久才回到看得見的地方");
});

test("診斷要數得出「這一次聚焦捲了幾次」", function() {
  /* 會跳動就是這個數字大於 1。沒有它的話，下次再遇到同樣的回報又只能猜。 */
  assert.match(allJs, /function logCaretScroll\(/, "每次補捲都要記一筆");
  assert.match(allJs, /caretScrollLog/, "診斷面板要讀得到");

  const focusHandler = allJs.match(/ta\.addEventListener\("focus"[\s\S]*?\}\);/);
  assert.ok(focusHandler, "找不到 textarea 的 focus 監聽器");
  assert.match(focusHandler[0], /resetCaretScrollLog\(\)/,
    "每次聚焦要重新計數 —— 不歸零的話數到的是好幾次聚焦的總和，看不出這一次跳了幾下");
});

/* ==========================================================
   聚焦時那一下補捲：不能有動畫，也不能重排整篇文章
   ========================================================== */
test("聚焦時的補捲必須是瞬間的，不可以有動畫", function() {
  /* 這一條是硬限制，不是還沒做。試過兩輪、兩輪都把「工具列被吃掉」帶回來：

       瀏覽器內建 behavior: smooth（300~500ms，時長指定不了）→ 壞
       自己跑 rAF 動畫壓到 160ms ease-out                    → 還是壞

     iOS 決定要不要推版面視窗的那一刻很早，早到任何動畫都來不及。
     這個錯誤的失敗方式很惡劣：症狀（工具列被吃掉）看起來像完全無關的另一個
     bug，而且要好幾輪之後才會被發現。 */
  const fn = allJs.match(/function ensureCaretRoom\([\s\S]*?(?=\nfunction )/);
  assert.ok(fn, "找不到 ensureCaretRoom()");

  assert.ok(!/behavior:\s*["']smooth["']/.test(fn[0]),
    "補捲不能用 behavior: smooth —— 時長指定不了，比鍵盤升起還慢");
  assert.ok(!/requestAnimationFrame/.test(fn[0]),
    "補捲不能自己跑動畫 —— 160ms 都還是輸給 iOS 的決定時機");
  assert.match(fn[0], /scroller\.scrollTop \+= overflow/,
    "就是直接設 scrollTop，瞬間到位");
});

test("點中間時要用手指的座標，不要重排整篇文章", function() {
  /* measureCaretBottom() 要把游標前面的整篇文章用同樣的字體與寬度重排一次，
     實測一萬行 106ms。那一下停頓正好落在鍵盤升起的動畫中間——使用者說的
     「卡」就是它。而且它只在「游標不在最後一行」時才跑，也就是點文章中間，
     正是使用者描述的情況。

     位置本來就不必算：使用者剛剛才用手指指給我們看。 */
  assert.match(allJs, /addEventListener\("pointerdown"/,
    "要記下手指按在哪裡");
  assert.match(allJs, /function caretBottomFromPointer\(/,
    "要有一條零重排的換算路徑");

  const fn = allJs.match(/function ensureCaretRoom\([\s\S]*?(?=\nfunction )/);
  assert.ok(fn, "找不到 ensureCaretRoom()");
  const pointerAt = fn[0].indexOf("caretBottomFromPointer");
  const mirrorAt = fn[0].indexOf("measureCaretBottom");
  assert.ok(pointerAt !== -1 && mirrorAt !== -1, "兩條路都要在");
  assert.ok(pointerAt < mirrorAt,
    "手指座標那條要排在重排前面 —— 排在後面就永遠輪不到它，" +
    "等於這個最佳化沒做");

  /* 只檢查順序不夠：把條件改成 false 的話順序還是對的，但那條路永遠不會
     走到。條件本身也要釘住。（這個測試自己先漏掉這一點，紅不起來。） */
  assert.match(fn[0], /else if \(caretPointerFresh\(\)\) \{/,
    "手指座標那條的條件必須是 caretPointerFresh() —— " +
    "條件被改掉的話，順序再對也是永遠輪不到");
});

test("手指座標有時效，過期不能用", function() {
  /* 先點別處、再用別的方式聚焦的話，那個座標跟游標沒有關係了。 */
  assert.match(allJs, /const CARET_POINTER_TTL_MS = \d+;/, "要有具名的時效");
  assert.match(allJs, /function caretPointerFresh\(/, "用之前要檢查新不新鮮");
  /* 要檢查「blur 監聽器裡面」有清掉，不能只看整份檔案有沒有這串字——
     宣告本身就是 `let caretPointer = null;`，整份檔案永遠找得到它，
     那樣寫的話把 blur 裡那一行刪掉測試照樣綠。（先漏掉過一次。） */
  const blurFn = allJs.match(/ta\.addEventListener\("blur"[\s\S]*?\n  \}\);/);
  assert.ok(blurFn, "找不到 textarea 的 blur 監聽器");
  assert.match(blurFn[0], /caretPointer = null/,
    "blur 時要清掉 —— 下次聚焦不一定是用點的");
});

test("診斷要說得出這次是用哪種方法量的", function() {
  assert.match(allJs, /caretMeasureHow/, "要記下用了哪一條路");
  assert.match(allJs, /"mirror " \+ Math\.round/,
    "走到重排那條時要把耗時記下來 —— 「卡」不卡看這個數字就知道");
});
