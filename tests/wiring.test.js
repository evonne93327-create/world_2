/* index.html 與 js 之間的接線。

   這個 app 的事件是寫在 HTML 屬性裡的（onclick="foo()"），元素則是用
   getElementById 抓的。兩邊都是手寫的字串，**打錯字不會有任何錯誤訊息**：

   - onclick 指向不存在的函式 → 點下去什麼都不會發生
   - getElementById 抓不存在的 id → 拿到 null，那一段功能靜靜地不作用

   兩種都只有真的去點那一顆按鈕才發現得到。用比對擋掉。 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { ROOT } = require("./helpers/load-app.js");

const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const js = fs.readdirSync(path.join(ROOT, "js"))
  .filter(function(f) { return f.endsWith(".js"); })
  .map(function(f) { return fs.readFileSync(path.join(ROOT, "js", f), "utf8"); })
  .join("\n");

test("index.html 裡每一個事件屬性都指向真的存在的函式", function() {
  const handlers = new Set();
  const re = /on(?:click|input|change|dblclick)="([A-Za-z_$][\w$]*)\(/g;
  let m;
  while ((m = re.exec(html))) handlers.add(m[1]);

  assert.ok(handlers.size >= 40, "應該抓得到很多處理函式（實得 " + handlers.size + "）");

  handlers.forEach(function(name) {
    assert.ok(new RegExp("function\\s+" + name + "\\s*\\(").test(js),
      'index.html 有 on...="' + name + '()"，但沒有任何 js 定義這個函式 —— ' +
      "點下去不會有反應，而且不會有錯誤訊息");
  });
});

/* 鍵盤診斷這一組是新加的，元素全部寫死在 index.html 裡（不像白板那些是
   程式動態產生的），所以可以嚴格比對。回報 iOS 問題時就靠它，少一個 id
   就等於整個面板不會動。 */
test("鍵盤診斷的每一個 id 都在 index.html 裡", function() {
  ["kbDiagPanel", "kbDiagBody", "kbDiagRowValue", "kbDiagCopyBtn"].forEach(function(id) {
    assert.ok(js.includes('getElementById("' + id + '")'),
      "js 應該要用到 " + id + "，是不是改名了？");
    assert.ok(html.includes('id="' + id + '"'),
      "js 抓 " + id + "，但 index.html 裡沒有這個 id —— 面板整個不會動");
  });
});

test("鍵盤診斷預設是關的", function() {
  /* 這是診斷工具，不是功能。預設開著的話每個人的畫面左上角都掛一塊黑框。
     判斷式是「=== '1' 才算開」，所以沒設定過就是關的。 */
  assert.match(js, /localStorage\.getItem\(KB_DIAG_KEY\)\s*===\s*"1"/,
    "kbDiagEnabled() 要寫成「明確等於 1 才算開」，沒設定過就是關的");
  assert.match(html, /id="kbDiagRowValue">關</,
    "設定裡那一列的預設字樣應該是「關」");
});

test("版本那一行要講得出「這一頁還在跑舊程式碼」", function() {
  /* sw.js 有 skipWaiting + clients.claim，新 worker 會接管已經開著的頁面。
     那時候問 worker 拿到的是新版號，但這一頁的 css/js 還是舊的——這一行
     會很有自信地說「已是最新版」，而使用者看到的是舊畫面。實際發生過。 */
  assert.match(js, /markPageCodeStale/,
    "controllerchange 之後要把這一頁標記成跑著舊程式碼");
  assert.match(js, /pageCodeStale/,
    "renderVersionRow() 要看這個旗標");

  /* 抓到下一個 function 為止。不要用非貪婪配到第一個 \n} —— 函式裡面有
     .then(...) 這種巢狀區塊，那樣會在半路就切斷，測到的是殘缺的函式體
     （這個測試自己先踩過一次，報了一個根本不存在的錯）。 */
  const row = js.match(/function renderVersionRow\(\)[\s\S]*?(?=\nfunction )/);
  assert.ok(row, "找不到 renderVersionRow()");

  /* 註解要先拿掉再比順序。這裡的註解本身就在解釋「已是最新版」會怎麼說謊，
     那幾個字出現在程式碼之前，不拿掉的話比到的是註解的位置
     （又是這個測試自己先踩的一腳）。 */
  const body = row[0].replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");
  const staleAt = body.indexOf("pageCodeStale");
  const latestAt = body.indexOf("已是最新版");
  assert.ok(staleAt !== -1 && latestAt !== -1, "兩個字串都要在函式體裡找得到");
  assert.ok(staleAt < latestAt,
    "「跑著舊程式碼」要判斷在「已是最新版」之前 —— 兩邊版號會一致，" +
    "排在後面就永遠輪不到它");
});
