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
    // ⭐ "二十一"～"九十九"必须认（不认的话第 21-29 天的世界钟直接瘫痪、暗线时间表全停）
    if (/^[一二三四五六七八九]十[一二三四五六七八九]$/.test(s)) {
        return CN_NUM[s[0]] * 10 + CN_NUM[s[2]];
    }
    if (/^十[一二三四五六七八九]$/.test(s)) {
        return 10 + CN_NUM[s[1]];
    }
    if (/^[一二三四五六七八九]十$/.test(s)) {
        return CN_NUM[s[0]] * 10;
    }
    // "两十"这类怪写法不认（认了反而容易误判），交给上面几条
    if (/^[两]?[零一二三四五六七八九]{2,}$/.test(s)) {
        // 例："二一"（口语里偶见）＝21；仅在两位且都认识时才拼
        const a = CN_NUM[s[0]];
        const b = CN_NUM[s[1]];
        if (Number.isFinite(a) && Number.isFinite(b) && s.length === 2) {
            return a * 10 + b;
        }
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
    /*
     * ⭐⭐ S1（材料 05 的自查）：**日历日与“第N天”必须同一坐标** ✓
     *   旧（我 v0.3.128 落的）：1992-04-01 ⇒ `day = 8126`（距 1970 的天数 ✗）
     *     而“第一天” ⇒ `day = 1` ✗ ⇒ 两个坐标系混用 ✗✗
     *     场景：暗线建在“第一天”（sinceDay=1），下一轮读到 1992-04-01（nowDay=8126）
     *       ⇒ 8125 天 ⇒ **所有暗线与日程瞬间全部提前爆炸** ✗✗
     *   现在：日历日只写进 `ymd`（绝对值 ✓）；`day` 一律＝ ymd - epochDay + 1 ✓
     *     基准日 epochDay 取**第一次**读到的日历日 ✓（1992-04-02 ⇒ day=2 ✓）
     */
    let clockEpochDay = null;
    function absToRelativeDay(abs) {
        if (!Number.isFinite(abs)) {
            return null;
        }
        if (!Number.isFinite(clockEpochDay)) {
            clockEpochDay = abs;
        }
        return abs - clockEpochDay + 1;
    }
    const out = { raw, has: false, day: null, period: '', hour: null, minute: null, minutesOfDay: null };
    if (!raw || raw === '未知') {
        return out;
    }

    // 第几天（兼容：① 1992-04-01 / 1992/04/01 / 1992年4月1日；② 4月1日；③ 第N天）
    /* ⭐⭐ 修复 7（材料 02）：**世界钟认不出公历日期** ✗
     *   旧：只认“第N天 / 第二天 / 今天” ✗ ⇒ 卡面写 1992-04-01 时读不出来 ✗（时间线断掉 ✗）
     *   新：先认**年-月-日**（三种分隔符✓），再认**月日**（无年份时按 2000 年算天数 ✓），最后才回到“第N天” ✓ */
    const ymd = raw.match(/(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*日?/);
    const md = !ymd && raw.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]/);
    const dayMatch = raw.match(/第\s*([0-9]+|[零一二两三四五六七八九十]+)\s*[天日]/);
    if (ymd) {
        const utc = Date.UTC(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]));
        if (Number.isFinite(utc)) {
            out.ymd = Math.floor(utc / 86400000);   /* S1：绝对值单列 ✓ */
            out.day = absToRelativeDay(out.ymd);    /* S1：换成相对天 ✓ */
        }
    } else if (md) {
        const utc = Date.UTC(2000, Number(md[1]) - 1, Number(md[2]));
        if (Number.isFinite(utc)) {
            out.ymd = Math.floor(utc / 86400000);
            out.day = absToRelativeDay(out.ymd);
        }
    } else if (dayMatch) {
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

    // 有钟点但没写时段词（例："20:00"）⇒ 按 PERIODS 区间反推时段
    if (!out.period && out.hour !== null && out.hour >= 0 && out.hour <= 24) {
        const matched = PERIODS.find((x) => out.hour >= x.from && (out.hour < x.to || (x.to === 24 && out.hour === 24)));
        if (matched) {
            out.period = matched.key;
        }
    }

    if (out.hour !== null && out.hour >= 0 && out.hour <= 24) {
        out.minutesOfDay = out.hour * 60 + (out.minute || 0);
        out.has = true;
    } else if (out.period) {
        const p = PERIODS.find((x) => x.key === out.period);
        out.minutesOfDay = (p ? p.from : 12) * 60;
        out.has = true;
    } else if (out.day !== null) {
        /*
         * ⭐ 修复单 #15①：**"只说了第几天"也算读出来了**。
         *   例："第二天"／"次日"——她知道现在是哪一天，钟就是在走。
         *   原来没有这一支 ⇒ `has` 停在 false，下游（`isLineDue` / `sinceDay` 那些）
         *   一律当成"钟读不出来，先不推" ⇒ **那一整天什么都不推**。
         *   ⚠️ `minutesOfDay` 留 null（⛔ 不猜具体几点）；消费方都写了 `|| 0` / `!== null`，安全。
         */
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

/** 世界钟的绝对分钟（第 N 天 × 1440 ＋ 当天分钟）；读不出来返回 null */
function absoluteMinutes(clock) {
    if (!clock || !clock.has) {
        return null;
    }
    const day = clock.day === null ? 1 : clock.day;
    return day * 1440 + (clock.minutesOfDay || 0);
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
            // ⭐ 慢炖：按"世界钟走了多久"算，⛔ 不是数回合；起点记在建线那一刻
            const need = 3 * 1440;   // 大约三天
            const since = Number(line && line.sinceMinutes);
            const nowAbs = absoluteMinutes(clock);
            if (!clock.has || !Number.isFinite(since) || !Number.isFinite(nowAbs)) {
                return { due: false, why: '长线大势：世界钟或起点读不出来，先不推（⛔ 不猜）' };
            }
            const passed = Math.max(0, nowAbs - since);
            return {
                due: passed >= need,
                why: passed >= need
                    ? ('长线大势：钟走了 ' + String(Math.round(passed / 1440 * 10) / 10) + ' 天，到点了')
                    : ('长线大势：才走了 ' + String(Math.round(passed / 1440 * 10) / 10) + ' 天，慢炖中'),
            };
        }
        return { due: clock.has, why: clock.has ? '几天内：钟在走就推' : '钟读不出来，先不推' };
    }

    // 挂"晚上""放学后""几天后"这类条件
    const t = trigger.replace(/\s+/g, '');
    if (!clock.has) {
        return { due: false, why: '世界钟读不出来（挂的条件是「' + trigger + '」），⛔ 不猜、不提前冒头' };
    }

    // "N 天后"类（也认"第三天""第五天"这种写法）
    // ⭐ 口径：sinceDay＝**建线那天**；"3 天后"＝从建线那天再走 3 天（不是 2 天）
    const days = t.match(/(?:第)?([0-9]+|[零一二两三四五六七八九十]+)\s*[天日](?:后|之后|以后)?/);
    if (days && !/(放学|下课|天亮)/.test(t)) {
        const need = cnToNum(days[1]) || 1;
        const since = Number(line && line.sinceDay);
        const nowDay = clock.day === null ? 1 : clock.day;
        if (!Number.isFinite(since)) {
            return { due: false, why: '这条线没记下"从哪天起算"，⛔ 不猜（重建一次就会记上）' };
        }
        const passed = Math.max(0, nowDay - since);
        const ok = passed >= need;
        return {
            due: ok,
            why: ok
                ? ('建线第 ' + String(since) + ' 天，今天第 ' + String(nowDay) + ' 天，到点了')
                : ('建线第 ' + String(since) + ' 天，今天第 ' + String(nowDay) + ' 天，还要等 ' + String(need - passed) + ' 天'),
        };
    }

    // 时段类：条件的时段与现在的时段对上、或同日之内已越过目标时段，即算到点
    for (const p of PERIODS) {
        if (t.includes(p.key)) {
            const nowMin = clock.minutesOfDay !== null ? clock.minutesOfDay : -1;
            const sinceAbs = Number(line && line.sinceMinutes);
            const nowDay = clock.day === null ? 1 : clock.day;
            const sinceDay = Number.isFinite(Number(line && line.sinceDay))
                ? Number(line.sinceDay)
                : (Number.isFinite(sinceAbs) ? Math.floor(sinceAbs / 1440) : null);
            const sinceMinOfDay = Number.isFinite(sinceAbs) ? (sinceAbs % 1440) : null;
            // 同日内若建线时刻已晚于目标时段末尾，则需等次日，不算当日已越过
            const createdAfterTargetSameDay = sinceDay !== null && nowDay === sinceDay
                && sinceMinOfDay !== null && sinceMinOfDay >= p.to * 60;
            const passedSameDay = p.key !== '凌晨'
                && nowMin >= p.from * 60
                && !createdAfterTargetSameDay;
            const ok = clock.period === p.key || passedSameDay;
            return {
                due: ok,
                why: ok
                    ? (clock.period === p.key ? ('钟走到「' + p.key + '」了') : ('钟已走到' + (clock.period || clock.raw) + '（已过「' + p.key + '」）'))
                    : ('现在是' + (clock.period || clock.raw) + '，还没到「' + p.key + '」'),
            };
        }
    }
    if (/(放学|下课)/.test(t)) {
        const ok = clock.period === '下午' || clock.period === '傍晚' || clock.period === '晚上' || clock.period === '深夜';
        return { due: ok, why: ok ? '钟走到放学后了' : '还没放学（现在' + (clock.period || clock.raw) + '）' };
    }
    if (/(天亮|清晨|早晨)/.test(t)) {
        /*
         * ⭐ 修复单 #15②：**"天亮"是过了那个点就一直算数**。
         *   原来只认 `早上／上午` ⇒ 钟走到中午／下午／傍晚／晚上时反而报"**天还没亮**"（下午误判）。
         *   ⇒ 改成"**到过天亮那一刻（早上 5 点）或更晚**"都算数；
         *     钟读不出分钟时，退化成"时段在天亮之后"。
         */
        const dawn = 5 * 60;
        const AFTER_DAWN = ['早上', '上午', '中午', '下午', '傍晚', '晚上', '深夜'];
        const ok = Number.isFinite(clock.minutesOfDay)
            ? clock.minutesOfDay >= dawn
            : AFTER_DAWN.includes(clock.period);
        return { due: ok, why: ok ? '天亮了' : '天还没亮' };
    }
    if (/(夜里|深夜|半夜)/.test(t)) {
        const ok = clock.period === '深夜' || clock.period === '晚上';
        return { due: ok, why: ok ? '到夜里了' : '还没到夜里' };
    }
    if (/(明天|次日)/.test(t)) {
        const since = Number(line && line.sinceDay);
        const nowDay = clock.day === null ? 1 : clock.day;
        if (!Number.isFinite(since)) {
            return { due: false, why: '这条线没记下"从哪天起算"，⛔ 不猜' };
        }
        const ok = nowDay > since;
        return { due: ok, why: ok ? ('建线第 ' + String(since) + ' 天，今天第 ' + String(nowDay) + ' 天，到第二天了') : '还没到第二天' };
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

/**
 * 世界钟"往回走"了吗（防倒退：新钟比旧钟早太多就判可疑）
 *
 * ⭐ 跨日口径（自审修正）：两边**都没写第几天**时，钟变小＝**跨了一天**（晚上 20:00 → 早上 08:00），
 *    ⛔ 不是倒退。只有新钟**明确写了同一天**却比旧钟早，才算倒退。
 */
export function clockWentBackwards(oldText, newText) {
    const a = parseClock(oldText);
    const b = parseClock(newText);
    if (!a.has || !b.has || !trimText(newText) || trimText(newText) === '未知') {
        return false;
    }
    const dayA = a.day === null ? 1 : a.day;
    const dayB = b.day === null ? dayA : b.day;
    const absA = dayA * 1440 + (a.minutesOfDay || 0);
    let absB = dayB * 1440 + (b.minutesOfDay || 0);

    // 新钟没写第几天、但时刻变小 ⇒ 当作跨了一天往前放
    if (b.day === null && absB < absA) {
        absB += 1440;
    }

    return absB < absA - 5;   // 少超过 5 分钟才算倒退（可能是模型瞎写）
}
