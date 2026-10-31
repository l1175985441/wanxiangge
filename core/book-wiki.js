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
import { isBlankOrUnknownish } from './rules.js';   /* 116：占位词闸（与人物层同一份） */
import { addCharacters, updateWorld, loadState, saveState, updateCharacter, findCharacterByName, upsertHidden, setEvents, upsertFaction, getRoster } from './state.js';
import { mergeCharacters } from './merge.js';
import { getSettings } from './settings.js';
import { trimText, asText, matchKey, toList } from './utils.js';
import { getEntries, extractNameFromTitle, resolveBookName, extractArchiveOwner, extractFormNames } from './worldbook.js';

/*
 * 87/88 号（阿砚 01:00：“不行就跟工作流、观棋、世界之面一样做个分批读世界书”）
 *   切法取「观棋」（story-world-v2/src/abstract.js chunkRowsWithRanges）：
 *   **按字符累计切、每块带 from/to**（出错能定位是哪几条）；
 *   初值不照它的 60000（那是只报名号的瘦提示词）——我们还要模型吐四类 JSON，6000 起步。
 */
export const CHUNK_CHAR_START = 6000;
const CHUNK_CHAR_MIN = 500;
/** 这些错就当“这块太大”（砍半重读），⛔ 不当“模型没通”直接降级 */
/*
 * 90 号：旧正则太宽（连 `JSON`、`截断` 都算“太大”）⇒ 格式错也去砍半，
 *   她真机上砍到 292 字、切 35 块、块块失败。现在拆两档：
 *   ① **真·太大**（三样）⇒ 砍半重试；② **格式错** ⇒ 原位 softRetry 一次（不砍）。
 */
const HARD_TOO_BIG = /ERR_INPUT_LIMIT|context length|model_context_window/i;
const FORMAT_HINT = /JSON|截断|键名|不是完整|too long|max_tokens/i;
/* 保留旧名（外部/寄具可能引用） */
const TOO_BIG_HINT = HARD_TOO_BIG;

/**
 * 兜底路径里"**不是人**"的分类词（只影响兜底，⛔ 不影响模型那条线——
 * 模型那条线是"全读进来让它自己分"）。
 */
const NOT_PERSON_PREFIX = new Set([
    '势力', '组织', '团体', '阵营', '地点', '场所', '地图',
    '道具', '物品', '装备', '机制', '规则', '设定', '剧情', '剧情线',
    '事件', '核心', '传说', '传说线', '世界观', '背景', '种族',
    /*
     * ⭐ 10-16 真书取证：她书里有一条 `[角色] 关系：天王遥与海王满` ⇒
     *   我原来把它**当成了一个人**（真机名册里就躺着一个叫「天王遥与海王满」的）✗
     *   而她 [14] 明说「关系不做」（"再加一个就重复了"）⇒ **关系条目⛔ 不建人**。
     *   ⚠️ 注意：条目名前面**带着「[角色]」也会先被剥掉**，所以这里连「角色」也要挡一道
     *   （「[角色] 关系：…」剥完是「关系：…」⇒ 前缀＝关系 ✓）。
     */
    '关系', '关系表', '人际', '羁绊', '角色关系',
]);

/** 一个条目的标题＋正文（送模型用） */
function entryDigest(entry) {
    const title = trimText(entry && (entry.comment || entry.name || entry.key || entry.keys)) || '（无标题）';
    const body = asText(entry && entry.content).replace(/\s+/g, ' ').trim();
    /* ⭐⭐ 修复 9（材料 02）：**正文截断 400 字 ✗ ⇒ 1200 字** ✓
     *   她的原话：「月野豆绁一家人另外三个没有出来」✗
     *   真因：《月野家》这种**多人档案**，排在后面的家人（谦之、进悟）**被截断漏读** ✗
     *   ⇒ 放宽到 1200 字 ✓（三个人全读得到 ✓） */
    return { title, body: body.length > 1200 ? body.slice(0, 1200) + '…' : body };
}

/**
 * 把一本世界书**全部**条目读进来（只跳"她点名排除的书／明确禁用的条目"）。
 * @returns {{ok: boolean, reason?: string, entries: Array, total: number, disabled: number}}
 */
export async function readWholeBook(bookName) {
    const settings = getSettings();
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
    /* ⭐⭐ 修复 9（材料 02）：旧文字**明令把「月野家」当成一个角色** ✗✗
     *   她的原话：「月野兔一家人另外三个没有出来」✗ ⇒ 模型当然拆不出人 ✗
     *   新：家庭／组合／多人合集 ⇒ **必须把每一个具体人物单独拆出来** ✓；
     *       变身形态／马甲 ⇒ **只留真名**（马甲写进 identity）✓，⛔ 不拆成两个人 ✗ */
    '· characters＝具体的"**个体角色**"（含会说话的非人，如露娜、亚提密斯）。',
    '  ⭐⭐ 特别重要：如果一个条目是**家庭／组合／多人合集**（例如标题叫「月野家」「奈鲁与海野」「四天王」），',
    '     **你必须从它的正文里把每一个具体人物的名字单独拆出来**（例如拆出：月野育子、月野谦之、月野进悟；大阪奈鲁、海野栗雄），',
    '     一人一条放进 characters，⛔ **绝不要把「月野家」这种家庭合集名当成一个人**！',
    '  ⭐ age（年龄）：只写书里明述的数字或说法（「32 岁」／「看上去三十出头」）；书里没写 ⇒ 留空，⛔ 不许估。',
    '  ⭐⭐ identity（身份）：变身形态（如「水手月亮」）写在身份里（多条用；隔开），⛔ 写进 aliases；',,
    '  ⭐ aliases（别名）：**只放名字的别的叫法**（小名／昵称）；⛔ 不放变身形态、⛔ 不放身份。',
    '· factions＝势力／组织／团体／阵营（例：黑暗王国、水手战士、黑暗四天王）。',
    '· situations＝正在发生的**局势**：谁跟谁顶着、暗中在策划什么阴谋。要能从条目正文里读出来，⛔ 别编。',
    '  ⛔ situations 的 title **不许照抄条目的标题**；如果这一条讲的是规则／机制／图鉴／篇章名／世界设定，就⛔ 不要放进 situations。',
    '  ⭐ 这本书里如果没有“谁跟谁顶着”的局势，situations 就回**空数组 []**——⛔ 宁可 0 条，不许拿目录名凑数。',
    '· places＝地点（例：十番街、水晶东京）。',
    '  ⛔ places 的 name **不许照抄条目的标题**；不是真地点就⛔ 不要放进 places。',
    '· hidden＝**暗线**：还没浮上台面的阴谋／计划／暗中行动（例：在港区的珠宝店收集能量）。',
    '  每条必须带：名称、**阶段**（萌芽／发酵／逼近／爆发／消散 或 筹备／执行／关键／完成）、**挂在什么时间或条件上**（例：晚上／放学后／三天后）。',
    '⛔ **公开的局势放 situations，暗中的阴谋放 hidden**，⛔ 两边都放。',
    '',
    '规矩：',
    '1. 名字**照抄条目里的写法**，⛔ 不要翻译、不要加前缀、不要自己起名。',
    '2. `[角色]`、`【设定】` 这种方括号分类前缀要剥掉，只留名字本身。',
    '3. note 用条目正文里的**一句话**说清它是什么（没有就留空）。',
    '4. 局势的 tier 只能从这三个里挑：' + TIERS.join('／') + '（拿不准就留空）。',
    /* ⭐⭐ 修复 9：旧规矩「分类拿不准的**宁可放进 characters**」✗
     *   ⇒ 正是「作息与时间锚被读成人」的推手 ✗（规则／作息表／时间锚本来就不是人 ✗） */
    '5. ⛔ **规则、作息表、时间锚、游戏机制、写作规范、状态栏格式、人物关系合集（如“关系：X与Y”）绝不算人**，直接跳过忽略，不放进任何分类！',
    '6. 其余分类拿不准的**宁可放进 characters**，⛔ 不要丢。',
    '6b. `place`＝这个人在故事开始时**身在何处**（书里明说的才填，没写就空串；⛔ 别猜）。',
    '',
    '只回 JSON，⛔ 不要解释、不要 markdown 代码块：',
    '{"characters":[{"name":"","note":"","age":"","place":"","identity":"","faction":"","aliases":[]}],'
    + '"factions":[{"name":"","note":"","scale":"规模（如大型/中型/小型；⛔ 不是实力）"}],'
    + '"situations":[{"title":"","sides":"","tier":"","note":""}],'
    + '"places":[{"name":"","note":""}],'
    + '"hidden":[{"name":"","stage":"","trigger":"","tier":"","note":""}]}',
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
/** 91：模型有时把「[地点] 皇冠游戏中心」连前缀一起回来 ⇒ 归一时强制剥掉 */
export function stripKindPrefix(s) {
    return trimText(String(s == null ? '' : s).replace(/^\s*[\[【][^\]】]+[\]】]\s*/, ''));
}
function normalizeWiki(raw) {
    const out = emptyWiki();
    if (!raw || typeof raw !== 'object') {
        return out;
    }
    /*
     * 90#D：模型可能回中文键（`{"角色":[...]}`）⇒ 旧代码认不出、整份当空。
     *   这里做一层别名（也允许字符串数组）。
     */
    const aliasOf = (names) => {
        for (const n of names) {
            if (Array.isArray(raw[n])) {
                return raw[n];
            }
        }
        return null;
    };
    const pick = (v) => (Array.isArray(v) ? v : []);
    const bucket = (key, cn) => {
        const en = pick(raw[key]);
        return en.length ? en : pick(aliasOf(cn));
    };
    for (const c of bucket('characters', ['角色', '人物'])) {
        const name = stripKindPrefix(typeof c === 'string' ? c : (c && (c.name || c.title)));
        if (name) {
            /* 94：模型给的 aliases（形态）并回 identity；aliases 只她手填 */
            const mAlias = (Array.isArray(c && c.aliases) ? c.aliases : []).map((x) => trimText(x)).filter(Boolean);
            /* 116：模型按人物层口径答数组（identities）也要收到；⛔ 改落库形状（仍拼字符串） */
            const fromArr = (Array.isArray(c && c.identities) ? c.identities : []).map((x) => trimText(x)).filter(Boolean);
            const idParts = [trimText(c && c.identity)].concat(fromArr).concat(mAlias).filter(Boolean).filter((x) => !isBlankOrUnknownish(x));
            out.characters.push({
                name,
                note: trimText(c && c.note),
                age: isBlankOrUnknownish(trimText(c && c.age)) ? '' : trimText(c && c.age),   /* 109/116：年龄进来、占位词不进 */
                identity: idParts.join('；'),
            /* 129：书里自带的地点（有就收，没有就空）——⛔ 改 schema，只在落库补一个兜底 */
            place: trimText(c && (c.place || c.timePlace)),
                /* 116：同时产出数组（三处同一种形状） */
                identities: idParts.join('；').split(/[；;]/).map((s) => trimText(s)).filter(Boolean),
                faction: trimText(c && c.faction),
                /* P2 (material 07): carry the aliases through (the model is told to put
                 *   transformation-form names here) - previously they were dropped. */
                behaviorBounds: trimText(c && c.behaviorBounds),
                knowledgeBounds: trimText(c && c.knowledgeBounds),
                aliases: [],   /* 94：模型给的别名不落库（只她手填） */
            });
        }
    }
    for (const f of bucket('factions', ['势力', '组织'])) {
        const name = stripKindPrefix(typeof f === 'string' ? f : (f && (f.name || f.title)));
        if (name) {
            out.factions.push({ name, note: trimText(f && f.note), scale: trimText(f && f.scale) });
        }
    }
    const MECHANIC = /机制|规则|设定|必杀|力量定档|扮演|叙事|变身/;
    for (const s of bucket('situations', ['局势', '事件'])) {
        const title = stripKindPrefix(typeof s === 'string' ? s : (s && (s.title || s.name)));
        /* 90#5：机制／规则／设定类条目不是局势（她：「扮演与叙事规则」不该进局势） */
        if (title && MECHANIC.test(title)) {
            continue;
        }
        if (title) {
            const tier = trimText(s && s.tier);
            out.situations.push({
                title,
                /* 108：模型偶尔把 sides 回成数组 ⇒ 写成人话（⛔ [object Object]） */
                sides: (function () { const v = s && s.sides; if (!Array.isArray(v)) { return trimText(v); } return v.map((x) => (x && typeof x === 'object') ? (trimText(x.who) + (trimText(x.claim) ? ' 说' + trimText(x.claim) : '')) : trimText(x)).filter(Boolean).join('；'); })(),
                evidenceTiers: (Array.isArray(s && s.evidenceTiers) ? s.evidenceTiers : [])
                    .filter((x) => x && trimText(x.who))
                    .map((x) => ({ who: trimText(x.who), tier: trimText(x.tier) || 'inferred' })),
                tier: TIERS.includes(tier) ? tier : '',
                note: trimText(s && s.note),
                /* ⭐ C12：导入的局势也要带因果 ✓ */
                cause: trimText(s && (s.cause || s.from)),
                effect: trimText(s && (s.effect || s.to)),
                clock_mode: trimText(s && s.clock_mode), due: trimText(s && (s.due || s.due_at)), publicity: trimText(s && s.publicity), public_trace: trimText(s && s.public_trace), caused_by: trimText(s && s.caused_by), impact_records: Array.isArray(s && s.impact_records) ? s.impact_records : [],
            });
        }
    }
    for (const p of bucket('places', ['地点', '场所'])) {
        const name = stripKindPrefix(typeof p === 'string' ? p : (p && (p.name || p.title)));
        if (name) {
            out.places.push({ name, note: trimText(p && p.note) });
        }
    }
    /* P3 (material 07): hidden bucket - world-book conspiracies become real hidden lines. */
    /* P3: make sure the bucket exists (out may predate the hidden field). */
    out.hidden = Array.isArray(out.hidden) ? out.hidden : [];
    for (const h of pick(raw.hidden)) {
        const name = trimText(typeof h === 'string' ? h : (h && (h.name || h.title)));
        if (name) {
            const tierH = trimText(h && h.tier);
            out.hidden.push({
                name,
                stage: trimText(h && h.stage),
                kind: trimText(h && h.kind),
                trigger: trimText(h && (h.trigger || h.due)),
                tier: TIERS.includes(tierH) ? tierH : '',
                note: trimText(h && h.note),
                /* ⭐ C12（材料 13）：**导入的暗线也要带因果** ✓（上一条只补了局势那一支 ✗） */
                cause: trimText(h && (h.cause || h.from)),
                effect: trimText(h && (h.effect || h.to)),
            });
        }
    }
    return out;
}
/** 一条 entry 入 prompt 后大概多少字（标题＋正文＋栖栏） */
function oneChars(x) {
    return String(x.title || '').length + String(x.body || '').length + 8;
}
/** 从 from 开始取一块（按字符累计；单条超长就自成一块） */
export function takeChunk(list, from, maxChar) {
    let to = from;
    let len = 0;
    while (to < list.length) {
        const one = oneChars(list[to]);
        if (to > from && len + one > maxChar) {
            break;
        }
        len += one;
        to += 1;
    }
    return { from, to, chars: len, count: to - from };
}
/** 读爪印：上次读到哪块（⛔ 从头再来） */
function readCheckpoint() {
    try {
        const cp = loadState().bookReadCheckpoint;
        if (cp && typeof cp === 'object' && Array.isArray(cp.done)) {
            return cp;
        }
    } catch (e) {
        /* 读不到就当没爪印 */
    }
    return { done: [], maxChar: CHUNK_CHAR_START, book: '' };
}
/** 写爪印（每块读完就留一个） */
function writeCheckpoint(cp) {
    try {
        const state = loadState();
        state.bookReadCheckpoint = cp;
        saveState();
    } catch (e) {
        /* 爪印写不了也不能拦着读 */
    }
}
/**
 * 让模型给条目分类（按字符分片；失败砍半重试；每块留爪印）。
 * @param {Array} entries
 * @param {{bookName?: string, resume?: boolean}} [opts]
 * @returns {{ok: boolean, reason?: string, wiki: object, chunks: number, failedChunks?: Array, maxChar?: number, resumedFrom?: number}}
 */
export async function classifyBook(entries, opts) {
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
    const bookKey = trimText(opts && opts.bookName);
    const cp = (opts && opts.resume === false) ? { done: [], maxChar: CHUNK_CHAR_START, book: bookKey } : readCheckpoint();
    /* 爪印只认“这本书 + 从头连续成功”的那段 */
    let startIndex = 0;
    /* 只认“同一本书 + 有书名”的爪印（⛔ 拿别的书的爪印跳过头） */
    if (bookKey && cp && cp.book === bookKey && Array.isArray(cp.done)) {
        const okMap = new Map(cp.done.filter((d) => d && d.ok).map((d) => [Number(d.from), Number(d.to)]));
        while (okMap.has(startIndex)) {
            startIndex = Number(okMap.get(startIndex));
        }
    }
    if (startIndex >= list.length) {
        /* 陈旧爪印把整本都盖了（但这次没读出任何东西）⇒ 当作失效，重头读 */
        startIndex = 0;
    }
    let maxChar = Math.max(CHUNK_CHAR_MIN, Number(cp && cp.maxChar) || CHUNK_CHAR_START);
    const wiki = emptyWiki();
    const failedChunks = [];
    const done = Array.isArray(cp && cp.done) ? cp.done.slice() : [];
    let chunks = 0;
    let goodStreak = 0;
    const softRetried = new Set();   /* 90：格式错只原位重试一次 */
    let i = startIndex;
    while (i < list.length) {
        const part = takeChunk(list, i, maxChar);
        chunks += 1;
        let res = null;
        let errText = '';
        try {
            res = await callModelJson({
                system: CLASSIFY_SYSTEM,
                /*
                 * 90 号（她抓的原文）：旧句只说“这是第 N 批…”，**没说要模型做什么** ⇒
                 *   模型当成“投喂设定、你记一下”，回“已记录这条设定”。
                 *   现在：**动词开头 + 四类名 + 只回 JSON**（她同款模型验过，44 秒全出）。
                 */
                prompt: '把下面这 ' + String(part.count) + ' 条世界书条目**分成四类**（characters／factions／situations／places），'
                    + '只回一个 JSON 对象（键名用英文），⛔ 不要解释、⛔ 不要说“已记录”。'
                    + '（原书第 ' + String(part.from + 1) + '–' + String(part.to) + ' 条）\n\n'
                    + digestText(list.slice(part.from, part.to)),
                cheap: true,
            });
        } catch (e) {
            errText = e && e.message ? e.message : String(e);
            res = { ok: false, reason: errText };
        }
        if (res && res.ok) {
            const one = normalizeWiki(res.value);
            wiki.characters.push(...one.characters);
            wiki.factions.push(...one.factions);
            wiki.situations.push(...one.situations);
            wiki.places.push(...one.places);
            wiki.hidden = Array.isArray(wiki.hidden) ? wiki.hidden : [];
            wiki.hidden.push(...(Array.isArray(one.hidden) ? one.hidden : []));
            done.push({ from: part.from, to: part.to, ok: true });
            i = part.to;
            goodStreak += 1;
            /* 成功两块 ⇒ 慢慢加回上限（照世界背面） */
            if (goodStreak >= 2 && maxChar < CHUNK_CHAR_START) {
                maxChar = Math.min(CHUNK_CHAR_START, Math.ceil(maxChar * 1.2));
                goodStreak = 0;
            }
            writeCheckpoint({ book: bookKey, done, maxChar, at: Date.now() });
            continue;
        }
        const reason = String((res && res.reason) || errText || '模型没回可用的 JSON');
        /*
         * 90：**格式错不砍半**（砍了也不会对）——原位再试 1 次，把“只回 JSON”再喊一遍。
         */
        if (!HARD_TOO_BIG.test(reason) && FORMAT_HINT.test(reason) && !softRetried.has(part.from)) {
            softRetried.add(part.from);
            /* ⛔ 不改 maxChar；紧接着重读同一块 */
            continue;
        }
        if (HARD_TOO_BIG.test(reason) && part.count > 1) {
            /*
             * 这块太大 ⇒ 砍半再读同一段。
             * ⛔ 写死 `Math.max(MIN, /2)`：短条目时会卡在一个怫人的下限上无限循环（真踩过）；
             *   下限下就按“实际字数再砍一半”，直到只剩 1 条。
             */
            const half = Math.floor(maxChar / 2);
            maxChar = (half >= CHUNK_CHAR_MIN) ? half : Math.max(1, Math.floor(part.chars / 2));
            goodStreak = 0;
            continue;
        }
        failedChunks.push({ from: part.from, to: part.to, reason: reason.slice(0, 120) });
        done.push({ from: part.from, to: part.to, ok: false, reason: reason.slice(0, 60) });   /* 爪印里带失败原因，她能直接看 */
        i = part.to;
        writeCheckpoint({ book: bookKey, done, maxChar, at: Date.now() });
    }
    const any = wiki.characters.length + wiki.factions.length + wiki.situations.length + wiki.places.length > 0;
    if (!any) {
        /*
         * 全部块都“跑完了”但一条也没分出来 ⇒ 不能当成功（她会看到“读进来 0 条”却不知道为什么）。
         *   交给上层走兜底，并把真实原因带回去。
         */
        return {
            ok: false,
            reason: (failedChunks[0] && failedChunks[0].reason) || '模型没分出任何条目（这本书的 JSON 是空的）',
            wiki, chunks, failedChunks, maxChar, resumedFrom: startIndex,
        };
    }
    return { ok: true, wiki, chunks, failedChunks, maxChar, resumedFrom: startIndex };
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
/**
 * ⭐⭐ 她原话 [18]：分条归位得**落到人身上**（别名留档、身份带上）。
 *   ⚠️ 10-16 真盘：这段原来**只跟在“规则兜底”那条路后面** ⇒
 *     **模型线（她真机走得最多的）不落别名、不填身份** ✗
 *   ⚠️ 上一版我把它往 `applyWiki` 里插 ⇒ **那里取不到 `read`** ⇒ 砸了 3 套。
 *     **这次改在 `importBookWiki` 里接**（那里 `read` 在作用域内）。
 *   ⚠️ 身份：**只在格空、且没被手改过**时才写（她 §10：手改的不许冲）。
 * @returns 真正动到的人数
 */
export function applyPeopleExtras(people) {
    let touched = 0;
    try {
        for (const pp of (Array.isArray(people) ? people : [])) {
            if (!pp || ((!pp.aliases || !pp.aliases.length) && !pp.identityHint)) {
                continue;
            }
            const c = findCharacterByName(pp.name);
            if (!c) {
                continue;
            }
            const patch = {};
            const cur = Array.isArray(c.aliases) ? c.aliases : [];
            const have = new Set(cur.map((x) => String(x)));
            const merged = cur.slice();
            for (const a of (pp.aliases || [])) {
                if (!have.has(String(a))) {
                    merged.push(a);
                }
            }
            if (merged.length !== cur.length) {
                patch.aliases = merged;
            }
            const manual = Array.isArray(c.manualFields) && c.manualFields.indexOf('identity') >= 0;
            if (pp.identityHint && !trimText(c.identity) && !manual) {
                patch.identity = pp.identityHint;
            }
            if (Object.keys(patch).length) {
                /* ⭐ U1：这是**引擎自己填**，⛔ 记成她的手改 ✓ */
                updateCharacter(c.id, patch, { trackManual: false });
                touched += 1;
            }
            /*
             * ⭐ B7（材料 13）：**同批里已经建出的形态卡要并回真身** ✓
             *   旧：提示词说“别拆成两个人”，但**老账里已经存在的独立形态卡就永远留着** ✗
             *   现在：这些别名里若有一个**正好等于名册里另一个人的名字** ⇒ 并回真身 ✓
             *   （只认名字完全相等，⛔ 模糊匹配 ✗ —— 她吃过“母女被当同一人”的亏 ✗）
             */
            try {
                for (const a7 of (pp.aliases || [])) {
                    const nm7 = trimText(a7);
                    if (!nm7 || matchKey(nm7) === matchKey(c.name)) {
                        continue;
                    }
                    const dup7 = findCharacterByName(nm7);
                    if (dup7 && dup7.id !== c.id) {
                        mergeCharacters(c.id, nm7);
                        touched += 1;
                    }
                }
            } catch (eMerge7) { /* 并失败不能拦着导入 ✓ */ }
        }
    } catch (e) {
        console.warn('[万象阁] 分条归位没落上：', e);
    }
    return touched;
}
/** 91：把“源条目标题 → 类别前缀”建成一张图（供机械闸用） */
export function buildSourceTitleMap(sourceTitles) {
    const map = new Map();
    for (const s of (Array.isArray(sourceTitles) ? sourceTitles : [])) {
        const nm = trimText(s && (s.title || s.name));
        if (!nm) {
            continue;
        }
        const m = nm.match(/^\[([^\]]+)\]\s*(.+)$/);
        const kind = trimText(m ? m[1] : '');
        const bare = trimText(m ? m[2] : nm);
        if (bare) {
            map.set(matchKey(bare), kind);
        }
    }
    return map;
}
/**
 * 91#1：这个名字是不是“抄源条目标题”。
 *   命中源标题且**源条目不属于同类** ⇒ 是抄标题（要丢）；
 *   若源条目就是同类（[地点] 十番街 → places）⇒ 保留。
 * @param {string} rawTitle
 * @param {Map<string,string>} srcMap
 * @param {RegExp} kindRe
 */
export function isEchoTitle(rawTitle, srcMap, kindRe) {
    const raw = trimText(rawTitle);
    if (!raw || !srcMap) {
        return false;
    }
    if (/身份|学校|规则|机制|设定|图鉴|篇（第|力量定档/.test(raw)) {
        return true;
    }
    const m = raw.match(/^\[([^\]]+)\]\s*(.+)$/);
    const bare = trimText(m ? m[2] : raw);
    const hit = srcMap.get(matchKey(bare));
    if (hit === undefined) {
        return false;
    }
    const k = String(hit || '');
    /* 目录类前缀（剧情线／核心／机制／设定…）不论同不同类都不当局势／地点／势力 */
    if (/剧情|核心|机制|设定|图鉴|道具|物品|世界观|背景|种族|传说/.test(k)) {
        return true;
    }
    return !kindRe.test(k);
}
export function applyWiki(wiki, opts) {
    /*
     * 91#1：**标题不许当结果**（最重要的一道，⛔ 只靠提示词）。
     *   她真机：模型把「心力与战斗判定」「世界局势」「杂兵图鉴」这些**条目标题**原样当成
     *   situations／places 交上来。规则：名字剔掉方括号前缀后，若与源条目标题完全相同 ⇒ **丢弃**。
     *   例外：若命中的那条源条目本身就是同类（[地点]十番街）⇒ 保留（她判据 #2：真地点要留）。
     */
    const srcMap = buildSourceTitleMap(opts && opts.sourceTitles);
    const echoDrop = { situations: 0, places: 0 };
    const isEcho = (rawTitle, re) => isEchoTitle(rawTitle, srcMap, re);
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
        hidden: Array.isArray(src.hidden) ? src.hidden : [],
    };
    /* ⭐⭐ 修复 9：**剥完后不像人名的杂项（如 作息与时间锚）不进名册** ✓
     *   （她原话：「作息与时间锚被读成人」✗；家庭合集名（月野家）也不当一个人 ✗） */
    /* ★ 她 22:0x：先合并“变身／前世”别名，再走后面的去重与过滤 ✓ */
    w.characters = mergeAliasGroups(w.characters);
    const chars = dedupe(w.characters, (c) => c.name).filter((c) => {
        const clean = extractNameFromTitle(c.name);
        /*
         * ⭐ S5（材料 05 的自查）：**别把“老管家”这种正常角色也过滤掉** ✓
         *   我原来写的 `!/家$/.test(clean)` ✗ ⇒ 只要名字以“家”结尾就杀 ✗
         *     （她若有一个叫「老管家」的角色 ⇒ 当场被丢 ✗）
         *   现在：只匹配**合集名本身**（最多 3 字＋家／一家／一族 ✓）
         *     ⇒ 「月野家」跳过 ✓，「老管家」「某书家」照收 ✓
         */
        /*
         * S5 补一道护栏：材料给的 `/^.{1,3}家$/` 本身也会误杀 ✗
         *   （「老管家」「某书家」都是 3 字、也以家结尾 ✗）
         */
        const looksProfession = /(?:管家|书家|作家|专家|行家|店家|东家|亲家|冤家|仇家|出家|在家|农家|法家|医家|画家|音乐家)$/.test(clean);
        return Boolean(clean) && !(looksProfession !== true && /^.{1,3}家(?:一家|一族)?$/.test(clean));
    });
    /* 91：势力也不能把目录名（剧情线／机制）当成势力 */
    w.factions = w.factions.filter((f) => {
        if (isEchoTitle(f && f.name, srcMap, /势力|组织|团体|阵营/)) {
            echoDrop.factions = (echoDrop.factions || 0) + 1;
            return false;
        }
        return true;
    });
    const facs = dedupe(w.factions, (f) => f.name);
    /* 91#1 机械闸：把“照拄条目标题”的局势丢掉（真局势标题不会等于目录名） */
    w.situations = w.situations.filter((s) => {
        if (isEcho(s && s.title, /局势/)) {
            echoDrop.situations += 1;
            return false;
        }
        return true;
    });
    w.places = w.places.filter((p) => {
        if (isEcho(p && (p.name || p.title), /地点|场所|地图/)) {
            echoDrop.places += 1;
            return false;
        }
        return true;
    });
    const sits = dedupe(w.situations, (s) => s.title);
    const people = addCharacters(chars.map((c) => c.name));
    if (chars.length) {
        const state = loadState();
        /*
         */
        let patched = 0;
        for (const c of chars) {
            const hit = (state.characters || []).find((x) => matchKey(x.name) === matchKey(c.name));
            if (!hit) {
                continue;
            }
            const patch = {};
            /* 116：年龄也要进卡（只在卡上本来空时写；占位词不进） */
            if (trimText(c.age) && !isBlankOrUnknownish(trimText(c.age)) && !trimText(hit.age)) {
                patch.age = trimText(c.age);
            }
            /* 116：占位词不能冒充身份／势力（与 age 同一道闸） */
            if (trimText(c.place) && !isBlankOrUnknownish(trimText(c.place)) && !trimText(hit.timePlace)) {
                patch.timePlace = trimText(c.place);
            }
            if (trimText(c.identity) && !isBlankOrUnknownish(trimText(c.identity)) && !trimText(hit.identity)) {
                patch.identity = trimText(c.identity);
            }
            if (trimText(c.faction) && !isBlankOrUnknownish(trimText(c.faction)) && !trimText(hit.faction)) {
                patch.faction = trimText(c.faction);
            }
            /* 116：身份数组也要落库（只在卡上本来没有时写） */
            const cleanIds = (Array.isArray(c.identities) ? c.identities : []).map((x) => trimText(x)).filter((x) => x && !isBlankOrUnknownish(x));
            if (cleanIds.length
                && !(Array.isArray(hit.identities) && hit.identities.length)) {
                patch.identities = cleanIds.slice();
                if (!trimText(hit.identity)) {
                    patch.identity = cleanIds[0];
                }
            }
            /* P2 (material 07): merge aliases in (union, never overwrite). */
            if (Array.isArray(c.aliases) && c.aliases.length) {
                const cur = Array.isArray(hit.aliases) ? hit.aliases.slice() : [];
                let changed = false;
                for (const a of c.aliases) {
                    const nm = trimText(a);
                    if (nm && !cur.some((x) => matchKey(x) === matchKey(nm))) {
                        cur.push(nm);
                        changed = true;
                    }
                }
                if (changed) {
                    patch.aliases = cur;
                }
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
    /* P3 (material 07): conspiracies -> real hidden lines (previously dropped or mixed
     *   into public situations with no stage and no clock trigger). */
    for (const h of (Array.isArray(w.hidden) ? w.hidden : [])) {
        if (!h || !trimText(h.name)) {
            continue;
        }
        try {
            upsertHidden({
                name: trimText(h.name),
                stage: trimText(h.stage),
                kind: trimText(h.kind),
                trigger: trimText(h.trigger),
                tier: trimText(h.tier),
                note: trimText(h.note),
                manual: false,
            });
        } catch (e) { /* one bad line must not break the import */ }
    }
    const merged = [];
    /* ★ P1-1：势力进独立实体（带 id），⛔ 再摊成一条“局势”冒充它 ✓ */
    for (const f of facs) {
        try { upsertFaction({ name: f.name, note: f.note, scale: f.scale }); } catch (eFac) { /* 一条势力写不进不能弄挂整次导入 ✓ */ }
    }
    for (const s of sits) {
        merged.push(Object.assign({}, s, { source: 'book' }));   /* 117：归一备齐的字段不在这里砍 */
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
    /*
     */
    try {
        const oldEv = Array.isArray(loadState().events) ? loadState().events.slice() : [];
        const haveEv = new Set(oldEv.map((e) => trimText(e && e.title)));
        const addEv = [];
        for (const s of (Array.isArray(sits) ? sits : [])) {
            const t1 = trimText(s && s.title);
            if (!t1 || haveEv.has(t1)) { continue; }
            haveEv.add(t1);
            addEv.push({ title: t1, text: trimText(s.note) || t1, kind: 'situation', source: 'book', quote: trimText(s.note) || t1, sides: trimText(s.sides), tier: trimText(s.tier) });
        }
        for (const h of (Array.isArray(w.hidden) ? w.hidden : [])) {
            const t2 = trimText(h && h.name);
            if (!t2 || haveEv.has(t2)) { continue; }
            haveEv.add(t2);
            addEv.push({ title: t2, text: trimText(h.note) || t2, kind: 'hidden', source: 'book', quote: trimText(h.note) || t2, stage: trimText(h.stage) });
        }
        if (addEv.length) {
            setEvents(oldEv.concat(addEv));
        }
    } catch (eB7) { /* 同步失败不能影响导入本身 ✓ */ }
    return {
        people,
        factions: facs.length,
        situations: sits.length,
        places: (function () {
            /*
             */
            const inPlaces = dedupe(w.places, (p) => p.name);
            if (!inPlaces.length) {
                return 0;
            }
            const st = loadState();
            const cur = Array.isArray(st.world && st.world.places) ? st.world.places.slice() : [];
            const seen = new Set(cur.map((x) => matchKey(x && x.name)));
            let added = 0;
            for (const p of inPlaces) {
                const k = matchKey(p.name);
                if (!k || seen.has(k)) {
                    continue;
                }
                cur.push({ name: p.name, note: p.note });
                seen.add(k);
                added += 1;
            }
            if (added) {
                updateWorld({ places: cur });
            }
            return added;
        })(),
        situationsTotal,
        dropped: echoDrop,   /* 91：丢了几条“抄标题”的局势／地点 */
    };
}
/**
 */
/**
 */
export function expandMultiNameEntries(entries) {
    const CAT = /^(?:\u65e5\u5e38NPC|NPC|\u914d\u89d2|\u8def\u4eba|\u5176\u4ed6\u89d2\u8272|\u516c\u4f17|\u80cc\u666f)$/;
    const out = [];
    for (const e of (Array.isArray(entries) ? entries : [])) {
        const raw = String((e && (e.comment || e.name || e.key)) || '');
        const m = raw.match(/^[\[\u3010(\uff08]?\s*[^\]\u3011)\uff09]{0,8}[\]\u3011)\uff09]?\s*([^\uff1a:]{1,12})\s*[\uff1a:]\s*(.+)$/);
        const tail = m ? m[1].trim() : '';
        const who = m ? m[2].trim() : '';
        if (!m || !CAT.test(tail) || !who) {
            out.push(e);
            continue;
        }
        const names = who.split(/[\u4e0e\u548c\u3001,\uff0c\uff0f\/]+/).map((x) => x.trim()).filter(Boolean);
        if (names.length < 2) {
            out.push(e);
            continue;
        }
        for (const nm of names) {
            out.push(Object.assign({}, e, { comment: '[\u89d2\u8272] ' + nm }));
        }
    }
    /*
     */
    return out;
}
export function ruleBasedPeople(entries) {
    const people = [];
    const seen = new Map();
    let skipped = 0;
    for (const e of expandMultiNameEntries(entries)) {
        const raw = trimText(e && (e.comment || e.name || e.key || e.keys));
        const m = raw.match(/^[\[【(（]\s*([^\]】)）]{1,6})\s*[\]】)）]/);
        /*
         */
        {
            const bare = raw.replace(/^[\[\u3010(\uff08][^\]\u3011)\uff09]{1,8}[\]\u3011)\uff09]\s*/, '');
            const c2 = bare.match(/^([^\uff1a:]{1,8})[\uff1a:]/);
            if (c2 && NOT_PERSON_PREFIX.has(matchKey(c2[1]))) {
                skipped += 1;   // ⛔ 把“关系：…”当成一个人（她 [14]：关系不做）
                continue;
            }
        }
        if (m && NOT_PERSON_PREFIX.has(matchKey(m[1]))) {
            skipped += 1;   // ⛔ 组织／地点／道具不算人
            continue;
        }
        const person = extractNameFromTitle(raw);
        if (!person) {
            skipped += 1;
            continue;
        }
        /*
         */
        const body = trimText(e && e.content);
        const owner = extractArchiveOwner(body);
        const isPart = !!owner && matchKey(owner) !== matchKey(person);
        const realName = isPart ? owner : person;
        const k = matchKey(realName);
        if (!k) {
            skipped += 1;
            continue;
        }
        let rec = seen.get(k);
        if (!rec) {
            rec = { name: realName, aliases: [], identityHint: '' };
            seen.set(k, rec);
            people.push(rec);
        }
        if (isPart && String(rec.identityHint || '').indexOf(person) < 0) {
            rec.identityHint = rec.identityHint ? (rec.identityHint + '；' + person) : person;
        }
        {
            const forms = extractFormNames(body);
            const cand = forms.concat(isPart ? [person] : []);
            const have = String(rec.identityHint || '');
            const add = cand.filter((f) => f && have.indexOf(f) < 0);
            if (add.length) {
                rec.identityHint = (have ? have + '；' : '') + add.join('；');
            }
        }
    }
    return { people, skipped };
}
/**
 */
export function ruleBasedWorld(entries) {
    const factions = [];
    const situations = [];
    const places = [];
    for (const e of (Array.isArray(entries) ? entries : [])) {
        const rawTitle = trimText(e && (e.comment || e.name || e.key));
        if (!rawTitle) {
            continue;
        }
        const m = rawTitle.match(/^\[([^\]]+)\]\s*(.+)$/);
        const kind = trimText(m ? m[1] : '');
        const name = trimText(m ? m[2] : rawTitle);
        if (!name) {
            continue;
        }
        const note = asText(e && e.content).replace(/\s+/g, ' ').trim().slice(0, 120);
        if (/势力|组织|团体|阵营/.test(kind)) {
            factions.push({ name, status: '', note });
        } else if (/局势/.test(kind)) {
            situations.push({ title: name, sides: '', pressure: 0, note });
        } else if (/地点|场所|地图/.test(kind)) {
            places.push({ name, note });
        }
    }
    return { factions, situations, places };
}
/**
 */
export function mergeAliasGroups(list) {
    const items = (Array.isArray(list) ? list : [])
        .filter((x) => x && trimText(x.name))
        .map((x) => ({
            name: trimText(x.name),
            note: trimText(x.note),
            age: trimText(x.age),   /* 116：这里重建对象时不能把年龄丢了 */
            place: trimText(x.place),   /* 129：地点也不能在这里丢 */
            identity: trimText(x.identity),
            identities: Array.isArray(x.identities) ? x.identities.map((a) => trimText(a)).filter(Boolean) : [],
            faction: trimText(x.faction),
            aliases: Array.isArray(x.aliases) ? x.aliases.map((a) => trimText(a)).filter(Boolean) : [],
        }));
    const merged = [];
    const used = new Set();
    for (let i = 0; i < items.length; i += 1) {
        const host = items[i];
        if (used.has(i)) {
            continue;
        }
        for (let j = 0; j < items.length; j += 1) {
            if (j === i || used.has(j)) {
                continue;
            }
            const b = items[j];
            const bMentionsHost = (b.note + ' ' + b.identity).indexOf(host.name) >= 0;
            const hostMentionsB = (host.note + ' ' + host.identity).indexOf(b.name) >= 0;
            if (!bMentionsHost || hostMentionsB) {
                continue;
            }
            used.add(j);
            host.aliases = Array.from(new Set(host.aliases.concat(b.aliases, [b.name])));
            if (b.note) {
                host.note = host.note ? (host.note + '；' + b.note) : b.note;
            }
            if (!host.identity && b.identity) {
                host.identity = b.identity;
            }
        }
        used.add(i);
        merged.push({
            name: host.name,
            note: host.note,
            age: host.age,
            place: host.place,
            identity: host.identity,
            identities: Array.isArray(host.identities) ? host.identities : [],
            faction: host.faction,
            aliases: host.aliases.filter((x) => x && x !== host.name),
        });
    }
    return merged;
}
/**
 */
export function knowledgeKeysFromEntries(entries, name, aliases) {
    const names = [trimText(name)].concat(Array.isArray(aliases) ? aliases.map((a) => trimText(a)) : [])
        .filter(Boolean);
    if (!names.length) {
        return [];
    }
    const out = [];
    for (const e of (Array.isArray(entries) ? entries : [])) {
        if (!e) {
            continue;
        }
        const rawKeys = Array.isArray(e.key) ? e.key : (Array.isArray(e.keys) ? e.keys : [e.key]);
        const keys = rawKeys.map((k) => trimText(k)).filter(Boolean);
        const title = trimText(e.comment || e.title || '');
        const hitKey = keys.some((k) => names.some((n) => k.indexOf(n) >= 0));
        const hitTitle = title && names.some((n) => title.indexOf(n) >= 0);
        if ((hitKey || hitTitle) && title) {
            out.push(title);
        }
    }
    return Array.from(new Set(out));
}
export function applyKnowledgeFromEntries(entries, roster) {
    const list = Array.isArray(roster) ? roster : getRoster();
    let touched = 0;
    for (const c of list) {
        const keys = knowledgeKeysFromEntries(entries, c.name, c.aliases);
        if (keys.length) {
            updateCharacter(c.id, { knownFactKeys: keys }, { allowKnownFace: true, trackManual: false });
            touched += 1;
        }
    }
    return touched;
}
/**
 */
/**
 */
export function pruneEchoWorld(entries) {
    const map = buildSourceTitleMap((Array.isArray(entries) ? entries : []).map((e) => ({
        title: (e && (e.comment || e.name || e.key)) || '',
    })));
    const out = { situations: 0, places: 0 };
    if (!map.size) {
        return out;
    }
    try {
        const st = loadState();
        const sits = Array.isArray(st.world && st.world.situations) ? st.world.situations : [];
        const keptSits = sits.filter((s) => {
            if (isEchoTitle(s && s.title, map, /局势/)) {
                out.situations += 1;
                return false;
            }
            return true;
        });
        const facs0 = Array.isArray(st.world && st.world.factions) ? st.world.factions : [];
        const keptFacs = facs0.filter((f2) => !isEchoTitle(f2 && f2.name, map, /势力|组织|团体|阵营/));
        out.factions = facs0.length - keptFacs.length;
        const places = Array.isArray(st.world && st.world.places) ? st.world.places : [];
        const keptPlaces = places.filter((p2) => {
            if (isEchoTitle(p2 && p2.name, map, /地点|场所|地图/)) {
                out.places += 1;
                return false;
            }
            return true;
        });
        if (out.situations || out.places) {
            updateWorld({ situations: keptSits, places: keptPlaces, factions: keptFacs });
            saveState();
        }
    } catch (e) {
    }
    return out;
}
export async function importBookWiki(bookName, opts) {
    const read = await readWholeBook(bookName);
    if (!read.ok) {
        return { ok: false, reason: read.reason };
    }
    const cls = await classifyBook(read.entries, { bookName: bookName });
    if (!cls.ok) {
        if (opts && opts.allowRuleFallback) {
            const rb = ruleBasedPeople(read.entries);
            const added = addCharacters(rb.people.map((p) => p.name));
    applyPeopleExtras(rb.people);
            /*
             */
            const rw = ruleBasedWorld(read.entries);
            /*
             */
            pruneEchoWorld(read.entries);   /* 91：兜底路也清 */
            const appliedFb = applyWiki({ factions: rw.factions, situations: rw.situations, places: rw.places }, {
                sourceTitles: read.entries.map((e) => ({ title: (e && (e.comment || e.name || e.key)) || '' })),
            });
            const facN = appliedFb.factions;
            const sitN = appliedFb.situations;
            const plcN = appliedFb.places;
            return {
                ok: true, fellBack: true, reason: cls.reason,
                read: read.entries.length, total: read.total, disabled: read.disabled,
                added, skipped: rb.skipped,
                factions: facN, situations: sitN, places: plcN,
                situationsTotal: (loadState().world.situations || []).length,
                fallbackWorld: { factions: rw.factions.length, situations: rw.situations.length, places: plcN },
                dropped: appliedFb.dropped || { situations: 0, places: 0 },
            };
        }
        return { ok: false, reason: cls.reason, read: read.entries.length };
    }
    pruneEchoWorld(read.entries);   /* 91：清掉已入库的“抄标题”局势／地点 */
    const applied = applyWiki(cls.wiki, {
        sourceTitles: read.entries.map((e) => ({ title: (e && (e.comment || e.name || e.key)) || '' })),
    });
    try { applyKnowledgeFromEntries(read.entries); } catch (eKnow) { }
    /*
     */
    applyPeopleExtras(ruleBasedPeople(read.entries).people);
    return {
        ok: true, fellBack: false,
        read: read.entries.length, total: read.total, disabled: read.disabled,
        chunks: cls.chunks,
        failedChunks: cls.failedChunks || [],
        maxChar: cls.maxChar,
        resumedFrom: cls.resumedFrom,
        added: applied.people,
        factions: applied.factions,
        situations: applied.situations,
        places: applied.places,
        situationsTotal: applied.situationsTotal,
        dropped: applied.dropped || { situations: 0, places: 0 },
    };
}
/** 94 寄具用：暴露 normalizeWiki（不改生产路径） */
export function normalizeWikiForTest(raw) {
    return normalizeWiki(raw);
}