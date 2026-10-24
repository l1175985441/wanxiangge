/**
 * 万象阁 · 顺序表（阿砚第三批 C 档 P1 · C5）
 *
 * 依据＝C5「把‘为什么在这个位置’写成可核的表 ＋ 实参锚」；挡的风险：改序时没人知道踩了哪条不变量。
 *
 * 我们这条链上真正有“顺序意义”的是**注入块**：抬头 → 世界 → 人物 → 世界事件 → 风声。
 * 每一段的位置都有理由（见 why），而且每段都有“实参锚”（anchors）说明它在代码里由谁产生。
 *
 * 做法：
 *   1. `INJECT_ORDER` —— 一张表：id／why（为什么在这个位置）／anchors（实参锚：谁产出它）
 *   2. `checkOrder(ids)` —— 拿**实际发出的顺序**去核表：⛔ 少段（missing）／⛔ 乱序（outOfOrder）
 *   3. `recordInjectOrder(ids)` / `lastInjectOrder()` —— 每次组装都记一遍，面板与自测都能读
 */

/** 注入块顺序。改这个数组＝改协议，必须同时改 why 与 anchors（⛔ 只挪位置不写理由） */
export const INJECT_ORDER = [
    {
        id: 'header',
        why: '没有抬头，模型不知道这段是谁给的、该不该当真',
        anchors: ['recall.js: noteText(\'inject-header\')', 'settings.injectHeader'],
    },
    {
        id: 'world',
        why: '先定时空坐标（世界钟／地点／总览），后面的人物与事件才有“什么时候、在哪”的落点',
        anchors: ['recall.js: worldLines', 'state.world.clock', 'state.world.place', 'state.world.bigPicture'],
    },
    {
        id: 'people',
        why: '人物块紧跟世界之后：人是在这个时空里的人；且它按“谁更该被看见”排序（在场>最近>其他）',
        anchors: ['recall.js: blocks', 'recall.js: personBlock', 'state.characters'],
    },
    {
        id: 'events',
        why: '事件在世界与人物之后：它引用的是上面两段已给的坐标与人',
        anchors: ['recall.js: evBlocks', 'recall.js: eventBlock', 'state.events'],
    },
    {
        id: 'winds',
        why: '风声放最后：它是**未证实**的，放前面会被当成已公开事实（前面几段才是已核的）',
        anchors: ['recall.js: windRows', 'state.world.winds'],
    },
];

const ORDER_INDEX = new Map(INJECT_ORDER.map((x, i) => [x.id, i]));

/** 表里有哪些 id（顺序） */
export function orderIds() {
    return INJECT_ORDER.map((x) => x.id);
}

/**
 * 核顺序。
 * @param {string[]} ids 实际发出的块（按发出顺序）
 * @returns {{ok:boolean, missing:string[], outOfOrder:Array<{id:string,at:number,shouldBe:number}>, unknown:string[]}}
 */
export function checkOrder(ids) {
    const list = (Array.isArray(ids) ? ids : []).map((x) => String(x || '')).filter(Boolean);
    const unknown = list.filter((id) => !ORDER_INDEX.has(id));
    const outOfOrder = [];
    let last = -1;
    list.forEach((id, at) => {
        const idx = ORDER_INDEX.get(id);
        if (idx === undefined) { return; }
        if (idx < last) {
            outOfOrder.push({ id, at, shouldBe: last });
        } else {
            last = idx;
        }
    });
    /* 只要发了块，抬头就必须在（否则模型不知道这段是谁给的） */
    const missingHeader = list.length > 0 && !list.includes('header');
    return {
        ok: unknown.length === 0 && outOfOrder.length === 0 && !missingHeader,
        missing: missingHeader ? ['header'] : [],
        outOfOrder,
        unknown,
    };
}

let lastOrder = null;

/**
 * 记一次实际顺序（并当场核一遍）。
 * @returns {{ok:boolean, ids:string[], missing:string[], outOfOrder:Array, unknown:string[]}}
 */
export function recordInjectOrder(ids) {
    const list = (Array.isArray(ids) ? ids : []).map((x) => String(x || '')).filter(Boolean);
    const checked = checkOrder(list);
    lastOrder = { at: Date.now(), ids: list, ...checked };
    if (!checked.ok && typeof console !== 'undefined' && console.warn) {
        console.warn('[万象阁] 注入块顺序不对：' + JSON.stringify({ missing: checked.missing, outOfOrder: checked.outOfOrder, unknown: checked.unknown }));
    }
    return lastOrder;
}

/** 最近一次实际顺序（面板／诊断／自测读它） */
export function lastInjectOrder() {
    return lastOrder;
}

/** 给人看的一行 */
export function orderLine() {
    if (!lastOrder) { return '注入块顺序：还没组装过'; }
    if (lastOrder.ok) { return '注入块顺序：对（' + lastOrder.ids.join(' → ') + '）'; }
    return '注入块顺序：⚠ 不对（少 ' + String(lastOrder.missing.length)
        + ' 段／乱序 ' + String(lastOrder.outOfOrder.length) + ' 处）';
}
