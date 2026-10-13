/**
 * 万象阁 · 设置层
 *
 * 存两处：
 *   ① 全局设置（开关、召回参数、提示词）＝酒馆的扩展设置，随账号持久化，刷新、重开都在；
 *   ② 人物名册 ＝按聊天各分各的（新聊天＝新世界），存在当前聊天的账本里。
 */

import { DEFAULT_SETTINGS, SETTINGS_KEY, SETTINGS_VERSION } from './config.js';
import { getExtensionSettings, persistSettings } from './adapter.js';
import { clampNumber, toList, trimText } from './utils.js';

let settings = null;

/** 取当前设置（首次调用时用品默认值兜底并补齐缺键） */
export function getSettings() {
    if (!settings) {
        settings = loadSettings();
    }
    return settings;
}

function loadSettings() {
    const store = getExtensionSettings();
    const saved = store && store[SETTINGS_KEY] && typeof store[SETTINGS_KEY] === 'object'
        ? store[SETTINGS_KEY]
        : {};

    const merged = Object.assign({}, DEFAULT_SETTINGS, saved);

    // 补齐缺键（升级后老设置少了新键时不至于炸）
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
        if (!Object.hasOwn(merged, key) || merged[key] === undefined) {
            merged[key] = DEFAULT_SETTINGS[key];
        }
    }

    // 数值型参数夹取到合理范围
    merged.recentTurns = clampNumber(merged.recentTurns, 1, 10, DEFAULT_SETTINGS.recentTurns);
    merged.maxChars = clampNumber(merged.maxChars, 1, 20, DEFAULT_SETTINGS.maxChars);
    merged.maxEvents = clampNumber(merged.maxEvents, 0, 20, DEFAULT_SETTINGS.maxEvents);
    merged.updateEvery = clampNumber(merged.updateEvery, 1, 10, DEFAULT_SETTINGS.updateEvery);
    merged.sortMode = merged.sortMode === 'name' ? 'name' : 'related';
    merged.enabled = merged.enabled !== false;
    merged.cardEnabled = merged.cardEnabled !== false;
    merged.strictMention = merged.strictMention === true;
    merged.protectedBypass = merged.protectedBypass !== false;
    merged.showEmptyCard = merged.showEmptyCard !== false;
    merged.injectHeader = trimText(merged.injectHeader) || DEFAULT_SETTINGS.injectHeader;
    merged.version = SETTINGS_VERSION;
    merged.roster = []; // 名册另存，见 state.js

    if (store) {
        store[SETTINGS_KEY] = merged;
    }
    persistSettings();
    return merged;
}

/** 改一处设置并立刻存盘 */
export function patchSettings(patch) {
    const s = getSettings();
    Object.assign(s, patch || {});
    const store = getExtensionSettings();
    if (store) {
        store[SETTINGS_KEY] = s;
    }
    persistSettings();
    return s;
}

/** 设置里的提示词、名单文本统一走这个（留空＝用默认） */
export function textOrDefault(value, fallback) {
    const v = trimText(value);
    return v || fallback;
}

/** 名单类文本 → 数组 */
export function listSetting(value) {
    return toList(value);
}
