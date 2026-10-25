/**
 * 万象阁 · 「这一轮有几条没进账」（阿砚必修 9：拒签没顶到上面）
 *
 * 她要的：这一轮如果有拒签/失败/跳过 N 条，就在**每轮记录**那张卡的卡头下面放一条**红条**，
 *   写清「本轮有 N 条没进账 ＋ 一句原因」，可点开看是哪几条。
 *   ⛔ toast、⛔ 埋在列表里当胶囊。
 *
 * 数据来源（现读账本）：
 *   · `state.failLog[]`：每次失败记一条（`at` 毫秒 ＋ `kind` ＋ `why`）；
 *   · `state.pipeline.error`：这一轮的直接错误（有就至少算一条）。
 *   只数**上一轮**（`pipeline.startedAt`～`endedAt` 之间）的，⛔ 把历史旧账一直顶在头上。
 */

/** 一条失败记录的人话（⛔ 抄正文，只说类别） */
function whyOf(row) {
    const kind = String((row && row.kind) || '').trim();
    const why = String((row && row.why) || '').trim();
    if (kind && why) {
        return kind + '：' + why;
    }
    return kind || why || '没说明原因';
}

/**
 * @param {object} state 账本
 * @returns {{count:number, reasons:string[], line:string, title:string}}
 */
export function runWarning(state) {
    const st = state || {};
    const p = st.pipeline || {};
    const start = Number(p.startedAt) || 0;
    const end = Number(p.endedAt) || 0;
    const log = Array.isArray(st.failLog) ? st.failLog : [];
    const rows = log.filter((r) => {
        const at = Number(r && r.at);
        if (!Number.isFinite(at) || at <= 0) {
            return false;
        }
        if (end && at > end) {
            return false;
        }
        return start ? at >= start : true;
    });
    const reasons = rows.map(whyOf).filter(Boolean);
    const err = String(p.error || '').trim();
    if (err) {
        reasons.unshift('这一轮没成：' + err);
    }
    const count = rows.length + (err ? 1 : 0);
    if (!count) {
        return { count: 0, reasons: [], line: '', title: '' };
    }
    return {
        count,
        reasons,
        title: '本轮有 ' + String(count) + ' 条没进账',
        line: reasons.length ? reasons[0] : '没说明原因',
    };
}

/** 给人看的一行（诊断用） */
export function runWarningLine(state) {
    const r = runWarning(state);
    return r.count ? (r.title + '（' + r.line + '）') : '本轮全部进账';
}
