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

import { clampNumber, countChars, matchKey, trimText, uniqueBy, eventTitle } from './utils.js';
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

/** 聊天里锚点楼（含）之前最近一条消息的标识（卡片挂载用；不传 maxFloor 则从末尾找） */
export function findLastMesId(chat, maxFloor) {
    const list = Array.isArray(chat) ? chat : [];
    const start = Number.isFinite(Number(maxFloor)) && Number(maxFloor) >= 0
        ? Math.min(list.length - 1, Math.trunc(Number(maxFloor)))
        : list.length - 1;
    for (let i = start; i >= 0; i -= 1) {
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

/**
 * 这段正文里出现了名册上的哪些人（＝"谁在现场／前台"）。
 *
 * ⭐ 与召回共用同一套名字判定，另外**多认一层"主名"**：
 *    正文里常写简称（例：名册上是"某某·某某"，正文只写"某某"）——
 *    只认全名会把明明演到的人判成"不在场"，那就等于放他去自由推演（她最在意的污染）。
 *   · 主名＝中圆点/空格前那一段（≥2 字才用，免得"雷"这种一个字乱撞）；
 *   · 单字全名（如"晓"）照旧算。
 */
export function mentionedCharacters(text, roster) {
    const hay = matchKey(text);
    if (!hay) {
        return [];
    }
    const found = new Map();
    const add = (c) => {
        if (c && !found.has(c.id)) {
            found.set(c.id, c);
        }
    };
    for (const c of findMentions(text, buildNameIndex(roster)).map((h) => h.character)) {
        add(c);
    }
    for (const c of Array.isArray(roster) ? roster : []) {
        if (!c || c.ignored) {
            continue;
        }
        const name = trimText(c.name);
        const head = name.split(/[·・\s]/)[0];
        if (head && head !== name && head.length >= 2 && hay.includes(matchKey(head))) {
            add(c);
        }
    }
    return Array.from(found.values());
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
/**
 * 任务的注入块（主体／支线）。
 *
 * 口径（她与我方复核方一起拍的）：
 *   · 任务＝**目标层**（在追什么），⛔ 不是"下一步动作"；
 *   · **不在场**的角色：带全（主线＋支线＋子项）——正文里没有，这是他"还活着"的证据；
 *   · **现场**的角色：只带主线与"在进行中的子项"（正文正在演，别重复占篇幅）；
 *   · 完成／搁置的只在**主线**里留个痕，支线不占篇幅。
 *
 * @param {object} c 角色
 * @param {boolean} inScene 是否在正文现场
 * @returns {string[]} 要追加的行（没有任务就返回空数组）
 */
function questBlock(c, inScene) {
    const list = Array.isArray(c.quests) ? c.quests : [];
    if (!list.length) {
        return [];
    }
    const kindText = (k) => (trimText(k) === 'main' ? '主线' : '支线');
    const picked = inScene
        ? list.filter((q) => trimText(q.kind) === 'main' && trimText(q.status) !== '搁置')
        : list.filter((q) => trimText(q.status) !== '搁置' || trimText(q.kind) === 'main');
    if (!picked.length) {
        return [];
    }
    const out = ['  任务：'];
    for (const q of picked) {
        const bits = [kindText(q.kind) + '·' + trimText(q.title)];
        if (trimText(q.status)) {
            bits.push(trimText(q.status));
        }
        if (!inScene && trimText(q.note)) {
            bits.push(trimText(q.note));
        }
        const items = Array.isArray(q.items) ? q.items : [];
        const shown = inScene ? items.filter((i) => i && !i.done) : items;
        if (shown.length) {
            bits.push(shown.map((i) => (i.done ? '☑' : '▶') + trimText(i.text)).join(' '));
        }
        out.push('    ' + bits.join(' ｜ '));
    }
    return out;
}

/**
 * 一个角色的注入块。
 * @param {object} item { character, reason, inScene, protected }
 * @param {object} [opts] { anchorFloor } —— 本回合锚点楼（"楼层裁"要有它才算得出距离）
 */
function personBlock(item, opts) {
    const c = item.character;
    const anchorFloor = Number(opts && opts.anchorFloor);
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

    if (trimText(c.current)) {
        // ⭐ 引擎自己标了"这条不牢"的，注入时也要带着标——⛔ 不能被下一轮当成既定事实
        lines.push('  正在经历：' + trimText(c.current)
            + (c.currentSuspect ? '　⚠（引擎判定这条不可靠：' + (trimText(c.currentSuspectWhy) || '疑似越界') + '，别当事实用）' : ''));
    }

    const past = Array.isArray(c.past) ? c.past : [];
    const fresh = past.filter((p) => p && p.text && !p.injected);
    /*
     * ⭐ 楼层裁（她拍的）：来源在最近 N 楼之内的**不端**——主模型上下文里已经有那一楼了，
     *    再端一遍等于白占篇幅、还容易让人觉得"重合"；只端更老的（上下文看不到的）。
     *   · N 从设置读（面板可改），0＝不裁（全端）；
     *   · ⚠️ 老数据没有来源楼层 ⇒ 当"很老"处理，**照端**（⛔ 绝不因为缺字段就丢内容）；
     *   · 端过与否（fresh）的逻辑保留不动。
     */
    const cut = Number.isFinite(Number(getSettings().pastFloorCut)) ? Number(getSettings().pastFloorCut) : 0;
    const keepByFloor = (p) => {
        if (!cut || !Number.isFinite(anchorFloor)) {
            return true;
        }
        const from = Number(p && p.fromFloor);
        if (!Number.isFinite(from)) {
            return true;   // 老数据：当很老
        }
        return (anchorFloor - from) >= cut;
    };
    const freshByFloor = fresh.filter(keepByFloor);
    if (freshByFloor.length) {
        lines.push('  过去经历（由近到远）：' + freshByFloor.map((p) => p.text).join('；'));
    } else if (fresh.length && freshByFloor.length !== fresh.length) {
        // 全都被"楼层裁"挡下了 ⇒ 如实说明（⛔ 不静默，也不拿近处的凑数）
        lines.push('  过去经历：（最近 ' + String(cut) + ' 楼内的已在你的上下文里，不再重复；更老的暂时没有）');
    } else if (past.length && trimText(past[0].text) && keepByFloor(past[0])) {
        lines.push('  过去经历（最近一条）：' + trimText(past[0].text));
    }

    // ⛔ 这里原来会把"推断"喂回模型 —— 按需求书去掉了：
    //    她定的角色字段只有七格（年龄／身份／过去经历／正在经历／所在势力／好感值／时间・地点），
    //    推断不是一格；防"推断被当成已发生"靠的是提示词硬规矩（⛔ 不写下步动作／不写预判），
    //    ⛔ 不是靠"多存一格推断再喂回去"——那反而给了模型一份"可能发生"的素材。
    // ⭐ 任务（主线／支线）：目标层。后台（不在场）的带全——这是他"活着"的证据；
    //    现场角色的正文里已经在演，按篇幅少带（只带主线和进行中的子项）。
    const questLines = questBlock(c, item.inScene);
    if (questLines.length) {
        lines.push(...questLines);
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
    const text = trimText(ev.text);
    const sides = trimText(ev.sides);
    /*
     * ⚠️ 去重（逐条核验 4.7 时看出来的）：事件是更新那一步派生的，
     *    `text` 与 `sides` **大多数时候是同一个值** ⇒ 原来会输出
     *    「教会在争港口税：教会／商会 ｜ 各方：教会／商会 ｜ 火候：几天内」
     *    —— 同一串字在一行里出现两遍。这段是**模型每轮都要读**的，
     *    重复＝纯浪费上下文（4.7「⛔ 不要全量灌」）。
     */
    if (text) {
        bits.push(text);
    }
    if (sides && sides !== text) {
        bits.push('各方：' + sides);
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

/**
 * 把召回的条目拼成给主模型的注入块。
 * @param {object} [opts] { anchorFloor } —— 本回合锚点楼（"楼层裁"用；不传就不裁）
 */
export function assembleInjectText(items, events, headerText, opts) {
    const header = trimText(headerText) || effectivePrompt('header');
    const anchorFloor = opts && Number.isFinite(Number(opts.anchorFloor)) ? Number(opts.anchorFloor) : NaN;
    const blocks = [];
    for (const item of Array.isArray(items) ? items : []) {
        if (item && item.character) {
            blocks.push(personBlock(item, { anchorFloor }));
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
        mesId: findLastMesId(chat, leadFloor),
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
    /*
     * ⭐ 补②：**转入编年的条目 ⛔ 不再塞进去**（她：「连续 3 轮没进 ⇒ 转编年留档、不再占注入位、不再强塞」）。
     *   为什么在这一层做：这里才是"这一轮到底带什么进去"的**唯一出口**；
     *   在别处过滤都会漏（这也是唯一能被用例验到的地方）。
     *   ⚠️ 只挡**事件**这一路：人物是按"她这条发言里点到谁"挑的，
     *     若因为"转过编年"就把人挡掉，那她真点到时反而召回不上来 —— 那是帮倒忙。
     */
    const archivedTitles = new Set(
        (loadState().recallRecords || [])
            .filter((r) => r && r.archived === true)
            .reduce((acc, r) => acc.concat(Array.isArray(r.events) ? r.events : []), [])
            // ⭐ 修复单 #7：这里原来也是 `trimText(x)` ⇒ 对象变 `'[object Object]'`
            //   ⇒ "已归档标题"集合永远匹配不上真标题。用同一个 `eventTitle()`。
            .map((x) => eventTitle(x))
            .filter(Boolean)
    );
    const pickedEvents = Array.isArray(evRes.picked)
        ? evRes.picked.filter((e) => {
            const title = eventTitle(e);
            return !title || !archivedTitles.has(title);
        })
        : evRes.picked;
    result.events = pickedEvents;
    const heldBack = (Array.isArray(evRes.picked) ? evRes.picked.length : 0) - pickedEvents.length;
    if (heldBack > 0) {
        notes.push('有 ' + String(heldBack) + ' 条世界事件连续几轮没进正文，已转编年留档 ⇒ 这轮不再带它们');
    }
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
