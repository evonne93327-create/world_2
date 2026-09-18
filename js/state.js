const DEFAULT_PALETTES = {
  "c_gray":   { name: "一般隨記", bg: "#EFE9DC", text: "#5A4F42" },
  "c_blue":   { name: "地理與勢力", bg: "#DCE7F0", text: "#28506B" },
  "c_green":  { name: "定稿與完成", bg: "#DCEAE1", text: "#2C5A44" },
  "c_purple": { name: "角色人物誌", bg: "#E7DFF0", text: "#553B76" },
  "c_orange": { name: "待釐清坑洞", bg: "#F3E1CC", text: "#8A4F1F" },
  "c_rose":   { name: "重要核心伏筆", bg: "#F3DAD5", text: "#8C3527" },
  "c_yellow": { name: "靈感隨筆", bg: "#F2E8C9", text: "#7A5B12" }
};

const COMMON_ICONS = ["📁", "🌍", "⚔️", "🛡️", "📜", "🏰", "🧙", "🐉", "🔮", "🔥", "💎", "🏛️", "👑", "🗡️", "🏹", "📖", "✨", "🔖"];
const MARKDOWN_HEADING_REGEX = /^#\s+(.+)/;
const CHAPTER_LINE_REGEX = /^(第[0-9一二三四五六七八九十百]+[章回卷節]|Chapter\s+[0-9]+)/i;
const DOC_HISTORY_LIMIT = 5000;
const HISTORY_SNAPSHOT_THROTTLE_MS = 1200;

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

/* ===== 白板操作提示是否已隱藏（跨 session 記住） ===== */
let canvasHintDismissed = localStorage.getItem("worldbuilder_canvas_hint_dismissed") === "1";
