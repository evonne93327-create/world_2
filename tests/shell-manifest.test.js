/* sw.js 的離線快取清單，必須跟 index.html 實際載入的檔案一致。

   這兩份清單是手動維護的：加一支新的 js 卻忘了補進 SHELL，離線時就會
   少掉那一塊，而且不會有任何錯誤訊息——app 看起來開得起來，某個功能
   就是沒反應。這種缺口用眼睛很難發現，但用比對很容易擋掉。 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { ROOT } = require("./helpers/load-app.js");

const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const sw = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");

function shellList() {
  const m = sw.match(/const SHELL = \[([\s\S]*?)\];/);
  assert.ok(m, "在 sw.js 裡找不到 SHELL 清單");
  return m[1].split(",")
    .map(s => s.trim().replace(/^['"]|['"]$/g, ""))
    .filter(Boolean)
    .map(s => s.replace(/^\.\//, ""));
}

function localSrcs(attr) {
  const re = new RegExp(attr + '="([^"]+)"', "g");
  const out = [];
  let m;
  while ((m = re.exec(html))) {
    const v = m[1];
    if (/^https?:\/\//.test(v) || v.startsWith("data:")) continue;   // 外部資源不該進快取
    out.push(v);
  }
  return out;
}

test("index.html 載入的每一支 js 都在 sw.js 的離線清單裡", function() {
  const shell = shellList();
  const scripts = localSrcs("src").filter(s => s.endsWith(".js"));

  assert.ok(scripts.length >= 5, "應該抓得到多支 js（實得 " + scripts.length + "）");
  scripts.forEach(function(src) {
    assert.ok(shell.includes(src),
      "index.html 載入了 " + src + "，但 sw.js 的 SHELL 沒有它 —— 離線時這一塊會無聲失效");
  });
});

test("index.html 的每一份本地 css 都在離線清單裡", function() {
  const shell = shellList();
  const styles = localSrcs("href").filter(h => h.endsWith(".css"));
  assert.ok(styles.length >= 2, "應該抓得到 ui-tokens.css 與 style.css");
  styles.forEach(function(href) {
    assert.ok(shell.includes(href), href + " 不在 sw.js 的 SHELL 裡");
  });
});

test("離線清單裡的每一個檔案都真的存在", function() {
  shellList().forEach(function(rel) {
    if (rel === "" || rel === "/") return;          // './' 代表首頁本身
    assert.ok(fs.existsSync(path.join(ROOT, rel)),
      "sw.js 的 SHELL 列了 " + rel + "，但這個檔案不存在 —— 安裝快取時會整個失敗");
  });
});

test("SHELL 裡沒有重複的項目", function() {
  const shell = shellList();
  assert.strictEqual(new Set(shell).size, shell.length,
    "SHELL 有重複：" + shell.filter((v, i) => shell.indexOf(v) !== i).join(", "));
});

test("sw.js 的版本號有跟著改動更新（格式檢查）", function() {
  const m = sw.match(/const VERSION = '(v\d+)'/);
  assert.ok(m, "sw.js 應該有 const VERSION = 'vN'，更新提示靠它判斷有沒有新版");
});

test("manifest.json 與 index.html 引用的圖示都存在", function() {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
  (manifest.icons || []).forEach(function(icon) {
    assert.ok(fs.existsSync(path.join(ROOT, icon.src)),
      "manifest.json 指向的 " + icon.src + " 不存在");
  });
  localSrcs("href").filter(h => /\.(png|ico|svg)$/.test(h)).forEach(function(href) {
    assert.ok(fs.existsSync(path.join(ROOT, href)),
      "index.html 指向的 " + href + " 不存在");
  });
});
