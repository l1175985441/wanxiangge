/**
 * 万象阁 · 状态仓库
 *
 * 人物名册 ＝按聊天各分各的（新聊天＝新世界）。
 * 本轮（第 1-2 步）只做"名册 + 别名 + 好感字段"；年龄／身份／过去经历／正在经历／
 * 势力／时间地点这些格子先建好、能存、卡片上能显示，等到第 3 步由推演写入。
 */

import { LEDGER_VERSION, RECALL_LOG_LIMIT, ROSTER_PRESET } from './config.js';
import { readLedger, writeLedger, currentChatKey, setLiveLedgerGetter, snapshotLiveLedger, dropMirrorFor, deepClone, now } from './adapter.js';
import { makeId, toList, trimText, asText } from './utils.js';

/** 人物记录的标准结构（缺键补齐，多余的键保留） */
export function normalizeCharacter(raw) {
    const c = raw && typeof raw === 'object' ? raw : {};
    return {
        id: trimText(c.id) || makeId('wxg'),
        name: trimText(c.name),
        aliases: toList(c.aliases),
        faction: trimText(c.faction),
        affinity: trimText(c.affinity),      // 读自"手机"，不自己加减（第 4 步接真数据源）
        affinitySource: trimText(c.affinitySource),
        age: trimText(c.age),
        identity: trimText(c.identity),
        past: Array.isArray(c.past) ? c.past.filter(Boolean).map((p) => ({
            text: trimText(p && p.text),
            injected: (p && p.injected) === true,
        })).filter((p) => p.text) : [],
        current: trimText(c.current),
        timePlace: trimText(c.timePlace),
        isPlayer: c.isPlayer === true,
        isNew: c.isNew === true,
        manual: c.manual === true,
        ignored: c.ignored === true,
        createdAt: c.createdAt || now(),
        updatedAt: c.updatedAt || now(),
    };
}

/** 造一条空人物 */
export function createCharacter(name, extra) {
    return normalizeCharacter(Object.assign({ name: trimText(name) }, extra || {}));
}

function emptyState() {
    return {
        version: LEDGER_VERSION,
        chatKey: '',            // 盖个章：这本账属于哪个聊天（换聊天时的保险丝）
        characters: [],
        world: {
            situations: [],
            hidden: [],
            clock: '',
            place: '',
            updatedAt: 0,
        },
        lastUpdate: {
            at: 0,
            status: 'idle',     // idle｜ok｜failed｜running
            note: '',
        },
        recallRecords: [],
        events: [],
        chronicle: [],
        newPeople: [],
        stat: {
            recalled: 0,
            injected: 0,
            empty: 0,
        },
        snapshot: null,          // 上一版留底（撤回用，第 6 步接上）
    };
}

/** 兼容旧版本格式：缺什么补什么，多出来的键保留 */
function normalizeState(raw) {
    const base = emptyState();
    const s = raw && typeof raw === 'object' ? raw : {};
    const state = Object.assign(base, s);
    state.version = LEDGER_VERSION;
    state.chatKey = s.chatKey === undefined || s.chatKey === null ? '' : String(s.chatKey);
    state.characters = Array.isArray(s.characters) ? s.characters.map(normalizeCharacter) : [];
    state.world = Object.assign(base.world, s.world && typeof s.world === 'object' ? s.world : {});
    state.lastUpdate = Object.assign(base.lastUpdate, s.lastUpdate && typeof s.lastUpdate === 'object' ? s.lastUpdate : {});
    state.recallRecords = Array.isArray(s.recallRecords) ? s.recallRecords.filter((r) => r && typeof r === 'object') : [];
    state.events = Array.isArray(s.events) ? s.events : [];
    state.chronicle = Array.isArray(s.chronicle) ? s.chronicle : [];
    state.newPeople = Array.isArray(s.newPeople) ? s.newPeople.map(trimText).filter(Boolean) : [];
    state.stat = Object.assign(base.stat, s.stat && typeof s.stat === 'object' ? s.stat : {});
    return state;
}

let cache = null;
let cacheKey = null;

/** 取当前聊天的账本（换聊天自动换一份；拿不到就内存兜底） */
export function loadState() {
    const key = currentChatKey();
    if (cache && cacheKey === key) {
        return cache;
    }
    const raw = readLedger();
    cache = normalizeState(raw);
    cacheKey = key;
    writeLedger(cache);
    return cache;
}

/** 存账本 */
export function saveState() {
    const state = loadState();
    state.version = LEDGER_VERSION;
    writeLedger(state);
}

// 告诉适配层"现在内存里那本账是谁"（换聊天时它要把最新样子留个底）
setLiveLedgerGetter(() => cache);

/**
 * 换聊天时把缓存掀掉（由入口在 CHAT_CHANGED 时调用）。
 * ⭐ 掀之前先把手里这本账**完整留个底**——不然切走就找不回来了。
 */
export function resetCache() {
    if (cache) {
        try {
            snapshotLiveLedger();
        } catch (e) {
            console.warn('[万象阁] 留底出错：', e);
        }
    }
    cache = null;
    cacheKey = null;
}

/** 摘掉一本账（和它没来得及落盘的底稿一起扔），但留在底稿里的老版本不动 */
export function discardLedger(state) {
    if (!state || typeof state !== 'object') {
        return;
    }
    try {
        dropMirrorFor(currentChatKey(), state);
    } catch (e) {
        console.warn('[万象阁] 摘账出错：', e);
    }
}

/** 人物名册 */
export function getRoster() {
    return loadState().characters;
}

/** 加一个人物 */
export function addCharacter(name, extra) {
    const state = loadState();
    const c = createCharacter(name, extra);
    if (!c.name) {
        return null;
    }
    state.characters.push(c);
    saveState();
    return c;
}

/** 一键盘入预设名册（已有的不重复加） */
export function applyRosterPreset() {
    const state = loadState();
    const existing = new Set(state.characters.map((c) => c.name));
    let added = 0;
    for (const name of ROSTER_PRESET) {
        if (existing.has(name)) {
            continue;
        }
        state.characters.push(createCharacter(name));
        existing.add(name);
        added += 1;
    }
    saveState();
    return added;
}

/** 按 id 找人 */
export function findCharacter(id) {
    return getRoster().find((c) => c.id === id) || null;
}

/** 改一个人物（只覆盖传进来的键；手改过的自动打"已手动修改"标记） */
export function updateCharacter(id, patch) {
    const state = loadState();
    const idx = state.characters.findIndex((c) => c.id === id);
    if (idx < 0) {
        return null;
    }
    const merged = Object.assign({}, state.characters[idx], patch || {});
    if (patch && Object.hasOwn(patch, 'aliases')) {
        merged.aliases = toList(patch.aliases);
    }
    merged.updatedAt = now();
    merged.manual = patch && Object.hasOwn(patch, 'manual') ? patch.manual === true : true;
    state.characters[idx] = normalizeCharacter(merged);
    saveState();
    return state.characters[idx];
}

/** 删一个人物 */
export function removeCharacter(id) {
    const state = loadState();
    const before = state.characters.length;
    state.characters = state.characters.filter((c) => c.id !== id);
    saveState();
    return state.characters.length < before;
}

/* ---------- 召回记录（卡片与注入共用同一份：一份数据、两个面） ---------- */

/**
 * 记一次召回：先算好存下来，注入时照它送，卡片也照它显示。
 * 认账以 mesId 为准（楼层号在请求副本里会错开，mesId 才是这条消息的身份证）。
 */
export function putRecallRecord(record) {
    const state = loadState();
    const rec = Object.assign({
        floor: -1,
        mesId: '',
        at: now(),
        lead: '',
        from: '',
        items: [],
        events: [],
        chars: [],
        notes: [],
        injectedText: '',
        injectedAt: 0,
        injectStatus: 'pending',   // pending｜ok｜empty｜error
        injectNote: '',
        injectedChars: 0,
        injectType: '',
        shown: false,
    }, record || {});

    const mesId = trimText(rec.mesId);
    let idx = -1;
    if (mesId) {
        idx = state.recallRecords.findIndex((r) => r && trimText(r.mesId) === mesId);
    }
    if (idx < 0 && Number.isFinite(rec.floor) && rec.floor >= 0) {
        idx = state.recallRecords.findIndex((r) => r && r.floor === rec.floor && !trimText(r.mesId));
    }
    if (idx >= 0) {
        state.recallRecords[idx] = rec;
    } else {
        state.recallRecords.push(rec);
    }
    if (state.recallRecords.length > RECALL_LOG_LIMIT) {
        state.recallRecords = state.recallRecords.slice(-RECALL_LOG_LIMIT);
    }
    state.stat.recalled = Number(state.stat.recalled || 0) + 1;
    saveState();
    return rec;
}

/** 取某楼层的召回记录 */
export function getRecallRecord(floor) {
    return loadState().recallRecords.find((r) => r && r.floor === floor) || null;
}

/** 按消息身份证取召回记录 */
export function getRecallRecordById(mesId) {
    const key = trimText(mesId);
    if (!key) {
        return null;
    }
    return loadState().recallRecords.find((r) => r && trimText(r.mesId) === key) || null;
}

/** 取最近一条召回记录 */
export function getLatestRecallRecord() {
    const list = loadState().recallRecords;
    return list.length ? list[list.length - 1] : null;
}

/** 清掉某楼层的召回记录（楼层被删时对账用） */
export function dropRecallRecord(floor) {
    const state = loadState();
    const before = state.recallRecords.length;
    state.recallRecords = state.recallRecords.filter((r) => !r || r.floor !== floor);
    if (state.recallRecords.length !== before) {
        saveState();
        return true;
    }
    return false;
}

/** 清掉楼层号超出现有聊天长度的记录（软保护：拿不到聊天长度就不动手） */
export function pruneRecallRecords(chatLength, protectedFloor) {
    if (!Number.isFinite(chatLength) || chatLength <= 0) {
        return 0;
    }
    const state = loadState();
    const before = state.recallRecords.length;
    state.recallRecords = state.recallRecords.filter((r) => {
        if (!r) {
            return false;
        }
        if (protectedFloor !== undefined && r.floor === protectedFloor) {
            return true;
        }
        return r.floor >= 0 && r.floor < chatLength;
    });
    const removed = before - state.recallRecords.length;
    if (removed > 0) {
        saveState();
    }
    return removed;
}

/** 导出备份（只读，不改数据） */
export function exportState() {
    return deepClone(loadState());
}

/** 账本里最多留多少轮召回记录（给"过程报告"和自测看；超出丢最旧的） */
export const recallLogLimit = RECALL_LOG_LIMIT;

/** 取最近几轮的召回记录（**按时间从新到旧**，给「过程报告」用） */
export function recentRecallRecords(limit) {
    const n = Number.isFinite(limit) && limit > 0 ? Math.trunc(limit) : 20;
    const list = loadState().recallRecords.filter(Boolean);
    // 按时刻真排序（不靠插入顺序：被重算过的旧楼要落回它该在的位置）
    const sorted = list.slice().sort((a, b) => (Number(b.at) || 0) - (Number(a.at) || 0));
    return sorted.slice(0, n);
}

/** 一句话说明名册现状（面板上显示用） */
export function describeRoster() {
    const roster = getRoster();
    return {
        total: roster.length,
        players: roster.filter((c) => c.isPlayer).length,
        newest: roster.length ? asText(roster[roster.length - 1].name) : '',
    };
}
