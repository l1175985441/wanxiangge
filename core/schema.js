/**
 * 万象阁 · 账本 schema 收口（阿砚 1-c #2「迁移即 schema」）
 *
 * 依据＝1-c #2：`z.preprocess(migrateRaw, Shape)` ＋ **每处落盘前 `Schema.parse` 收口**。
 * 我们不用 zod（不引依赖），照它的精神做「读进来补缺、写出去前再核一遍」，
 * 但**关键差别**（上一轮踩出来的）：
 *
 *   ⛔ 不做「浅拷贝重建」——实测会把她的真账抹成空账（`world.clock` 直接没了，4 条真红）。
 *      原因：账本对象是**同一份活对象**，`Object.assign({}, raw)` 造出副本后，
 *      之前 `updateWorld` 之类的原地改动就与副本脱钩，随后的写盘把旧副本盖回去。
 *   ✅ 改成**就地补缺**：只在 `hasOwnProperty` 为假时补默认值、类型不对时换掉那一格，
 *      其余一律不动；每一次动手都记进 `repaired`。
 */

/** 账本顶层形状：缺了补默认、类型不对换掉那一格（⛔ 重建整本） */
const SHAPE = {
    version: 'number',
    characters: 'array',
    events: 'array',
    chronicle: 'array',
    snapshots: 'array',
    world: 'object',
    quests: 'array',
    hidden: 'array',
    newPeople: 'array',
    pipeline: 'object',
    lastUpdate: 'object',
};

const DEFAULTS = {
    version: 1,
    characters: [],
    events: [],
    chronicle: [],
    snapshots: [],
    world: {},
    quests: [],
    hidden: [],
    newPeople: [],
    pipeline: {},
    lastUpdate: {},
};

function typeOk(want, cur) {
    if (want === 'array') { return Array.isArray(cur); }
    if (want === 'object') { return !!cur && typeof cur === 'object' && !Array.isArray(cur); }
    return typeof cur === want;
}

function defaultFor(key) {
    return Array.isArray(DEFAULTS[key]) ? [] : Object.assign({}, DEFAULTS[key]);
}

/**
 * 就地补缺：**不返回新对象**，只改缺的/类型错的那几格。
 * @param {object} obj 账本对象（会被就地修改）
 * @returns {{repaired:string[], issues:string[]}}
 */
export function parseLedgerInPlace(obj) {
    const repaired = [];
    const issues = [];
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
        return { repaired, issues: ['账本不是对象（实际 ' + typeof obj + '）⇒ 这次跳过补缺，原样不动'] };
    }
    for (const [key, want] of Object.entries(SHAPE)) {
        const has = Object.prototype.hasOwnProperty.call(obj, key);
        if (!has) {
            obj[key] = defaultFor(key);
            repaired.push(key + '（缺，补默认）');
            continue;
        }
        if (!typeOk(want, obj[key])) {
            repaired.push(key + '（类型不对：' + (Array.isArray(obj[key]) ? 'array' : typeof obj[key]) + ' ⇒ 换回默认）');
            obj[key] = defaultFor(key);
        }
    }
    return { repaired, issues };
}

/** 按改名表搬家（就地；表空时是无害 no-op） */
export function applyRenamesInPlace(obj, rows) {
    const renamed = [];
    if (!obj || typeof obj !== 'object') { return renamed; }
    for (const row of (Array.isArray(rows) ? rows : [])) {
        if (!row || !row.from || !row.to) { continue; }
        if (!Object.prototype.hasOwnProperty.call(obj, row.from)) { continue; }
        if (!Object.prototype.hasOwnProperty.call(obj, row.to)) {
            obj[row.to] = obj[row.from];
        }
        delete obj[row.from];
        renamed.push(row.from + '→' + row.to);
    }
    return renamed;
}

/** 给人看的一行（体检/诊断用） */
export function schemaLine(report) {
    const r = report || {};
    const n = (r.repaired || []).length;
    const m = (r.issues || []).length;
    if (!n && !m) { return '账本形状：正常'; }
    return '账本形状：补/换 ' + String(n) + ' 处'
        + (m ? ('，另有 ' + String(m) + ' 个问题') : '')
        + (n ? ('（' + (r.repaired || []).slice(0, 3).join('；') + '）') : '');
}
