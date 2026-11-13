# 回执 · 206 · 拆 sections.js 第一批

依据＝阿砚 206 号（含 206 补一条：判据 2 改口径）

## 一 · 15 个文件实际行数（与第四节逐个对）

| 新文件 | 函数 | 实际行数 | 表 | 差 |
|---|---|---:|---:|---:|
| `ui/panels/roster.js` | secRoster | 305 | 305 | 0 |
| `ui/panels/status.js` | secStatus | 155 | 155 | 0 |
| `ui/panels/report.js` | secReport | 182 | 182 | 0 |
| `ui/panels/steps.js` | secSteps | 209 | 209 | 0 |
| `ui/panels/world.js` | secWorld | 365 | 365 | 0 |
| `ui/panels/hidden.js` | secHidden | 88 | 88 | 0 |
| `ui/panels/brief.js` | secBrief | 75 | 75 | 0 |
| `ui/panels/chronicle.js` | secChronicle | 177 | 177 | 0 |
| `ui/panels/settings.js` | secSettings | 19 | 19 | 0 |
| `ui/panels/general.js` | secGeneral | 304 | 304 | 0 |
| `ui/panels/appearance.js` | secAppearance | 91 | 91 | 0 |
| `ui/panels/recall.js` | secRecall | 100 | 100 | 0 |
| `ui/panels/extract.js` | secExtract | 89 | 89 | 0 |
| `ui/panels/api.js` | secApi | 204 | 204 | 0 |
| `ui/panels/prompts.js` | secPrompts | 124 | 124 | 0 |

合计 2,487 行。

## 二 · 第七节 9 条判据

1. `ls ui/panels/` ⇒ **15 个文件**；行数见上表，逐个 ±0。
2. `ui/sections.js` ⇒ **5,600 行**（≤5,600）；比搬前 8,077 少 **2,477 行**（≥2,400）。
3. 15 个新文件都有 `export function secXxx`；逐个 `node --check` 通过。
4. `grep "export function sec" ui/sections.js` ⇒ **0 行**（`section` 已改成 `function section` + 末尾 `export { section };`）。
5. 16 个文件 `node --check` ⇒ **全部 0**。
6. 每个新文件 ≤5,200 行；最大 `world.js` 365 行。
7. 界面实测（假 DOM，真 `renderSections`/`bindSectionEvents`）：
   - 页签 **10 个**，顺序：人物名册／状态／世界局势／暗线／时局简报／编年／线索账／设置／自定义 API／提示词；
   - 10 个页签逐个点，**0 次抛错**；
   - 5 个按钮的接线仍在源码：`case 'save-*'` 4 处、`openPersonCard` 3 处、`openWorldEntryCard` 2 处、`case 'backfill'` 1 处、`case 'cancel-update'` 1 处。
   - ⚠️ 第 11／12 页（世界钟／变量）**本批没做**，页签仍只有现有 10 个；这是 206 单“先搬 15 个函数”的范围，不是漏搬。
8. `_自测/run-tests-人物层.mjs` **不存在**；改跑全套。
9. 全套：**170/170 套 · 1496 项 · 0 真失败**。

## 三 · 第八节两处

**判 1**：`sections.js:523-528` 那段「三页并一页」注释，**原样搬进 `status.js`**。它解释的就是这三块为什么长在一起，放在 `status.js` 里读着不别扭，反而正好贴着三个调用。

**判 2**：没有哪个小函数被复制多份。公共件（`el`／`section`／`card`／`button`／`row`／`line`／`field`／`checkbox`／`foldable`／`textInput`／`numberInput`／`textarea`／`select`／`emptyBlock`／`heroEmpty`／`colorInput`／`foldOpenState`，以及 `stage`／`stagedValue`／`saveBar` 和列表分页状态）仍然只有一份，留在 `sections.js`，由 panels 反向 import；没有新建 `ui/panels/shared.js`。

## 四 · 补一条要求的 helper 说明

**挪了 0 个 helper 到 `shared.js`。**

原因：这 15 个页面函数共用的是同一批 helper，而 helper 本身又依赖 `sections.js` 里的 `stagingByMode`、`stageModeOf`、`FOLD` 等状态；把它们抽出去会连带搬这些状态和它们的读写点，改动面比“搬 15 个函数”大一圈。当前做法是给 helper 加 `export`，panels 反向 import。

**代价说清**：`sections.js` 与 `ui/panels/*.js` 之间仍存在 import 环（sections 引 panels，panels 引 sections 的 helper/状态）。ESM 下这些是函数声明和调用期才读的 `let`，所以运行期没有 TDZ；全套 170/170 是通过的。但这属于“能跑、不干净”，下一批拆 `bindSectionEvents` 时应把 helper/状态抽到 `shared.js`，把这个环断掉。

## 五 · 连带改动

- `core/arch.js`：`ui/sections.js` 线改为 `soft 5200 / hard 5700`，注释改成 206 后的口径。
- `core/claims.js`：`cancel-update`／`backfill`／`rollback` 三条 `must` 的 `file` 从 `ui/sections.js` 改到 `ui/panels/general.js`；另外两条（`case 'cancel-update'`、`__wxgAutoRetry`）仍在 `sections.js`。
- 测试夹具：新增 `_自测/_ui-source.mjs`，把「读 sections.js 源码」的测试改成读 `sections.js + ui/panels/*.js`；这是搬家后的必然迁移，不是为迁就实得改断言。
- 没有动 CSS、class、id、DOM 层级、`section()` 标题、`bindSectionEvents`、`renderPersonCard`。

## 六 · 读数

```
ui/sections.js        5,600 行（搬前 8,077，-2,477）
ui/panels/            15 个文件，合计 2,487 行
全套                  170/170 套 · 1496 项 · 0 真失败
```
