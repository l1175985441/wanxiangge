/**
 * 万象阁 · 世界状态的两列卡片网格（阿砚第三批 质感 A6）
 *
 * 依据＝A6：世界状态是**单列长卡**（主区高 1924／字数 574），卡里常常只有一行；
 *   要改成**两列卡片网格**：卡头 ＋ 一句摘要 ＋ 「查看全部」。
 *
 * 这里只放**可测的纯判断**（DOM 在渲染层）：
 *   · 卡片内容超过几行才值得折起来；
 *   · 摘要怎么从内容里取一句（⛔ 编，只摘已有文字）。
 */

/** 内容行数 ≥ 这个数才折（小于它的卡直接摊开，免得多点一下） */
export const COMPACT_AT = 4;

/** 这张卡该不该折起来 */
export function shouldCompact(childCount) {
    const n = Number(childCount);
    return Number.isFinite(n) && n >= COMPACT_AT;
}

/** 一行摘要：把已有文字掐到 34 个字以内（⛔ 加自己的话） */
export function summarise(text) {
    const s = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
    if (!s) {
        return '';
    }
    return s.length > 34 ? (s.slice(0, 34) + '…') : s;
}
