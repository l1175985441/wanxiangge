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
 *   ① 元数据这一格是不是**这个聊天**的账？是 ⇒ 用它；
 *      （如果盖的章是**这个聊天自己以前的名字**（新聊天刚存盘改名），也认 ⇒ 换个章继续用，⛔ 不许当垃圾清掉）
 *      （只有确认是**别的聊天**的账时，才收进底稿、腾出这一格）
 *   ② 再看底稿里有没有这个聊天的账 ⇒ 有就捞回来当主存；
 *   ③ 都没有 ⇒ 返回空（由上层建一本新的）。
 * ⭐ 一条底线：任何时候都**不许把账换成更空／更旧的那份**。
 */
export function readLedger() {
    const key = currentChatKey();
    const md = getChatMetadata();
    const store = getExtensionSettings();
    const mirrorBox = store && store[SETTINGS_KEY + '_mirror'];
    const mirror = mirrorBox && typeof mirrorBox === 'object' ? mirrorBox[key] : null;

    const direct = md[LEDGER_KEY];
    if (looksLikeLedger(direct, key)) {
        syncKey(direct, key);
        if (looksLikeLedger(mirror, key) && richer(direct, mirror) === mirror) {
            md[LEDGER_KEY] = mirror;   // 底稿更全 ⇒ 用它
            return mirror;
        }
        return direct;
    }

    // 章不符：先分清是"同一个聊天改了名"还是"换了聊天"
    if (direct && typeof direct === 'object' && hasContent(direct)) {
        if (isOwnPastKey(keyOf(direct))) {
            // 同一个聊天：新聊天存档时 file_name 才出现（此前叫 default-chat）⇒ 换个章继续用
            adoptLedger(key, direct);
            if (looksLikeLedger(mirror, key) && richer(direct, mirror) === mirror) {
                md[LEDGER_KEY] = mirror;
                return mirror;
            }
            return direct;
        }
        stashToMirror(null, direct, true);   // 真是别的聊天 ⇒ 按它自己的章收进底稿，别丢
        md[LEDGER_KEY] = null;
    }

    if (looksLikeLedger(mirror, key)) {
        return mirror;
    }
    return null;
}

/**
 * 这本账是**这个聊天自己以前的名字**吗？
 * 判据：内存里正握着的那本账，它的章就是 owner（＝同一个聊天刚刚改名）。
 * ⚠️ 换聊天时入口会先 resetCache()，那时 liveKey 为空 ⇒ 不会误认（这正是这条判据安全的原因）。
 */
function isOwnPastKey(owner) {
    if (!owner) {
        return true;   // 没盖章的账，当自己的
    }
    const liveKey = cacheChatKey();
    if (!liveKey) {
        return false;  // 手里没有别的账可对（刚换过聊天）⇒ 不认
    }
    return liveKey === owner;
}

/** 内存里正握着的那本账属于哪个聊天（由状态仓库提供） */
function cacheChatKey() {
    const live = currentLive();
    return live ? keyOf(live) : '';
}

/** 收养一本"自己以前名字"的账：换个章、落个底，继续用 */
function adoptLedger(key, ledger) {
    ledger.chatKey = key;
    writeLedger(ledger);
    return ledger;
}

/** 把账本的章对齐到当前聊天（读到时顺手校正） */
function syncKey(ledger, key) {
    if (ledger && typeof ledger === 'object' && keyOf(ledger) !== key) {
        ledger.chatKey = key;
    }
}

/** 存账本：写回当前聊天的元数据（真的存服务端）＋立刻在设置区留一份底 */
export function writeLedger(state) {
    if (!state || typeof state !== 'object') {
        return;
    }
    state.chatKey = currentChatKey();   // 盖个章：这本账属于哪个聊天
    const md = getChatMetadata();
    md[LEDGER_KEY] = state;

    // 存服务端：saveMetadata 是标准路子；老版本没有就走 saveChatConditional
    if (ctx && ctx.chatMetadata === md) {
        const save = typeof ctx.saveMetadata === 'function'
            ? ctx.saveMetadata.bind(ctx)
            : (typeof ctx.saveChatConditional === 'function' ? ctx.saveChatConditional.bind(ctx) : null);
        if (save) {
            try {
                const p = save();
                if (p && typeof p.then === 'function') {
                    p.then(() => { lastSaveOk = true; }).catch((e) => {
                        lastSaveOk = false;
                        console.warn('[万象阁] 账本存盘失败（聊天记录本身不受影响）：', e);
                    });
                } else {
                    lastSaveOk = true;
                }
            } catch (e) {
                lastSaveOk = false;
                console.warn('[万象阁] 账本存盘失败（聊天记录本身不受影响）：', e);
            }
        } else if (!warnedNoSave) {
            warnedNoSave = true;
            console.warn('[万象阁] 这个酒馆版本没给出存盘接口（saveMetadata／saveChatConditional），账本会只在本次会话内有效——请把这条告诉我。');
        }
    }

    // ⭐ 底稿：立刻写、不攒着（刷新页面后就是靠它把账捞回来）
    mirrorLedger(state);
}

let warnedNoSave = false;
let lastSaveOk = null;

/** 存盘情况（面板上如实报给她看：主存／底稿／只在内存） */
export function storageReport() {
    const live = currentLive();
    const score = live ? liveScore(live) : -1;
    if (score < 0) {
        return { tone: 'idle', text: '还没有账（发一条消息就有了）' };
    }
    if (lastSaveOk === false) {
        return { tone: 'bad', text: '存盘失败——账只在这次会话里（刷新会丢）；底稿还留着上一份' };
    }
    if (lastSaveOk === true) {
        return { tone: 'ok', text: '已存进聊天档 ✓（设置区里另有一份底稿，刷新／重开都能捞回来）' };
    }
    return { tone: 'idle', text: '已经记下，正在存盘' };
}

/** 账本里有多少东西（只看有没有，不碰内容） */
function liveScore(s) {
    if (!s || typeof s !== 'object') {
        return -1;
    }
    const recs = Array.isArray(s.recallRecords) ? s.recallRecords.length : 0;
    const chars = Array.isArray(s.characters) ? s.characters.length : 0;
    if (!recs && !chars) {
        return -1;
    }
    return recs + chars;
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
    // ⚠️ 一律立刻落盘：攒着不写＝刷新就丢（之前每 2 秒攒一次，实测就丢了）
    stashToMirror(currentChatKey(), state, true);
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
        if (current && pickFresher(current, snapshot) === current) {
            continue; // 已经有一份更全（或同样全但更新）的，留住它
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

/** 两份账哪份更全（记账条数、人物数、召回过没有） */
function score(s) {
    if (!s || typeof s !== 'object') {
        return -1;
    }
    return (Array.isArray(s.recallRecords) ? s.recallRecords.length * 100 : 0)
        + (Array.isArray(s.characters) ? s.characters.length * 10 : 0)
        + (Number((s.stat || {}).recalled || 0) > 0 ? 1 : 0);
}

/** 账本有多新（取里面最新的时刻） */
function freshness(s) {
    if (!s || typeof s !== 'object') {
        return 0;
    }
    let latest = Number((s.lastUpdate || {}).at || 0);
    if (Array.isArray(s.recallRecords)) {
        for (const r of s.recallRecords) {
            const at = Number((r && r.at) || 0);
            if (at > latest) {
                latest = at;
            }
        }
    }
    return latest;
}

/**
 * 两份账留哪份：**先比谁更全，一样全就比谁更新**。
 * ⚠️ 平手时必须取新的——旧的那条已经推出过、留着它等于把新写的账丢掉（实测踩过这个坑）。
 */
function pickFresher(a, b) {
    const sa = score(a);
    const sb = score(b);
    if (sa !== sb) {
        return sb > sa ? b : a;
    }
    const fa = freshness(a);
    const fb = freshness(b);
    if (fa !== fb) {
        return fb > fa ? b : a;
    }
    return b;   // 完全一样就取新的
}

/** 兼容旧名字（内部还有别处在用 richer 的语义） */
function richer(a, b) {
    return pickFresher(a, b);
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
