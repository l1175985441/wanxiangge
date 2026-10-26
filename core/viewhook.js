/**
 * 86 号：**跑完要刷界面**（真机：状态页还写「还没跑过」、顶栏编年数停在旧值）。
 *   为何单开：`pipeline.js` 不能反向 import `actions.js`（成环），
 *   所以把“刷新回调”放在零依赖小件里。
 */

let refresher = null;
let scheduled = false;

/** 由 actions.js 注册 */
export function setViewRefresherHook(fn) {
    refresher = typeof fn === 'function' ? fn : null;
}

/** 尽快刷一次（同一 tick 内多次调用只刷一次） */
export function refreshViewsSoon() {
    if (!refresher || scheduled) {
        return;
    }
    scheduled = true;
    Promise.resolve().then(() => {
        scheduled = false;
        try {
            refresher();
        } catch (e) {
            /* 刷不出来也不影响主流程 */
        }
    });
}
