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

test("鍵盤收起來時，寫進去的每一個都要清掉", function() {
  written.forEach(function(name) {
    assert.ok(removed.has(name),
      name + " 只有寫入沒有清除 —— 鍵盤收起來之後會留著上一次的值");
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
