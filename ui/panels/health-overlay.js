/* 公-4 片段：体检浮层。从 sections.js 抽出（206 后） */
import { el, button, lastSectionsHost, bindPersonCardDrag } from './shared.js';
import { buildHealthReport } from '../../core/health.js';
import { APP_VERSION } from '../../core/config.js';
import { getChat } from '../../core/adapter.js';


export let healthOpen = false;

export function closeHealthCard() {
    healthOpen = false;
    const old = document.getElementById('wxg-health-card');
    if (old && typeof old.remove === 'function') {
        old.remove();
    }
}

export function renderHealthCard() {
    const old = document.getElementById('wxg-health-card');
    if (old && typeof old.remove === 'function') {
        old.remove();
    }
    if (!healthOpen) {
        return;
    }
    let report = { text: '（体检报告没生成出来）', fails: [] };
    try {
        report = buildHealthReport({ version: APP_VERSION, chat: getChat() });
    } catch (e) {
        report = { text: '体检报告生成失败：' + ((e && e.message) || '未知原因'), fails: [] };
    }

    const pop = el('div', 'wxg-pc wanxiangge');
    pop.id = 'wxg-health-card';
    pop.setAttribute('role', 'dialog');

    const head = el('div', 'wxg-pc-head');
    head.appendChild(el('span', 'wxg-pc-grip', '⠿'));
    const who = el('div', 'wxg-pc-who');
    who.appendChild(el('div', 'wxg-pc-name', '体检报告'));
    who.appendChild(el('div', 'wxg-pc-alias', '版本／开关／条数／最近失败（⛔ 不含正文与钥匙）'));
    head.appendChild(who);
    head.appendChild(button('✕', 'health-close', 'wxg-pc-x'));
    pop.appendChild(head);

    const sec = el('div', 'wxg-pc-sec');
    const pre = el('pre', 'wxg-health-pre', report.text);
    sec.appendChild(pre);
    pop.appendChild(sec);
    const foot = el('div', 'wxg-pc-foot');
    foot.appendChild(button('关闭', 'health-close', 'wxg-pc-nav'));
    foot.appendChild(button('复制这份', 'health-copy', 'wxg-pc-nav'));
    pop.appendChild(foot);
    (lastSectionsHost || document.body).appendChild(pop);
    bindPersonCardDrag(pop);
}

export function setHealthOpen(v) { healthOpen = v; }

export const HEALTH_ACTION_SET = new Set(['health-open', 'health-close']);

export function handleHealthAction(action, target, id, host, isChange, rerender) {
    switch (action) {
                case 'health-open':
                    setHealthOpen(true);
                    renderHealthCard();
                    break;
                case 'health-close':
                    closeHealthCard();
                    break;
                default:
                    break;
    }
}
