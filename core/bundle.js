/**
 * 万象阁 · 账本进出（导出 / 导入验签）
 *
 * 依据＝阿砚 A 组 E4：「导出/导入验签（摘要 + 六道拒因）」。
 * 挡两种病：
 *   1. 坏文件把设置/账搞坏（半截 JSON、结构不对、版本更新、内容离谱大）；
 *   2. 文件被改过没人知道（导出时盖摘要，导入时核对，改一个字节就对不上）。
 *
 * 设计口径：
 *   · **不碰她的书、不碰设置区**：只搬「这一本账」（chat 级 ledger）。
 *   · 摘要用 FNV-1a（确定性、无加密依赖、足够发现"被手改过"）。
 *   · 六道拒因一一对应代码，⛔ 合并成一句"导入失败"。
 */

import { LEDGER_VERSION } from './config.js';
import { trimText, asText } from './utils.js';

export const BUNDLE_SCHEMA = 'wanxiangge.ledger.bundle';
/** 导入体积上限（字符）：超过就拒，⛔ 先解析再拒（别把内存吃爆） */
export const BUNDLE_MAX_CHARS = 4 * 1024 * 1024;
/** 条数上限：防"结构对但内容离谱" */
export const BUNDLE_MAX_ITEMS = 20000;

/** FNV-1a 32 位（确定性；只用来发现"被改过"，不用于安全） */
export function digestOf(text) {
    let h = 0x811c9dc5;
    const s = asText(text);
    for (let i = 0; i < s.length; i += 1) {
        h ^= s.charCodeAt(i);
        h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return ('0000000' + h.toString(16)).slice(-8);
}

/** 摘要里给她看的几个数（导入前后能对一眼） */
export function summarize(ledger) {
    const st = ledger && typeof ledger === 'object' ? ledger : {};
    const chars = Array.isArray(st.characters) ? st.characters.length : 0;
    const chron = Array.isArray(st.chronicle) ? st.chronicle.length : 0;
    const sits = (st.world && Array.isArray(st.world.situations)) ? st.world.situations.length : 0;
    const hidden = (st.world && Array.isArray(st.world.hidden)) ? st.world.hidden.length : 0;
    return {
        chars,
        chronicle: chron,
        situations: sits,
        hidden,
        clock: trimText((st.world || {}).clock),
        chatKey: trimText(st.chatKey),
    };
}

/** 把一本账做成可搬运的字符串（摘要盖在 `digest` 上，算的是 `payload` 的字符） */
export function buildBundle(ledger) {
    const payload = JSON.stringify(ledger && typeof ledger === 'object' ? ledger : {});
    const digest = digestOf(payload);
    const out = {
        schema: BUNDLE_SCHEMA,
        version: Number(LEDGER_VERSION) || 0,
        exportedAt: Date.now(),
        summary: summarize(ledger),
        digest,
        payload,
    };
    /* 自带一次自检：我们自己拼出来的东西必须能过验，⛔ 导出坏包给她 */
    const self = verifyBundle(JSON.stringify(out), { skipVersion: true });
    if (!self.ok) {
        return { ok: false, reason: '导出包自检没过：' + self.reason, code: 'self-check' };
    }
    return { ok: true, text: JSON.stringify(out), summary: out.summary, digest };
}

/**
 * 验一份要导入的包。返回 { ok, code, reason, ledger, summary }
 * 六道拒因（顺序固定，先便宜后贵）：
 *   not-json      不是 JSON / 不是对象
 *   bad-schema    schema 不对（不是我们的包）
 *   too-big       体积超上限
 *   bad-version   版本比当前新（读不懂，⛔ 硬塞）
 *   bad-digest    摘要对不上（文件被改过 / 半截）
 *   bad-shape     结构不对（payload 里不是账本，或条数离谱）
 */
export function verifyBundle(text, opts) {
    const o = opts || {};
    const raw = asText(text);
    if (!raw.trim()) {
        return { ok: false, code: 'not-json', reason: '文件是空的' };
    }
    if (raw.length > BUNDLE_MAX_CHARS) {
        return { ok: false, code: 'too-big', reason: '文件太大（' + String(Math.round(raw.length / 1024)) + 'KB），不敢读' };
    }
    let box;
    try {
        box = JSON.parse(raw);
    } catch (e) {
        return { ok: false, code: 'not-json', reason: '不是 JSON（可能是半截文件或选错了文件）' };
    }
    if (!box || typeof box !== 'object' || Array.isArray(box)) {
        return { ok: false, code: 'not-json', reason: '不是 JSON 对象' };
    }
    if (asText(box.schema) !== BUNDLE_SCHEMA) {
        return { ok: false, code: 'bad-schema', reason: '这不是万象阁的账本包（schema＝' + asText(box.schema) + '）' };
    }
    const v = Number(box.version);
    if (!o.skipVersion && Number.isFinite(v) && v > (Number(LEDGER_VERSION) || 0)) {
        return { ok: false, code: 'bad-version', reason: '这个包是更新版本（v' + String(v) + '）导出的，当前只认到 v' + String(LEDGER_VERSION) };
    }
    const payload = asText(box.payload);
    if (!payload) {
        return { ok: false, code: 'bad-shape', reason: '包里没有账本内容' };
    }
    if (!o.skipDigest && digestOf(payload) !== asText(box.digest)) {
        return { ok: false, code: 'bad-digest', reason: '摘要对不上——这份文件被改过（或没下全）' };
    }
    let ledger;
    try {
        ledger = JSON.parse(payload);
    } catch (e) {
        return { ok: false, code: 'bad-shape', reason: '账本内容解析不了（包内损坏）' };
    }
    if (!ledger || typeof ledger !== 'object' || Array.isArray(ledger)) {
        return { ok: false, code: 'bad-shape', reason: '账本内容不是对象' };
    }
    const chars = Array.isArray(ledger.characters) ? ledger.characters.length : 0;
    const chron = Array.isArray(ledger.chronicle) ? ledger.chronicle.length : 0;
    if (chars > BUNDLE_MAX_ITEMS || chron > BUNDLE_MAX_ITEMS) {
        return { ok: false, code: 'bad-shape', reason: '内容条数离谱（人物 ' + String(chars) + ' / 编年 ' + String(chron) + '），不敢导入' };
    }
    return { ok: true, code: 'ok', ledger, summary: summarize(ledger) };
}

/**
 * 导入前的"能不能落到这个聊天"判定（⛔ 静默覆盖）。
 * @returns {{ok:boolean, code:string, reason:string, warn:string}}
 */
export function importGate(bundleLedger, currentKey, currentLedger) {
    const fromKey = trimText(bundleLedger && bundleLedger.chatKey);
    const mine = trimText(currentKey);
    if (fromKey && mine && fromKey !== mine) {
        return {
            ok: false,
            code: 'other-chat',
            reason: '这份账属于另一个聊天（' + fromKey + '），当前是（' + mine + '）——⛔ 直接导进来会把两边搅在一起',
            warn: '',
        };
    }
    const a = summarize(bundleLedger);
    const b = summarize(currentLedger);
    const warn = (b.chars || b.chronicle)
        ? ('当前这本已有 ' + String(b.chars) + ' 人物 / ' + String(b.chronicle) + ' 编年，导入会**整个替换**这本账（书和设置不动）')
        : '';
    return { ok: true, code: 'ok', reason: '', warn };
}
