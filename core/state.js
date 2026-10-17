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
    ARRIVE_MISS_LIMIT,
} from './config.js';
import { readLedger, writeLedger, currentChatKey, setLiveLedgerGetter, snapshotLiveLedger, dropMirrorFor, deepClone, now, personaNames, clearMirror, syncMirrorAfterDelete } from './adapter.js';
import { makeId, toList, trimText, asText, countChars, matchKey, eventTitle } from './utils.js';
import { parseClock } from './clock.js';

/* ------------------------------ 人物 ------------------------------ */

/** 角色身上支持按格锁定保护的状态字段 */
const STATUS_MANUAL_KEYS = ['age', 'identity', 'faction', 'affinity', 'timePlace', 'current'];

/** 人物记录的标准结构（缺键补齐，多余的键保留） */
export function normalizeCharacter(raw) {
    const c = raw && typeof raw === 'object' ? raw : {};
    const manualFields = Array.isArray(c.manualFields)
        ? c.manualFields.map(trimText).filter((k) => STATUS_MANUAL_KEYS.includes(k))
        : (c.manual === true ? STATUS_MANUAL_KEYS.filter((k) => Boolean(trimText(c[k]))) : []);
    return {
        id: trimText(c.id) || makeId('wxg'),
        name: trimText(c.name),
        aliases: toList(c.aliases),
        faction: trimText(c.faction),
        /*
         * ⭐⭐ 材料 06【6】③之二：**旧账里的非数字好感，升级后要自动清理** ✓
         *   旧：只 `trimText(c.affinity)` ✗ ⇒ 旧账里存着“未接入”／“本人”／“敌对”这种**文字** ✗
         *     ⇒ 每轮注入里照旧写出「好感：未接入（读自…）」 ✗（看着像个数值 ✗）
         *   现在：**只保留数字型**（含正负号与小数 ✓）；其余一律清成空 ✓
         *     ⇒ 注入时自然走到「好感：未接入数据源（不显示数值）」 ✓（她定的那句 ✓）
         */
        affinity: (function () {
            const av = trimText(c.affinity);
            return /^-?\d+(?:\.\d+)?$/.test(av) ? av : '';
        })(),
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
        /*
         * ⭐ 补①「参与后台推演」开关（她 2026-10-15 拍的）：**默认开**。
         *   开＝照现行规矩（现场只总结正文；不在场则进轮转被挑到就推）；
         *   关＝**不进轮转名单**（不在场时完全不推、不占名额），
         *       但他**仍在名册里**、**正文写出场时照旧处理**（现场逻辑不变）。
         *   ⛔ 关开关**不删历史**：旧记录、过去经历、编年全留。
         *
         * ⚠️ 存"关"而不是存"开"（`noBench`）：老数据里没这个字段 ⇒ 默认就是"参与轮转"，
         *   跟升级前行为**一模一样** ⇒ 老账不炸（若反过来存 `bench:true`，老数据缺字段会被当成"关"，
         *   那升级后所有人的后台推演会突然全停 —— 那就是事故）。
         * ⚠️ 必须在**白名单里**：`normalizeCharacter` 是挑字段的，不写进来会被洗掉。
         */
        noBench: c.noBench === true,
        /*
         * ⭐ 补③ 「认知账」（最小形态）：他**该知道的**清单。
         *   她定的：只收**发生过的、他碰得到的**（他经历的／被告知的／公开渠道的）；
         *   每条＝一句话 ＋ 来源（亲眼／被告知／公开）＋ 来源楼层；**只增不编**；拿不准的不进。
         *   ⚠️ 必须在**白名单里**（这里是挑字段的，不写就会被洗掉）。
         */
        knows: Array.isArray(c.knows) ? c.knows.filter(Boolean).map((k) => ({
            text: trimText(k && k.text),
            // 来源只认这三类（她定的）；认不出的归"公开"——⛔ 自己造第四类
            source: ['亲眼', '被告知', '公开'].includes(trimText(k && k.source)) ? trimText(k.source) : '公开',
            floor: Number.isFinite(Number(k && k.floor)) ? Number(k.floor) : -1,
            at: Number((k && k.at) || 0),
            manual: (k && k.manual) === true,
        })).filter((k) => k.text) : [],
        /*
         * ⚠️ 这个字段必须在**白名单里**：`normalizeCharacter` 是挑字段的，
         *    不写进来就会被洗掉——那"她取消勾玩家棋子"这件事下次读档就没了，
         *    自动识别又会把它勾回来（跟当初 `infer` 被洗掉是同一类坑，⛔ 别删）。
         */
        playerOff: c.playerOff === true,
        isNew: c.isNew === true,
        manual: c.manual === true,           // 用户手改过（引擎要认）
        manualFields,                        // 具体手改过哪几格（只护手改过的格，不冻全身）
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
 *   （复核方在试验田全链实证过：`moved=0`、编年 0 条、盘上 infer 也没了。）
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
        lastUpdate: { at: 0, status: 'idle', note: '', floor: -1 },
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
/*
 * ⭐⭐ 材料 05 · R1（内存暴涨元凶 ✗）：**一轮推演里的几十次写盘合并成一批** ✓
 *   病根：单次更新会调 80+ 次 saveState() ✗ 每次都同步深拷贝整本数 MB 的账
 *         （含 5 份快照、800 条编年、200 条召回 ✗）并并发打 80+ 个保存请求 ✗ ⇒ 卡顿 ✗
 *   新：**显式批次**。批内第 2…N 次只记“脏”（不深拷贝、不发请求 ✓）；批收尾写**一次** ✓
 *   ⛔ **批外行为与原来逐字一致** ✓（所以同步读盘的自测不受影响 ✓）
 *   ⛔ 不动账本格式/写入接口；flushLedger()（不可逆动作那条 ✓）照旧直接写 ✓
 */
let saveBatchDepth = 0;
let saveBatchDirty = false;

/** 进入批次（批内的 saveState 只记账 ✓） */
export function beginSaveBatch() {
    saveBatchDepth += 1;
}

/** 出批次：最外层出来时，若有脏 ⇒ 补写一次 ✓ */
export function endSaveBatch() {
    saveBatchDepth = Math.max(0, saveBatchDepth - 1);
    if (saveBatchDepth === 0 && saveBatchDirty) {
        saveBatchDirty = false;
        if (!chatBoundOk()) {
            return;   /* R3：换档了 ⇒ 这一批也不落 ✓ */
        }
        try { writeLedger(loadState()); } catch (e) { /* ⛔ 影响主流程 */ }
    }
}

/*
 * ⭐⭐ 材料 05 · R3：**切了聊天就不许再往新账本里写** ✓
 *   病根：runUpdate 等模型要 10～100 秒 ✗ 期间她切了聊天档 ✗
 *     ⇒ 回来后 loadState()/updateWorld()/upsertHidden()/saveState() 没有任何校验 ✗
 *     ⇒ **A 聊天的推演结果直接写进 B 聊天** ✗✗（甚至拿 A 的快照覆写 B ✗）
 *   现在：一轮推演开跑时记下当时的聊天键 ✓ ⇒ 写盘前比一下 ✓
 *     不一致就**拒写** ✓（一处管住全部写点 ✓）
 */
let runChatKey = null;

/** 一轮推演开跑：记下当时的聊天键 ✓ */
export function bindChatForRun() {
    runChatKey = currentChatKey();
}

/** 一轮结束：解绑 ✓ */
export function unbindChatForRun() {
    runChatKey = null;
}

/** 当前聊天还是开跑时那个吗？✓ */
export function chatBoundOk() {
    return !runChatKey || runChatKey === currentChatKey();
}

export function saveState() {
    if (!chatBoundOk()) {
        return;   /* R3：换档了 ⇒ 拒写 ✓（⏔ 把旧档的结果写进新档 ✗） */
    }
    const state = loadState();
    state.version = LEDGER_VERSION;
    /*
     * ⭐⭐ R10（材料 05）：**容量锁兜底** ✓
     *   病根：只有 `addChronicle()` 内部查了 `capChronicle` ✗，
     *     而“过去经历淡出”、“局势／暗线超限归并”、“角色合并留痕”这几处
     *     全部**直接 `state.chronicle.push(...)`** ✗ ⇒ 编年可以无限膨胀 ✗
     *   现在：在**写盘这一处**做一次容量收口 ✓（一处管住全部写入路径 ✓）
     *   ⏔ 物理删除 ✗（与 addChronicle 同一套语义：到上限就 slice 并在最老的那条上留痕 ✓）
     */
    try {
        const chronCap = Number(LIMITS.capChronicle || CHRONICLE_LIMIT);
        if (Number.isFinite(chronCap) && chronCap > 0 && state.chronicle.length > chronCap) {
            state.chronicle = state.chronicle.slice(-chronCap);
            const marker = state.chronicle[0];
            if (marker && marker.faded !== true) {
                marker.faded = true;
            }
        }
    } catch (eChron) { /* 截不动也不能拦着存盘 ✓ */ }
    if (saveBatchDepth > 0) {
        saveBatchDirty = true;   /* ⭐ R1：批内只记账 ✓（⛔ 深拷贝、⛔ 发请求 ✗） */
        return;
    }
    writeLedger(state);
}

/* ⭐ 新增件 5②（材料 13）：**合并落盘** ✓
 *   病根：单轮更新会调八十多次 `saveState()`，每次都把整本账深拷贝一遍 ✗
 *   现在：紧循环里用 `saveStateDebounced()`（同一轮内合并成一次 ✓），
 *     每轮结束时用 `flushState()` 强制冲出去 ✓（⏔ 留在定时器里 ✗）
 *   ⏔ 改 `saveState` 本身：其余调用点仍然立即落盘 ✓
 */
let saveDirty5 = false;
let saveTimer5 = null;

export function saveStateDebounced() {
    try {
        if (saveDirty5) {
            return;
        }
        saveDirty5 = true;
        saveTimer5 = setTimeout(() => {
            saveDirty5 = false;
            saveTimer5 = null;
            try { saveState(); } catch (e5a) { /* 落盘失败不能往上抛 ✓ */ }
        }, 120);
    } catch (e5b) {
        /* 定时器都挂不上 ⇒ 当场落盘 ✓ */
        try { saveState(); } catch (e5c) { }
    }
}

export function flushState() {
    if (saveTimer5) {
        try { clearTimeout(saveTimer5); } catch (e5d) { }
        saveTimer5 = null;
    }
    if (saveDirty5) {
        saveDirty5 = false;
        try { saveState(); } catch (e5e) { }
    }
}

/**
 * ⭐ **存完才算数**（别让"删了刷新又回来"这种事再发生）。
 *
 * 背景：`saveState()` 是同步的，它里面的 `writeLedger` 是"发了不管"（异步不 await），
 * 而酒馆那边 `saveMetadata` 本身还带防抖 ⇒ 她**删完马上刷新**时，那笔删除可能还没落地，
 * 刷新一看东西又回来了（真机实测过）。
 * ⇒ 删／清空这种**不可逆**的动作，必须等到真存下去再给她"已清空"的回执。
 */
export async function flushLedger() {
    try {
        return await writeLedger(loadState());
    } catch (e) {
        console.warn('[万象阁] 落盘没成：', e);
        return { ok: false, reason: (e && e.message) || '落盘失败' };
    }
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

/**
 * ⭐ 这一位是不是"你"（玩家棋子）——**自动认**，不靠她一个个勾。
 *
 * 判据：名字或任一别名跟酒馆当前档的人设名（`name1`）一模一样（按 matchKey 归一后比）。
 * 为什么值得自动：① 68 个人不该勾 68 次；② 引擎那边 `pipeline` 会把自己排除在
 * "平行推演"之外，认错了会白烧额度。
 *
 * ⚠️ 她手动取消过（`playerOff`）就**听她的**——⛔ 不跟人抢方向盘。
 */
export function isPlayerCharacter(c) {
    if (!c) {
        return false;
    }
    if (c.playerOff === true) {
        return false;
    }
    /*
     * ⭐ Q3（材料 05 · 她原话 [35][49][50]）：**认玩家的路子再宽一点** ✓
     *   旧：只比酒馆右上角的 Persona 名（ctx.name1 ✗）
     *     ⇒ 你 Persona 不叫月野兔（或世界书里写了主角但 name1 是昵称 ✗）
     *     ⇒ **认不出她是玩家棋子 ✗ ⇒ 当 NPC 推演行动** ✗✗
     *   现在：除了名字，**角色自己的 identity／note 里写了主角／玩家／player** 也算 ✓
     */
    const selfSaysPlayer = /(主角|玩家|player)/i.test(String(c.identity || '') + ' ' + String(c.note || ''));
    const names = personaNames().map((n) => matchKey(n)).filter(Boolean);
    if (!names.length) {
        /* ⚠️ 这里**不能**因为“自己写了主角”就认 ✗
         *   （审计 10.8 当场红过：夹具里只要有主角两字就被当玩家、召回被排掉 ✗）
         *   ⇒ 没 Persona 名就还是不认 ✓；有名时才多一条“自己写了主角”的路子 ✓ */
        return false;
    }
    const mine = [c.name].concat(Array.isArray(c.aliases) ? c.aliases : [])
        .map((n) => matchKey(n)).filter(Boolean);
    return selfSaysPlayer || mine.some((n) => names.includes(n));
}

/**
 * 名册（给界面用）。
 * ⭐ 在这里把"自动认出来的你"并进 `isPlayer`（**只在返回值上并，⛔ 不写存档**）：
 *    这样 `pipeline`／`recall`／界面三边都不用改，行为立刻就对。
 */
export function getRoster() {
    const list = loadState().characters;
    for (const c of list) {
        c.isYou = isPlayerCharacter(c);
        if (c.isYou) {
            c.isPlayer = true;
        }
    }
    return list;
}

export function addCharacter(name, extra) {
    const state = loadState();
    const c = createCharacter(name, extra);
    if (!c.name) {
        return null;
    }
    const existing = state.characters.find((x) => x && x.name === c.name);
    if (existing) {
        return existing;
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

/** 改一个人物（手改状态格自动记入 manualFields，改哪格护哪格） */
/**
 * ⭐ 补③ 认知账：给某人**追一条**"他该知道的"。
 *
 * 她定的规矩：**只增不编**；**拿不准的不进**（延续"不存推断"的定例）。
 *   ⇒ 所以这个函数**只会追加**，⛔ 修改也⛔ 删除已有的；要改走界面上的「删」。
 *   ⇒ 而且要求**必须有来源与来源楼层**（没来源＝拿不准 ⇒ 不收）。
 *
 * @returns {object|null} 收下去的那一条；没收（没文字／没来源）返回 null
 */
export function addKnow(id, item) {
    const text = trimText(item && item.text);
    const from = trimText(item && item.source);
    const floor = Number.isFinite(Number(item && item.floor)) ? Number(item.floor) : -1;
    // 没文字 ／ 没来源 ⇒ 不收（她：拿不准的不进）
    if (!text || !['亲眼', '被告知', '公开'].includes(from)) {
        return null;
    }
    const state = loadState();
    const c = state.characters.find((x) => x && x.id === id);
    if (!c) {
        return null;
    }
    c.knows = Array.isArray(c.knows) ? c.knows : [];
    // 同一句话不重复收（只增不编 ⛔ 收成一堆重复的）
    if (c.knows.some((k) => trimText(k && k.text) === text)) {
        return null;
    }
    const row = {
        text,
        source: from,
        floor,
        at: now(),
        manual: item && item.manual === true,
    };
    c.knows.push(row);
    saveState();
    return row;
}

/** 删一条认知（她在界面上手删；⛔ 让引擎自己删） */
export function removeKnow(id, index) {
    const state = loadState();
    const c = state.characters.find((x) => x && x.id === id);
    if (!c || !Array.isArray(c.knows)) {
        return false;
    }
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= c.knows.length) {
        return false;
    }
    c.knows.splice(index, 1);
    saveState();
        // ⭐ 复审追加 C1：她亲手删的 ⇒ 底稿直接跟着变（⛔ 等下次被捞回来）
        syncMirrorAfterDelete(state);
    return true;
}

/**
 * ⭐ U1（材料 12·未覆盖死角）：**加一个“只写值、⏔ 记手改”的选项** ✓
 *   为什么需要它：`book-wiki` 的“从世界书读人”是**引擎自己填**，
 *   而这个函数原来只要 patch 里有非空状态格就记 `manualFields` ✗
 *   ⇒ 她一个字没手改，导入进来的人全被盖上“已手动修改” ✗
 *   ⏔ 用 `patch.manual=false`：那会把她**原有的手改锁一起清掉** ✗
 */
export function updateCharacter(id, patch, opts) {
    const state = loadState();
    const idx = state.characters.findIndex((c) => c.id === id);
    if (idx < 0) {
        return null;
    }
    const prev = state.characters[idx];
    const merged = Object.assign({}, prev, patch || {});
    if (patch && Object.hasOwn(patch, 'aliases')) {
        merged.aliases = toList(patch.aliases);
    }
    const fieldSet = new Set(Array.isArray(prev.manualFields) ? prev.manualFields : []);
    const trackManual = !(opts && opts.trackManual === false);
    if (trackManual && patch && typeof patch === 'object') {
        for (const k of STATUS_MANUAL_KEYS) {
            if (!Object.hasOwn(patch, k)) {
                continue;
            }
            /*
             * ⭐ 锁的规则要和 `normalizeCharacter` 的兜底（`state.js:29`）**一致**：
             *    那边是"**非空**的格才算她锁着"，这边原来却是"**碰过就锁**、只加不减"。
             *    两条打架的后果：你把某格**清空**（意思就是"这格我说了不算，引擎你填"）
             *    之后锁还在 ⇒ 引擎永远不敢填那格。
             *    ⇒ 统一成"填了才锁、清空即放手"。
             */
            if (trimText(merged[k])) {
                fieldSet.add(k);
            } else {
                fieldSet.delete(k);
            }
        }
    }
    if (patch && Object.hasOwn(patch, 'manual') && patch.manual === false) {
        merged.manual = false;
        merged.manualFields = [];
    } else {
        merged.manualFields = patch && Array.isArray(patch.manualFields)
            ? patch.manualFields
            : Array.from(fieldSet);
        merged.manual = patch && Object.hasOwn(patch, 'manual')
            ? patch.manual === true
            : (prev.manual === true || merged.manualFields.length > 0);
    }
    merged.updatedAt = now();
    state.characters[idx] = normalizeCharacter(merged);
    /* ⭐ 新增件 5②：高频写入走合并落盘 ✓ */
    saveStateDebounced();
    return state.characters[idx];
}

export function removeCharacter(id) {
    const state = loadState();
    const before = state.characters.length;
    state.characters = state.characters.filter((c) => c.id !== id);
    state.newPeople = state.newPeople.filter((n) => !state.characters.some((c) => c.name === n));
    saveState();
        // ⭐ 复审追加 C1：她亲手删的 ⇒ 底稿直接跟着变（⛔ 等下次被捞回来）
        syncMirrorAfterDelete(state);
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
    try { syncWorldEvents(); } catch (eSync3) { }
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
        // ⭐ 复审追加 C1：她亲手删的 ⇒ 底稿直接跟着变（⛔ 等下次被捞回来）
        syncMirrorAfterDelete(state);
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
    const existing = c.past.find((p) => p && trimText(p.text) === body);
    const entry = {
        text: body,
        injected: existing ? existing.injected === true : false,
        at: existing && existing.at ? existing.at : now(),
        manual: existing ? existing.manual === true : false,
    };
    if (existing && Number.isFinite(Number(existing.fromFloor))) {
        entry.fromFloor = Number(existing.fromFloor);   // 保留最初产生的楼层号，⛔ 不被后续轮次刷成新楼
    } else if (Number.isFinite(floor) && floor >= 0) {
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
    /*
     * ⭐⭐ 材料 06【5】链路断路 4（收口）：**模型写的 ⏔ 盖掉她手改过的格** ✓
     *   她手改时传 `manual: true` ✓ ⇒ 照旧能写 ✓（包括改回去 ✓）
     *   模型（stepWorld）不传 ✗ ⇒ 她手改过的那几格**不被覆盖** ✓（其余格照常更新 ✓）
     */
    const _patch = Object.assign({}, patch || {});
    if (opts.manual !== true && w.manualFields && typeof w.manualFields === 'object') {
        for (const mk of Object.keys(_patch)) {
            if (w.manualFields[mk] === true) {
                delete _patch[mk];
            }
        }
    }
    /*
     * ⭐ B9（材料 13·兑现率）：**模型写“未知”不能盖掉已知格** ✓
     *   旧：只要模型回一个占位词（未知／不清楚／无／null…），就照单全收 ✗
     *     ⇒ 她辛辛苦苦建的世界钟／地点被一句“未知”覆盖 ✗
     *   现在：模型写的且只要是占位词、而那一格**已经有字** ⇒ 跳过不写 ✓
     *   （她自己手改不受影响：`opts.manual === true` 时不走这段 ✓）
     */
    if (opts.manual !== true) {
        const PLACEHOLDER = /^(未知|不知道|不清楚|不详|无|暂无|none|null|n\/a|[—-]+|[-]+)$/i;
        for (const mk of Object.keys(_patch)) {
            const v = _patch[mk];
            if (typeof v === 'string' && PLACEHOLDER.test(v.trim()) && trimText(w[mk])) {
                delete _patch[mk];
            }
        }
    }
    Object.assign(w, _patch);
    w.updatedAt = now();
    w.manual = opts.manual === true ? true : w.manual === true;
    /*
     * ⭐⭐ 材料 06【5】链路断路 4：**手改要按字段锁住** ✓
     *   旧：只有一个粗标志 `w.manual` ✗（一格手改 = 整块世界状态，没法用 ✗）
     *   现在：`w.manualFields` 记下**具体哪几格** ✓
     *     （stepWorld 回写时只跳过这几格 ✓、其余照常更新 ✓）
     */
    if (opts.manual === true && patch && typeof patch === 'object') {
        w.manualFields = Object.assign({}, w.manualFields || {});
        for (const mk of Object.keys(patch)) {
            w.manualFields[mk] = true;
        }
    }
    try { syncWorldEvents(); } catch (eSync1) { /* 同步失败不能拦着写盘 ✓ */ }
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
    /* ⭐ 材料 06【5】链路断路 4：**她手改过的暗线，模型⏔ 能冲掉** ✓
     *   （旧：状态/火候照单全收 ✗ ⇒ 刚手改完、下一轮后台一跑就被冲掉 ✗）
     *   现在：只跳过**她手改的那几格**（当前实现：整条跳过模型推进 ✓）
     *   ⏔ 跳过统计：`sinceDay`等起算点照旧维护 ✓ */
    if (existing && existing.manual === true) {
        return existing;
    }
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
            /* ⭐ C12（材料 13）：**因果两格不能在推进时丢掉** ✓ */
            cause: trimText(line.cause) || existing.cause,
            effect: trimText(line.effect) || existing.effect,
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
        /* ⭐ C12（材料 13）：**新建暗线也要带上因果** ✓ */
        cause: trimText(line.cause),
        effect: trimText(line.effect),
        sinceDay: Number.isFinite(sinceDayNow) ? sinceDayNow : null,
        sinceMinutes: Number.isFinite(sinceMinutesNow) ? sinceMinutesNow : null,
        log: [],
        manual: line.manual === true,
        updatedAt: now(),
    };
    state.world.hidden.push(fresh);
    // ⭐ 修复单 #13①：**补传 keepFn**——对照 `capEvents` 那处（`(e) => e.manual`）：
    //   暗线也可能被她手改过（`manual: true`），不带 keepFn 就会把**她手改的那条**先淘汰掉。
    capList(state.world.hidden, 'capHidden', (h) => h.name, (h) => h && h.manual === true);
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
    const gone = state.world.hidden.find((h) => h && h.id === id) || null;   /* 先记下被删的那条 ✓ */
    state.world.hidden = state.world.hidden.filter((h) => h.id !== id);
    if (state.world.hidden.length !== before) {
        /*
         * ⭐⭐ 材料 06【5】链路断路 1（最痛那半）：**刚手删的暗线不能再被召回** ✓
         *   旧：只从 `state.events` 挑世界事件 ✗，而写 events 的只有 stepWorld ✗
         *     ⇒ 她手删一条假暗线后，**只要还没跑下一次后台推演** ✗
         *     ⇒ 它**依然被召回、继续塞给主模型** ✗✗
         *   现在：删掉暗线的同时，把对应的世界事件从召回池里也拿掉 ✓
         */
        try {
            const goneName = trimText(gone && gone.name);
            if (goneName && Array.isArray(state.events) && state.events.length) {
                state.events = state.events.filter((ev) => {
                    const evT = trimText(ev && (ev.title || ev.name));
                    return !(evT && matchKey(evT) === matchKey(goneName));
                });
            }
        } catch (eEv) { /* 清不掉也不能把删除搞挂 ✓ */ }
        saveState();
        // ⭐ 复审追加 C1：她亲手删的 ⇒ 底稿直接跟着变（⛔ 等下次被捞回来）
        syncMirrorAfterDelete(state);
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

/**
 * ⭐ 新增件 5②（材料 13）：**改完世界就顺手重算召回事件池** ✓
 *   旧：面板上手改局势／暗线只写进 world，**从不重算 events** ✗
 *     ⇒ 改完发消息仍然 0 召回 ✗
 *   现在：把 world 里的局势／暗线按标题去重**补进** events ✓
 *   ⏔ 删除现有 events（只补不删 ✓ ⇒ 不会把 stepWorld 正常维护的那些弄丢 ✓）
 */
export function syncWorldEvents() {
    const state = loadState();
    const w = state.world || {};
    const olds = Array.isArray(state.events) ? state.events.slice() : [];
    const have = new Set(olds.map((e) => trimText(e && e.title)).filter(Boolean));
    const add = [];
    for (const s of (Array.isArray(w.situations) ? w.situations : [])) {
        const tt = trimText(s && s.title);
        if (!tt || have.has(tt)) { continue; }
        have.add(tt);
        add.push({ title: tt, text: trimText(s && s.note) || tt, kind: 'situation', sides: trimText(s && s.sides), tier: trimText(s && s.tier) });
    }
    for (const h of (Array.isArray(w.hidden) ? w.hidden : [])) {
        const tn = trimText(h && h.name);
        if (!tn || have.has(tn)) { continue; }
        have.add(tn);
        add.push({ title: tn, text: trimText(h && h.note) || tn, kind: 'hidden', stage: trimText(h && h.stage) });
    }
    if (add.length) {
        setEvents(olds.concat(add));
    }
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

/* ------------------------------ 删／清空（她自己按的，⛔ 不静默） ------------------------------ */

/**
 * 删掉编年里的一条。
 * ⚠️ 编年原来是**只增不减**的（`addChronicle` / `getChronicle`，没有任何删的口子）
 *    ⇒ 写错了、或早期测试数据混进去了，她自己在界面上**删不掉**（真机上就卡过一批）。
 * @param {number} index 在 `getChronicle()` 里的下标（界面按当前筛选后的行传它拿到的原始下标）
 * @returns {boolean} 真删掉了才 true
 */
export async function removeChronicleAt(index) {
    const state = loadState();
    /*
     * ⚠️ 必须**先判类型**再转数字：`Number(null)` 是 **0**（不是 NaN），
     *    `Number('')` 也是 0 ⇒ 光判 `Number.isInteger` 会把 null／空串当成"删第 0 条"，
     *    那就成了"默默删到别人"（用例抓到过）。
     */
    if (typeof index !== 'number' || !Number.isInteger(index)) {
        return false;
    }
    if (!Array.isArray(state.chronicle) || index < 0 || index >= state.chronicle.length) {
        return false;
    }
    state.chronicle.splice(index, 1);
    saveState();
        // ⭐ 复审追加 C1：她亲手删的 ⇒ 底稿直接跟着变（⛔ 等下次被捞回来）
        syncMirrorAfterDelete(state);
    await flushLedger();   // ⭐ 同上
    return true;
}

/** 清空编年；返回清掉几条。⛔ 只动编年，别的一律不碰。 */
export async function clearChronicle() {
    const state = loadState();
    const n = Array.isArray(state.chronicle) ? state.chronicle.length : 0;
    state.chronicle = [];
    saveState();
    await flushLedger();   // ⭐ 等真存下去再回话（⛔ 她刷新一看又回来）
    return n;
}

/**
 * 清空**这个聊天的世界**（＝账本那一份）。
 * ⛔ **不碰世界书**（那本《万象阁 · 世界后台》原样留着）——那是她明确选的②。
 * ⛔ 也不碰聊天正文／她的其他扩展。
 *
 * @returns {object} 每一块清掉多少条（给她看回执，⛔ 不许静默）
 */
export async function clearWorldLedger() {
    const state = loadState();
    const counts = {
        名册: Array.isArray(state.characters) ? state.characters.length : 0,
        世界状态: Array.isArray(state.world && state.world.situations) ? state.world.situations.length : 0,
        暗线: Array.isArray(state.world && state.world.hidden) ? state.world.hidden.length : 0,
        编年: Array.isArray(state.chronicle) ? state.chronicle.length : 0,
        回执: Array.isArray(state.recallRecords) ? state.recallRecords.length : 0,
        世界事件: Array.isArray(state.events) ? state.events.length : 0,
        快照: Array.isArray(state.snapshots) ? state.snapshots.length : 0,
    };
    state.characters = [];
    state.world = Object.assign({}, state.world, {
        bigPicture: '',
        situations: [],
        hidden: [],
        clock: '',
        place: '',
        updatedAt: now(),
        manual: false,
    });
    state.events = [];
    state.chronicle = [];
    state.recallRecords = [];
    /*
     * ⭐ 修复单 #9：**这两样也得清**（原来漏了）——
     *   `newPeople`（"新认的人"徽章）与 `stat`（召回／注入计数）都是这本账的一部分；
     *   不清的话"清空这个世界"之后徽章与计数**还挂着旧数据**。
     *   `failLog`（失败分类）同属这本账，一并清掉。
     */
    state.newPeople = [];
    state.stat = { recalled: 0, injected: 0, empty: 0, updates: 0 };
    state.failLog = [];
    // ⚠️ 快照也清：留着的话"撤回上一次"能把数据拉回来 ⇒ 她说的是"真的不需要了"
    state.snapshots = [];
    state.lastUpdate = { at: 0, status: 'idle', note: '', floor: -1 };
    state.pipeline = Object.assign({}, state.pipeline, {
        status: 'idle', step: '', text: '', error: '', tries: 0, cursor: 0, atFloor: -1, cancelRequested: false,
    });
    saveState();
    /*
     * ⭐ 修复单 #9 的**根因**：清完之后这本账是空的 ⇒ `mirrorLedger` 里那句
     *   "空账不值得留底"会让它**跳过写底稿** ⇒ **旧底稿原封不动留着**
     *   ⇒ 下次读档又从底稿把刚清掉的账捞回来（"清完一刷新数据全回来了"）。
     *   ⇒ 清空动作必须**显式把那一格底稿抹掉**。
     */
    try {
        clearMirror(null, state);
    } catch (e) {
        console.warn('[万象阁] 清空时抹底稿出错：', e);
    }
    saveState();
    await flushLedger();   // ⭐ 同上：不可逆的动作必须等落盘
    return counts;
}

/** 清空**之前**给她看的账（要清哪些、各多少条）——⛔ 不许静默毁数据 */
export function ledgerClearPreview() {
    const state = loadState();
    return {
        名册: Array.isArray(state.characters) ? state.characters.length : 0,
        世界状态: Array.isArray(state.world && state.world.situations) ? state.world.situations.length : 0,
        暗线: Array.isArray(state.world && state.world.hidden) ? state.world.hidden.length : 0,
        编年: Array.isArray(state.chronicle) ? state.chronicle.length : 0,
        回执: Array.isArray(state.recallRecords) ? state.recallRecords.length : 0,
        世界事件: Array.isArray(state.events) ? state.events.length : 0,
        快照: Array.isArray(state.snapshots) ? state.snapshots.length : 0,
    };
}

/* ------------------------------ 召回记录 ------------------------------ */

/**
 * ⭐ 补② 「送达回执」：对着**新正文**核上一轮注入的条目——到底接没接。
 *
 * 她定的规矩：
 *   · 写进了 ⇒ 标「**已进正文（第 N 楼）**」
 *   · 没进 ⇒ 留候补；**连续 3 轮**都没进 ⇒ **转进编年留档**，⛔ 再占注入位、⛔ 再强塞。
 *
 * 怎么判"写进了"：拿**这一条当时带的人名与事件名**去新正文里找——
 *   名字出现了就算"接到了"。⚠️ 这是**有限但诚实**的判法（我不假装能读懂语义）：
 *   名字不出现也可能是"用代词写了"——那种会被当成没接，所以我们**只记、不惩罚**（到 3 轮只是转编年留档，不删任何东西）。
 *
 * @param {string} bodyText 这一轮的新正文
 * @param {number} floor 这一轮的楼层
 * @param {Array<object>} [msgs] 原始消息数组（带 floor／isUser；给了就按它过滤，⛔ 不用拼接文本）
 * @returns {{arrived:number, missed:number, archived:number}}
 */
export function markArrivals(bodyText, floor, msgs) {
    const state = loadState();
    const text = asText(bodyText);
    const at = Number.isFinite(Number(floor)) ? Number(floor) : -1;
    const out = { arrived: 0, missed: 0, archived: 0 };
    if (!text || at < 0) {
        return out;
    }
    const hasMsgs = Array.isArray(msgs) && msgs.length > 0;
    const list = Array.isArray(state.recallRecords) ? state.recallRecords : [];
    for (const rec of list) {
        if (!rec || rec.injectStatus !== 'ok' || rec.archived === true || rec.arrivedAt >= 0) {
            continue;
        }
        // 只核"之前那几轮"的：本楼刚发出去的还没来得及被写进去
        if (Number(rec.floor) >= at) {
            continue;
        }
        /*
         * ⭐ 修复单 #17②：同一楼已经核过就不重核。
         *   原来没有防重——同楼重跑（"立刻更新"连点两次／失败重试）会让 missRounds 连加，
         *   没到 3 轮就被提前转编年（她定的"连续 3 轮"被偷成"连续 3 次调用"）。
         */
        /*
         * ⭐ 复审追加 B4：**先判、后写**（原来判完立刻写）。
         *   再加上下界用 `max(rec.floor, 上次核到)` ——
         *   原来只用 `m.floor > rec.floor`：她在 #2 点过“立刻更新”（核到 2）后又发 #3，
         *   缓冲未进 #4 时 `freshText` 拿到的是**已经核过的 #2** ⇒ 同一楼重算一次未命中，
         *   `missRounds` 多加 1（到 3 就**提前转编年**）。
         */
        const prevChecked = Number.isFinite(Number(rec.lastCheckedFloor)) ? Number(rec.lastCheckedFloor) : -1;
        if (prevChecked >= at) {
            continue;
        }
        /*
         * ⭐ 修复单 #17①：只搜"这张记录**之后**、**AI 写的**新正文"——
         *   原来拿"最近 6+ 楼的拼接文本"搜：
         *   · 旧楼提过 ⇒ 上一轮早核过，再算＝重复计；
         *   · 她自己的楼提过 ⇒ 她点名 ≠ 正文接住了（误判"已进正文"）。
         *   没给 msgs 时退回整段文本（单元测试／老调用）。
         */
        let freshText = text;
        if (hasMsgs) {
            // ⭐ B4：下界＝"**这张记录之后** 且 **上次核过的楼之后**"
            const minFloor = Math.max(Number(rec.floor), prevChecked);
            freshText = msgs
                .filter((m) => m && m.isUser !== true
                    && Number.isFinite(Number(m.floor)) && Number(m.floor) > minFloor)
                .map((m) => asText(m && m.mes))
                .filter(Boolean)
                .join('\n');
        }
        // ⭐ 没有"记录之后的新 AI 正文"＝这一轮她还没让 AI 回过话 ⇒ 不算没进、也不清零，原样跳过
        if (hasMsgs && !freshText) {
            continue;   // 没有新 AI 正文 ⇒ 连 lastCheckedFloor 都⛔ 写（下次还能重核这一楼）
        }
        // ⭐ B4：**确认真有新正文了**才记"核到第几楼"
        rec.lastCheckedFloor = at;
        /*
         * ⭐ 修复单 #7：**人名与事件分开取**。
         *   原来两者一起 `trimText()`——可 `rec.events` 是**对象数组**，
         *   于是 token 里多了一堆 `'[object Object]'`（长度 15，还能过 `>= 2` 的筛）
         *   ⇒ 事件永远搜不到、永远被当"没进正文"。⇒ 用统一的 `eventTitle()`。
         */
        const tokens = []
            .concat((Array.isArray(rec.chars) ? rec.chars : []).map((x) => trimText(x)))
            .concat((Array.isArray(rec.events) ? rec.events : []).map((x) => eventTitle(x)))
            .filter((x) => x.length >= 2);
        const hit = tokens.some((tk) => freshText.includes(tk));
        if (hit) {
            rec.arrivedAt = at;
            rec.arrivedNote = '已进正文（' + '#' + String(at) + '）';
            out.arrived += 1;
            continue;
        }
        rec.missRounds = (Number(rec.missRounds) || 0) + 1;
        if (rec.missRounds >= ARRIVE_MISS_LIMIT) {
            rec.archived = true;
            rec.arrivedNote = '已转编年（连续 ' + String(ARRIVE_MISS_LIMIT) + ' 轮没进正文，不再占注入位）';
            out.archived += 1;
        } else {
            rec.arrivedNote = '候补（第 ' + String(rec.missRounds) + '/' + String(ARRIVE_MISS_LIMIT) + ' 轮没进）';
            out.missed += 1;
        }
    }
    /*
     * 转编年的那几条：单独留一笔账（她能回查"它们去哪了"）。
     * ⛔ 放在循环里逐条写（那样会反复读写整本账）；汇总一条。
     */
    if (out.archived > 0) {
        state.chronicle = Array.isArray(state.chronicle) ? state.chronicle : [];
        state.chronicle.push({
            at: now(),
            floor: at,
            kind: '候补转编年',
            who: '',
            text: '有 ' + String(out.archived) + ' 条带进去的东西连续 ' + String(ARRIVE_MISS_LIMIT)
                + ' 轮没被写进正文，已收进编年（不再占注入位）。',
            manual: false,
        });
    }
    saveState();
    return out;
}

export function putRecallRecord(record) {
    const state = loadState();
    const rec = Object.assign({
        floor: -1,
        mesId: '',
        at: now(),
        lead: '',
        from: '',
        /* ⭐ RD2-4（材料 11）：**记下当轮的世界钟与地点** ✓（卡片就不用去读“最新一轮”了 ✓） */
        clock: '',
        place: '',
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
        /*
         * ⭐ 补②「送达回执」：注入**发出去了**，还要看**正文到底接没接**。
         *   · `arrivedAt`＝在**第几楼**的正文里见到了它（-1＝还没见到）
         *   · `missRounds`＝**连续几轮**没进正文（到 3 就转编年，⛔ 不再占注入位）
         *   · `arrivedNote`＝给人看的一句话（"已进正文 #13"／"候补（第 2/3 轮）"）
         *   · `archived`＝已转编年留档（转了就⛔ 不再强塞）
         */
        arrivedAt: -1,
        missRounds: 0,
        arrivedNote: '',
        archived: false,
        /*
         * ⭐ 修复单 #17②：最后一次"核到第几楼"——用来防同楼重核
         *   （"立刻更新"连点两次／失败重试 × 同一楼 ⇒ missRounds 连加、提前转编年）。
         */
        lastCheckedFloor: -1,
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
    const list = loadState().recallRecords;
    let best = null;
    let bestAt = -1;
    for (let i = 0; i < list.length; i += 1) {
        const r = list[i];
        if (r && r.floor === floor) {
            const at = Math.max(Number(r.injectedAt || 0), Number(r.at || 0));
            if (!best || at >= bestAt) {
                best = r;
                bestAt = at;
            }
        }
    }
    return best;
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
        // ⭐ 复审追加 C1：她亲手删的 ⇒ 底稿直接跟着变（⛔ 等下次被捞回来）
        syncMirrorAfterDelete(state);
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
        chronicle: state.chronicle,
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

/**
 * ⭐ 修复单 #19：把账**还原到某一版快照**（引擎自己失败时收口用）。
 *
 * ⚠️ 跟 `rollbackLast()` 的区别（⛔ 搞混：那是"她主动撤回"，这是"引擎自己失败回滚"）：
 *   · ⛔ 动 `snapshots` 列表（不 pop、也不 push"撤回前"）——那版快照留着，她仍可手动撤回；
 *   · ⛔ 记"撤回"动作（这不是她的操作）；
 *   · 只把 payload 里那六样装回去。
 *
 * @returns {boolean} 装回去了没
 */
export function restoreSnapshot(snap) {
    if (!snap || !snap.data) {
        return false;
    }
    const state = loadState();
    state.characters = Array.isArray(snap.data.characters) ? snap.data.characters : state.characters;
    state.world = snap.data.world || state.world;
    state.events = Array.isArray(snap.data.events) ? snap.data.events : state.events;
    if (Array.isArray(snap.data.chronicle)) {
        state.chronicle = snap.data.chronicle;
    }
    if (Array.isArray(snap.data.newPeople)) {
        state.newPeople = snap.data.newPeople;
    }
    state.stat = snap.data.stat || state.stat;
    saveState();
    return true;
}

/**
 * ⭐ 修复单 #19 附注①：把某一版快照**丢掉**（空跑占位用）。
 *   只丢"就是这一版"（按 `at`+标签认）；认不出就不动手（⛔ 乱丢别人的）。
 */
export function dropSnapshot(snap) {
    if (!snap || !Number.isFinite(Number(snap.at))) {
        return false;
    }
    const state = loadState();
    const list = Array.isArray(state.snapshots) ? state.snapshots : [];
    const idx = list.findIndex((x) => x && Number(x.at) === Number(snap.at) && trimText(x.label) === trimText(snap.label));
    if (idx < 0) {
        return false;
    }
    list.splice(idx, 1);
    saveState();
    return true;
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
    /*
     * ⭐ 修复单 #13②：**边界**。
     *   原来只扫前 `over` 条（`i < over`）：被保住的（手改过的）若排在前头，
     *   实际就**少淘汰几条** ⇒ 列表永远压不回上限；最极端 `over = 1` 且首位是手改的时
     *   **一条都不淘汰**（等于容量锁失效）。
     *   ⇒ 改成"**一直往后扫，直到凑够 `over` 条该走的**"。
     *   ⚠️ 全都被保住时（全是她手改的）就少淘汰几条——那是**有意的**：她的字优先。
     */
    for (let i = 0; i < list.length && removed.length < over; i += 1) {
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

/**
 * ⭐ 材料 06【4】#1：**把导出的备份导回来** ✓
 *   （她只能导出、不能导回 ✗ —— 27 个文件里一个导入函数都没有 ✗）
 *   行为：拿导入的对象过一遍 normalizeState ✓ ⇒ **整本换掉当前聊天档的账** ✓
 *   ⏔ 自己留快照：由调用方（UI）先 takeSnapshot ✓（她点了确认才到这里 ✓）
 * @returns {{ok: boolean, reason?: string, counts?: object}}
 */
export function importState(raw) {
    try {
        if (!raw || typeof raw !== 'object') {
            return { ok: false, reason: '这个文件不像万象阁的备份（不是 JSON 对象）' };
        }
        const norm = normalizeState(raw);
        norm.version = LEDGER_VERSION;
        cache = norm;
        cacheKey = currentChatKey();
        writeLedger(norm);
        return {
            ok: true,
            counts: {
                characters: (norm.characters || []).length,
                hidden: ((norm.world || {}).hidden || []).length,
                situations: ((norm.world || {}).situations || []).length,
                chronicle: (norm.chronicle || []).length,
            },
        };
    } catch (e) {
        return { ok: false, reason: e && e.message ? e.message : String(e) };
    }
}

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
