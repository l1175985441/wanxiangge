/**
 * 万象阁 · 人物合并（AI 认错人把同一角色拆成两条时用）
 *
 * 三件事都要做到（需求书原话）：
 *   ① **别名合并**：两条记录的名字／别名归一到一个角色名下；
 *   ② **数据互补**：两条各自有、对方缺的字段互补填上（⛔ 不许丢）；
 *   ③ **历史去重**：两条线里重复的历史事件去重（不重复、也不丢）。
 * 合并前自动留一版快照（能撤回）。
 */

import { loadState, saveState, takeSnapshot, addChronicle, LIMITS } from './state.js';
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

    const report = { aliases: [], fields: [], past: 0, steps: 0, schedule: 0, quests: 0 };

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
    const textFields = ['age', 'identity', 'faction', 'affinity', 'timePlace', 'current', 'affinitySource'];
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

    // 过去经历：合并 + 去重（按文本）+ **按时间从新到旧重排** + 超上限淡化进编年
    const pastAll = (keep.past || []).concat(from.past || []);
    const pastUnique = uniqueBy(pastAll.filter((p) => p && trimText(p.text)), (p) => trimText(p.text));
    pastUnique.sort((a, b) => (Number(b.at) || 0) - (Number(a.at) || 0));   // 新的在前；老数据 at=0 排尾
    report.past = pastAll.length - pastUnique.length;
    const pastCap = Number(LIMITS && LIMITS.capPast) > 0 ? Math.trunc(Number(LIMITS.capPast)) : 5;
    if (pastUnique.length > pastCap) {
        for (const f of pastUnique.slice(pastCap)) {
            state.chronicle.push({
                at: f.at || Date.now(),
                floor: Number.isFinite(Number(f.fromFloor)) ? Number(f.fromFloor) : keep.lastSeenFloor,
                kind: '过去经历·淡化',
                who: keep.name,
                text: trimText(f.text),
                manual: f.manual === true,
            });
        }
    }
    keep.past = pastUnique.slice(0, pastCap);

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

    // 任务（主线／支线）：按标题去重＋子项与备注互补（⛔ 不丢任务）
    const keepQuests = Array.isArray(keep.quests) ? keep.quests.filter((q) => q && trimText(q.title)) : [];
    const fromQuests = Array.isArray(from.quests) ? from.quests.filter((q) => q && trimText(q.title)) : [];
    const questMap = new Map();
    for (const q of keepQuests) {
        const key = trimText(q.title);
        questMap.set(key, Object.assign({}, q, {
            items: Array.isArray(q.items) ? q.items.slice() : [],
        }));
    }
    let questDupes = 0;
    for (const q of fromQuests) {
        const key = trimText(q.title);
        const existing = questMap.get(key);
        if (!existing) {
            questMap.set(key, Object.assign({}, q, {
                items: Array.isArray(q.items) ? q.items.slice() : [],
            }));
        } else {
            questDupes += 1;
            if (!trimText(existing.note) && trimText(q.note)) {
                existing.note = trimText(q.note);
            }
            if (trimText(q.kind) === 'main') {
                existing.kind = 'main';
            }
            const itemMap = new Map();
            for (const it of existing.items || []) {
                if (it && trimText(it.text)) {
                    itemMap.set(trimText(it.text), Object.assign({}, it));
                }
            }
            for (const it of q.items || []) {
                const itKey = trimText(it && it.text);
                if (!itKey) {
                    continue;
                }
                const oldIt = itemMap.get(itKey);
                if (!oldIt) {
                    itemMap.set(itKey, Object.assign({}, it));
                } else if (it.done === true) {
                    oldIt.done = true;
                }
            }
            existing.items = Array.from(itemMap.values());
            existing.manual = existing.manual === true || q.manual === true;
            existing.updatedAt = Math.max(Number(existing.updatedAt) || 0, Number(q.updatedAt) || 0);
        }
    }
    report.quests = questDupes;
    keep.quests = Array.from(questMap.values());

    // 其它标记：任何一个为真就为真
    keep.isPlayer = keep.isPlayer === true || from.isPlayer === true;
    keep.manual = keep.manual === true || from.manual === true;
    keep.isNew = keep.isNew === true && from.isNew === true;
    keep.lastSeenFloor = Math.max(Number(keep.lastSeenFloor) || -1, Number(from.lastSeenFloor) || -1);
    keep.lastUpdatedAt = Math.max(Number(keep.lastUpdatedAt) || 0, Number(from.lastUpdatedAt) || 0);
    /*
     * ⭐ 修复单 #18：**这三样也得并过去**（原来全漏 ⇒ 合并＝丢数据）。
     *   · `knows`（认知账）：按**那句话**去重后合并 —— 需求书「合并：数据互补＋历史去重，⛔ 不许丢」；
     *   · `manualFields`（哪几格是她手改过的）：**并集**（两边手改过的格都要继续受保护）；
     *   · `noBench`（关掉后台推演）：取**「与」**——只有两边都关了才算关
     *     （⛔ 别用「或」：那会因为一次合并就把这人悄悄踢出轮转，而她只关过其中一条）。
     */
    const knowMap = new Map();
    for (const k of [].concat(Array.isArray(keep.knows) ? keep.knows : [])
        .concat(Array.isArray(from.knows) ? from.knows : [])) {
        const txt = trimText(k && k.text);
        if (txt && !knowMap.has(txt)) {
            knowMap.set(txt, k);
        }
    }
    keep.knows = Array.from(knowMap.values());
    keep.manualFields = Array.from(new Set([]
        .concat(Array.isArray(keep.manualFields) ? keep.manualFields : [])
        .concat(Array.isArray(from.manualFields) ? from.manualFields : [])
        .map((x) => trimText(x))
        .filter(Boolean)));
    keep.noBench = keep.noBench === true && from.noBench === true;
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
            + '、历史去重 ' + String(report.past + report.steps + report.schedule + report.quests) + ' 条',
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
            /* ⭐修复 13：名字/别名包含匹配 ⇒ **双方均 ≥2 字**才算 ✓
             *   （旧：单字名也能互相包含 ✗ ⇒ “丽”这种乱撞 ✗ —— 她吃过这个亏 ✗） */
            let related = aForms.some((x) => bForms.some((y) => x === y
                || (x.length >= 2 && y.length >= 2 && (x.includes(y) || y.includes(x)))));
      /*
     * ⭐⭐ 她 [18]：「同一角色被拆成两条记录？**合并一键解决**」
     *   ⚠️ 真机取证：她名册里「水手月亮/水手水星…」还被当独立人物，
     *     而上面那个判法**只看名字互相包含** ⇒「水手月亮」与「月野兔」**互不包含** ⇒ **认不出来** ✗
     *   ⇒ 补一条**身份线**：某人的「身份」里写着另一人的名字（⛔ 反过来）⇒ 算同一人。
     *   ⚠️ 只认 **≥ 3 字** 的名字，⛔ 拿一个字去乱并（她吃过“美丽/丽”那种亏）。
     */
    if (!related) {
        const aId = trimText(a.identity);
        const bId = trimText(b.identity);
        /*
         * ⭐⭐ 修复 13（材料 02）：**身份里含对方名字 ≠ 同一个人** ✓
         *   病根：旧判法“只要身份包含对方名字就算同一人” ✗
         *     ⇒ **母女／情侣／师生**（身份写着“月野兔的母亲”这种 ✗）被当成重复 ✗
         *   新：① 身份里带**关系后缀**（的母亲／弟弟／朋友… ✓）⇒ **直接不认** ✓
         *        ② 否则：把身份**分词**，要求某一段**整段等于**那个名字（或 “变身形态：名字” ✓）才算 ✓
         *        （即：“水手月亮”归到“月野兔” ✓；“月野兔的母亲”**不**归 ✓）
         */
        const isIdentityAlias = (idText, forms) => {
            if (!idText || /的(?:母亲|妈妈|父亲|爸爸|弟弟|哥哥|姐姐|妹妹|女儿|儿子|朋友|老师|同学|宿敌|上司|下属|伙伴|搭档)/.test(idText)) {
                return false;
            }
            const parts = idText.split(/[\/／、,，｜|\s（）()]+/).map((s2) => s2.trim()).filter(Boolean);
            return forms.some((nm) => nm.length >= 2 && parts.some((p) => p === nm || p === '变身形态：' + nm));
        };
        if (isIdentityAlias(aId, bForms) || isIdentityAlias(bId, aForms)) {
            related = true;
        }
    }
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

/** 手动改字：把一条角色字段盖掉并打"已手动修改"（按字段记入 manualFields，引擎下轮只护这一格） */
export function markManual(state, characterId, key, value) {
    const c = (state.characters || []).find((x) => x.id === characterId);
    if (!c) {
        return false;
    }
    c[key] = trimText(value);
    c.manual = true;
    const fields = Array.isArray(c.manualFields) ? c.manualFields.slice() : [];
    if (key && !fields.includes(key)) {
        fields.push(key);
    }
    c.manualFields = fields;
    c.updatedAt = Date.now();
    return true;
}
