/**
 * 万象阁 · 召回引擎
 *
 * ⭐ 口径：召回是**一个动作**——她发消息 → 当场算一次"这轮该带什么" →
 *    跟着她这条消息一起进请求。同一份东西，两个面：给主模型的是文字，给她看的是卡片。
 *
 * 分两档（需求书第 4 节）：
 *   · 角色状态（好感等）＝**必带那一档**（说到谁带谁）；
 *   · 世界状态／平行事件＝**自动筛**：以她的最新发言为线索，相关的进、其余排后台。
 */

import { clampNumber, countChars, matchKey, trimText, uniqueBy } from './utils.js';
import { getRoster, loadState } from './state.js';
import { getSettings, effectivePrompt } from './settings.js';

/** 注入总量封顶（硬上限，防越跑越灌） */
export const INJECT_CHAR_CAP = 1400;

/** 一人一块，封顶条数在代码里再夹一次 */
const HARD_CHAR_LIMIT = 8;

/** 聊天里最后一条用户消息所在的楼层号 */
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

/** 聊天里最后一条消息的标识（卡片挂载用） */
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

export function getMessageText(chat, floor) {
    const list = Array.isArray(chat) ? chat : [];
    const m = list[floor];
    return m ? trimText(m.mes) : '';
}

/**
 * 按名字与别名造索引。
 *
 * ⭐ 口径（自审修正）：**精确全名不限长度**（"晓""Q"这种单字名是她的角色名，⛔ 不许因为
 *    "怕误撞"就把人整个丢掉）；只有**别名**（容易撞车的昵称）才要求 2 个字以上。
 */
export function buildNameIndex(roster) {
    const index = new Map();   // key → { character, exact }
    const put = (key, c, exact) => {
        if (!key) {
            return;
        }
        const old = index.get(key);
        if (!old || (exact && !old.exact)) {
            index.set(key, { character: c, exact });
        }
    };
    for (const c of Array.isArray(roster) ? roster : []) {
        if (!c || c.ignored) {
            continue;
        }
        const full = matchKey(c.name);
        if (full) {
            put(full, c, true);          // 全名：多长都收（含单字）
        }
        for (const alias of Array.isArray(c.aliases) ? c.aliases : []) {
            const key = matchKey(alias);
            if (key.length >= 2) {
                put(key, c, false);      // 别名：2 字以上才收（防误撞）
            }
        }
    }
    return index;
}

/** 在一段文字里找出提到了哪些人（按出现位置排序） */
export function findMentions(text, index) {
    const hay = matchKey(text);
    if (!hay) {
        return [];
    }
    const hits = [];
    for (const pair of index.entries()) {
        const key = pair[0];
        const entry = pair[1];
        const pos = hay.indexOf(key);
        if (pos >= 0) {
            hits.push({ character: entry.character, pos, exact: entry.exact !== false });
        }
    }
    hits.sort((a, b) => a.pos - b.pos);
    return uniqueBy(hits, (h) => h.character.id);
}

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
function personBlock(item) {
    const c = item.character;
    const lines = ['· ' + c.name];

    if (trimText(c.affinity)) {
        lines.push('  好感：' + trimText(c.affinity) + (trimText(c.affinitySource) ? '（读自' + trimText(c.affinitySource) + '）' : ''));
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
        lines.push('  正在经历：（本轮正文已演，不重复列出）');
    } else if (trimText(c.current)) {
        lines.push('  正在经历：' + trimText(c.current));
    }

    const past = Array.isArray(c.past) ? c.past : [];
    const fresh = past.filter((p) => p && p.text && !p.injected);
    if (fresh.length) {
        lines.push('  过去经历（由近到远）：' + fresh.map((p) => p.text).join('；'));
    } else if (past.length && trimText(past[0].text)) {
        lines.push('  过去经历（最近一条）：' + trimText(past[0].text));
    }

    if (trimText(c.infer)) {
        lines.push('  推断（⛔ 不是事实）：' + trimText(c.infer));
    }
    if (c.schedule && c.schedule.length) {
        const todo = c.schedule.filter((s) => !s.done);
        if (todo.length) {
            lines.push('  日程：' + todo.map((s) => s.what + (s.due ? '（' + s.due + '）' : '')).join('；'));
        }
    }
    if (c.isPlayer) {
        lines.push('  备注：这是玩家棋子（由她本人控制），只可作为"别人对TA做的事"出现。');
    }
    if (c.isNew) {
        lines.push('  备注：名字是新认的，尚未核实。');
    }
    return lines.join('\n') + '\n';
}

/** 一条世界事件的块 */
function eventBlock(ev) {
    const title = trimText(ev && ev.title);
    if (!title) {
        return '';
    }
    const bits = [];
    if (trimText(ev.text)) {
        bits.push(trimText(ev.text));
    }
    if (trimText(ev.sides)) {
        bits.push('各方：' + trimText(ev.sides));
    }
    if (trimText(ev.stage)) {
        bits.push('阶段：' + trimText(ev.stage));
    }
    if (trimText(ev.tier)) {
        bits.push('火候：' + trimText(ev.tier));
    }
    return '· ' + title + (bits.length ? '：' + bits.join(' ｜ ') : '') + '\n';
}

/** 她把"世界状态"和"平行事件"按相关度筛出来 */
function pickEvents(leadText, ctxText, events, cap) {
    const n = clampNumber(cap, 0, 20, 6);
    if (!n || !Array.isArray(events) || !events.length) {
        return { picked: [], dropped: 0 };
    }
    const lead = matchKey(leadText);
    const ctx = matchKey(ctxText);
    const scored = events.map((ev, idx) => {
        const hay = matchKey([ev.title, ev.text, ev.sides, ev.stage].filter(Boolean).join(''));
        let score = 0;
        if (lead && hay) {
            // 发言里出现同一个词就加分（粗筛：2 字以上的切片）
            for (let i = 0; i + 2 <= lead.length; i += 2) {
                const gram = lead.slice(i, i + 2);
                if (gram.length === 2 && hay.includes(gram)) {
                    score += 2;
                }
            }
        }
        if (ctx && hay) {
            for (let i = 0; i + 2 <= ctx.length; i += 4) {
                const gram = ctx.slice(i, i + 2);
                if (gram.length === 2 && hay.includes(gram)) {
                    score += 1;
                }
            }
        }
        return { ev, idx, score };
    });
    const hot = scored.filter((s) => s.score > 0);
    const cold = scored.filter((s) => s.score === 0);
    // 相关的优先；不够封顶数就用"暗线优先、新的优先"补齐（世界不被冷落）
    hot.sort((a, b) => b.score - a.score);
    cold.sort((a, b) => (b.ev.kind === 'hidden' ? 1 : 0) - (a.ev.kind === 'hidden' ? 1 : 0)
        || (Number(b.ev.at) || 0) - (Number(a.ev.at) || 0));
    const merged = hot.concat(cold).slice(0, n);
    return { picked: merged.map((x) => x.ev), dropped: Math.max(0, events.length - merged.length) };
}

/** 把召回的条目拼成给主模型的注入块 */
export function assembleInjectText(items, events, headerText) {
    const header = trimText(headerText) || effectivePrompt('header');
    const blocks = [];
    for (const item of Array.isArray(items) ? items : []) {
        if (item && item.character) {
            blocks.push(personBlock(item));
        }
    }
    const evBlocks = (Array.isArray(events) ? events : []).map(eventBlock).filter(Boolean);

    // ⭐ 没有人物也没有事件 ⇒ 一个字都不注入（免得只灌一段世界钟，白占上下文）
    if (!blocks.length && !evBlocks.length) {
        return '';
    }

    const state = loadState();
    const worldLines = [];
    if (trimText(state.world.clock)) {
        worldLines.push('世界钟：' + trimText(state.world.clock));
    }
    if (trimText(state.world.place)) {
        worldLines.push('地点：' + trimText(state.world.place));
    }
    if (trimText(state.world.bigPicture)) {
        worldLines.push(trimText(state.world.bigPicture));
    }

    let text = header + '\n';
    if (worldLines.length) {
        text += '【世界】' + worldLines.join(' ｜ ') + '\n';
    }
    if (blocks.length) {
        text += '\n【人物】\n' + blocks.join('\n');
    }
    if (evBlocks.length) {
        text += '\n【世界上正在发生的事】\n' + evBlocks.join('');
    }

    if (countChars(text) > INJECT_CHAR_CAP) {
        // 超了就砍尾巴，并如实说明砍了多少条
        // ⭐【世界】那一段（世界钟／地点／总览）**必须保住**：它是防"时间瞎"的底，
        //    ⛔ 不能因为篇幅先从它身上砍（自审修正：原来重组时把它整个弄丢了）。
        const worldBlock = worldLines.length ? '【世界】' + worldLines.join(' ｜ ') + '\n' : '';
        let kept = worldBlock;
        let keptChars = countChars(header) + countChars(worldBlock) + 8;
        let keptPeople = 0;
        let keptEvents = 0;
        for (const b of blocks) {
            if (keptChars + countChars(b) > INJECT_CHAR_CAP) {
                break;
            }
            kept += b;
            keptChars += countChars(b);
            keptPeople += 1;
        }
        for (const b of evBlocks) {
            if (keptChars + countChars(b) > INJECT_CHAR_CAP) {
                break;
            }
            kept += b;
            keptChars += countChars(b);
            keptEvents += 1;
        }
        const droppedP = blocks.length - keptPeople;
        const droppedE = evBlocks.length - keptEvents;
        if (!keptPeople && !keptEvents && !worldBlock) {
            return '';
        }
        text = header + '\n' + kept;
        const note = [];
        if (droppedP) {
            note.push(String(droppedP) + ' 人');
        }
        if (droppedE) {
            note.push(String(droppedE) + ' 条世界事件');
        }
        if (note.length) {
            text += '\n（本轮另有 ' + note.join('、') + ' 因篇幅上限未列入）\n';
        }
    }
    return trimText(text) + '\n';
}

/**
 * 算一次召回（纯本地，不发请求）。
 * @returns {object} { floor, mesId, lead, from, items, events, chars, notes, at }
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
        events: [],
        chars: [],
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

    // 世界事件：按她最新发言相关度筛
    const evRes = pickEvents(leadText, ctxText, loadState().events || [], settings.maxEvents);
    result.events = evRes.picked;
    if (evRes.dropped > 0) {
        notes.push('世界事件共 ' + String((loadState().events || []).length) + ' 条，按相关度取了 ' + String(evRes.picked.length) + ' 条，其余排后台');
    }

    if (!kept.length && !evRes.picked.length) {
        notes.push('本轮没有说到名册里的人，也没有相关的世界事件');
    } else if (!kept.length) {
        notes.push('本轮没说到名册里的人（只带了世界事件）');
    }
    if (settings.protectedBypass && leadKeys.size) {
        notes.push('现场保护：本轮点名的 ' + String(leadKeys.size) + ' 人只带状态、不重复推演');
    }

    return result;
}

/** 这一轮注入了多少字（给回执用，与送进去的那一串同源） */
export function injectSize(text) {
    return countChars(trimText(text));
}
