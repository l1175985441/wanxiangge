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
// ⭐ 阶段 2／3 接线：新族读回来的是嵌套形状 ⇒ 过转换层；
//    新族新增条目时，我们内部形状要转成它要的形状
import { worldbookToNative, nativeToWorldbook } from './wb-shape.js';

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
    /*
     * ⭐ 阶段 2：助手这一层里**先看新一代 `WorldbookEntry` 那族**，没有再退回旧族。
     *
     * 为什么（照抄自装好的声明，⛔ 不是凭记忆）：旧族每一个函数都标着 @deprecated
     * 并指名了替代 —— getLorebookEntries→getWorldbook、setLorebookEntries→replaceWorldbook、
     * createLorebookEntries→createWorldbookEntries、deleteLorebookEntries→deleteWorldbookEntries。
     * 而两族**形状不同**（旧的平铺 comment／keys／position 字符串，新的嵌套
     * name／strategy／position 对象／recursion／effect）⇒ 新族读回来的要**过转换层**
     * （`worldbookToNative`）再交给下游，⛔ 不然下游看到的字段名全变了。
     *
     * ⚠️ 这一阶段**只动读**：写仍走原来那条（我们的内部形状本来就是旧族那套，
     *    写回去正好对得上）。写路径换新族是阶段 3 的事。
     * ⚠️ 新族 `getWorldbook` **书不存在会抛**（旧族不会）⇒ 下面读的时候要兜住。
     */
    const hList = fn(h, 'getWorldbookNames');
    const hReadNew = fn(h, 'getWorldbook');
    const hRead = hReadNew || fn(h, 'getLorebookEntries');
    const hSet = fn(h, 'setLorebookEntries');
    const hCreateOne = fn(h, 'createLorebookEntries');
    const hDelete = fn(h, 'deleteLorebookEntries');
    const hCreateBook = fn(h, 'createWorldbook');

    /*
     * ⭐ 阶段 3：写路径也优先走新一代那族。技能原话：
     *   "Prefer updater functions or entry-level helpers over whole-object replacement.
     *    Preserve unknown fields, entry identity, unrelated user content…"
     * ⇒ 用 `updateWorldbookWith` 做**字段级**写入：
     *   ⭐ 先摊平原条目（`Object.assign({}, cur)`），**只盖我们真正管的那三个字段**
     *     （名字／正文／开关）—— 我们不管的（strategy／position／recursion／effect／extra…）
     *     原样留住，⛔ 一个都不碰。
     */
    const hUpdateNew = fn(h, 'updateWorldbookWith');
    const hCreateNew = fn(h, 'createWorldbookEntries');
    const hDeleteNew = fn(h, 'deleteWorldbookEntries');

    const writeViaUpdater = hUpdateNew ? async (bookName, entries) => {
        const want = new Map();
        for (const e of (Array.isArray(entries) ? entries : [])) {
            if (e && e.uid !== undefined) {
                want.set(Number(e.uid), e);
            }
        }
        return hUpdateNew(bookName, (current) => (Array.isArray(current) ? current : []).map((cur) => {
            const w = want.get(Number(cur && cur.uid));
            if (!w) {
                return cur;   // 不在这次要写的范围 ⇒ 原样还回去（⛔ 不动别人的东西）
            }
            const out = Object.assign({}, cur);   // ⭐ 摊平原条目 ⇒ 我们不管的字段全留住
            if (w.comment !== undefined) {
                out.name = String(w.comment);
            }
            if (w.content !== undefined) {
                out.content = String(w.content);
            }
            if (w.enabled !== undefined) {
                out.enabled = w.enabled !== false;
            }
            return out;
        }));
    } : null;

    const createViaNew = hCreateNew ? async (bookName, entry) => {
        const r = await hCreateNew(bookName, [nativeToWorldbook(entry || {})]);
        return r && Array.isArray(r.new_entries) ? r.new_entries[0] : r;
    } : null;

    const removeViaNew = hDeleteNew ? async (bookName, keyOrUid) => {
        const id = Number(keyOrUid);
        const asText = trimText(keyOrUid);
        return hDeleteNew(bookName, (e) => {
            if (!e) {
                return false;
            }
            if (Number.isFinite(id) && Number(e.uid) === id) {
                return true;
            }
            // 也可能是按"名字/标题"删的（旧接口两种都收）
            const nm = trimText(e.name);
            return !!asText && nm === asText;
        });
    } : null;

    if (hList || hRead) {
        cached = {
            channel: 'helper',
            label: CHANNEL_LABEL.helper,
            caps: {
                list: hList,
                // 新族读回来的是嵌套形状 ⇒ 过转换层，让下游拿到的仍是同一套字段名
                read: hReadNew
                    ? async (name) => {
                        const list = await hReadNew(name);
                        return Array.isArray(list) ? list.map(worldbookToNative) : [];
                    }
                    : hRead,
                write: writeViaUpdater || hSet,
                create: createViaNew || hCreateOne,
                remove: removeViaNew || hDelete,
                createBook: hCreateBook,
            },
            detail: {
                读用新族: !!hReadNew,
                写用新族: !!writeViaUpdater,
                增用新族: !!createViaNew,
                删用新族: !!removeViaNew,
                建书: !!hCreateBook, 读条目: !!hRead, 写条目: !!hSet,
                增条目: !!hCreateOne, 删条目: !!hDelete,
            },
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
    /*
     * ⭐ 修复单 #10（后半）：**没有 uid 的条目不许撞车**。
     *   原来键取 `String(Object.keys(entries).length)`——那是"此刻已放入几条"，
     *   一旦前面删过条目（或列表里混着无 uid 的），算出来的键**可能已经被占了** ⇒
     *   **后来者把人家的条目覆盖掉**（自审自测点：「删中间条目后再新增无 uid 条目 ⇒ 不得覆盖他条」）。
     *   ⇒ 改成"**找一个还没被占的键**"。
     */
    const nextFreeKey = () => {
        let i = 0;
        while (Object.prototype.hasOwnProperty.call(entries, String(i))) {
            i += 1;
        }
        return String(i);
    };
    for (const e of Array.isArray(list) ? list : []) {
        if (!e || typeof e !== 'object') {
            continue;
        }
        const uid = e.uid !== undefined ? e.uid : undefined;
        const key = uid !== undefined ? String(uid) : nextFreeKey();
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
