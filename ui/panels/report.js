/* 从 ui/sections.js 原样搬出，逻辑一字未改（206 单） */
import { FLOOR_NOTE, asText, countChars, floorLabel, trimText } from '../../core/utils.js'; import { loadState, recentRecallRecords } from '../../core/state.js'; import { receiptText } from '../../core/ledger.js'; import { renderRunWarn } from '../runwarn-view.js'; import { runWarning } from '../../core/runwarn.js'; import { toast } from '../toast.js'; import { renderRecordCard } from '../sections.js'; import { openRecordAt, reportFilter } from './shared.js'; import { shortTime } from './shared.js'; import { button, card, el, foldable, row, section } from './shared.js';

export function secReport(host, intoBox) {
    const list = recentRecallRecords(20);
    const box = intoBox || section('过程报告 · 每轮到底注入了什么', '每轮注入了什么，可回看',
        { open: false });
    const noteText = '按时间从新到旧：① 怎么挑的 ② 实际送进请求的内容一字不差（可复制）'
        + '③ 回执（成没成、多少字、什么身份、为什么没注入）。（' + FLOOR_NOTE + '）';
    if (!list.length) {
        /*
         * ⚠️ 空的时候**也要有标题**（并页之后更明显）：原来整块都不画 ⇒
         *    她在「状态」页上根本不知道这儿将来会出一条"每轮记录"。
         *    现在就一句「还没有记录」，标题留着。
         */
        const cEmpty = card('每轮记录');
        cEmpty.appendChild(el('div', 'wxg-note', noteText));
        cEmpty.appendChild(el('div', 'wxg-empty', '还没有记录：发一条消息、正文生成之后就会有了。'
        + '如果发过了还是没有，去「自定义 API」看通道与地址填了没。'));
        box.appendChild(cEmpty);
        if (!intoBox) {
            host.appendChild(box);
        }
        return;
    }
    /* 必修 9：这一轮没进账就在卡头下面放红条（⛔ toast／⛔ 埋在列表里）；画法在 ui/runwarn-view.js */
    try {
        renderRunWarn({ box: box, warn: runWarning(loadState()), el: el, doc: document });
    } catch (eWarn) { /* 红条画不出来也不能拦着这页 */ }
    /*
     * ⭐ 有数据排版术：顶部一排**筛选胶囊带计数**（这一页天生带状态：成没成／注入没注入），
     *    每条的状态做成**胶囊**（原来埋在文字里，"哪条没成"得逐字读）。
     */
    const statusOf = (r) => (r.injectStatus === 'ok' ? '已注入'
        : (r.injectStatus === 'empty' ? '未注入' : (r.injectStatus === 'error' ? '失败' : '待送')));
    const statusTone = (r) => (r.injectStatus === 'ok' ? 'is-ok'
        : (r.injectStatus === 'error' ? 'is-warn' : 'is-off'));
    const shownList = reportFilter === 'all' ? list : list.filter((r) => statusOf(r) === reportFilter);
    const fbar = el('div', 'wxg-filters');
    const mkF = (key, label, n) => {
        const b = el('button', 'wxg-filter' + (reportFilter === key ? ' is-on' : ''), label);
        b.type = 'button';
        b.setAttribute('data-action', 'report-filter');
        b.setAttribute('data-id', key);
        b.appendChild(el('span', 'wxg-filter-n', String(n)));
        return b;
    };
    fbar.appendChild(mkF('all', '全部', list.length));
    for (const st of ['已注入', '未注入', '失败']) {
        const n = list.filter((r) => statusOf(r) === st).length;
        if (n) {
            fbar.appendChild(mkF(st, st, n));
        }
    }
    const cRep = card('每轮记录（从新到旧）');
    cRep.appendChild(el('div', 'wxg-note', noteText));
    cRep.appendChild(fbar);
    for (let idx = 0; idx < shownList.length; idx += 1) {
        const rec = shownList[idx];
        const shownChars = countChars(rec.injectedText);
        const statusText = statusOf(rec);
        /* ⭐ LY8（材料 11）：传空字符串就不加展开箭头 ⇒ 整行看不出可点 ✗
     *   现在传一个空格（有值但不显字 ✓）⇒ chevron 会加上 ✓ */
    const det = foldable(' ', false);
        if (det.classList) {
            det.classList.add('is-row');
        }
        const sum = det.querySelector('summary');
        if (sum) {
            sum.textContent = '';
            sum.appendChild(el('span', 'wxg-r-k wxg-num', shortTime(rec.at)));
            sum.appendChild(el('span', 'wxg-badge ' + statusTone(rec), statusText));
            sum.appendChild(el('span', 'wxg-note', floorLabel(rec.floor)
                + (rec.injectStatus === 'ok' ? ' · ' + String(shownChars) + ' 字' : '')));
            sum.appendChild(el('span', 'wxg-r-who', rec.chars && rec.chars.length
                    ? rec.chars.map((x) => trimText(x && x.name) || trimText(x)).filter(Boolean).join('、')
                    : '暂无'));   /* 86：对象数组直接 join 会出 [object Object] */
        }
        const body = el('div', 'wxg-report-body');
        body.appendChild(el('div', 'wxg-report-h', '① 怎么挑的'));
        const lead = trimText(rec.lead);
        body.appendChild(el('div', 'wxg-fact', '你这条发言：' + (lead ? (lead.length > 80 ? lead.slice(0, 80) + '…' : lead) : '（没记到）')));
        if (Array.isArray(rec.items) && rec.items.length) {
            for (const item of rec.items) {
                const c = item && item.character ? item.character : {};
                const bits = [trimText(c.name) || '未记名', '理由：' + (trimText(item.reason) || '暂无')];
                const has = [];
                has.push(trimText(c.affinity) ? '好感 ' + trimText(c.affinity) : '好感未建立');
                if (trimText(c.identity)) {
                    has.push('身份 ' + trimText(c.identity));
                }
                if (trimText(c.current)) {
                    has.push('正在经历');
                }
                if (Array.isArray(c.past) && c.past.length) {
                    has.push('过去经历 ' + String(c.past.length) + ' 条');
                }
                bits.push('带了：' + has.join('、'));
                if (item.protected) {
                    bits.push('现场保护（不重复推演）');
                }
                body.appendChild(el('div', 'wxg-fact', '· ' + bits.join(' ｜ ')));
            }
        } else {
            body.appendChild(el('div', 'wxg-empty', '本轮没有召回任何人'));
        }
        if (Array.isArray(rec.events) && rec.events.length) {
            body.appendChild(el('div', 'wxg-report-h', '本轮带上的世界事件'));
            for (const ev of rec.events) {
                body.appendChild(el('div', 'wxg-fact', '· ' + (trimText(ev.title) || '') + (trimText(ev.text) ? '：' + trimText(ev.text) : '')));
            }
        }
        if (Array.isArray(rec.notes) && rec.notes.length) {
            body.appendChild(el('div', 'wxg-notes', '说明：' + rec.notes.join('；')));
        }
        if (Array.isArray(rec.conflicts) && rec.conflicts.length) {
            body.appendChild(el('div', 'wxg-report-h', '⚠️ 这一轮更新时与你的手改冲突'));
            body.appendChild(el('div', 'wxg-notes', '引擎按**你的版本**保留，没冲掉你改的字：'));
            for (const c of rec.conflicts) {
                body.appendChild(el('div', 'wxg-fact', '· ' + asText(c)));
            }
        }
        body.appendChild(el('div', 'wxg-report-h', '② 实际送进请求的内容'));
        const text = trimText(rec.injectedText);
        if (text) {
            body.appendChild(el('pre', 'wxg-report-text', text));
            const bar = el('div', 'wxg-row');
            const key = 'rec-' + String(rec.floor) + '-' + String(rec.at);
            bar.appendChild(button('复制这段', 'copy-text', 'wxg-btn-sm', key));
            bar.appendChild(el('span', 'wxg-note', '这段只进请求、不落正文。'));
            body.appendChild(bar);
            const holder = el('div', 'wxg-hidden-text', text);
            holder.id = 'wxg-text-' + key;
            holder.style.display = 'none';
            body.appendChild(holder);
        } else {
            body.appendChild(el('div', 'wxg-empty', '本轮没有内容送进去'));
        }
        body.appendChild(el('div', 'wxg-report-h', '③ 回执'));
        body.appendChild(el('div', 'wxg-fact', receiptText(rec)));
        if (trimText(rec.injectType)) {
            body.appendChild(el('div', 'wxg-notes', '触发方式：' + trimText(rec.injectType)));
        }
        /*
         * ⭐ 补②「送达回执」：**发出去了 ≠ 正文接到了**。这一行就是那后半句。
         *   · 已进正文（#N）／候补（第 k/3 轮没进）／已转编年（不再占注入位）
         *   ⛔ 只如实报，不替正文辩解；没标记的老记录就写「还没核过」。
         */
        const arriveLine = trimText(rec.arrivedNote)
            || (rec.injectStatus === 'ok' ? '还没核过（下次更新时会对着正文核一遍）' : '');
        if (arriveLine) {
            const aRow = el('div', 'wxg-notes', '送达：' + arriveLine);
            if (rec.archived === true) {
                aRow.setAttribute('data-tone', 'bad');
            }
            body.appendChild(aRow);
        }
        det.appendChild(body);
        /*
         * ⭐ 点行弹浮层（照目标包：跟名册那件**同一套手法**）。
         *   做法刻意保守：**正文那 ①②③ 一个字没改**——原来拼进 `det`（行内折叠条），
         *   现在**把它整块搬进浮层**（DOM 搬移），所以不存在"浮层里跟行内不一样"。
         *   ⛔ 没开任何一条时，行为跟以前一模一样（照旧挂回列表）。
         */
        /* Q2（材料 05）：**先把行挂上（永远挂 ✓）**，再决定要不要弹浮层 ✓
         *   旧：只有 else 才 appendChild ✗ ⇒ 开浮层时那一行从列表里消失 ✗（与人物名册不一致 ✗） */
        if (sum) {
            sum.setAttribute('data-action', 'open-record');
            sum.setAttribute('data-id', String(idx));
        }
        cRep.appendChild(det);
        if (openRecordAt === idx) {
            renderRecordCard(rec, body, idx, shownList.length, statusText, statusTone(rec), shownChars);
        }
    }
    box.appendChild(cRep);
    if (!intoBox) {
        host.appendChild(box);
    }


}
