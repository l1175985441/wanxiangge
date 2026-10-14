/**
 * 万象阁 · 世界书**多通道**适配层（读写都走这儿）
 *
 * ⭐ 为什么必须做（复核方真机核验 2026-10-14）：
 *    ST 1.18.0 原版**没有** `ctx.getLorebookEntries / createWorldbook / setLorebookEntries…` 这一组
 *    （运行时 `typeof` = undefined；`public/` 里也搜不到；对照同一台机器，
 *    这组名字在「酒馆助手」`window.TavernHelper` 上**全部可用**）。
 *    我们原来只认那一条通道 ⇒ **「从世界书读人」读出 0 条**、**写入世界书也写不进**
 *    ——两件事是同一个根因。
 *
 * 通道优先级（⛔ 一律**运行时探测**，有哪个用哪个，不写死）：
 *    ① `window.TavernHelper.*`  —— 最全（建书／删书／读条目／写条目／替换）
 *    ② ST 旧通道 `ctx.loadWorldInfo / saveWorldInfo / getWorldInfoNames`
 *       —— 1.18 本机有；没有"逐条增删"，所以用**读-改-写整本**来实现
 *    ③ 新版 `ctx.getLorebookEntries…` —— 保留"有则用"（将来酒馆升级了就能用上）
 *
 * ⚠️ 探测结果**缓存**（每轮读人不必反复 try），但要能被 `resetChannelCache()` 清掉
 *    （酒馆助手可能是后加载的：她先开酒馆、后装助手 ⇒ 那时探测结果会过期）。
 */

import { getCtx } from './adapter.js';
import { trimText } from './utils.js';

/** 通道名（给人看的） */
export const CHANNEL_LABEL = {
    helper: '酒馆助手（TavernHelper）',
    legacy: '酒馆自带（loadWorldInfo／saveWorldInfo）',
    modern: '酒馆新版接口（getLorebookEntries）',
    none: '没有可用通道',
};

let cached = null;

/** 清掉探测缓存（装/卸助手、切版本之后调一次） */
export function resetChannelCache() {
    cached = null;
}

function helper() {
    try {
        const w = typeof window !== 'undefined' ? window : null;
        const h = (w && w.TavernHelper) || (typeof globalThis !== 'undefined' ? globalThis.TavernHelper : null);
        return h && typeof h === 'object' ? h : null;
    } catch (e) {
        return null;
    }
}

function fn(obj, name) {
    return obj && typeof obj[name] === 'function' ? obj[name].bind(obj) : null;
}

/**
 * 探测可用通道。
 * @returns {{channel: string, label: string, caps: object, detail: object}}
 */
export function probeChannel() {
    if (cached) {
        return cached;
    }
    const ctx = getCtx() || {};
    const h = helper();

    // ① 酒馆助手
    const hList = fn(h, 'getWorldbookNames');
    const hRead = fn(h, 'getLorebookEntries');
    const hSet = fn(h, 'setLorebookEntries');
    const hCreateOne = fn(h, 'createLorebookEntries');
    const hDelete = fn(h, 'deleteLorebookEntries');
    const hCreateBook = fn(h, 'createWorldbook');
    if (hList || hRead) {
        cached = {
            channel: 'helper',
            label: CHANNEL_LABEL.helper,
            caps: {
                list: hList, read: hRead, write: hSet, create: hCreateOne,
                remove: hDelete, createBook: hCreateBook,
            },
            detail: { 建书: !!hCreateBook, 读条目: !!hRead, 写条目: !!hSet, 增条目: !!hCreateOne, 删条目: !!hDelete },
        };
        return cached;
    }

    // ② ST 旧通道（1.18 本机有）
    const lList = fn(ctx, 'getWorldInfoNames');
    const lRead = fn(ctx, 'loadWorldInfo');
    const lSave = fn(ctx, 'saveWorldInfo');
    if (lList || lRead) {
        cached = {
            channel: 'legacy',
            label: CHANNEL_LABEL.legacy,
            caps: {
                list: lList, load: lRead, save: lSave,
                read: lRead ? async (name) => {
                    const data = await lRead(name);
                    return legacyToArray(data);
                } : null,
                // 旧通道没有"逐条增删" ⇒ 统一走"读-改-写整本"
                write: lSave ? legacyWrite(lRead, lSave) : null,
                create: lSave ? legacyCreate(lRead, lSave) : null,
                remove: lSave ? legacyRemove(lRead, lSave) : null,
                createBook: lSave ? async (name) => {
                    await lSave(name, { entries: {} }, true);
                    return true;
                } : null,
            },
            detail: { 列书: !!lList, 读整本: !!lRead, 写整本: !!lSave },
        };
        return cached;
    }

    // ③ 新版 ctx 接口（将来酒馆升级能用上）
    const mList = fn(ctx, 'getWorldbookNames');
    const mRead = fn(ctx, 'getLorebookEntries');
    const mSet = fn(ctx, 'setLorebookEntries');
    const mCreate = fn(ctx, 'createWorldInfoEntry');
    const mDelete = fn(ctx, 'deleteLorebookEntry');
    const mCreateBook = fn(ctx, 'createWorldbook');
    if (mList || mRead) {
        cached = {
            channel: 'modern',
            label: CHANNEL_LABEL.modern,
            caps: {
                list: mList, read: mRead, write: mSet, create: mCreate,
                remove: mDelete, createBook: mCreateBook,
            },
            detail: { 列书: !!mList, 读条目: !!mRead, 写条目: !!mSet, 建书: !!mCreateBook },
        };
        return cached;
    }

    cached = {
        channel: 'none',
        label: CHANNEL_LABEL.none,
        caps: {},
        detail: { 酒馆助手: !!h },
    };
    return cached;
}

/* ------------------------------ 旧通道：读-改-写整本 ------------------------------ */

/** `loadWorldInfo` 的返回值 → 条目数组（带上 uid，写回时要靠它） */
function legacyToArray(data) {
    const box = data && typeof data === 'object' ? (data.entries || data) : null;
    if (!box || typeof box !== 'object') {
        return [];
    }
    const out = [];
    for (const key of Object.keys(box)) {
        const e = box[key];
        if (!e || typeof e !== 'object') {
            continue;
        }
        out.push(Object.assign({}, e, { uid: e.uid !== undefined ? e.uid : key }));
    }
    return out;
}

/** 条目数组 → `saveWorldInfo` 要的形状（键＝uid） */
function legacyToData(list, oldData) {
    const entries = {};
    for (const e of Array.isArray(list) ? list : []) {
        if (!e || typeof e !== 'object') {
            continue;
        }
        const uid = e.uid !== undefined ? e.uid : undefined;
        const key = uid !== undefined ? String(uid) : String(Object.keys(entries).length);
        entries[key] = Object.assign({}, e, { uid: e.uid !== undefined ? e.uid : Number(key) || key });
    }
    // 保留原书里除 entries 之外的字段（别把别人的设置抹了）
    const keep = oldData && typeof oldData === 'object' ? Object.assign({}, oldData) : {};
    keep.entries = entries;
    return keep;
}

function legacyWrite(load, save) {
    return async (name, patchList) => {
        const old = await load(name);
        const list = legacyToArray(old);
        const wanted = Array.isArray(patchList) ? patchList : [patchList];
        for (const w of wanted) {
            if (!w || typeof w !== 'object') {
                continue;
            }
            const uid = w.uid;
            const idx = list.findIndex((e) => String(e.uid) === String(uid)
                || (trimText(w.comment) && trimText(e.comment) === trimText(w.comment)));
            if (idx >= 0) {
                list[idx] = Object.assign({}, list[idx], w);
            } else {
                list.push(w);
            }
        }
        await save(name, legacyToData(list, old), true);
        return true;
    };
}

function legacyCreate(load, save) {
    const write = legacyWrite(load, save);
    return async (name, entry) => {
        await write(name, [entry]);
        return true;
    };
}

function legacyRemove(load, save) {
    return async (name, uidOrTitle) => {
        const old = await load(name);
        const list = legacyToArray(old).filter((e) => {
            const sameUid = String(e.uid) === String(uidOrTitle);
            const sameTitle = trimText(e.comment) === trimText(uidOrTitle);
            return !sameUid && !sameTitle;
        });
        await save(name, legacyToData(list, old), true);
        return true;
    };
}

/* ------------------------------ 统一接口（给 book.js / worldbook.js 用） ------------------------------ */

/**
 * 列世界书名字。⛔ 拿不到就返回空数组（调用方自己决定怎么报）。
 */
export async function listBooks() {
    const { caps } = probeChannel();
    const names = new Set();
    if (caps.list) {
        try {
            const list = await caps.list();
            for (const n of Array.isArray(list) ? list : []) {
                const name = trimText(n);
                if (name) {
                    names.add(name);
                }
            }
        } catch (e) {
            console.warn('[万象阁] 列世界书失败：', e);
        }
    }
    return Array.from(names).sort();
}

/** 读一本书的**全部**条目（归一成数组；拿不到就 []） */
export async function readBookEntries(bookName) {
    const name = trimText(bookName);
    if (!name) {
        return [];
    }
    const { caps } = probeChannel();
    if (!caps.read) {
        return [];
    }
    try {
        const data = await caps.read(name);
        if (Array.isArray(data)) {
            return data;
        }
        return legacyToArray(data);
    } catch (e) {
        console.warn('[万象阁] 读世界书条目失败：' + name, e);
        return [];
    }
}

/** 建书（已存在也算成功） */
export async function ensureBook(bookName) {
    const name = trimText(bookName);
    if (!name) {
        return false;
    }
    const { caps } = probeChannel();
    const exists = (await listBooks()).includes(name);
    if (exists) {
        return true;
    }
    if (!caps.createBook) {
        return false;
    }
    try {
        await caps.createBook(name);
        return true;
    } catch (e) {
        console.warn('[万象阁] 建世界书失败：', e);
        return false;
    }
}

/**
 * 探测结果的**人话**（界面上要能看见"现在走的是哪条通道"）。
 * ⛔ 不许静默：通道是 none 的时候她必须看得到原因。
 */
export function channelReport() {
    const p = probeChannel();
    const caps = p.caps || {};
    const missing = [];
    if (!caps.read) {
        missing.push('读条目');
    }
    if (!caps.write && !caps.create) {
        missing.push('写条目');
    }
    return {
        channel: p.channel,
        label: p.label,
        detail: p.detail || {},
        ok: p.channel !== 'none',
        canRead: !!caps.read,
        canWrite: !!(caps.write || caps.create),
        missing,
        text: p.channel === 'none'
            ? ('没找到能读世界书的通道（酒馆助手没装、酒馆版本也不带这组接口）')
            : ('世界书通道：' + p.label + (missing.length ? '（缺：' + missing.join('、') + '）' : '')),
    };
}
