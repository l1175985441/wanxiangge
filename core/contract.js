/**
 * 万象阁 · 契约层：显式拒收已退休字段（阿砚第三批 C 档 P1 · C6）
 *
 * 依据＝C6「契约层显式拒收已退休字段（`denied`）」；挡的风险：**删字段只删一半**——
 *   引擎不再写它，但契约还照收 ⇒ 旧值被一路带着走、谁也说不清它算不算数。
 *
 * 我们的坑：硬-1 选了「旧形永远合法」路线，`normalizeCharacter` 现在**保留不认识的字段**（这是对的），
 *   于是“退休字段”和“未来字段”长得一模一样。这一层把两者分开：
 *     · 不认识的、也没退休的 ⇒ **保留**（未来字段，硬-1 要求）
 *     · 在 `RETIRED_FIELDS` 名单里的 ⇒ **删掉并记一笔**（⛔ 静默带着走）
 *
 * 目前名单是空的——我们从 0.3.x 到现在**没有真退休过字段**；
 * 一旦哪天删字段，往表里加一行，这条链就自动生效，⛔ 再去各处手写 if。
 */

/** 已退休字段（现在是空的：没有历史退休，不编假条目来凑） */
export const RETIRED_FIELDS = [
    /* { name: '旧字段名', retiredAt: '0.x.y', why: '为什么退休' } */
];

/** 这个字段退休了吗 */
export function isRetired(field) {
    const f = String(field == null ? '' : field);
    return RETIRED_FIELDS.some((r) => r && r.name === f);
}

/**
 * 把一个对象里的退休字段删掉，并把删了什么记在对象上（`contractDenied`）。
 * ⛔ 删“不认识但没退休”的字段；⛔ 抛错。
 * @returns {{dropped:string[]}}
 */
export function applyRetired(obj, table) {
    const target = (obj && typeof obj === 'object') ? obj : null;
    if (!target) { return { dropped: [] }; }
    const rows = Array.isArray(table) ? table : RETIRED_FIELDS;
    const names = rows.map((r) => r && r.name).filter(Boolean);
    if (!names.length) { return { dropped: [] }; }
    const dropped = [];
    for (const n of names) {
        if (Object.prototype.hasOwnProperty.call(target, n)) {
            delete target[n];
            dropped.push(n);
        }
    }
    if (dropped.length) {
        const log = Array.isArray(target.contractDenied) ? target.contractDenied : [];
        for (const n of dropped) {
            log.push({ field: n, at: Date.now() });
        }
        /* 只留最近 10 条，⛔ 无限攒 */
        target.contractDenied = log.slice(-10);
    }
    return { dropped };
}

/** 表校验（以后谁加行写歪了能当场发现） */
export function validateRetiredTable(table) {
    const rows = Array.isArray(table) ? table : RETIRED_FIELDS;
    const bad = [];
    rows.forEach((r, i) => {
        const ok = r && typeof r === 'object' && typeof r.name === 'string' && r.name.trim();
        if (!ok) { bad.push(i); }
    });
    const names = rows.map((r) => r && r.name).filter(Boolean);
    const dup = names.filter((n, i) => names.indexOf(n) !== i);
    return { bad, dup };
}

/** 给人看的一行 */
export function contractLine(obj) {
    const log = (obj && Array.isArray(obj.contractDenied)) ? obj.contractDenied : [];
    if (!log.length) { return '契约：没有拒收过退休字段'; }
    return '契约：拒收过 ' + String(log.length) + ' 次（最近：' + String(log[log.length - 1].field) + '）';
}
