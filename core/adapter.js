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
import { trimText } from './utils.js';   // ★ 20261022：setLastOwnKey 用它，之前全文没 import ⇒ 每次切聊天 ReferenceError

let ctx = null;

/** 记下酒馆的上下文对象（入口在 APP_READY 时调用一次） */
export function setContext(context) {
    ctx = context;
}

/** 当前上下文对象（可能为空） */
export function getCtx() {
    return ctx;
}

/**
 * ⭐ "你"的名字（人设名）——用来**自动认出玩家棋子**。
 *
 * 为什么要它：名册里谁是"她操控的那个人"，不该让她一个个去勾。
 * 酒馆本来就把当前档的人设名放在 `ctx.name1`（角色卡那边叫 name2），
 * 拿它对名册一比就知道了——省得 68 个人勾 68 次，而且引擎那边
 * （`pipeline`）本来就要把自己排除在"平行推演"之外，认错了会白烧额度。
 *
 * ⚠️ 只读**当前这一档**的 `name1`，⛔ 不去翻 `ctx.personas` 那张表——
 *    那是她所有档攒下来的名字，全算进来的话会把别的角色误标成"你"。
 * 拿不到就返回空数组（⛔ 不抛、不猜）。
 */
export function personaNames() {
    const out = [];
    /*
     * ⚠️ 这里**故意不用 asText**（第一版用了，但 adapter 没 import 它
     *    ⇒ 里面 ReferenceError 被下面的 catch 吞掉、静默返回空数组，
     *    表现就是"自动认玩家棋子一直不生效"——静默吞错害死人，别再来）。
     */
    const push = (v) => {
        const s = (v === undefined || v === null) ? '' : String(v);
        const t = s.trim();
        if (t && !out.includes(t)) {
            out.push(t);
        }
    };
    let name1 = null;
    try {
        name1 = ctx ? ctx.name1 : null;
    } catch (e) {
        name1 = null;
    }
    push(name1);
    return out;
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
            /* ⭐ U20（材料 12）：**群聊也要归位** ✓
             *   旧：候选里只有 chatId 与 characterId ✗ ⇒ 群聊档在初始那一瞬 chatId 未就绪就掉进 default-chat ✗
             *   现在：补上 groupId ✓（带 group- 前缀，与 char- 同一套口径 ✓）
             */
            ctx.groupId !== undefined && ctx.groupId !== null ? 'group-' + String(ctx.groupId) : '',
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
            adoptLedger(key, direct).catch((eA) => { try { console.warn('[adapter] 收养旧账本写入失败：' + String(eA && eA.message)); } catch (eA2) { } });
            if (looksLikeLedger(mirror, key) && richer(direct, mirror) === mirror) {
                md[LEDGER_KEY] = mirror;
                return mirror;
            }
            return direct;
        }
        /*
         * ⭐ 新增件 5③（材料 13）：**分支／导入档要认领，⏔ 置空毁账** ✓
         *   旧：只有“同一个聊天改名”才认领 ✗
         *     ⇒ 酒馆建分支（Branch）或导入聊天文件时，带过来的旧章账被当成“别的聊天” ✗
         *     ⇒ 收进底稿、本档置空 ⇒ **新分支从空账开始** ✗
         *   现在：若这份账的章**不在底稿盒里**（＝我们没为那个章存过别的档）
         *     且当前章也没有底稿 ⇒ **认领它** ✓（分支与导入档都落在这一条 ✓）
         *   反例：章在底稿盒里 ⇒ 那确实是另一个聊天的账 ✒ 照旧收进底稿、本档置空 ✓
         */
        const oldKey5 = keyOf(direct);
        const knownElsewhere = !!(mirrorBox && typeof mirrorBox === 'object' && oldKey5
            && Object.prototype.hasOwnProperty.call(mirrorBox, oldKey5));
        if (!knownElsewhere && !looksLikeLedger(mirror, key)) {
            adoptLedger(key, direct).catch((eA) => { try { console.warn('[adapter] 收养旧账本写入失败：' + String(eA && eA.message)); } catch (eA2) { } });
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
/*
 * ⭐⭐ 材料 06 · 15.3：**"刚切过聊天就不认自己的账"** ✗ —— 毁账的根源在这里 ✓
 *   病根：CHAT_CHANGED 先调 `resetCache()` ✗ ⇒ 内存里那本账被清掉 ✗
 *         ⇒ `cacheChatKey()` 返回空 ⇒ `isOwnPastKey` 说“不认” ✗
 *         ⇒ 继承来的账被判成“别的聊天” ⇒ `md[LEDGER_KEY] = null` ✗✗（毁账 ✗）
 *   新：**切之前先把“上一个聊天是谁”记下来** ✓ ⇒ 建分支/导入聊天时能认出“这是自己刚才那本账” ✓
 *         （真换聊天时，新聊天的 metadata 里**根本没有我们的账** ✗ ⇒ 那段根本不会触发 ⇒ **不会串档** ✓）
 */
let lastOwnKey = '';

/** 切聊天前记下“上一个聊天”的章（由 index.js 在 resetCache() 之前调 ✓） */
export function setLastOwnKey(k) {
    lastOwnKey = trimText(k);
}

function isOwnPastKey(owner) {
    if (!owner) {
        return true;   // 没盖章的账，当自己的
    }
    /* ⭐ 15.3：刚换过聊天时 `cacheChatKey()` 已被 resetCache 清空 ✗
     *   ⇒ 用“切之前记下的那个章”兜底 ✓（分支/导入能认出自己的账 ✓） */
    const liveKey = cacheChatKey() || lastOwnKey;
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
/**
 * ★ 20261023 依据＝阿砚 20 号 §③：**writeLedger 是 async，不 await 就会把写失败变成 unhandled rejection**。
 *   ⚠️ readLedger() 是同步公开 API（调用点很多），没法在里面 await ⇒ 这里返回 promise，
 *   调用点用 .catch() 挂上告警（既不丢异常、也不把同步 API 改成异步）。
 */
/** 依据＝阿砚 A 组 E4：导入一本账 = 先存再收养（对外开放这一步） */
export async function adoptLedgerForImport(key, ledger) {
    const v = await writeLedger(ledger);
    if (!v || v.ok !== true) { return { ok: false, reason: (v && v.reason) || '写不进去' }; }
    const got = readLedger();
    if (!got) { return { ok: false, reason: '写完读不回来' }; }
    return { ok: true };
}

async function adoptLedger(key, ledger) {
    ledger.chatKey = key;
    await writeLedger(ledger);
    return ledger;
}

/** 把账本的章对齐到当前聊天（读到时顺手校正） */
function syncKey(ledger, key) {
    if (ledger && typeof ledger === 'object' && keyOf(ledger) !== key) {
        ledger.chatKey = key;
    }
}

/**
 * 存账本。两件事：① 把账本递交给**平台自己的写入接口**；② 回读验证。
 *
 * ⚠️ 这里是 v0.1.3 之前没修净的坑（测试方三次实测：账在内存里、盘上没有）：
 *    酒馆的 `chat_metadata` 是个**会被整体换掉的活绑定**（加载／切换聊天时 `chat_metadata = {...}`），
 *    我早期拿着一个对象引用往里写，写进去的那个对象可能已经不是平台要保存的那一个了。
 *    ⇒ 现在一律走官方接口 `updateChatMetadata`（把新值并进**当前**那本），拿不到才退回直写；
 *      而且**写完必须回读**：回读不到就如实报错，⛔ 不许报喜不报忧。
 */
/**
 * 依据＝阿砚 A 组 B6（写盘两段式）：⏔ 再“边算边写”。
 *   第一段：把要写的这一份**算好、验过**（能序列化、能读回、没超过上限）；
 *   第二段：只有第一段过了才**覆盖**盘上那份。
 *   不合格就原封不动 + 如实记下原因（界面会读 storageReport 报红）。
 */
export function noteSaveSkip(reason) {
    lastSaveOk = false;
    saveNote = String(reason || '这次没写盘');
}

/**
 * 依据＝阿砚 A 组 B8（落盘确认：回读签名＋计时闸＋三态＋抢回）。
 *   三态：'saved'（真写下去且回读核对上）/ 'nosave'（确定没写）/ 'unknown'（超时或写的中途换了聊天 －－不敢报成功）。
 */
let lastSaveState = 'idle';
export function saveState3() {
    return lastSaveState;
}

/** 超时闸：宿主的 saveChat 在取不到文件名时会静默 return，永远不解析 ⇒ 我们不能无限等 */
function withTimeout(promise, ms, label) {
    return new Promise((resolve, reject) => {
        let done = false;
        const timer = setTimeout(() => {
            if (done) { return; }
            done = true;
            reject(new Error((label || '存盘') + '超时（' + String(ms) + 'ms 没回应）'));
        }, ms);
        Promise.resolve(promise).then((v) => {
            if (done) { return; }
            done = true;
            clearTimeout(timer);
            resolve(v);
        }, (e) => {
            if (done) { return; }
            done = true;
            clearTimeout(timer);
            reject(e);
        });
    });
}

export async function writeLedger(state, opts) {
    if (!state || typeof state !== 'object') {
        return { ok: false, reason: '账本是空的' };
    }
    /* ---- 第一段：先把要写的东西算好并验一遍 ---- */
    let payload = '';
    try {
        payload = JSON.stringify(state);
        JSON.parse(payload);
    } catch (ePrep) {
        lastSaveOk = false;
        saveNote = '账本算不出可写的样子（序列化失败），这次不写盘';
        return { ok: false, reason: saveNote };
    }
    if (payload.length > 8 * 1024 * 1024) {
        lastSaveOk = false;
        saveNote = '账本太大（' + String(Math.round(payload.length / 1024)) + 'KB），这次不覆盖盘上的旧账';
        return { ok: false, reason: saveNote };
    }
    state.chatKey = currentChatKey();   // 盖个章：这本账属于哪个聊天

    // ⭐ 底稿先落（同步入队、立刻落盘）：哪怕下面主存这条路出问题，账也丢不了
    mirrorLedger(state);

    const wrote = writeMetadataNow(state);
    if (!wrote.ok) {
        lastSaveOk = false;
        saveNote = wrote.reason || '写入没成功';
        return wrote;   // 底稿已留，账丢不了；面板会如实报红
    }

    // 存服务端（saveMetadata 是标准路子；老版本没有就走 saveChatConditional）
    const keyAtStart = currentChatKey();
    const timeoutMs = (opts && Number.isFinite(Number(opts.timeoutMs))) ? Number(opts.timeoutMs) : 4000;
    const save = pickSaver();
    if (save) {
        try {
            await withTimeout(save(), timeoutMs, '存盘');
            lastSaveOk = true;
            saveNote = '';
            lastSaveState = 'saved';
        } catch (e) {
            const msg = (e && e.message) ? e.message : String(e);
            const isTimeout = /超时/.test(msg);
            lastSaveOk = isTimeout ? null : false;   /* 超时：不敢说没写，也不敢说写了 ⇒ unknown */
            lastSaveState = isTimeout ? 'unknown' : 'nosave';
            saveNote = (isTimeout ? '存盘结果不确定（' : '存盘报错：') + msg;
            console.warn('[万象阁] 账本存盘失败（聊天记录本身不受影响）：', e);
            /* 依据＝阿砚 A 组 B8：存盘没成 ⇒ ⛔ 往下走成“回读成功就报成功”（那正是空绿） */
            return { ok: false, reason: saveNote };
        }
    } else if (!warnedNoSave) {
        warnedNoSave = true;
        console.warn('[万象阁] 这个酒馆版本没给出存盘接口（saveMetadata／saveChatConditional），账本会只在本次会话内有效——请把这条告诉我。');
    }

    /* 抢回：写的中途她切了聊天 ⇒ 这笔写进去的不一定是这本账，⏔报成功 */
    if (currentChatKey() !== keyAtStart) {
        lastSaveOk = null;
        lastSaveState = 'unknown';
        saveNote = '写的中途换了聊天（' + String(keyAtStart) + ' → ' + String(currentChatKey()) + '），这笔不敢报已存';
        return { ok: false, reason: saveNote };
    }
    // ⭐ 回读验证：写进去还不够，要能**再读出来**才算数
    const back = readBackFromMetadata();
    if (!back) {
        lastSaveOk = false;
        saveNote = '写进聊天档后读不回来（可能被平台换掉了对象）';
        return { ok: false, reason: saveNote };
    }
    return { ok: true };
}

/** 把账本交给平台写入（优先官方接口，其次拿当前那本直写） */
function writeMetadataNow(state) {
    if (!ctx) {
        return { ok: false, reason: '还没拿到酒馆上下文' };
    }
    // ① 官方接口：把新值并进"当前"那本 metadata
    if (typeof ctx.updateChatMetadata === 'function') {
        try {
            ctx.updateChatMetadata({ [LEDGER_KEY]: state });
            if (readBackFromMetadata()) {
                return { ok: true };
            }
        } catch (e) {
            console.warn('[万象阁] updateChatMetadata 写入失败，改试直接写入：', e);
        }
    }
    // ② 退路：拿**当前这一刻**的 metadata 直写（且不长期持有引用）
    try {
        const md = getChatMetadata();
        md[LEDGER_KEY] = state;
        if (readBackFromMetadata()) {
            return { ok: true };
        }
        return { ok: false, reason: '写进去了但读不回来' };
    } catch (e) {
        return { ok: false, reason: '写入出错：' + (e && e.message ? e.message : String(e)) };
    }
}

/** 从现在这一刻的聊天档里把账本读回来（回读验证用） */
function readBackFromMetadata() {
    try {
        const md = getChatMetadata();
        const got = md ? md[LEDGER_KEY] : null;
        return got && typeof got === 'object' ? got : null;
    } catch (e) {
        return null;
    }
}

/** 用哪个接口存盘 */
function pickSaver() {
    if (!ctx) {
        return null;
    }
    if (typeof ctx.saveMetadata === 'function') {
        return ctx.saveMetadata.bind(ctx);
    }
    if (typeof ctx.saveChatConditional === 'function') {
        return ctx.saveChatConditional.bind(ctx);
    }
    return null;
}

let warnedNoSave = false;
let lastSaveOk = null;
let saveNote = '';

/** 存盘情况（面板上如实报：主存／底稿／只在内存） */
export function storageReport() {
    const live = currentLive();
    const has = live ? liveHasContent(live) : false;
    if (!has) {
        return { tone: 'idle', text: '还没有账（发一条消息就有了）' };
    }
    if (lastSaveOk === false) {
        return {
            tone: 'bad',
            text: '没能存进聊天档（' + (saveNote || '原因未记录') + '）——账只保留在这次会话里，底稿还在',
        };
    }
    if (lastSaveOk === true) {
        return {
            tone: 'ok',
            text: '已存进聊天档 ✓（回读验证过；设置区里另有一份底稿）',
        };
    }
    if (lastSaveOk === null && lastSaveState === 'unknown') {
        return {
            tone: 'warn',
            text: '存盘结果不确定（' + (saveNote || '原因未记录') + '）——请刷新一下看看；底稿还在',
        };
    }
    return { tone: 'idle', text: '已经记下，正在存盘' };
}

/** 底稿里有没有当前聊天这一格 */
function mirrorBoxHasKey() {
    try {
        const store = getExtensionSettings();
        const box = store ? store[SETTINGS_KEY + '_mirror'] : null;
        return !!(box && typeof box === 'object' && box[currentChatKey()]);
    } catch (e) {
        return false;
    }
}

/** 账本里有没有东西（只看有没有，不碰内容） */
function liveHasContent(s) {
    return hasContent(s);
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
    if (Array.isArray(state.chronicle) && state.chronicle.length > 0) {
        return true;
    }
    const w = state.world && typeof state.world === 'object' ? state.world : null;
    if (w) {
        if ((w.clock && String(w.clock).trim())
            || (w.place && String(w.place).trim())
            || (w.bigPicture && String(w.bigPicture).trim())
            || (Array.isArray(w.situations) && w.situations.length > 0)
            || (Array.isArray(w.hidden) && w.hidden.length > 0)) {
            return true;
        }
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
        /*
         * ⭐ 复审追加 C1 同族：空账不仅"不值得留底"，**还得把旧底抹掉** ——
         *   否则下次读档会从底稿把刚清掉的账**捞回来**（她那边就是"清完一刷新全回来了"）。
         */
        try {
            clearMirror(null, state);
        } catch (e) {
            // 抹不掉也⛔ 把写盘带崩
        }
        return;
    }
    // ⚠️ 一律立刻落盘：攒着不写＝刷新就丢（之前每 2 秒攒一次，实测就丢了）
    // ⭐ 修复单 #3：`live: true` 戳（⚠️ **当前有意未用**：见 `flushMirror` 里 `liveOwn = false` 的说明——那条路会丢数据）
    stashToMirror(currentChatKey(), state, true);
}

/** 放进待写底稿（key 为空则按账本自己盖的章算；immediate＝立刻落盘） */
function stashToMirror(key, source, immediate, opts) {
    const snap = typeof source === 'function' ? source() : source;
    if (!snap || typeof snap !== 'object') {
        return;
    }
    const target = key || keyOf(snap);
    if (!target) {
        return;
    }
    const clone = deepClone(snap);
    /*
     * ⭐ 修复单 #3：给"**活账本刚写下来的**"这一份盖个临时戳。
     *
     *   为什么需要：`flushMirror` 里那道 `pickFresher` 保护本来是为了挡住
     *   "陈旧／只加载了一半的账"，可它**连她主动删除之后的新状态也一起挡**——
     *   纯删除（不加人）时没有任何 `updatedAt` 变新，`freshness` 跟旧底稿**打平**，
     *   于是落到比 `score` ⇒ **更全的旧底稿赢** ⇒ 删除被拒写，
     *   将来从底稿恢复会把**删掉的数据又带回来**（118 表 7.3 的新一层）。
     *   ⇒ 活账本这一路（writeLedger→mirrorLedger）明确是"此刻的真相"，直接让它赢。
     *   ⚠️ 这个戳**只在内存里用**，落盘前摘掉（⛔ 不许污染存量底稿的比新旧口径）。
     */
    if (opts && opts.live === true) {
        try {
            clone.__wxgLive = true;
        } catch (e) {
            // 冻住的对象盖不上就算了（退回原来的比新旧）
        }
    }
    mirrorPending.set(target, clone);
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

/**
 * ⭐ 复审追加 C1（试行・窄修）：**她明确发起的纯删除**，底稿直接跟着变。
 *
 *   为什么不拆 `pickFresher` 那道保护：它是用来挡"陈旧／只加载一半的账"的，
 *   拆了会丢数据（我上一轮两版修法都把 run-tests 从 95/0 打成 92/3）。
 *   ⇒ 只给"她点了删除"这条路径开一个直连：这一刻的账**就是她要的样子**（删完更穷也得跟着穷）。
 *
 *   ⚠️ 调用点：`removeCharacter` / `removeHidden` / `removeQuest` / `removeKnow` /
 *     `removeChronicleAt` / `dropRecallRecord` —— 六个**她亲手点**的删除。
 *     ⛔ 放在自动路径（对账、合并）里——那些会走原来的比新旧。
 */
export function syncMirrorAfterDelete(state) {
    if (!state || typeof state !== 'object') {
        return;
    }
    if (!hasContent(state)) {
        // 删到空 ⇒ 那一格直接抹掉（⛔ 留着旧账等下次被捞回来）
        clearMirror(null, state);
        return;
    }
    try {
        const store = getExtensionSettings();
        if (!store) {
            return;
        }
        const box = store[SETTINGS_KEY + '_mirror'] || (store[SETTINGS_KEY + '_mirror'] = {});
        const owner = keyOf(state) || currentChatKey();
        if (owner) {
            box[owner] = deepClone(state);
            persistSettings();
        }
    } catch (e) {
        console.warn('[万象阁] 删除后同步底稿失败：', e);
    }
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

/**
 * ⭐ 修复单 #9：**把某一格底稿真的删掉**（不只是从待写队列里摘）。
 *
 *   为什么非有它不可：「清空这个世界」之后 `hasContent(state)` 为假 ⇒
 *   `mirrorLedger` 会**直接跳过**（"空账不值得留底"）⇒ **旧底稿原封不动留着** ⇒
 *   下一次读档 `readLedger` 从底稿把**刚被清掉的账又捞回来**（她那边就是"清完一刷新，数据全回来了"）。
 *   ⇒ 清空动作必须**显式把那一格抹掉**。
 *   ⚠️ 只动她指定的那一格（⛔ 不许顺手清别人的聊天）。
 *
 * @returns {boolean} 真删掉了吗
 */
export function clearMirror(key, state) {
    /*
     * ⚠️ 底稿那一格的键是 `keyOf(snapshot)`（账本自己盖的章），
     *   而 `currentChatKey()` 未必等于它（自测当场证明：抹了没抹掉）。
     *   ⇒ 把**所有可能的键**都试一遍，别只认一个。
     */
    const cands = [];
    /*
     * ⚠️ 这里是 adapter.js：它**只引了 config**（没有 utils 的 trimText），
     *   而我又不想为一句 trim 去加 import（utils ⇄ adapter 有绕成环的风险）
     *   ⇒ 就地处理字符串。（我第一版直接调 `trimText` ⇒ ReferenceError，
     *     还被自己的 try/catch 吞了：**清空看着成功、底稿其实没抹**。真踩过。）
     */
    const push = (v) => {
        const s = v === undefined || v === null ? '' : String(v).trim();
        if (s && !cands.includes(s)) {
            cands.push(s);
        }
    };
    push(key);
    if (state && typeof state === 'object') {
        push(state.chatKey);
        push(keyOf(state));
    }
    push(currentChatKey());
    if (!cands.length) {
        return false;
    }
    let hit = false;
    for (const target of cands) {
        try {
            if (mirrorPending.has(target)) {
                mirrorPending.delete(target);
                hit = true;
            }
        } catch (e) {
            // 队列动不了不影响下面那道
        }
        try {
            const store = getExtensionSettings();
            const box = store && store[SETTINGS_KEY + '_mirror'];
            if (box && typeof box === 'object' && Object.prototype.hasOwnProperty.call(box, target)) {
                delete box[target];
                persistSettings();
                hit = true;
            }
        } catch (e) {
            console.warn('[万象阁] 底稿清不掉：', e);
        }
    }
    return hit;
}

/** 真正落盘：一格一格对号入座 */
/*
 * ⭐ 材料 10 · 第 4 组裁定（她 10-17 授权代拍）：**R2 后半保留（知情保留）** ✓
 *   定案：这 8 档全量镜像**保持现状** ✓
 *   理由：它是**多档切换的兜底**（换聊天档时账不丢 ✓）；
 *     R2 的最大头已由前半削掉（召回记录不再存整楼正文 ✓）✓
 *   ⇒ ⏔ 再动、⏔ 留成“待定” ✗
 */
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

        /*
         * ⚠️ 修复单 #3：**淘汰段那半已修、“让活账本赢”那半没修**（如实记在进度文件）。
         *
         *   为什么没修：纯删除被拒写的根因在这道 `pickFresher` 保护上（简单说：删完更穷 ⇒ score 更低 ⇒ 旧底稿赢）。
         *   我试了两版“让活账本赢”（① 只认 live 戳、② 加验自己的章），
         *   **两版都把 `run-tests.mjs` 从 95/0 打成 92/3**（丢回执记录）——
         *   说明这仓库里确实存在“同一聊天、但手里那份合法地更薄”的保存路径，
         *   拆掉保护就会丢数据 ⇒ 宁可不修这半，⛔ 拿数据安全换“删得干净”。
         *   ⇒ 保护原样留着（⛔ 拆）；要真修得先把“哪些保存路径会带更薄的状态”查清。
         */
        const liveOwn = false;


        // ⭐ 按账本自己盖的章归位（⛔ 别写错门牌）
        const owner = keyOf(snapshot) || key;
        const current = box[owner];
        if (!liveOwn && current && pickFresher(current, snapshot) === current) {
            continue; // 已经有一份更全（或同样全但更新）的，留住它
        }
        try {
            box[owner] = snapshot;
        } catch (e) {
            console.warn('[万象阁] 底稿写入失败：', e);
            continue;
        }
    }
    // 底稿只留最近 8 个聊天。
    // ⚠️ 自审修正·条 13：⛔ 不能按 `Object.keys` 的顺序删——那是**插入顺序**，
    //    最早建的那一格永远在队首 ⇒ 天天在用的档反而被先删掉。
    //    改成按**账本自己的时间戳**排序（与 pickFresher 同一口径），淘汰最旧的。
    const entries = Object.keys(box).map((k) => {
        const snap = box[k] || {};
        /*
         * ⭐ 修复单 #3：淘汰排序**改用真正的 `freshness()`**。
         *   原来这里手算、只看 `lastUpdate.at` 与 `recallRecords[].at` ⇒
         *   **漏了 `world.updatedAt` 与 `characters[].updatedAt`**，跟 `pickFresher` 用的不是同一把尺
         *   ⇒ 天天在用的档可能被当成"最旧"先删掉（底稿就白留了）。
         */
        return { key: k, at: freshness(snap) };
    });
    if (entries.length > 8) {
        entries.sort((a, b) => a.at - b.at);   // 最旧的排前面
        for (const item of entries.slice(0, entries.length - 8)) {
            delete box[item.key];
        }
    }
    persistSettings();
}

/** 两份账哪份更全（记账条数、已注入回执、人物数、世界状态、编年、召回过没有） */
function score(s) {
    if (!s || typeof s !== 'object') {
        return -1;
    }
    const recs = Array.isArray(s.recallRecords) ? s.recallRecords : [];
    let okPts = 0;
    for (const r of recs) {
        if (r && r.injectStatus === 'ok') {
            okPts += 2;
        }
    }
    const w = s.world && typeof s.world === 'object' ? s.world : {};
    const worldPts = (Array.isArray(w.situations) ? w.situations.length * 5 : 0)
        + (Array.isArray(w.hidden) ? w.hidden.length * 5 : 0)
        + ((w.clock && String(w.clock).trim()) || (w.place && String(w.place).trim()) || (w.bigPicture && String(w.bigPicture).trim()) ? 2 : 0);
    const chronPts = Array.isArray(s.chronicle) ? s.chronicle.length * 2 : 0;
    return (recs.length * 100)
        + okPts
        + (Array.isArray(s.characters) ? s.characters.length * 10 : 0)
        + worldPts
        + chronPts
        + (Number((s.stat || {}).recalled || 0) > 0 ? 1 : 0);
}

/** 账本有多新（取里面最新的时刻：含注入完成时刻、世界更新时刻与角色修改时刻） */
function freshness(s) {
    if (!s || typeof s !== 'object') {
        return 0;
    }
    let latest = Math.max(
        Number((s.lastUpdate || {}).at || 0),
        Number((s.world || {}).updatedAt || 0),
    );
    if (Array.isArray(s.recallRecords)) {
        for (const r of s.recallRecords) {
            const at = Math.max(Number((r && r.at) || 0), Number((r && r.injectedAt) || 0));
            if (at > latest) {
                latest = at;
            }
        }
    }
    if (Array.isArray(s.characters)) {
        for (const c of s.characters) {
            const at = Number((c && c.updatedAt) || 0);
            if (at > latest) {
                latest = at;
            }
        }
    /*
     * ⭐ R14（材料 05）：**freshness 还要算上编年的时间** ✓
     *   旧：只算 lastUpdate／world.updatedAt／recalRecords／characters ✗
     *     ⇒ 她若刚删了一条局势（仅在编年里留痕 ✓），freshness 可能算不出“这份更新” ✗
     *     ⇒ 刷新页面时被旧底稿反超 ⇒ **刚删的局势又活过来** ✗
     */
    if (Array.isArray(s.chronicle)) {
        for (const row of s.chronicle) {
            const at = Number((row && row.at) || 0);
            if (at > latest) {
                latest = at;
            }
        }
    }
    }
    return latest;
}

/**
 * 两份账留哪份：**先比谁更全，一样全就比谁更新**。
 * ⚠️ 平手时必须取新的——旧的那条已经推出过、留着它等于把新写的账丢掉（实测踩过这个坑）。
 */
/**
 * 两份账谁更新（谁的底稿该留住）。
 *
 * ⭐ **先看新鲜度，再看"全不全"**（逐条核验 7.3 时改的，原来次序反了）。
 *
 * 为什么次序要紧：原来先比 `score`（按条数算"全不全"），于是
 *   **"你主动删掉东西之后的新状态"更穷 ⇒ 被更全的旧底稿压住** ⇒ 底稿永远留着旧的，
 *   将来从底稿恢复会**把你删掉的数据又带回来**（真踩过：逐条核验第 7 组的 7.3）。
 * 改成先比时间戳之后：
 *   · 主动删除 ⇒ 新状态更新 ⇒ 新的赢（底稿跟着变）✅
 *   · 陈旧／只加载了一半的状态 ⇒ 它更旧 ⇒ 被挡住（原来那道保护还在）✅
 * ⛔ 别把次序调回去——先比 score 就会退回"删不掉"的老毛病。
 * ⚠️ 这两句次序是量出来的，不是拍的：删完+加人之后，活账本的 `freshness` 确实更大
 *   （角色的 `updatedAt` 更晚），而 `score` 更小。
 */
function pickFresher(a, b) {
    const fa = freshness(a);
    const fb = freshness(b);
    if (fa !== fb) {
        return fb > fa ? b : a;
    }
    const sa = score(a);
    const sb = score(b);
    if (sa !== sb) {
        return sb > sa ? b : a;
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
