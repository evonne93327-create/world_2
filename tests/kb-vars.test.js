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
