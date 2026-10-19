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
import { addCharacters, updateWorld, loadState, saveState, updateCharacter, findCharacterByName, upsertHidden, setEvents, upsertFaction } from './state.js';
import { mergeCharacters } from './merge.js';
import { getSettings } from './settings.js';
import { trimText, asText, matchKey, toList } from './utils.js';
import { getEntries, extractNameFromTitle, resolveBookName, extractArchiveOwner, extractFormNames } from './worldbook.js';

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
    /* ⭐⭐ 修复 9（材料 02）：旧文字**明令把「月野家」当成一个角色** ✗✗
     *   她的原话：「月野兔一家人另外三个没有出来」✗ ⇒ 模型当然拆不出人 ✗
     *   新：家庭／组合／多人合集 ⇒ **必须把每一个具体人物单独拆出来** ✓；
     *       变身形态／马甲 ⇒ **只留真名**（马甲写进 identity）✓，⛔ 不拆成两个人 ✗ */
    '· characters＝具体的"**个体角色**"（含会说话的非人，如露娜、亚提密斯）。',
    '  ⭐⭐ 特别重要：如果一个条目是**家庭／组合／多人合集**（例如标题叫「月野家」「奈鲁与海野」「四天王」），',
    '     **你必须从它的正文里把每一个具体人物的名字单独拆出来**（例如拆出：月野育子、月野谦之、月野进悟；大阪奈鲁、海野栗雄），',
    '     一人一条放进 characters，⛔ **绝不要把「月野家」这种家庭合集名当成一个人**！',
    '  ⭐⭐ 如果一个条目是某个角色的**变身形态／马甲**（正文里写了【角色档案：真名】，如「水手月亮」其实是「月野兔」），',
    '     只保留真名「月野兔」；把「水手月亮」这种**变身形态的名字写进 aliases 数组**，真名写在 name，⛔ 不要拆成两个人！',
    '· factions＝势力／组织／团体／阵营（例：黑暗王国、水手战士、黑暗四天王）。',
    '· situations＝正在发生的**局势**：谁跟谁顶着、暗中在策划什么阴谋。要能从条目正文里读出来，⛔ 别编。',
    '· places＝地点（例：十番街、水晶东京）。',
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
    '',
    '只回 JSON，⛔ 不要解释、不要 markdown 代码块：',
    '{"characters":[{"name":"","note":"","identity":"","faction":"","aliases":[]}],'
    + '"factions":[{"name":"","note":"","scale":"规模（如大型/中型/小型）"}],'
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
                /* P2 (material 07): carry the aliases through (the model is told to put
                 *   transformation-form names here) - previously they were dropped. */
                aliases: Array.isArray(c && c.aliases)
                    ? c.aliases.map((x) => trimText(x)).filter(Boolean) : [],
            });
        }
    }
    for (const f of pick(raw.factions)) {
        const name = trimText(typeof f === 'string' ? f : (f && (f.name || f.title)));
        if (name) {
            out.factions.push({ name, note: trimText(f && f.note), scale: trimText(f && f.scale) });
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
                /* ⭐ C12：导入的局势也要带因果 ✓ */
                cause: trimText(s && (s.cause || s.from)),
                effect: trimText(s && (s.effect || s.to)),
            });
        }
    }
    for (const p of pick(raw.places)) {
        const name = trimText(typeof p === 'string' ? p : (p && (p.name || p.title)));
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
    wiki.hidden = Array.isArray(wiki.hidden) ? wiki.hidden : [];
    wiki.hidden.push(...(Array.isArray(one.hidden) ? one.hidden : []));
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
                /* ⭐ U1：这是**引擎自己填**，⏔ 记成她的手改 ✓ */
                updateCharacter(c.id, patch, { trackManual: false });
                touched += 1;
            }
            /*
             * ⭐ B7（材料 13）：**同批里已经建出的形态卡要并回真身** ✓
             *   旧：提示词说“别拆成两个人”，但**老账里已经存在的独立形态卡就永远留着** ✗
             *   现在：这些别名里若有一个**正好等于名册里另一个人的名字** ⇒ 并回真身 ✓
             *   （只认名字完全相等，⏔ 模糊匹配 ✗ —— 她吃过“母女被当同一人”的亏 ✗）
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
        hidden: Array.isArray(src.hidden) ? src.hidden : [],
    };
    /* ⭐⭐ 修复 9：**剥完后不像人名的杂项（如 作息与时间锚）不进名册** ✓
     *   （她原话：「作息与时间锚被读成人」✗；家庭合集名（月野家）也不当一个人 ✗） */
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
         *   ⇒ 只要尾巴是**职业／身份词**（管家／书家／作家… ✓）就**照收** ✓
         */
        const looksProfession = /(?:管家|书家|作家|专家|行家|店家|东家|亲家|冤家|仇家|出家|在家|农家|法家|医家|画家|音乐家)$/.test(clean);
        return Boolean(clean) && !(looksProfession !== true && /^.{1,3}家(?:一家|一族)?$/.test(clean));
    });
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
    // ② 势力 ＋ 局势 → 世界状态（都记成"局势"，势力名当作一方）
    const merged = [];
    /* ★ P1-1：势力进独立实体（带 id），⏔ 再摊成一条“局势”冒充它 ✓ */
    for (const f of facs) {
        try { upsertFaction({ name: f.name, note: f.note, scale: f.scale }); } catch (eFac) { /* 一条势力写不进不能弄挂整次导入 ✓ */ }
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
/**
 * ⭐⭐ 10-16 在她**真世界书**上跑出来的缺陷：
 *   条目叫「`[角色] 日常NPC：奈鲁与海野`」⇒ 被当成“非人名”**整条丢掉**，
 *   而他俩正是她那层里**露面最多**的（奈鲁 26 次、海野 15 次）⇒ **人在书里却没读出来**。
 *   她 [18] 的要求就是“读人出来、她一个都不用手并” ⇒ **不能静默丢**。
 *   这里只拆**最窄的一种**：「**类目词：甲与乙**」（类目词是 NPC／日常NPC／配角／路人／其他角色）
 *   ⇒ 拆成一人一条。**⛔ 碰“天王遥与海王满”那种没类目词的**（那类归她点头的“书形问题”）。
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
     * ⭐ B7（材料 13·兑现率）：**导入的局势与暗线要同步进召回用的事件池** ✓
     *   旧：只写进 state.world.situations／hidden ✗ ⇒ state.events 一直空着 ✗
     *     ⇒ 发消息时按 events 挑世界事件 ⇒ **0 召回** ✗
     *   现在：把这次导入的局势（kind=situation）与暗线（kind=hidden）补进事件池 ✓
     *   按标题去重，⏔ 冲掉她原有的 ✗；同步失败不影响导入本身 ✓
     */
    try {
        const oldEv = Array.isArray(loadState().events) ? loadState().events.slice() : [];
        const haveEv = new Set(oldEv.map((e) => trimText(e && e.title)));
        const addEv = [];
        for (const s of (Array.isArray(out.situations) ? out.situations : [])) {
            const t1 = trimText(s && s.title);
            if (!t1 || haveEv.has(t1)) { continue; }
            haveEv.add(t1);
            addEv.push({ title: t1, text: trimText(s.note) || t1, kind: 'situation', sides: trimText(s.sides), tier: trimText(s.tier) });
        }
        for (const h of (Array.isArray(out.hidden) ? out.hidden : [])) {
            const t2 = trimText(h && h.name);
            if (!t2 || haveEv.has(t2)) { continue; }
            haveEv.add(t2);
            addEv.push({ title: t2, text: trimText(h.note) || t2, kind: 'hidden', stage: trimText(h.stage) });
        }
        if (addEv.length) {
            setEvents(oldEv.concat(addEv));
        }
    } catch (eB7) { /* 同步失败不能影响导入本身 ✓ */ }
    return out;
}

export function ruleBasedPeople(entries) {
    const people = [];
    const seen = new Map();
    let skipped = 0;
    for (const e of expandMultiNameEntries(entries)) {
        const raw = trimText(e && (e.comment || e.name || e.key || e.keys));
        // 方括号里的分类词（`[势力] X` / 【地点】X）
        const m = raw.match(/^[\[【(（]\s*([^\]】)）]{1,6})\s*[\]】)）]/);
        /*
         * ⭐ 10-16 真书取证补一道：她那条是 `[角色] 关系：天王遥与海王满` ——
         *   方括号里是「角色」、**类目词在冒号前面**（关系）⇒ 只查方括号那个词挡不住 ✗
         *   ⇒ 把方括号剥掉之后，**再看一次「冒号前面的词」**是不是类目词。
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
         * ⭐⭐ 她原话 [18]：「同一角色**被拆成两条记录**？合并一键解决」
         *   —— 她 10-16 首夜实测：名册里「月野兔」与「水手月亮」被当两个人（**全表 6 组同型**）。
         *   而书里**自己写着属主**：`[角色] 水手月亮` 的内容头＝「【角色档案：月野兔】…」。
         *   ⇒ **规则兜底这条真路也要认属主**（⛔ 不能只在 worldbook.js 那个没人调的函数里认）。
         *   ⚠️ 防误并：`水手小月亮` 的属主是**小小兔**（真另一人）——照它自己写的属主走。
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
        if (isPart && rec.aliases.indexOf(person) < 0) {
            rec.aliases.push(person);
        }
        {
            const forms = extractFormNames(body);
            const cand = forms.concat(isPart ? [person] : []);
            for (const f of cand) {
                if (f && !rec.identityHint) {
                    rec.identityHint = f;
                }
            }
        }
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
    // 她 [18]：跟模型线用**同一份**逻辑（⛔ 两处各写一遍，改一处忘一处）
    applyPeopleExtras(rb.people);

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
    /*
     * ⭐ 她 [18]：**模型线也得落别名／身份**。
     *   这里 `read` 在作用域内（上一版插在 `applyWiki` 里取不到 read ⇒ 砸了 3 套）。
     */
    applyPeopleExtras(ruleBasedPeople(read.entries).people);
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
