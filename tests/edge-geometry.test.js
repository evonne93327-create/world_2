/* 白板連線幾何的不變條件。

   README 花了一整段解釋這裡踩過的坑：舊做法是「先沿邊框排出發點，再另外
   決定往哪邊彎」——出發點沿邊框排開、彎曲卻沿兩節點中心連線的法線，
   斜向時這兩個方向不一致，順序一旦相反，線就會在中段互相穿越。

   現在的做法是「先畫完整的中心到中心曲線，再裁掉兩端」，出發點由曲線
   自己決定，所以結構上不可能交叉。這個測試就是把那個「結構上不可能」
   釘住：出發角度必須隨 spread 單調變化。

   以後有人調 MAX_DEPART_ANGLE、MAX_HANDLE_LEN 或改寫曲線公式，
   只要又把出發點和彎曲拆成兩套算法，這裡就會紅。 */

const test = require("node:test");
const assert = require("node:assert");
const { loadApp } = require("./helpers/load-app.js");

const app = loadApp();

const rect = (x, y, w, h) => ({ left: x, top: y, right: x + w, bottom: y + h, w: w, h: h });

/* 曲線的出發方向：第一個控制點相對於起點的角度，
   量成「相對於兩節點中心連線」的偏角。 */
function departAngle(curve, from, to) {
  const cFrom = { x: (from.left + from.right) / 2, y: (from.top + from.bottom) / 2 };
  const cTo = { x: (to.left + to.right) / 2, y: (to.top + to.bottom) / 2 };
  const baseline = Math.atan2(cTo.y - cFrom.y, cTo.x - cFrom.x);
  const dep = Math.atan2(curve[1].y - curve[0].y, curve[1].x - curve[0].x);
  let d = dep - baseline;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

const LAYOUTS = [
  ["水平", rect(0, 0, 200, 80), rect(600, 0, 200, 80)],
  ["垂直", rect(0, 0, 200, 80), rect(0, 500, 200, 80)],
  ["右下斜", rect(0, 0, 200, 80), rect(500, 400, 200, 80)],
  ["左上斜", rect(500, 400, 200, 80), rect(0, 0, 200, 80)],
  ["很近", rect(0, 0, 200, 80), rect(260, 30, 200, 80)],
  ["很遠", rect(0, 0, 200, 80), rect(4000, 3000, 200, 80)]
];

const SPREADS = [-1, -0.6, -0.2, 0, 0.2, 0.6, 1];

test("同一對節點的多條線，出發角度隨 spread 單調變化", function() {
  LAYOUTS.forEach(function(entry) {
    const name = entry[0], a = entry[1], b = entry[2];
    const angles = SPREADS.map(function(s) {
      const curve = app.buildEdgeCurve(a, b, s);
      assert.ok(curve, name + "：spread=" + s + " 應該畫得出曲線");
      return departAngle(curve, a, b);
    });

    for (let i = 1; i < angles.length; i++) {
      assert.ok(angles[i] > angles[i - 1],
        name + "：spread " + SPREADS[i - 1] + " → " + SPREADS[i] +
        " 的出發角度必須遞增（實得 " + angles[i - 1].toFixed(4) + " → " + angles[i].toFixed(4) + "）。" +
        "不單調就代表出發點與彎曲方向又被拆成兩套算法了，線會在中段交叉。");
    }
  });
});

test("spread=0 的線是直的（出發角度為 0）", function() {
  LAYOUTS.forEach(function(entry) {
    const curve = app.buildEdgeCurve(entry[1], entry[2], 0);
    assert.ok(Math.abs(departAngle(curve, entry[1], entry[2])) < 1e-9,
      entry[0] + "：spread=0 不該偏向任何一邊");
  });
});

test("正負 spread 彎向相反", function() {
  /* 只斷言「方向相反」，不斷言「等大」。

     控制點確實是對稱的（見 buildEdgeCurve 裡那兩行旋轉），但曲線是
     「先畫完整的中心到中心曲線，再裁掉節點內部那一段」，裁切點落在
     矩形邊框上——斜向時 +s 與 -s 會從邊框的不同位置穿出去，裁切後的
     出發角度因此不會完全等大。那是矩形的幾何性質，不是 bug。 */
  LAYOUTS.forEach(function(entry) {
    [0.2, 0.6, 1].forEach(function(s) {
      const plus = departAngle(app.buildEdgeCurve(entry[1], entry[2], s), entry[1], entry[2]);
      const minus = departAngle(app.buildEdgeCurve(entry[1], entry[2], -s), entry[1], entry[2]);
      assert.ok(plus > 0 && minus < 0,
        entry[0] + "：spread=±" + s + " 應該彎向相反（實得 " +
        plus.toFixed(6) + " / " + minus.toFixed(6) + "）");
    });
  });
});

test("曲線的兩端落在節點邊框上，不會穿進節點內部", function() {
  const inside = (p, r) => p.x > r.left + 1 && p.x < r.right - 1 &&
                           p.y > r.top + 1 && p.y < r.bottom - 1;
  LAYOUTS.forEach(function(entry) {
    SPREADS.forEach(function(s) {
      const c = app.buildEdgeCurve(entry[1], entry[2], s);
      assert.ok(!inside(c[0], entry[1]), entry[0] + " spread=" + s + "：起點不該在來源節點內部");
      assert.ok(!inside(c[3], entry[2]), entry[0] + " spread=" + s + "：終點不該在目標節點內部");
    });
  });
});

test("兩個節點重疊到沒有可畫的區段時，回傳 null 而不是壞掉的曲線", function() {
  const a = rect(0, 0, 200, 80);
  const b = rect(0, 0, 200, 80);        // 完全重疊
  assert.strictEqual(app.buildEdgeCurve(a, b, 0), null);
});
