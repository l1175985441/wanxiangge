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
export async function refreshAffinity() {
    const settings = getSettings();
    const source = trimText(settings.affinitySource);
    if (!source) {
        return { ok: false, reason: '没配好感数据源' };
    }
    const state = loadState();
    const roster = state.characters || [];
    if (!roster.length) {
        return { ok: false, reason: '名册是空的' };
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
        const bound = trimText(ctx.chatMetadata && ctx.chatMetadata.world_info);
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
export async function getEntries(bookName) {
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
    if (!name) {
        return [];
    }
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
export async function collectPeopleFromBook(bookName, options) {
    const opts = options || {};
    const settings = getSettings();
    const name = trimText(bookName);

    // 她在「排除世界书」里点过名的书：⛔ 不读、不参与
    const blocked = toList(settings.excludeBooks).some((b) => matchKey(b) === matchKey(name));
    if (blocked) {
        return { people: [], skipped: 0, blocked: true };
    }

    const onlyEnabled = opts.onlyEnabled !== false;
    const entries = await getEntries(name);
    const people = [];
    const seen = new Set();
    let skipped = 0;

    for (const entry of entries) {
        if (!entry || typeof entry !== 'object') {
            continue;
        }
        if (onlyEnabled && entry.disable === true) {
            continue;
        }
        const title = trimText(entry.comment) || trimText(entry.key) || trimText(entry.keys);
        const person = extractNameFromTitle(title);
        if (!person) {
            skipped += 1;
            continue;
        }
        const key = matchKey(person);
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        people.push({
            name: person,
            comment: trimText(entry.comment),
            enabled: entry.disable !== true,
        });
    }

    return { people, skipped, blocked: false };
}
