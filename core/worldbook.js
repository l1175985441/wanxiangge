/**
 * 万象阁 · 世界书读取（只读，⛔ 绝不写她的世界书）
 *
 * 本轮提供两件事：
 *   ① 列出有哪些世界书（给后面"读哪些、排除哪些"的下拉用）；
 *   ② 从世界书条目里认人——中文分类包裹写法都要认得：
 *      [角色] 名字 / 【名字】 / （名字） / 名字（备注） / 名字·后缀 / 3-5字前缀，等等。
 *      还要剥掉 Markdown 加粗、标题符号这类外壳。
 */

import { matchKey, trimText } from './utils.js';
import { getCtx } from './adapter.js';

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
            // 只在"整串被包住"时剥掉最外层
            if (t.startsWith(open) && t.endsWith(close) && t.length > open.length + close.length) {
                const inner = trimText(t.slice(open.length, t.length - close.length));
                if (inner) {
                    t = inner;
                    changed = true;
                }
            }
        }
    }

    // ③ 去掉"分类前缀·名字"这种写法（仅当点号前面确实是分类词，别误伤"雷欧·阿斯特拉"）
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
    //    注意不能碰名字本身带的中圆点（雷欧·阿斯特拉）
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
    const key = matchKey(t);
    if (!key || key.length < 2 || key.length > 12) {
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

/** 列出现有世界书名字（读不到就返回空数组，机器不崩） */
export async function listWorldbookNames() {
    const ctx = getCtx();
    const names = new Set();

    try {
        if (ctx && typeof ctx.getWorldbookNames === 'function') {
            const list = await ctx.getWorldbookNames();
            for (const n of Array.isArray(list) ? list : []) {
                const name = trimText(n);
                if (name) {
                    names.add(name);
                }
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

/** 取一本世界书里的条目（兼容不同版本的字段名） */
export async function getEntries(bookName) {
    const ctx = getCtx();
    const name = trimText(bookName);
    if (!name || !ctx || typeof ctx.getLorebookEntries !== 'function') {
        return [];
    }
    try {
        const data = await ctx.getLorebookEntries(name);
        return Array.isArray(data) ? data : [];
    } catch (e) {
        console.warn('[万象阁] 读世界书条目失败：' + name, e);
        return [];
    }
}

/**
 * 从一本世界书里认人。
 * 返回 { people: [{name, comment, enabled}], skipped: number }
 * ⚠️ 只是"读"：不新增、不修改她的任何条目。
 */
export async function collectPeopleFromBook(bookName, options) {
    const opts = options || {};
    const onlyEnabled = opts.onlyEnabled !== false;
    const entries = await getEntries(bookName);
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
        const name = extractNameFromTitle(title);
        if (!name) {
            skipped += 1;
            continue;
        }
        const key = matchKey(name);
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        people.push({
            name,
            comment: trimText(entry.comment),
            enabled: entry.disable !== true,
        });
    }

    return { people, skipped };
}
