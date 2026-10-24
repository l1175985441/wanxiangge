/**
 * 万象阁 · 加速层可丢（阿砚第三批 C 档 P2 · B7）
 *
 * 依据＝B7「加速层可丢（索引丢了返回空批次，不冒充 0 分）」；
 *   风险：缓存/索引坏了被当成“账是空的”“一本世界书都没有”——**把故障说成结论**。
 *
 * 我们的加速层只有一处是真缓存：世界书名单（`listBooksCache`）。
 * 这一层给它一条纪律：
 *   · `hit`     —— 有值，直接用
 *   · `miss`    —— 还没取过（可以再取一次）
 *   · `broken`  —— 取失败/坏了（**不许当成“没有”**；调用方必须显示“读不到”）
 *   · `empty`   —— 真的取到了、就是 0 条（这才是“没有”）
 *
 * 关键 API：`asBatch()` —— 把缓存状态翻译成“给下游的一批数据”，
 *   坏了就返回空 items **并带 state:'unknown'**，⛔ 让下游把空数组当 0 分。
 */

/**
 * 造一个缓存。
 * @param {string} name 名字（诊断用）
 */
export function createCache(name) {
    let state = 'miss';
    let value = null;
    let at = 0;
    let reason = '';
    const api = {
        name: String(name || 'cache'),
        /** 取到了：state=hit（空数组也算取到 ⇒ 由调用方决定是不是 empty） */
        set(v, meta) {
            value = v;
            at = Date.now();
            reason = '';
            const n = Array.isArray(v) ? v.length : null;
            state = (n === 0) ? 'empty' : 'hit';
            if (meta && meta.reason) { reason = String(meta.reason); }
            return api.get();
        },
        /** 取失败/推算不出来：state=broken，value 清掉（⛔ 留半截冒充） */
        markBroken(why) {
            state = 'broken';
            value = null;
            at = Date.now();
            reason = String(why || '缓存取不到');
            return api.get();
        },
        /** 清掉（下次重新取） */
        clear() {
            state = 'miss';
            value = null;
            at = 0;
            reason = '';
        },
        get() {
            return { name: api.name, state, value, at, reason, ok: state === 'hit' || state === 'empty' };
        },
    };
    return api;
}

/**
 * 把缓存状态翻成“给下游的一批数据”。
 * @returns {{items:any[], state:'hit'|'empty'|'miss'|'broken', reason:string, ok:boolean}}
 */
export function asBatch(snapshot) {
    const s = snapshot || {};
    const items = Array.isArray(s.value) ? s.value : [];
    const state = String(s.state || 'miss');
    if (state === 'broken') {
        /* 关键：坏了就给空批次，但 state 必须是 unknown 类（⛔ empty） */
        return { items: [], state: 'broken', reason: String(s.reason || '取不到'), ok: false };
    }
    if (state === 'empty') {
        return { items: [], state: 'empty', reason: '', ok: true };
    }
    if (state === 'hit') {
        return { items, state: 'hit', reason: '', ok: true };
    }
    return { items: [], state: 'miss', reason: '', ok: false };
}

/** 给人看的一行（面板/诊断用） */
export function cacheLine(snapshot) {
    const b = asBatch(snapshot);
    if (b.state === 'broken') { return '缓存（' + String(snapshot && snapshot.name) + '）：读不到（不是没有）—— ' + b.reason; }
    if (b.state === 'empty') { return '缓存（' + String(snapshot && snapshot.name) + '）：确实 0 条'; }
    if (b.state === 'hit') { return '缓存（' + String(snapshot && snapshot.name) + '）：' + String(b.items.length) + ' 条'; }
    return '缓存（' + String(snapshot && snapshot.name) + '）：还没取过';
}

/** 是不是“坏”的状态（调用方据此决定要不要显示“读不到”） */
export function isBroken(snapshot) {
    return String((snapshot && snapshot.state) || '') === 'broken';
}
