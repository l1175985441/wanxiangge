/**
 * 万象阁 · 角色筛选步（单元 13 · 学工作流 tasks[1] 的位置：把“判在场”从代码词表换成模型）
 *
 * 只干一件事：给名单（上次在场／上次后台）+ 最近正文 ⇒ 谁此刻能跟她互动、谁在哪、谁走了。
 * ⛔ 不写库、⛔ 判别的格；失败才 ok:false，主流程回落词表兜底。
 */

import { callModelJson } from './apiclient.js';
import { trimText } from './utils.js';

export const SCREEN_SYSTEM = [
    '你是世界推演的“在场筛选”一步，只输出 JSON。',
    '判据：**能不能立刻跟我现实互动**（同一空间／看得见／听得见／喊得应）。',
    '⛔ 只按“同一空间”判：出了这个空间、隔着门、在别处、只在电话里——都算不在场。',
    '⭐ 两侧都必须写：',
    '  · 在场的，写 `place`＝**他在哪**（“厨房”／“她身后”／“门口”）；',
    '  · 不在场的，写 `place`＝**去了哪**（“回房”／“出城”／“不知道”），并写 `reason`。',
    '⭐ 正文里刚回来、刚出现的，必须放进在场。',
    '⭐ 不在场的人里，只留**这一轮确实有事在办**的（在工作／在赶路／在跟人打交道／在查什么／在等结果）；',
    '  什么也没在办、只是“待着”的，⛔ 列进 leftList——他这一轮不用记。',
    '⭐ 不在场的人数**最多 10 个**；超了就留**事更紧**的，其余不列。',
    '只输出 JSON：{"onStageList":[{"name":"","place":""}],"leftList":[{"name":"","place":"","reason":""}]}',
].join('\n');

/**
 * @param {{recentText:string, onNames?:string[], offNames?:string[]}} input
 * @returns {Promise<{ok:boolean, onStageList?:Array<{name:string,place:string}>, leftList?:Array<{name:string,place:string,reason:string}>, cutList?:Array, empty?:boolean, reason?:string}>}
 */
export async function screenOnStage(input) {
    const recent = String((input && input.recentText) || '').slice(-2000);
    const onNames = (Array.isArray(input && input.onNames) ? input.onNames : []).map((x) => trimText(x)).filter(Boolean).slice(0, 40);
    const offNames = (Array.isArray(input && input.offNames) ? input.offNames : []).map((x) => trimText(x)).filter(Boolean).slice(0, 40);
    if (!recent) {
        return { ok: false, reason: '没有可筛的正文' };
    }
    if (!onNames.length && !offNames.length) {
        /* 129-D：名册里没有可筛的人＝无人在场（与笔 1 同一条语义），⛔ 算失败 */
        return { ok: true, onStageList: [], leftList: [], cutList: [], empty: true };
    }
    const prompt = '【上次在场的（先判这些还在不在）】\n' + (onNames.join('、') || '（无）')
        + '\n\n【上次后台的（除非正文里明确回来了，否则⛔ 列进在场）】\n' + (offNames.join('、') || '（无）')
        + '\n\n最近正文：\n' + recent;
    const res = await callModelJson({
        system: SCREEN_SYSTEM,
        prompt,
        maxTokens: 300,
        cheap: true,
    });
    if (!res || !res.ok) {
        return { ok: false, reason: (res && res.reason) || '筛选步没回可用 JSON' };
    }
    const v = res.value || {};
    if (!Array.isArray(v.onStageList)) {
        return { ok: false, reason: '筛选步没给 onStageList（回落词表）' };
    }
    const onStageList = (Array.isArray(v.onStageList) ? v.onStageList : [])
        .map((x) => (x && typeof x === 'object')
            ? { name: trimText(x.name), place: trimText(x.place) }
            : { name: trimText(x), place: '' })
        .filter((x) => x.name);
    /* 4：后台上限 10；超出的进 cutList 只用于记账 */
    const leftAll = (Array.isArray(v.leftList) ? v.leftList : [])
        .map((x) => (x && typeof x === 'object')
            ? { name: trimText(x.name), place: trimText(x.place), reason: trimText(x.reason) }
            : { name: trimText(x), place: '', reason: '' })
        .filter((x) => x.name);
    const leftList = leftAll.slice(0, 10);
    const cutList = leftAll.slice(10);
    if (!onStageList.length) {
        /* 1：空名单＝合法结果（她一个人待着）；⛔ 回落词表，只记一笔 */
        return { ok: true, onStageList: [], leftList, cutList, empty: true };
    }
    return { ok: true, onStageList, leftList, cutList };
}
