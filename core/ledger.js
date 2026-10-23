/**
 * 万象阁 · 账本
 *
 * 账 ＝ 上次更新是什么时候、更新了什么、有没有失败。
 * 每次更新前留底、一键撤回、对账这些在 core/state.js 与 core/pipeline.js 里做，
 * 这里负责：把结果组织成人话（回执、上次更新那一行）。
 */

import { formatStamp, formatClock, now } from './adapter.js';
import { loadState, saveState, flushState } from './state.js';
import { getSettings } from './settings.js';
import { trimText, countChars, floorLabel } from './utils.js';

/** 把一批"已推送"的经历标记掉（只有通过了楼层裁、真进了主模型眼前的才算推过） */
export function markCarried(items, opts) {
    const state = loadState();
    const o = opts || {};
    const anchorFloor = Number(o.anchorFloor);
    const hasAnchor = Number.isFinite(anchorFloor) && anchorFloor >= 0;
    const cut = Number.isFinite(Number(getSettings().pastFloorCut)) ? Number(getSettings().pastFloorCut) : 0;
    const injectedText = trimText(o.injectedText);
    let marked = 0;
    for (const item of Array.isArray(items) ? items : []) {
        const ch = item && item.character;
        if (!ch) {
            continue;
        }
        const target = state.characters.find((c) => c.id === ch.id);
        if (!target || !Array.isArray(target.past)) {
            continue;
        }
        for (const p of target.past) {
            if (!p || !p.text || p.injected) {
                continue;
            }
            // 被"楼层裁"挡在最近 N 楼内的，本轮并没端出去 ⇒ ⛔ 不标 injected
            const pastFloor = Number(p.floor !== undefined ? p.floor : p.fromFloor);
            if (cut > 0 && hasAnchor && Number.isFinite(pastFloor)) {
                if ((anchorFloor - pastFloor) < cut) {
                    continue;
                }
            }
            // 若给了本轮实际注入正文，还要确认这句经历真在里面（防篇幅截断误标）
            if (injectedText && !injectedText.includes(trimText(p.text))) {
                continue;
            }
            /*
             * ⭐⭐ R8（材料 05）：**不再把投射过的经历永久标成 injected** ✓
             *   她原话（[51]～[54]）：过去经历是**流动的最近几条**，没淡出前**每轮**该带上 ✓
             *   旧：注入完就永久标 true ✗，但注入是往 coreChat 临时塞一条 system、
             *     **不进聊天历史**，下一轮开头就被摘掉 ✗
             *     ⇒ 第 2 个回合起（以及重 roll 时）第 2～5 条经历对主模型**全部隐身** ✗
             *   现在：只记账、不打永久标 ✓ ⇒ 每轮都能带 ✓
             *     （流动范围仍由 capPast 与“楼层裁”管 ✓）
             */
            marked += 1;
        }
    }
    if (marked) {
        saveState();
    }
    return marked;
}

/**
 * 记一条账（面板"最近发生了什么"用）。
 * @param {object} [justNow] 刚写的那条召回记录；给了就用它（最稳），
 *   ⛔ 不再"抓数组末尾那条"——重跑旧楼时那条是在数组**中间**原地更新的（自审修正·条 18）。
 */
export function commitLedger(justNow) {
    const state = loadState();
    const records = Array.isArray(state.recallRecords) ? state.recallRecords : [];   /* 依据＝第 7 问 S1 */
    let latest = justNow && typeof justNow === 'object' ? justNow : null;
    if (!latest) {
        // 退路：按"注入时刻"取最新的一条（⛔ 不是按数组顺序）
        let bestAt = -1;
        for (const r of records) {
            if (!r) {
                continue;
            }
            const at = Number(r.injectedAt || r.at || 0);
            if (at > bestAt) {
                bestAt = at;
                latest = r;
            }
        }
    }
    if (!latest) {
        return;
    }

    const statusText = latest.injectStatus === 'ok'
        ? '已注入 ' + String(countChars(latest.injectedText)) + ' 字'
        : (latest.injectStatus === 'empty' ? '未注入' : '正文还没生成，本轮待送');

    const who = [];
    if (latest.chars && latest.chars.length) {
        who.push(latest.chars.join('、'));
    }
    if (latest.events && latest.events.length) {
        who.push('事 ' + String(latest.events.length) + ' 条');
    }

    const prevFloor = Number.isFinite(Number((state.lastUpdate || {}).floor)) ? Number(state.lastUpdate.floor) : -1;
    state.lastUpdate = {
        at: latest.at || now(),
        status: latest.injectStatus === 'ok'
            ? 'ok'
            : (latest.injectStatus === 'empty' ? 'idle' : (latest.injectStatus === 'error' ? 'failed' : 'pending')),
        note: floorLabel(latest.floor) + '：' + statusText + (who.length ? '（' + who.join('；') + '）' : ''),
        floor: prevFloor,
    };

    if (latest.injectStatus === 'ok') {
        markCarried(latest.items, { anchorFloor: latest.floor, injectedText: latest.injectedText });
    }
    saveState();
    /* ⭐ 新增件 5②：**一轮记账落完就把合并的那次落盘冲出去** ✓（⏔ 等定时器 ✗） */
    try { flushState(); } catch (eFlush) { }

}

/** 面板顶部那行"上次更新" */
export function ledgerText() {
    const state = loadState();
    const lu = state.lastUpdate || {};
    const pipe = state.pipeline || {};
    if (!lu.at) {
        return '还没有更新记录';
    }
    const when = formatStamp(lu.at);
    const status = lu.status === 'ok'
        ? '成功'
        : (lu.status === 'failed'
            ? '失败'
            : (lu.status === 'pending' ? '已算好，等正文生成时送进去' : '未注入'));
    let line = when + ' · ' + status + (lu.note ? ' · ' + lu.note : '');
    if (pipe.status === 'failed' && pipe.error) {
        line += ' ｜ 更新那一步失败：' + pipe.error + '（重试有上限；点「立刻更新」可再来一次）';
    }
    /*
     * ⭐⭐ 材料 06【6】③：**重开网页后不能永远挂着“正在更新…”** ✓
     *   旧：只看 `pipe.status === 'running'` ✗ 而它是**持久化写进存档**的 ✗
     *     ⇒ 推演中途刷新网页／升级插件 ⇒ **状态页顶栏永远显示“正在更新…”** ✗✗
     *   现在：加上**内存标记**判断 ✓（与 health.js、体检页同一套判法 ✓）
     *     ⏔ 真在跑才说“正在更新” ✗；没跑 ⇒ 不挂这句 ✓
     */
    const _liveRun = (typeof window !== 'undefined') && window.__wxgLiveRun;
    if (pipe.status === 'running' && _liveRun) {
        line += ' ｜ 正在更新：' + (pipe.text || '…');
    }
    return line;
}

/** 一张卡片的回执行文案（⛔ 不许含糊：有没有注入、注入多少、为什么没注入） */
export function receiptText(rec) {
    if (!rec) {
        return '本轮没有记录';
    }
    // 字数一律现数（与送进去的那一串同源，免得两处对不上）
    const chars = countChars(rec.injectedText);
    if (rec.injectStatus === 'ok') {
        const asRole = rec.injectAs === 'system' ? '（请求里身份＝系统）' : '';
        const ev = rec.events && rec.events.length ? '，含世界事件 ' + String(rec.events.length) + ' 条' : '';
        return '本轮注入 ✓ ' + String(chars) + ' 字' + ev + asRole + '（' + formatClock(rec.injectedAt || rec.at) + '）';
    }
    if (rec.injectStatus === 'empty') {
        const reason = trimText(rec.injectNote) || '本轮没有要带的内容';
        return '本轮注入 ✕ 0 字 · ' + reason;
    }
    if (rec.injectStatus === 'error') {
        return '本轮注入 ✕ 失败 · ' + (trimText(rec.injectNote) || '原因未记录');
    }
    return '本轮注入 ✕ 0 字 · 正文还没生成，本轮内容待送';
}
