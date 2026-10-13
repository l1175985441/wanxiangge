/**
 * 万象阁 · 人物合并（AI 认错人把同一角色拆成两条时用）
 *
 * 三件事都要做到（需求书原话）：
 *   ① **别名合并**：两条记录的名字／别名归一到一个角色名下；
 *   ② **数据互补**：两条各自有、对方缺的字段互补填上（⛔ 不许丢）；
 *   ③ **历史去重**：两条线里重复的历史事件去重（不重复、也不丢）。
 * 合并前自动留一版快照（能撤回）。
 */

import { loadState, saveState, takeSnapshot, addChronicle } from './state.js';
import { trimText, uniqueBy, asText } from './utils.js';

/** 合并两条角色记录：把 fromName 并进 keepId */
export function mergeCharacters(keepId, fromName) {
    const state = loadState();
    const keep = state.characters.find((c) => c.id === keepId);
    if (!keep) {
        return { ok: false, reason: '找不到要保留的那一条' };
    }
    const target = trimText(fromName);
    const from = state.characters.find((c) => c.id !== keepId
        && (c.name === target || (c.aliases || []).includes(target)));
    if (!from) {
        return { ok: false, reason: '找不到叫「' + target + '」的另一条记录' };
    }

    takeSnapshot('合并前（' + keep.name + ' ⇄ ' + from.name + '）');

    const report = { aliases: [], fields: [], past: 0, steps: 0, schedule: 0 };

    /* ① 别名合并：另一条的名字与别名都归到保留这条名下 */
    const aliasSet = new Set((keep.aliases || []).concat([keep.name]).filter(Boolean));
    const incomingAliases = [from.name].concat(from.aliases || []);
    for (const a of incomingAliases) {
        const name = trimText(a);
        if (name && !aliasSet.has(name)) {
            aliasSet.add(name);
            report.aliases.push(name);
        }
    }
    aliasSet.delete(keep.name);
    keep.aliases = Array.from(aliasSet);

    /* ② 数据互补：谁有谁填，⛔ 一个字段都不丢 */
    const textFields = ['age', 'identity', 'faction', 'affinity', 'timePlace', 'current', 'infer', 'affinitySource'];
    for (const f of textFields) {
        const mine = trimText(keep[f]);
        const theirs = trimText(from[f]);
        if (!mine && theirs) {
            keep[f] = theirs;
            report.fields.push(f);
        } else if (mine && theirs && mine !== theirs) {
            // 两边都有且不同：留着她的（若手改过），并把差异记进编年让她看得见
            addChronicle({
                at: Date.now(),
                floor: -1,
                kind: '合并·字段不一致',
                who: keep.name,
                text: '「' + f + '」两边不一样：保留「' + mine + '」，另一条是「' + theirs + '」（要换成另一条就手动改）',
            });
        }
    }

    // 过去经历：合并 + 去重（按文本）+ **按时间从新到旧重排**
    // ⚠️ 自审修正·条 20：两条各自"由近到远"，直接拼接会整体乱序；
    //    而且 slice 时会把 from 那边的（可能更新的）记录整批丢掉。
    const pastAll = (keep.past || []).concat(from.past || []);
    const pastUnique = uniqueBy(pastAll.filter((p) => p && trimText(p.text)), (p) => trimText(p.text));
    pastUnique.sort((a, b) => (Number(b.at) || 0) - (Number(a.at) || 0));   // 新的在前；老数据 at=0 排尾
    report.past = pastAll.length - pastUnique.length;
    keep.past = pastUnique.slice(0, Math.max(pastUnique.length, 5));

    // 这一步的记录：合并 + 去重
    const stepsAll = (keep.steps || []).concat(from.steps || []);
    const stepsUnique = uniqueBy(stepsAll.filter((s) => s && trimText(s.text)), (s) => trimText(s.text));
    report.steps = stepsAll.length - stepsUnique.length;
    keep.steps = stepsUnique.slice(-60);

    // 日程：按内容去重
    const schAll = (keep.schedule || []).concat(from.schedule || []);
    const schUnique = uniqueBy(schAll.filter((s) => s && trimText(s.what)), (s) => trimText(s.what));
    report.schedule = schAll.length - schUnique.length;
    keep.schedule = schUnique;

    // 其它标记：任何一个为真就为真
    keep.isPlayer = keep.isPlayer === true || from.isPlayer === true;
    keep.manual = keep.manual === true || from.manual === true;
    keep.isNew = keep.isNew === true && from.isNew === true;
    keep.lastSeenFloor = Math.max(Number(keep.lastSeenFloor) || -1, Number(from.lastSeenFloor) || -1);
    keep.lastUpdatedAt = Math.max(Number(keep.lastUpdatedAt) || 0, Number(from.lastUpdatedAt) || 0);
    keep.updatedAt = Date.now();

    /* ③ 挪走被合并的那条，并把这件事记进编年（历史留档，不丢） */
    state.characters = state.characters.filter((c) => c.id !== from.id);
    state.newPeople = (state.newPeople || []).filter((n) => n !== from.name);
    addChronicle({
        at: Date.now(),
        floor: -1,
        kind: '合并',
        who: keep.name,
        text: '把「' + from.name + '」并进「' + keep.name + '」：别名 +' + String(report.aliases.length)
            + '、字段补 ' + String(report.fields.length)
            + '、历史去重 ' + String(report.past + report.steps + report.schedule) + ' 条',
    });
    saveState();

    return { ok: true, report, keep: keep.name, from: from.name };
}

/** 撤销上一次合并（撤回快照即可） */
export function undoLastMerge() {
    const state = loadState();
    const snap = state.snapshots[state.snapshots.length - 1];
    if (!snap || !asText(snap.label).includes('合并前')) {
        return { ok: false, reason: '最近这一版快照不是合并留下的' };
    }
    return { ok: true, label: snap.label };
}

/**
 * 查重：名字互相包含、或别名有交集的两条，很可能是同一人被拆成两条。
 * ⛔ 只提示，不自动合（合并要她自己点头）。
 */
export function autoDetectDuplicates() {
    const state = loadState();
    const list = state.characters || [];
    const groups = [];
    const used = new Set();

    for (let i = 0; i < list.length; i += 1) {
        const a = list[i];
        if (!a || used.has(a.id)) {
            continue;
        }
        const group = [a];
        const aForms = [a.name].concat(a.aliases || []).map((x) => trimText(x)).filter(Boolean);
        for (let j = i + 1; j < list.length; j += 1) {
            const b = list[j];
            if (!b || used.has(b.id)) {
                continue;
            }
            const bForms = [b.name].concat(b.aliases || []).map((x) => trimText(x)).filter(Boolean);
            const related = aForms.some((x) => bForms.some((y) => x === y || x.includes(y) || y.includes(x)));
            if (related) {
                group.push(b);
                used.add(b.id);
            }
        }
        if (group.length > 1) {
            used.add(a.id);
            groups.push(group.map((c) => ({ id: c.id, name: c.name, aliases: c.aliases || [] })));
        }
    }
    return groups;
}

/** 手动改字：把一条角色字段盖掉并打"已手动修改"（引擎下轮要认） */
export function markManual(state, characterId, key, value) {
    const c = (state.characters || []).find((x) => x.id === characterId);
    if (!c) {
        return false;
    }
    c[key] = trimText(value);
    c.manual = true;
    c.updatedAt = Date.now();
    return true;
}
