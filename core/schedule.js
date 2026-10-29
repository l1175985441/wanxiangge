/**
 * 万象阁 · 日程四根 ＋ 自动更新「晚一层」（102 号 · 2026-10-27 术语表落码）
 *
 * 术语表第一节：**自动更新＝整本账每回合跑一次**，不是好感；「保留一层」＝最新那层先不动，
 *   生成第 7 层时更新第 5 层（她 22:16 的层号举例）。
 * 术语表第二节：日程四根＝
 *   ① 时间轴＋四时点（已有：clock.js isLineDue／nextStage）
 *   ② 人物生活节拍（世界背面 12／24／48／72 小时四档；没大事也要更新）
 *   ③ 到点边界（已有：到点≠履约，只写时间到／结果）
 *   ④ 提前量（构画：七天窗口＋还有 N 天／就是今天／进行中）
 * 本文件补 ② 与 ④，并把「晚一层」的触发判据做成纯函数（⛔ 不写死楼层差）。
 */

export const WEEK_MINUTES = 7 * 24 * 60;

/** 生活节拍档位（世界背面四档：按相关度 12／24／48／72 小时） */
export function lifeCadenceHours(c) {
    const rel = Number(c && c.relevance);
    if (Number.isFinite(rel) && rel >= 3) {
        return 12;
    }
    if (Number.isFinite(rel) && rel === 2) {
        return 24;
    }
    if (Number.isFinite(rel) && rel === 1) {
        return 48;
    }
    return 72;
}

/**
 * 生活结算到期没（根 ②）：多久没结算 ≥ 节拍 ⇒ 到期（没大事也要给自然状态）
 * @param {object} c 角色（用 c.lastSettledMinute，缺省退回 0）
 * @param {number} nowMinute world.clockMinute
 */
export function lifeTickDue(c, nowMinute) {
    const now = Number(nowMinute) || 0;
    const last = Number(c && c.lastSettledMinute);
    const base = Number.isFinite(last) && last > 0 ? last : 0;
    const cadence = lifeCadenceHours(c);
    const waited = Math.max(0, now - base);
    return { due: waited >= cadence * 60, waitedMinutes: waited, cadenceHours: cadence };
}

/**
 * 提前量（根 ④）：七天窗口 ＋ 四种说法
 * @returns {{inWindow: boolean, days:number, phrase:string}}
 */
export function countdownOf(dueMinute, nowMinute, startedAtMinute) {
    /* 5：Number(null)===0 会把“解析不出”当成 0 分钟 ⇒ 显示“已过期” */
    const due = (dueMinute === null || dueMinute === undefined || dueMinute === '') ? NaN : Number(dueMinute);
    const now = Number(nowMinute) || 0;
    if (!Number.isFinite(due)) {
        return { inWindow: false, days: 0, phrase: '' };
    }
    const left = due - now;
    /* 5：自然日差（不用 ceil 把 35 小时算成“还有 2 天”） */
    const days = Math.floor(left / (24 * 60));
    if (left < 0) {
        return { inWindow: false, days, phrase: '已过期' };
    }
    if (left <= 24 * 60) {
        return { inWindow: true, days: 0, phrase: '就是今天' };
    }
    /* 106：提前量的第三种说法——进行中 */
    if (Number.isFinite(Number(startedAtMinute)) && isOngoing(startedAtMinute, dueMinute, nowMinute)) {
        return { inWindow: true, days, phrase: '进行中' };
    }
    if (left <= WEEK_MINUTES) {
        return { inWindow: true, days, phrase: '还有 ' + String(days) + ' 天' };
    }
    /* 进行中：已开始但还没到点（用 due - duration 判断由调用方传 startedAt） */
    return { inWindow: false, days, phrase: '' };
}

/** 进行中的说法（已开始、未到期） */
export function isOngoing(startMinute, dueMinute, nowMinute) {
    /* Number(null)===0 会把“没开始”当成 0 分钟 ⇒ 全显示“进行中” */
    if (startMinute === null || startMinute === undefined || startMinute === '') { return false; }
    if (dueMinute === null || dueMinute === undefined || dueMinute === '') { return false; }
    const s = Number(startMinute);
    const d = Number(dueMinute);
    const n = Number(nowMinute) || 0;
    return Number.isFinite(s) && Number.isFinite(d) && s <= n && n < d;
}

/**
 * 自动更新「晚一层」：生成第 N 层时只更新到 N-1-lag 层（最新那层先留着）
 * @param {{curFloor:number, lastUpdatedFloor:number, lag?:number}} a
 * @returns {{run:boolean, targetFloor:number}}
 */
export function shouldRunUpdate(a) {
    const cur = Number(a && a.curFloor);
    const last = Number(a && a.lastUpdatedFloor);
    const lag = Math.max(0, Math.floor(Number(a && a.lag)));
    const l = Number.isFinite(lag) ? lag : 1;
    if (!Number.isFinite(cur) || cur < 0) {
        return { run: false, targetFloor: -1 };
    }
    /* 最新那一层（AI 刚生成、还在刷）不更新 ⇒ 目标 = cur - 1 - lag */
    const target = cur - 1 - l;
    if (target < 0) {
        return { run: false, targetFloor: -1 };
    }
    const base = Number.isFinite(last) ? last : -1;
    return { run: target > base, targetFloor: target };
}

/* ── 106：四时点（mid／late／origin／due）——照 dayclock 的思路重写，⛔ 不 import 它 ── */
export const POINTS = ['mid', 'late', 'origin', 'due'];

/**
 * 这条日程本轮该报哪个点；**只报最靠后的一个**（防刷屏）。
 * @param {object} item 日程条目（what/dueMinute/originDueMinute/firedPoints）
 * @param {{nowMinute:number, createdAtMinute:number, lateAtPct:number, midEveryDays:number}} ctx
 * @returns {'due'|'origin'|'late'|'mid'|null}
 */
export function pointOf(item, ctx) {
    const c = ctx || {};
    const now = Number(c.nowMinute) || 0;
    const it = item || {};
    const due = Number(it.dueMinute);
    const origin = Number(it.originDueMinute);
    const fired = Array.isArray(it.firedPoints) ? it.firedPoints.map(String) : [];
    /* due：已到期 */
    if (Number.isFinite(due) && now >= due && !fired.includes('due')) {
        return 'due';
    }
    /* origin：原定期限已过但被顺延过（origin < due） */
    if (Number.isFinite(due) && Number.isFinite(origin) && origin < due && now >= origin && !fired.includes('origin')) {
        return 'origin';
    }
    /* late：进度 ≥ lateAtPct（默认 85%） */
    const start = Number(c.createdAtMinute);
    if (Number.isFinite(due) && Number.isFinite(start) && due > start) {
        const pct = (now - start) / (due - start);
        const lateAt = Number.isFinite(Number(c.lateAtPct)) ? Number(c.lateAtPct) / 100 : 0.85;
        if (pct >= lateAt && now < due && !fired.includes('late')) {
            return 'late';
        }
        /* mid：按 midEveryDays 切段，走到下一段且没报过 */
        const everyDays = Number.isFinite(Number(c.midEveryDays)) ? Number(c.midEveryDays) : 7;
        const seg = Math.floor((now - start) / (everyDays * 24 * 60));
        const firedMid = fired.filter((x) => x === 'mid').length;
        if (seg >= 1 && firedMid < seg && now < due) {
            return 'mid';
        }
    }
    return null;
}
