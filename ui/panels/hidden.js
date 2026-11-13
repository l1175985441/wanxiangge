import { TIERS } from '../../core/config.js'; import { asArray, trimText } from '../../core/utils.js'; import { cardLine, foldCard } from '../card-fold.js'; import { loadState, openHiddenCount } from '../../core/state.js'; import { stageProgress, stageTone } from '../stage-progress.js'; import { stage } from '../sections.js'; import { button, card, el, emptyBlock, line, row, section, select, textInput } from './shared.js';
export function secHidden(host) {
    const box = section('暗线', '自己有时间表，到点才动');
    const w = loadState().world;
    /* ④ 活跃暗线（带未完计数） */
    box.appendChild(el('div', 'wxg-note wxg-sec-head', '活跃暗线（未完 ' + String(openHiddenCount()) + ' 条）'));
    const cHid = card('暗线（自己有时间表，到点才动）');
    const hid = el('div', 'wxg-list');
    if (!w.hidden.length) {
        hid.appendChild(emptyBlock('还没有暗线（引擎会在更新时排出来）'));
    } else {
        /*
         * ⭐ 行化（有数据排版术第七条）：一行一条暗线
         *    `阶段胶囊 ｜ 名字 ＋（到点条件／现在到哪一步） ｜ 右侧改阶段 ＋ 删`
         * ⚠️ 原来每个字段各占一行（到点条件一行、现在到哪一步一行、下拉一行）
         *    ⇒ 6 条暗线就是一屏半。
         */
        for (let hidIdx = 0; hidIdx < w.hidden.length; hidIdx += 1) {
                const h = w.hidden[hidIdx];
            const r = el('div', 'wxg-r is-rowlink');
                // ⭐ 点行开浮层（同局势）；行内下拉与「删」各自有 data-action。 ⚠️ 用**自己的类名** `is-rowlink`，⛔ 蹭 `.is-click`（它带着两列的规矩）
                r.setAttribute('data-action', 'open-world-entry');
                r.setAttribute('data-kind', 'hidden');
                r.setAttribute('data-index', String(hidIdx));
            r.appendChild(el('span', 'wxg-badge ' + stageTone(h.stage), trimText(h.stage) || '萌芽'));
    {
        /* 阶段数字（同行同字号）；空／乱写不出数字 */
        const prog = stageProgress(h.stage, h.kind);
        if (prog) { r.appendChild(el('span', 'wxg-badge is-soft wxg-stage-num', prog.text)); }
    }
            const main = el('div', 'wxg-r-main');
            const title = el('div', 'wxg-r-title');
            title.appendChild(el('span', 'wxg-r-who', trimText(h.name) || '未记名'));
            if (trimText(h.tier)) {
                title.appendChild(el('span', 'wxg-badge is-off', trimText(h.tier)));
            }
            if (h.manual) {
                title.appendChild(el('span', 'wxg-badge is-warn', '已手动修改'));
            }
            main.appendChild(title);
            // 第二行：到点条件 ／ 现在到哪一步（空值写"暂无"，⛔ 不隐身）
            const bits = [];
            bits.push('到点：' + (trimText(h.trigger) || '暂无'));
            bits.push('走到：' + (trimText(h.note) || '暂无'));
            main.appendChild(el('div', 'wxg-r-sub', bits.join(' · ')));
            r.appendChild(main);
            const act = el('div', 'wxg-r-act');
            /*
             * ★ [321]：有悬浮框的旁边不需要编辑 —— 行上只留「删」（与局势行同）。
             *   改阶段／因果一律进浮层右上 ⋮（或浮层底阶段下拉）✓
             */
            act.appendChild(button('删', 'del-hidden', 'wxg-btn-xs', h.id));
            r.appendChild(act);
            hid.appendChild(r);
        }
    }
    cHid.appendChild(hid);
    const addHidRow = row(cHid,
        textInput('wxg-new-hidden', '', '新暗线名字', 'noop', 'wxg-short'),
        textInput('wxg-new-hidden-trigger', '', '挂在什么时间／条件（例：晚上／三天后）', 'noop', 'wxg-short'),
        // ⭐ 火候与族类**给她选**（原来写死"几天内／冲突型"）——近的快推、远的慢炖，是她自己的节奏
        select('wxg-new-hidden-tier', TIERS.map((x) => ({ value: x, label: x })), '几天内', 'noop'),
        select('wxg-new-hidden-kind', [
            { value: 'conflict', label: '冲突型（萌芽→发酵→逼近→爆发→消散）' },
            { value: 'progress', label: '推进型（筹备→执行→关键→完成）' },
        ], 'conflict', 'noop'),
        button('加一条暗线', 'add-hidden', 'wxg-primary'));
    if (addHidRow.classList && typeof addHidRow.classList.add === 'function') {
        addHidRow.classList.add('wxg-add-row');
    } else {
        addHidRow.className += ' wxg-add-row';
    }
    /*
     * ⭐ LY7（材料 11·布局层）：**这一行单独给个类，好把它排成两栏** ✓
     *   旧：5 个控件（名字／条件／火候／族类／按钮）塞在同一个 .wxg-row 里 ✗
     *     ⇒ 常规宽度下必然断成两行，且第二行与第一行**左边缘不对齐** ✗
     *   现在：给它一个独有类 ✓（⛔ 动 .wxg-add-row 本身 ✗ —— 那会连带别的“加一条”行 ✗）
     */
    if (addHidRow.classList && typeof addHidRow.classList.add === 'function') {
        addHidRow.classList.add('wxg-add-row-hidden');
    }
    addHidRow.setAttribute('data-no-lock', '1');
    box.appendChild(cHid);
    for (const c of asArray(box.querySelectorAll('.wxg-card'))) {
        foldCard({ card: c, doc: document, line: cardLine((c.querySelector('.wxg-card-h') || {}).textContent || '', loadState()) });
    }
    host.appendChild(box);
}
