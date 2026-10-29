/**
 * 万象阁 · 角色筛选步（单元 13 · 学工作流 tasks[1] 的位置：把“判在场”从代码词表换成模型）
 *
 * 只干一件事：给一份名单 + 最近正文 ⇒ 谁此刻还能跟「我」互动、谁走了（带缘由）。
 * ⛔ 不写库、⛔ 不判别的格；失败就 ok:false，主流程回落词表兜底。
 */

import { callModelJson } from './apiclient.js';
import { trimText } from './utils.js';

export const SCREEN_SYSTEM = [
    '你是世界推演的“在场筛选”一步，只输出 JSON。',
    '判据：**此刻还能跟「我」互动的人**（同一空间、看得见、听得见、能立刻回应）。',
    '· 走了的（出了门／回家了／在别处／视线被隔断）**不列**——哪怕这一句正文里刚提到他的名字。',
    '· 这一轮正文里刚回来的、刚出现的，**必须列进去**。',
    '· 只列名字，⛔ 不含「我」；⛔ 不要解释。',
    '只输出 JSON：{"onStageList":["名字"],"leftList":[{"name":"名字","reason":"为什么不在场"}]}',
].join('\n');

/**
 * @param {{recentText:string, names:string[]}} input
 * @returns {Promise<{ok:boolean, onStageList?:string[], leftList?:Array<{name:string,reason:string}>, reason?:string}>}
 */
export async function screenOnStage(input) {
    const recent = String((input && input.recentText) || '').slice(-2000);
    const names = (Array.isArray(input && input.names) ? input.names : []).map((x) => trimText(x)).filter(Boolean).slice(0, 40);
    if (!recent || !names.length) {
        return { ok: false, reason: '没有可筛的正文或名单' };
    }
    const res = await callModelJson({
        system: SCREEN_SYSTEM,
        prompt: '名单：' + names.join('、') + '\n\n最近正文：\n' + recent,
        maxTokens: 300,
        cheap: true,
    });
    if (!res || !res.ok) {
        return { ok: false, reason: (res && res.reason) || '筛选步没回可用 JSON' };
    }
    const v = res.value || {};
    const onStageList = (Array.isArray(v.onStageList) ? v.onStageList : []).map((x) => trimText(x)).filter(Boolean);
    const leftList = (Array.isArray(v.leftList) ? v.leftList : [])
        .map((x) => ({ name: trimText(x && x.name), reason: trimText(x && x.reason) }))
        .filter((x) => x.name);
    if (!onStageList.length) {
        return { ok: false, reason: '筛选步给了空名单（回落词表）' };
    }
    return { ok: true, onStageList, leftList };
}
