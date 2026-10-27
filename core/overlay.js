/**
 * 万象阁 · 用户覆盖层（阿砚第三批 硬-6）
 *
 * 依据＝硬-6「手改过的字段进覆盖层，重放/更新/演绎都不许覆盖它；并且永远不自动解锁」，
 *   他补的两条：① 覆盖层**分层**（哪些字段可锁、哪些跟着引擎走）② 锁上之后**能看见“这次本来要改成什么”**。
 *
 * 我们的病（改前）：`manualFields` 是个**永久锁**——锁了就再不接受任何自动更新，
 *   既没有分层（连引擎自己的字段也锁），也没有“看清楚再决定”的通道（只在 conflicts 里丢一句话，看不到具体值）。
 *
 * 这一层做三件事（⛔ 不碰界面、⛔ 不碰提示词）：
 *   1. 分层：`tierOf()` —— engine（引擎专有，⛔ 可锁）／locked（她锁住）／watch（观察，引擎照写但留痕）
 *   2. 待定通道：`notePending()` —— 锁住的格被引擎想改，把**想改成什么**记下来（带楼层/时间/来源）
 *   3. 处置：`acceptPending()`（采用引擎那版，锁**不解除**）／`dropPending()`（不用，锁照旧）
 */

import { trimText } from './utils.js';

/** 八格：她可以锁的字段（与 STATUS_MANUAL_KEYS 同源，这里独立声明避免循环依赖） */
export const LOCKABLE_FIELDS = ['age', 'identity', 'past', 'current', 'faction', 'affinity', 'timePlace'];

/**
 * 引擎专有字段：⛔ 让她锁（锁了引擎就残废）。
 * 这些字段的值由引擎算：在不在场、什么时候出现的、锁了哪些格、更新时间。
 */
export const ENGINE_FIELDS = [
    'id', 'name', 'aliases', 'role', 'isNew', 'presentFloor', 'lastSeenFloor', 'inScene',
    'relevance', 'manual', 'manualFields', 'watchFields', 'updatedAt', 'lastUpdatedAt',
    'knownFactKeys', 'knownEventIds', 'knownClueIds', 'knownFactBeliefs', 'overlayPending',
];

/** 这一格归谁 */
export function tierOf(character, field) {
    const f = trimText(field);
    if (!f) { return 'engine'; }
    if (ENGINE_FIELDS.includes(f)) { return 'engine'; }
    if (LOCKABLE_FIELDS.includes(f)) {
        const locked = Array.isArray(character && character.manualFields) ? character.manualFields : [];
        return locked.includes(f) ? 'locked' : 'watch';
    }
    return 'engine';
}

/** 这一格能不能被锁（界面用来决定是否显示“锁”按钮） */
export function canLock(field) {
    return LOCKABLE_FIELDS.includes(trimText(field));
}

const MAX_PENDING_PER_FIELD = 3;

/**
 * 引擎想改一个被锁住的格：把“它会改成什么”记下来，⛔ 静默丢弃。
 * @param {object} character 角色对象（原地改）
 * @param {string} field     字段名
 * @param {*} wouldBe        引擎想写成的值
 * @param {object} [meta]    {floor, why, from}
 */
export function notePending(character, field, wouldBe, meta) {
    if (!character || typeof character !== 'object') { return null; }
    const f = trimText(field);
    if (!f) { return null; }
    const list = Array.isArray(character.overlayPending) ? character.overlayPending : [];
    const entry = {
        field: f,
        wouldBe: wouldBe == null ? '' : String(wouldBe).slice(0, 200),
        at: Date.now(),
        floor: Number.isFinite(Number(meta && meta.floor)) ? Number(meta.floor) : -1,
        why: String((meta && meta.why) || ''),
        from: String((meta && meta.from) || 'engine'),
    };
    /* 同一格只留最近几条（⛔ 无限攒） */
    /* 同一格只留最近 3 条（不许无限攒）：多留几条是为了看出“引擎反复想改同一格” */
    const keep = list.filter((x) => x && x.field);
    keep.push(entry);
    const same = keep.filter((x) => x.field === f);
    while (same.length > MAX_PENDING_PER_FIELD) {
        const drop = same.shift();
        const idx = keep.indexOf(drop);
        if (idx >= 0) { keep.splice(idx, 1); }
    }
    character.overlayPending = keep;
    return entry;
}

/** 这个角色有没有待定（按时间新→旧） */
export function pendingOf(character) {
    const list = Array.isArray(character && character.overlayPending) ? character.overlayPending : [];
    return list.filter((x) => x && x.field).sort((a, b) => Number(b.at || 0) - Number(a.at || 0));
}

/** 拿某一格的待定 */
export function pendingFor(character, field) {
    const f = trimText(field);
    const list = Array.isArray(character && character.overlayPending) ? character.overlayPending : [];
    /* 按插入顺序取最后一条（同一毫秒写入时，靠 at 排序不可靠） */
    for (let i = list.length - 1; i >= 0; i -= 1) {
        if (list[i] && list[i].field === f) { return list[i]; }
    }
    return null;
}

/** 不用引擎那版（清掉这条待定；锁照旧） */
export function dropPending(character, field) {
    if (!character || !Array.isArray(character.overlayPending)) { return false; }
    const f = trimText(field);
    const before = character.overlayPending.length;
    character.overlayPending = character.overlayPending.filter((x) => x && x.field !== f);
    return character.overlayPending.length !== before;
}

/** 采用引擎那版：把值写进字段并清掉待定；**锁不解除**（她仍是主人） */
export function acceptPending(character, field) {
    const p = pendingFor(character, field);
    if (!p) { return { ok: false, reason: '没有这条待定' }; }
    character[p.field] = p.wouldBe;
    dropPending(character, p.field);
    character.updatedAt = Date.now();
    return { ok: true, field: p.field, value: p.wouldBe };
}

/** 给人看的一行（面板/诊断） */
export function pendingLine(character) {
    const list = pendingOf(character);
    if (!list.length) { return ''; }
    const p = list[0];
    return '引擎想改「' + p.field + '」为：' + String(p.wouldBe).slice(0, 30)
        + (list.length > 1 ? '（另有 ' + String(list.length - 1) + ' 条）' : '');
}
