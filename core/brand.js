/**
 * 万象阁 · 应用身份一处定义（阿砚 1-c #17，brand.ts 那一条）
 *
 * 病：日志前缀、目录名、注册 id 散在各处手写。上一轮量到世界背面
 *   “日志前缀从目录名现算 ⇒ 导出件里全认不出”那个坑，一处定义就能避开。
 * 依据＝它那边 5 行：SCRIPT_DISPLAY_NAME / SCRIPT_ID / SCRIPT_LOG_PREFIX。
 */

export const SCRIPT_ID = 'wanxiangge';
export const SCRIPT_DISPLAY_NAME = '万象阁';
export const SCRIPT_LOG_PREFIX = '[' + SCRIPT_DISPLAY_NAME + ']';

/** 一句话说明这是谁（日志/导出件里用） */
export function brandLine() {
    return SCRIPT_DISPLAY_NAME + '(' + SCRIPT_ID + ')';
}
