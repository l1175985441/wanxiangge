/**
 * 万象阁 · 来源/引用完整性（阿砚第三批 硬-2）
 *
 * 依据＝硬-2「每条派生数据带‘从哪来’的指针＋指纹；用之前核一遍；核不过不许当事实用」。
 * 四家做法（事件计时器内容指纹／世界记忆引擎 auditRefs／世界背面 sourceKey+revision／观棋五层）
 * 压成我们这一版：**楼层指针 ＋ 原文指纹**，用之前重算一遍指纹。
 *
 * 病：现在只按 `mesId/floor` 对齐 ⇒ 她改一个字，旧记忆照旧生效；删一楼，后面全错位而账上不响。
 *
 * 这一层只做三件事（⛔ 不碰界面、不碰落书、不碰提示词）：
 *   1. `makeSource`   —— 记下「来自第几楼 ＋ 那楼原文的指纹」
 *   2. `sourceOk`     —— 拿**现在的**那楼原文重算指纹，对不上就是 stale
 *   3. `auditSources` —— 一次把账上带来源的条目全核一遍，给出 stale 清单（面板/自测都读它）
 */

/** FNV-1a 32 位：确定性、够发现"被改过"，不用于安全（与 bundle.js 同口径） */
export function digestOf(text) {
    let h = 0x811c9dc5;
    const s = String(text == null ? '' : text);
    for (let i = 0; i < s.length; i += 1) {
        h ^= s.charCodeAt(i);
        h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return ('0000000' + h.toString(16)).slice(-8);
}

/**
 * 造一个来源指针。
 * @param {{kind?:string, floor?:number, text?:string, title?:string}} p
 */
export function makeSource(p) {
    const o = p || {};
    const text = String(o.text == null ? '' : o.text);
    const floor = Number(o.floor);
    return {
        kind: String(o.kind || 'floor'),
        floor: Number.isFinite(floor) && floor >= 0 ? floor : -1,
        title: String(o.title || '').slice(0, 80),
        digest: digestOf(text),
        chars: Array.from(text).length,
        at: Date.now(),
    };
}

/** 这条来源还对得上吗？（拿"现在"的原文重算指纹） */
export function sourceOk(src, currentText) {
    if (!src || typeof src !== 'object') {
        return false;
    }
    if (!src.digest) {
        return false;
    }
    return digestOf(currentText) === String(src.digest);
}

/**
 * 把账上所有带 source 的条目核一遍。
 * @param {object} state 账本
 * @param {(floor:number)=>string} textAtFloor 取某一楼现在的原文
 * @returns {{checked:number, ok:number, stale:Array<object>}}
 */
export function auditSources(state, textAtFloor) {
    const st = state && typeof state === 'object' ? state : {};
    const getText = typeof textAtFloor === 'function' ? textAtFloor : () => '';
    let checked = 0;
    let ok = 0;
    const stale = [];
    const visit = (kind, list) => {
        for (const it of Array.isArray(list) ? list : []) {
            if (!it || !it.source) { continue; }
            checked += 1;
            const now = getText(Number(it.source.floor));
            if (sourceOk(it.source, now)) {
                ok += 1;
            } else {
                stale.push({
                    kind,
                    floor: Number(it.source.floor),
                    title: String(it.title || it.name || it.text || '').slice(0, 60),
                });
            }
        }
    };
    visit('situation', (st.world || {}).situations);
    visit('hidden', (st.world || {}).hidden);
    visit('chronicle', st.chronicle);
    return { checked, ok, stale };
}

/** 给一条派生数据盖章（已有来源就不覆盖） */
export function stampSource(item, p) {
    if (!item || typeof item !== 'object') { return item; }
    if (item.source && item.source.digest) { return item; }
    item.source = makeSource(p);
    return item;
}
