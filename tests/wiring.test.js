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
  ["kbDiagPanel", "kbDiagBody", "kbDiagCopyBtn"].forEach(function(id) {
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
});

test("鍵盤診斷藏起來了，但不可以變成叫不出來的死程式碼", function() {
  /* 它只在回報 iOS 鍵盤問題時才用得到，平常不該在設定裡佔一列。
     但「藏起來」跟「拿掉」是兩件事：沒有任何入口的話，那幾百行程式碼就是
     死的，下次出事還得先把它接回來。

     入口是長按（或右鍵）設定裡的「版本」那一列——那裡本來就是
     「回報問題時請附上」的那一列。 */
  assert.ok(!/class="settings-row"[^>]*onclick="toggleKbDiag\(\)"/.test(html),
    "設定裡不該再有一列鍵盤診斷 —— 使用者說暫時用不到了");

  assert.match(html, /id="versionRow"/, "版本那一列要有 id，長按選單才掛得上");
  assert.match(js, /function setupKbDiagEntry\(\)/, "要有一條把入口接上去的路徑");

  const entry = js.match(/function setupKbDiagEntry\([\s\S]*?(?=\nfunction )/);
  assert.ok(entry, "找不到 setupKbDiagEntry()");
  assert.match(entry[0], /attachContextMenu\(row/,
    "用現成的 attachContextMenu()，不要自己寫長按 —— " +
    "它已經處理過 iPad 上「長按放開會補一個假 click」那一串麻煩事");
  assert.match(entry[0], /action: toggleKbDiag/, "選單項目要真的接到開關");

  // 接上去了也要有人叫它，不然還是死的
  assert.match(js, /setupKbDiagEntry\(\);/, "setupKbDiag() 要呼叫它");
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

  /* 不要對著顯示字串比順序——那些字會改（實際上就改過一次，測試跟著紅了）。
     改成比「第一個把結果寫進畫面的地方」：stale 一定要排在它之前，不然
     兩邊版號一致時就永遠輪不到它。 */
  const firstWriteAt = body.search(/desc\.textContent\s*=/);
  assert.ok(staleAt !== -1, "函式體裡要看得到 pageCodeStale");
  assert.ok(firstWriteAt !== -1, "函式體裡要看得到 desc.textContent = ...");
  assert.ok(staleAt < firstWriteAt,
    "「跑著舊程式碼」要判斷在所有其他分支之前 —— 兩邊版號會一致，" +
    "排在後面就永遠輪不到它");
});

test("版本那一列要可以點，而且點下去是真的去問伺服器", function() {
  /* 「重新整理才會套用」只有使用者自己動手才會發生，所以那一列必須點得動。
     原本它是 <div class="settings-row is-static">，看得到摸不著。 */
  const row = html.match(/<(\w+)[^>]*onclick="checkForUpdateNow\(\)"/);
  assert.ok(row, "設定裡的版本那一列要掛 checkForUpdateNow()");
  assert.strictEqual(row[1], "button", "要是 <button>，div 沒有鍵盤焦點也沒有點擊語意");
  assert.ok(!/is-static[^>]*onclick="checkForUpdateNow/.test(html),
    "既然點得動就不該還掛著 is-static");

  /* 光重讀一次 sw.js 不算「檢查更新」：那只問得到伺服器上是哪一版，
     不會讓瀏覽器真的去把新的 worker 抓下來裝好。 */
  assert.match(js, /function forceUpdateCheck\(\)/,
    "要有一條強制去問伺服器的路徑");
  assert.match(js, /swRegistration\.update\(\)/,
    "forceUpdateCheck() 要呼叫 registration.update()，不能只是重讀 sw.js");
  assert.match(js, /function checkForUpdateNow\(\)[\s\S]*?forceUpdateCheck\(\)/,
    "點下去要先強制檢查，再重畫那一列");
});

test("使用者主動按的時候，防重複的那兩道閘門要讓路", function() {
  /* showUpdateModal() 有兩道「不要吵人」的閘門：按掉過一次就不再跳、
     有別的彈窗開著就排隊等。對自動偵測是對的，但使用者自己按的時候，
     這兩道都會變成「我按了卻什麼都沒發生」。 */
  assert.match(js, /function showUpdateModal\(force\)/,
    "showUpdateModal() 要收一個 force 參數");
  assert.match(js, /if \(updateModalShown && !force\) return;/,
    "按掉過一次的閘門要能被 force 繞過");
  assert.match(js, /if \(otherModalOpen\(\) && !force\)/,
    "排隊等別的彈窗那道也要能被 force 繞過");
  assert.match(js, /showUpdateModal\(true\)/,
    "checkForUpdateNow() 要用 force 叫它");
});

test("directory.js 不再用瀏覽器內建的 prompt() 問名稱", function() {
  /* 使用者要的是「預設文字反藍、直接打字就取代」。prompt() 的預設文字選不選
     是瀏覽器決定的，iOS 不選——所以名稱一律走 openTextInputModal()。
     哪天有人順手寫回 prompt()，iOS 上又要先手動刪掉「新分類」才能打。 */
  const dir = fs.readFileSync(path.join(ROOT, "js", "directory.js"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");
  assert.ok(!/\bprompt\(/.test(dir), "directory.js 裡不該再有 prompt(");
});

test("輸入彈窗：打開就全選、組字中的 Enter 不送出、不被自動聚焦搶走", function() {
  const modal = fs.readFileSync(path.join(ROOT, "js", "modal.js"), "utf8");
  const main = fs.readFileSync(path.join(ROOT, "js", "main.js"), "utf8");
  const code = modal.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");

  assert.match(code, /if \(inputs\[0\]\) focusAndSelect\(inputs\[0\]\);/, "打開時第一欄要全選");
  assert.match(code, /function focusAndSelect[\s\S]*?input\.select\(\);[\s\S]*?setSelectionRange\(0, input\.value\.length\)/,
    "select() 在 iOS 不一定生效，要用 setSelectionRange 補");

  /* 用注音選字時按的 Enter 是「確定這個字」。 */
  assert.match(code, /if \(e\.isComposing \|\| e\.keyCode === 229\) return;/,
    "組字中的 Enter 不可以送出 —— 不然選完字就建了一個半截名稱的資料夾");

  /* setupModalKeyboard 在觸控裝置上會把焦點移到卡片本身。 */
  assert.match(main, /if \(active && active !== document\.body && active !== modal && modal\.contains\(active\)\) return;/,
    "焦點已經在彈窗裡面時不要搶 —— 不然反藍會消失、鍵盤升起又收回");

  assert.match(html, /id="textInputModal"[\s\S]*?onclick="closeTextInputModal\(\)">取消</,
    "「取消」兩個字不能改：Escape／點遮罩是靠這兩個字找到關閉按鈕的");
});
