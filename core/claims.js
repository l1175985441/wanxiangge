/**
 * 万象阁 · 承诺必须为真（A 组 H6）
 *
 * 依据＝阿砚 A 组 H6：「覆盖类操作的“承诺必须为真”」。病：文案承诺的退路其实不存在（“空绿”）。
 *
 * 做法：把界面上**对她许过的诺**列成一张表（CLAIMS），每条写清「靠什么兑现」；
 *   夹具拿源码去核，兑不了就红。以后加一句“可以随时…”，先往这张表里加一行。
 *
 * ⛔ 这张表不是文档：`auditClaims()` 会被自测调用，缺一个兑现点就失败。
 */

/**
 * needs 里的每项都是"源码里必须同时出现的字样"（够土、但改不动也赖不掉）：
 *   · `file` 相对扩展根目录
 *   · `must` 必须出现的一个或多个片段（AND 关系）
 */
export const CLAIMS = [
    {
        id: 'cancel-anytime',
        promise: '跑中可随时取消',
        where: 'ui/sections.js（补推说明）',
        needs: [
            { file: 'ui/sections.js', must: ["button('\u53d6\u6d88\uff08\u6b63\u5728\u8dd1\uff09', 'cancel-update'"] },
            { file: 'ui/sections.js', must: ["case 'cancel-update'"] },
        ],
    },
    {
        id: 'backfill-resume',
        promise: '再点「补推历史」就能接着补',
        where: 'ui/sections.js（补推中断提示）',
        needs: [
            { file: 'core/pipeline.js', must: ['atFloor', 'backfilling'] },
            { file: 'ui/sections.js', must: ["button('\u8865\u63a8\u5386\u53f2', 'backfill')"] },
        ],
    },
    {
        id: 'snapshot-undo',
        promise: '能再撤回来（撤回前那一版也留着）',
        where: 'ui/sections.js（撤回回执）',
        needs: [
            { file: 'core/state.js', must: ['export function rollbackToSnapshot', 'export function listSnapshots'] },
            { file: 'ui/sections.js', must: ["button('\u4ece\u5feb\u7167\u6062\u590d', 'rollback')"] },
        ],
    },
    {
        id: 'auto-retry',
        promise: '链路掉线会自己接着补',
        where: 'ui/sections.js（自动重试提示）',
        needs: [
            { file: 'ui/sections.js', must: ['__wxgAutoRetry'] },
            { file: 'core/pipeline.js', must: ['\u5df2\u7ecf\u5728\u8dd1'] },
        ],
    },
    {
        id: 'save-honest',
        promise: '已存进聊天档（回读验证过） / 没存上会明说',
        where: 'core/adapter.js（storageReport）',
        needs: [
            { file: 'core/adapter.js', must: ['export function storageReport', 'lastSaveState'] },
            { file: 'core/ledger.js', must: ['storageReport'] },
        ],
    },
];

/**
 * 拿源码核这张表。
 * @param {(relPath:string)=>string} readFile 读文件的函数（夹具里用 fs，运行时谁也不必调）
 * @returns {{ok:boolean, missing:Array<{id:string,promise:string,file:string,need:string}>}}
 */
export function auditClaims(readFile) {
    const missing = [];
    for (const c of CLAIMS) {
        for (const n of (c.needs || [])) {
            let src = '';
            try {
                src = String(readFile(n.file) || '');
            } catch (e) {
                src = '';
            }
            for (const frag of (n.must || [])) {
                if (!src.includes(frag)) {
                    missing.push({ id: c.id, promise: c.promise, file: n.file, need: frag });
                }
            }
        }
    }
    return { ok: missing.length === 0, missing };
}
