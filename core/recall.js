/**
 * 万象阁 · 召回引擎
 *
 * ⭐ 口径（用户当场确认）：召回是**一个动作**——
 *    她发消息 → 当场算一次"这轮该带什么" → 跟着她这条消息一起进请求。
 *    本文件算出的这一份东西，同时供两处使用：注入给主模型（文字面）、卡片给她看（显示面）。
 *
 * 本轮实现：
 *   「人」＝说到谁就带谁——人物状态（好感等）＝必带那一档；
 *   「事」＝世界的事留到第 3 步（现在恒为空，卡片上显示空态）。
 */

import { clampNumber, countChars, matchKey, trimText, uniqueBy } from './utils.js';
import { getRoster } from './state.js';
import { getSettings } from './settings.js';

/** 注入总量封顶（硬上限，防越跑越灌；超出的人只记"未进"） */
export const INJECT_CHAR_CAP = 900;

/** 一人一块，封顶条数在代码里写死，防止用户把上下文灌爆 */
const HARD_CHAR_LIMIT = 8;

/** 聊天里最后一条用户消息所在的楼层号（拿不到返回 -1） */
export function findLastUserFloor(chat) {
    const list = Array.isArray(chat) ? chat : [];
    for (let i = list.length - 1; i >= 0; i -= 1) {
        const m = list[i];
        if (m && m.is_user && !m.is_system) {
            return i;
        }
    }
    return -1;
}

/** 聊天里最后一条消息的标识（给卡片挂载用） */
export function findLastMesId(chat) {
    const list = Array.isArray(chat) ? chat : [];
    for (let i = list.length - 1; i >= 0; i -= 1) {
        const m = list[i];
        if (m && trimText(m.mesId)) {
            return trimText(m.mesId);
        }
    }
    return '';
}

/** 取某楼层消息的正文 */
export function getMessageText(chat, floor) {
    const list = Array.isArray(chat) ? chat : [];
    const m = list[floor];
    if (!m) {
        return '';
    }
    return trimText(m.mes);
}

/** 按名字与别名造索引（大小写、空白、标点都不计较） */
export function buildNameIndex(roster) {
    const index = new Map();
    for (const c of Array.isArray(roster) ? roster : []) {
        if (!c || c.ignored) {
            continue;
        }
        const forms = [c.name].concat(Array.isArray(c.aliases) ? c.aliases : []);
        for (const form of forms) {
            const key = matchKey(form);
            if (key.length < 2) {
                continue; // 单字太容易误撞，不参与匹配（要召回请把全名或别名填进别名表）
            }
            if (!index.has(key)) {
                index.set(key, c);
            }
        }
    }
    return index;
}

/** 在一段文字里找出提到了哪些人（按出现位置排序，去重） */
export function findMentions(text, index) {
    const hay = matchKey(text);
    if (!hay) {
        return [];
    }
    const hits = [];
    for (const pair of index.entries()) {
        const key = pair[0];
        const ch = pair[1];
        const pos = hay.indexOf(key);
        if (pos >= 0) {
            hits.push({ character: ch, pos });
        }
    }
    hits.sort((a, b) => a.pos - b.pos);
    return uniqueBy(hits, (h) => h.character.id);
}

/** 最近几楼正文（作为"没说名字但正在演"的线索） */
function recentContext(chat, leadFloor, turns) {
    const list = Array.isArray(chat) ? chat : [];
    const n = clampNumber(turns, 1, 10, 3);
    const start = Math.max(0, leadFloor - n);
    const parts = [];
    for (let i = start; i < leadFloor; i += 1) {
        const text = getMessageText(list, i);
        if (text) {
            parts.push(text);
        }
    }
    return parts.join('\n');
}

/** 一个人的状态块（给主模型看的那份） */
function personBlock(item, header) {
    const c = item.character;
    const lines = ['· ' + c.name];

    if (trimText(c.affinity)) {
        lines.push('  好感：' + trimText(c.affinity));
    } else {
        lines.push('  好感：未接入数据源（不显示数值）');
    }
    if (trimText(c.age)) {
        lines.push('  年龄：' + trimText(c.age));
    }
    if (trimText(c.identity)) {
        lines.push('  身份：' + trimText(c.identity));
    }
    if (trimText(c.faction)) {
        lines.push('  所在势力：' + trimText(c.faction));
    }
    if (trimText(c.timePlace)) {
        lines.push('  时间·地点：' + trimText(c.timePlace));
    }

    if (item.inScene && item.protected) {
        // 现场保护：正文里刚演过的人，本轮不重复推演，只带状态
        lines.push('  正在经历：（本轮正文已演，不重复列出）');
    } else if (trimText(c.current)) {
        lines.push('  正在经历：' + trimText(c.current));
    }

    const past = Array.isArray(c.past) ? c.past : [];
    const fresh = past.filter((p) => p && p.text && !p.injected);
    if (fresh.length) {
        lines.push('  过去经历（由近到远）：' + fresh.map((p) => p.text).join('；'));
    } else if (past.length && past[0] && past[0].text) {
        lines.push('  过去经历（最近一条）：' + past[0].text);
    }

    if (c.isPlayer) {
        lines.push('  备注：这是玩家棋子（由她本人控制），只可作为"别人对TA做的事"出现。');
    }
    if (c.isNew) {
        lines.push('  备注：名字是新认的，尚未核实。');
    }
    return lines.join('\n') + '\n';
}

/** 把召回的条目拼成给主模型的注入块（纯文字面） */
export function assembleInjectText(items, headerText) {
    const header = trimText(headerText);
    const body = [];
    for (const item of Array.isArray(items) ? items : []) {
        if (item && item.character) {
            body.push(personBlock(item, header));
        }
    }
    if (!body.length) {
        return '';
    }

    let text = header + '\n' + body.join('\n');

    // 总量封顶：超了就砍尾巴，并如实说明还差多少条没进去
    if (countChars(text) > INJECT_CHAR_CAP) {
        const kept = [];
        let used = countChars(header) + 20;
        for (const item of items) {
            const block = personBlock(item, header);
            if (used + countChars(block) > INJECT_CHAR_CAP) {
                break;
            }
            used += countChars(block);
            kept.push(item);
        }
        const dropped = items.length - kept.length;
        if (!kept.length) {
            return '';
        }
        text = header + '\n' + kept.map((it) => personBlock(it, header)).join('\n');
        text += '\n（本轮另有 ' + String(dropped) + ' 人的状态因篇幅上限未列入）\n';
    }

    return text;
}

/**
 * 算一次召回。
 * @param {object} input { chat, leadFloor, leadText }
 * @returns {object} { items, chars, events, lead, floor, from, notes }
 */
export function buildRecall(input) {
    const opts = input || {};
    const settings = getSettings();
    const chat = Array.isArray(opts.chat) ? opts.chat : [];
    const leadFloor = Number.isFinite(opts.leadFloor) ? opts.leadFloor : findLastUserFloor(chat);
    const leadText = trimText(opts.leadText);

    const notes = [];
    const result = {
        floor: leadFloor,
        mesId: findLastMesId(chat),
        lead: leadText,
        from: '',
        at: Date.now(),
        items: [],
        chars: [],
        events: [],
        notes,
    };

    if (!settings.enabled) {
        notes.push('总开关关着');
        return result;
    }
    if (leadFloor < 0) {
        notes.push('还没找到你的发言');
        return result;
    }

    const roster = getRoster().filter((c) => c && !c.ignored);
    if (!roster.length) {
        notes.push('人物名册还是空的（去设置里录入或从世界书读取）');
        return result;
    }

    const index = buildNameIndex(roster);
    const ctxText = recentContext(chat, leadFloor, settings.recentTurns);
    result.from = ctxText;

    const leadHits = findMentions(leadText, index);
    let picked = leadHits;
    if (!settings.strictMention) {
        const ctxHits = findMentions(ctxText, index);
        picked = uniqueBy(leadHits.concat(ctxHits), (h) => h.character.id);
    }
    if (settings.sortMode === 'name') {
        const order = new Map(roster.map((c, i) => [c.id, i]));
        picked = picked.slice().sort((a, b) => (order.get(a.character.id) || 0) - (order.get(b.character.id) || 0));
    }

    if (!picked.length) {
        notes.push('本轮没有说到名册里的人');
        return result;
    }

    const limit = Math.min(settings.maxChars, HARD_CHAR_LIMIT);
    const kept = picked.slice(0, limit);
    if (picked.length > kept.length) {
        notes.push('名册里共说到 ' + String(picked.length) + ' 人，按封顶取了 ' + String(kept.length) + ' 人');
    }

    const leadKeys = new Set(leadHits.map((h) => h.character.id));
    result.chars = kept.map((h) => h.character.name);
    result.items = kept.map((h) => ({
        character: h.character,
        reason: leadKeys.has(h.character.id) ? '本轮点名' : '最近正文提到',
        inScene: leadKeys.has(h.character.id),
        protected: leadKeys.has(h.character.id) && settings.protectedBypass === true,
    }));

    if (settings.protectedBypass && leadKeys.size) {
        notes.push('现场保护：本轮点名的 ' + String(leadKeys.size) + ' 人只带状态、不重复推演');
    }

    return result;
}
