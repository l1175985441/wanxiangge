/**
 * 万象阁 · 提示词页的两块说明（阿砚件 17）
 *
 * 为什么单独一件：`ui/sections.js` 贴着 8200 行硬线；这两块都是**纯文字拼装**，
 *   留在主文件只会继续撑高行数。
 *
 * 17-1：折叠条上要说清「这套是干什么的」（原来只有字数）。
 * 17-2：她改提示词时要知道**能引用什么**（全库此前 0 个变量清单）。
 */

/** 每套提示词一句用途（短，进折叠条标题） */
export const PROMPT_PURPOSE = {
    world: '每轮决定局势怎么走',
    chars: '决定角色这轮怎么被写',
    jailbreak: '破限与口吻',
    header: '注入块的开头一句',
};

/** 折叠条上那句用途；没有就空串（⛔ 编一句） */
export function purposeOf(kind) {
    const p = PROMPT_PURPOSE[kind];
    return p ? (' · ' + p) : '';
}

/**
 * 「能写哪些变量」清单的行。列的都是代码里**真在替换**的占位符。
 * @returns {Array<[string, string]>} [占位符, 说明]
 */
export function promptVarRows() {
    return [
        ['{{world}}', '上一轮的世界状态（可为空）'],
        ['{{clock}}', '世界钟原文（唯一准的时间）'],
        ['{{recent}}', '最近几楼正文（按回溯楼数）'],
        ['{{factions}}', '在册势力（名字／规模／状态）'],
        ['{{worldFacts}}', '世界事实键值（对齐用）'],
        ['{{worldPulse}}', '世界脉动（镜头外压力）'],
        ['{{worldWinds}}', '风声（未证实传闻）'],
        ['{{hidden}}', '已有暗线（阶段／条件／进度）'],
        ['{{chars}}', '这一轮点到的人（角色块）'],
        ['{{blastMax}}', '这一轮允许写多长（篇幅上限）'],
        ['{{user}}', '玩家名字（替玩家写台词时别用）'],
    ];
}

/** 一行说明（诊断用） */
export function promptVarsLine() {
    return '能写的变量：' + promptVarRows().map((r) => r[0]).join(' ');
}
