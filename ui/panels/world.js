/* 从 ui/sections.js 原样搬出，逻辑一字未改（206 单） */
import { TIERS, viaLabel } from '../../core/config.js'; import { asArray, trimText } from '../../core/utils.js'; import { cardLine, foldCard } from '../card-fold.js'; import { decorateCard } from '../cardgrid.js'; import { getRoster, listWindsView, loadState } from '../../core/state.js'; import { getSettings } from '../../core/settings.js'; import { button, card, el, emptyBlock, field, foldable, line, lockable, row, section, textInput, textarea } from '../sections.js';

export function secWorld(host) {
    const state = loadState();
    const w = state.world;
    const box = section('世界局势',
        '世界局势＝势力的所有碰撞；暗线＝还没浮上台面的事，按阶段走、挂世界钟（不按回合数推，世界钟没到点不许提前冒头）。',
        { open: true, summary: trimText(w.clock) || '世界钟未知' });

    // ⭐ 一次体检的结论：内容得**装进结构**（一个主题一块卡），别平铺在一个大平面上 ⭐ 数据卡：默认只读（复核方第四条）——点「编辑」才能改 ⭐ 页头：右上「功能 ⋮」（照包；跟状态页、名册页同一个做法）
    const wTop = el('div', 'wxg-roster-topbar');
    const wFunc = button('功能 ⋮', 'world-func', 'wxg-btn is-func');
    wFunc.style.height = '28px';
    wFunc.style.minHeight = '28px';
    wFunc.style.lineHeight = '26px';
    wFunc.style.padding = '0 12px';
    wFunc.style.whiteSpace = 'nowrap';
    wTop.appendChild(wFunc);
    box.appendChild(wTop);
    /* ★ P2-7：**面板四分区**——世界总览／人物清单／记忆状态 ✓ */
    box.appendChild(el('div', 'wxg-note wxg-sec-head', '① 世界总览'));
    const cWorld = lockable(card('世界钟・地点'), 'world-clock');
    /* 口径（与 core/config.js 一致）：**世界钟／地点允许写“未知”，其它格不许**；⛔ 在 UI 上教她写“未知”。 */
    line(cWorld, '世界钟', textInput('wxg-world-clock', w.clock, '例：第二天 上午 10:20', 'set-world-clock', 'wxg-short'));
    line(cWorld, '地点', textInput('wxg-world-place', w.place, '例：四夷馆', 'set-world-place', 'wxg-short'));
const wShift = el('div', 'wxg-row');
wShift.appendChild(button('−1 天', 'shift-world-clock', 'wxg-btn-sm', '-1'));
wShift.appendChild(button('+1 天', 'shift-world-clock', 'wxg-btn-sm', '1'));
cWorld.appendChild(wShift);
    line(cWorld, '这个世界现在什么样',
        textarea('wxg-world-big', w.bigPicture, '从高处看一眼：这个世界现在什么样', 'set-world-big', 3));
    /*
     * A6：两列卡片网格。卡不再一条道摊到底，而是并排；每张卡带一句摘要，长的折起来。
     */
    const wgrid = el('div', 'wxg-wgrid');
    box.appendChild(wgrid);   /* A6：先挂上去（否则「世界钟地点卡」会因为整个网格没挂而丢失） */
    wgrid.appendChild(cWorld);

    /*
     * 依据＝阿砚 3 件任务 · 渲染层 #6（四张空卡合并成一行）：
     *   势力／世界事实／脉动／风声 四张卡都是“引擎还没推出来”，各占一个卡位＋虚线大框；
     *   四个空框堆起来就是一屏“没东西”。全空时只留**一行**，有数据才展开。
     */
    const wFactions0 = Array.isArray(w.factions) ? w.factions : [];
    const wFacts0 = Array.isArray(w.facts) ? w.facts : [];
    const wPulse0 = (w.pulse && typeof w.pulse === 'object') ? w.pulse : {};
    const wPulseDom0 = Array.isArray(wPulse0.domains) ? wPulse0.domains : [];
    const wPulseCov0 = (wPulse0.coverage && Array.isArray(wPulse0.coverage.entries)) ? wPulse0.coverage.entries : [];
    const wWinds0 = Array.isArray(w.winds) ? w.winds.filter((x) => x && (trimText(x.topic) || trimText(x.text))) : [];
    /*
     * 六（阿砚件 7）：世界事实／脉动／风声 三张“引擎还没推出来”的卡，各占一格就是三块空白。
     *   ⇒ 三张都空时，把三张**装进一条折叠条**（标题写清楚、点开才看到分区）；有数据才各自展开。
     *   势力那张是独立实体，⛔ 不并进来。
     */
    const engineEmpty = !wFacts0.length && !wPulseDom0.length && !wPulseCov0.length && !wWinds0.length;
    const engineFold = engineEmpty
        ? foldable('引擎还没推出来的（世界事实／脉动／风声）', false)
        : null;
    const worldCardsEmpty = !wFactions0.length && !wFacts0.length
        && !wPulseDom0.length && !wPulseCov0.length && !wWinds0.length;
    if (worldCardsEmpty) {
        box.appendChild(emptyBlock('世界事实／脉动／风声 —— 还没有内容（引擎推出来才会展开）', '为什么会自动有：你发消息后引擎会推一次，把硬事实、压力、风声落进来。如果一直为空，先看总控「入口与启动」里自动更新有没有开着。'));
    }
    /* ★ [580] C1：势力厚度在面板上看得见（只读；改走世界步回写，⛕ 卡头再放一颗编辑） */
    const cFac = card('势力（在册）');
    const facList = Array.isArray(w.factions) ? w.factions : [];
    if (!facList.length) {
        cFac.appendChild(emptyBlock('还没有势力（从世界书读人时会一起落进来）'));
    } else {
        const fl = el('div', 'wxg-list');
        for (const f of facList) {
            const r = el('div', 'wxg-r');
            const main = el('div', 'wxg-r-main');
            const title = el('div', 'wxg-r-title');
            title.appendChild(el('span', 'wxg-r-who', trimText(f.name) || '未记名'));
            /* 依据＝渲染层 #2（显示层）：没写就**不印这个胶囊**，⛔ 拿“稳固”“中立”凑 */
            if (trimText(f.status)) {
                title.appendChild(el('span', 'wxg-badge is-info', trimText(f.status)));
            }
            if (trimText(f.relation)) {
                title.appendChild(el('span', 'wxg-badge is-soft', trimText(f.relation)));
            }
            main.appendChild(title);
            const bits = [];
            if (trimText(f.scale)) { bits.push('规模：' + trimText(f.scale)); }
            if (trimText(f.core_person)) { bits.push('核心人：' + trimText(f.core_person)); }
            if (trimText(f.scope)) { bits.push('范围：' + trimText(f.scope)); }
            const pillars = Array.isArray(f.powerPillars) ? f.powerPillars.map(trimText).filter(Boolean) : [];
            if (pillars.length) { bits.push('支柱：' + pillars.join('／')); }
            const mem = Array.isArray(f.members) ? f.members.map((m) => trimText(m && m.name)).filter(Boolean) : [];
            if (mem.length) { bits.push('成员：' + mem.join('／')); }
            if (bits.length) { main.appendChild(el('div', 'wxg-r-sub', bits.join(' · '))); }
            const mf = Array.isArray(f.manualFields) ? f.manualFields : [];
            if (mf.length) {
                const says = (f.bookSays && typeof f.bookSays === 'object') ? f.bookSays : {};
                const notes = mf.map((k) => '已手动修改：' + k + (says[k] !== undefined && says[k] !== '' ? '（书里现在是「' + String(Array.isArray(says[k]) ? says[k].join('／') : says[k]) + '」）' : ''));
                main.appendChild(el('div', 'wxg-note', notes.join('；')));
            }
            r.appendChild(main);
            const fa = el('div', 'wxg-r-act');
            fa.appendChild(button('改', 'edit-faction', 'wxg-btn-xs', String(f.id || f.name)));
            fa.appendChild(button('删', 'del-faction', 'wxg-btn-xs', String(f.id || f.name)));
            r.appendChild(fa);
            fl.appendChild(r);
        }
        cFac.appendChild(fl);
    }
    if (!worldCardsEmpty) {
        const facAdd = el('div', 'wxg-card-actions');
        facAdd.appendChild(button('＋新增势力', 'add-faction', 'wxg-btn-xs'));
        cFac.appendChild(facAdd);
        decorateCard({ el: el, box: cFac, summaryText: wFactions0.length ? (String(wFactions0.length) + ' 个在册') : '' });
        wgrid.appendChild(cFac);
    }
    /* ★ [580] A3：世界事实键值账（只读；给她核对引擎对齐用，⛔ 不当注入叙述） */
    const cFacts = card('世界事实（键值）');
    const factList = Array.isArray(w.facts) ? w.facts : [];
    if (!factList.length) {
        cFacts.appendChild(emptyBlock('还没有键值事实（世界步带回硬事实变更时会落进来）'));
    } else {
        const fl2 = el('div', 'wxg-list');
        for (const f of factList.slice(0, 40)) {
            const r = el('div', 'wxg-r');
            const main = el('div', 'wxg-r-main');
            const title = el('div', 'wxg-r-title');
            title.appendChild(el('span', 'wxg-r-who', (trimText(f.subject) || '世界') + '｜' + (trimText(f.field) || '—')));
            if (trimText(f.source)) {
                title.appendChild(el('span', 'wxg-badge is-soft', trimText(f.source)));
            }
            main.appendChild(title);
            main.appendChild(el('div', 'wxg-r-sub', trimText(f.value) || '（空）'));
            r.appendChild(main);
            fl2.appendChild(r);
        }
        cFacts.appendChild(fl2);
        if (factList.length > 40) {
            cFacts.appendChild(el('div', 'wxg-note', '共 ' + String(factList.length) + ' 条，面板只列最近 40 条'));
        }
    }
    if (!worldCardsEmpty) {
        decorateCard({ el: el, box: cFacts, summaryText: wFacts0.length ? (String(wFacts0.length) + ' 条硬事实') : '' });
        if (engineFold) { engineFold.appendChild(cFacts); } else { wgrid.appendChild(cFacts); }
    /* 世界钟与地点下面的卡片都进网格（A6） */
    }
    /* ★ [580] A4：独立脉动＋巡查覆盖（只读；与局势并行，可看镜头外） */
    const cPulse = card('世界脉动（域／巡查）');
    const pul = (w.pulse && typeof w.pulse === 'object') ? w.pulse : { domains: [], coverage: { entries: [] } };
    const domList = Array.isArray(pul.domains) ? pul.domains : [];
    const covList = (pul.coverage && Array.isArray(pul.coverage.entries)) ? pul.coverage.entries : [];
    if (!domList.length && !covList.length) {
        cPulse.appendChild(emptyBlock('还没有脉动域（世界步可带回镜头外的压力／巡查）'));
    } else {
        if (domList.length) {
            cPulse.appendChild(el('div', 'wxg-note', '域（' + String(domList.length) + '）'));
            const dl = el('div', 'wxg-list');
            for (const d of domList.slice(0, 24)) {
                const r = el('div', 'wxg-r');
                const main = el('div', 'wxg-r-main');
                const title = el('div', 'wxg-r-title');
                title.appendChild(el('span', 'wxg-r-who', trimText(d.label) || '未记名'));
                if (trimText(d.kind) && trimText(d.kind) !== 'other') {
                    title.appendChild(el('span', 'wxg-badge is-soft', trimText(d.kind)));
                }
                title.appendChild(el('span', 'wxg-badge is-info', '压' + String(Number.isFinite(Number(d.pressure)) ? Number(d.pressure) : 0)));
                if (trimText(d.trend)) { title.appendChild(el('span', 'wxg-badge is-soft', trimText(d.trend))); }
                if (trimText(d.visibility)) { title.appendChild(el('span', 'wxg-badge is-off', trimText(d.visibility))); }
                main.appendChild(title);
                const bits = [];
                if (trimText(d.scope)) { bits.push('范围：' + trimText(d.scope)); }
                if (trimText(d.state)) { bits.push(trimText(d.state)); }
                if (trimText(d.evidence)) { bits.push('证：' + trimText(d.evidence)); }
                main.appendChild(el('div', 'wxg-r-sub', bits.join(' · ') || '（尚无正文）'));
                r.appendChild(main);
                dl.appendChild(r);
            }
            cPulse.appendChild(dl);
        }
        if (covList.length) {
            cPulse.appendChild(el('div', 'wxg-note', '最近巡查（' + String(covList.length) + '）'));
            const cl = el('div', 'wxg-list');
            for (const e of covList.slice(0, 16)) {
                const r = el('div', 'wxg-r');
                const main = el('div', 'wxg-r-main');
                const title = el('div', 'wxg-r-title');
                title.appendChild(el('span', 'wxg-r-who', trimText(e.label) || '未记名'));
                if (trimText(e.kind) && trimText(e.kind) !== 'general') {
                    title.appendChild(el('span', 'wxg-badge is-soft', trimText(e.kind)));
                }
                title.appendChild(el('span', 'wxg-badge is-soft', '×' + String(Math.max(1, Number(e.checks) || 1))));
                main.appendChild(title);
                main.appendChild(el('div', 'wxg-r-sub', trimText(e.scope) || '范围未标'));
                r.appendChild(main);
                cl.appendChild(r);
            }
            cPulse.appendChild(cl);
        }
    }
    if (!worldCardsEmpty) {
        decorateCard({ el: el, box: cPulse, summaryText: wPulseDom0.length ? (String(wPulseDom0.length) + ' 个脉动域') : '' });
        if (engineFold) { engineFold.appendChild(cPulse); } else { wgrid.appendChild(cPulse); }
    }
    /* ★ [580] C3：风声＝未证实公开传闻（对齐 A1 trace；账＋局势／事件派生，去重） */
    const cWinds = card('风声与已公开');
    {
        /* 102：已公开组（publicity=public）；⛔ 不展开论坛 */
    const pubNews = (w.situations || []).filter((s2) => s2 && s2.publicity === 'public').slice(0, 6);
    if (pubNews.length) {
        const nl = el('div', 'wxg-list');
        for (const n2 of pubNews) {
            const rr = el('div', 'wxg-r');
            const mm = el('div', 'wxg-r-main');
            const tt2 = el('div', 'wxg-r-title');
            tt2.appendChild(el('span', 'wxg-r-who', trimText(n2.title) || '（未记题）'));
            tt2.appendChild(el('span', 'wxg-badge is-info', '已公开'));
            mm.appendChild(tt2);
            mm.appendChild(el('div', 'wxg-r-sub', (trimText(n2.publicTrace || n2.public_trace) || '公共传播') + ' ｜ 热度 ' + String(Math.max(1, Math.min(3, Number(n2.pressure) || 1)))));
            rr.appendChild(mm);
            nl.appendChild(rr);
        }
        cWinds.appendChild(el('div', 'wxg-note', '【已公开】'));
        cWinds.appendChild(nl);
    }
    const windList = listWindsView(24);
        if (!windList.length) {
            cWinds.appendChild(emptyBlock('还没有风声（局势标 trace、或世界步带回 winds 时会落进来）'));
        } else {
            const wl = el('div', 'wxg-list');
            for (const x of windList) {
                const r = el('div', 'wxg-r');
                const main = el('div', 'wxg-r-main');
                const title = el('div', 'wxg-r-title');
                title.appendChild(el('span', 'wxg-r-who', trimText(x.topic) || '（未记题）'));
                title.appendChild(el('span', 'wxg-badge is-soft', trimText(x.kind) || 'rumor'));
                const via = trimText(x.via);
                const viaLab = viaLabel(trimText(x.via));   /* I4：痕迹来源同一张表 */
                title.appendChild(el('span', viaLab === '风声账' ? 'wxg-badge is-off' : 'wxg-badge is-info', viaLab));
                main.appendChild(title);
                main.appendChild(el('div', 'wxg-r-sub', trimText(x.text) || '（空）'));
                r.appendChild(main);
                wl.appendChild(r);
            }
            cWinds.appendChild(wl);
            cWinds.appendChild(el('div', 'wxg-note', '未证实传闻；⛔ 别当成已公开新闻。与 visibility=trace 对齐，同题只列一次。'));
        }
    }
    if (!worldCardsEmpty) {
        decorateCard({ el: el, box: cWinds, summaryText: wWinds0.length ? (String(wWinds0.length) + ' 条风声') : '' });
        if (engineFold) { engineFold.appendChild(cWinds); } else { wgrid.appendChild(cWinds); }
        /* 六：三张“引擎还没推出来”的卡合成一条折叠条（有数据时才各自展开） */
        if (engineFold) { wgrid.appendChild(engineFold); }
    }
    /*
     * ⭐ 局势／暗线这两张卡**不套 `lockable`**（照 `[321]`：「有悬浮框的旁边不需要编辑」）。
     *   `lockable` 会在卡头右上加一颗「编辑」并把卡标成 `is-locked`；
     *   不套它 ⇒ 无那颗钮、也没有 `is-locked`（**内容照常可见**）。
     *   ⚙️ 编辑走**点行弹出的浮层右上 ⋮**（`open-world-entry`／`we-edit`）✓
     */
    const cSit = card('局势（势力的碰撞）');
    const sit = el('div', 'wxg-list');
    if (!w.situations.length) {
        sit.appendChild(emptyBlock('还没有局势记录（点「立刻更新」让引擎算一次）'));
    } else {
        // ⭐ 局势也能手改（条 22）：她看得见就该能改——改字、换火候、删掉，都行 ⭐ 行化：`火候胶囊 ｜ 局势名 ＋ 哪几方 ｜ 右侧改 ＋ 删`（一行一条）
        w.situations.forEach((item, idx) => {
            const r = el('div', 'wxg-r is-rowlink');
            /*
             * ⭐ 点行开浮层（照目标包）。
             *   ⚠️ 用**自己的类名** `is-rowlink`，⛔ 蹭 `.is-click`：
             *     `.wxg-r.is-click` 带着一条老规矩 `grid-template-columns: 1fr auto`
             *     （那是给名册行用的两列）⇒ 套上它会把本行变成两列
             *     （胶囊被拉成通栏、「删」掉到下一行）——真机截图里我看到了。
             *   ⛔ 行内展开编辑也撤了（她 01:33 划：那种"连框都没有"的行内小控件不要）
             *   —— 编辑一律从浮层右上 ⋮ 进。
             *   ⚠️ 行里的下拉/按钮各自有 data-action ⇒ closest 会先命中它们（点控件不会误开浮层）。
             */
            r.setAttribute('data-action', 'open-world-entry');
            r.setAttribute('data-kind', 'situation');
            r.setAttribute('data-index', String(idx));
            const tierW = el('span', 'wxg-badge ' + (trimText(item.tier) === TIERS[0] ? 'is-warn' : 'is-info'),
                trimText(item.tier) || '几天内');
            r.appendChild(tierW);
            const main = el('div', 'wxg-r-main');
            const title = el('div', 'wxg-r-title');
            title.appendChild(el('span', 'wxg-r-who', trimText(item.title) || '未记名'));
            if (item.manual) {
                title.appendChild(el('span', 'wxg-badge is-warn', '已手动修改'));
            }
            /* ★ P2-7：**引擎推的 / 书里写着的 / 你改的**——三者分开显示 ✓ */
            {
                const srcTag = (item.source === 'book') ? '书里写着的'
                    : (item.source === 'manual') ? '你改的' : '引擎推的';
                title.appendChild(el('span', 'wxg-badge is-soft', srcTag));
            }
            main.appendChild(title);
            main.appendChild(el('div', 'wxg-r-sub', '哪几方：' + (trimText(item.sides) || '暂无')));
            r.appendChild(main);
            const act = el('div', 'wxg-r-act');
            /*
             * ⛔ 行内那颗「改」**撤了**（照目标包：她 01:33 划的原则——那种"连框都没有"的
             *   行内小控件不要；**编辑一律从浮层右上 ⋮ 进**）。
             *   行本身可点（`open-world-entry`）⇒ 点一下弹浮层，那里改。
             * ✅ 只留「删」：它是**减少**类操作，摆行上最直接，且浮层里再放一个反而绕。
             */
            const del = button('删', 'del-situation', 'wxg-btn-xs');
            del.setAttribute('data-index', String(idx));
            act.appendChild(del);
            r.appendChild(act);
            sit.appendChild(r);
        });
    }
    cSit.appendChild(sit);
    const addSitRow = row(cSit,
        textInput('wxg-new-situation', '', '自己加一条局势（例：商会与教会在争港口税）', 'noop', 'wxg-short'),
        button('加一条局势', 'add-situation', 'wxg-primary'));
    if (addSitRow.classList && typeof addSitRow.classList.add === 'function') {
        addSitRow.classList.add('wxg-add-row');
    } else {
        addSitRow.className += ' wxg-add-row';
    }
    addSitRow.setAttribute('data-no-lock', '1');
    box.appendChild(cSit);
    // 同上：暗线卡也不套 `lockable`（⛔ 卡头留一颗「编辑」）
    /* ③ 人物清单与状态（只给汇总＋入口，⛔ 在这里再列一遍名册） */
    box.appendChild(el('div', 'wxg-note wxg-sec-head', '② 人物清单与状态'));
    const cPeople = card('人物');
    {
        const rosterAll = getRoster();
        /* ★ [580] A7：在场记录看 presentFloor（正文在场），不是 lastSeenFloor（后台推演也会写） */
        const onStageN = rosterAll.filter((c) => c
            && Number.isFinite(Number(c.presentFloor)) && Number(c.presentFloor) >= 0).length;
        cPeople.appendChild(el('div', 'wxg-note', '在册 ' + String(rosterAll.length) + ' 人；有过正文在场 ' + String(onStageN) + ' 人。状态与过去经历在名册里逐人看。'));
        row(cPeople, button('去人物名册', 'goto-roster'));
    }
    box.appendChild(cPeople);
    /* ⑤ 记忆状态（只给数字与容量，⛔ 把正文搬进来 ✗） */
    box.appendChild(el('div', 'wxg-note wxg-sec-head', '③ 记忆状态'));
    const cMem = card('记忆');
    {
        const st2 = loadState();
        const chronN = (st2.chronicle || []).length;
        const tombN = (st2.world.hiddenTombstones || []).length;
        const atF = Number((st2.pipeline || {}).atFloor);
        const luF = Number((st2.lastUpdate || {}).floor);
        cMem.appendChild(el('div', 'wxg-note',
            '编年 ' + String(chronN) + ' 条（容量锁 ' + String(getSettings().capChronicle) + '）'
            + '；暗线碑 ' + String(tombN) + ' 条'
            + '；上次更新停在第 ' + String(Number.isFinite(luF) ? luF : -1) + ' 楼'
            + '（流水锚点第 ' + String(Number.isFinite(atF) ? atF : -1) + ' 楼）。'));
    }
    box.appendChild(cMem);
    /* 74：世界状态页每张卡默认只给标题行 */
    const stW = loadState();
    for (const c of asArray(box.querySelectorAll('.wxg-card'))) {
        foldCard({ card: c, doc: document, line: cardLine((c.querySelector('.wxg-card-h') || {}).textContent || '', stW) });
    }
    host.appendChild(box);







}
