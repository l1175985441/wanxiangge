/**
 * 万象阁 · 状态仓库（v3：世界状态／暗线／角色七格／平行事件／编年／日程／快照）
 *
 * 规矩：
 *   · 名册与账本**按聊天各分各的**（新聊天＝新世界，数据不串）；
 *   · 每个角色七格：年龄／身份／过去经历／正在经历／所在势力／好感／时间・地点；
 *   · 一切"会更新"的字段都带 manual 标记：手改过的，引擎⛔ 不许无脑冲掉；
 *   · 拿不到数据就留空或标"未知"，⛔ 绝不用占位值凑数；
 *   · 每次更新前留一版快照，能撤回。
 */

import {
    LEDGER_VERSION, RECALL_LOG_LIMIT, CHRONICLE_LIMIT, SNAPSHOT_KEEP, STAGES_CONFLICT, STAGES_PROGRESS,
} from './config.js';
import { readLedger, writeLedger, currentChatKey, setLiveLedgerGetter, snapshotLiveLedger, dropMirrorFor, deepClone, now } from './adapter.js';
import { makeId, toList, trimText, asText, countChars } from './utils.js';
import { parseClock } from './clock.js';

/* ------------------------------ 人物 ------------------------------ */

/** 人物记录的标准结构（缺键补齐，多余的键保留） */
export function normalizeCharacter(raw) {
    const c = raw && typeof raw === 'object' ? raw : {};
    return {
        id: trimText(c.id) || makeId('wxg'),
        name: trimText(c.name),
        aliases: toList(c.aliases),
        faction: trimText(c.faction),
        affinity: trimText(c.affinity),      // 读自"手机"，不自己加减
        affinitySource: trimText(c.affinitySource),
        age: trimText(c.age),
        identity: trimText(c.identity),
        past: Array.isArray(c.past) ? c.past.filter(Boolean).map((p) => ({
            text: trimText(p && p.text),
            injected: (p && p.injected) === true,
            at: Number((p && p.at) || 0),
            manual: (p && p.manual) === true,
            // ⭐ 来源楼层（"楼层裁"用）：老数据没有就是 undefined ⇒ 当很老、照端
            fromFloor: Number.isFinite(Number(p && p.fromFloor)) ? Number(p.fromFloor) : undefined,
        })).filter((p) => p.text) : [],
        current: trimText(c.current),
        timePlace: trimText(c.timePlace),
        schedule: Array.isArray(c.schedule) ? c.schedule.filter(Boolean).map((s) => ({
            what: trimText(s && s.what),
            due: trimText(s && s.due),
            done: (s && s.done) === true,
        })).filter((s) => s.what) : [],
        // ⭐ 任务（主线／支线）：目标层——"他在追什么"，⛔ 不是"下一步做什么"
        quests: Array.isArray(c.quests) ? c.quests.filter(Boolean).map((q) => ({
            kind: trimText(q && q.kind) === 'main' ? 'main' : 'side',
            title: trimText(q && q.title),
            status: ['活跃', '完成', '搁置'].includes(trimText(q && q.status)) ? trimText(q && q.status) : '活跃',
            note: trimText(q && q.note),
            items: Array.isArray(q && q.items) ? q.items.filter(Boolean).map((i) => ({
                text: trimText(i && i.text),
                done: (i && i.done) === true,
            })).filter((i) => i.text) : [],
            at: Number((q && q.at) || 0),
            updatedAt: Number((q && q.updatedAt) || 0),
            manual: (q && q.manual) === true,
        })).filter((q) => q.title) : [],
        inScene: c.inScene === true,
        isPlayer: c.isPlayer === true,
        isNew: c.isNew === true,
        manual: c.manual === true,           // 用户手改过（引擎要认）
        ignored: c.ignored === true,
        steps: Array.isArray(c.steps) ? c.steps.map((s) => ({
            text: trimText(s && s.text),
            at: Number((s && s.at) || 0),
            floor: Number.isFinite(s && s.floor) ? s.floor : -1,
        })).filter((s) => s.text) : [],
        lastSeenFloor: Number.isFinite(c.lastSeenFloor) ? c.lastSeenFloor : -1,
        lastUpdatedAt: Number(c.lastUpdatedAt || 0),
        createdAt: c.createdAt || now(),
        updatedAt: c.updatedAt || now(),
    };
}

/**
 * 老数据迁移：以前存过"推断（infer）"这一格 —— 按需求书这一格**不该存在**
 * （她定的角色字段只有七格：年龄／身份／过去经历／正在经历／所在势力／好感值／时间・地点）。
 * ⛔ 不静默丢：把它搬进**编年**留档（标注来源），再从角色身上摘掉。
 *
 * ⚠️⚠️ 这里必须走**原始账本**（`readLedger`），⛔ **不能走 `loadState()`**：
 *   `loadState()` → `normalizeState()` → `normalizeCharacter()` 是**白名单构造**，
 *   白名单里已经没有 `infer` ⇒ 读进来那一刻就洗掉了，而且 `loadState()` 末尾会**立刻回写盘**
 *   ⇒ 等这个循环去读 `c.infer` 时早没了（＝"白名单洗掉 ＋ load 回写"的**双料静默丢**）。
 *   （阿砚在试验田全链实证过：`moved=0`、编年 0 条、盘上 infer 也没了。）
 *
 * @returns {number} 搬走了几条
 */
export function migrateInferToChronicle() {
    let raw = null;
    try {
        raw = readLedger();
    } catch (e) {
        return 0;
    }
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.characters)) {
        return 0;
    }
    if (!Array.isArray(raw.chronicle)) {
        raw.chronicle = [];   // 保底建数组
    }
    let moved = 0;
    for (const c of raw.characters) {
        if (!c || typeof c !== 'object') {
            continue;
        }
        const text = trimText(c.infer);
        if (!text) {
            if (Object.hasOwn(c, 'infer')) {
                delete c.infer;   // 空值顺手摘掉（不算"搬走一条"）
            }
            continue;
        }
        raw.chronicle.push({
            at: now(),
            floor: Number.isFinite(Number(c.lastSeenFloor)) ? Number(c.lastSeenFloor) : -1,
            kind: '推断·已归入编年',
            who: trimText(c.name),
            text: '（以前存过的推断，现已不再作为角色字段）' + text,
        });
        delete c.infer;
        moved += 1;
    }
    if (moved) {
        // 写回**同一本源**（可能是底稿那本更全的账——照它改、写回去，⛔ 不换源）
        writeLedger(raw);
        // 内存里可能已经建过缓存（还是老账）⇒ 掀掉，下次读会重新从盘上取
        resetCache();
    }
    return moved;
}

/** 造一条空人物 */
export function createCharacter(name, extra) {
    return normalizeCharacter(Object.assign({ name: trimText(name) }, extra || {}));
}

/* ------------------------------ 账本 ------------------------------ */

function emptyState() {
    return {
        version: LEDGER_VERSION,
        chatKey: '',
        characters: [],
        world: {
            bigPicture: '',
            situations: [],      // 势力的碰撞：{title, sides, tier, at, floor}
            hidden: [],          // 暗线：{id, name, stage, kind, trigger, tier, note, log[], manual}
            clock: '',           // 世界内时间（只有钟是准的）
            place: '',
            updatedAt: 0,
            manual: false,
        },
        events: [],              // 召回用的世界事件（由世界状态派生，带有效期）
        chronicle: [],           // 编年：只给她看，不注入、不喂模型
        lastUpdate: { at: 0, status: 'idle', note: '' },
        pipeline: {              // 更新流水（失败可见＋重试上限）
            kind: '',
            status: 'idle',      // idle｜running｜ok｜failed｜cancelled
            step: '',
            startedAt: 0,
            endedAt: 0,
            tries: 0,
            error: '',
            text: '',
            cursor: 0,
            atFloor: -1,
            cancelRequested: false,
        },
        recallRecords: [],       // 每轮召回（卡片＋过程报告）
        snapshots: [],           // 撤回用的快照
        newPeople: [],           // 新认的人（面板上看得见）
        stat: { recalled: 0, injected: 0, empty: 0, updates: 0 },
    };
}

/** 兼容旧版本格式：缺什么补什么，多出来的键保留（旧格式读得回） */
function normalizeState(raw) {
    const base = emptyState();
    const s = raw && typeof raw === 'object' ? raw : {};
    const state = Object.assign(base, s);
    state.version = LEDGER_VERSION;
    state.chatKey = s.chatKey === undefined || s.chatKey === null ? '' : String(s.chatKey);
    state.characters = Array.isArray(s.characters) ? s.characters.map(normalizeCharacter) : [];
    state.world = Object.assign(base.world, s.world && typeof s.world === 'object' ? s.world : {});
    state.world.situations = Array.isArray(state.world.situations) ? state.world.situations : [];
    state.world.hidden = Array.isArray(state.world.hidden) ? state.world.hidden.map((h) => Object.assign({
        id: makeId('line'),
        name: '',
        stage: '萌芽',
        kind: 'conflict',
        trigger: '',
        tier: '几天内',
        note: '',
        log: [],
        manual: false,
        updatedAt: 0,
    }, h || {})) : [];
    state.lastUpdate = Object.assign(base.lastUpdate, s.lastUpdate && typeof s.lastUpdate === 'object' ? s.lastUpdate : {});
    state.pipeline = Object.assign(base.pipeline, s.pipeline && typeof s.pipeline === 'object' ? s.pipeline : {});
    state.recallRecords = Array.isArray(s.recallRecords) ? s.recallRecords.filter((r) => r && typeof r === 'object') : [];
    state.events = Array.isArray(s.events) ? s.events : [];
    state.chronicle = Array.isArray(s.chronicle) ? s.chronicle.filter((c) => c && typeof c === 'object') : [];
    state.snapshots = Array.isArray(s.snapshots) ? s.snapshots.filter((x) => x && typeof x === 'object') : [];
    state.newPeople = Array.isArray(s.newPeople) ? s.newPeople.map(trimText).filter(Boolean) : [];
    state.stat = Object.assign(base.stat, s.stat && typeof s.stat === 'object' ? s.stat : {});
    return state;
}

let cache = null;
let cacheKey = null;

/** 取当前聊天的账本（换聊天自动换一份） */
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

/** 换聊天时把缓存掀掉（掀之前先留底） */
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

/** 摘掉一本账（和它没来得及落盘的底稿一起扔） */
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

/* ------------------------------ 人物管理 ------------------------------ */

export function getRoster() {
    return loadState().characters;
}

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

/** 批量加人 */
export function addCharacters(names, extra) {
    const state = loadState();
    const existing = new Set(state.characters.map((c) => c.name));
    let added = 0;
    for (const name of toList(names)) {
        if (existing.has(name)) {
            continue;
        }
        state.characters.push(createCharacter(name, extra));
        existing.add(name);
        added += 1;
    }
    if (added) {
        saveState();
    }
    return added;
}

/** 一键盘入预设名册 */
export function applyRosterPreset(preset) {
    return addCharacters(preset || []);
}

export function findCharacter(id) {
    return getRoster().find((c) => c.id === id) || null;
}

export function findCharacterByName(name) {
    const key = trimText(name).toLowerCase();
    if (!key) {
        return null;
    }
    return getRoster().find((c) => c.name.toLowerCase() === key
        || c.aliases.some((a) => a.toLowerCase() === key)) || null;
}

/** 改一个人物（手改自动打"已手动修改"标记） */
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

export function removeCharacter(id) {
    const state = loadState();
    const before = state.characters.length;
    state.characters = state.characters.filter((c) => c.id !== id);
    state.newPeople = state.newPeople.filter((n) => !state.characters.some((c) => c.name === n));
    saveState();
    return state.characters.length < before;
}

/** 记一条"这一步"（平行线的留档，同时进编年） */
export function pushStep(characterId, text, floor) {
    const state = loadState();
    const c = state.characters.find((x) => x.id === characterId);
    const body = trimText(text);
    if (!c || !body) {
        return false;
    }
    const last = c.steps[c.steps.length - 1];
    if (last && last.text === body) {
        return false;   // 同一句话不重复记
    }
    c.steps.push({ text: body, at: now(), floor: Number.isFinite(floor) ? floor : -1 });
    if (c.steps.length > 60) {
        c.steps = c.steps.slice(-60);
    }
    saveState();
    return true;
}

/**
 * 往"过去经历"里推一条（最新的在最前面）。
 * 旧的由近到远自然淡化（软处理，⛔ 不物理删——淡出的落进编年留档）。
 *
 * @param {string} characterId 角色 id
 * @param {string} text 经历正文
 * @param {number} cap 最多留几条
 * @param {number} [fromFloor] ⭐ 这条经历的**来源楼层**（第几楼推出来的）
 *   —— 注入时按它做"楼层裁"：最近 N 楼之内的不端（主模型上下文里已经有了），只端 N 楼之外的。
 *   ⚠️ 老数据没有来源楼层 ⇒ 当"很老"处理（照端，⛔ 不丢）。
 */
/**
 * 任务（主线／支线）：按"角色 + 标题"合并——同名更新状态／子项，不同名就是新任务。
 *
 * 口径（她与我方复核方一起拍的）：任务＝**目标层**（他在追什么），⛔ 不是"下一步动作"。
 * 子项里写"下一步／明天去…"这类会被退化检查挡下来（⛔ 不静默）。
 *
 * @returns {object|null} 落进去的那条任务
 */
export function upsertQuest(characterId, quest) {
    const state = loadState();
    const c = state.characters.find((x) => x.id === characterId);
    const title = trimText(quest && quest.title);
    if (!c || !title) {
        return null;
    }
    const kind = trimText(quest.kind) === 'main' ? 'main' : 'side';
    const status = ['活跃', '完成', '搁置'].includes(trimText(quest.status)) ? trimText(quest.status) : '活跃';
    const note = trimText(quest.note);
    const items = Array.isArray(quest.items) ? quest.items.filter(Boolean).map((i) => ({
        text: trimText(i && i.text),
        done: (i && i.done) === true,
    })).filter((i) => i.text) : [];

    c.quests = Array.isArray(c.quests) ? c.quests : [];
    const existing = c.quests.find((q) => q.title === title);
    if (existing) {
        // 她手改过的：⛔ 引擎不覆盖（和别处一个规矩）
        if (existing.manual === true) {
            return existing;
        }
        existing.kind = kind;
        existing.status = status;
        existing.note = note || existing.note;
        // 子项合并：同名保留原状态，新出现的追加
        const merged = [];
        for (const it of existing.items || []) {
            const hit = items.find((n) => n.text === it.text);
            merged.push(hit || it);
        }
        for (const it of items) {
            if (!merged.some((m) => m.text === it.text)) {
                merged.push(it);
            }
        }
        existing.items = merged;
        existing.updatedAt = now();
        saveState();
        return existing;
    }
    const fresh = {
        kind,
        title,
        status,
        note,
        items,
        at: now(),
        updatedAt: now(),
        manual: quest.manual === true,
    };
    c.quests.push(fresh);
    // 容量锁：一个角色最多 12 条（先丢"搁置／完成"里最早的那条）
    if (c.quests.length > 12) {
        const dropFirst = c.quests.findIndex((q) => q.status !== '活跃');
        c.quests.splice(dropFirst >= 0 ? dropFirst : 0, 1);
    }
    saveState();
    return fresh;
}

/** 她手动改一条任务（改完打 manual，引擎不再覆盖） */
export function updateQuest(characterId, title, patch) {
    const state = loadState();
    const c = state.characters.find((x) => x.id === characterId);
    if (!c || !Array.isArray(c.quests)) {
        return null;
    }
    const q = c.quests.find((x) => x.title === trimText(title));
    if (!q) {
        return null;
    }
    Object.assign(q, patch || {}, { manual: true, updatedAt: now() });
    saveState();
    return q;
}

/** 删一条任务 */
export function removeQuest(characterId, title) {
    const state = loadState();
    const c = state.characters.find((x) => x.id === characterId);
    if (!c || !Array.isArray(c.quests)) {
        return false;
    }
    const before = c.quests.length;
    c.quests = c.quests.filter((q) => q.title !== trimText(title));
    if (c.quests.length !== before) {
        saveState();
        return true;
    }
    return false;
}

/**
 * 往"过去经历"里推一条（最新的在最前面）；旧的由近到远自然淡化（⛔ 不物理删，淡出的落编年）。
 *
 * @param {string} characterId 角色 id
 * @param {string} text 经历正文
 * @param {number} cap 最多留几条
 * @param {number} [fromFloor] ⭐ 来源楼层（第几楼推出来的）——"楼层裁"按它算距离：
 *   最近 N 楼之内的不端（主模型上下文里已有），只端更老的。
 *   ⚠️ 老数据没有来源楼层 ⇒ 当"很老"、照端（⛔ 不丢）。
 */
export function pushPast(characterId, text, cap, fromFloor) {
    const state = loadState();
    const c = state.characters.find((x) => x.id === characterId);
    const body = trimText(text);
    if (!c || !body) {
        return false;
    }
    const floor = Number(fromFloor);
    const entry = {
        text: body,
        injected: false,
        at: now(),
        manual: false,
    };
    if (Number.isFinite(floor) && floor >= 0) {
        entry.fromFloor = Math.trunc(floor);
    }
    c.past = c.past.filter((p) => p.text !== body);
    c.past.unshift(entry);
    const limit = Number.isFinite(cap) && cap > 0 ? Math.trunc(cap) : 5;
    if (c.past.length > limit) {
        const faded = c.past.slice(limit);
        c.past = c.past.slice(0, limit);
        // 淡出的不物理删：落进编年留档（她能回看）
        for (const f of faded) {
            state.chronicle.push({
                at: f.at || now(),
                floor: Number.isFinite(Number(f.fromFloor)) ? Number(f.fromFloor) : c.lastSeenFloor,
                kind: '过去经历·淡化',
                who: c.name,
                text: f.text,
                manual: f.manual === true,
            });
        }
    }
    saveState();
    return true;
}

/* ------------------------------ 世界状态与暗线 ------------------------------ */

export function updateWorld(patch, options) {
    const state = loadState();
    const w = state.world;
    const opts = options || {};
    Object.assign(w, patch || {});
    w.updatedAt = now();
    w.manual = opts.manual === true ? true : w.manual === true;
    saveState();
    return w;
}

/** 推进（或新增）一条暗线 */
export function upsertHidden(line) {
    const state = loadState();
    const name = trimText(line && line.name);
    if (!name) {
        return null;
    }
    // ⭐ 建线时把"起算点"记下来（⛔ 不然"N 天后""长线大势"永远不会到点）：
    //    sinceDay＝建线时世界钟的第几天；sinceMinutes＝建线时世界钟的绝对分钟。
    const clockNow = parseClock(state.world.clock);
    const sinceDayNow = clockNow.has ? (clockNow.day === null ? 1 : clockNow.day) : null;
    const sinceMinutesNow = clockNow.has ? ((clockNow.day === null ? 1 : clockNow.day) * 1440 + (clockNow.minutesOfDay || 0)) : null;

    const existing = state.world.hidden.find((h) => h.name === name);
    if (existing) {
        const before = existing.stage;
        const newStage = trimText(line.stage) || existing.stage;
        // ⭐ 族类不许被"没给"冲掉（条 1 的连带）：给了就用给的，没给就沿用原来的，
        //    再没有才按阶段名推断——否则推进型的阶段表会被悄悄换成冲突型。
        const kindGiven = trimText(line.kind);
        const inferredKind = STAGES_PROGRESS.includes(newStage) ? 'progress'
            : (STAGES_CONFLICT.includes(newStage) ? 'conflict' : '');
        const newKind = kindGiven || trimText(existing.kind) || inferredKind || 'conflict';
        Object.assign(existing, {
            stage: newStage,
            kind: newKind,
            trigger: trimText(line.trigger) || existing.trigger,
            tier: trimText(line.tier) || existing.tier,
            note: trimText(line.note) || existing.note,
            updatedAt: now(),
        });
        // 补齐起算点（老数据没有的话补上，⛔ 已有的不覆盖——覆盖等于把时间表往后推）
        if (!Number.isFinite(Number(existing.sinceDay)) && Number.isFinite(sinceDayNow)) {
            existing.sinceDay = sinceDayNow;
        }
        if (!Number.isFinite(Number(existing.sinceMinutes)) && Number.isFinite(sinceMinutesNow)) {
            existing.sinceMinutes = sinceMinutesNow;
        }
        if (before !== existing.stage) {
            existing.log = Array.isArray(existing.log) ? existing.log : [];
            existing.log.push({ at: now(), stage: existing.stage, note: existing.note });
        }
        saveState();
        return existing;
    }
    const stageNow = trimText(line.stage) || '萌芽';
    // 没给族类就按阶段名推断（"执行／关键"属于推进型，⛔ 别一律当成冲突型）
    const inferred = STAGES_PROGRESS.includes(stageNow) ? 'progress' : 'conflict';
    const fresh = {
        id: makeId('line'),
        name,
        stage: stageNow,
        kind: trimText(line.kind) || inferred,
        trigger: trimText(line.trigger),
        tier: trimText(line.tier) || '几天内',
        note: trimText(line.note),
        sinceDay: Number.isFinite(sinceDayNow) ? sinceDayNow : null,
        sinceMinutes: Number.isFinite(sinceMinutesNow) ? sinceMinutesNow : null,
        log: [],
        manual: line.manual === true,
        updatedAt: now(),
    };
    state.world.hidden.push(fresh);
    capList(state.world.hidden, 'capHidden', (h) => h.name);
    saveState();
    return fresh;
}

/** 她自己加暗线 */
export function addHiddenManually(line) {
    return upsertHidden(Object.assign({}, line, { manual: true }));
}

export function removeHidden(id) {
    const state = loadState();
    const before = state.world.hidden.length;
    state.world.hidden = state.world.hidden.filter((h) => h.id !== id);
    if (state.world.hidden.length !== before) {
        saveState();
        return true;
    }
    return false;
}

/** 世界事件（召回用）：带有效期与来源 */
export function setEvents(events) {
    const state = loadState();
    state.events = (Array.isArray(events) ? events : []).map((e) => ({
        id: trimText(e.id) || makeId('ev'),
        title: trimText(e.title),
        text: trimText(e.text),
        kind: trimText(e.kind) || 'situation',   // situation｜hidden
        sides: trimText(e.sides),
        tier: trimText(e.tier),
        stage: trimText(e.stage),
        at: Number(e.at || now()),
        floor: Number.isFinite(e.floor) ? e.floor : -1,
        manual: e.manual === true,
    })).filter((e) => e.title || e.text);
    capList(state.events, 'capEvents', (e) => e.id, (e) => e.manual);
    saveState();
    return state.events;
}

/* ------------------------------ 编年 ------------------------------ */

/** 往编年添一条（只给她看，⛔ 不注入、不喂模型） */
export function addChronicle(entry) {
    const state = loadState();
    const text = trimText(entry && entry.text);
    if (!text) {
        return null;
    }
    const row = {
        at: Number(entry.at || now()),
        floor: Number.isFinite(entry.floor) ? entry.floor : -1,
        kind: trimText(entry.kind) || '推演',
        who: trimText(entry.who),
        text,
        manual: entry.manual === true,
    };
    if (entry.clock) {
        row.clock = trimText(entry.clock);
    }
    const last = state.chronicle[state.chronicle.length - 1];
    if (last && last.text === row.text && last.who === row.who && last.kind === row.kind) {
        return null;   // 同一句话不重复记
    }
    state.chronicle.push(row);
    // ⚠️ 上限要取**她配的那个数**（`LIMITS.capChronicle`，界面上能改），
    //    ⛔ 不是写死的常量——以前用的是 `CHRONICLE_LIMIT`，她改设置根本不起作用。
    const chronCap = Number(LIMITS.capChronicle || CHRONICLE_LIMIT);
    if (state.chronicle.length > chronCap) {
        // ⭐ 容量锁（需求书：到上限用归并／淡出，⛔ 不物理删除；⛔ 不许无限膨胀）
        //    "旧的要能捞回来"由**世界书归档**兜底（book.js 把编年全量分页写进世界书）。
        // ⚠️ 标记要打在**活下来的那几条最老的**身上——
        //    以前是给"马上要被 slice 掉的那批"标 ⇒ **标记全打在即将删除的元素上，等于白标**，
        //    她永远看不到"哪些已经归档走了"。
        state.chronicle = state.chronicle.slice(-chronCap);
        const marker = state.chronicle[0];
        if (marker && marker.faded !== true) {
            marker.faded = true;   // 留个痕：这条前面的都已经归档进世界书了
        }
    }
    saveState();
    return row;
}

export function getChronicle() {
    return loadState().chronicle;
}

/* ------------------------------ 召回记录 ------------------------------ */

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
        injectStatus: 'pending',
        injectNote: '',
        injectedChars: 0,
        injectType: '',
        injectAs: '',
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

export function getRecallRecord(floor) {
    return loadState().recallRecords.find((r) => r && r.floor === floor) || null;
}

export function getRecallRecordById(mesId) {
    const key = trimText(mesId);
    if (!key) {
        return null;
    }
    return loadState().recallRecords.find((r) => r && trimText(r.mesId) === key) || null;
}

export function recentRecallRecords(limit) {
    const n = Number.isFinite(limit) && limit > 0 ? Math.trunc(limit) : 20;
    const list = loadState().recallRecords.filter(Boolean);
    const sorted = list.slice().sort((a, b) => (Number(b.at) || 0) - (Number(a.at) || 0));
    return sorted.slice(0, n);
}

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

/** 清掉楼层号超出现有聊天长度的记录（软保护：拿不到长度就不动手） */
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

/* ------------------------------ 快照与撤回 ------------------------------ */

/** 撤回时要一起存/一起还原的那几样（⛔ 不含 recallRecords：那是召回日志，撤回更新不该抹掉它） */
function snapshotPayload(state) {
    return deepClone({
        characters: state.characters,
        world: state.world,
        events: state.events,
        chronicle: state.chronicle.slice(-120),
        newPeople: state.newPeople,   // 自审修正·条 25：新认的人也要能撤回（否则徽章残留）
        stat: state.stat,
    });
}

/** 更新前留底（撤回用） */
export function takeSnapshot(label) {
    const state = loadState();
    const snap = {
        at: now(),
        label: trimText(label) || '更新前',
        data: snapshotPayload(state),
    };
    state.snapshots.push(snap);
    if (state.snapshots.length > SNAPSHOT_KEEP) {
        state.snapshots = state.snapshots.slice(-SNAPSHOT_KEEP);
    }
    saveState();
    return snap;
}

/** 撤回上一次更新 */
export function rollbackLast() {
    const state = loadState();
    const snap = state.snapshots.pop();
    if (!snap || !snap.data) {
        saveState();
        return null;
    }
    // 撤回也要留一手：把"撤之前"的当前状态再压一版，撤错了能再撤回来
    const undo = snapshotPayload(state);
    state.characters = snap.data.characters || [];
    state.world = snap.data.world || state.world;
    state.events = snap.data.events || [];
    state.chronicle = Array.isArray(snap.data.chronicle) ? snap.data.chronicle : state.chronicle;
    if (Array.isArray(snap.data.newPeople)) {
        state.newPeople = snap.data.newPeople;
    }
    state.stat = snap.data.stat || state.stat;
    state.snapshots.push({ at: now(), label: '撤回前（可再撤回）', data: undo });
    if (state.snapshots.length > SNAPSHOT_KEEP) {
        state.snapshots = state.snapshots.slice(-SNAPSHOT_KEEP);
    }
    saveState();
    return snap;
}

export function snapshotCount() {
    return loadState().snapshots.length;
}

/* ------------------------------ 容量锁（软处理） ------------------------------ */

/** 到上限就归并／淡出，⛔ 不物理删（旧的进编年留档） */
export function capList(list, capKey, keyFn, keepFn) {
    const state = loadState();
    const cap = Number(LIMITS[capKey] || 60);
    if (!Array.isArray(list) || list.length <= cap) {
        return 0;
    }
    const over = list.length - cap;
    const removed = [];
    for (let i = 0; i < over; i += 1) {
        if (keepFn && keepFn(list[i])) {
            continue;   // 手改过的优先留着
        }
        removed.push(list[i]);
    }
    if (removed.length) {
        for (const r of removed) {
            const idx = list.indexOf(r);
            if (idx >= 0) {
                list.splice(idx, 1);
            }
            state.chronicle.push({
                at: now(),
                floor: -1,
                kind: '归并·淡出',
                who: '',
                text: trimText(r.title || r.name || r.text || r.id || '（旧条目）'),
                manual: r.manual === true,
            });
        }
        saveState();
    }
    return removed.length;
}

/** 上限值（由 settings 注入，避免这里 import 设置层造成环） */
export const LIMITS = { capEvents: 60, capHidden: 40 };

export function setLimits(limits) {
    Object.assign(LIMITS, limits || {});
}

/* ------------------------------ 导出与统计 ------------------------------ */

export function exportState() {
    return deepClone(loadState());
}

export function describeRoster() {
    const roster = getRoster();
    return {
        total: roster.length,
        players: roster.filter((c) => c.isPlayer).length,
        newest: roster.length ? asText(roster[roster.length - 1].name) : '',
    };
}

/** 面板上用的一眼统计 */
export function describeWorld() {
    const state = loadState();
    const hidden = state.world.hidden || [];
    return {
        clock: trimText(state.world.clock) || '未知',
        place: trimText(state.world.place),
        situations: (state.world.situations || []).length,
        hidden: hidden.length,
        advancing: hidden.filter((h) => h.stage && h.stage !== '消散' && h.stage !== '完成').length,
        chronological: state.chronicle.length,
        updatedAt: state.world.updatedAt,
    };
}

/** 空账判断（面板显示用） */
export function hasAnything() {
    const state = loadState();
    return state.characters.length > 0
        || state.recallRecords.length > 0
        || state.chronicle.length > 0
        || (state.world.situations || []).length > 0
        || (state.world.hidden || []).length > 0;
}

/** 角色过去的经历条数（给她一眼看容量） */
export function pastCount(characterId) {
    const c = findCharacter(characterId);
    return c ? c.past.length : 0;
}

/** 一条文本的字数（面板显示用） */
export function textSize(text) {
    return countChars(text);
}

/** 账本里最多留多少轮召回记录（面板／自测看得到） */
export const recallLogLimit = RECALL_LOG_LIMIT;
