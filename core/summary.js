/**
 * 万象阁 · 状态摘要（小框与工作台顶栏**共用一份**）
 *
 * 为什么要单独一个文件：小框、工作台顶栏、面板状态条都要"现在什么情况"，
 * ⛔ 各算一套迟早对不上（数字互相矛盾比没数字更糟）。所以只在这里算，别处只管显示。
 */

import { loadState, getRoster } from './state.js';
import { trimText } from './utils.js';
import { isLineDue } from './clock.js';

/** 任务统计：主线/支线各几条（活跃/完成/搁置） */
export function questStats(list) {
    const out = { main: 0, side: 0, active: 0, done: 0, shelved: 0, over: 0 };
    for (const q of Array.isArray(list) ? list : []) {
        if (!q) {
            continue;
        }
        if (trimText(q.kind) === 'main') {
            out.main += 1;
        } else {
            out.side += 1;
        }
        const st = trimText(q.status);
        if (st === '完成') {
            out.done += 1;
            out.over += 1;
        } else if (st === '搁置') {
            out.shelved += 1;
            out.over += 1;
        } else {
            out.active += 1;
        }
    }
    return out;
}

/**
 * 算一份"现在的状态"。
 * @param {object} [opts] { floor } —— 本回合锚点楼（算"本轮召回"用；不传就取最近一条记录）
 * @returns {object} 见下面 return 里的字段
 */
export function buildStateSummary(opts) {
    const o = opts || {};
    const state = loadState();
    const w = state.world || {};
    const roster = getRoster();
    const clock = trimText(w.clock);

    const hidden = Array.isArray(w.hidden) ? w.hidden : [];
    // 暗线：几条是"活着在走"的（没消散/没完成），其中几条**世界钟已经到点**该冒头了
    const live = hidden.filter((h) => h && !['消散', '完成'].includes(trimText(h.stage)));
    let due = 0;
    for (const h of live) {
        try {
            if (isLineDue(h, clock).due) {
                due += 1;
            }
        } catch (e) {
            // 单条算不出来不影响整体
        }
    }

    // 任务：一个人可能好几条 —— 分主线/支线统计
    let q = { main: 0, side: 0, active: 0, done: 0, shelved: 0, over: 0 };
    for (const c of roster) {
        const one = questStats(c.quests);
        for (const k of Object.keys(q)) {
            q[k] += one[k];
        }
    }

    // 本轮召回：优先按给定楼号找，找不到就取最近一条有记录的
    const records = Array.isArray(state.recallRecords) ? state.recallRecords : [];
    let rec = null;
    if (Number.isFinite(Number(o.floor))) {
        const want = Number(o.floor);
        for (const r of records) {
            if (r && Number(r.floor) === want) {
                rec = r;
            }
        }
    }
    if (!rec) {
        let best = -1;
        for (const r of records) {
            const at = Number((r && (r.injectedAt || r.at)) || 0);
            if (r && at > best) {
                best = at;
                rec = r;
            }
        }
    }

    const p = state.pipeline || {};
    return {
        clock: clock || '未知',
        place: trimText(w.place),
        situations: Array.isArray(w.situations) ? w.situations.length : 0,
        hidden: hidden.length,
        hiddenLive: live.length,
        hiddenDue: due,
        people: roster.length,
        players: roster.filter((c) => c && c.isPlayer).length,
        // 名册里"还只是名字、没推演过"的那几个（她有疑问时能一眼看出是谁没建档）
        peopleBlank: roster.filter((c) => c && !trimText(c.current)).length,
        quests: q,
        recall: {
            people: rec && Array.isArray(rec.chars) ? rec.chars.length : 0,
            events: rec && Array.isArray(rec.events) ? rec.events.length : 0,
            floor: rec && Number.isFinite(Number(rec.floor)) ? Number(rec.floor) : -1,
            status: rec ? trimText(rec.injectStatus) : '',
        },
        lastUpdate: {
            floor: state.lastUpdate && Number.isFinite(Number(state.lastUpdate.floor)) && Number(state.lastUpdate.floor) >= 0
                ? Number(state.lastUpdate.floor)
                : (Number.isFinite(Number(p.atFloor)) && Number(p.atFloor) >= 0 ? Number(p.atFloor) : -1),
            at: state.lastUpdate && Number(state.lastUpdate.at) ? Number(state.lastUpdate.at) : 0,
            status: trimText(p.status) || 'idle',
            error: trimText(p.error),
            text: trimText(p.text),
        },
        chronicle: Array.isArray(state.chronicle) ? state.chronicle.length : 0,
        snapshots: Array.isArray(state.snapshots) ? state.snapshots.length : 0,
    };
}

/**
 * 把摘要折成"小框／顶栏"用的一串短句（统一口径，⛔ 别处不要再自己拼）。
 * @param {object} s buildStateSummary 的结果
 * @param {object} [opts] { max } 最多几条
 */
export function summaryChips(s, opts) {
    const o = opts || {};
    const max = Number.isFinite(Number(o.max)) ? Number(o.max) : 6;
    const q = s.quests || {};
    const chips = [
        ['世界钟', s.clock],
        ['局势', String(s.situations)],
        ['暗线', s.hiddenDue ? (String(s.hiddenLive) + '（到点 ' + String(s.hiddenDue) + '）') : String(s.hiddenLive)],
        ['人物', String(s.people)],
        ['任务', '主 ' + String(q.main) + ' · 支 ' + String(q.side)],
        ['本轮召回', String(s.recall.people) + ' 人 ' + String(s.recall.events) + ' 事'],
    ];
    return chips.slice(0, max);
}

/** 小框／顶栏那一行短文字（失败优先，⛔ 不静默） */
export function summaryLine(s) {
    if (s.lastUpdate.status === 'failed') {
        return '更新失败：' + (s.lastUpdate.error || '看过程报告');
    }
    const q = s.quests || {};
    const bits = [
        s.clock,
        '暗线 ' + String(s.hiddenLive) + (s.hiddenDue ? '（到点 ' + String(s.hiddenDue) + '）' : ''),
        '人物 ' + String(s.people),
        '主 ' + String(q.main) + '/支 ' + String(q.side),
    ];
    return bits.join(' · ');
}
