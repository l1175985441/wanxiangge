/**
 * 万象阁 · 世界钟 与 阶段推进
 *
 * ⭐ 铁律（需求书）：暗线**挂世界内时间／条件**，⛔ 不挂"回合数"。
 *    世界钟走到才推进，没到点不许提前冒头。
 *    理由（她的实例）：某角色本该"晚上"才出来打工——按"第 5 回合"推，
 *    出来时世界时间可能才早上。
 *
 * 这个文件只做"读钟 + 判断到没到点"，⛔ 不发请求、不写模型。
 */

import { STAGES_CONFLICT, STAGES_PROGRESS } from './config.js';
import { trimText } from './utils.js';

/** 一天里的时段（按中文词判；判不出来就返回空） */
const PERIODS = [
    { key: '凌晨', from: 0, to: 5 },
    { key: '早上', from: 5, to: 9 },
    { key: '上午', from: 9, to: 11 },
    { key: '中午', from: 11, to: 13 },
    { key: '下午', from: 13, to: 17 },
    { key: '傍晚', from: 17, to: 19 },
    { key: '晚上', from: 19, to: 23 },
    { key: '深夜', from: 23, to: 24 },
];

const CN_NUM = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };

/** 中文数字（十以内）转阿拉伯数字；转不了返回 null */
function cnToNum(text) {
    const s = trimText(text);
    if (!s) {
        return null;
    }
    if (/^\d+$/.test(s)) {
        return Number(s);
    }
    if (s === '十') {
        return 10;
    }
    if (/^十[一二三四五六七八九]$/.test(s)) {
        return 10 + CN_NUM[s[1]];
    }
    if (/^[一二三四五六七八九]十$/.test(s)) {
        return CN_NUM[s[0]] * 10;
    }
    if (Object.hasOwn(CN_NUM, s)) {
        return CN_NUM[s];
    }
    return null;
}

/**
 * 从一句"世界内时间"里读出结构：{ day, period, hour, minute, raw, has }
 * 读不出来就 has=false（⛔ 不猜、不拿占位值凑数）
 */
export function parseClock(text) {
    const raw = trimText(text);
    const out = { raw, has: false, day: null, period: '', hour: null, minute: null, minutesOfDay: null };
    if (!raw || raw === '未知') {
        return out;
    }

    // 第几天
    const dayMatch = raw.match(/第\s*([0-9]+|[零一二两三四五六七八九十]+)\s*[天日]/);
    if (dayMatch) {
        out.day = cnToNum(dayMatch[1]);
    } else if (/次[日天]|第二天/.test(raw)) {
        out.day = 2;
    } else if (/今天|当日|当天/.test(raw)) {
        out.day = 1;
    }

    // 时段词（先判，别被"八点半"这种干扰）
    for (const p of PERIODS) {
        if (raw.includes(p.key)) {
            out.period = p.key;
            break;
        }
    }
    if (!out.period && /(晨|清早|一早)/.test(raw)) {
        out.period = '早上';
    }
    if (!out.period && /(夜|晚)/.test(raw)) {
        out.period = '晚上';
    }

    // 几点几分：优先"X点Y分/半"（中文数字也认），再退到 HH:MM
    const cnNum = '零一二两三四五六七八九十';
    const dot = raw.match(new RegExp('([' + cnNum + '0-9]{1,3})\\s*[点時时]\\s*(半|([' + cnNum + '0-9]{1,3})\\s*分)?'));
    if (dot) {
        out.hour = cnToNum(dot[1]);
        if (dot[2] === '半') {
            out.minute = 30;
        } else if (dot[3]) {
            out.minute = cnToNum(dot[3]);
        } else {
            out.minute = 0;
        }
    } else {
        const hm = raw.match(/(\d{1,2})[:：](\d{1,2})/);
        if (hm) {
            out.hour = Number(hm[1]);
            out.minute = Number(hm[2]);
        }
    }

    // 中文时段 + 没说几点的（例："晚上"）⇒ 用时段起点当钟点
    if (out.hour === null && out.period) {
        const p = PERIODS.find((x) => x.key === out.period);
        if (p) {
            out.hour = p.from;
            out.minute = 0;
        }
    }

    // 下午/晚上的 1-11 点要顺成 24 小时制（例："晚上八点" ⇒ 20 点）
    if (out.hour !== null && out.period) {
        const pm = out.period === '下午' || out.period === '傍晚' || out.period === '晚上' || out.period === '深夜';
        if (pm && out.hour >= 1 && out.hour <= 11) {
            out.hour += 12;
        }
        if (out.period === '中午' && out.hour >= 1 && out.hour <= 2) {
            out.hour += 12;
        }
    }

    if (out.hour !== null && out.hour >= 0 && out.hour <= 24) {
        out.minutesOfDay = out.hour * 60 + (out.minute || 0);
        out.has = true;
    } else if (out.period) {
        const p = PERIODS.find((x) => x.key === out.period);
        out.minutesOfDay = (p ? p.from : 12) * 60;
        out.has = true;
    }

    return out;
}

/** 世界钟走了多远（分钟）——同一时间段内视角的"到点"判断用 */
export function clockDistance(fromText, toText) {
    const a = parseClock(fromText);
    const b = parseClock(toText);
    if (!a.has || !b.has) {
        return null;
    }
    const dayA = a.day === null ? 0 : a.day;
    const dayB = b.day === null ? dayA : b.day;
    const absA = dayA * 1440 + (a.minutesOfDay || 0);
    let absB = dayB * 1440 + (b.minutesOfDay || 0);
    if (absB < absA) {
        absB += 1440;   // 跨了一天（钟只给时段没给日期时）
    }
    return absB - absA;
}

/**
 * 这条暗线"到点了吗"——只看世界钟与它挂的条件，⛔ 不看回合数。
 * @returns {{due:boolean, why:string}}
 */
export function isLineDue(line, clockText) {
    const trigger = trimText(line && line.trigger);
    const clock = parseClock(clockText);
    if (!trigger) {
        // 没挂条件的：按火候给个保守节奏（近的快推、远的慢炖），但仍以钟为准
        const tier = trimText(line && line.tier);
        if (tier === '身边即时') {
            return { due: clock.has, why: clock.has ? '身边即时：钟在走就推' : '钟读不出来，先不推' };
        }
        if (tier === '长线大势') {
            const need = 3 * 1440;   // 大约三天
            const seen = Number(line && line.sinceMinutes) || 0;
            const passed = clock.has ? seen : 0;
            return { due: passed >= need, why: '长线大势：慢炖，还没到时候' };
        }
        return { due: clock.has, why: clock.has ? '几天内：钟在走就推' : '钟读不出来，先不推' };
    }

    // 挂"晚上""放学后""几天后"这类条件
    const t = trigger.replace(/\s+/g, '');
    if (!clock.has) {
        return { due: false, why: '世界钟读不出来（挂的条件是「' + trigger + '」），⛔ 不猜、不提前冒头' };
    }

    // "N 天后"类（也认"第三天""第五天"这种写法）
    const days = t.match(/(?:第)?([0-9]+|[零一二两三四五六七八九十]+)\s*[天日](?:后|之后|以后)?/);
    if (days && !/(放学|下课|天亮)/.test(t)) {
        const need = cnToNum(days[1]) || 1;
        const since = Number(line && line.sinceDay) || 1;
        const nowDay = clock.day === null ? 1 : clock.day;
        const passed = Math.max(0, nowDay - since);
        const ok = passed >= need - 1;
        return { due: ok, why: ok ? ('已经是第 ' + String(nowDay) + ' 天，到点了') : ('才第 ' + String(nowDay) + ' 天，还要等') };
    }

    // 时段类：条件的时段与现在的时段对上才算到点
    for (const p of PERIODS) {
        if (t.includes(p.key)) {
            const ok = clock.period === p.key;
            return { due: ok, why: ok ? ('钟走到「' + p.key + '」了') : ('现在是' + (clock.period || clock.raw) + '，还没到「' + p.key + '」') };
        }
    }
    if (/(放学|下课)/.test(t)) {
        const ok = clock.period === '下午' || clock.period === '傍晚' || clock.period === '晚上';
        return { due: ok, why: ok ? '钟走到放学后了' : '还没放学（现在' + (clock.period || clock.raw) + '）' };
    }
    if (/(天亮|清晨|早晨)/.test(t)) {
        const ok = clock.period === '早上' || clock.period === '上午';
        return { due: ok, why: ok ? '天亮了' : '天还没亮' };
    }
    if (/(夜里|深夜|半夜)/.test(t)) {
        const ok = clock.period === '深夜' || clock.period === '晚上';
        return { due: ok, why: ok ? '到夜里了' : '还没到夜里' };
    }
    if (/(明天|次日)/.test(t)) {
        const since = Number(line && line.sinceDay) || 1;
        const nowDay = clock.day === null ? 1 : clock.day;
        const ok = nowDay > since;
        return { due: ok, why: ok ? '到第二天了' : '还没到第二天' };
    }

    // 认不出来的条件：不推（⛔ 宁可不推，也不提前冒头）
    return { due: false, why: '条件「' + trigger + '」认不出来（可以改成"晚上""放学后""三天后"这类写法）' };
}

/** 阶段往下走一级（到头就停住，⛔ 不循环） */
export function nextStage(stage, kind) {
    const list = kind === 'progress' ? STAGES_PROGRESS : STAGES_CONFLICT;
    const idx = list.indexOf(trimText(stage));
    if (idx < 0) {
        return list[0];
    }
    return list[Math.min(list.length - 1, idx + 1)];
}

/** 这条线算走完了吗 */
export function isLineDone(stage) {
    const s = trimText(stage);
    return s === '消散' || s === '完成';
}

/** 世界钟"往回走"了吗（防倒退：新钟比旧钟早太多就判可疑） */
export function clockWentBackwards(oldText, newText) {
    const a = parseClock(oldText);
    const b = parseClock(newText);
    if (!a.has || !b.has || !trimText(newText) || trimText(newText) === '未知') {
        return false;
    }
    const dayA = a.day === null ? 1 : a.day;
    const dayB = b.day === null ? dayA : b.day;
    const absA = dayA * 1440 + (a.minutesOfDay || 0);
    const absB = dayB * 1440 + (b.minutesOfDay || 0);
    return absB < absA - 5;   // 少超过 5 分钟就算倒退（可能是模型瞎写）
}
