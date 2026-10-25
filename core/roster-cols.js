/**
 * 万象阁 · 名册列该显示哪几列（阿砚第三批 质感 A5）
 *
 * 依据＝A5：一屏 9 人，「势力」整列「—」，四列里三列空 ⇒ 空列要么删、要么给内容。
 * 我们的做法（两条一起）：
 *   ① **空列不占位**：整列都没值就把它藏掉（表头与单元格一起）；
 *   ② **好感列给内容**：`c.affinity` 空的时候去好感表里取（表里有数就显示，没有写 —）。
 * ⛔ 不写“暂无”一堆占位词，空就是 `—`。
 */

/** 好感表里这个人的值（表里没有就空串） */
export function affinityValueOf(state, name) {
    const key = String(name == null ? '' : name).trim();
    if (!key) {
        return '';
    }
    const rows = Array.isArray(state && state.affinityTable) ? state.affinityTable : [];
    const hit = rows.find((r) => r && String(r.name || '').trim() === key);
    if (!hit) {
        return '';
    }
    const v = String(hit.affinity == null ? '' : hit.affinity).trim();
    /* 「未建立」不是数，名册里照旧显示 —（⛔ 把状态词当数值列出来） */
    return /^-?\d+(?:\.\d+)?$/.test(v) ? v : '';
}

/** 一行的人话值：角色自带优先，其次好感表 */
export function rowAffinity(state, c) {
    const own = String((c && c.affinity) == null ? '' : c.affinity).trim();
    if (/^-?\d+(?:\.\d+)?$/.test(own)) {
        return own;
    }
    return affinityValueOf(state, c && c.name);
}

/**
 * 该显示哪几列。
 * @param {Array} rows 当前要画的那一屏（一般是整本名册，这样列不会翻页跳）
 * @param {object} state 账本（好感表在里面）
 * @returns {{showAff:boolean, showId:boolean, showFac:boolean, filled:number}}
 */
export function columnsFor(rows, state) {
    const list = Array.isArray(rows) ? rows : [];
    let aff = false;
    let id = false;
    let fac = false;
    for (const c of list) {
        if (!aff && rowAffinity(state, c)) {
            aff = true;
        }
        if (!id && String((c && c.identity) || '').trim()) {
            id = true;
        }
        if (!fac && String((c && c.faction) || '').trim()) {
            fac = true;
        }
        if (aff && id && fac) {
            break;
        }
    }
    let filled = 1;
    if (aff) { filled += 1; }
    if (id) { filled += 1; }
    if (fac) { filled += 1; }
    return { showAff: aff, showId: id, showFac: fac, filled };
}

/** 给人看的一行（诊断用） */
export function columnsLine(cols) {
    const c = cols || {};
    const names = ['角色名称'];
    if (c.showAff) { names.push('好感'); }
    if (c.showId) { names.push('身份'); }
    if (c.showFac) { names.push('势力'); }
    return '名册列：' + names.join('｜') + '（共 ' + String(names.length) + ' 列）';
}
