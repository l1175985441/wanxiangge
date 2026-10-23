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
import { readLedger, writeLedger, currentChatKey, setLiveLedgerGetter, snapshotLiveLedger, dropMirrorFor, deepClone, now, personaNames, clearMirror, syncMirrorAfterDelete, getChat } from './adapter.js';
import { makeId, toList, trimText, asText, countChars, matchKey, eventTitle } from './utils.js';
import { parseClock, isLineDone } from './clock.js';

/* ------------------------------ 字段改名迁移表 ------------------------------ */
/*
 * 依据＝第 7 问 C5（阿砚 51 号）：字段改名必须有一张表，否则改名即丢老数据。
 *   现在表里只有一条（占位），以后改名就往这里加一行，⏔ 拆各处写 if。
 */
export const FIELD_RENAMES = [
    /* { from: '旧字段名', to: '新字段名', at: '从哪个版本开始用新名' } */
];

/** 按表把一个对象里的旧字段名改成新名（新名已有值就不覆盖） */
export function applyFieldRenames(obj, table) {
    if (!obj || typeof obj !== 'object') { return obj; }
    const rows = Array.isArray(table) ? table : FIELD_RENAMES;
    for (const r of rows) {
        if (!r || !r.from || !r.to) { continue; }
        if (!Object.prototype.hasOwnProperty.call(obj, r.from)) { continue; }
        const hadNew = Object.prototype.hasOwnProperty.call(obj, r.to);
        if (!hadNew) { obj[r.to] = obj[r.from]; }
        delete obj[r.from];
    }
    return obj;
}

/* ------------------------------ 人物 ------------------------------ */

/** 角色身上支持按格锁定保护的状态字段 */
const STATUS_MANUAL_KEYS = ['age', 'identity', 'faction', 'affinity', 'timePlace', 'current', 'behaviorBounds', 'knowledgeBounds', 'role'];

/** 人物记录的标准结构（缺键补齐，多余的键保留） */
/**
 * ★ 20261022 B1（设计稿·六档名册）：**这个人在这局里算哪一档**。
 *   主要（4）/常联系（3）/新面孔（2）/可能登场（1）/路过（0）/不用（0）
 *   ⏔ 用模型自己填：这档是给“该不该给他知道”、“叫他出场不出场”用的排序依据。
 */
export const ROLES = ['主要', '常联系', '新面孔', '可能登场', '路过', '不用'];
export const ROLE_WEIGHT = { '主要': 4, '常联系': 3, '新面孔': 2, '可能登场': 1, '路过': 0, '不用': 0 };

/** 按现有标记位算一个人的档（不看她手改过的） */
export function autoRoleOf(c) {
    if (!c) { return '可能登场'; }
    if (c.ignored === true) { return '不用'; }
    if (c.noBench === true) { return '路过'; }          /* 关了后台推演 ⇒ 只在被找时回应 */
    if (c.isPlayer === true) { return '主要'; }
    const pf = Number(c.presentFloor);
    if (c.isNew === true) { return '新面孔'; }
    if (Number.isFinite(pf) && pf >= 0) {
        /* 出场过：记忆越多越像“常联系”（没有计数器 ⇒ 用 past+knows 的长度当活跃度） */
        const act = (Array.isArray(c.past) ? c.past.length : 0) + (Array.isArray(c.knows) ? c.knows.length : 0);
        return act >= 6 ? '主要' : '常联系';
    }
    return '可能登场';
}

/** 自动分档：她手改过 role 的一律不动；返回改了几个 */
export function autoRoster() {
    const state = loadState();
    let n = 0;
    for (const c of (Array.isArray(state.characters) ? state.characters : [])) {
        if (!c) { continue; }
        if (Array.isArray(c.manualFields) && c.manualFields.indexOf('role') >= 0) { continue; }
        const want = autoRoleOf(c);
        if (c.role !== want) {
            c.role = want;
            n += 1;
        }
    }
    if (n) { saveStateDebounced(); }
    return n;
}

/** 她手改档：记进手改锁，后面自动分档不再动它 */
export function setRole(id, role) {
    const want = trimText(role);
    if (ROLES.indexOf(want) < 0) { return false; }
    const state = loadState();
    const c = state.characters.find((x) => x && x.id === id);
    if (!c) { return false; }
    c.role = want;
    c.manualFields = Array.from(new Set((Array.isArray(c.manualFields) ? c.manualFields : []).concat(['role'])));
    saveStateDebounced();
    return true;
}

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
        /* ★ P1-2：角色抽「实力」（与势力的「规模」不同字段 ✓） */
        power: trimText(c.power),
        /* ★ 她 22:2x 点头加的两格（不是表演层：是“他会做什么/他不知道什么”） */
        behaviorBounds: trimText(c.behaviorBounds),
        knowledgeBounds: trimText(c.knowledgeBounds),
        /* ★ 3-1（修复单 20261019）：**知识面**——防全知的“原料”法。
           名单上没有的事，就不该写给他；beliefs 能表达“他以为的是 X（可能是误会）” ✓ */
        knownFactKeys: toList(c.knownFactKeys),
        knownEventIds: toList(c.knownEventIds),
        knownClueIds: toList(c.knownClueIds),
        knownFactBeliefs: (Array.isArray(c.knownFactBeliefs) ? c.knownFactBeliefs : [])
            .filter(Boolean)
            .map((b) => ({ key: trimText(b && b.key), belief: trimText(b && b.belief) }))
            .filter((b) => b.key && b.belief),
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
            /* ★ 20261022 ⑩（22 单）：读档时把这三格洗掉了 ⇒ “几天后”永远算不出来、到点也不记得 ✗ */
            dueReached: (s && s.dueReached) === true,
            sinceDay: Number.isFinite(Number(s && s.sinceDay)) ? Number(s.sinceDay) : null,
            sinceMinutes: Number.isFinite(Number(s && s.sinceMinutes)) ? Number(s.sinceMinutes) : null,
            /* A1：日程也要认得是第几版／哪一楼 */
            swipe: Number.isFinite(Number(s && s.swipe)) ? Number(s.swipe) : null,
            floor: Number.isFinite(Number(s && s.floor)) ? Number(s.floor) : -1,
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
        role: ROLES.indexOf(trimText(c.role)) >= 0 ? trimText(c.role) : '',   /* ★ B1：六档（空＝还没分，由 autoRoster 算） */
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
         * ★ [580]／世界背面 A7：在场判据原料（取字段语义；装配仍用我们的召回分治）。
         *   · presentFloor＝最后一次**正文在场**的楼（≈ presentInSceneMessageId，我们按楼不按消息号）
         *   · lastSeenFloor＝引擎最近碰过他的楼（后台推演也会写，⛔ 不能当「一直在场」）
         *   · relevance＝0–3 相关度（轮转优先；默认 1）
         *   · noBench＝关后台推演（≈ simulationEnabled=false；存「关」保老账默认开）
         */
        presentFloor: (() => {
            if (Number.isFinite(Number(c.presentFloor))) { return Number(c.presentFloor); }
            /* 旧账迁移：当时标着在场 ⇒ 用 lastSeenFloor 顶一下；不在场的不抄（防后台推演楼冒充在场） */
            if (c.inScene === true && Number.isFinite(Number(c.lastSeenFloor))) {
                return Number(c.lastSeenFloor);
            }
            return -1;
        })(),
        relevance: (() => {
            const n = Number(c.relevance);
            if (!Number.isFinite(n)) { return 1; }
            return Math.max(0, Math.min(3, Math.round(n)));
        })(),
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
            factions: [],        // 势力：{id, name, core_person, note, at, floor}（独立实体，按名字复用 id ✓）
            /* ★ [580]／世界背面 A3：键值事实账（给引擎用；⛔ 不当叙述长文注入） */
            facts: [],           // {key, subject, field, value, source, at, floor}
            /* ★ [580]／世界背面 A4：独立脉动层（镜头外可巡查；字段可与局势脉动同语义，⛔ 不抄壳） */
            pulse: { lastSweepAt: 0, domains: [], coverage: { lastSweepAt: 0, entries: [] } },
            /* ★ [580]／世界记忆引擎 C3：风声＝未证实公开传闻（对齐 A1 trace；⛔ 不另开 worldTrends 叠床） */
            winds: [],           // {topic, text, kind, source, at, floor}
            hidden: [],          // 暗线：{id, name, stage, kind, trigger, tier, note, log[], manual}
            hiddenTombstones: [],  // ★ P2-6：删掉的暗线留碑「谁、什么时候被删」
            clock: '',           // 世界内时间（只有钟是准的）
            place: '',
            /* ★ [580]／观棋 B4：上轮正文点到的名／势力 → 本轮必须有下文 */
            spotlight: [],
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
        /* ★ [580]／世界记忆引擎 C2：这一楼推演前的存档点（换 swipe／重算时回这里，⛔ 叠脏账） */
        rollCheckpoint: null,
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
    /* ★ [580]：点名名单（上轮→本轮解锁） */
    state.world.spotlight = Array.isArray(state.world.spotlight)
        ? state.world.spotlight.map(trimText).filter(Boolean).slice(0, 12)
        : [];
    state.world.situations = (Array.isArray(state.world.situations) ? state.world.situations : []).map(normalizeSituation).filter((s) => s.title);
    state.world.factions = (Array.isArray(state.world.factions) ? state.world.factions : [])
        .map(normalizeFaction).filter((f) => f.name);
    state.world.facts = (Array.isArray(state.world.facts) ? state.world.facts : [])
        .map(normalizeWorldFact).filter((f) => f && f.key && f.value)
        .slice(0, WORLD_FACTS_CAP);
    state.world.pulse = normalizeWorldPulse(state.world.pulse);
    state.world.winds = (Array.isArray(state.world.winds) ? state.world.winds : [])
        .map(normalizeWind).filter((x) => x && x.topic)
        .slice(0, WORLD_WINDS_CAP);
    state.world.hiddenTombstones = (Array.isArray(state.world.hiddenTombstones) ? state.world.hiddenTombstones : []).slice(-50);
    state.world.hidden = Array.isArray(state.world.hidden) ? state.world.hidden.map((h) => {
        const baseH = Object.assign({
            owner: '', goal: '', visibility: '', maxSteps: 0, progress: 0,
            memory: { promise: '', done: '', blocked: '', rounds: 0 },
            id: makeId('line'),
            name: '',
            stage: '萌芽',
            kind: 'conflict',
            trigger: '',
            tier: '几天内',
            note: '',
            /* ★ [580] B6：暗线来源三型（event／parent／state） */
            agendaOrigin: '',
            agendaRef: '',
            log: [],
            manual: false,
            updatedAt: 0,
        }, h || {});
        baseH.agendaOrigin = normalizeAgendaOrigin(h && (h.agendaOrigin || (h.source && h.source.type) || h.sourceKind));
        baseH.agendaRef = trimText(h && (h.agendaRef || (h.source && h.source.ref) || h.sourceRef));
        return baseH;
    }) : [];
    state.lastUpdate = Object.assign(base.lastUpdate, s.lastUpdate && typeof s.lastUpdate === 'object' ? s.lastUpdate : {});
    state.pipeline = Object.assign(base.pipeline, s.pipeline && typeof s.pipeline === 'object' ? s.pipeline : {});
    state.recallRecords = Array.isArray(s.recallRecords) ? s.recallRecords.filter((r) => r && typeof r === 'object') : [];
    state.events = Array.isArray(s.events) ? s.events : [];
    state.chronicle = Array.isArray(s.chronicle) ? s.chronicle.filter((c) => c && typeof c === 'object') : [];
    state.snapshots = Array.isArray(s.snapshots) ? s.snapshots.filter((x) => x && typeof x === 'object') : [];
    /* ★ [580] C2：楼层存档点（只认带 floor＋data 的） */
    {
        const cp = s.rollCheckpoint;
        state.rollCheckpoint = (cp && typeof cp === 'object' && cp.data && Number.isFinite(Number(cp.floor)))
            ? { floor: Number(cp.floor), at: Number(cp.at) || 0, data: cp.data }
            : null;
    }
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
/**
 * ★ R62（第二批 1019）：**名册排序（创建时间／修改时间／名字，可正反序）**。
 *   抽成纯函数的原因：排序是“一件事”，要能被测；⏔ 埋在界面里拼。
 *   dir：'desc'（默认，最近/最新在前）／'asc'。名字按中文排序，不受时间影响。
 */
export function sortRosterList(list, key, dir) {
    const arr = (Array.isArray(list) ? list : []).slice();
    const d = dir === 'asc' ? 1 : -1;
    if (key === 'created' || key === 'changed') {
        const k = key === 'created' ? 'createdAt' : 'updatedAt';
        arr.sort((a, b) => d * (Number(a && a[k] || 0) - Number(b && b[k] || 0)));
        return arr;
    }
    if (key === 'name') {
        arr.sort((a, b) => d * String((a && a.name) || '').localeCompare(String((b && b.name) || ''), 'zh'));
        return arr;
    }
    return arr;
}

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
 * ★ [580]／世界背面 A2：**知情接触链**
 *   physical＝亲眼／在场；information＝被告知；causal＝因果牵连（势力／后果波及）
 *   公开 ≠ 全员知情：source=公开 时必须能落到这三链之一，否则不收 ✓
 */
const KNOW_CHANNELS = ['physical', 'information', 'causal'];

export function resolveKnowChannel(source, item, character) {
    const src = trimText(source);
    const raw = String(trimText(item && item.channel) || '').toLowerCase();
    /*
     * ★ 20261022 B2（设计稿·六档名册按档收口）：
     *   档位低于「常联系」（权重 < 3：新面孔／可能登场／路过／不用）⇒ **不许走 亲眼／被告知**，
     *   只能走「公开」那条链（还要过 presentFloor）——否则一个远在天边的后台角色也能把内幕全收进脑子。
     *   ⚠️ 她手填的一条（manual）照旧放行：那是她给的，不是模型推的。
     */
    const roleNow = trimText(character && character.role) || autoRoleOf(character);
    const rw = Number(ROLE_WEIGHT[roleNow]);
    const lowTier = !(Number.isFinite(rw) && rw >= 3);
    if (lowTier && !(item && item.manual === true)) {
        const floorL = Number(item && item.floor);
        const sinceL = character && Number.isFinite(floorL) && floorL >= 0
            && Number(character.presentFloor) === floorL;
        if (!sinceL) {
            const textL = trimText(item && item.text);
            const facL = trimText(character && character.faction);
            if (facL && textL && textL.indexOf(facL) >= 0) {
                return 'causal';
            }
            return '';   /* ⇒ addKnow 会把它降级成 unverified（字留着、只标未证） */
        }
        return 'physical';
    }
    if (KNOW_CHANNELS.includes(raw)) {
        return raw;
    }
    if (/亲眼|在场|亲眼所见|现场/.test(raw)) { return 'physical'; }
    if (/被告知|听说|传来|口耳|告知/.test(raw)) { return 'information'; }
    if (/因果|牵连|波及|连带/.test(raw)) { return 'causal'; }
    /*
     * ★ 20261022 补 22 单 ⑨ 的另一半：**亲眼要查在场**（原来无条件放行 ✗）。
     *   · 亲眼：那一楼他必须真的在场（presentFloor === floor），不然降级未证；
     *   · 被告知：他得**先出场过**（presentFloor <= floor），否则也降级；
     *   · 两边没有可比的楼号（老账／寄存器里没这格）⇒ 保持原行为，⏔ 凭空改判。
     */
    const flNow = Number(item && item.floor);
    const pfNow = Number(character && character.presentFloor);
    /* 老账里没这格时，presentFloor 会是 0、lastSeenFloor 是 -1 ⇒ 当“不知道”，⏔ 拿 0 当真在场 ✗ */
    const canCheck = Number.isFinite(flNow) && flNow >= 0 && Number.isFinite(pfNow) && pfNow >= 0
        && (pfNow > 0 || Number(character && character.lastSeenFloor) >= 0);
    if (src === '亲眼') {
        if (canCheck && pfNow !== flNow) { return ''; }
        return 'physical';
    }
    if (src === '被告知') {
        if (canCheck && pfNow > flNow) { return ''; }
        return 'information';
    }
    if (src === '公开') {
        if (item && item.manual === true) { return 'information'; }
        const floor = Number(item && item.floor);
        /* ★ [580] A7：亲历＝那一楼**正文在场**（presentFloor），不是后台推演碰过的楼 */
        if (character && Number.isFinite(floor) && floor >= 0
            && Number(character.presentFloor) === floor) {
            return 'physical';
        }
        const text = trimText(item && item.text);
        const fac = trimText(character && character.faction);
        if (fac && text && text.indexOf(fac) >= 0) {
            return 'causal';
        }
        return '';
    }
    return '';
}

/**
 * ⭐ 补③ 认知账：给某人**追一条**"他该知道的"。
 *
 * 她定的规矩：**只增不编**；**拿不准的不进**（延续"不存推断"的定例）。
 *   ⇒ 所以这个函数**只会追加**，⛔ 修改也⛔ 删除已有的；要改走界面上的「删」。
 *   ⇒ 而且要求**必须有来源与来源楼层**（没来源＝拿不准 ⇒ 不收）。
 *
 * @returns {object|null} 收下去的那一条；没收（没文字／没来源／无接触链）返回 null
 */
/**
 * ★ 20261022 A1（设计稿）：**记忆要认得它是第几版**。
 *   同一楼换了 swipe ⇒ 另一版；旧版的记忆要能认出来、能被撤（A3 落地后）。
 *   读不到就是 null，⏔ 瞎填 0 ✗。
 */
function swipeAt(floor) {
    const f = Number(floor);
    if (!Number.isFinite(f) || f < 0) { return null; }
    try {
        const chat = getChat();
        const msg = Array.isArray(chat) ? chat[f] : null;
        const sw = Number(msg && msg.swipe_id);
        return Number.isFinite(sw) && sw >= 0 ? sw : null;
    } catch (e) {
        return null;
    }
}

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
    /* ★ [580] A2／22 单 ⑨：公开≠全员知情 —— 推不出接触链就**降级成"未证"**，
     *   ⛔ 不是丢掉（她的原话是「不过就降级成未证」，不是"不收"；她的字不能被静默吃掉） */
    const channel = resolveKnowChannel(from, item, c) || 'unverified';
    c.knows = Array.isArray(c.knows) ? c.knows : [];
    // 同一句话不重复收（只增不编 ⛔ 收成一堆重复的）
    if (c.knows.some((k) => trimText(k && k.text) === text)) {
        return null;
    }
    const row = {
        text,
        source: from,
        channel,
        floor,
        swipe: swipeAt(floor),
        at: now(),
        manual: item && item.manual === true,
    };
    if (channel === 'unverified') {
        row.why = '没查到接触链（不在场／推不出）—— 先记未证';
    }
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
/** ★ [580]／世界背面 A5：知识面壳字段 —— 模型不准直写，只许世界书／显式放行 */
const KNOWN_FACE_KEYS = ['knownFactKeys', 'knownEventIds', 'knownClueIds', 'knownFactBeliefs'];

export function updateCharacter(id, patch, opts) {
    const state = loadState();
    const idx = state.characters.findIndex((c) => c.id === id);
    if (idx < 0) {
        return null;
    }
    const prev = state.characters[idx];
    /* ★ [580] A5：⛔ 模型／普通 patch 直写 known_* ✗；世界书读人传 allowKnownFace:true ✓ */
    const safePatch = Object.assign({}, patch || {});
    if (!(opts && opts.allowKnownFace === true)) {
        for (const k of KNOWN_FACE_KEYS) {
            if (Object.hasOwn(safePatch, k)) {
                delete safePatch[k];
            }
        }
    }
    const merged = Object.assign({}, prev, safePatch);
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
/**
 * ★ 补单 1-⑤（世界背面四层阶梯，先只落 L0+L1）：
 *   L0＝每轮一条摘要；L1＝12 条 L0 压成一条阶段小结。
 *   为什么只做两层：她要看的是"不炸、不丢、越老越短"，L2/L3 等两层跑通再说 ✓
 */
export const ROLLUP_NEED = 12;

/** 该不该压：返回最老的 N 条 L0（不够 N 条就返回空数组） */
export function dueRollup(c, need) {
    const n = Number(need) > 0 ? Number(need) : ROLLUP_NEED;
    const past = (c && Array.isArray(c.past)) ? c.past : [];
    const l0 = past.filter((x) => x && trimText(x.text) && (trimText(x.tier) || 'L0') !== 'L1');
    if (l0.length < n) {
        return [];
    }
    return l0.slice(l0.length - n);   /* past 是"由近到远"，末尾是最老的 ✓ */
}

/** 把那 N 条 L0 换成一条 L1（带 covers＝覆盖了多少条） */
export function rollupPast(characterId, text) {
    const body = trimText(text);
    if (!body) {
        return false;
    }
    const state = loadState();
    const c = state.characters.find((x) => x.id === characterId);
    if (!c) {
        return false;
    }
    const victims = dueRollup(c);
    if (!victims.length) {
        return false;
    }
    const keep = c.past.filter((x) => victims.indexOf(x) < 0);
    const oldestFloor = victims.map((v) => Number(v.fromFloor))
        .filter((x) => Number.isFinite(x)).sort((a, b) => a - b)[0];
    keep.push({
        text: body,
        tier: 'L1',
        covers: victims.length,
        at: now(),
        manual: false,
        injected: false,
        fromFloor: Number.isFinite(oldestFloor) ? oldestFloor : undefined,
    });
    c.past = keep;
    saveStateDebounced();
    return true;
}

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
        swipe: swipeAt(Number.isFinite(floor) ? floor : -1),
        tier: (existing && trimText(existing.tier)) || 'L0',   /* ★ 补单 1-⑤：每轮一条→L0 */
        covers: Number(existing && existing.covers) > 0 ? Number(existing.covers) : 1,
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
/**
 * ★ P1-2（修复单 20261019）：**势力分量闸**。
 *   为什么要闸：小规模势力（比如一个街口帮会）如果也进推演名单，
 *   每一轮都会占掉名额、把真正有分量的势力挤出去。
 *   取值：字面数字（≤100 当百分制）或规模词；没写 ⇒ 按 0.5（不静默：不知道的不该被我们自作主张隐掉 ✓）
 */
export const FACTION_SCALE_GATE = 0.5;

export function factionWeight(scale) {
    const raw = trimText(scale);
    if (!raw) { return 0.5; }
    const num = Number(String(raw).replace(/[^0-9.]/g, ''));
    if (Number.isFinite(num) && String(raw).match(/[0-9]/)) {
        return num > 1 ? Math.min(1, num / 100) : Math.max(0, Math.min(1, num));
    }
    if (/巨型|庞大|巨大|大陆级|世界级/.test(raw)) { return 1; }
    if (/大型|大规模/.test(raw)) { return 0.8; }
    if (/中型|中规模/.test(raw)) { return 0.6; }
    if (/小型|小规模|零散/.test(raw)) { return 0.3; }
    if (/微型|个体|一两人/.test(raw)) { return 0.1; }
    return 0.5;
}

export function factionPassesGate(f) {
    return factionWeight(f && f.scale) >= FACTION_SCALE_GATE;
}

/* ★ [580]／世界背面 A3：世界事实容量锁（取 160；⛔ 不搬权威分／冲突 UI） */
export const WORLD_FACTS_CAP = 160;

export function worldFactKey(subject, field) {
    const s = matchKey(subject) || '世界';
    const f = matchKey(field);
    return f ? (s + '｜' + f) : '';
}

export function normalizeWorldFact(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const subject = trimText(src.subject) || '世界';
    const field = trimText(src.field);
    const value = trimText(src.value);
    const key = trimText(src.key) || worldFactKey(subject, field);
    if (!key || !value) {
        return null;
    }
    let source = trimText(src.source) || 'engine';
    if (!['engine', 'book', 'manual', 'narrative'].includes(source)) {
        source = 'engine';
    }
    return {
        key,
        subject,
        field: field || key,
        value,
        source,
        at: Number(src.at) || 0,
        floor: Number.isFinite(Number(src.floor)) ? Number(src.floor) : -1,
    };
}

/**
 * ★ [580] A3：**按 key 去重的世界事实账**（谁的哪一格＝什么）。
 *   已有同 key：只在新值非空时覆盖；manual 优先不被 engine 空写冲掉。
 */
export function upsertWorldFact(line, opts) {
    const o = opts || {};
    const row = normalizeWorldFact(Object.assign({}, line || {}, {
        source: trimText(line && line.source) || (o.manual === true ? 'manual' : 'engine'),
    }));
    if (!row) {
        return null;
    }
    const state = loadState();
    const box = state.world.facts = Array.isArray(state.world.facts) ? state.world.facts : [];
    const hit = box.find((f) => f && trimText(f.key) === row.key);
    if (hit) {
        if (hit.source === 'manual' && row.source === 'engine' && !o.force) {
            return hit;
        }
        hit.value = row.value;
        hit.subject = row.subject || hit.subject;
        hit.field = row.field || hit.field;
        hit.source = row.source || hit.source;
        if (Number.isFinite(row.floor) && row.floor >= 0) { hit.floor = row.floor; }
        hit.at = now();
        /* 新写的挪到最前（近的优先） */
        const idx = box.indexOf(hit);
        if (idx > 0) {
            box.splice(idx, 1);
            box.unshift(hit);
        }
        if (box.length > WORLD_FACTS_CAP) { box.length = WORLD_FACTS_CAP; }
        saveState();
        return hit;
    }
    row.at = now();
    box.unshift(row);
    if (box.length > WORLD_FACTS_CAP) { box.length = WORLD_FACTS_CAP; }
    saveState();
    return row;
}

/* ★ [580]／世界背面 A4：脉动容量（取数量级；⛔ 不搬巡查 UI／紫主题） */
export const PULSE_DOMAINS_CAP = 18;
export const PULSE_COVERAGE_CAP = 48;

const PULSE_TRENDS = new Set(['rising', 'falling', 'steady']);

export function pulseDomainKey(label, kind) {
    const lb = matchKey(label);
    if (!lb) { return ''; }
    const kd = matchKey(kind) || 'other';
    return kd + ':' + lb;
}

export function normalizePulseDomain(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const label = trimText(src.label || src.name || src.title);
    if (!label) { return null; }
    const kind = trimText(src.kind) || 'other';
    let trend = String(trimText(src.trend) || 'steady').toLowerCase();
    if (trend === 'stable' || trend === '持平') { trend = 'steady'; }
    if (trend === '上升' || trend === '升温') { trend = 'rising'; }
    if (trend === '下降' || trend === '降温') { trend = 'falling'; }
    if (!PULSE_TRENDS.has(trend)) { trend = 'steady'; }
    const pressureRaw = Number(src.pressure);
    const pressure = Number.isFinite(pressureRaw) ? Math.max(0, Math.min(5, pressureRaw)) : 0;
    const visibility = resolveVisibility(
        trimText(src.state) + ' ' + trimText(src.evidence),
        src.visibility,
    );
    return {
        id: trimText(src.id) || makeId('pulse'),
        label,
        kind,
        scope: trimText(src.scope),
        state: trimText(src.state || src.note || src.text),
        pressure,
        trend,
        visibility,
        evidence: trimText(src.evidence),
        at: Number(src.at) || 0,
        floor: Number.isFinite(Number(src.floor)) ? Number(src.floor) : -1,
    };
}

export function normalizePulseCoverageEntry(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const label = trimText(src.label || src.name);
    if (!label) { return null; }
    const kind = trimText(src.kind) || 'general';
    const scope = trimText(src.scope);
    return {
        id: trimText(src.id) || ('cov_' + matchKey(kind + ':' + label + ':' + scope)),
        label,
        kind,
        scope,
        lastCheckedAt: Number(src.lastCheckedAt) || 0,
        checks: Math.max(0, Number(src.checks) || 0),
        floor: Number.isFinite(Number(src.floor)) ? Number(src.floor) : -1,
    };
}

export function normalizeWorldPulse(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const covSrc = src.coverage && typeof src.coverage === 'object' ? src.coverage : {};
    const domains = [];
    const seenDom = new Set();
    for (const cand of (Array.isArray(src.domains) ? src.domains : [])) {
        const d = normalizePulseDomain(cand);
        if (!d) continue;
        const k = pulseDomainKey(d.label, d.kind);
        if (!k || seenDom.has(k)) continue;
        seenDom.add(k);
        domains.push(d);
        if (domains.length >= PULSE_DOMAINS_CAP) break;
    }
    const entries = [];
    const seenCov = new Set();
    for (const cand of (Array.isArray(covSrc.entries) ? covSrc.entries : [])) {
        const e = normalizePulseCoverageEntry(cand);
        if (!e) continue;
        if (seenCov.has(e.id)) continue;
        seenCov.add(e.id);
        entries.push(e);
        if (entries.length >= PULSE_COVERAGE_CAP) break;
    }
    entries.sort((a, b) => (Number(b.lastCheckedAt) || 0) - (Number(a.lastCheckedAt) || 0));
    return {
        lastSweepAt: Number(src.lastSweepAt) || 0,
        domains,
        coverage: {
            lastSweepAt: Number(covSrc.lastSweepAt) || 0,
            entries,
        },
    };
}

/**
 * ★ [580] A4：**独立脉动域**（镜头外也能记压力／趋势／可见度／证据）。
 *   按 label+kind 去重；同键覆盖非空格。
 */
export function upsertPulseDomain(line, opts) {
    const o = opts || {};
    const row = normalizePulseDomain(Object.assign({}, line || {}, {
        floor: Number.isFinite(Number(line && line.floor)) ? Number(line.floor) : (Number.isFinite(Number(o.floor)) ? Number(o.floor) : -1),
    }));
    if (!row) { return null; }
    /* 至少要有一句状态／证据，或明确给了压力（含 0） */
    const hasPressure = line && line.pressure !== undefined && line.pressure !== null && line.pressure !== '';
    if (!row.state && !row.evidence && !hasPressure) { return null; }
    const state = loadState();
    state.world.pulse = normalizeWorldPulse(state.world.pulse);
    const box = state.world.pulse.domains;
    const key = pulseDomainKey(row.label, row.kind);
    const hit = box.find((d) => d && pulseDomainKey(d.label, d.kind) === key);
    if (hit) {
        if (row.state) { hit.state = row.state; }
        if (row.evidence) { hit.evidence = row.evidence; }
        if (row.scope) { hit.scope = row.scope; }
        if (line && line.pressure !== undefined && line.pressure !== null && line.pressure !== '') {
            hit.pressure = row.pressure;
        }
        if (trimText(line && line.trend)) { hit.trend = row.trend; }
        if (trimText(line && line.visibility)) { hit.visibility = row.visibility; }
        hit.at = now();
        if (Number.isFinite(row.floor) && row.floor >= 0) { hit.floor = row.floor; }
        const idx = box.indexOf(hit);
        if (idx > 0) {
            box.splice(idx, 1);
            box.unshift(hit);
        }
    } else {
        row.at = now();
        box.unshift(row);
    }
    if (box.length > PULSE_DOMAINS_CAP) { box.length = PULSE_DOMAINS_CAP; }
    state.world.pulse.lastSweepAt = now();
    /* 写了域 ⇒ 顺手记一笔巡查覆盖（镜头外巡查的痕迹） */
    try {
        markPulseCoverage({
            label: row.label,
            kind: row.kind,
            scope: row.scope,
            floor: row.floor,
        }, { skipSave: true });
    } catch (eCov) { /* 覆盖记不上不能挡域写入 ✓ */ }
    saveState();
    return hit || row;
}

/** ★ [580] A4：记下「哪一块范围刚巡查过」 */
export function markPulseCoverage(line, opts) {
    const o = opts || {};
    const row = normalizePulseCoverageEntry(line);
    if (!row) { return null; }
    const state = loadState();
    state.world.pulse = normalizeWorldPulse(state.world.pulse);
    const box = state.world.pulse.coverage.entries;
    const hit = box.find((e) => e && e.id === row.id);
    const ts = now();
    if (hit) {
        hit.lastCheckedAt = ts;
        hit.checks = Math.max(0, Number(hit.checks) || 0) + 1;
        if (row.scope) { hit.scope = row.scope; }
        if (Number.isFinite(row.floor) && row.floor >= 0) { hit.floor = row.floor; }
        const idx = box.indexOf(hit);
        if (idx > 0) {
            box.splice(idx, 1);
            box.unshift(hit);
        }
    } else {
        row.lastCheckedAt = ts;
        row.checks = 1;
        box.unshift(row);
    }
    if (box.length > PULSE_COVERAGE_CAP) { box.length = PULSE_COVERAGE_CAP; }
    state.world.pulse.coverage.lastSweepAt = ts;
    if (o.skipSave !== true) { saveState(); }
    return hit || row;
}

/* ★ [580]／世界记忆引擎 C3：风声容量（取「未证实传闻」语义；对齐 A1 trace，⛔ 不搬紫主题／不叠 worldTrends） */
export const WORLD_WINDS_CAP = 24;
export const WIND_KINDS = Object.freeze(['rumor', 'report', 'sentiment', 'announcement']);

export function normalizeWind(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const topic = trimText(src.topic || src.title || src.name);
    const text = trimText(src.text || src.content || src.note || src.rumor);
    if (!topic && !text) { return null; }
    let kind = String(trimText(src.kind || src.type) || 'rumor').toLowerCase();
    if (!WIND_KINDS.includes(kind)) { kind = 'rumor'; }
    /* 风声层＝未证实传闻：announcement 也只当「有人说有通报」级别，注入侧仍标风声 ⛔ 不当已证实新闻 */
    return {
        topic: topic || (text ? text.slice(0, 24) : ''),
        text: text || topic,
        kind,
        source: trimText(src.source) || 'engine',
        at: Number(src.at) || 0,
        floor: Number.isFinite(Number(src.floor)) ? Number(src.floor) : -1,
    };
}

/**
 * ★ [580] C3：按 topic 去重写入风声账（未证实传闻；⛔ 不当 public 新闻）。
 */
export function upsertWind(line, opts) {
    const o = opts || {};
    const row = normalizeWind(Object.assign({}, line || {}, {
        floor: Number.isFinite(Number(line && line.floor)) ? Number(line.floor)
            : (Number.isFinite(Number(o.floor)) ? Number(o.floor) : -1),
        source: trimText(line && line.source) || (o.manual === true ? 'manual' : 'engine'),
    }));
    if (!row || !row.topic) { return null; }
    const state = loadState();
    const box = state.world.winds = Array.isArray(state.world.winds) ? state.world.winds : [];
    const key = matchKey(row.topic);
    const hit = box.find((w) => w && matchKey(w.topic) === key);
    if (hit) {
        if (trimText(row.text)) { hit.text = row.text; }
        if (trimText(row.kind)) { hit.kind = row.kind; }
        if (trimText(row.source)) { hit.source = row.source; }
        if (Number.isFinite(row.floor) && row.floor >= 0) { hit.floor = row.floor; }
        hit.at = now();
        const idx = box.indexOf(hit);
        if (idx > 0) {
            box.splice(idx, 1);
            box.unshift(hit);
        }
        if (box.length > WORLD_WINDS_CAP) { box.length = WORLD_WINDS_CAP; }
        saveState();
        return hit;
    }
    row.at = now();
    box.unshift(row);
    if (box.length > WORLD_WINDS_CAP) { box.length = WORLD_WINDS_CAP; }
    saveState();
    return row;
}

/**
 * ★ [580] C3：面板／喂料用风声视图——账上 winds ＋ 局势／事件里 visibility=trace 的派生条。
 *   按 topic／title 去重，避免与 A1 trace 叠两份同题。
 */
export function listWindsView(cap) {
    const n = Number.isFinite(Number(cap)) ? Math.max(1, Math.min(40, Number(cap))) : 24;
    const state = loadState();
    const w = state.world || {};
    const out = [];
    const seen = new Set();
    const push = (topic, text, kind, via) => {
        const t = trimText(topic);
        if (!t) return;
        const k = matchKey(t);
        if (seen.has(k)) return;
        seen.add(k);
        out.push({
            topic: t,
            text: trimText(text) || t,
            kind: trimText(kind) || 'rumor',
            via: trimText(via) || 'wind',
        });
    };
    for (const row of (Array.isArray(w.winds) ? w.winds : [])) {
        if (!row) continue;
        push(row.topic, row.text, row.kind, 'wind');
        if (out.length >= n) return out;
    }
    for (const s of (Array.isArray(w.situations) ? w.situations : [])) {
        if (!s || String(trimText(s.visibility) || '').toLowerCase() !== 'trace') continue;
        push(s.title, s.evidence || s.effect || s.cause || s.title, 'rumor', 'situation');
        if (out.length >= n) return out;
    }
    for (const e of (Array.isArray(state.events) ? state.events : [])) {
        if (!e || String(trimText(e.visibility) || '').toLowerCase() !== 'trace') continue;
        push(e.title, e.text || e.evidence || e.title, 'rumor', 'event');
        if (out.length >= n) return out;
    }
    return out;
}

/* ★ [580]／世界记忆引擎 C1：势力厚度枚举（取字段语义，⛔ 不搬紫主题 UI） */
export const FACTION_STATUSES = Object.freeze(['鼎盛', '稳固', '倾轧', '困顿', '衰落', '瓦解']);
export const FACTION_RELATIONS = Object.freeze(['血盟', '盟友', '友好', '中立', '冷淡', '敌对', '世仇']);

export function normalizeFactionPillars(raw) {
    const list = Array.isArray(raw) ? raw : (trimText(raw) ? [raw] : []);
    const out = [];
    for (const p of list) {
        const name = typeof p === 'string' ? trimText(p) : trimText(p && p.name);
        if (!name) continue;
        out.push(name.length > 4 ? name.slice(0, 4) : name);
        if (out.length >= 3) break;
    }
    return out;
}

export function normalizeFaction(f) {
    const src = f && typeof f === 'object' ? f : {};
    let status = trimText(src.status) || '稳固';
    if (!FACTION_STATUSES.includes(status)) { status = '稳固'; }
    let relation = trimText(src.relation) || '中立';
    if (relation === '紧张') { relation = '冷淡'; }
    if (!FACTION_RELATIONS.includes(relation)) { relation = '中立'; }
    /*
     * ★ [580] B5：势力只认 scale（规模）；⛔ 不存 power／「实力」。
     *   模型若误把规模写进 power，且长得像规模词 ⇒ 挪进 scale；否则丢掉。
     */
    let scale = trimText(src.scale);
    const mistook = trimText(src.power);
    if (!scale && mistook && /巨型|庞大|巨大|大型|中型|小型|微型|规模|零散|个体/.test(mistook)) {
        scale = mistook;
    }
    return {
        id: trimText(src.id) || makeId('faction'),
        name: trimText(src.name),
        core_person: trimText(src.core_person),
        scale,
        note: trimText(src.note),
        status,
        relation,
        scope: trimText(src.scope),
        powerPillars: normalizeFactionPillars(src.powerPillars),
        at: Number(src.at) || 0,
        floor: Number.isFinite(Number(src.floor)) ? Number(src.floor) : -1,
    };
}

/**
 * ★ P1-1（修复单 20261019）：**势力是独立实体**，不是人物上的一个字符串。
 *   为什么：只有一个名字时，“这个势力有哪些人 / 它的核心人是谁 / 它的状态”都无处存，
 *   世界书里读到的势力只能被摊成一条“局势”。现在给它一个实体：
 *   按名字复用已有 id（重复导入不会重号），只填空、不把已有值清掉。
 * ★ [580] C1：补 status／relation／scope／powerPillars 厚度 ✓
 */
export function upsertFaction(line) {
    const name = trimText(line && line.name);
    if (!name) {
        return null;
    }
    const state = loadState();
    const box = state.world.factions = Array.isArray(state.world.factions) ? state.world.factions : [];
    const key = matchKey(name);
    const hit = box.find((f) => f && matchKey(f.name) === key);
    const patch = normalizeFaction(Object.assign({}, line || {}, { name }));
    if (hit) {
        hit.core_person = patch.core_person || hit.core_person;
        hit.note = patch.note || hit.note;
        hit.scale = patch.scale || hit.scale;
        if (trimText(line && line.status) && FACTION_STATUSES.includes(trimText(line.status))) {
            hit.status = patch.status;
        } else if (!trimText(hit.status)) { hit.status = '稳固'; }
        const relIn = trimText(line && line.relation) === '紧张' ? '冷淡' : trimText(line && line.relation);
        if (relIn && FACTION_RELATIONS.includes(relIn)) {
            hit.relation = patch.relation;
        } else if (!trimText(hit.relation)) { hit.relation = '中立'; }
        if (trimText(line && line.scope)) { hit.scope = patch.scope; }
        if ((Array.isArray(line && line.powerPillars) && line.powerPillars.length) || trimText(line && line.powerPillars)) {
            hit.powerPillars = patch.powerPillars;
        } else if (!Array.isArray(hit.powerPillars)) {
            hit.powerPillars = [];
        }
        saveState();
        return hit;
    }
    const used = new Set(box.map((f) => trimText(f && f.id)).filter(Boolean));
    let id = trimText(line && line.id);
    if (!id || used.has(id)) {
        do { id = makeId('faction'); } while (used.has(id));
    }
    patch.id = id;
    patch.at = Date.now();
    patch.floor = Number.isFinite(Number(line && line.floor)) ? Number(line.floor) : -1;
    box.push(patch);
    saveState();
    return patch;
}

/** ★ [580]／观棋 B6：暗线出生来源三型 event｜parent｜state */
export function normalizeAgendaOrigin(raw) {
    if (raw && typeof raw === 'object') {
        return normalizeAgendaOrigin(raw.type || raw.kind);
    }
    const o = String(trimText(raw) || '').toLowerCase();
    if (o === 'event' || o === '事件') { return 'event'; }
    if (o === 'parent' || o === '委派' || o === '上级') { return 'parent'; }
    if (o === 'state' || o === '处境' || o === '局势') { return 'state'; }
    return '';
}

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
            /* ★ [580] B6：来源三型（给了才改；空不冲掉） */
            agendaOrigin: normalizeAgendaOrigin(line.agendaOrigin || (line.source && line.source.type) || line.sourceKind) || existing.agendaOrigin || '',
            agendaRef: trimText(line.agendaRef || (line.source && line.source.ref) || line.sourceRef) || existing.agendaRef || '',
            owner: trimText(line.owner) || existing.owner,
            goal: trimText(line.goal) || existing.goal,
            visibility: trimText(line.visibility) || existing.visibility,
            maxSteps: Number.isFinite(Number(line.maxSteps)) ? Math.max(0, Number(line.maxSteps)) : existing.maxSteps,
            progress: Number.isFinite(Number(line.progress)) ? Math.max(0, Number(line.progress)) : existing.progress,
            memory: Object.assign({}, existing.memory || {}, (line && line.memory) || {}),
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
        /* ★ P2-5（修复单 20261019）：暗线补齐七格 ✓ */
        owner: trimText(line.owner),
        goal: trimText(line.goal),
        visibility: trimText(line.visibility),
        /* ★ [580] B6：出生来源三型 */
        agendaOrigin: normalizeAgendaOrigin(line.agendaOrigin || (line.source && line.source.type) || line.sourceKind),
        agendaRef: trimText(line.agendaRef || (line.source && line.source.ref) || line.sourceRef),
        maxSteps: Number.isFinite(Number(line.maxSteps)) ? Math.max(0, Number(line.maxSteps)) : 0,
        progress: Number.isFinite(Number(line.progress)) ? Math.max(0, Number(line.progress)) : 0,
        memory: Object.assign({ promise: '', done: '', blocked: '', rounds: 0 }, (line && line.memory) || {}),
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

/**
 * ★ P2-6：**未完的暗线有几条**（已走完阶段的不算）。
 *   用来给她一个数字，而不是让她自己数。
 */
export function openHiddenCount() {
    const list = (loadState().world.hidden || []);
    return list.filter((h) => h && !isLineDone(h.stage)).length;
}

/**
 * ★ 20261022 A3（她拍板）：**楼没了，记忆就该没了**——⏔ 标 void 留着（那是污染源）。
 *   ① 删楼：floor 命中的条目从 knows/past/schedule 里**移除**。
 *   ② 换版：同一楼上旧 swipe 的条目移除（新版会重新总结）。
 *   ③ 分支：⏔ 在这里删（能切回来）——只在召回侧按“当前楼集合”过滤。
 * 返回删了多少条（供回执/日志用）。
 */
export function purgeMemoryAtFloor(floor) {
    const f = Number(floor);
    if (!Number.isFinite(f) || f < 0) { return 0; }
    const state = loadState();
    let gone = 0;
    for (const c of (Array.isArray(state.characters) ? state.characters : [])) {
        if (!c) { continue; }
        const hit = (x) => Number(x && (x.floor !== undefined ? x.floor : x.fromFloor)) === f;
        if (Array.isArray(c.knows) && c.knows.length) {
            const before = c.knows.length;
            c.knows = c.knows.filter((x) => !hit(x));
            gone += before - c.knows.length;
        }
        if (Array.isArray(c.past) && c.past.length) {
            const before = c.past.length;
            c.past = c.past.filter((x) => !hit(x));
            gone += before - c.past.length;
        }
        if (Array.isArray(c.schedule) && c.schedule.length) {
            const before = c.schedule.length;
            c.schedule = c.schedule.filter((x) => !hit(x));
            gone += before - c.schedule.length;
        }
    }
    if (gone) { saveStateDebounced(); }
    return gone;
}

/** ② 换版：这一楼上 “swipe 不等于当前版” 的条目移除（老账没 swipe 的也当旧版） */
export function purgeSwipedMemory(floor, keepSwipe) {
    const f = Number(floor);
    if (!Number.isFinite(f) || f < 0) { return 0; }
    const keep = Number(keepSwipe);
    const state = loadState();
    let gone = 0;
    const stale = (x) => {
        const fx = Number(x && (x.floor !== undefined ? x.floor : x.fromFloor));
        if (fx !== f) { return false; }
        const sw = Number(x && x.swipe);
        if (!Number.isFinite(keep)) { return false; }
        return !Number.isFinite(sw) || sw !== keep;
    };
    for (const c of (Array.isArray(state.characters) ? state.characters : [])) {
        if (!c) { continue; }
        for (const key of ['knows', 'past', 'schedule']) {
            if (Array.isArray(c[key]) && c[key].length) {
                const before = c[key].length;
                c[key] = c[key].filter((x) => !stale(x));
                gone += before - c[key].length;
            }
        }
    }
    if (gone) { saveStateDebounced(); }
    return gone;
}

/** ① 删楼后的孤儿条目：floor 超出当前楼数（被删掉了） ⇒ 真删；分支不在此列 */
export function purgeOrphanedMemory() {
    const state = loadState();
    let len = 0;
    try {
        const chat = getChat();
        len = Array.isArray(chat) ? chat.length : 0;
    } catch (e) { len = 0; }
    if (!len) { return 0; }
    let gone = 0;
    for (const c of (Array.isArray(state.characters) ? state.characters : [])) {
        if (!c) { continue; }
        for (const key of ['knows', 'past', 'schedule']) {
            if (Array.isArray(c[key]) && c[key].length) {
                const before = c[key].length;
                c[key] = c[key].filter((x) => {
                    const fx = Number(x && (x.floor !== undefined ? x.floor : x.fromFloor));
                    return !(Number.isFinite(fx) && fx >= 0 && fx >= len);
                });
                gone += before - c[key].length;
            }
        }
    }
    if (gone) { saveStateDebounced(); }
    return gone;
}

/** 她自己加暗线 */
export function addHiddenManually(line) {
    return upsertHidden(Object.assign({}, line, { manual: true }));
}

export function removeHidden(id) {
    const state = loadState();
    const before = state.world.hidden.length;
    const gone = state.world.hidden.find((h) => h && h.id === id) || null;   /* 先记下被删的那条 ✓ */
    /* ★ P2-6：**删了要留碑**（谁、什么时候被删、当时是什么样）——否则“那条暗线怎么不见了”永远查不到 ✓ */
    if (gone) {
        state.world.hiddenTombstones = (Array.isArray(state.world.hiddenTombstones) ? state.world.hiddenTombstones : []);
        state.world.hiddenTombstones.push({
            id: trimText(gone.id),
            name: trimText(gone.name),
            owner: trimText(gone.owner),
            goal: trimText(gone.goal),
            stage: trimText(gone.stage),
            note: trimText(gone.note),
            at: now(),
        });
        if (state.world.hiddenTombstones.length > 50) {
            state.world.hiddenTombstones = state.world.hiddenTombstones.slice(-50);
        }
    }
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
/**
 * ★ P1-3（修复单 20261019）：**事件要能溯源**。
 *   为什么：只存一句“局势标题”时，出事只能猜“这句是从哪来的”（模型自己写的？
 *   世界书里读的？还是她手改的）。指纹不变则同一件事可被认出，重复扩散也能拦。
 */
/**
 * ★ P1-6 ＋ 需求清单 [579]/[580]：**公开／痕迹／私域三态**（对照世界背面「宁可私域」）。
 *   · public＝真有社会传播渠道（新闻／通报／官方…）才准当世界新闻广播
 *   · trace＝有人看见／传闻／风声——外界能察觉，但⛔ 不当已证实新闻
 *   · private＝默认；卧室／私聊／没证据 ⇒ 宁可私域
 *   ⚠️ 旧 `isPublicText` 把「传闻」也算公开 ✗ ⇒ 私域事件会被广播成新闻 ✗
 */
const STRONG_PUBLIC_CUE = /公告|通报|报道|新闻|媒体|记者|电视台|广播|报纸|官方|政府|警方|消防|医院|学校|发布会|公开声明|新闻发布|公示|通知|预警|热搜|全城|全网|通缉/;
const TRACE_CUE = /传闻|风声|小道消息|有人看见|有人发现|路人|邻居|附近的人|外界察觉|可疑迹象|异常迹象|消息称|街边|人们都在议论/;
const VIS_OK = new Set(['public', 'trace', 'private']);

/** 归一可见度：模型写的 / 旧布尔 / 正文信号 → public|trace|private */
export function resolveVisibility(text, visibilityHint) {
    const hint = String(trimText(visibilityHint) || '').toLowerCase();
    if (VIS_OK.has(hint)) {
        return hint;
    }
    /* 中文别名 */
    if (/^(公开|明)$/.test(hint)) { return 'public'; }
    if (/^(痕迹|半明|风声)$/.test(hint)) { return 'trace'; }
    if (/^(私|私域|暗)$/.test(hint)) { return 'private'; }
    const s = trimText(text);
    if (!s) { return 'private'; }
    if (STRONG_PUBLIC_CUE.test(s)) { return 'public'; }
    if (TRACE_CUE.test(s)) { return 'trace'; }
    return 'private';   /* 宁可私域 ✓ */
}

/** 兼容旧调用：只有真正 public 才算「够公开」 */
export function isPublicText(text, visibilityHint) {
    return resolveVisibility(text, visibilityHint) === 'public';
}

/**
 * ★ P1-7（修复单 20261019）：**世界脉动**（局势不是空话，带压力／趋势／可见度／原文证据）。
 *   为什么：一句“谁和谁在起冲突”看不出它有多重、在往哪边走、外界知不知道；
 *   而“证据”是为了事后能回答“这句从哪来”。
 */
export function normalizeSituation(s) {
    const src = s && typeof s === 'object' ? s : {};
    const pNum = Number(src.pressure);
    return {
        title: trimText(src.title || src.text),
        sides: trimText(src.sides),
        tier: trimText(src.tier),
        cause: trimText(src.cause),
        effect: trimText(src.effect),
        /* ★ [580]／世界背面 A6：预期／实际／余波三格（与 cause／effect 并列，⛔ 不混成一句） */
        expected: trimText(src.expected || src.expectedResult || src.预期),
        result: trimText(src.result || src.实际 || src.实果),
        consequence: trimText(src.consequence || src.余波 || src.后果),
        /* ★ [580]／观棋 B1：来路三型 plot｜ripple｜state（空＝旧账） */
        origin: (() => {
            const o = String(trimText(src.origin || src.originKind) || '').toLowerCase();
            return (o === 'plot' || o === 'ripple' || o === 'state') ? o : '';
        })(),
        pressure: Number.isFinite(pNum) ? Math.max(0, Math.min(5, pNum)) : null,
        trend: trimText(src.trend),
        visibility: resolveVisibility(
            trimText(src.title || src.text) + ' ' + trimText(src.evidence),
            src.visibility,
        ),
        evidence: trimText(src.evidence),
        at: Number(src.at) || 0,
        floor: Number.isFinite(Number(src.floor)) ? Number(src.floor) : -1,
        closed: src.closed === true,
        manual: src.manual === true,
        /* ★ P2-7：来源（engine／book／manual）——面板上要分开显示 ✓ */
        source: trimText(src.source),
    };
}

export function fingerprintOf(text) {
    const s = String(text == null ? '' : text);
    let h = 5381;
    for (let i = 0; i < s.length; i += 1) {
        h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
}

export function setEvents(events) {
    const state = loadState();
    state.events = (Array.isArray(events) ? events : []).map((e) => ({
        id: trimText(e.id) || makeId('ev'),
        title: trimText(e.title),
        text: trimText(e.text),
        kind: trimText(e.kind) || 'situation',   // situation｜hidden
        sides: trimText(e.sides),
        tier: trimText(e.tier),
        origin: (() => {
            const o = String(trimText(e.origin) || '').toLowerCase();
            return (o === 'plot' || o === 'ripple' || o === 'state') ? o : '';
        })(),
        stage: trimText(e.stage),
        at: Number(e.at || now()),
        floor: Number.isFinite(e.floor) ? e.floor : -1,
        /* ★ P1-3：来源类型（situation/hidden/book/manual）＋原文引用＋指纹 ✓ */
        source: trimText(e.source) || '',
        /* ★ [579]/[580]：可见度三态；只有 public 才准当世界新闻广播 ✓ */
        ...(() => {
            const blob = trimText(e.title) + ' ' + trimText(e.text) + ' ' + trimText(e.evidence);
            const vis = resolveVisibility(blob, e.visibility);
            return { visibility: vis, public: vis === 'public' };
        })(),
        closed: e.closed === true,
        quote: trimText(e.quote),
        fingerprint: trimText(e.fingerprint) || fingerprintOf(trimText(e.title) + '|' + trimText(e.text)),
        /* ★ R32：脉动四格随事件池走，注入侧才能读到 ✓ */
        pressure: Number.isFinite(Number(e.pressure)) ? Math.max(0, Math.min(5, Number(e.pressure))) : null,
        trend: trimText(e.trend),
        evidence: trimText(e.evidence),
        /* ★ [580] A6：后果三格随事件池走 ✓ */
        cause: trimText(e.cause),
        effect: trimText(e.effect),
        expected: trimText(e.expected || e.expectedResult),
        result: trimText(e.result),
        consequence: trimText(e.consequence),
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
    let patched = false;
    for (const s of (Array.isArray(w.situations) ? w.situations : [])) {
        const tt = trimText(s && s.title);
        if (!tt) { continue; }
        /* ★ R32：已在池里的同名局势也要把脉动四格回填进去（旧账只有标题时也能进注入） ✓ */
        const hit = olds.find((e) => e && trimText(e.title) === tt && (trimText(e.kind) || 'situation') === 'situation');
        if (hit) {
            const pNum = Number(s && s.pressure);
            hit.pressure = Number.isFinite(pNum) ? Math.max(0, Math.min(5, pNum)) : null;
            hit.trend = trimText(s && s.trend);
            hit.evidence = trimText(s && s.evidence);
            if (trimText(s && s.sides)) { hit.sides = trimText(s.sides); }
            if (trimText(s && s.tier)) { hit.tier = trimText(s.tier); }
            if (trimText(s && s.origin)) { hit.origin = trimText(s.origin); }
            /* ★ [580] A6：回填后果三格 ✓ */
            if (trimText(s && s.cause)) { hit.cause = trimText(s.cause); }
            if (trimText(s && s.effect)) { hit.effect = trimText(s.effect); }
            if (trimText(s && s.expected)) { hit.expected = trimText(s.expected); }
            if (trimText(s && s.result)) { hit.result = trimText(s.result); }
            if (trimText(s && s.consequence)) { hit.consequence = trimText(s.consequence); }
            /* ★ [579]/[580]：回填时也按三态重算公开（⛔ 旧布尔卡死） */
            const blob = tt + ' ' + trimText(hit.text) + ' ' + trimText(s && s.evidence);
            const vis = resolveVisibility(blob, s && s.visibility);
            hit.visibility = vis;
            hit.public = vis === 'public';
            patched = true;
            continue;
        }
        if (have.has(tt)) { continue; }
        have.add(tt);
        add.push({
            title: tt,
            text: trimText(s && s.note) || tt,
            kind: 'situation',
            source: 'situation',
            quote: trimText(s && (s.evidence || s.note)) || tt,
            sides: trimText(s && s.sides),
            tier: trimText(s && s.tier),
            origin: trimText(s && s.origin),
            cause: trimText(s && s.cause),
            effect: trimText(s && s.effect),
            expected: trimText(s && s.expected),
            result: trimText(s && s.result),
            consequence: trimText(s && s.consequence),
            pressure: Number.isFinite(Number(s && s.pressure)) ? Number(s.pressure) : null,
            trend: trimText(s && s.trend),
            visibility: trimText(s && s.visibility),
            evidence: trimText(s && s.evidence),
        });
    }
    for (const h of (Array.isArray(w.hidden) ? w.hidden : [])) {
        const tn = trimText(h && h.name);
        if (!tn || have.has(tn)) { continue; }
        have.add(tn);
        add.push({ title: tn, text: trimText(h && h.note) || tn, kind: 'hidden', source: 'hidden', quote: trimText(h && h.note) || tn, stage: trimText(h && h.stage) });
    }
    if (add.length || patched) {
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
        facts: [],
        pulse: { lastSweepAt: 0, domains: [], coverage: { lastSweepAt: 0, entries: [] } },
        winds: [],
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
    state.rollCheckpoint = null;
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

/**
 * ★ 20261023（阿砘 16 号）：**列出快照，她自己挑一份回去**。
 *   返回最新的在前（便于界面上“最近一次”排第一行）。
 */
export function listSnapshots() {
    const state = loadState();
    const arr = Array.isArray(state.snapshots) ? state.snapshots : [];
    return arr.map((s, i) => ({
        index: i,
        at: (s && s.at) || '',
        label: trimText(s && s.label) || '快照',
        chars: (s && s.data && Array.isArray(s.data.characters)) ? s.data.characters.length : 0,
        events: (s && s.data && Array.isArray(s.data.events)) ? s.data.events.length : 0,
    })).reverse();
}

/**
 * ★ 恢复到指定快照（下标按 listSnapshots 的原始位置）；
 *   同样"先留一手"：恢复前把当前账再压一版，回错了能再回来。
 */
export function rollbackToSnapshot(index) {
    const state = loadState();
    const arr = Array.isArray(state.snapshots) ? state.snapshots : [];
    const i = Math.round(Number(index));
    if (!Number.isFinite(i) || i < 0 || i >= arr.length) { return null; }
    const snap = arr[i];
    if (!snap || !snap.data) { return null; }
    const undo = snapshotPayload(state);
    state.characters = snap.data.characters || [];
    state.world = snap.data.world || state.world;
    state.events = snap.data.events || [];
    state.chronicle = Array.isArray(snap.data.chronicle) ? snap.data.chronicle : state.chronicle;
    if (Array.isArray(snap.data.newPeople)) { state.newPeople = snap.data.newPeople; }
    state.stat = snap.data.stat || state.stat;
    state.snapshots.push({ at: now(), label: '恢复前（可再回去）', data: undo });
    if (state.snapshots.length > SNAPSHOT_KEEP) {
        state.snapshots = state.snapshots.slice(-SNAPSHOT_KEEP);
    }
    saveState();
    return { ok: true, label: snap.label };
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
    /* ★ [580] C2：必须深拷贝再装 —— 浅引用会让后续推演把存档点一起改脏 ✗ */
    const data = deepClone(snap.data);
    state.characters = Array.isArray(data.characters) ? data.characters : state.characters;
    state.world = data.world || state.world;
    state.events = Array.isArray(data.events) ? data.events : state.events;
    if (Array.isArray(data.chronicle)) {
        state.chronicle = data.chronicle;
    }
    if (Array.isArray(data.newPeople)) {
        state.newPeople = data.newPeople;
    }
    state.stat = data.stat || state.stat;
    saveState();
    return true;
}

/**
 * ★ [580]／世界记忆引擎 C2：**记下这一楼推演前的存档点**。
 *   只在「这一楼第一次成功落账」时写入；同楼换 swipe 重算时**不覆盖**（基底要固定）。
 */
export function rememberRollCheckpoint(floor, payload) {
    const fl = Number(floor);
    if (!Number.isFinite(fl) || fl < 0 || !payload) {
        return false;
    }
    const state = loadState();
    if (state.rollCheckpoint && Number(state.rollCheckpoint.floor) === fl && state.rollCheckpoint.data) {
        return false;
    }
    state.rollCheckpoint = { floor: fl, at: now(), data: deepClone(payload) };
    saveState();
    return true;
}

/** 取某一楼的重算存档点（对不上楼号 ⇒ null） */
export function getRollCheckpoint(floor) {
    const state = loadState();
    const cp = state.rollCheckpoint;
    if (!cp || !cp.data || Number(cp.floor) !== Number(floor)) {
        return null;
    }
    return cp;
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
