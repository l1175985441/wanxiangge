/**
 * 万象阁 · 设置层
 *
 * 存两处：
 *   ① 全局设置（开关、参数、提示词、四格、API）＝酒馆的扩展设置，随账号持久化；
 *   ② 人物名册与账本 ＝按聊天各分各的（新聊天＝新世界），在 core/state.js。
 *
 * 规矩：留空＝用内置默认；填了＝原样用她的（⛔ 不替她改字）。
 */

import {
    DEFAULT_SETTINGS, SETTINGS_KEY, SETTINGS_VERSION, LEGACY_INJECT_HEADERS,
    DEFAULT_PROMPT_WORLD, DEFAULT_PROMPT_CHARS, DEFAULT_JAILBREAK, DEFAULT_INJECT_HEADER,
} from './config.js';
import { chatOverrides, resolveOne, resolveAll, sourceLine } from './scope.js';   /* 1-c #1：三层作用域 */
import { getExtensionSettings, persistSettings, getCtx } from './adapter.js';   /* 1-c #1：读聊天级覆盖要拿上下文 */
import { clampNumber, toList, trimText, asText } from './utils.js';
import { setLimits } from './state.js';
// ⭐ 换皮迁移要用（2026-10-15 全站改白底黑字）：只迁"原封没动过"的旧砚墨
import { migrateInkToLight } from '../ui/theme.js';

let settings = null;
let loadedWithStore = false;

/**
 * 还没拿到"酒馆设置区"时改过的设置，先攒在这里。
 * ⚠️ 没有这一手会真丢：启动早期（拿到设置区之前）调 patchSettings，
 *    写进去的是一个没人要的对象；等设置区到齐、重新对齐时就会被覆盖掉。
 *    ⇒ 攒起来，等设置区到齐再补写一遍。
 */
let pendingPatch = null;

/**
 * ★ 20261023：**这一次请求该用哪套 API？**
 *   有选中书签 ⇒ 书签字段盖过基础配置（⛔ 用基础配置发到别的站）
 */
export function resolveApi() {
    const s = getSettings();
    const api = (s && s.api) || {};
    const want = trimText(api.currentProfile);
    if (!want) { return api; }
    const list = Array.isArray(api.profiles) ? api.profiles : [];
    const hit = list.find((x) => (trimText(x && x.nick) || trimText(x && x.name)) === want);
    return hit ? Object.assign({}, api, hit) : api;
}

export function getSettings() {
    if (!settings) {
        settings = loadSettings();
    } else if (!loadedWithStore) {
        // 之前那次是在"还没拿到酒馆设置区"的时候读的（拿到的是内置默认，没落盘）
        const store = getExtensionSettings();
        if (store) {
            settings = loadSettings();
            flushPending();
        }
    }
    return settings;
}

/**
 * 入口在 setContext 之后叫一次：确保设置是跟**酒馆设置区**对过的，
 * ⛔ 不是"启动早期读到的内置默认"。
 */
export function reloadSettings() {
    settings = null;
    loadedWithStore = false;
    const s = getSettings();
    flushPending();
    return s;
}

/** 把"设置区到齐之前改过的"补写进去 */
function flushPending() {
    if (!pendingPatch) {
        return;
    }
    const store = getExtensionSettings();
    if (!store) {
        return;
    }
    const patch = pendingPatch;
    pendingPatch = null;
    Object.assign(settings, patch);
    store[SETTINGS_KEY] = settings;
    persistSettings();
}

function loadSettings() {
    const store = getExtensionSettings();
    const saved = store && store[SETTINGS_KEY] && typeof store[SETTINGS_KEY] === 'object'
        ? store[SETTINGS_KEY]
        : {};

    const merged = Object.assign({}, DEFAULT_SETTINGS, saved);

    /*
     * ⭐ 换皮迁移（2026-10-15）：全站改成**白底黑字**（照目标包）。
     *    ⚠️ 光改默认值不够用——她设置里存着旧的深色四个槽位，`Object.assign` 会让**存的值盖住默认**
     *      ⇒ 真机上换了皮跟没换一样（截图逐字节相同，我踩过）。
     *    ⇒ 在**读设置这一步**把"原封没动过的旧砚墨"迁到新砚墨；
     *      ⛔ 她自己调过的四个槽位一个都不动（"我改过的引擎要认"）。
     */
    const migratedLook = migrateInkToLight(merged.appearance);
    if (migratedLook) {
        merged.appearance = Object.assign({}, merged.appearance || {}, migratedLook);
    }

    // 补齐缺键（升级后新增的设置项不会缺）
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
        if (!Object.hasOwn(merged, key) || merged[key] === undefined) {
            merged[key] = DEFAULT_SETTINGS[key];
        }
    }

    // 数值夹取
    merged.recentTurns = clampNumber(merged.recentTurns, 1, 10, DEFAULT_SETTINGS.recentTurns);
    /*
     * 依据＝渲染层 #8（maxChars 两义）：旧键 `maxChars` 数的是**人数** ⇒ 正式名 `capPeople`。
     *   读档时搬家（⛔ 只改名不认旧账）：她存过的 50 不能因为改名变回 8。
     */
    if (Object.prototype.hasOwnProperty.call(merged, 'maxChars') && !Object.prototype.hasOwnProperty.call(merged, 'capPeople')) {
        merged.capPeople = merged.maxChars;
    }
    if (Object.prototype.hasOwnProperty.call(merged, 'maxChars')) {
        delete merged.maxChars;
    }
    merged.capPeople = clampNumber(merged.capPeople, 1, 99, DEFAULT_SETTINGS.capPeople);   /* 依据＝阿砚 24 号：读档这把尺也不封顶 8（原来面板能填 99、读档夹回 8） */
    merged.maxEvents = clampNumber(merged.maxEvents, 0, 20, DEFAULT_SETTINGS.maxEvents);
    merged.updateEvery = clampNumber(merged.updateEvery, 1, 10, DEFAULT_SETTINGS.updateEvery);
    merged.maxParallelChars = clampNumber(merged.maxParallelChars, 0, 12, DEFAULT_SETTINGS.maxParallelChars);
    merged.capEvents = clampNumber(merged.capEvents, 10, 300, DEFAULT_SETTINGS.capEvents);
    merged.capChronicle = clampNumber(merged.capChronicle, 100, 5000, DEFAULT_SETTINGS.capChronicle);
    merged.capHidden = clampNumber(merged.capHidden, 5, 200, DEFAULT_SETTINGS.capHidden);
    merged.capPast = clampNumber(merged.capPast, 2, 20, DEFAULT_SETTINGS.capPast);
    /*
     * ⭐ L2：**load 这边也夹一下**。
     *   常规写入走 patchSettings（那边 NUM 表里有它），
     *   但**直接改过设置文件的旧档**读进来时没人夹 ⇒ 超大值会一路带进渲染（低危但不该）。
     */
    merged.pastFloorCut = clampNumber(merged.pastFloorCut, 0, 50, DEFAULT_SETTINGS.pastFloorCut);

    merged.sortMode = merged.sortMode === 'name' ? 'name' : 'related';
    /*
     * ⭐ ST3（材料 11·设置层）：**幽灵总开关归一化为开** ✓
     *   旧：`merged.enabled = merged.enabled !== false` ✗
     *     ⇒ 面板上早已拆掉总开关复选框（她去酒馆扩展列表关 ✓）✗
     *     ⇒ 但旧存档里一旦是 false ✗ ⇒ **全插件所有功能直接罢工**（报总开关关着 ✗）
     *     ⇒ 且面板上**没有任何开关能把它重新打开** ✗
     *   现在：加载时**强制归一化为开** ✓（开关真实位置＝酒馆扩展列表 ✓）
     */
    merged.enabled = true;
    merged.cardEnabled = merged.cardEnabled !== false;
    merged.showEmptyCard = merged.showEmptyCard !== false;
    merged.strictMention = merged.strictMention === true;
    merged.protectedBypass = merged.protectedBypass !== false;
    merged.autoUpdate = merged.autoUpdate !== false;
    merged.stripPairedBlocks = merged.stripPairedBlocks !== false;
    merged.stripHtmlComments = merged.stripHtmlComments !== false;
    merged.onlyEnabledEntries = merged.onlyEnabledEntries !== false;
    merged.showPanelOnStart = merged.showPanelOnStart === true;

    merged.injectHeader = trimText(merged.injectHeader) || DEFAULT_INJECT_HEADER;
    // 升级：还是旧默认文案就换新的；她自己改过的一律保留
    for (const legacy of LEGACY_INJECT_HEADERS) {
        if (merged.injectHeader === legacy) {
            merged.injectHeader = DEFAULT_INJECT_HEADER;
            break;
        }
    }

    // API 那一块也要补齐
    merged.api = Object.assign({}, DEFAULT_SETTINGS.api, merged.api && typeof merged.api === 'object' ? merged.api : {});
    merged.api.mode = merged.api.mode === 'direct' ? 'direct' : 'proxy';
    merged.api.temperature = Number.isFinite(Number(merged.api.temperature)) ? Number(merged.api.temperature) : DEFAULT_SETTINGS.api.temperature;
    merged.api.maxTokens = clampNumber(merged.api.maxTokens, 200, 65536, DEFAULT_SETTINGS.api.maxTokens);
    /* ⭐ 她可调：每轮最多喂多少字正文（默认 6000 ✓，越小请求越短 ✓） */
    merged.api.materialCap = clampNumber(merged.api.materialCap, 500, 40000, DEFAULT_SETTINGS.api.materialCap);
    /* ⭐ 链路掉线后自己再试几次（0～5 ✓ 默认 2） */
    merged.api.autoRetryMax = clampNumber(merged.api.autoRetryMax, 0, 5, DEFAULT_SETTINGS.api.autoRetryMax);
    /*
     * ★ 20261023（她拍板）：三格“不靠酒馆也能自己调请求”的参数。
     *   附加主体参数（extraBody）？排除主体参数（excludeBody，默认 top_p）；附加请求头（extraHeaders）。
     */
    merged.api.extraBody = trimText(merged.api.extraBody);
    merged.api.excludeBody = trimText(merged.api.excludeBody) || 'top_p';
    merged.api.extraHeaders = trimText(merged.api.extraHeaders);
    /* ★ 同日：direct 下书签选择要真生效 ⇒ 统一解析出“这一次该用哪套” */
    try {
        const wantP = trimText(merged.api.currentProfile);
        const listP = Array.isArray(merged.api.profiles) ? merged.api.profiles : [];
        const hitP = wantP ? listP.find((x) => (trimText(x.nick) || trimText(x.name)) === wantP) : null;
        merged.api.__resolved = hitP ? Object.assign({}, merged.api, hitP, { currentProfile: wantP }) : null;
    } catch (eRP) { merged.api.__resolved = null; }

    // ⭐ API 书签：归一成数组（老设置里没有这个键 ⇒ 补空数组）
    merged.api.profiles = Array.isArray(merged.api.profiles)
        ? merged.api.profiles.filter((p) => p && typeof p === 'object' && (trimText(p.nick) || trimText(p.name))).map((p) => ({
            /* ★ 20261023 真机实测：旧书签字段是 name，只认 nick ⇒ 旧书签被过滤掉、currentProfile 对不上 ⇒ 回退第一套且 key 不带。现在两个都认，并保留 name 供匹配 ✓ */
            nick: trimText(p.nick) || trimText(p.name),
            name: trimText(p.name),
            mode: p.mode === 'direct' ? 'direct' : 'proxy',
            url: trimText(p.url),
            key: trimText(p.key),
            model: trimText(p.model),
            modelCheap: trimText(p.modelCheap),
            temperature: Number.isFinite(Number(p.temperature)) ? Number(p.temperature) : DEFAULT_SETTINGS.api.temperature,
            maxTokens: clampNumber(p.maxTokens, 200, 65536, DEFAULT_SETTINGS.api.maxTokens),
            /* ⭐ ST5（材料 11）：**归一化表里也要有这两个字段** ✓
             *   （旧：这张表没写 ⇒ 存进去了也会在下次加载时被过滤掉 ✗） */
            materialCap: clampNumber(p.materialCap, 500, 40000, DEFAULT_SETTINGS.api.materialCap),
            autoRetryMax: clampNumber(p.autoRetryMax, 0, 5, DEFAULT_SETTINGS.api.autoRetryMax),
            at: Number(p.at || 0),
        }))
        : [];

    merged.panel = Object.assign({}, DEFAULT_SETTINGS.panel, merged.panel && typeof merged.panel === 'object' ? merged.panel : {});
    /*
     * ⭐ 修复单 #6 同族：**mini 也要合并**。
     *   上面那个"补齐缺键"的循环只补**顶层**键：老档里 `mini` 存在、但缺 `show` 这类子键时，
     *   `merged.mini` 就带着 `undefined` 往下走，而消费方 `ui/mini.js` 是
     *   `if (!cfg.show) return null` ⇒ **悬浮球静默消失**（她那边就是"球不见了、也没报错"）。
     *   ⛔ 别指望顶层循环兜住——它只管一层。
     */
    merged.mini = Object.assign({}, DEFAULT_SETTINGS.mini, merged.mini && typeof merged.mini === 'object' ? merged.mini : {});

    merged.version = SETTINGS_VERSION;
    merged.roster = [];   // 名册另存（按聊天各分各的）

    if (store) {
        store[SETTINGS_KEY] = merged;
        loadedWithStore = true;
    }
    persistSettings();
    applyLimits(merged);
    return merged;
}

/** 把容量上限交给状态层（避免两边 import 打转） */
function applyLimits(s) {
    setLimits({
        capEvents: s.capEvents,
        capHidden: s.capHidden,
        capChronicle: s.capChronicle,
        capPast: s.capPast,
    });
}

/**
 * 改一处设置并立刻存盘。
 * ⚠️ 面板上填进来的数字是**字符串**（input.value 就是字符串）——这里统一夹取成数字，
 *    免得比较／推算时变成 "3" + 1 = "31" 这种坑（自审里真踩到过）。
 */
export function patchSettings(patch) {
    const s = getSettings();
    const clean = Object.assign({}, patch || {});
    const NUM = {
        recentTurns: [1, 10, DEFAULT_SETTINGS.recentTurns],
        capPeople: [1, 99, DEFAULT_SETTINGS.capPeople],   /* 依据＝阿砚 24 号：不再封顶 8 */
        maxEvents: [0, 20, DEFAULT_SETTINGS.maxEvents],
        pastFloorCut: [0, 50, DEFAULT_SETTINGS.pastFloorCut],
        updateEvery: [1, 10, DEFAULT_SETTINGS.updateEvery],
        maxParallelChars: [0, 12, DEFAULT_SETTINGS.maxParallelChars],
        capEvents: [10, 300, DEFAULT_SETTINGS.capEvents],
        closedEventKeep: [0, 200, DEFAULT_SETTINGS.closedEventKeep],
        blastRadiusMax: [1, 20, DEFAULT_SETTINGS.blastRadiusMax],
        injectCharCap: [1, 5000, DEFAULT_SETTINGS.injectCharCap],
        capChronicle: [100, 5000, DEFAULT_SETTINGS.capChronicle],
        capHidden: [5, 200, DEFAULT_SETTINGS.capHidden],
        capPast: [2, 20, DEFAULT_SETTINGS.capPast],
    };
    for (const key of Object.keys(NUM)) {
        if (Object.hasOwn(clean, key)) {
            clean[key] = clampNumber(clean[key], NUM[key][0], NUM[key][1], NUM[key][2]);
        }
    }
    if (clean.api && typeof clean.api === 'object') {
        /*
         * ⚠️⚠️ `api` 必须**并进原来那份**，⛔ 不能整块替换。
         *    真事故：某一段只改了"地址"这一个键，patch 里的 api 就只有那一个键，
         *    整块一替换 ⇒ 她存好的书签 `api.profiles` **当场消失**
         *    （自测里量到：保存这一段的动作之后 profiles 从 1 条变成 null）。
         */
        const api = Object.assign({}, s.api || {}, clean.api);
        if (Object.hasOwn(api, 'temperature')) {
            /*
             * ⭐ 修复单 #6：**温度 0 被 `Number(0) || 默认` 吃掉了**——
             *   0 是合法值（她就是要"完全不随机"），结果被悄悄换成 0.4。
             *   ⇒ 只把"真的没填"（undefined／null／空串／NaN）当缺省，**0 原样留着**。
             */
            const tRaw = api.temperature;
            const tNum = (tRaw === '' || tRaw === null || tRaw === undefined) ? NaN : Number(tRaw);
            api.temperature = Number.isFinite(tNum)
                ? Math.min(2, Math.max(0, tNum))
                : DEFAULT_SETTINGS.api.temperature;
        }
        if (Object.hasOwn(api, 'maxTokens')) {
            api.maxTokens = clampNumber(api.maxTokens, 200, 65536, DEFAULT_SETTINGS.api.maxTokens);
        }
        /* ⭐⭐ 谷歌诊断修法 1（修的是我自己桶的娄子 ✗）：
         *   原来 patchSettings 没夹取这两个键 ⇒ 她在面板上调了也**写进没人读的废格** ✗（调了白调 ✗） */
        if (Object.hasOwn(api, 'materialCap')) {
            api.materialCap = clampNumber(api.materialCap, 500, 40000, DEFAULT_SETTINGS.api.materialCap);
        }
        if (Object.hasOwn(api, 'autoRetryMax')) {
            api.autoRetryMax = clampNumber(api.autoRetryMax, 0, 5, DEFAULT_SETTINGS.api.autoRetryMax);
        }
        if (Object.hasOwn(api, 'mode')) {
            api.mode = api.mode === 'direct' ? 'direct' : 'proxy';
        }
        clean.api = api;
    }

    Object.assign(s, clean);
    const store = getExtensionSettings();
    if (store) {
        store[SETTINGS_KEY] = s;
        persistSettings();
    } else {
        // ⚠️ 设置区还没到齐：先攒着，等它到齐再补写（否则这次改动会丢）
        pendingPatch = Object.assign(pendingPatch || {}, clean);
    }
    applyLimits(s);
    return s;
}

/** 三套提示词恢复内置默认（⛔ 只清空＝回默认，不动她的开关） */
export function setAllPromptsDefault() {
    return patchSettings({ promptWorld: '', promptChars: '', jailbreak: '', injectHeader: DEFAULT_INJECT_HEADER });
}

/** 内置默认提示词（原样） */
export function defaultPrompt(kind) {
    if (kind === 'world') {
        return DEFAULT_PROMPT_WORLD;
    }
    if (kind === 'chars') {
        return DEFAULT_PROMPT_CHARS;
    }
    if (kind === 'jailbreak') {
        return DEFAULT_JAILBREAK;
    }
    return '';
}

/** 实际生效的提示词：留空＝内置；填了＝她的 */
export function effectivePrompt(kind) {
    const s = getSettings();
    if (kind === 'world') {
        return trimText(s.promptWorld) || DEFAULT_PROMPT_WORLD;
    }
    if (kind === 'chars') {
        return trimText(s.promptChars) || DEFAULT_PROMPT_CHARS;
    }
    if (kind === 'jailbreak') {
        return trimText(s.jailbreak) || DEFAULT_JAILBREAK;
    }
    if (kind === 'header') {
        return trimText(s.injectHeader) || DEFAULT_INJECT_HEADER;
    }
    return '';
}

/** 把 {{占位}} 换成真内容 */
export function fillTemplate(template, values) {
    let out = asText(template);
    const map = values || {};
    for (const key of Object.keys(map)) {
        out = out.split('{{' + key + '}}').join(asText(map[key]));
    }
    /*
     * ⭐⭐ 材料 11 · 零（P4 补充）：**`{{user}}` 不许被抹成空** ✓
     *   旧：下面那句把**所有**没填上的占位都换成空 ✗
     *     ⇒ 她亲手写的「不能写 {{user}}」发出去那一刻变成「不能写 」✗
     *     ⇒ 模型**永远不知道 user 是谁** ✗（这就是她报的那个病 ✗）
     *   现在：`{{user}}` **单独兜底** ✓（谁没传就补成「玩家」✓），其余占位照旧清掉 ✓
     */
    if (!Object.prototype.hasOwnProperty.call(map, 'user')) {
        out = out.split('{{user}}').join('玩家');
    }
    // 没填上的占位换成空，⛔ 不把 {{xx}} 这种黑话喂给模型
    /* 依据＝第 7 问 P2：没填上的占位不能静默抹空（她手写错一个名字，那句就无声消失）⇒ 先记下名字告警再抹空 */
    const leftover = [];
    out = out.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (m0, k0) => { leftover.push(k0); return ''; });
    if (leftover.length && typeof console !== 'undefined' && console.warn) {
        console.warn('[prompt] 这些占位符没有对应内容、已被清空：' + Array.from(new Set(leftover)).join('、'));
    }
    return out;
}

/** 提示词里用到的占位符清单（面板上给她看） */
export function promptPlaceholders(kind) {
    if (kind === 'world') {
        /* 依据＝第 7 问 P1：模板里真用到 10 个，面板只列 4 个 ⇒ 补全 */
        return ['{{world}}', '{{clock}}', '{{recent}}', '{{hidden}}', '{{factions}}',
            '{{worldFacts}}', '{{worldWinds}}', '{{worldPulse}}', '{{blastMax}}', '{{user}}'];
    }
    if (kind === 'chars') {
        return ['{{clock}}', '{{world}}', '{{recent}}', '{{chars}}', '{{user}}'];
    }
    return [];
}

export function textOrDefault(value, fallback) {
    const v = trimText(value);
    return v || fallback;
}

export function listSetting(value) {
    return toList(value);
}

/*
 * 1-c #1：三层作用域的**读**端。
 *   优先级：聊天级快照 > 全局设置 > 内置默认。
 *   ⛔ 把三层浅拷贝拼成一个巨大对象（那样又会出现“两个真源”）。
 */
export function effectiveSetting(key) {
    try {
        const merged = getSettings();
        const defaults = DEFAULT_SETTINGS || {};
        const r = resolveOne(key, { defaults, global: merged, chat: chatOverrides(getCtx && getCtx()) });
        return r.value;
    } catch (e) {
        return (getSettings() || {})[key];
    }
}

/** 整本（只算给定的 keys）：返回值与来源，不动原对象 */
export function effectiveSettingsOf(keys) {
    try {
        const merged = getSettings();
        return resolveAll(keys, { defaults: DEFAULT_SETTINGS || {}, global: merged, chat: chatOverrides(getCtx && getCtx()) });
    } catch (e) {
        return { values: {}, sources: {} };
    }
}

/** 一行人话（诊断用） */
export function settingSourceLine() {
    const r = effectiveSettingsOf(['capPeople', 'injectCharCap', 'recentTurns']);
    return sourceLine(r.sources);
}
