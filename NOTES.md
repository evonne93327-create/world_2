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
| main | `c672df8`（PR #38 合併後） |
| service worker | **v56** |
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

### 3. 「有沒有手指／鍵盤」跟「版面寬不寬」是兩件事

這一條被違反了三次，每次都是平板專屬的災情，而且每次都是同一個形狀：
修正被 `isMobileLayout()` 或 `@media (max-width: 768px)` 關在手機版裡，
**iPad 直放 820、橫放 1180，兩種都算桌機版面，所以永遠吃不到**。

| 出過的事 | 被關在哪裡 |
|---|---|
| 自動聚焦把軟體鍵盤叫出來，擠掉半個彈窗 | 用寬度判斷「有沒有實體鍵盤」 |
| 右滑打開目錄欄在平板完全沒反應 | `setupEdgeSwipe()` 開頭 `if (!isMobileLayout()) return;` |
| 鍵盤升起時浮動按鈕不會讓位 | `:root.kb-open { --fab-bottom: ... }` 寫在手機版的媒體查詢裡 |

規則：凡是跟**手指**或**軟體鍵盤**有關的判斷，用
`isTouchPrimary()`（`(hover: none) and (pointer: coarse)`）或直接無條件套用，
**不要用寬度**。寬度只決定版面長怎樣（抽屜 vs 收合），不決定裝置有什麼。

（`isTouchPrimary()` 在 iPad 上實機量過是 `true`；但接了鍵盤保護殼或
觸控板的機器有可能變 `false`，那時手勢就不會啟用——這是已知的取捨。）

### 3b. iOS 長按之後會補一串合成的 mouse 事件

長按結束放開手指時，iOS 會補出 `mousedown` / `mouseup` / `click`，
**目標是手指底下那個元素**。這一串造成過兩個看起來完全無關的災情：

- **白板節點會跳到點擊的位置。** 合成的 `mousedown` 讓拖曳重新開始，
  掛在 window 上的 `mousemove` 一直留著，下次碰畫面節點就跟著跑。
  擋法：**一次拖曳只屬於開始它的那一次互動**——觸控比對 `Touch.identifier`，
  滑鼠看 `buttons === 0`（沒按著鍵卻在移動，那就不是拖曳）。
  這個判斷跟「是誰讓拖曳殘留下來的」無關，所以之後再冒出別的路徑也擋得住。
- **長按叫出的選單，鬆手就自己關掉。** 合成事件的目標是節點、不是選單，
  於是「點到選單外面就關掉」的處理器把它關了。擋法：從長按叫出選單到那根
  手指放開後 700ms 為止，不接受「點到外面」的關閉；新的一次 `touchstart`
  立刻解除，所以點旁邊關選單不受影響。
  **不能改成「開啟後 N 毫秒內不關」**——手指可以按著兩秒才鬆手，合成事件是
  在鬆手時才來的。

另外：長按叫出來的選單在桌機／平板版面是**開在手指正下方**的，所以選單自己
（含標題那一行）一定要設 `user-select: none`，否則 iOS 的長按會改去選選單的
文字，跳出系統的選字工具列。

### 3c. 軟體鍵盤：`visualViewport` 有幾個不同的量，不要混用

iOS 的 `dvh` **不會**扣掉軟體鍵盤（只扣瀏覽器自己的網址列），
`interactive-widget=resizes-content` 只有 Chrome/Android 認得。
所以鍵盤的高度只能從 `visualViewport` 算。這裡很容易寫錯，錯過三次：

| 要算什麼 | 式子 | 寫成哪個變數 | 為什麼 |
|---|---|---|---|
| **有沒有鍵盤** | `innerHeight − vv.height` | —（只用來判斷） | 螢幕上被鍵盤蓋住的高度。**頁面捲到哪裡都不影響它** |
| **固定定位要往上讓多少** | `innerHeight − vv.offsetTop − vv.height` | `--kb-inset` | `position: fixed` 貼的是版面視窗底部，而鍵盤升起時 iOS 會把版面視窗往上推 `offsetTop`（為了讓游標露出來），要扣掉 |
| **`body` 的外框要多高** | `vv.offsetTop + vv.height` | `--kb-h` | 從版面頂端到看得見的底端。下緣剛好停在鍵盤上緣，而且文件不會長到可以捲 |
| **`body` 的上緣要讓開多少** | `vv.offsetTop` | `--kb-top` | 被 iOS 推掉的那一段。用 `padding-top` 補回來，最上面的工具列才留得住 |
| **子結構要多高** | `vv.height` | `--kb-vh` | `body` 加了 `padding-top` 之後，內容盒是這個高度，不是 `--kb-h` |

踩過的三種寫法：

- **完全不管 `offsetTop`** → 按鈕被頂得太高浮在半空，`body` 太矮下方露一條
  黑帶，黑帶高度正好等於被捲上去的距離。
- **把 `offsetTop` 折進「有沒有鍵盤」** → 橫放時可視區只有 364px 左右，
  iOS 得捲很多，那個值掉到門檻以下就判定「沒有鍵盤」，`.kb-open` 整個被
  拿掉、按鈕退回原位躲到鍵盤後面。**直放可視區 704px 捲得少，僥倖沒跨過
  門檻，所以只有橫的壞**——「只有一個方向壞」就是在指這一類錯誤。
- **只聽 `resize`** → `offsetTop` 改變時 iOS 發的是 **`scroll`**，不是
  `resize`。少聽那一個的話，鍵盤剛升起算出來的值是對的，之後就一直停在舊值。
- **只顧 `body` 的下緣、不顧上緣** → 高度設成 `offsetTop + vv.height`
  確實讓下緣停在鍵盤上方，但 `body` 的上緣還釘在版面視窗頂端，被推上去的
  `offsetTop` 那一段就是最上面的工具列——**「上面的東西被吃掉」**。
  補一行 `padding-top: var(--kb-top)` 把內容整個下移，外框維持 `--kb-h`
  （文件才不會多出可捲的空間，iOS 不會再去捲文件）。
  子結構的高度要跟著改成 `--kb-vh`，不然會比 `body` 的內容盒高出那一段。

**「跟著 `offsetTop` 讓開會不會跟 iOS 互推到失控？」** 不會。可視區不可能
被推出版面視窗之外，所以 `offsetTop` 被夾在 `0 ~ 鍵盤高度` 之間，最多就是
讓到鍵盤高度、app 正好貼齊可視區。程式裡也照這個範圍夾過一次
（`Math.min(Math.max(0, offsetTop), covered)`），量到橡皮筋造成的怪值也不會
算出負的 `inset`。

固定定位的整頁圖層（彈窗遮罩、目錄抽屜、快速跳轉面板）縮 `body` 救不到，
要自己 `top: var(--kb-top); bottom: var(--kb-inset)`。它們本來就有 `inset:0`
或 `top:0;bottom:0`，覆蓋這兩個值不會多長出一個維度——但**長按選單那種只有
`top`/`left` 的就不能加 `bottom`**，會被撐成整片。

### 3d. 「先捲上去再開鍵盤」為什麼不能當唯一的防線

`setupCaretRoomOnFocus()` 在 `focus` 當下（鍵盤還沒升起）就用上一次記得的
鍵盤高度把游標捲到安全位置，讓 iOS 沒有理由去推版面視窗。方向是對的，
但它單獨撐不住，兩個洞：

1. **第一次聚焦沒有值可以用**（`lastKnownKeyboardInset` 還是 0），那一次
   一定讓 iOS 自己處理。
2. **捲得上去的前提是下面還有東西可以捲。** 游標在文章中間時下面有一大片
   內容；在**文章結尾附近**時，捲動容器底下只剩那一點內距，而要讓游標高過
   鍵盤得捲 300~400px——捲到底也讓不出來。而「在文章結尾附近打字」正是寫
   東西最常見的狀態。

第 2 點可以補一半：加大的底部內距本來只掛在 `.kb-open` 上，也就是鍵盤
**已經升起**才給，正好晚了一步。現在多一個 `.kb-pending`（聚焦時掛、blur
時拿掉）把同一塊空間提前留出來，值必須跟 `.kb-open` 完全一樣——晚一步給
等於沒給。順帶也讓 iOS 自己的「把游標捲進視野」有地方可捲，那對第 1 點
（第一次聚焦）特別有用。

**要留多少：一個鍵盤的高度。** 把最後一行從容器底抬到可視區頂端，要捲的量
正好就是鍵盤蓋住的高度。所以內距是
`max(保底十行, --kb-reserve) + 按鈕那一排 + 兩行`。

`--kb-reserve` 是上一次量到的鍵盤高度，`rememberKeyboardHeight()` 寫入並存進
`localStorage`。兩個關鍵：

- **收鍵盤時不清掉它。** 它是「記得的」不是「現在的」；清掉的話下次聚焦又
  沒有值可以用，整個機制等於不存在。`tests/kb-vars.test.js` 的豁免名單有
  反向檢查，免得哪天清除的程式碼加回來卻沒人發現。
- **寫死行數不夠。** 十行約 304px，橫放的鍵盤是 456px。十行只是「剛裝好、
  還沒見過鍵盤」那一次的保底值，存進 localStorage 就只有真正的第一次會用到。

還有一點很重要：這塊空間掛在 `.kb-pending` 上，而 `.kb-pending` **只看有沒有
聚焦，完全不碰 `visualViewport`**。就算鍵盤偵測整個失效（`.kb-open` 從來沒
掛上），這塊捲動空間照樣會出現。只掛在 `.kb-open` 上就沒有這個保險。

兩個 class 都是「正在編輯」才掛，所以沒在打字時這塊空白不存在，平常讀稿
捲不到它。

`.kb-pending` 只動編輯區的內距，**不要去動版面高度**：鍵盤還沒升起，可視區
就是整個畫面，這時候縮 `body` 會先縮一次、鍵盤上來再縮一次，閃兩下。

兩條路是互補的，不是二選一：先捲上去是讓 iOS **沒有理由**推，3c 的
`padding-top` 是推了也**無害**。後者才是保底，因為它不需要搶贏時序、也不
需要有捲動空間可用。

另外兩個保險：雙指放大時 `vv.height` 也會變小（`vv.scale > 1.05` 要排除），
以及 `offsetTop` 取不到時要當 0——`undefined` 會讓整串變成 `NaN`，而
`NaN <= 門檻` 是 `false`，會一路往下寫進 `--kb-h: NaNpx`，比不做還糟。

### 3e. 版本那一行會在最需要它的時候說謊

`sw.js` 有 `skipWaiting()` + `clients.claim()`，所以新的 worker 一裝好就
**立刻接管已經開著的那一頁**。於是會出現這個狀態：

| 東西 | 是哪一版 |
|---|---|
| 設定裡顯示的版本（問 worker 拿的） | **新的** |
| 這一頁的 `style.css` / `js`（載入當下拿的） | **舊的** |

使用者看到新版號、以為在跑新程式碼，回報「你改了還是一樣」——而新版的 CSS
根本還沒套用。**這真的發生過，白查了一輪**：對方附了截圖說版本是 v60，症狀
卻跟 v58 一模一樣。

所以 `controllerchange`（以及 `updatefound` 那條備援）除了跳更新提示，還要
把這一頁標記成 `pageCodeStale`，而 `renderVersionRow()` **必須把這個判斷排在
「已是最新版」之前**——兩邊版號這時是一致的，排在後面就永遠輪不到它。

更新提示彈窗不能代替這一行：它有可能被別的彈窗擋著排隊、也可能被使用者按掉，
而版本那一行是「回報問題時請附上」的那一行，它說的話必須永遠是真的。

### 3f. 猜三輪不如讓那台機器自己說

iOS 鍵盤的行為在這個環境驗不了（裝不起 WebKit）。3c 那三個踩過的寫法、加上
這一輪的兩個，全都是靠推理猜出來的，猜錯一次就是一整輪。

設定裡有一個預設關著的 **🩺 鍵盤診斷**：打開之後畫面左上角會浮一塊黑框，
即時顯示 `innerHeight` / `visualViewport` 的寬高與 `offsetTop` / `scale`、
`.kb-open` 有沒有掛上、那四個 `--kb-*` 的實際值、`body` 的 `padding-top` 與
高度、工具列與浮動按鈕的 `rect.top`，還有 `standalone`（是不是從主畫面開的
PWA）與 `stale`（這一頁是不是在跑舊程式碼）。有「複製」鈕可以直接貼回來。

幾個決定性的讀法：

| 看到 | 意思 |
|---|---|
| `kbOpen: FALSE` | 根本沒偵測到鍵盤，`vv.height` 沒縮 |
| `kbOpen: true`、`bodyPadTop: 0px`、`vvTop` 不是 0 | 偵測到了但讓位的 CSS 沒生效（多半是 3e 那個狀況） |
| `navTop` 是負的 | 上面的工具列還是被推出畫面 |
| `fabTop` 大於 `vv` 的高度 | 浮動按鈕還藏在鍵盤後面 |

面板自己的 `top` 是用 `visualViewport.offsetTop` 直接算的，**不能用
`--kb-top`**：那個變數只有在偵測到鍵盤時才有值，而「沒偵測到」正是要診斷的
情況之一。

（以前做過一頁 `diag.html`，任務結束就刪掉了。這次放在設定裡、預設關著，
下次就不用重做。）

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
node --test          # 37 項。注意：不要寫 node --test tests/，Node 22 會去 require 那個目錄
```

| 檔案 | 測什麼 |
|---|---|
| `tests/pure.test.js` | 純函式（escapeHtml、hashtag 抽取、鍵盤的 `keyboardInsetState` 等） |
| `tests/edge-geometry.test.js` | 白板連線的曲線幾何 |
| `tests/shell-manifest.test.js` | sw.js 的 SHELL 有沒有跟實際檔案脫節 |
| `tests/kb-vars.test.js` | 鍵盤那組 `--kb-*` 與 `.kb-*`：JS 寫／掛的與 CSS 用的有沒有對上 |
| `tests/wiring.test.js` | `onclick="foo()"` 有沒有對應的函式、鍵盤診斷的 id 有沒有接上 |
| `tests/helpers/load-app.js` | `node:vm` 沙箱；跨 realm 的 `deepStrictEqual` 會因為 prototype 不同而失敗，所以有個 `host()` 做 JSON round-trip |

### 不在 repo 裡的

開發過程中寫了約 40 個 Playwright 套件，**它們只在當時的工作階段暫存區裡，
沒有進版控**。重寫的成本不低，之後如果要長期維護這個專案，值得把常用的幾支
搬進 `tests/`。

平板／iOS 那一輪的幾支特別值錢（它們釘住的都是這裡重現不了、只能靠推理與
模擬的行為）：

| 套件 | 釘住什麼 |
|---|---|
| `test_tablet` (72) | 平板右滑開目錄、長按成功率、點旁邊不會拖走節點 |
| `test_kbdetect` (28) | 鍵盤偵測不受捲動影響（橫放捲到見底也要成立） |
| `test_kbscroll` (33) | `offsetTop` 的三個量算對，`body` 下方不留黑帶 |
| `test_fab` (27) | 三種尺寸下浮動按鈕有沒有高過鍵盤上緣 |
| `test_stranded` (14) | 一次拖曳只屬於開始它的那一次互動 |
| `test_menuclose` (21) | 合成 mouse 事件不會把剛跳出來的選單關掉 |
| `test_ctxselect` (20) | 選單自己選不到字（含「選單開在手指底下」這個前提） |
| `test_capture` (6) | 拖曳收尾不靠冒泡（被 `stopPropagation` 擋住也要收得掉） |

**這些測試要自己送合成事件來模擬 iOS。** Chromium 有它自己的長按處理，
會補 `contextmenu` 與 `touchcancel` 把問題掩蓋掉——走 CDP 真觸控的話，
測試會「因為錯的理由而通過」。反過來，右滑那種要驗「會不會順手觸發 click」
的，就必須走 CDP，合成事件不會產生 click。

跑法（Playwright 在這個環境的路徑）：

```js
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
```

伺服器：不同批測試寫死了不同的埠（多數是 `8899` 與 `8950`，另有 `8940`、
`8947`、`8951`、`8952`），一次全開比較省事。

```bash
python3 -m http.server 8899 --bind 127.0.0.1 &
```

**WebKit 裝不起來。** 實測錯誤是
`request blocked: no rule or allowlist entry allows host "playwright.download.prss.microsoft.com"`
——環境的網路政策只放行特定網域。Safari 沒有 Linux 版，所以 iOS 專屬的行為
只能靠推理＋合成事件模擬，最後由使用者實機確認。

曾經做過一頁 `diag.html` 讓 iPad 自己跑檢查並印出 JSON 報告，任務完成後
依使用者要求刪掉了（`git show 96bb95f^:diag.html` 可以撈回來）。它的結論
記在下面「已實機驗證」那一節。它也留下一個教訓：**那一頁的長按門檻寫死
300ms、app 其實是 480ms，於是把本來就不該跳選單的短按算成「失敗」，
報出 13/17 這種嚇人的數字，害人去查根本沒壞的東西。會謊報的診斷工具比
沒有還糟——所以門檻要讀 app 的常數，不要自己抄一個。**

---

## 還沒做的

| 項目 | 狀態 |
|---|---|
| TXT 匯出的粗體、斜體 | 使用者說「先不做」 |
| 一次性重壓既有圖片 | 已提議，沒有回覆。目前的壓縮只影響新加入的圖片 |
| CSP（`<meta http-equiv>`） | 要先把滿地的 `onclick=` 屬性清掉才能加 |
| Phase 2 AI 輔助 | 打算走 Supabase Edge Functions 代理，還沒開始 |
| 刪掉已合併的舊分支 | 使用者說「等等再刪」 |

## 已實機驗證（iPadOS 26 / Safari 26.6，820×1124 直、1180×764 橫）

這些是這個環境驗不到、由使用者在 iPad 上跑出數據確認的。**不要因為看不懂
就把相關的程式碼當成多餘的拿掉。**

| 事項 | 實測結果 |
|---|---|
| `-webkit-touch-callout: none` 真的生效 | `.canvas-node` 計算值是 `none`（Chromium 連這個屬性都不認得，回 `undefined`） |
| 編輯中的便條紙仍然選得到字 | 計算值 `default` / `text`，該關的關、該留的留 |
| 放大鏡確實被擋掉 | 兩輪共 38 次長按，`touchcancel` **0 次**（系統沒來搶手勢） |
| 冒泡那條路真的被切斷 | `windowCapture 21/21` 配 `windowBubble 0`——拖曳收尾非走捕獲階段不可 |
| 右滑窄帶要含世界觀直欄 | 實測起手點 `x = 57`，落在新的 90px 窄帶內但**超出舊的 28px** |
| `isTouchPrimary()` 在 iPad 是 true | `hover: none` 與 `pointer: coarse` 都成立（未接觸控板時） |
| 鍵盤、長按、右滑、點旁邊不拖走節點 | 使用者逐項操作確認 |

## 待使用者實機驗證

- **用注音打字時按 Enter 選字**，確認「段首空兩格」開著時不會把選字變成換行。
  程式有擋（`e.isComposing` / `keyCode 229`）、測試有模擬，但實機才算數。
- **iPad 上白板的雙指縮放**。`user-scalable=no` 拿掉之後，頁面縮放可能
  跟白板本來就吃的雙指縮放打架，這是唯一沒把握的地方。
- **接了鍵盤保護殼／觸控板的 iPad**。那時 `hover: none` 可能不成立，
  `isTouchPrimary()` 會變 `false`，右滑開目錄的手勢就不會啟用。
  目前沒有機器可以驗。
