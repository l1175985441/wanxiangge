/**
 * 万象阁 · 异步归属三件套（A 组 H2）
 *
 * 依据＝阿砚 A 组 H2：「await 前抓 owner ／ 每个 await 后验 ／ 唯一允许的“浅→全”」。
 * 挡的病：**晚到的旧读取把旧书 / 旧迁移写进新聊天**。
 *
 * 三件套落在这一处，别处⛔ 自己各写一遍：
 *   1. `captureOwner()`       —— 发请求/读盘**之前**先抓一次"我现在在哪个聊天"
 *   2. `stillOwner(owner)`    —— **每个 await 回来之后**先问一句"还是不是这本"
 *   3. `ownerChangedReason()` —— 变了就把话说清楚（⛔ 静默丢弃、也⛔ 硬写）
 *
 * 「唯一允许的浅→全」：只有**同一个聊天**里"先拿到浅信息（书单/条目名）再补全（条目正文）"
 * 允许，且每次补全前都要 `stillOwner()`；跨聊天一律不许。
 */

import { currentChatKey } from './adapter.js';

/** 抓归属：返回一个不可变的凭据（聊天标识 + 抓的时刻） */
export function captureOwner() {
    let key = '';
    try {
        key = String(currentChatKey() || '');
    } catch (e) {
        key = '';
    }
    return { key, at: Date.now() };
}

/** 还是不是这本？⛔ 抛错就算"不是"（宁可不写，也别写错档） */
export function stillOwner(owner) {
    if (!owner || typeof owner !== 'object') {
        return false;
    }
    try {
        return String(currentChatKey() || '') === String(owner.key || '');
    } catch (e) {
        return false;
    }
}

/** 变了的说法（给她看的人话，⛔ 技术词） */
export function ownerChangedReason(owner) {
    const from = owner && owner.key ? owner.key : '（未知）';
    let to = '（未知）';
    try {
        to = String(currentChatKey() || '（未知）');
    } catch (e) { }
    return '跑的过程中换了聊天（' + from + ' → ' + to + '）——这一批结果不敢写进新档，已作废';
}

/**
 * 三件套的收口用法：await 回来之后调它。
 * @returns {{ok:boolean, reason:string}}
 */
export function checkOwner(owner) {
    if (stillOwner(owner)) {
        return { ok: true, reason: '' };
    }
    return { ok: false, reason: ownerChangedReason(owner) };
}
