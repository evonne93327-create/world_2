/* 排序是「灰 紅 橙 黃 綠 藍 紫」——灰是中性放最前，其餘照色相環。
   顯示順序一律以這個物件的鍵順序為準，所以要改排序改這裡就好。
   注意：不要改成去迭代 appData.colorPalette，那是使用者存檔裡的複本，
   鍵的順序停在他第一次存檔的那一天，改了這裡也不會動。 */
const DEFAULT_PALETTES = {
  "c_gray":   { name: "一般隨記", bg: "#EFE9DC", text: "#5A4F42" },
  "c_rose":   { name: "重要核心伏筆", bg: "#F3DAD5", text: "#8C3527" },
  "c_orange": { name: "待釐清坑洞", bg: "#F3E1CC", text: "#8A4F1F" },
  "c_yellow": { name: "靈感隨筆", bg: "#F2E8C9", text: "#7A5B12" },
  "c_green":  { name: "定稿與完成", bg: "#DCEAE1", text: "#2C5A44" },
  "c_blue":   { name: "地理與勢力", bg: "#DCE7F0", text: "#28506B" },
  "c_purple": { name: "角色人物誌", bg: "#E7DFF0", text: "#553B76" }
};
/* 白板連線專屬色（比標籤色更飽和、辨識度更高） */
const EDGE_COLORS = {
  "e_gray":   { name: "灰", stroke: "#6E6152" },
  "e_red":    { name: "紅", stroke: "#D9433B" },
  "e_orange": { name: "橙", stroke: "#D97A2B" },
  "e_yellow": { name: "黃", stroke: "#C9A227" },
  "e_green":  { name: "綠", stroke: "#2E8B57" },
  "e_blue":   { name: "藍", stroke: "#2F6FB0" },
  "e_purple": { name: "紫", stroke: "#7A4FB0" }
};

/* 夜間版的同一組分類。深色底配亮字，色相跟日間版對齊，
   所以「紫色＝角色人物誌」在兩個主題下都還是紫的，只是換了明暗。

   名稱不放在這裡：使用者在「標籤分類設定」改的名字存在
   appData.colorPalette，兩個主題共用同一份。這裡只管顏色。 */
const DARK_PALETTES = {
  "c_gray":   { bg: "#33302A", text: "#D5CCBC" },
  "c_rose":   { bg: "#3A2220", text: "#E7A194" },
  "c_orange": { bg: "#3A2A1B", text: "#E2B079" },
  "c_yellow": { bg: "#363019", text: "#DCC98A" },
  "c_green":  { bg: "#1E3229", text: "#99D0B3" },
  "c_blue":   { bg: "#1F2E3C", text: "#9FC4E2" },
  "c_purple": { bg: "#2D2539", text: "#C4AFDD" }
};

/* 連線在夜間也要提亮，原本那組在深色底上會糊成一團 */
const DARK_EDGE_COLORS = {
  "e_gray":   { stroke: "#A0937E" },
  "e_red":    { stroke: "#EE6A60" },
  "e_orange": { stroke: "#E8A35C" },
  "e_yellow": { stroke: "#D9BC5A" },
  "e_green":  { stroke: "#5FBE8A" },
  "e_blue":   { stroke: "#6BA5DC" },
  "e_purple": { stroke: "#A986DC" }
};

/* 主題目前是不是暗的。唯一的判斷來源是 <html data-theme>，
   由 js/theme.js 寫入；CSS 與 JS 都看同一個值，不會各自解讀。 */
function isDarkTheme() {
  return document.documentElement.getAttribute("data-theme") === "dark";
}

/* 取一個標籤分類的顏色。名稱一律來自使用者改過的 appData.colorPalette，
   顏色則看現在是哪個主題。所有要畫標籤／節點顏色的地方都走這裡，
   不要再自己去讀 colorPalette，不然切主題會漏掉。 */
function getPalette(key) {
  const id = DEFAULT_PALETTES[key] ? key : "c_gray";
  const saved = (appData && appData.colorPalette && appData.colorPalette[id]) || DEFAULT_PALETTES[id];
  const colors = isDarkTheme() ? (DARK_PALETTES[id] || DARK_PALETTES.c_gray) : saved;
  return { name: saved.name || DEFAULT_PALETTES[id].name, bg: colors.bg, text: colors.text };
}

function getEdgeStroke(colorId) {
  const id = EDGE_COLORS[colorId] ? colorId : "e_gray";
  return (isDarkTheme() ? DARK_EDGE_COLORS[id] : EDGE_COLORS[id]).stroke;
}

const COMMON_ICONS = ["📁", "🌍", "⚔️", "🛡️", "📜", "🏰", "🧙", "🐉", "🔮", "🔥", "💎", "🏛️", "👑", "🗡️", "🏹", "📖", "✨", "🔖"];
const MARKDOWN_HEADING_REGEX = /^#\s+(.+)/;
const CHAPTER_LINE_REGEX = /^(第[0-9一二三四五六七八九十百]+[章回卷節]|Chapter\s+[0-9]+)/i;
/* 復原紀錄的上限。

   原本是 DOC_HISTORY_LIMIT = 5000，那是「步數」——但每一步存的是整篇
   文章的完整複本，所以記憶體吃的是「步數 × 文章長度」，不是步數。
   一篇五萬字的章節配 5000 步就是 2.5 億個字元，UTF-16 大約 500MB。
   單位一開始就抓錯了。

   改成兩道防線：步數擋住單篇文章，字元總量擋住「開了很多篇」的情況
   （docHistory 是全域的，每開過一篇就多一份）。10M 個字元在 UTF-16
   下大約 20MB，超過就從最舊的開始丟。 */
const DOC_HISTORY_MAX_STEPS = 200;
const DOC_HISTORY_MAX_CHARS = 10 * 1024 * 1024;
const HISTORY_SNAPSHOT_THROTTLE_MS = 1200;

/* 垃圾桶保留天數。超過就自動清掉，否則刪掉的東西會永遠佔著
   localStorage 那 5MB——尤其是帶圖片的文檔。 */
const TRASH_RETENTION_DAYS = 60;

const INITIAL_APP_DATA = {
  colorPalette: Object.assign({}, DEFAULT_PALETTES),
  tagSettings: {
    "帝國軍方": "c_blue",
    "反抗組織": "c_rose",
    "主角群": "c_purple"
  },
  trash: { docs: [], folders: [] },
  worldviews: [
    {
      id: "w_main",
      name: "艾爾達斯主大陸",
      icon: "🌍",
      canvas: {
        nodes: [
          { id: "node_doc_1", docId: "doc_1", x: 40, y: 70 },
          { id: "node_doc_2", docId: "doc_2", x: 280, y: 150 }
        ],
        edges: [
          { id: "edge_1", source: "node_doc_1", target: "node_doc_2", label: "既敵對亦互相利用" }
        ]
      }
    },
    {
      id: "w_sub",
      name: "星界彼端 (外傳)",
      icon: "🔮",
      canvas: { nodes: [], edges: [] }
    }
  ],
  folders: [
    { id: "f_chars", worldId: "w_main", parentId: null, name: "核心角色群", icon: "👥" },
    { id: "f_knights", worldId: "w_main", parentId: "f_chars", name: "皇家騎士階級", icon: "⚔️" },
    { id: "f_lore", worldId: "w_main", parentId: null, name: "歷史年表", icon: "📜" }
  ],
  docs: [
    {
      id: "doc_1",
      worldId: "w_main",
      folderId: "f_knights",
      icon: "🛡️",
      title: "白銀騎士團長",
      content: "# 第一章 誓約之劍\n性格嚴謹肅穆，掌管皇城近衛軍，手握秘銀軍令狀。 #帝國軍方 #主角群\n\n# 第二章 北境之戰\n於舊曆340年率軍抵禦霜雪巨獸，戰役極為慘烈。",
      tags: ["帝國軍方", "主角群"],
      images: [],
      wordCount: 75,
      updatedAt: "2026-09-09 12:00"
    },
    {
      id: "doc_2",
      worldId: "w_main",
      folderId: "f_chars",
      icon: "🗡️",
      title: "暗夜遊俠",
      content: "# 第一章 陰影交匯\n遊走在黑市與皇城外圍的情報商人，表面玩世不恭，實際上是反抗軍的先鋒探子。 #反抗組織 #主角群",
      tags: ["反抗組織", "主角群"],
      images: [],
      wordCount: 52,
      updatedAt: "2026-09-09 12:10"
    }
  ]
};

let appData = JSON.parse(JSON.stringify(INITIAL_APP_DATA));
let activeWorldId = "w_main";
let activeDocId = "doc_1";
let activeFolderId = null;
let activeView = "editor";
let isBatchDeleteMode = false;
let batchSelectedFolders = new Set();
let batchSelectedDocs = new Set();
let iconPickerContext = { type: null, id: null };
let moveFolderTargetId = null;
let connectingSourceNodeId = null;
let collapsedFolders = {};
let docHistory = {}; 
let contentPersistTimer = null;
let pendingPersistInfo = null; 
let historySnapshotTimer = null;
let hashtagFilterActiveColor = null;

/* ===== 白板縮放 / 平移狀態 ===== */
let canvasTransform = { x: 0, y: 0, scale: 1 };
const CANVAS_MIN_SCALE = 0.3;
const CANVAS_MAX_SCALE = 3;

/* ===== 關係編輯彈窗目前編輯的 edge ===== */
let editingEdgeId = null;
