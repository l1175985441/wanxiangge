/* 公-4 片段：状态/名册/世界三个 ⋮ 菜单。从 sections.js 抽出（206 后） */
import { openFuncMenu } from './func-menu.js';


export const MENU_ACTION_SET = new Set(['world-func', 'status-func', 'roster-func']);


export function handleMenuAction(action, target, id, host, isChange, rerender) {
    switch (action) {
                case 'world-func': {
                    /* 材料 10 · 第 1 组裁定：真菜单（每项都是现成动作 ✓） */
                    openFuncMenu(target, [
                        { label: '立刻更新（重算世界账）', action: 'update-now' },
                        { label: '写入世界书', action: 'publish-book' },
                        { label: '对账（账与楼对齐）', action: 'reconcile' },
                        { label: '清空这个世界…', action: 'clear-world-open' },
                    ]);
                    break;
                }
                case 'status-func': {
                    /* 材料 10 · 第 1 组裁定：真菜单（每项都是现成动作 ✓） */
                    openFuncMenu(target, [
                        { label: '体检（跑一遍自检）', action: 'health-open' },
                        { label: '立刻更新（跑一轮）', action: 'update-now' },
                        { label: '补推历史（分批跑）', action: 'backfill' },
                        { label: '撤回上一次', action: 'rollback' },
                        { label: '导出备份（JSON）', action: 'export-data' },
                    ]);
                    break;
                }
                case 'roster-func': {
                    /* 材料 10 · 第 1 组裁定：真菜单（每项都是现成动作 ✓） */
                    openFuncMenu(target, [
                        { label: '查重（找出被拆成两条的）', action: 'detect-dupes' },
                        { label: '一键合并重复组', action: 'merge-all-dupes' },
                    ]);
                    break;
                }
                /* ---- 角色 ---- */
    /*
     * ⭐「清空这个世界」三步：铺开条数 → 她手打「确认清空」→ 才真清。
     *    ⛔ 打错字点不动；⛔ 只清账本，不碰世界书；⛔ 不静默（清完给回执）。
     */
                /* ---- 任务（主线／支线）：她也能改 ---- */
                /*
                 * ⭐ ST4-A：**这个 case 删掉了** ✓
                 *   它拦在 STAGE_MAP 前面把“人物并行封顶”**立即落盘** ✗
                 *   删掉后它会落到 `STAGE_MAP['stage-max-parallel'] = ['recall','maxParallelChars','value']` ✓
                 *   ⇒ 与同页其他格子一样走草稿 ✓（⛔ 再写一遍草稿代码 ✗）
                 */
                /* ---- 四格 ---- */
                /* ⭐ 先进草稿（等段底那颗「保存」一起存），⛔ 不再改一处存一处 */
                    break;
                    break;
                /* ---- API ---- */
                /* ---- 提示词 ---- */
                /* ---- 动作 ---- */
    }
}

