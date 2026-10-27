/**
 * 万象阁 · 世界钟「走钟」＋ 事件五键（100 号）
 *
 * 双轨：`world.clock` 文本照旧；新增 `world.clockMinute`（整数分钟、只增不减）。
 * 铁律照世界背面 1A/1B/1C：
 *   · 没绝对日期也持续存在，不许因为正文没写日期就重置
 *   · 「明天见／下周约」不是时间已跳；只把真正发生的等待／睡眠／路程／工作／明确转场计入
 *   · 模型没有权限初始化或重新校准绝对日期
 */

const PROMISE = /(明天见|明天再|下周|改天|三天后|回头见|约好|约定|说好)/;
const REAL_PASSAGE = /(睡|醒来|过了一夜|一夜过去|等了|等候|路上|赶路|坐车|开车|走了|工作|上班|上课|忙了|转场|到了)/;

function t(v) {
    return String(v == null ? '' : v).trim();
}

/** 文本钟 ⇄ 分钟（解析失败返回 null，⛔ 不瞎补） */
export function parseWorldClock(text) {
    const s = t(text);
    if (!s) {
        return null;
    }
    /* 支持「第N日 HH:MM」／「N日 HH:MM」／「HH:MM」三种 */
    let m = s.match(/第\s*(\d+)\s*日\s*(\d{1,2})[:：](\d{2})/);
    if (m) {
        return (Number(m[1]) - 1) * 1440 + Number(m[2]) * 60 + Number(m[3]);
    }
    m = s.match(/(\d+)\s*日\s*(\d{1,2})[:：](\d{2})/);
    if (m) {
        return (Number(m[1]) - 1) * 1440 + Number(m[2]) * 60 + Number(m[3]);
    }
    m = s.match(/(\d{1,2})[:：](\d{2})/);
    if (m) {
        return Number(m[1]) * 60 + Number(m[2]);
    }
    return null;
}

/** 分钟 → 文本（第 N 日 HH:MM） */
export function formatWorldClock(minute) {
    const n = Number(minute);
    if (!Number.isFinite(n) || n < 0) {
        return '';
    }
    const day = Math.floor(n / 1440) + 1;
    const hh = String(Math.floor((n % 1440) / 60)).padStart(2, '0');
    const mm = String(Math.floor(n % 60)).padStart(2, '0');
    return '第' + String(day) + '日 ' + hh + ':' + mm;
}

/**
 * 走钟（闸 3：未来承诺不算跳；闸 1：只增不减）
 * @returns {{before:number, after:number, added:number, reason:string}}
 */
export function addElapsed(state, minutes, bodyText) {
    const st = state || {};
    const w = st.world && typeof st.world === 'object' ? st.world : (st.world = {});
    const before = Math.max(0, Math.floor(Number(w.clockMinute) || 0));
    let add = Math.max(0, Math.floor(Number(minutes) || 0));
    let reason = '';
    const body = t(bodyText);
    if (add > 0 && PROMISE.test(body) && !REAL_PASSAGE.test(body)) {
        add = 0;
        reason = '正文只有未来承诺（明天／下周／约好…），没有真实经过 ⇒ elapsed 按 0 处理';
    }
    if (add < 0) {
        add = 0;
        reason = '负时长不认';
    }
    w.clockMinute = before + add;
    return { before, after: w.clockMinute, added: add, reason };
}

/** 闸 1：倒退拒收（调用方拿新值来比） */
export function acceptsClockMinute(oldMinute, newMinute) {
    const a = Number(oldMinute) || 0;
    const b = Number(newMinute);
    if (!Number.isFinite(b)) {
        return { ok: false, reason: '不是整数分钟' };
    }
    if (b < a) {
        return { ok: false, reason: '钟倒退了（' + b + ' < ' + a + '）⇒ 拒收并回滚' };
    }
    return { ok: true, reason: '' };
}

/** 闸 2：模型无权写绝对时间字段 */
export function stripModelDateFields(obj) {
    const v = obj && typeof obj === 'object' ? Object.assign({}, obj) : {};
    for (const k of ['clockMinute', 'clock_anchor', 'absoluteMinute', 'clock_absolute']) {
        if (Object.prototype.hasOwnProperty.call(v, k)) {
            delete v[k];
        }
    }
    return v;
}

const CHANNELS = ['physical', 'information', 'causal'];
const MODES = ['condition', 'duration', 'scheduled', 'active'];

/**
 * 事件五键归一（闸 6：causedBy 必须在账上；闸 7：trace 不许写“已证实”；闸 8：channels 白名单、剔玩家）
 * @param {object} s 模型给的 situation
 * @param {{nowMinute:number, existingIds:string[], playerName:string}} ctx
 */
export function normalizeSituation100(s, ctx) {
    const c = ctx || {};
    const src = s && typeof s === 'object' ? s : {};
    const out = Object.assign({}, src);
    const mode = t(src.clockMode || src.clock_mode);
    out.clockMode = MODES.includes(mode) ? mode : '';
    /* dueMinute 只由引擎算：duration 给分钟，scheduled 给 dueMinute 相对值 */
    if (out.clockMode === 'duration') {
        const dur = Math.max(1, Number(src.durationMinutes || src.duration_minutes) || 0);
        out.dueMinute = Math.max(0, Number(c.nowMinute) || 0) + dur;
    } else if (out.clockMode === 'scheduled') {
        const rel = Number(src.dueMinutesFromNow);
        out.dueMinute = Number.isFinite(rel) ? Math.max(0, (Number(c.nowMinute) || 0) + rel) : Number(src.dueMinute) || 0;
    } else {
        out.dueMinute = Number(src.dueMinute) || 0;
    }
    out.publicity = ['private', 'trace', 'public'].includes(t(src.publicity)) ? t(src.publicity) : 'private';
    out.publicTrace = out.publicity === 'private' ? '' : t(src.publicTrace || src.public_trace);
    if (out.publicity === 'trace' && /(已确认|已证实|证实了|确认属实)/.test(out.publicTrace)) {
        return { ok: false, reason: 'trace 不能写成已证实：' + out.publicTrace };
    }
    const ids = new Set((Array.isArray(c.existingIds) ? c.existingIds : []).map(t));
    const causedBy = (Array.isArray(src.causedBy) ? src.causedBy : (Array.isArray(src.caused_by) ? src.caused_by : [])).map(t).filter(Boolean);
    for (const id of causedBy) {
        if (!ids.has(id)) {
            return { ok: false, reason: 'causedBy 指向账上没有的 id：' + id };
        }
    }
    out.causedBy = causedBy;
    const impacts = [];
    for (const im of (Array.isArray(src.impacts) ? src.impacts : (Array.isArray(src.impact_records) ? src.impact_records : []))) {
        const channels = (Array.isArray(im && im.channels) ? im.channels : []).map(t).filter(Boolean);
        for (const ch of channels) {
            if (!CHANNELS.includes(ch)) {
                return { ok: false, reason: '波及渠道只能是 physical／information／causal，收到：' + ch };
            }
        }
        const personIds = (Array.isArray(im && im.personIds) ? im.personIds : []).map(t)
            .filter((x) => x && x !== t(c.playerName));
        impacts.push({ summary: t(im && im.summary), personIds, scopes: (Array.isArray(im && im.scopes) ? im.scopes : []).map(t), channels });
    }
    out.impacts = impacts;
    return { ok: true, value: out };
}

/** 闸 4：condition 未满足只能 waiting；到了 due 才准下一步 */
export function nextSituationStatus(s, conditionMet) {
    const it = s || {};
    const now = Number(it.dueMinute) || 0;
    if (it.clockMode === 'condition' && conditionMet !== true) {
        return 'waiting';
    }
    if (it.clockMode === 'condition' && conditionMet === true) {
        return 'ready';
    }
    if (now > 0 && now <= (Number(it._nowMinute) || 0)) {
        return 'ready';
    }
    return 'waiting';
}

/** 闸 5：到期后连续 N 轮没结果 ⇒ 强制要结果（N 由设置给，默认 3） */
export function hangingSituationIds(situations, roundNo, rounds) {
    const limit = Math.max(1, Math.floor(Number(rounds) || 3));
    const out = [];
    for (const s of (Array.isArray(situations) ? situations : [])) {
        if (!s || !Number.isFinite(Number(s.dueMinute))) {
            continue;
        }
        const since = Number(s.readyRound);
        if (Number.isFinite(since) && since > 0 && (Number(roundNo) || 0) - since >= limit) {
            out.push(s);
        }
    }
    return out;
}
