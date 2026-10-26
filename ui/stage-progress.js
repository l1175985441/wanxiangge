/**
 * 万象阁 · 阶段数字进度（阿砚 65 号拍板：**各按自己档数**）
 *
 * 两套枚举本来就在（core/config.js）：
 *   STAGES_PROGRESS = ['筹备','执行','关键','完成']            ← 4 档
 *   STAGES_CONFLICT = ['萌芽','发酵','逼近','爆发','消散']      ← 5 档
 * 她嘴里的「3/5」＝冲突那套第 3 档（逼近）。
 *
 * ⛔ 不统一成 4 档、⛔ 不硬凑 5 档；⛔ 动枚举一个字。
 * ⛔ 阶段为空 / 不在枚举里（手打错别字、老数据）⇒ **不出数字**（不是 0/4、不是 ?）。
 */

import { STAGES_PROGRESS, STAGES_CONFLICT } from '../core/config.js';

/**
 * @param {string} stage 当前阶段词
 * @param {string} kind 'progress' 或 'conflict'（暗线默认 conflict）
 * @returns {{n:number, total:number, text:string}|null} 出不来就 null
 */
export function stageProgress(stage, kind) {
    const s = String(stage == null ? '' : stage).trim();
    if (!s) {
        return null;
    }
    const list = kind === 'progress' ? STAGES_PROGRESS : STAGES_CONFLICT;
    const i = list.indexOf(s);
    if (i < 0) {
        return null;
    }
    return { n: i + 1, total: list.length, text: String(i + 1) + '/' + String(list.length) };
}

/** 一句诊断用（不进 UI） */
export function stageProgressLine(stage, kind) {
    const r = stageProgress(stage, kind);
    return r ? ('阶段进度：' + r.text) : '阶段进度：（不出数字）';
}

/** 阶段徽章的调子（原在 sections.js，跑到这里跟枚举放一起） */
export function stageTone(stage) {
    const s = String(stage == null ? '' : stage).trim();
    if (s === '消散' || s === '完成') {
        return 'is-off';
    }
    if (s === '爆发' || s === '关键' || s === '逼近') {
        return 'is-warn';
    }
    return 'is-info';
}
