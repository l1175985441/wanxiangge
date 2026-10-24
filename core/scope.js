/**
 * 万象阁 · 三层作用域 ＋ source（阿砚 1-c #1）
 *
 * 依据＝1-c #1：脚本级（默认）／全局预设（extensionSettings）／**聊天级快照**（chatMetadata）三层；
 *   `source = 'api' | 'ui'` 决定**写到哪一层**——机器改（api）落聊天级，人在界面改（ui）落全局。
 *   目的：同一份插件在不同聊天里各有一套任务表，互不串。
 *
 * 优先级（读）：聊天级 > 全局 > 默认。
 * 为什么这样排：聊天级是“这一个档的临时口径”，她换聊天就该回到全局口径。
 */

export const SCOPES = ['chat', 'global', 'default'];

/** 聊天级设置存在哪（与账本分开，避免和 state 混淆） */
export const CHAT_SETTINGS_KEY = 'wanxianggeSettings';

/**
 * 读聊天级覆盖（没有就空对象）。
 * @param {object} ctx SillyTavern 上下文
 */
export function chatOverrides(ctx) {
    try {
        const md = (ctx && ctx.chatMetadata) || {};
        const box = md[CHAT_SETTINGS_KEY];
        return (box && typeof box === 'object' && !Array.isArray(box)) ? box : {};
    } catch (e) {
        return {};
    }
}

/**
 * 取一个值的三层合并结果。
 * @param {string} key
 * @param {{defaults:object, global:object, chat:object}} layers
 * @returns {{value:*, source:'chat'|'global'|'default'}}
 */
export function resolveOne(key, layers) {
    const chat = (layers && layers.chat) || {};
    const global = (layers && layers.global) || {};
    const defaults = (layers && layers.defaults) || {};
    if (Object.prototype.hasOwnProperty.call(chat, key)) {
        return { value: chat[key], source: 'chat' };
    }
    if (Object.prototype.hasOwnProperty.call(global, key)) {
        return { value: global[key], source: 'global' };
    }
    return { value: defaults[key], source: 'default' };
}

/**
 * 整本合并：只对给定 keys 算（⛔ 顺手把别的层摊平）。
 * @returns {{values:object, sources:object}}
 */
export function resolveAll(keys, layers) {
    const values = {};
    const sources = {};
    for (const k of (Array.isArray(keys) ? keys : [])) {
        const r = resolveOne(k, layers);
        values[k] = r.value;
        sources[k] = r.source;
    }
    return { values, sources };
}

/**
 * 写该落到哪一层。
 *   `source='ui'`（她在界面上改）⇒ 全局：她改的是“这台插件”的口径；
 *   `source='api'`（机器算出来/任务表）⇒ 聊天级：只影响这一个档。
 * @returns {'chat'|'global'}
 */
export function targetScope(source) {
    return String(source) === 'api' ? 'chat' : 'global';
}

/**
 * 把一次写落到正确层，返回它实际去了哪。
 * @param {string} source 'api'|'ui'
 * @param {{toChat:Function, toGlobal:Function}} io
 */
export function writeSetting(key, value, source, io) {
    const scope = targetScope(source);
    const box = io || {};
    if (scope === 'chat') {
        if (typeof box.toChat === 'function') { box.toChat(key, value); }
    } else if (typeof box.toGlobal === 'function') {
        box.toGlobal(key, value);
    }
    return { key, value, scope, source: String(source) };
}

/** 给人看的一行（诊断用） */
export function sourceLine(sources) {
    const s = sources || {};
    const keys = Object.keys(s);
    if (!keys.length) { return '设置来源：无'; }
    const chat = keys.filter((k) => s[k] === 'chat');
    const glob = keys.filter((k) => s[k] === 'global');
    const def = keys.filter((k) => s[k] === 'default');
    return '设置来源：聊天级 ' + String(chat.length) + ' 项'
        + '／全局 ' + String(glob.length) + ' 项'
        + '／默认 ' + String(def.length) + ' 项';
}
