/**
 * 万象阁 · 人物来源的口径与守卫（阿砚 4-b 最后 10 条 · ①）
 *
 * 依据＝4-b ①（名单与正文分离）：我们**已经是分开的**——
 *   人物来自 **账本**（`state.characters`，她认过的人）或 **世界书投影**（`peopleFromEntries`）；
 *   **⛔ 不从正文里正则回抽名字**（正文只作材料，见 `material.rawText`）。
 *
 * 但“分开”只有口头约定，缺一条可运行的守卫。这个模块把来源变成**有限集合**，
 * 让夹具能断言：任何人物的来源必须是这三种之一，且 `body` 不许出现在里面。
 */

export const SOURCES = ['ledger', 'book', 'manual'];

/** 允许的来源 → 人话 */
export const SOURCE_LABEL = {
    ledger: '账本里她认过的人',
    book: '世界书投影（只读回认人）',
    manual: '她手动加的',
};

/** 来源是不是合法（⛔ 'body'＝从正文抽，永远非法） */
export function isKnownSource(src) {
    return SOURCES.indexOf(String(src)) >= 0;
}

/**
 * 取一个人物的来源：显式标了就用标的，没标按“账本”算
 * （历史数据都在账本里，默认不会把正文算进来）。
 */
export function sourceOf(rec) {
    const raw = (rec && typeof rec === 'object') ? String(rec.from || '') : '';
    return isKnownSource(raw) ? raw : 'ledger';
}

/** 一行人话：各来源各有几个 */
export function sourceLine(list) {
    const arr = Array.isArray(list) ? list : [];
    const counts = {};
    for (const rec of arr) {
        const src = sourceOf(rec);
        counts[src] = (counts[src] || 0) + 1;
    }
    const parts = SOURCES.filter((s) => counts[s]).map((s) => SOURCE_LABEL[s] + ' ' + String(counts[s]));
    return '人物来源：' + (parts.length ? parts.join('／') : '空');
}
