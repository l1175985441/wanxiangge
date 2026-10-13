/**
 * 万象阁 · 适配层
 *
 * 只通过酒馆官方的 getContext() 拿东西，不深入内部结构。
 * 万一酒馆换版本、接口不在，这里统一降级：机器不崩、界面照常。
 *
 * 账本存两处（口诀：**聊天元数据为主、设置区里留个底**）：
 *   ① 主存：当前聊天的元数据（按聊天各分各的，换聊天自动互不干扰）；
 *   ② 底稿：扩展设置里的镜像（万一酒馆不给元数据存自定义键，还能把账捞回来）。
 * 底稿只当保险，不是第二份真账：更空的那份⛔ 不许盖掉更全的那份，写错门牌的直接按章归位。
 */

import { LEDGER_KEY, SETTINGS_KEY } from './config.js';

let ctx = null;

/** 记下酒馆的上下文对象（入口在 APP_READY 时调用一次） */
export function setContext(context) {
    ctx = context;
}

/** 当前上下文对象（可能为空） */
export function getCtx() {
    return ctx;
}

/** 拿当前聊天记录数组 */
export function getChat() {
    if (!ctx || !Array.isArray(ctx.chat)) {
        return [];
    }
    return ctx.chat;
}

/** 当前聊天的标识（换聊天就换这个键；拿不到时退回角色 id 或固定串） */
export function currentChatKey() {
    try {
        if (!ctx) {
            return 'no-context';
        }
        const info = ctx.chatMetadata && typeof ctx.chatMetadata === 'object'
            ? ctx.chatMetadata
            : {};
        const candidates = [
            info.file_name,
            info.chat_file_name,
            info.file,
            ctx.chatId,
            ctx.characterId !== undefined && ctx.characterId !== null ? 'char-' + String(ctx.characterId) : '',
        ];
        for (const c of candidates) {
            const v = c === undefined || c === null ? '' : String(c).trim();
            if (v) {
                return v;
            }
        }
        return 'default-chat';
    } catch (e) {
        console.warn('[万象阁] 认聊天标识出错，先按默认档处理：', e);
        return 'default-chat';
    }
}

/** 当前聊天的元数据对象（拿不到时退回内存兜底，保证不崩） */
export function getChatMetadata() {
    if (ctx) {
        const md = ctx.chatMetadata;
        if (md && typeof md === 'object') {
            return md;
        }
        if (!ctx.__wxgFallbackMetadata || typeof ctx.__wxgFallbackMetadata !== 'object') {
            ctx.__wxgFallbackMetadata = {};
        }
        return ctx.__wxgFallbackMetadata;
    }
    if (!fallbackMetadata) {
        fallbackMetadata = {};
    }
    return fallbackMetadata;
}

let fallbackMetadata = null;

/**
 * 取账本：
 *   ① 当前聊天元数据这一格是不是**这个聊天**的账？是 ⇒ 把它跟底稿比一比，取更全的那份用；
 *      （如果盖的章是别的聊天（换聊天时残留），先把它收进底稿，别冲掉别人的账）
 *   ② 再看底稿里有没有这个聊天的账 ⇒ 有就捞回来当主存；
 *   ③ 都没有 ⇒ 返回空（由上层建一本新的）。
 * ⭐ 一条底线：任何时候都**不许把账换成更空的那份**（宁可用旧的，也不许丢）。
 */
export function readLedger() {
    const key = currentChatKey();
    const md = getChatMetadata();
    const store = getExtensionSettings();
    const mirrorBox = store && store[SETTINGS_KEY + '_mirror'];
    const mirror = mirrorBox && typeof mirrorBox === 'object' ? mirrorBox[key] : null;

    const direct = md[LEDGER_KEY];
    if (looksLikeLedger(direct, key)) {
        if (looksLikeLedger(mirror, key) && richer(direct, mirror) === mirror) {
            md[LEDGER_KEY] = mirror;   // 底稿更全 ⇒ 用它（别把账换小了）
            return mirror;
        }
        return direct;
    }
    if (direct && typeof direct === 'object' && hasContent(direct)) {
        stashToMirror(null, direct, true);   // 别丢：按它自己的章收进底稿
        md[LEDGER_KEY] = null;
    }

    if (looksLikeLedger(mirror, key)) {
        return mirror;
    }
    return null;
}

/** 存账本：写回当前聊天的元数据，同时在设置区留一份底 */
export function writeLedger(state) {
    if (!state || typeof state !== 'object') {
        return;
    }
    state.chatKey = currentChatKey();   // 盖个章：这本账属于哪个聊天
    const md = getChatMetadata();
    md[LEDGER_KEY] = state;
    if (ctx && ctx.chatMetadata === md && typeof ctx.saveMetadata === 'function') {
        try {
            const p = ctx.saveMetadata();
            if (p && typeof p.catch === 'function') {
                p.catch((e) => console.warn('[万象阁] 账本保存失败：', e));
            }
        } catch (e) {
            console.warn('[万象阁] 账本保存失败：', e);
        }
    }
    mirrorLedger(state);
}

/** 这本账盖的章（属于哪个聊天） */
function keyOf(state) {
    if (!state || typeof state !== 'object') {
        return '';
    }
    return state.chatKey === undefined || state.chatKey === null ? '' : String(state.chatKey);
}

/** 这本账是"当前这个聊天"的、且有值钱内容吗 */
function looksLikeLedger(state, key) {
    if (!state || typeof state !== 'object') {
        return false;
    }
    const owner = keyOf(state);
    if (owner && key && owner !== key) {
        return false; // 别把别的聊天的账当自己的（换聊天时的保险丝）
    }
    return hasContent(state);
}

/** 账本里有没有"值钱的东西"（空壳不算，免得误当成已有账） */
function hasContent(state) {
    if (!state || typeof state !== 'object') {
        return false;
    }
    const stat = state.stat || {};
    if (Number(stat.recalled || 0) > 0) {
        return true;
    }
    if (Array.isArray(state.recallRecords) && state.recallRecords.length > 0) {
        return true;   // 哪怕这一轮是"空召回"，那也是一笔账（回执要看得见）
    }
    if (Array.isArray(state.characters) && state.characters.length > 0) {
        return true;
    }
    if (state.lastUpdate && state.lastUpdate.at) {
        return true;
    }
    return false;
}

/** 当前内存里那本账（用于"离开这个聊天前"留底） */
let liveGetter = null;

/** 让状态仓库告诉适配层"现在内存里那本账是谁"（避免两边互相 import 打转） */
export function setLiveLedgerGetter(fn) {
    liveGetter = typeof fn === 'function' ? fn : null;
}

function currentLive() {
    try {
        return liveGetter ? liveGetter() : null;
    } catch (e) {
        return null;
    }
}

/**
 * 离开一个聊天之前，先把内存里那本账完整留个底。
 * ⚠️ 必须在它被"改成别的聊天那一本"之前调用（状态仓库在换缓存时就是这么干的）。
 */
export function snapshotLiveLedger() {
    const live = currentLive();
    if (live && typeof live === 'object' && hasContent(live)) {
        stashToMirror(null, live, true);
    }
}

/*
 * 底稿（设置区里的镜像）
 * ⚠️ 三个要点：
 *   ① 键和内容都在**放进队列这一刻**定下（不能等定时器跑的时候再取——那时可能已经换聊天了）；
 *   ② 存的是**快照**，不是活引用（否则账本后面的改动会把这份底稿也改掉）；
 *   ③ 每一格按账本自己盖的章归位，更空的那份不许盖掉更全的那份（防两个聊天互相踩）。
 */
let mirrorTimer = null;
const mirrorPending = new Map();

function mirrorLedger(state) {
    if (!hasContent(state)) {
        return; // 空账不值得留底
    }
    stashToMirror(currentChatKey(), state);
}

/** 放进待写底稿（key 为空则按账本自己盖的章算；immediate＝立刻落盘） */
function stashToMirror(key, source, immediate) {
    const snap = typeof source === 'function' ? source() : source;
    if (!snap || typeof snap !== 'object') {
        return;
    }
    const target = key || keyOf(snap);
    if (!target) {
        return;
    }
    mirrorPending.set(target, deepClone(snap));
    if (immediate) {
        flushMirror();
        return;
    }
    if (mirrorTimer) {
        return;
    }
    mirrorTimer = setTimeout(() => {
        mirrorTimer = null;
        flushMirror();
    }, 2000);
}

/** 把某本账从"待落盘"队列里摘掉（跟它相同的那一刻才摘，别误伤别人） */
export function dropMirrorFor(key, state) {
    if (!key || !state) {
        return;
    }
    const pending = mirrorPending.get(key);
    if (pending && pending === state) {
        mirrorPending.delete(key);
    }
}

/** 真正落盘：一格一格对号入座 */
function flushMirror() {
    const store = getExtensionSettings();
    if (!store || !mirrorPending.size) {
        return;
    }
    if (!store[SETTINGS_KEY + '_mirror'] || typeof store[SETTINGS_KEY + '_mirror'] !== 'object') {
        store[SETTINGS_KEY + '_mirror'] = {};
    }
    const box = store[SETTINGS_KEY + '_mirror'];
    for (const pair of Array.from(mirrorPending.entries())) {
        const key = pair[0];
        const snapshot = pair[1];
        mirrorPending.delete(key);

        // ⭐ 按账本自己盖的章归位（⛔ 别写错门牌）
        const owner = keyOf(snapshot) || key;
        const current = box[owner];
        if (current && richer(current, snapshot) === current) {
            continue; // 已经有一份更全的，留住它
        }
        try {
            box[owner] = snapshot;
        } catch (e) {
            console.warn('[万象阁] 底稿写入失败：', e);
            continue;
        }
    }
    // 只留最近 8 个聊天，别让设置文件越涨越大
    const keys = Object.keys(box);
    if (keys.length > 8) {
        for (const k of keys.slice(0, keys.length - 8)) {
            delete box[k];
        }
    }
    persistSettings();
}

/** 两份账哪份更全（记账条数、人物数、召回过没有；一样全就取新的那份） */
function richer(a, b) {
    const score = (s) => {
        if (!s || typeof s !== 'object') {
            return -1;
        }
        return (Array.isArray(s.recallRecords) ? s.recallRecords.length * 100 : 0)
            + (Array.isArray(s.characters) ? s.characters.length * 10 : 0)
            + (Number((s.stat || {}).recalled || 0) > 0 ? 1 : 0);
    };
    return score(b) > score(a) ? b : a;
}

/** 看一眼底稿现状（只在电脑上做自测时用，聊天里用不到） */
export function debugMirrorSnapshot() {
    const store = getExtensionSettings();
    const box = store ? store[SETTINGS_KEY + '_mirror'] : null;
    const out = {};
    if (box && typeof box === 'object') {
        for (const k of Object.keys(box)) {
            const v = box[k] || {};
            out[k] = {
                owner: v.chatKey || '(未盖章)',
                chars: Array.isArray(v.characters) ? v.characters.length : -1,
                recs: Array.isArray(v.recallRecords) ? v.recallRecords.map((r) => r.mesId + '@' + r.floor) : [],
            };
        }
    }
    return { box: out, pending: Array.from(mirrorPending.keys()) };
}

/** 全局设置对象（酒馆的 extensionSettings 里属于本插件的那一格） */
export function getExtensionSettings() {
    if (!ctx || !ctx.extensionSettings || typeof ctx.extensionSettings !== 'object') {
        return null;
    }
    return ctx.extensionSettings;
}

/** 把全局设置存到服务端（防抖由酒馆自己做） */
export function persistSettings() {
    try {
        if (ctx && typeof ctx.saveSettingsDebounced === 'function') {
            ctx.saveSettingsDebounced();
        }
    } catch (e) {
        console.warn('[万象阁] 设置保存失败：', e);
    }
}

/** 深拷贝（注入时用，保证不碰真实聊天记录） */
export function deepClone(value) {
    if (typeof structuredClone === 'function') {
        try {
            return structuredClone(value);
        } catch (e) {
            // 落到下面的兜底
        }
    }
    try {
        return JSON.parse(JSON.stringify(value));
    } catch (e) {
        return value;
    }
}

/** 现在的时间戳（毫秒） */
export function now() {
    return Date.now();
}

/** 时间戳 → 本地时间文字（HH:MM:SS） */
export function formatClock(ts) {
    const d = new Date(ts || Date.now());
    const p = (n) => String(n).padStart(2, '0');
    return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
}

/** 时间戳 → 本地日期时间文字（YYYY-MM-DD HH:MM:SS） */
export function formatStamp(ts) {
    const d = new Date(ts || Date.now());
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + formatClock(ts);
}
