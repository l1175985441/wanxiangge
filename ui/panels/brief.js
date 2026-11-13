/* 从 ui/sections.js 原样搬出，逻辑一字未改（206 单） */
import { asArray, trimText } from '../../core/utils.js'; import { cardLine, foldCard } from '../card-fold.js'; import { loadState } from '../../core/state.js'; import { stage } from '../sections.js'; import { card, el, line, section } from './shared.js';
export function secBrief(host) {
    const box = section('时局简报', '只读派生·不注入');
    const w = loadState().world;
    /*
     * ★ [580]／工作流 D1：**时局简报成套骨架（只取面板分区）** ✓
     *   驱动力／格局／酝酿 —— 全从已有账派生，⛔ 不新开叙述字段、⛔ 不进注入
     *   （工作流那套「时代快讯」叙述／下一步／心理／民生 一律不取）
     */
    const cBrief = card('时局简报');
    {
        const sits = Array.isArray(w.situations) ? w.situations : [];
        const facs = Array.isArray(w.factions) ? w.factions : [];
        const hids = Array.isArray(w.hidden) ? w.hidden : [];
        const domains = (w.pulse && Array.isArray(w.pulse.domains)) ? w.pulse.domains : [];
        const driveLines = [];
        sits.slice()
            .filter((s) => s && trimText(s.title))
            .sort((a, b) => (Number(b.pressure) || 0) - (Number(a.pressure) || 0))
            .forEach((s) => {
                const p = Number.isFinite(Number(s.pressure)) ? ('压 ' + String(Number(s.pressure)) + ' 成') : '';
                driveLines.push((p ? p + ' · ' : '') + trimText(s.title)
                    + (trimText(s.sides) ? '（' + trimText(s.sides) + '）' : '')
        + (trimText(s.basis) === '未证实' ? '「低档未采信」' : ''));
            });
        domains.slice()
            .filter((d) => d && trimText(d.label) && Number(d.pressure) >= 2)
            .slice(0, 3)
            .forEach((d) => {
                driveLines.push('域·' + trimText(d.label) + '（压 ' + String(Number(d.pressure) || 0) + ' 成）'
                    + (trimText(d.state) ? '：' + trimText(d.state) : ''));
            });
        const brewLines = [];
        sits.filter((s) => s && trimText(s.title) && (
            String(trimText(s.trend) || '').toLowerCase() === 'rising'
            || (trimText(s.expected) && !trimText(s.result))
        )).slice(0, 4).forEach((s) => {
            brewLines.push(trimText(s.title)
                + (trimText(s.expected) ? '（预期：' + trimText(s.expected) + '）' : '')
                + (trimText(s.consequence) ? '（余波：' + trimText(s.consequence) + '）' : ''));
        });
        hids.filter((h) => h && trimText(h.name)
            && trimText(h.stage) !== '消散' && trimText(h.stage) !== '完成')
            .slice(0, 4)
            .forEach((h) => {
                brewLines.push('暗线·' + trimText(h.name) + '【' + (trimText(h.stage) || '萌芽') + '】'
                    + (trimText(h.goal) ? '→' + trimText(h.goal) : ''));
            });
        const putBrief = (label, lines, emptyHint) => {
            cBrief.appendChild(el('div', 'wxg-note', label));
            if (!lines.length) {
                cBrief.appendChild(el('div', 'wxg-empty', emptyHint));
                return;
            }
            const ul = el('div', 'wxg-list');
            for (const t of lines) {
                /* 渲染层第 1 条：单子元素的行不进三列网格（否则挤成竖条） */
                const r = el('div', 'wxg-r is-solo');
                r.appendChild(el('div', 'wxg-r-main', trimText(t)));
                ul.appendChild(r);
            }
            cBrief.appendChild(ul);
        };
        putBrief('驱动力（高压局势／脉动域）', driveLines, '还没有可派生的驱动力');
        putBrief('酝酿中（升温／未结／活跃暗线）', brewLines, '还没有酝酿中的线');
        cBrief.appendChild(el('div', 'wxg-note', '本卡只给人看；内容来自局势／势力／暗线／脉动账，⛔ 不另写叙述、不进主模型注入。'));
    }
    box.appendChild(cBrief);
    for (const c of asArray(box.querySelectorAll('.wxg-card'))) {
        foldCard({ card: c, doc: document, line: cardLine((c.querySelector('.wxg-card-h') || {}).textContent || '', loadState()) });
    }
    host.appendChild(box);

}
