/**
 * 万象阁 · 从世界书「建档」（读书 v2）
 *
 * ⭐ 她 2026-10-14 19:3x 的口径（原句）：**读取世界书全出来** ——
 *    写提示词让模型自己分，⛔ 别按名单拦着读；人物→名册、势力／局势→世界状态建档。
 *    （需求书 §三-2「初始局势＝先读取用户既有的世界书条目……局势／势力条目，先读进来建档」
 *      ＋ §三-5「开局角色来源＝读取用户既有的世界书条目」，她 2026-10-13 07:06 亲补）
 *
 * ⛔ 旧版为什么不行（复核方真机核验）：它是**纯规则**——按 `[角色]` 前缀剥名字。
 *    规则只看"剥壳能不能成名字"，不看是不是人 ⇒
 *      · `[势力]` 4 条、`[地点]` 7 条被当成"人"并进名册（黑暗四天王／水晶东京…）
 *      · `[反派][道具][机制][剧情线][核心][传说线]` 直接被丢掉
 *    ⇒ 现状"只出一串名字、没有分类"，势力／局势那条线**根本没实现**。
 *
 * 现在：条目**一条不落地读进来** → 交给模型分四类 → 各归各位。
 *   ⚠️ 模型没配／调用失败时**明确说出来**（⛔ 不静默降级成"规则版"，
 *      更⛔ 不许假装成功——失败必须看得见）。
 */

import { TIERS } from './config.js';
import { addCharacters, updateWorld, loadState, saveState } from './state.js';
import { getSettings } from './settings.js';
import { trimText, asText, matchKey, toList } from './utils.js';
import { getEntries, extractNameFromTitle, resolveBookName } from './worldbook.js';

/** 一次最多送多少条给模型（太长就分片；⛔ 不是"过滤掉"，是分批读完） */
const CHUNK = 40;

/**
 * 兜底路径里"**不是人**"的分类词（只影响兜底，⛔ 不影响模型那条线——
 * 模型那条线是"全读进来让它自己分"）。
 */
const NOT_PERSON_PREFIX = new Set([
    '势力', '组织', '团体', '阵营', '地点', '场所', '地图',
    '道具', '物品', '装备', '机制', '规则', '设定', '剧情', '剧情线',
    '事件', '核心', '传说', '传说线', '世界观', '背景', '种族',
]);

/** 一个条目的标题＋正文（送模型用） */
function entryDigest(entry) {
    const title = trimText(entry && (entry.comment || entry.name || entry.key || entry.keys)) || '（无标题）';
    const body = asText(entry && entry.content).replace(/\s+/g, ' ').trim();
    return { title, body: body.length > 400 ? body.slice(0, 400) + '…' : body };
}

/**
 * 把一本世界书**全部**条目读进来（只跳"她点名排除的书／明确禁用的条目"）。
 * @returns {{ok: boolean, reason?: string, entries: Array, total: number, disabled: number}}
 */
export async function readWholeBook(bookName) {
    const settings = getSettings();
    // ⭐ 修复单 #14：同上——用**回退后的书名**去比对排除名单。
    const name = typeof resolveBookName === 'function' ? resolveBookName(bookName) : trimText(bookName);
    const blocked = toList(settings.excludeBooks).some((b) => matchKey(b) === matchKey(name));
    if (blocked) {
        return { ok: false, reason: '这本书在你「排除世界书」名单里，引擎不读它', entries: [], total: 0, disabled: 0 };
    }
    const all = await getEntries(name);
    if (!Array.isArray(all) || !all.length) {
        return {
            ok: false,
            reason: '没读到条目（书名叫「' + (name || '（空）') + '」？'
                + '或者这台酒馆没有可用的世界书通道——去「人物名册」看那行通道提示）',
            entries: [], total: 0, disabled: 0,
        };
    }
    const onlyEnabled = settings.onlyEnabledEntries !== false;
    const entries = [];
    let disabled = 0;
    for (const e of all) {
        if (!e || typeof e !== 'object') {
            continue;
        }
        if (onlyEnabled && e.disable === true) {
            disabled += 1;
            continue;
        }
        entries.push(e);
    }
    return { ok: true, entries, total: all.length, disabled };
}

const CLASSIFY_SYSTEM = [
    '你在帮一个角色扮演世界后台做"世界书建档"。',
    '我会给你一本世界书的全部条目（标题＋正文）。你的活是**把它们分门别类**，一条都不要漏。',
    '',
    '分四类：',
    '· characters＝具体的"人"。包括会说话的非人（猫／精灵／AI 都算人）；也包括以家族／团体为单位、',
    '  但在故事里当角色出现的（例：月野家）。⛔ 组织和地点**不算人**。',
    '· factions＝势力／组织／团体／阵营（例：黑暗王国、水手战士、XX 商会）。',
    '· situations＝正在发生的**局势**：谁跟谁顶着、大势往哪走。要能从条目正文里读出来，⛔ 别编。',
    '· places＝地点（例：十番街、水晶东京）。',
    '',
    '规矩：',
    '1. 名字**照抄条目里的写法**，⛔ 不要翻译、不要加前缀、不要自己起名。',
    '2. `[角色]` 这种方括号前缀要剥掉，只留名字本身。',
    '3. note 用条目正文里的**一句话**说清它是什么（没有就留空）。',
    '4. 局势的 tier 只能从这三个里挑：' + TIERS.join('／') + '（拿不准就留空）。',
    '5. 分类拿不准的**宁可放进 characters**，⛔ 不要丢。',
    '',
    '只回 JSON，⛔ 不要解释、不要 markdown 代码块：',
    '{"characters":[{"name":"","note":"","identity":"","faction":""}],'
    + '"factions":[{"name":"","note":""}],'
    + '"situations":[{"title":"","sides":"","tier":"","note":""}],'
    + '"places":[{"name":"","note":""}]}',
].join('\n');

/** 把一批条目拼成给模型看的清单 */
function digestText(items) {
    return items.map((it, i) => '【' + String(i + 1) + '】标题：' + it.title
        + (it.body ? '\n正文：' + it.body : '')).join('\n\n');
}

/** 空结果 */
function emptyWiki() {
    return { characters: [], factions: [], situations: [], places: [] };
}

/** 把模型可能给的乱七八糟形状归一 */
function normalizeWiki(raw) {
    const out = emptyWiki();
    if (!raw || typeof raw !== 'object') {
        return out;
    }
    const pick = (v) => (Array.isArray(v) ? v : []);
    for (const c of pick(raw.characters)) {
        const name = trimText(typeof c === 'string' ? c : (c && (c.name || c.title)));
        if (name) {
            out.characters.push({
                name,
                note: trimText(c && c.note),
                identity: trimText(c && c.identity),
                faction: trimText(c && c.faction),
            });
        }
    }
    for (const f of pick(raw.factions)) {
        const name = trimText(typeof f === 'string' ? f : (f && (f.name || f.title)));
        if (name) {
            out.factions.push({ name, note: trimText(f && f.note) });
        }
    }
    for (const s of pick(raw.situations)) {
        const title = trimText(typeof s === 'string' ? s : (s && (s.title || s.name)));
        if (title) {
            const tier = trimText(s && s.tier);
            out.situations.push({
                title,
                sides: trimText(s && s.sides),
                tier: TIERS.includes(tier) ? tier : '',
                note: trimText(s && s.note),
            });
        }
    }
    for (const p of pick(raw.places)) {
        const name = trimText(typeof p === 'string' ? p : (p && (p.name || p.title)));
        if (name) {
            out.places.push({ name, note: trimText(p && p.note) });
        }
    }
    return out;
}

/**
 * 让模型给条目分类（分片送，合并结果）。
 * @returns {{ok: boolean, reason?: string, wiki: object, chunks: number}}
 */
export async function classifyBook(entries) {
    let callModelJson = null;
    try {
        ({ callModelJson } = await import('./apiclient.js'));
    } catch (e) {
        return { ok: false, reason: '读不到模型接口：' + (e && e.message ? e.message : String(e)), wiki: emptyWiki(), chunks: 0 };
    }
    const list = (Array.isArray(entries) ? entries : []).map(entryDigest).filter((x) => x.title);
    if (!list.length) {
        return { ok: false, reason: '这本书里没有可用的条目', wiki: emptyWiki(), chunks: 0 };
    }
    const wiki = emptyWiki();
    let chunks = 0;
    for (let i = 0; i < list.length; i += CHUNK) {
        const part = list.slice(i, i + CHUNK);
        chunks += 1;
        let res = null;
        try {
            // eslint-disable-next-line no-await-in-loop
            res = await callModelJson({
                system: CLASSIFY_SYSTEM,
                prompt: '这是第 ' + String(chunks) + ' 批，共 ' + String(part.length) + ' 条：\n\n' + digestText(part),
                cheap: true,
            });
        } catch (e) {
            return { ok: false, reason: '模型调用出错：' + (e && e.message ? e.message : String(e)), wiki, chunks };
        }
        if (!res || !res.ok) {
            return { ok: false, reason: (res && res.reason) || '模型没回可用的 JSON', wiki, chunks };
        }
        // ⚠️ `callModelJson` 回的是 `value`（⛔ 不是 `json`）——写错的话会静默分出 0 条
        const one = normalizeWiki(res.value);
        wiki.characters.push(...one.characters);
        wiki.factions.push(...one.factions);
        wiki.situations.push(...one.situations);
        wiki.places.push(...one.places);
    }
    return { ok: true, wiki, chunks };
}

/** 去重（名字归一后比） */
function dedupe(list, keyOf) {
    const seen = new Set();
    const out = [];
    for (const it of list) {
        const k = matchKey(keyOf(it));
        if (!k || seen.has(k)) {
            continue;
        }
        seen.add(k);
        out.push(it);
    }
    return out;
}

/**
 * 把分类结果**落到账上**：人物→名册；势力／局势→世界状态（局势）。
 * @returns {{people: number, factions: number, situations: number, places: number, situationsTotal: number}}
 */
export function applyWiki(wiki) {
    /*
     * ⚠️ 必须**容忍缺键**：`applyWiki` 是公开函数，调用方给的可能是"只有人物"的半截对象
     *    （模型有时也只回其中几类）——第一版少一个键就抛 `list is not iterable`，
     *    整条建档当场断掉。真踩过（逐条核验 1.2 时抓到的）。
     */
    const src = wiki || {};
    const w = {
        characters: Array.isArray(src.characters) ? src.characters : [],
        factions: Array.isArray(src.factions) ? src.factions : [],
        situations: Array.isArray(src.situations) ? src.situations : [],
        places: Array.isArray(src.places) ? src.places : [],
    };
    const chars = dedupe(w.characters, (c) => c.name);
    const facs = dedupe(w.factions, (f) => f.name);
    const sits = dedupe(w.situations, (s) => s.title);

    // ① 人物 → 名册（身份／势力有就给上，⛔ 不给就算了，别编）
    const people = addCharacters(chars.map((c) => c.name));
    if (chars.length) {
        const state = loadState();
        /*
         * ⭐ 修复单 #12：这里改的是**内存里那份**角色的身份／势力，原来**没 saveState**
         *   ⇒ 从世界书读到的人设「当场有、刷新就没」（补的身份／势力永不落盘）。
         */
        let patched = 0;
        for (const c of chars) {
            const hit = (state.characters || []).find((x) => matchKey(x.name) === matchKey(c.name));
            if (!hit) {
                continue;
            }
            const patch = {};
            if (c.identity && !trimText(hit.identity)) {
                patch.identity = c.identity;
            }
            if (c.faction && !trimText(hit.faction)) {
                patch.faction = c.faction;
            }
            if (Object.keys(patch).length) {
                Object.assign(hit, patch);
                patched += 1;
            }
        }
        if (patched > 0) {
            saveState();
        }
    }

    // ② 势力 ＋ 局势 → 世界状态（都记成"局势"，势力名当作一方）
    const merged = [];
    for (const f of facs) {
        merged.push({ title: f.name + (f.note ? '（' + f.note + '）' : ''), sides: f.name, tier: '' });
    }
    for (const s of sits) {
        merged.push({ title: s.title, sides: s.sides, tier: s.tier });
    }
    const before = (loadState().world && loadState().world.situations) || [];
    let situationsTotal = before.length;
    if (merged.length) {
        const byTitle = new Map();
        for (const s of before) {
            byTitle.set(matchKey(s && s.title), s);
        }
        for (const s of merged) {
            if (!byTitle.has(matchKey(s.title))) {
                before.push(s);
                byTitle.set(matchKey(s.title), s);
            }
        }
        updateWorld({ situations: before });
        situationsTotal = before.length;
    }

    return {
        people,
        factions: facs.length,
        situations: sits.length,
        places: dedupe(w.places, (p) => p.name).length,
        situationsTotal,
    };
}

/**
 * 兜底：模型不可用时的**规则版**。
 *
 * ⛔ 旧版就是这个错：`extractNameFromTitle` 会把 `[势力] 黑暗王国` 剥成"黑暗王国"当人收
 *    （规则只看"剥壳能不能成名字"，不看是不是人）⇒ 势力／地点／道具全被当成人。
 *    ⇒ 这里**先看方括号里的分类词**：非"人"的类别一律不收（并且报出来收了几条）。
 * ⚠️ 调用方必须告诉用户"这次是规则版、没分类"——⛔ 不许假装是分类结果。
 */
export function ruleBasedPeople(entries) {
    const people = [];
    const seen = new Set();
    let skipped = 0;
    for (const e of Array.isArray(entries) ? entries : []) {
        const raw = trimText(e && (e.comment || e.name || e.key || e.keys));
        // 方括号里的分类词（`[势力] X` / 【地点】X）
        const m = raw.match(/^[\[【(（]\s*([^\]】)）]{1,6})\s*[\]】)）]/);
        if (m && NOT_PERSON_PREFIX.has(matchKey(m[1]))) {
            skipped += 1;   // ⛔ 组织／地点／道具不算人
            continue;
        }
        const person = extractNameFromTitle(raw);
        if (!person) {
            skipped += 1;
            continue;
        }
        const k = matchKey(person);
        if (seen.has(k)) {
            continue;
        }
        seen.add(k);
        people.push({ name: person });
    }
    return { people, skipped };
}

/**
 * 一条龙：读书 → 分类 → 落账。
 * @param {string} bookName
 * @param {{allowRuleFallback?: boolean}} [opts]
 */
export async function importBookWiki(bookName, opts) {
    const read = await readWholeBook(bookName);
    if (!read.ok) {
        return { ok: false, reason: read.reason };
    }
    const cls = await classifyBook(read.entries);
    if (!cls.ok) {
        // 模型不行 ⇒ 明确报出来；她允许时给"规则版"兜底，但**说清是兜底**
        if (opts && opts.allowRuleFallback) {
            const rb = ruleBasedPeople(read.entries);
            const added = addCharacters(rb.people.map((p) => p.name));
            return {
                ok: true, fellBack: true, reason: cls.reason,
                read: read.entries.length, total: read.total, disabled: read.disabled,
                added, skipped: rb.skipped,
                factions: 0, situations: 0, places: 0, situationsTotal: 0,
            };
        }
        return { ok: false, reason: cls.reason, read: read.entries.length };
    }
    const applied = applyWiki(cls.wiki);
    return {
        ok: true, fellBack: false,
        read: read.entries.length, total: read.total, disabled: read.disabled,
        chunks: cls.chunks,
        added: applied.people,
        factions: applied.factions,
        situations: applied.situations,
        places: applied.places,
        situationsTotal: applied.situationsTotal,
    };
}
