/**
 * 万象阁 · 世界书读取（只读，⛔ 绝不写她的世界书）
 *
 * 本轮提供两件事：
 *   ① 列出有哪些世界书（给后面"读哪些、排除哪些"的下拉用）；
 *   ② 从世界书条目里认人——中文分类包裹写法都要认得：
 *      [角色] 名字 / 【名字】 / （名字） / 名字（备注） / 名字·后缀 / 3-5字前缀，等等。
 *      还要剥掉 Markdown 加粗、标题符号这类外壳。
 */

import { matchKey, trimText, asText, toList } from './utils.js';
import { getCtx } from './adapter.js';
import { loadState, saveState } from './state.js';
import { getSettings } from './settings.js';
import { WORLD_BOOK_NAME } from './config.js';
// ⭐ 世界书**多通道**（酒馆助手／旧通道／新版接口，有哪个用哪个）
import { listBooks, readBookEntries, channelReport } from './wb-channel.js';
// ⭐ 她 [2]：好感从正文标签读（标签块的抽取用现成的）
import { pickNamedBlocks } from './extract.js';

/** 包裹用的括号对（成对剥壳用） */
const BRACKETS = [
    ['【', '】'],
    ['[', ']'],
    ['（', '）'],
    ['(', ')'],
    ['〔', '〕'],
    ['〖', '〗'],
    ['【', '】'],
    ['「', '」'],
    ['『', '』'],
    ['<', '>'],
    ['《', '》'],
];

/** 明显不是人名的分类词（出现在包裹里的分类前缀，不算名字） */
const CATEGORY_WORDS = new Set([
    '角色', '人物', '角色卡', '人物卡', 'npc', 'NPC', '设定', '世界观', '世界',
    '势力', '组织', '阵营', '地点', '场景', '事件', '剧情', '规则', '系统',
    '词条', '条目', '备注', '简介', '说明', '资料', '背景', '关系', '时间线',
    '地点设定', '势力设定', '角色设定', '人物设定', '重要角色', '主要角色',
    '次要角色', '配角', '主角', '玩家', '用户', '我',
]);

/** 以这些词收尾的，基本都是分类标题，不是人名（如"人物列表""角色大全"） */
const CATEGORY_SUFFIXES = [
    '列表', '一览', '大全', '汇总', '总览', '目录', '索引', '合集', '设定',
    '介绍', '说明', '规则', '系统', '模板', '格式', '范例', '示例', '样本',
];

/**
 * ⭐ 目标核对 3④a：**"不像人名"的词**（含这些就不当人）。
 *   她报的：【作息与时间锚】被读成"人"进了名册。
 *   病因：第②a 步"整串被【】包住 ⇒ 无条件剥壳"，
 *   而第⑦ 步的校验只看「长度≤12」「分类词」「分类后缀」
 *   ——「作息与时间锚」三条全不碰 ⇒ 就这么漏进来了。
 *   ⚠️ 只收**明显不是人**的词（概念／规则／地图类），⏔ 拿常见名字开刀；
 *     她最后还有「读取控制」里逐条勾选可以兜底（见 §3）。
 */
const NOT_A_PERSON_WORDS = new Set([
    '作息', '时间', '时间线', '日历', '历法', '年代', '年表', '纪年',
    '世界观', '背景', '设定', '规则', '系统', '说明', '索引', '目录',
    '大纲', '格式', '模板', '范例', '示例', '天气', '地图', '地理',
    '货币', '经济', '科技', '等级', '技能', '物品', '道具', '装备',
    '任务', '事件', '状态', '属性', '数值', '表格', '清单', '总结',
    '摘要', '备注', '提示', '禁忌', '礼仪', '习俗', '文化', '历史',
]);

/** 以这些字收尾的，基本是"东西/概念"，不是人（如时间锚） */
const NOT_A_PERSON_SUFFIXES = ['锚', '表', '录', '册', '库', '则', '谱', '鉴', '单'];

/** 名字里不该出现的字符 */
const NAME_JUNK = /[：:，,。.、；;！!？?～~"'"'（）()\[\]【】〔〕「」『』《》<>\/\\|+=*#@$%^&_]/;

/** 把一条世界书条目名剥壳取人名，取不到返回空串（⛔ 绝不用占位值凑数） */
export function extractNameFromTitle(title) {
    let t = trimText(title);
    if (!t) {
        return '';
    }

    // ① 去掉 Markdown 加粗、标题、列表符号
    t = t.replace(/^[#>*\-\s·•]+/, '').replace(/[*_`~]/g, '').trim();

    // ② 反复剥成对括号，直到没有
    let guard = 0;
    let changed = true;
    while (changed && guard < 8) {
        changed = false;
        guard += 1;
        for (const pair of BRACKETS) {
            const open = pair[0];
            const close = pair[1];
            // ②a 整串被包住（【露娜】）
            if (t.startsWith(open) && t.endsWith(close) && t.length > open.length + close.length) {
                const inner = trimText(t.slice(open.length, t.length - close.length));
                if (inner) {
                    t = inner;
                    changed = true;
                    continue;
                }
            }
            /*
             * ②b ⭐ 壳在前、名字在后（【角色】露娜 ／ [角色]月野兔 ／ （角色）亚提密斯）
             *
             * ⚠️ 原来只做 ②a（"整串被包住"）⇒ 这类写法**只在带空格时才碰巧过**
             *    （`[角色] 月野兔` 靠后面第⑥步按空格切才成，`[角色]月野兔` 整条不认）。
             *    逐条核验 5.5 时实测：`【角色】露娜`／`（角色）亚提密斯`／`[角色]月野兔`
             *    **全部返回空**。而需求 5.5 明写这几种壳都要认。
             *    收的条件要严：括号里的词必须是**分类词**（⛔ 不然「月野家（本家）」会被误剥）。
             */
            if (t.startsWith(open)) {
                const closeAt = t.indexOf(close, open.length);
                if (closeAt > 0 && closeAt <= 8) {
                    const inner = trimText(t.slice(open.length, closeAt));
                    const rest = trimText(t.slice(closeAt + close.length));
                    if (inner && rest && CATEGORY_WORDS.has(matchKey(inner))) {
                        t = rest;
                        changed = true;
                        continue;
                    }
                }
            }
        }
    }

    // ③ 去掉"分类前缀·名字"这种写法（仅当点号前面确实是分类词，别误伤"某某·某某"）
    const dot = t.match(/^(.{1,6})[·・丨](.+)$/);
    if (dot && CATEGORY_WORDS.has(matchKey(dot[1]))) {
        t = trimText(dot[2]);
    }

    // ④ 去掉"分类前缀：名字"这种写法（角色：名字 / 人物-名字）
    const colon = t.match(/^([^：:]{1,8})[：:](.+)$/);
    if (colon && CATEGORY_WORDS.has(matchKey(colon[1]))) {
        t = trimText(colon[2]);
    }

    // ⑤ 剥掉尾巴上的补充说明：名字（备注）／名字【备注】／名字 - 备注
    //    注意不能碰名字本身带的中圆点（某某·某某）
    const tail = t.match(/^(.+?)[（(【\[].*$/) || t.match(/^(.+?)\s+[-–—]\s*.+$/);
    if (tail && trimText(tail[1]).length >= 2) {
        t = trimText(tail[1]);
    }

    // ⑥ 去掉开头若是分类词（"角色 名字"）
    const parts = t.split(/\s+/).filter(Boolean);
    if (parts.length > 1 && CATEGORY_WORDS.has(matchKey(parts[0]))) {
        t = trimText(parts.slice(1).join(' '));
    } else if (parts.length > 1) {
        t = trimText(parts[0]);
    }

    // ⑦ 校验：不能是分类词本身／分类标题、不能含垃圾字符、长度合理
    //    ⭐ 单字名要认（"晓""Q"是她的角色名）——只挡长度上限与分类词/标题
    const key = matchKey(t);
    if (!key || key.length > 12) {
        return '';
    }
    if (CATEGORY_WORDS.has(key)) {
        return '';
    }
    for (const suffix of CATEGORY_SUFFIXES) {
        if (key.endsWith(suffix)) {
            return '';
        }
    }
    /*
     * ⭐ 目标核对 3④a："像不像人名"的校验（见上面那张名单）。
     *   【作息与时间锚】就是这么进来的 ⇒ 这里把它挡在门外。
     */
    if (NOT_A_PERSON_WORDS.has(key)) {
        return '';
    }
    for (const suffix of NOT_A_PERSON_SUFFIXES) {
        if (key.endsWith(suffix) && key.length >= 3) {
            return '';
        }
    }
    if (NAME_JUNK.test(t)) {
        return '';
    }
    return t;
}

/** 汉字／假名／谚文／字母数字（用来判"名字前后是不是还黏着别的字"） */
const WORDCH = /[\w\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/;

/**
 * 在一行里找"某个角色的名字"，并且要求**名字是独立出现的**。
 * ⭐ 自审修正·条 11 的连带问题：短名不许命中长名（"某某"不许把"某某乙"那一行算成自己的），
 *    否则会给短名取到长名的数（我实测就串号了）。
 * ⚠️ 但也不能矫枉过正：前面是标记字母（R系的美奈子）或后面是分隔符（名字：好感 62）都要认。
 */
function findStandaloneName(line, forms, allForms) {
    for (const form of forms) {
        let at = line.indexOf(form);
        while (at >= 0) {
            const end = at + form.length;
            const longer = allForms.some((o) => o !== form && o.length > form.length && line.startsWith(o, at));
            if (!longer) {
                const before = at > 0 ? line[at - 1] : '';
                const after = end < line.length ? line[end] : '';
                // 前面：⛔ 别黏着别的字（但要放过标记字母 R／数字与括号）
                const beforeOk = !before || !WORDCH.test(before) || /[A-Za-z0-9]/.test(before);
                // 后面：⛔ 别黏着别的字（但要放过分隔符：： 空格 顿号 括号 竖线）
                const afterOk = !after || !WORDCH.test(after);
                if (beforeOk && afterOk) {
                    return { at, form };
                }
            }
            at = line.indexOf(form, at + 1);
        }
    }
    return null;
}

/**
 * 读"手机"里的好感（只读，⛔ 不加减、不另存）
 *
 * 她那边的好感在某个世界书条目里（例：手机／关系表）。这里：
 *   · 先按她配的「好感数据源」找条目（书名或条目关键词）；
 *   · 在每个条目里，找"跟这个角色名在同一段话里"的分数；
 *   · 找到就写进角色的 affinity 字段并注明来源；**找不到就留着不动**（⛔ 不编、不清零）。
 */
/**
 * ⭐⭐ 她原话 [2]（她 10-16 亲口）：「**手机你就让他读标签吧，这个随便能读正文的标签就行**」
 *   ⇒ 好感＝从**正文里的标签块**读（⏔ 只认她配的那个世界书条目）；
 *     **⏔ 自己算、⏔ 自己编、⏔ 另存一份**——只“读进来”。
 *   「随便…就行」的落法：**先按她填的名字找那块标签；找不到就扫正文里任何标签块**。
 *   ⚠️ 只收**名字能对上名册（含别名）**的那些——⏔ 把世界里别的数字当成好感。
 * @returns {Array<{name:string, value:string}>}
 */
export function affinityFromText(text, roster, sourceTag) {
    const src = trimText(text);
    const tag = trimText(sourceTag);
    if (!src) {
        return [];
    }
    // ① 先试她填的那个标签名（名字在正文里出现才算）
    let body = '';
    if (tag) {
        const picked = pickNamedBlocks(src, [tag]);
        if (trimText(picked) && trimText(picked) !== src) {
            body = picked;
        }
    }
    // ② "随便…就行"：没那块标签就**扫全文**（名字能对上名册的才收）
    const hay = body || src;
    const out = [];
    /*
     * ⭐⭐ 10-16 拿她真语料发现：**她那个“手机”好感是 JSON 台账**，长这样：
     *   {"op":"replace","path":"/人物/月野育子","value":81}
     *   ⇐ 原来只认「名字：数字」 ⇒ **读不到她真正的台账**（名册还是“未接入”）。
     *   写法刷实一点：**先定位到名字，再在附近找最近的 `"value"：数字`**（⏔ 死缚一个长正则）。
     */
    for (const c of (Array.isArray(roster) ? roster : [])) {
        const nm = trimText(c && c.name);
        if (!nm) {
            continue;
        }
        const anchor = '人物/' + nm;
        const at = hay.indexOf(anchor);
        if (at < 0) {
            continue;
        }
        // 在名字后面的 60 个字符内找最近的 "value":数字
        const tail = hay.slice(at + anchor.length, at + anchor.length + 60);
        const vm = tail.match(/"value"\s*:\s*(-?\d+(?:\.\d+)?)/);
        // 也认“名字紧跟着分隔符紧跟着数字”那种（非 JSON）
        const pm = vm || hay.slice(at, at + anchor.length + 20).match(/[\uff1a:]\s*(-?\d+(?:\.\d+)?)/);
        if (pm && !out.some((x) => x.name === nm)) {
            out.push({ name: nm, value: trimText(pm[1]) });
        }
    }
    for (const c of (Array.isArray(roster) ? roster : [])) {
        const nm = trimText(c && c.name);
        if (!nm) {
            continue;
        }
        const safe = nm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pat = new RegExp('"\u4eba\u7269/' + safe + '"\\s*,\\s*"value"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)');
        const pm = hay.match(pat);
        if (pm && !out.some((x) => x.name === nm)) {
            out.push({ name: nm, value: trimText(pm[1]) });
        }
    }
    for (const c of (Array.isArray(roster) ? roster : [])) {
        const names = [trimText(c && c.name)].concat(toList(c && c.aliases)).filter(Boolean);
        for (const nm of names) {
            /*
             * 只认"名字 紧跟着 分隔符 紧跟着 数字"这种写法（她那边就是这样的账）。
             * ⏔ 把只是提到名字的别的句子也当成好感。
             */
            const re = new RegExp(nm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*[：:]\\s*(-?\\d+(?:\\.\\d+)?)');
            const m = hay.match(re);
            if (m) {
                out.push({ name: trimText(c.name), value: trimText(m[1]) });
                break;
            }
        }
    }
    return out;
}

export async function refreshAffinity() {
    const settings = getSettings();
    const source = trimText(settings.affinitySource);
    const state = loadState();
    const roster = state.characters || [];
    if (!roster.length) {
        return { ok: false, reason: '名册是空的' };
    }
    /*
     * ⭐⭐ 她 [2]（她 10-16 亲口）：「**手机你就让他读标签吧，这个随便能读正文的标签就行**」
     *   ⇒ **先从正文的标签块读**（读到就用，⏔ 非得先去世界书找条目）；
     *     **一条都没读到** ⇒ **照旧往下走世界书那条路**（⏔ 老账不许炸）。
     *   ⚠️ 只“读进来”：⏔ 自算、⏔ 自编、⏔ 另存一份（她的原话）。
     */
    try {
        const ctx0 = getCtx();
        const msgs = (ctx0 && Array.isArray(ctx0.chat)) ? ctx0.chat.slice(-8) : [];
        const text = msgs.map((m) => trimText(m && m.mes)).filter(Boolean).join('\n');
        const hit = affinityFromText(text, roster, source);
        if (hit.length) {
            let wrote = 0;
            for (const h of hit) {
                const c = roster.filter((x) => matchKey(x.name) === matchKey(h.name))[0];
                if (c && trimText(c.affinity) !== h.value) {
                    c.affinity = h.value;
                    c.affinitySource = '正文标签' + (source ? '（' + source + '）' : '');
                    wrote += 1;
                }
            }
            if (wrote) {
                saveState();
            }
            return { ok: true, reason: '从正文标签读到 ' + String(hit.length) + ' 个好感', from: 'text', wrote };
        }
    } catch (e) {
        console.warn('[万象阁] 从正文标签读好感没成：', e);
    }
    if (!source) {
        return { ok: false, reason: '正文里没找到好感标签，也没配好感数据源' };
    }

    /*
     * ⚠️ `ctx` 这个函数后面还在用（聊天元数据、设置那些）——替换闸门的时候
     *    别把它一起删了（真踩过：删掉之后整条"读好感"报 `ctx is not defined`）。
     */
    const ctx = getCtx();

    // ⭐ 通道探测（⛔ 不再只认 `ctx.getLorebookEntries` 那一组：1.18 原版没有它）
    const ch = channelReport();
    if (!ch.canRead) {
        return { ok: false, reason: ch.text };
    }

    // ⭐ 她填的那个词，可能是**书名**，也可能是**条目关键词/条目名**（她那边叫「手机」）。
    //    两种都得认：先看书名里有没有；没有就当成关键词，去候选书里找条目。
    const books = await listBooks();
    const sourceIsBook = books.some((b) => b === source);

    // 一个条目算不算"跟好感有关"
    const isAffinityEntry = (title, body) => {
        if (sourceIsBook) {
            return true;                       // 她直接点了整本书当源
        }
        return matchKey(title).includes(matchKey(source))
            || matchKey(source).includes(matchKey(title) || '###')
            || /好感|亲密度|好感度/.test(body);
    };

    const excluded = toList(settings.excludeBooks);
    const isExcluded = (name) => excluded.some((b) => matchKey(b) === matchKey(name));

    // 候选书：她是书名就只读那本；是关键词就把"提取世界书＋角色卡绑定"都翻一遍
    const candidates = new Set();
    if (sourceIsBook) {
        if (!isExcluded(source)) {
            candidates.add(source);
        }
    } else {
        for (const b of toList(settings.extractBooks)) {
            if (b && !isExcluded(b)) {
                candidates.add(b);
            }
        }
        /*
         * ⭐ 修复单 #8 附：补 `ctx &&` 保护。
         *   同一文件 373/395 行都有这个保护、就这处没有——`ctx` 拿不到时（早期／异常环境）
         *   这里会 `TypeError: Cannot read properties of null`，把"读人"整条路带崩。
         */
        const bound = trimText(ctx && ctx.chatMetadata && ctx.chatMetadata.world_info);
        if (bound && !isExcluded(bound)) {
            candidates.add(bound);
        }
        for (const b of books) {
            if (!isExcluded(b) && b !== ourOwnBookName()) {
                candidates.add(b);
            }
        }
    }

    let updated = 0;
    let scanned = 0;
    let readAny = false;
    const seenBooks = [];

    for (const book of candidates) {
        // ⭐ 走多通道适配层（酒馆助手／旧通道／新版接口，有哪个用哪个）
        // eslint-disable-next-line no-await-in-loop
        const entries = await readBookEntries(book);
        if (!Array.isArray(entries) || !entries.length) {
            continue;
        }
        readAny = true;
        seenBooks.push(book);
        for (const entry of entries) {
            if (!entry || typeof entry !== 'object') {
                continue;
            }
            const title = trimText(entry.comment) || trimText(entry.key);
            const body = asText(entry.content);
            if (!body || !isAffinityEntry(title, body)) {
                continue;
            }
            scanned += 1;
            for (const rawLine of body.split(/\n+/)) {
                const line = trimText(rawLine);
                if (!line) {
                    continue;
                }
                // 这一行里"所有角色名"的形态表（用来判"是不是被更长的名字包含"）
                const allForms = [];
                for (const c of roster) {
                    allForms.push(c.name, ...(c.aliases || []));
                }
                for (const c of roster) {
                    const forms = [c.name].concat(c.aliases || []).filter(Boolean);
                    // ① 先找"名字独立出现"的位置（⛔ 短名不许命中长名那一行）
                    const found = findStandaloneName(line, forms, allForms);
                    if (!found) {
                        continue;
                    }
                    const at = found.at;
                    const hitForm = found.form;
                    // ② 取数口径（自审修正·条 11）：⛔ 不再抓"行内第一个数字"
                    //    （会把序号"1."或年份"2026"当成好感）
                    //    顺序：名字之后的「好感」类关键词后面的数 → 名字之后的第一个数 → 名字之前的最后一个数
                    const after = line.slice(at + hitForm.length);
                    const before = line.slice(0, at);
                    let value = '';
                    const byKeyword = after.match(/(?:好感|好感度|亲密度|喜欢|羁绊)\s*[:：]?\s*(-?\d+(?:\.\d+)?)/)
                        || before.match(/(?:好感|好感度|亲密度|喜欢|羁绊)\s*[:：]?\s*(-?\d+(?:\.\d+)?)/);
                    if (byKeyword) {
                        value = byKeyword[1];
                    } else {
                        const numsAfter = after.match(/-?\d+(?:\.\d+)?/g);
                        if (numsAfter && numsAfter.length) {
                            value = numsAfter[0];      // 名字后面第一个数（"名字 … 90(+0.0)" ⇒ 90）
                        } else {
                            const numsBefore = before.match(/-?\d+(?:\.\d+)?/g);
                            if (numsBefore && numsBefore.length) {
                                value = numsBefore[numsBefore.length - 1];
                            }
                        }
                    }
                    if (!value) {
                        continue;
                    }
                    const from = sourceIsBook ? book : (book + ' · ' + (title || '条目'));
                    if (trimText(c.affinity) !== value || trimText(c.affinitySource) !== from) {
                        c.affinity = value;
                        c.affinitySource = from;
                        c.updatedAt = Date.now();
                        updated += 1;
                    }
                }
            }
        }
    }

    if (!scanned) {
        return {
            ok: false,
            reason: readAny
                ? ('在这些书里没找到跟《' + source + '》有关的条目（翻了：' + seenBooks.join('、') + '）')
                : ('读不到可能相关的那几本世界书（她填的源：' + source + '）'),
        };
    }
    if (updated) {
        saveState();
    }
    return { ok: true, updated, scanned, books: seenBooks };
}

/** 引擎自己那本书的名字（⛔ 读好感时要跳过它，免得读自己写的东西） */
function ourOwnBookName() {
    return WORLD_BOOK_NAME;
}

/** 列出现有世界书名字（读不到就返回空数组，机器不崩） */
export async function listWorldbookNames() {
    const ctx = getCtx();
    const names = new Set();

    // ⭐ 走多通道（酒馆助手／旧通道／新版）
    try {
        for (const n of await listBooks()) {
            const name = trimText(n);
            if (name) {
                names.add(name);
            }
        }
    } catch (e) {
        console.warn('[万象阁] 读世界书列表失败：', e);
    }

    // 兜底：从聊天元数据里翻已经挂过的世界书名字
    try {
        const chatMd = ctx && ctx.chatMetadata;
        const extra = chatMd && chatMd.world_info;
        if (extra) {
            names.add(trimText(extra));
        }
    } catch (e) {
        // 拿不到就算了
    }

    return Array.from(names).sort();
}

/**
 * 取一本世界书里的条目（兼容不同版本的字段名）。
 * ⭐ 书名留空 ⇒ 兜底用**角色卡绑定的那本**（`chatMetadata.world_info`）——
 *    界面上的输入框就是这么承诺她的（"留空＝角色卡绑定那本"，自审修正·条 14）。
 */
/**
 * ⭐ 修复单 #14：把"书名怎么回退"抽成**一个口径**。
 *
 *   空名时的回退顺序：她传的名 → `chatMetadata.world_info`（当前聊天挂的那本）→
 *   `extractBooks` 里的第一本。
 *   ⚠️ 为什么非得抽出来：`getEntries` 一直在回退，
 *   而**"排除世界书"那两处比对用的是回退前的空名** ⇒
 *   `matchKey('')` 永远匹配不上 ⇒ **她点过名的书照样被读**（排除失效）。
 */
export function resolveBookName(bookName) {
    const ctx = getCtx();
    const settings = getSettings();
    let name = trimText(bookName);
    if (!name) {
        name = trimText(ctx && ctx.chatMetadata && ctx.chatMetadata.world_info);
    }
    if (!name && settings) {
        const list = toList(settings.extractBooks);
        name = list.length ? list[0] : '';
    }
    return name;
}

export async function getEntries(bookName) {
    const name = resolveBookName(bookName);
    if (!name) {
        return [];
    }
    const settings = getSettings();
    // ⭐ 走多通道适配层（里面已经把旧通道的 `{entries:{uid:…}}`
    //    归一成数组了，⏐ 不用这儿再分辨）
    const data = await readBookEntries(name);
    // ⭐ 条目级"不读"名单（她在面板上点「看条目」挑的那些）——在这里统一过掉，
    //    ⛔ 不是只存不用；按条目名匹配（她在世界书界面里看到的那一行）。
    const off = settings ? toList(settings.excludeEntries) : [];
    if (!off.length) {
        return data;
    }
    const keys = off.map((x) => matchKey(x)).filter(Boolean);
    const kept = data.filter((e) => {
        const title = matchKey(entryTitleOf(e));
        return !title || !keys.some((k) => title === k || title.includes(k));
    });
    return kept;
}

/** 条目名：注释名优先（世界书界面上显示的就是它），退到 key／name */
export function entryTitleOf(e) {
    if (!e) {
        return '';
    }
    return trimText(e.comment) || trimText(e.key) || trimText(e.name) || trimText(e.title);
}

/**
 * 从一本世界书里认人。
 * 返回 { people: [{name, comment, enabled}], skipped: number, blocked: boolean }
 * ⚠️ 只是"读"：不新增、不修改她的任何条目。
 */
/**
 * ⭐⭐ 她原话 [18]：「AI 认错人导致同一角色**被拆成两条记录**…合并一键解决」
 *   —— 她 10-16 首夜实测：名册里「月野兔」与「水手月亮」被当两个人（**全表 6 组同型**）。
 *   而书里**自己就写着属主**：
 *     `[角色] 水手月亮` 的内容头＝「【角色档案：月野兔】…变身形态：水手月亮」
 *   ⇒ **读人只按条目名建卡、把这层结构丢了**。
 *   本函数：从内容头认**属主**（→ 不新建人、条目名进别名）与**变身形态**（→ 属主的身份格候选）。
 *   ⚠️ 防误并：`水手小月亮`的属主是**小小兔**（真另一人）⇒ 照它自己写的属主走，⏔ 并到月野兔。
 */
export function extractArchiveOwner(body) {
    const t = trimText(body);
    if (!t) {
        return '';
    }
    /*
     * ⭐ 10-16 她真书上跑出来的两点：
     *   ① 她书里有的条目头写的是 **`【NPC档案：X】`**（不是「角色档案」）⇒ 也得认；
     *   ② 前缀和「档案」之间**可能夹空格／全角**（我原来绷得太死，一条都没匹配上）。
     */
    const m = t.match(/【\s*(?:角色|NPC)\s*档案\s*[：:]\s*([^】\n]{1,40})\s*】/);
    if (!m) {
        return '';
    }
    /*
     * ⭐ 10-16 她真书上的实例：`【NPC档案：月野家 (The Tsukino Family)】`
     *   —— 名字后面**跟了英文注**，总长超过我原来那个 20 字上限 ⇒ **整条匹配失败**（真踩）。
     *   ⇒ 上限放宽，并把括号里的注**剥掉**（`月野家 (The Tsukino Family)` ⇒ `月野家`）。
     */
    const who = trimText(m[1]).replace(/[（(][^）)]*[）)]/g, '').trim();
    /*
     * ⭐ 10-16 在她**真世界书**上跑出来的：有的条目头写的是**类目**而不是人
     *   （例：「【角色档案：日常NPC：奈鲁与海野】」）⇒ 若把「日常NPC」当属主，
     *   真人名反倒变成别名 ⇒ **她书里的奈鲁/海野就是这么丢的**。
     *   ⇒ 类目词（可带「：后面还有内容」）**不算属主**。
     */
    if (/^(?:\u65e5\u5e38NPC|NPC|\u914d\u89d2|\u8def\u4eba|\u5176\u4ed6\u89d2\u8272|\u516c\u4f17|\u80cc\u666f|\u4eba\u7269|\u89d2\u8272)(?:[\uff1a:].*)?$/.test(who)) {
        return '';
    }
    return who;
}

/** 内容里的「变身形态：Y」（可多条；括号里的注音也算）—— 她 [18] 里的「身份」就是这个 */
export function extractFormNames(body) {
    const t = trimText(body);
    if (!t) {
        return [];
    }
    const out = [];
    const re = /变身形态\s*[：:]\s*([^\n｜|]{1,24})/g;
    let m = re.exec(t);
    while (m) {
        const v = trimText(m[1]).replace(/[\uff08(].*?[\uff09)]/g, '').trim();
        if (v && out.indexOf(v) < 0) {
            out.push(v);
        }
        m = re.exec(t);
    }
    return out;
}

/**
 * ⭐ 纯函数：**条目列表 → 人列表**（含"分条归位"）。抽出来是为了能单独测（⏔ 跟世界书 API 绑死）。
 */
export function peopleFromEntries(entries, opts) {
    const o = opts || {};
    const onlyEnabled = o.onlyEnabled !== false;
    const people = [];
    const seen = new Map();
    let skipped = 0;
    for (const entry of (Array.isArray(entries) ? entries : [])) {
        if (!entry || typeof entry !== 'object') {
            continue;
        }
        if (onlyEnabled && entry.disable === true) {
            continue;
        }
        const title = trimText(entry.comment) || trimText(entry.key) || trimText(entry.keys);
        const shown = extractNameFromTitle(title);
        if (!shown) {
            skipped += 1;
            continue;
        }
        const body = trimText(entry.content);
        const owner = extractArchiveOwner(body);
        const isPart = !!owner && matchKey(owner) !== matchKey(shown);
        const person = isPart ? owner : shown;
        const key = matchKey(person);
        if (!key) {
            skipped += 1;
            continue;
        }
        let rec = seen.get(key);
        if (!rec) {
            rec = { name: person, comment: '', enabled: true, aliases: [], identityHint: '' };
            seen.set(key, rec);
            people.push(rec);
        }
        if (!rec.comment && trimText(entry.comment)) {
            rec.comment = trimText(entry.comment);
        }
        rec.enabled = rec.enabled && entry.disable !== true;
        // 分条：**条目名进属主别名**（她："合并成名字有个毛线用"→ 身份才是正主，别名也得留）
        if (isPart && rec.aliases.indexOf(shown) < 0) {
            rec.aliases.push(shown);
        }
        /*
         * 变身形态 → 属主的身份候选。
         * ⚠️ 只**候选**：写不写进身份格由上层定（仅当格空，⏔ 冲她手改的）。
         */
        {
            const forms = extractFormNames(body);
            const cand = forms.concat(isPart ? [shown] : []);
            for (const f of cand) {
                if (f && !rec.identityHint) {
                    rec.identityHint = f;
                }
            }
        }
    }
    return { people, skipped };
}

export async function collectPeopleFromBook(bookName, options) {
    const opts = options || {};
    const settings = getSettings();
    /*
     * ⭐ 修复单 #14：排除比对要用**回退后的书名**。
     *   空名时 `getEntries` 会回退（当前聊天挂的那本／extractBooks 第一本），
     *   而这里原来拿**空名**去比 ⇒ `matchKey('')` 永远匹配不上 ⇒ **她点过名的书照样被读**。
     */
    const name = resolveBookName(bookName);

    // 她在「排除世界书」里点过名的书：⛔ 不读、不参与
    const blocked = toList(settings.excludeBooks).some((b) => matchKey(b) === matchKey(name));
    if (blocked) {
        return { people: [], skipped: 0, blocked: true };
    }

    const onlyEnabled = opts.onlyEnabled !== false;
    const entries = await getEntries(name);
    /*
     * ⭐ 她原话 [18]：分条归位走**纯函数** `peopleFromEntries`（能单独测）。
     *   ← 原来这里自己一条条建（只看条目名、不看内容头），属主那层结构丢了。
     */
    const built = peopleFromEntries(entries, { onlyEnabled });
    return { people: built.people, skipped: built.skipped, blocked: false };
}
