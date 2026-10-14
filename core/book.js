/**
 * 万象阁 · 世界书落点（数据要能在世界书里看到、搜到、备份）
 *
 * ⛔ 绝不写她自己的世界书——只读。引擎的数据写进**自己那本**：
 *      《万象阁 · 世界后台》（不在就建）
 * 条目按内容切开、每条前面带一行"读法说明"，她能在世界书界面搜到。
 *
 * 形态：
 *   · 万象阁 · 总览       —— 现在这个世界什么样
 *   · 万象阁 · 世界状态   —— 局势与暗线
 *   · 万象阁 · 人物/<名字> —— 每人一条（七格）
 *   · 万象阁 · 编年       —— 按时间归档（分页，旧的留在后面的页里）
 *   · 万象阁 · 世界钟     —— 时间与地点（防时空跳变）
 *
 * ⚠️ 失败一律如实返回原因，⛔ 不静默。
 */

import { WORLD_BOOK_NAME, BOOK_ENTRY_PREFIX } from './config.js';
import { getCtx } from './adapter.js';
import { loadState } from './state.js';
import { trimText } from './utils.js';
import { getSettings } from './settings.js';

/** 条目名 */
const ENTRY = {
    overview: BOOK_ENTRY_PREFIX + '总览',
    world: BOOK_ENTRY_PREFIX + '世界状态',
    clock: BOOK_ENTRY_PREFIX + '世界钟',
    charPrefix: BOOK_ENTRY_PREFIX + '人物/',
    chroniclePrefix: BOOK_ENTRY_PREFIX + '编年/',
    settings: BOOK_ENTRY_PREFIX + '设置说明',
};

const CHRONICLE_PAGE = 60;   // 每页多少条

/** 拿写世界书的接口（不同版本名字不完全一样，都试一遍） */
function bookApi() {
    const ctx = getCtx();
    if (!ctx) {
        return null;
    }
    return {
        list: typeof ctx.getWorldbookNames === 'function' ? ctx.getWorldbookNames.bind(ctx) : null,
        create: typeof ctx.createWorldbook === 'function' ? ctx.createWorldbook.bind(ctx) : null,
        entries: typeof ctx.getLorebookEntries === 'function' ? ctx.getLorebookEntries.bind(ctx) : null,
        createEntry: typeof ctx.createWorldInfoEntry === 'function' ? ctx.createWorldInfoEntry.bind(ctx) : null,
        setEntries: typeof ctx.setLorebookEntries === 'function' ? ctx.setLorebookEntries.bind(ctx) : null,
        deleteEntry: typeof ctx.deleteLorebookEntry === 'function' ? ctx.deleteLorebookEntry.bind(ctx) : null,
    };
}

/** 确保"万象阁"那本世界书存在 */
async function ensureBook(api) {
    if (api.list) {
        const names = await api.list().catch(() => []);
        if (Array.isArray(names) && names.includes(WORLD_BOOK_NAME)) {
            return true;
        }
    }
    if (!api.create) {
        return false;
    }
    try {
        await api.create(WORLD_BOOK_NAME);
        return true;
    } catch (e) {
        console.warn('[万象阁] 建世界书失败：', e);
        return false;
    }
}

/** 读现在这本世界书里的条目（拿来对照更新） */
async function readEntries(api) {
    if (!api.entries) {
        return [];
    }
    try {
        const list = await api.entries(WORLD_BOOK_NAME);
        return Array.isArray(list) ? list : [];
    } catch (e) {
        return [];
    }
}

function entryTitle(entry) {
    return trimText(entry && (entry.comment || entry.name || entry.key));
}

/** 把一批"要写成什么样"的条目落盘（有就改、没有就建） */
async function upsertEntries(api, wanted) {
    const existing = await readEntries(api);
    const byTitle = new Map();
    for (const e of existing) {
        const t = entryTitle(e);
        if (t) {
            byTitle.set(t, e);
        }
    }
    let written = 0;
    const problems = [];
    for (const item of wanted) {
        const old = byTitle.get(item.title);
        try {
            if (old) {
                const patch = { content: item.content };
                if (api.setEntries) {
                    await api.setEntries(WORLD_BOOK_NAME, [{ ...old, content: item.content }]);
                } else if (api.createEntry) {
                    // 实在没有改接口：留着旧条目不动，另建一条（宁可重复也不丢数据）
                    await api.createEntry(WORLD_BOOK_NAME, { comment: item.title, content: item.content, key: item.title, keysecondary: '', selective: false, constant: false });
                }
                written += 1;
            } else if (api.createEntry) {
                await api.createEntry(WORLD_BOOK_NAME, {
                    comment: item.title,
                    content: item.content,
                    key: item.title,
                    keysecondary: '',
                    selective: false,
                    constant: false,
                    disable: false,
                });
                written += 1;
            } else {
                problems.push('这个酒馆版本没有给"新增世界书条目"的接口');
            }
        } catch (e) {
            problems.push(item.title + '：' + (e && e.message ? e.message : String(e)));
        }
    }

    // 清理已从名册删除或被合并掉的旧人物条目（⛔ 只清「人物/」前缀且仅当名册非空时执行；编年归档绝不删）
    const wantedTitles = new Set(wanted.map((w) => w.title));
    const hasWantedChars = wanted.some((w) => w.title.indexOf(ENTRY.charPrefix) === 0);
    if (api.deleteEntry && hasWantedChars) {
        for (const old of existing) {
            const t = entryTitle(old);
            if (t && t.indexOf(ENTRY.charPrefix) === 0 && !wantedTitles.has(t)) {
                try {
                    const keyOrUid = old.uid !== undefined ? old.uid : t;
                    await api.deleteEntry(WORLD_BOOK_NAME, keyOrUid);
                } catch (e) {
                    // 清理失败不影响主流程写入
                }
            }
        }
    }
    return { written, problems };
}

/** 组一条条目的正文（带一行读法说明，她打开就懂） */
function body(lines) {
    return ['（万象阁自动写的记录；正文不会引用它，只在世界书里给你看和搜。）']
        .concat(lines.filter((x) => trimText(x)))
        .join('\n');
}

/** 把当前账本整理成条目清单 */
function buildEntries() {
    const state = loadState();
    const settings = getSettings();
    const wanted = [];

    const world = state.world || {};
    wanted.push({
        title: ENTRY.overview,
        content: body([
            '世界钟：' + (trimText(world.clock) || '未知'),
            world.place ? '大致地点：' + trimText(world.place) : '',
            world.bigPicture ? '从高处看一眼：' + trimText(world.bigPicture) : '',
            '人物 ' + String(state.characters.length) + ' 人 ｜ 局势 ' + String((world.situations || []).length)
            + ' 条 ｜ 暗线 ' + String((world.hidden || []).length) + ' 条 ｜ 编年 ' + String(state.chronicle.length) + ' 条',
        ]),
    });

    wanted.push({
        title: ENTRY.clock,
        content: body([
            '世界内时间：' + (trimText(world.clock) || '未知'),
            '地点：' + (trimText(world.place) || '未知'),
            '（防时空跳变用：角色这一格要跟这里接得上）',
        ]),
    });

    const sit = (world.situations || []).map((s, i) => String(i + 1) + '. ' + trimText(s.title)
        + (trimText(s.sides) ? '（' + trimText(s.sides) + '）' : '')
        + (trimText(s.tier) ? ' · ' + trimText(s.tier) : ''));
    const hid = (world.hidden || []).map((h) => '· ' + trimText(h.name)
        + '【' + trimText(h.stage) + '】'
        + (trimText(h.trigger) ? ' 到点：' + trimText(h.trigger) : '')
        + (trimText(h.note) ? ' 现状：' + trimText(h.note) : ''));
    wanted.push({
        title: ENTRY.world,
        content: body([
            '【局势 · 势力的碰撞】',
            sit.length ? sit.join('\n') : '（还没有）',
            '',
            '【暗线 · 还没浮上台面的事】',
            hid.length ? hid.join('\n') : '（还没有）',
        ]),
    });

    for (const c of state.characters) {
        const lines = [
            '七格：',
            '年龄：' + (trimText(c.age) || '未知'),
            '身份：' + (trimText(c.identity) || '未知'),
            '所在势力：' + (trimText(c.faction) || '未知'),
            '好感：' + (trimText(c.affinity) || '未接入数据源'),
            '时间・地点：' + (trimText(c.timePlace) || '未知'),
            '正在经历：' + (trimText(c.current) || '未知'),
        ];
        if (c.past.length) {
            lines.push('过去经历（由近到远）：');
            for (const p of c.past) {
                lines.push('  · ' + p.text);
            }
        }
        if (c.aliases.length) {
            lines.push('别名：' + c.aliases.join('、'));
        }
        if (c.isPlayer) {
            lines.push('⚠️ 玩家棋子（由本人控制，⛔ AI 不得扮演）');
        }
        if (c.manual) {
            lines.push('（这条被人手改过）');
        }
        wanted.push({ title: ENTRY.charPrefix + trimText(c.name), content: body(lines) });
    }

    // 编年分页
    const chron = state.chronicle || [];
    const pages = Math.max(1, Math.ceil(chron.length / CHRONICLE_PAGE));
    for (let p = 0; p < pages; p += 1) {
        const slice = chron.slice(p * CHRONICLE_PAGE, (p + 1) * CHRONICLE_PAGE);
        const lines = slice.map((c) => {
            const when = new Date(Number(c.at) || Date.now());
            const stamp = when.getFullYear() + '-' + String(when.getMonth() + 1).padStart(2, '0') + '-' + String(when.getDate()).padStart(2, '0')
                + ' ' + String(when.getHours()).padStart(2, '0') + ':' + String(when.getMinutes()).padStart(2, '0');
            return stamp + (trimText(c.who) ? ' [' + trimText(c.who) + ']' : '') + ' ' + trimText(c.text);
        });
        wanted.push({
            title: ENTRY.chroniclePrefix + String(p + 1).padStart(2, '0'),
            content: body(['（只给你看：不注入、不喂模型）', lines.join('\n')]),
        });
    }

    wanted.push({
        title: ENTRY.settings,
        content: body([
            '召回：回溯 ' + String(settings.recentTurns) + ' 楼 ｜ 人物封顶 ' + String(settings.maxChars) + ' ｜ 事件封顶 ' + String(settings.maxEvents),
            '更新：每 ' + String(settings.updateEvery) + ' 回合 ｜ 现场保护' + (settings.protectedBypass ? '开' : '关'),
            '这条只是说明；换设置请到面板里改。',
        ]),
    });

    return wanted;
}

/**
 * 把手上的账写进世界书。
 * @param {object} opts { force:boolean } —— force=true 时不等节流，立刻写
 */
export async function publishToBook(opts) {
    const api = bookApi();
    const settings = getSettings();
    if (!settings.enabled) {
        return { ok: false, reason: '总开关关着' };
    }
    if (!api || !api.list) {
        return { ok: false, reason: '这个酒馆版本没给出世界书接口' };
    }
    const exists = await ensureBook(api);
    if (!exists) {
        return { ok: false, reason: '建不了世界书《' + WORLD_BOOK_NAME + '》（可能没有建书权限）' };
    }
    const wanted = buildEntries();
    const res = await upsertEntries(api, wanted);
    if (res.written === 0 && res.problems.length) {
        return { ok: false, reason: res.problems[0] };
    }
    return {
        ok: true,
        book: WORLD_BOOK_NAME,
        entries: res.written,
        problems: res.problems,
    };
}

/* ------------------------------ 节流（别每写一笔账就刷世界书） ------------------------------ */

let dirty = false;
let timer = null;
const DELAY = 8000;

/** 账变了：排队去写世界书（合并多次改动） */
export function markBookDirty() {
    dirty = true;
    if (timer) {
        return;
    }
    timer = setTimeout(async () => {
        timer = null;
        if (!dirty) {
            return;
        }
        dirty = false;
        const res = await publishToBook();
        if (!res.ok) {
            console.warn('[万象阁] 世界书没写成：' + res.reason + '（数据仍在账本里，稍后会重试）');
            dirty = true;   // 下次再试，⛔ 不静默丢
        }
    }, DELAY);
}

/** 立刻把排队中的写入做掉 */
export async function flushBook() {
    if (timer) {
        clearTimeout(timer);
        timer = null;
    }
    if (!dirty) {
        return { ok: true, entries: 0, skipped: true };
    }
    dirty = false;
    return publishToBook({ force: true });
}
