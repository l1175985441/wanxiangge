/**
 * 万象阁 · 线索账（101 号；125 号删了三样，四本只剩这一本）
 *
 *    能不能发要过接触链（state.characters[].knows 里的 channel）；⛔ 没接触链不能凭空收到消息。
 * 线索 clues：六态机 新(new)→发展(developing)→触发(triggered)→余波(echoed)→解决(resolved)／废弃(discarded)，上限 480。
 *
 * 四本账都挂在聊天级 state 上，⛔ 不挂楼层。
 */

const CLUE_STATES = ['new', 'developing', 'triggered', 'echoed', 'resolved', 'discarded'];   /* 103：第六态 echoed（余波） */
const NEXT_STATE = {
    new: ['developing', 'discarded'],
    developing: ['triggered', 'discarded'],
    /* 103：触发后可先余波，也可直接结案（小事不必绕） */
    triggered: ['echoed', 'resolved', 'discarded'],
    /* 余波只能收束，⛔ 不许退回 triggered */
    echoed: ['resolved', 'discarded'],
    resolved: [],
    discarded: [],
};

/** 103：这条线还在跑吗（余波算未完；⛔ 写成“只有 developing／triggered 算未完”会漏掉余波） */
export function isClueOpen(clue) {
    const s = t(clue && clue.state);
    return Boolean(s) && s !== 'resolved' && s !== 'discarded';
}

const CLUE_CAP = 480;

function t(v) {
    return String(v == null ? '' : v).trim();
}

function ensureArr(st, key) {
    if (!Array.isArray(st[key])) {
        st[key] = [];
    }
    return st[key];
}

/* ───────── 4 线索六态机 ───────── */

/** 建线索（state 只许 new） */
export function upsertClue(state, clue) {
    const st = state || {};
    const list = ensureArr(st, 'clues');
    const title = t(clue && (clue.title || clue.name));
    if (!title) {
        return null;
    }
    const found = list.find((c) => t(c && c.title) === title);
    if (found) {
        return found;
    }
    const item = {
        id: 'cl' + (list.length + 1),
        title,
        state: 'new',
        owner: t(clue.owner),
        pointsTo: t(clue.pointsTo),
        fromFloor: Number(clue.fromFloor) || 0,
        resolvedAt: 0,
    };
    list.push(item);
    st.clues = list.slice(-CLUE_CAP);
    return item;
}

/** 推进一步（只能按六态机走，⛔ 不许跳级、⛔ 不许复活） */
export function advanceClue(state, title, next, at) {
    const st = state || {};
    const list = ensureArr(st, 'clues');
    const item = list.find((c) => t(c && c.title) === t(title));
    if (!item) {
        return { ok: false, reason: '没有这条线索' };
    }
    const target = t(next);
    if (!CLUE_STATES.includes(target)) {
        return { ok: false, reason: '不认识的线索状态：' + target };
    }
    if (!(NEXT_STATE[item.state] || []).includes(target)) {
        return { ok: false, reason: '六态机不许「' + item.state + ' → ' + target + '」' };
    }
    item.state = target;
    if (target === 'resolved' || target === 'discarded') {
        item.resolvedAt = Number(at) || Date.now();
    }
    return { ok: true, item };
}
