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
import { getExtensionSettings, persistSettings } from './adapter.js';
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
    merged.maxChars = clampNumber(merged.maxChars, 1, 8, DEFAULT_SETTINGS.maxChars);
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
    merged.enabled = merged.enabled !== false;
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
    merged.api.maxTokens = clampNumber(merged.api.maxTokens, 200, 32000, DEFAULT_SETTINGS.api.maxTokens);
    /* ⭐ 她可调：每轮最多喂多少字正文（默认 6000 ✓，越小请求越短 ✓） */
    merged.api.materialCap = clampNumber(merged.api.materialCap, 500, 40000, DEFAULT_SETTINGS.api.materialCap);
    /* ⭐ 链路掉线后自己再试几次（0～5 ✓ 默认 2） */
    merged.api.autoRetryMax = clampNumber(merged.api.autoRetryMax, 0, 5, DEFAULT_SETTINGS.api.autoRetryMax);
    // ⭐ API 书签：归一成数组（老设置里没有这个键 ⇒ 补空数组）
    merged.api.profiles = Array.isArray(merged.api.profiles)
        ? merged.api.profiles.filter((p) => p && typeof p === 'object' && trimText(p.nick)).map((p) => ({
            nick: trimText(p.nick),
            mode: p.mode === 'direct' ? 'direct' : 'proxy',
            url: trimText(p.url),
            key: trimText(p.key),
            model: trimText(p.model),
            modelCheap: trimText(p.modelCheap),
            temperature: Number.isFinite(Number(p.temperature)) ? Number(p.temperature) : DEFAULT_SETTINGS.api.temperature,
            maxTokens: clampNumber(p.maxTokens, 200, 32000, DEFAULT_SETTINGS.api.maxTokens),
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
        maxChars: [1, 8, DEFAULT_SETTINGS.maxChars],
        maxEvents: [0, 20, DEFAULT_SETTINGS.maxEvents],
        pastFloorCut: [0, 50, DEFAULT_SETTINGS.pastFloorCut],
        updateEvery: [1, 10, DEFAULT_SETTINGS.updateEvery],
        maxParallelChars: [0, 12, DEFAULT_SETTINGS.maxParallelChars],
        capEvents: [10, 300, DEFAULT_SETTINGS.capEvents],
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
            api.maxTokens = clampNumber(api.maxTokens, 200, 32000, DEFAULT_SETTINGS.api.maxTokens);
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
    // 没填上的占位换成空，⛔ 不把 {{xx}} 这种黑话喂给模型
    out = out.replace(/\{\{[a-zA-Z0-9_]+\}\}/g, '');
    return out;
}

/** 提示词里用到的占位符清单（面板上给她看） */
export function promptPlaceholders(kind) {
    if (kind === 'world') {
        return ['{{world}}', '{{clock}}', '{{recent}}', '{{hidden}}'];
    }
    if (kind === 'chars') {
        return ['{{clock}}', '{{world}}', '{{recent}}', '{{chars}}'];
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
