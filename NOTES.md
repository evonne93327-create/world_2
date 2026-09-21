# 開發筆記（交接用）

給接手的人／下一個對話看的。README 講「這個 app 是什麼」，這份講
**「改它的時候要知道什麼」**——主要是踩過坑之後才立下的規則，
以及還沒做完的事。

姊妹專案：[`evonne93327-create/timeline`](https://github.com/evonne93327-create/timeline)（時間軸年表）。
它也有一份 `NOTES.md`，下面「硬規則」與「工作方式」兩節兩邊是同一份，
改了記得兩邊一起改。

---

## 現況

| | |
|---|---|
| 線上位置 | https://evonne93327-create.github.io/world_2/ |
| main | `8ef02b3`（PR #30 合併後） |
| service worker | **v40** |
| 開發分支 | `claude/beautiful-feynman-ts3pe6` |
| 開著的 PR | 無 |

### 分支流程

一律在 `claude/beautiful-feynman-ts3pe6` 上開發，開 PR 合併到 main。
**PR 合併之後那個 PR 就結束了，不要再往上疊 commit**——把分支重設在
合併後的 main 上重新開始：

```bash
git fetch origin main
git checkout -B claude/beautiful-feynman-ts3pe6 origin/main
```

分支上如果還有沒合併進去的 commit，改用 `git rebase origin/main` 保留它們。

---

## 硬規則

這幾條都是出過事才立的，不要為了「比較簡潔」退回去。

### 1. localStorage 一律走 `safeStorage*`（`js/state.js`）

不是只有「空間滿了」一種壞法。瀏覽器設定關掉網站資料、企業政策、某些嚴格的
隱私模式下，**光是讀 `window.localStorage` 這個屬性本身就會丟 `SecurityError`**。
沒包起來的話，一丟例外整個檔案就在那行中斷，後面的 `let` 宣告全部沒執行到；
函式因為提升看起來還在，一呼叫就撞上 TDZ。

結果是 app 看起來完全正常、打字切換都能用，但每次存檔都在背景丟例外、
什麼都沒存進去，而且不會告訴使用者。

### 2. Service worker：網路優先、不碰跨網域、改了就加 VERSION

- **網路優先、離線才回退快取。** 快取優先會把使用者鎖在舊版程式碼裡，
  而且很難自己救回來——強制重新整理也未必有用，因為回應是 service worker
  給的，根本沒碰到網路。
- **絕不快取跨網域請求**（Supabase、Google API）。快取它們只會造成同步
  讀到過期資料。
- **動到 `index.html` 引用的任何檔案，就把 `sw.js` 的 `VERSION` 加一號。**
  不加的話舊快取不會被清掉。`tests/shell-manifest.test.js` 會檢查 SHELL
  有沒有跟實際檔案脫節，但版號要自己記得改。

### 3. 觸控裝置不自動聚焦輸入框

會把軟體鍵盤叫出來，鍵盤又把彈窗擠掉半個畫面。判斷用
`isTouchPrimary()`（`(hover: none) and (pointer: coarse)`），
**不要用寬度**——iPad 橫放超過 768px 但一樣沒有實體鍵盤。

### 4. 彈窗卡片不要畫預設焦點框

`.modal-card` 的 `tabindex="-1"` 只是給程式聚焦用的錨點，使用者按 Tab
到不了它。不關掉 `outline` 的話，瀏覽器會在整張卡片外圍畫一圈
（深色主題下 Chromium 畫出來是金黃色），看起來像那個彈窗的外框壞了。

### 5. 使用者輸入一律 `createElement` + `textContent`

不要拼 `innerHTML`。標題、內文、標籤都可能是匯入來的，拼進 HTML 就等於
把 `"` `<` 這些字元交給瀏覽器解讀。用 `textContent` 從源頭就沒有這個問題，
不必每個欄位都記得 escape（漏掉一個就是一個洞）。

### 6. 雲端同步的安全界線

- **只能用 Supabase 的 anon public key**，它可以公開放在前端。
  **`service_role` key 絕對不進前端、也不要傳給我**——它會繞過所有權限檢查。
- anon key 的安全性建立在 **Row Level Security** 上，見 `supabase/schema.sql`。
  之後加任何資料表都要一併開 RLS。
- Google OAuth **只用 `drive.file` scope**，不要用完整的 `drive`。
  client ID 是公開的、不是密碼；client secret 這個流程用不到，不要貼進來。
- 同步的請求都帶 `cache: "no-store"`。PostgREST 的回應沒有 `Cache-Control`，
  瀏覽器會自己推測一個保鮮期，一次 GET 就可能吃到上一次的回應——
  對「判斷雲端現在是第幾版」來說是致命的。
- **絕不採用比本機記錄還舊的雲端版本。** `version` 只會往上加，
  雲端比較舊＝這次讀到的是過期回應。隔 1.5 秒重抓一次，還是舊的就停下來
  問使用者，不要自己決定。

---

## 工作方式

- **每個改動都用 Playwright 實測**，不要只看程式碼覺得對。
- **故意把修好的地方改壞，確認對應的測試真的變紅。** 這串裡好幾次
  測試是空的（斷言寫錯、選擇器選不到東西），不驗證的話等於沒測。
- **註解寫「為什麼」不寫「做什麼」**，尤其是踩過的坑與刻意的取捨。
  程式碼本身說得出「做什麼」，說不出「為什麼不能用另一個寫法」。
- **推完馬上確認有沒有對應的 open PR，沒有就當場開。**
  這串裡漏過兩次，commit 孤零零掛在分支上進不了 main。
- **量，不要猜。** 效能與版面的問題都要有數字。有好幾次「看起來比較快」
  的寫法實測更慢，「截圖看起來對齊」的版面實測差 185px。

---

## 測試

### 在 repo 裡的

```bash
node --test          # 19 項。注意：不要寫 node --test tests/，Node 22 會去 require 那個目錄
```

| 檔案 | 測什麼 |
|---|---|
| `tests/pure.test.js` | 純函式（escapeHtml、hashtag 抽取等） |
| `tests/edge-geometry.test.js` | 白板連線的曲線幾何 |
| `tests/shell-manifest.test.js` | sw.js 的 SHELL 有沒有跟實際檔案脫節 |
| `tests/helpers/load-app.js` | `node:vm` 沙箱；跨 realm 的 `deepStrictEqual` 會因為 prototype 不同而失敗，所以有個 `host()` 做 JSON round-trip |

### 不在 repo 裡的

開發過程中寫了約 30 個 Playwright 套件（`test_robust`、`test_review`、
`test_perf`、`test_syncguard`、`test_settings`、`test_theme`、`test_darkscan`、
`test_indent`、`test_back5`、`test_stale`、`test_supabase_stale`、`test_modalring` …），
**它們只在當時的工作階段暫存區裡，沒有進版控**。
重寫的成本不低，之後如果要長期維護這個專案，值得把常用的幾支搬進 `tests/`。

跑法（Playwright 在這個環境的路徑）：

```js
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
```

```bash
python3 -m http.server 8899 --bind 127.0.0.1 &
```

**WebKit 裝不起來**（proxy 擋掉 `cdn.playwright.dev`），所以 Safari／iOS
專屬的問題只能靠使用者實機回報。這串裡的 iPad 白板漂移就是這樣查出來的。

---

## 還沒做的

| 項目 | 狀態 |
|---|---|
| TXT 匯出的粗體、斜體 | 使用者說「先不做」 |
| 一次性重壓既有圖片 | 已提議，沒有回覆。目前的壓縮只影響新加入的圖片 |
| CSP（`<meta http-equiv>`） | 要先把滿地的 `onclick=` 屬性清掉才能加 |
| Phase 2 AI 輔助 | 打算走 Supabase Edge Functions 代理，還沒開始 |
| 刪掉已合併的舊分支 | 使用者說「等等再刪」 |

## 待使用者實機驗證

- **用注音打字時按 Enter 選字**，確認「段首空兩格」開著時不會把選字變成換行。
  程式有擋（`e.isComposing` / `keyCode 229`）、測試有模擬，但實機才算數。
- **iPad 上白板的雙指縮放**。`user-scalable=no` 拿掉之後，頁面縮放可能
  跟白板本來就吃的雙指縮放打架，這是唯一沒把握的地方。
