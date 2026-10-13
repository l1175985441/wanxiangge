/**
 * 万象阁 · 账本
 *
 * 账 ＝ 上次更新是什么时候、更新了什么、有没有失败。
 * 本轮只记两件事：本轮召回（进了什么）＋ 本轮注入回执（注入多少字、什么时候、什么原因）。
 * 每次更新前留底、一键撤回、对账这些等第 3 步接模型更新时一起做。
 */

import { formatStamp, formatClock, now } from './adapter.js';
import { loadState, saveState } from './state.js';
import { trimText, countChars } from './utils.js';

/** 把一批"已推送"的经历标记掉（只有真进了主模型眼前的才算推过） */
export function markCarried(items) {
    const state = loadState();
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
            if (p && p.text && !p.injected) {
                p.injected = true;
                marked += 1;
            }
        }
    }
    if (marked) {
        saveState();
    }
    return marked;
}

/** 记一条账（在召回记录之外另记一行人话摘要，给面板"最近发生了什么"用） */
export function commitLedger() {
    const state = loadState();
    const records = state.recallRecords;
    const latest = records.length ? records[records.length - 1] : null;
    if (!latest) {
        return;
    }

    const statusText = latest.injectStatus === 'ok'
        ? '已注入 ' + String(latest.injectedChars) + ' 字'
        : (latest.injectStatus === 'empty' ? '未注入' : '正文还没生成，本轮待送');

    state.lastUpdate = {
        at: latest.at || now(),
        status: latest.injectStatus === 'ok'
            ? 'ok'
            : (latest.injectStatus === 'empty' ? 'idle' : (latest.injectStatus === 'error' ? 'failed' : 'pending')),
        note: '第 ' + String(latest.floor + 1) + ' 楼：' + statusText
            + (latest.chars && latest.chars.length ? '（' + latest.chars.join('、') + '）' : ''),
    };

    if (latest.injectStatus === 'ok') {
        markCarried(latest.items);
    }

    saveState();
}

/** 面板顶部那行"上次更新" */
export function ledgerText() {
    const state = loadState();
    const lu = state.lastUpdate || {};
    if (!lu.at) {
        return '还没有更新记录';
    }
    const when = formatStamp(lu.at);
    const status = lu.status === 'ok'
        ? '成功'
        : (lu.status === 'failed'
            ? '失败'
            : (lu.status === 'pending' ? '已算好，等正文生成时送进去' : '未注入'));
    return when + ' · ' + status + (lu.note ? ' · ' + lu.note : '');
}

/** 一张卡片的回执行文案（⛔ 不许含糊：有没有注入、注入多少、为什么没注入） */
export function receiptText(rec) {
    if (!rec) {
        return '本轮没有记录';
    }
    // 字数一律现数（不信存下来的值，免得升级前后对不上）
    const chars = countChars(rec.injectedText);
    if (rec.injectStatus === 'ok') {
        const asRole = rec.injectAs === 'system' ? '（请求里身份＝系统）' : '';
        return '本轮注入 ✓ ' + String(chars) + ' 字' + asRole + '（' + formatClock(rec.injectedAt || rec.at) + '）';
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
