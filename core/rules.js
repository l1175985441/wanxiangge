/**
 * 万象阁 · 一句判断单独成件（阿砚 1-c #7：「把一句判断提成 7–30 行纯函数文件，让判据能直接 import 它真跑」）
 *
 * 现在只搬进来一条，但它是**最容易被两处写出两种答案**的一条：
 *   「模型写的是不是“未知/不详/不明”这类占位词」——pipeline 原来把它写成函数内的一个常量正则，
 *   判据只能靠读源码；现在改成 import 这个文件即可直接测。
 */

/** 模型常拿来“填满字段”的占位词（⛔ 收“无”“没有”——它们可能是有意义的值） */
const UNKNOWNISH = /^(未知|不详|不明|未接入|暂无|不清楚|待定|未设定|无记录|n\/a|-|—|？|\?)$/i;

/** 这个字符串是不是占位词（空串不算：空＝没写，另有约定） */
export function isUnknownish(text) {
    const s = String(text == null ? '' : text).trim();
    if (!s) { return false; }
    return UNKNOWNISH.test(s);
}

/** 占位词与空串都当“没说” */
export function isBlankOrUnknownish(text) {
    const s = String(text == null ? '' : text).trim();
    if (!s) { return true; }
    return UNKNOWNISH.test(s);
}
