/**
 * 万象阁 · 世界钟解析：**能解出“日期＋时段”才当锚**（阿砚第三批 · 决定①）
 *
 * 依据＝她第三批决定①：`#3 TimeSource` **只做 `world.clock` 一种**；
 *   `message_tag` 不建（她 2026-10-09 22:23 定过「正文不写具体时间点，时间只留卡链一个源」⇒ 正文里没有可读的时间点），
 *   `variable` 那 5 种域不建（我们没有楼层变量）。
 *   落法按 1-c 台账「下一批建议」第 2 条：对世界钟原文加解析器，
 *   **能解出「日期＋时段」才当锚用，否则退化为普通文本锚，⛔ 不改调度语义**。
 *
 * 注意：这一档**只解释文本、不产生时间**。⛔ 不推断、⛔ 不补默认、⛔ 不回退成“今天”。
 */

/** 时段词（先长后短匹配，避免“晚上”被“上”抢先） */
const PERIODS = [
    '凌晨', '清晨', '早上', '上午', '中午', '午后', '下午', '傍晚', '晚上', '夜里', '深夜', '半夜',
];

/** 日期说法：第 N 天／隔日／今天明天昨天／周几／X月Y日 */
const DAY_PATTERNS = [
    /第\s*[0-9一二三四五六七八九十百]+\s*天/,
    /[0-9一二三四五六七八九十百]+\s*月\s*[0-9一二三四五六七八九十百]+\s*[日号]/,
    /(今|明|昨|后|前)\s*[天日]/,
    /(周|星期)\s*[一二三四五六日天]/,
    /[0-9]{1,2}\s*[:：]\s*[0-9]{2}/,
];

/**
 * 解析世界钟原文。
 * @param {string} raw
 * @returns {{ok:true, day:string, period:string, norm:string} | {ok:false, why:string}}
 */
export function parseGameClock(raw) {
    const text = String(raw == null ? '' : raw).trim();
    if (!text) {
        return { ok: false, kind: 'empty', why: '世界钟是空的' };
    }
    let day = '';
    for (const re of DAY_PATTERNS) {
        const m = text.match(re);
        if (m) {
            day = m[0].replace(/\s+/g, '');
            break;
        }
    }
    let period = '';
    for (const p of PERIODS) {
        if (text.indexOf(p) >= 0) {
            period = p;
            break;
        }
    }
    /* 没有时段词但有具体时刻（14:30）⇒ 时刻自己就是时段 */
    if (!period) {
        const tm = text.match(/([0-9]{1,2})\s*[:：]\s*([0-9]{2})/);
        if (tm) {
            period = tm[1] + ':' + tm[2];
        }
    }
    if (!day && !period) {
        return { ok: false, kind: 'no-parts', why: '既没有日期也没有时段' };
    }
    if (!day) {
        return { ok: false, kind: 'period-only', why: '只有时段，没有日期（当不成锚）' };
    }
    if (!period) {
        return { ok: false, kind: 'day-only', why: '只有日期，没有时段（当不成锚）' };
    }
    return { ok: true, day, period, norm: day + ' ' + period };
}

/**
 * 当锚用：解得出就是 `game-clock`，解不出**退化为普通文本锚**（⛔ 丢原文、⛔ 瞎猜）。
 * @param {string} raw
 * @returns {{kind:'game-clock'|'text', raw:string, norm?:string, day?:string, period?:string, why?:string}}
 */
export function clockAnchor(raw) {
    const text = String(raw == null ? '' : raw).trim();
    const parsed = parseGameClock(text);
    if (parsed.ok) {
        return { kind: 'game-clock', raw: text, norm: parsed.norm, day: parsed.day, period: parsed.period };
    }
    return { kind: 'text', raw: text, why: parsed.why, failKind: parsed.kind || 'unknown' };
}

/** 一行人话（诊断用） */
export function clockAnchorLine(anchor) {
    const a = anchor || {};
    if (a.kind === 'game-clock') {
        return '时间锚：游戏钟「' + String(a.norm) + '」';
    }
    /* 1-c #8：读不出来的说法**只由 describeTimeRawFailure 一处出**（⛔ 这里另写一套） */
    return '时间锚：' + describeTimeRawFailure(a.failKind, a.raw, 'health');
}

/*
 * 1-c #8（阿砚 62 号）：时间原文读不出来的话——以前“跳过原因”与“自检文案”
 *   各写各的，两套说法。现在只有这一个函数，按 `surface` 出不同粒度：
 *     · health：体检报告用的一句话（不带原文，⛔ 泄露正文）
 *     · hint：界面提示用的一句话（告诉她“现在退成什么了”）
 *     · log：诊断日志用（带原文前 40 字，但仍不进账）
 * @param {string} failKind empty|no-parts|period-only|day-only|unknown
 * @param {string} src 世界钟原文
 * @param {'health'|'hint'|'log'} surface
 */
export function describeTimeRawFailure(failKind, src, surface) {
    const k = String(failKind || 'unknown');
    const SHORT = {
        'empty': '世界钟还没填',
        'no-parts': '日期与时段都没读出来',
        'period-only': '只有时段、没有日期',
        'day-only': '只有日期、没有时段',
        'unknown': '格式没见过',
    };
    const short = SHORT[k] || SHORT.unknown;
    const s = String(surface || 'hint');
    if (s === 'log') {
        const raw = String(src == null ? '' : src).replace(/\s+/g, ' ').trim();
        const cut = raw.length > 40 ? (raw.slice(0, 40) + '…') : raw;
        return '时间原文没法当锚：' + short + '（原文：' + (cut || '（空）') + '）';
    }
    if (s === 'health') {
        return '世界钟原文读不出来（' + short + '）——本轮不推时间';
    }
    return '时间锚退成普通文本：' + short;
}
