/**
 * 万象阁 · 四本小账（101 号 · 需求清单 3／4／6／5 的落码）
 *
 * 3 通讯 threads：{id, members[], kind: dm|group, messages[], lastAt}
 *    能不能发要过接触链（state.characters[].knows 里的 channel）；⛔ 没接触链不能凭空收到消息。
 * 4 线索 clues：四态机 新(new)→发展(developing)→触发(triggered)→解决(resolved)／废弃(discarded)，上限 480。
 * 6 回声 echoes：只从「已解决的事件」产生，上限 80，⛔ 不当第二条暗流用。
 * 5 舆情 opinion：话题倾向与热度，跟 publicity=public 咬合；私事⛔ 不上舆情。
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
const ECHO_CAP = 80;

function t(v) {
    return String(v == null ? '' : v).trim();
}

function ensureArr(st, key) {
    if (!Array.isArray(st[key])) {
        st[key] = [];
    }
    return st[key];
}

/* ───────── 3 通讯 ───────── */

/** 建一条会话（dm 或 group） */
export function createThread(state, members, kind) {
    const st = state || {};
    const list = ensureArr(st, 'threads');
    const ms = (Array.isArray(members) ? members : []).map(t).filter(Boolean);
    if (ms.length < 2) {
        return null;
    }
    const th = {
        id: 'th' + (list.length + 1) + '-' + Date.now().toString(36),
        members: ms,
        kind: kind === 'group' ? 'group' : 'dm',
        messages: [],
        lastAt: 0,
    };
    list.push(th);
    return th;
}

/**
 * 能不能把消息送到（接触链闸）
 * @param {object} state
 * @param {string} from
 * @param {string} to
 * @returns {{ok: boolean, channel: string, reason: string}}
 */
export function canSend(state, from, to) {
    const st = state || {};
    const a = t(from);
    const b = t(to);
    if (!a || !b) {
        return { ok: false, channel: '', reason: '收发人都要写' };
    }
    const people = Array.isArray(st.characters) ? st.characters : [];
    const sender = people.find((c) => t(c && c.name) === a);
    if (!sender) {
        return { ok: false, channel: '', reason: '发送方不在人物池' };
    }
    const knows = Array.isArray(sender.knows) ? sender.knows : [];
    const hit = knows.find((k) => k && (t(k.who) === b || t(k.text).indexOf(b) >= 0));
    const channel = t(hit && hit.channel);
    if (!channel) {
        return { ok: false, channel: '', reason: '没有接触链（⛔ 不能凭空收到消息）' };
    }
    return { ok: true, channel, reason: '' };
}

/** 往会话里追加一条（先过接触链） */
export function appendMessage(state, threadId, from, text, channel) {
    const st = state || {};
    const th = ensureArr(st, 'threads').find((x) => x && x.id === threadId);
    if (!th) {
        return { ok: false, reason: '没有这条会话' };
    }
    const to = (th.members || []).find((m) => m !== t(from));
    const gate = to ? canSend(st, from, to) : { ok: false, reason: '会话里没有对方' };
    if (!gate.ok) {
        return { ok: false, reason: gate.reason };
    }
    th.messages.push({ from: t(from), at: Date.now(), text: t(text), channel: t(channel) || gate.channel });
    th.messages = th.messages.slice(-200);
    th.lastAt = Date.now();
    return { ok: true, channel: gate.channel };
}

/* ───────── 4 线索四态机 ───────── */

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

/** 推进一步（只能按四态机走，⛔ 不许跳级、⛔ 不许复活） */
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
        return { ok: false, reason: '四态机不许「' + item.state + ' → ' + target + '」' };
    }
    item.state = target;
    if (target === 'resolved' || target === 'discarded') {
        item.resolvedAt = Number(at) || Date.now();
    }
    return { ok: true, item };
}

/* ───────── 6 回声 ───────── */

/** 事件解决才留回声（⛔ 不许当暗流用） */
export function addEcho(state, ev) {
    const st = state || {};
    const list = ensureArr(st, 'echoes');
    const eventId = t(ev && ev.eventId);
    const text = t(ev && ev.text);
    if (!eventId || !text) {
        return null;
    }
    if (ev && ev.resolved !== true) {
        return null;   /* 只收已解决的事件 */
    }
    const item = {
        eventId,
        text,
        affectedIds: (Array.isArray(ev.affectedIds) ? ev.affectedIds : []).map(t).filter(Boolean),
        heat: Math.max(0, Math.min(5, Number(ev.heat) || 1)),
        fromFloor: Number(ev.fromFloor) || 0,
    };
    list.unshift(item);
    st.echoes = list.slice(0, ECHO_CAP);
    return item;
}

/* ───────── 5 舆情 ───────── */

/** 话题进舆情：只收 publicity=public 的事件 */
export function upsertOpinion(state, topic) {
    const st = state || {};
    const list = ensureArr(st, 'opinion');
    const name = t(topic && topic.topic);
    if (!name) {
        return { ok: false, reason: '没有话题' };
    }
    if (t(topic && topic.publicity) !== 'public') {
        return { ok: false, reason: '私事⛔ 不上舆情（publicity 必须是 public）' };
    }
    const found = list.find((x) => t(x && x.topic) === name);
    const heat = Math.max(0, Math.min(5, Number(topic.heat) || 1));
    if (found) {
        found.stance = t(topic.stance) || found.stance;
        found.heat = heat;
        found.fromFloor = Number(topic.fromFloor) || found.fromFloor;
        return { ok: true, item: found };
    }
    const item = {
        topic: name,
        stance: t(topic.stance),
        heat,
        spreadBy: t(topic.spreadBy) || 'public_channel',
        fromFloor: Number(topic.fromFloor) || 0,
    };
    list.push(item);
    st.opinion = list.slice(-200);
    return { ok: true, item };
}
