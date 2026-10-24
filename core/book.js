/**
 * 万象阁 · 世界书落点（数据要能在世界书里看到、搜到、备份）
 *
 * ⛔ 绝不写她自己的世界书——只读。引擎的数据写进**自己那本**：
 *      《万象阁 · 世界后台》（不在就建）
 * 条目按内容切开、每条前面带一行"读法说明"，她能在世界书界面搜到。
 *
 * 形态：
 *   · 万象阁 · 世界状态摘要 —— ★ [580] D2：结构化常驻摘要槽（事实列表；⛔ 经济／民生／心理／下一步）
 *   · 万象阁 · 总览       —— 现在这个世界什么样
 *   · 万象阁 · 世界状态   —— 局势与暗线
 *   · 万象阁 · 人物/<名字> —— 每人一条（七格）
 *   · 万象阁 · 编年       —— 按时间归档（分页，旧的留在后面的页里）
 *   · 万象阁 · 世界钟     —— 时间与地点（防时空跳变）
 *
 * ⚠️ 失败一律如实返回原因，⛔ 不静默。
 */

import { WORLD_BOOK_NAME, BOOK_ENTRY_PREFIX } from './config.js';
import {  } from './adapter.js';
import { probeChannel } from './wb-channel.js';
import { loadState, listWindsView, saveState } from './state.js';
import { captureOwner, checkOwner } from './owner.js';
import { trimText } from './utils.js';
import { getSettings } from './settings.js';

/** 条目名 */
const ENTRY = {
    /* ★ [580]／工作流 D2：常驻摘要槽（产品形态；内容结构化） */
    summary: BOOK_ENTRY_PREFIX + '世界状态摘要',
    overview: BOOK_ENTRY_PREFIX + '总览',
    world: BOOK_ENTRY_PREFIX + '世界状态',
    clock: BOOK_ENTRY_PREFIX + '世界钟',
    charPrefix: BOOK_ENTRY_PREFIX + '人物/',
    chroniclePrefix: BOOK_ENTRY_PREFIX + '编年/',
    settings: BOOK_ENTRY_PREFIX + '设置说明',
};

const CHRONICLE_PAGE = 60;   // 每页多少条

/** 拿写世界书的接口（不同版本名字不完全一样，都试一遍） */
/*
 * ⭐ 写入走**多通道**（原来只认 `ctx.getWorldbookNames…` 那一组，
 *    而 ST 1.18 原版根本没有它 ⇒ 写入一直写不进，跟"读人读出 0 条"同一个根因）。
 *    这里保持**原来那套名字不变**（list／create／entries／createEntry／setEntries／deleteEntry），
 *    ⏐ 下游一行都不用改；换的只是"这些函数到底由谁提供"。
 */
function bookApi() {
    const ch = probeChannel();
    const caps = ch.caps || {};
    if (ch.channel === 'none') {
        return null;
    }
    return {
        channel: ch.channel,
        list: caps.list || null,
        create: caps.createBook || null,
        entries: caps.read || null,
        // 增：优先逐条接口；旧通道给的是"读-改-写整本"
        createEntry: caps.create || caps.write || null,
        // 改：同上
        setEntries: caps.write || null,
        remove: caps.remove || null,
        deleteEntry: caps.remove || null,
    };
}


/**
 * 一次性迁移（依据＝第 7 问 C4／阿砚 51 号）：把我们自己书里**旧格式条目**归正一次。
 *   · 只扫 `WORLD_BOOK_NAME` 这一本（⛔ 不碰她和别人的书）
 *   · 只改 key／keysecondary 写成字符串的条目 ⇒ 数组
 *   · 跑完在 `state.world.bookMigratedAt` 打标记，避免每次开面板都重跑
 */
export async function migrateBookEntriesOnce(api) {
    try {
        const st = loadState();
        st.world = st.world || {};
        if (st.world.bookMigratedAt) { return { ok: true, skipped: true, fixed: 0 }; }
        const entries = await readEntries(api);
        if (!entries) { return { ok: false, reason: '读不到这本书，下次再迁' }; }
        const fixes = [];
        for (const e of entries) {
            if (!e) { continue; }
            const keyIsStr = typeof e.key === 'string';
            const secIsBad = typeof e.keysecondary === 'string' || e.keysecondary === undefined;
            if (!keyIsStr && !secIsBad) { continue; }
            const patch = Object.assign({}, e);
            if (keyIsStr) { patch.key = toKeyArr(e.key); }
            if (secIsBad) { patch.keysecondary = toKeyArr(e.keysecondary); }
            fixes.push(patch);
        }
        if (fixes.length && api && api.setEntries) {
            await api.setEntries(WORLD_BOOK_NAME, fixes);
        }
        st.world.bookMigratedAt = Date.now();
        saveState();
        return { ok: true, skipped: false, fixed: fixes.length };
    } catch (e) {
        return { ok: false, reason: (e && e.message) ? e.message : String(e) };
    }
}

/** 确保"万象阁"那本世界书存在 */
async function ensureBook(api) {
    if (api.list) {
        /*
         * ⚠️ 首夜实测单第 1 条（急 · 一按就炸）：原来只查"有没有 api.list"，**没查它返回的是不是 Promise**
         *   ⇒ 同步实现（直接返回数组）的宿主上 `.catch` 不存在 ⇒ 点「写入世界书」当场炸：
         *   `api.list(...).catch is not a function`，而且**黑话原样漏到屏上**。
         *   ⇒ 先拿返回值，是 Promise 才 await+catch；不是就直接当数组用（两种实现都过）。
         */
        const r = api.list();
        const names = (r && typeof r.then === 'function') ? await r.catch(() => []) : (r || []);
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
        return null;   /* ★ 20261022：没接口≠书里没东西 ⇒ null（调用方必须中止本次写入） */
    }
    try {
        const list = await api.entries(WORLD_BOOK_NAME);
        return Array.isArray(list) ? list : null;
    } catch (e) {
        /* ★ 20261022：读失败就是读失败——⛔ 拿 [] 冒充“书里没有”，
         *   否则 byTitle 全空 ⇒ 整本书条目被重复新建一遍 ✗ */
        try { if (typeof console !== 'undefined' && console.warn) { console.warn('[book] 读世界书失败：' + (e && e.message ? e.message : String(e))); } } catch (eW) { }
        return null;
    }
}

function entryTitle(entry) {
    return trimText(entry && (entry.comment || entry.name || entry.key));
}

/** 把一批"要写成什么样"的条目落盘（有就改、没有就建） */
export async function upsertEntries(api, wanted) {   /* ★ 供测试（行为级） */
    const existing = await readEntries(api);
    if (!existing) {
        /* ★ 20261022：宁可这次不写，也不要写重复（她看不出来、也不报错） */
        return { written: 0, problems: ['读不到这本书现有的条目——这次不写（宁可下次再写，也不写重复）'], aborted: true };
    }
    const byTitle = new Map();
    for (const e of existing) {
        const t = entryTitle(e);
        if (t) {
            byTitle.set(t, e);
        }
    }
    let written = 0;
    const problems = [];
    /*
     * ⭐⭐ 修复 11（材料 02）：**告别 60 次串行全书读写** ✓
     *   旧：每一条都单独调一次 api.setEntries ⇒ 60 条就 60 次「读整本＋写整本」✗ ⇒ 卡顿 ✗
     *   新：先分两桶（要改的 toUpdate／要建的 toCreate ✓ 内容没变就跳过、不白写盘 ✓）
     *       ⇒ **一次 setEntries 把要改的全写掉** ✓（60 次 → 1 次 ✓）
     */
    const toUpdate = [];
    const toCreate = [];
    for (const item of wanted) {
        const old = byTitle.get(item.title);
        if (old) {
            /* ★ [580] D2：摘要槽要**真常驻启用**——内容没变也要把 disable/constant 纠到启用 ✓ */
            const needEnable = item.constant === true && (
                old.constant !== true
                || old.disable === true
                || old.enabled === false
            );
            if (trimText(old.content) === trimText(item.content) && !needEnable) {
                continue;   // 内容没变且旗标已对 ⇒ 不白写盘 ✓
            }
            const patch = { ...old, content: item.content };
                /* ★ 迁移：她盘上已有的字符串 key 条目，下一次写入顺手改成数组（不改就一直报错） */
                if (typeof patch.key === 'string') { patch.key = toKeyArr(patch.key); }
                if (!Array.isArray(patch.keysecondary)) { patch.keysecondary = toKeyArr(patch.keysecondary); }   /* 字符串／不存在 都归正成数组 */
            if (item.constant === true) {
                patch.constant = true;
                patch.selective = false;
                patch.disable = false;
                patch.enabled = true;
            }
            toUpdate.push(patch);
        } else {
            toCreate.push(item);
        }
    }

    if (toUpdate.length) {
        try {
            if (api.setEntries) {
                // ⭐ 一次性批量更新已有条目 ✓
                await api.setEntries(WORLD_BOOK_NAME, toUpdate);
                written += toUpdate.length;
            } else if (api.createEntry) {
                // \u23d4 \u4fdd\u7559\u515c\u5e95\uff1a\u5bbf\u4e3b\u6ca1\u6709\u6279\u91cf\u63a5\u53e3\u65f6\uff0c\u7167\u65e7\u9010\u6761\u53e6\u5efa\uff08\u5b81\u53ef\u91cd\u590d\u4e5f\u4e0d\u4e22\u6570\u636e \u2713\uff09
                for (const item of toUpdate) {
                    await api.createEntry(WORLD_BOOK_NAME, {
                        comment: item.comment || item.title || '',
                        content: item.content,
                        /* ★ 同上：兜底路径也必须是数组 */
                key: toKeyArr(item.key || item.comment || item.title || ''),
                        keysecondary: [],   /* ★ 依据＝阿砚 25 号：ST 原生也是 string[]，写字符串 ⇒ e.keysecondary.map() 抛错 */
                        selective: false,
                        constant: false,
                    });
                    written += 1;
                }
            } else {
                problems.push('这个酒馆版本没有给"批量改世界书条目"的接口');
            }
        } catch (e) {
            problems.push('批量更新条目失败：' + (e && e.message ? e.message : String(e)));
        }
    }

    for (const item of toCreate) {
        try {
            if (api.createEntry) {
                await api.createEntry(WORLD_BOOK_NAME, {
                    comment: item.title,
                    content: item.content,
                    key: toKeyArr(item.title),   /* ★ ⇒ string[] */
                    keysecondary: [],   /* ★ 依据＝阿砚 25 号：ST 原生也是 string[]，写字符串 ⇒ e.keysecondary.map() 抛错 */
                    selective: false,
                    /* ★ [580] D2：摘要槽 constant=true 且**启用**；其余仍禁用（防与拦截器叠床） */
                    constant: item.constant === true,
                    /* ⭐ 修复 11（材料 02）：非摘要条目默认 disable ✓ 仅作查阅备份
                     *   ★ D2 续：摘要槽改为常驻启用（disable:false／enabled:true）✓ */
                    disable: item.constant === true ? false : true,
                    enabled: item.constant === true ? true : false,
                });
                written += 1;
            } else {
                problems.push('这个酒馆版本没有给"新增世界书条目"的接口');
                break;
            }
        } catch (e) {
            problems.push(item.title + '：' + (e && e.message ? e.message : String(e)));
        }
    }

    // 清理已从名册删除或被合并掉的旧人物条目（⛔ 只清「人物/」前缀且仅当名册非空时执行；编年归档绝不删）
    const wantedTitles = new Set(wanted.map((w) => w.title));
    /* ⭐ U15：多出来的编年分页也要删 ✓（编年从 3 页缩回 1 页时，编年/02、03 会带着旧数据永远留着 ✗） */
    if (api.deleteEntry) {
        const chroniclePagesNow = wanted.filter((w) => w.title.indexOf(ENTRY.chroniclePrefix) === 0).length;
        for (const old of existing) {
            const t2 = entryTitle(old);
            if (!t2 || t2.indexOf(ENTRY.chroniclePrefix) !== 0) {
                continue;
            }
            const num2 = Number(String(t2.slice(ENTRY.chroniclePrefix.length)));
            if (Number.isFinite(num2) && num2 > chroniclePagesNow) {
                try {
                    const keyOrUid2 = old.uid !== undefined ? old.uid : t2;
                    await api.deleteEntry(WORLD_BOOK_NAME, keyOrUid2);
                } catch (eChr) { /* 清理失败不影响主流程 ✓ */ }
            }
        }
    }
    /*
     * ⭐ U15（材料 12·未覆盖死角）：**名册清空时更要清** ✓
     *   旧：`if (api.deleteEntry && hasWantedChars)` ✗
     *     ⇒ 她把名册清空（或删掉最后 1 人）时 `hasWantedChars === false` ✗
     *     ⇒ 世界书里那些“人物/…”条目**反而一直留着不删** ✗
     *   现在：只要宿主支持删就清 ✓（循环里仍只动 `人物/` 前缀 ✓）
     */
    if (api.deleteEntry) {
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

/**
 * ★ [580]／工作流 D2：**结构化世界状态摘要**（常驻槽正文）。
 *   取「一条常驻摘要」产品形态；内容＝事实列表，⛔ 不搬叙述长文／经济／民生／心理／下一步。
 *   ★ 续：本条 **constant＋启用**（ST 世界书常驻）；其余备份条目仍默认禁用，防叠床。
 */
export function buildWorldSummarySlot(stateIn) {
    const state = stateIn && typeof stateIn === 'object' ? stateIn : loadState();
    const world = state.world || {};
    const lines = [];
    lines.push('【读法】万象阁 · 世界状态摘要（结构化常驻槽）');
    lines.push('· 给她在世界书里一眼看清「现在世界怎样」；事实列表，⛔ 不当经济／民生／心理叙述。');
    lines.push('· ⛔ 不含经济／物价／民生气候／心理／「即将…」下一步（撞已定规矩）。');
    lines.push('· 本条常驻启用（constant）：经 ST 世界书通道进请求；其余《万象阁 · …》备份条仍默认禁用。');
    lines.push('');
    lines.push('## 宏观格局');
    lines.push('世界钟：' + (trimText(world.clock) || '未知'));
    lines.push('地点：' + (trimText(world.place) || '未知'));
    if (trimText(world.bigPicture)) {
        lines.push('总览：' + trimText(world.bigPicture));
    }
    lines.push('');
    lines.push('## 势力与战线');
    const facs = Array.isArray(world.factions) ? world.factions : [];
    if (!facs.length) {
        lines.push('（还没有在册势力）');
    } else {
        for (const f of facs.slice(0, 20)) {
            if (!f || !trimText(f.name)) continue;
            const bits = [trimText(f.name)];
            if (trimText(f.status)) { bits.push(trimText(f.status)); }
            if (trimText(f.relation)) { bits.push('对玩家·' + trimText(f.relation)); }
            if (trimText(f.scope)) { bits.push('范围：' + trimText(f.scope)); }
            const pillars = Array.isArray(f.powerPillars) ? f.powerPillars.map(trimText).filter(Boolean) : [];
            if (pillars.length) { bits.push('支柱：' + pillars.join('／')); }
            lines.push('· ' + bits.join('｜'));
        }
    }
    const sits = Array.isArray(world.situations) ? world.situations : [];
    if (sits.length) {
        lines.push('局势：');
        sits.slice(0, 12).forEach((s, i) => {
            if (!s || !trimText(s.title)) return;
            lines.push(String(i + 1) + '. ' + trimText(s.title)
                + (trimText(s.sides) ? '（' + trimText(s.sides) + '）' : '')
                + (trimText(s.tier) ? ' · ' + trimText(s.tier) : '')
                + (Number.isFinite(Number(s.pressure)) ? ' · 压' + String(Number(s.pressure)) + '/5' : '')
                + (trimText(s.visibility) ? ' · ' + trimText(s.visibility) : ''));
        });
    } else {
        lines.push('局势：（还没有）');
    }
    lines.push('');
    lines.push('## 暗线');
    const hids = Array.isArray(world.hidden) ? world.hidden : [];
    const openH = hids.filter((h) => h && trimText(h.name)
        && trimText(h.stage) !== '消散' && trimText(h.stage) !== '完成');
    if (!openH.length) {
        lines.push('（没有未完暗线）');
    } else {
        for (const h of openH.slice(0, 16)) {
            lines.push('· ' + trimText(h.name) + '【' + (trimText(h.stage) || '萌芽') + '】'
                + (trimText(h.owner) ? ' 盘算人：' + trimText(h.owner) : '')
                + (trimText(h.goal) ? ' 目标：' + trimText(h.goal) : '')
                + (trimText(h.trigger) ? ' 到点：' + trimText(h.trigger) : ''));
        }
    }
    lines.push('');
    lines.push('## 脉动域');
    const domains = (world.pulse && Array.isArray(world.pulse.domains)) ? world.pulse.domains : [];
    if (!domains.length) {
        lines.push('（还没有）');
    } else {
        for (const d of domains.slice(0, 12)) {
            if (!d || !trimText(d.label)) continue;
            lines.push('· ' + trimText(d.label)
                + (trimText(d.kind) ? '／' + trimText(d.kind) : '')
                + ' 压' + String(Number.isFinite(Number(d.pressure)) ? Number(d.pressure) : 0)
                + (trimText(d.state) ? '：' + trimText(d.state) : ''));
        }
    }
    lines.push('');
    lines.push('## 风声（未证实）');
    let winds = [];
    try { winds = listWindsView(16); } catch (eW) { winds = Array.isArray(world.winds) ? world.winds : []; }
    if (!winds.length) {
        lines.push('（还没有）');
    } else {
        for (const w of winds) {
            const t = trimText(w && (w.topic || w.title));
            if (!t) continue;
            const tx = trimText(w && w.text);
            lines.push('· ' + t + (tx && tx !== t ? '＝' + tx : ''));
        }
    }
    lines.push('');
    lines.push('## 键值事实');
    const facts = Array.isArray(world.facts) ? world.facts : [];
    if (!facts.length) {
        lines.push('（还没有）');
    } else {
        for (const f of facts.slice(0, 24)) {
            if (!f || !trimText(f.key)) continue;
            lines.push('· ' + (trimText(f.subject) || '世界') + '｜' + (trimText(f.field) || '—')
                + '＝' + (trimText(f.value) || '（空）'));
        }
    }
    lines.push('');
    lines.push('人物 ' + String((state.characters || []).length) + ' 人 ｜ 编年 '
        + String((state.chronicle || []).length) + ' 条');
    return lines.join('\n');
}

/** 把当前账本整理成条目清单 */
function buildEntries() {
    const state = loadState();
    const settings = getSettings();
    const wanted = [];

    const world = state.world || {};
    /* ★ [580] D2：常驻摘要槽排最前（世界书里一眼能找到） */
    wanted.push({
        title: ENTRY.summary,
        content: buildWorldSummarySlot(state),
        constant: true,
    });
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
/**
 * ★ 20261023 依据＝阿砚 21 号：世界书条目的 key 必须是 **string[]**。
 *   写成字符串：ST 自己读得下去，但酒馆助手的清理函数对 e.key 直接 .map() ⇒ 抛错 ⇒ 孤儿条目清不掉。
 */
export function toKeyArr(raw) {
    if (Array.isArray(raw)) {
        return raw.map((x) => String(x || '').trim()).filter(Boolean);
    }
    const k = String(raw || '').trim();
    return k ? [k] : [];
}

export async function publishToBook(opts) {
    /* 依据＝阿砚 A 组 H2：写书前抓归属（下面 ensureBook / migrate 都是 await） */
    const bookOwner = captureOwner();
    const api = bookApi();
    const settings = getSettings();
    if (!settings.enabled) {
        return { ok: false, reason: '总开关关着' };
    }
    if (!api || !api.list) {
        return { ok: false, reason: '这个酒馆版本没给出世界书接口' };
    }
    const exists = await ensureBook(api);
    /* H2：每个 await 后面先问“还是不是这本” */
    const ownA = checkOwner(bookOwner);
    if (!ownA.ok) { return { ok: false, reason: ownA.reason }; }
    /* 依据＝第 7 问 C4：一次性把旧格式条目归正（只跑一次，有 bookMigratedAt 标记） */
    try { await migrateBookEntriesOnce(api); } catch (eMig) { }
    const ownB = checkOwner(bookOwner);
    if (!ownB.ok) { return { ok: false, reason: ownB.reason }; }
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
