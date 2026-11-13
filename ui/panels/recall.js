import { expandPair } from '../controls-note.js'; import { getSettings } from '../../core/settings.js'; import { saveBar, stage } from '../sections.js'; import { button, card, checkbox, el, foldable, line, numberInput, section, select } from './shared.js';
export function secRecall(host, intoBox) {
    const SECID = 'recall';
    const s = getSettings();
    const box = intoBox || section(
        '召回',
        '她发消息时当场算一次"这轮该带什么"：好感必带；世界与平行事件按她最新发言的相关度筛，相关的进、其余排后台。',
        { open: false, five: true });
    box.appendChild(expandPair({ el: el, button: button }));   /* 六：全部展开／全部收起 */
    const cPick = card('每一轮怎么挑');
    /*
     * ★ 20261023（阿砚 15 号）：三项一行的**组**。
     *   在 `line()`（左标签右控件）上面加一层：一个组里放三个小格，窄屏退回一列 ✓
     */
    const lineCell = (label, control) => {
        const cell = el('div', 'wxg-line-cell');
        cell.appendChild(el('div', 'wxg-line-k', label));
        const v = el('div', 'wxg-line-v');
        v.appendChild(control);
        cell.appendChild(v);
        return cell;
    };
    const lineGroup = (cells, target) => {
        const g = el('div', 'wxg-line-group');
        for (const c2 of cells) {
            if (c2) { g.appendChild(c2); }
        }
        /* 渲染层 #7：数值行挂到**它自己那一组**（⛔ 全挂到第一组） */
        (target || bPick).appendChild(g);
        return g;
    };
    /*
     * 依据＝阿砚 3 件任务 · 渲染层 #7（设置按用途分组折叠）：
     *   召回 11 个控件原来平铺在一张卡里（世界背面有 9 个子组）⇒ 按「挑谁／容量锁／篇幅」分三组，默认收起。
     *   开合记在 foldOpenState（同一会话内重画不丢；⛔ 跨重启保存——那要另开一次 schema）。
     */
    const mkFold = (title, open) => {
        const f = foldable(title, open === true);
        const b = el('div', 'wxg-sec-body');
        /* N1：最小高度挂这里——收起时整块不在文档里，就不会撑出空盒子 */
        b.style.minHeight = 'var(--wxg-fold-min, 96px)';
        f.appendChild(b);
        cPick.appendChild(f);
        return b;
    };
    const bPick = mkFold('挑谁（回溯大小／人物与事件封顶／排序）', true);   /* N1：首组默认展开，那片空白自然没了 */
    const bCap = mkFold('容量锁（到顶怎么归并／淡出）', false);
    const bSize = mkFold('篇幅（注入字数／一轮推演几个）', false);
        lineGroup([
            lineCell('线索回溯', numberInput('wxg-recent-turns', s.recentTurns, 1, 10, 'stage-recent-turns')),
            lineCell('人物封顶（建议 8–20，太大占上下文）', numberInput('wxg-cap-people', s.capPeople, 1, 99, 'stage-cap-people')),
            lineCell('事件封顶', numberInput('wxg-max-events', s.maxEvents, 0, 20, 'stage-max-events')),
        ]);
        lineGroup([
            lineCell('世界事件上限', numberInput('wxg-cap-events', s.capEvents, 10, 300, 'stage-cap-events')),
            lineCell('暗线上限', numberInput('wxg-cap-hidden', s.capHidden, 5, 200, 'stage-cap-hidden')),
            lineCell('编年上限', numberInput('wxg-cap-chronicle', s.capChronicle, 100, 5000, 'stage-cap-chronicle')),
        ], bCap);
        /*
         * ⭐ ST1（材料 11·设置层）：**4 个容量锁设置，面板上终于有输入框了** ✓
         *   旧：capPast／capEvents／capHidden／capChronicle 在 DEFAULT_SETTINGS、loadSettings、
         *     patchSettings、applyLimits 里全套齐全 ✓ 但面板上**一个输入框都没画** ✗
         *     ⇒ 她永远改不了它们 ✗（她原话 [54] 专门要过“保留几条过去经历” ✓）
         */
        line(bCap, '过去经历留几条',
            numberInput('wxg-cap-past', s.capPast, 2, 20, 'stage-cap-past'),
            el('span', 'wxg-note', '条（每个角色；超出的旧自然淡出）'));
        line(bCap, '排序', select('wxg-sort-mode', [
            { value: 'related', label: '按相关度（先说到的排前面）' },
            { value: 'name', label: '按名册顺序' },
        ], s.sortMode, 'stage-sort-mode'));
        line(bCap, '过去经历只端',
            numberInput('wxg-past-floor-cut', s.pastFloorCut, 0, 50, 'stage-past-floor-cut'),
            el('span', 'wxg-note', '楼之外的（最近这么多楼里的，你上下文里已有，不重复端；0＝全端）'));
        line(bSize, '注入字数上限',
            numberInput('wxg-inject-cap', s.injectCharCap, 1, 5000, 'stage-inject-cap'),
            el('span', 'wxg-note', '字符（1–5000，不填默认 1400）'));
        line(bSize, '一轮最多推演',
            numberInput('wxg-max-parallel', s.maxParallelChars, 0, 12, 'stage-max-parallel'),
            el('span', 'wxg-note', '个不在场的角色（省额度：其余下一轮轮转）'));
    /*
     * 依据＝阿砚 3 件任务 · 渲染层 #10（超出建议值给提示，不拦）：
     *   人物封顶建议 8–20，实际填 50 界面一声不吭；而总控那边同类情况会弹黄条。
     *   照总控那条写法：把话说清楚＋一颗一键改的按钮，改不改她定（⛔ 偷偷截断）。
     */
    if (Number(s.capPeople) > 20) {
        const tipCap = el('div', 'wxg-note wxg-advice');
        tipCap.appendChild(el('span', null, '⚠ 人物封顶现在是 ' + String(s.capPeople)
            + '，超出建议值（8–20）：每轮会多吃上下文，也更容易把不相关的人带进正文。'));
        tipCap.appendChild(button('改成 12（推荐）', 'use-cap-people-12', 'wxg-btn-xs'));
        cPick.appendChild(tipCap);
    }
    box.appendChild(cPick);
    const cCard = card('召回卡片');
    cCard.appendChild(checkbox('wxg-card-enabled', '在你每条发言后面显示召回卡片', s.cardEnabled, 'stage-card'));
    cCard.appendChild(checkbox('wxg-show-empty', '没有召回时也显示空态卡片', s.showEmptyCard, 'stage-show-empty'));
    box.appendChild(cCard);
    box.appendChild(saveBar('recall'));
    if (!intoBox) { host.appendChild(box); }
}
