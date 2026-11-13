/* 名-3 人物卡：personCard 状态＋浮层渲染。从 sections.js 抽出（206 后） */
import { el, button, card, checkbox, field, foldable, line, row, select, textInput, textarea, bindPersonCardDrag, lastSectionsHost } from './shared.js';
import { ROLES, getRoster, loadState, findCharacter, updateCharacter, addKnow, removeKnow, pushPast } from '../../core/state.js';
import { toast } from '../toast.js';
import { floorLabel, trimText, toList } from '../../core/utils.js';
import { dueToAbsoluteMinute } from '../../core/clock.js';
import { scheduleCardRerender } from './render.js';
import { bindEscClose, unbindEscClose } from '../esc-close.js';
import { scheduleBadge } from '../../core/schedule.js';
import { questStats } from '../../core/summary.js';


export let personCardId = null;
export let personCardEditing = false;
export let personCardTab = 'now';

/**
 * ⭐ 「每轮记录」点开的是第几条（-1＝都没开）。
 *   照目标包：点行弹浮层，**跟名册那件同一套手法**（⛔ 行内展开）。
 */

/**
 * ★ 20261022 §五 5（真）：**浮层按 Esc 要能关**。
 *   只挂一次全局监听（⛔ 每开一次就挂一个）。
 */
/*
 * Esc 关人物浮层：挂一次全局监听（TW 契约：配对清理）。
 *   实现搬到 `ui/esc-close.js`（主文件贴着 8200 行硬线）；这里只管“现在有没有开着的卡”。
 */
let personCardEscBound = false;
export function bindPersonCardEsc() {
    if (personCardEscBound) { return; }
    bindEscClose({
        isActive: () => Boolean(personCardId),
        onEsc: () => closePersonCard(),
    });
    personCardEscBound = true;
}

/** 卸掉 Esc 监听（停用／卸载时调） */
export function unbindPersonCardEsc() {
    unbindEscClose();
    personCardEscBound = false;
}

export function openPersonCard(id) {
    personCardId = id || null;
    personCardEditing = false;   // 开卡／换人：一律先回到**只读**态
    personCardTab = 'now';
    bindPersonCardEsc();
    renderPersonCard();
}

export function closePersonCard() {
    personCardId = null;
    personCardEditing = false;
    const old = document.getElementById('wxg-person-card');
    if (old && typeof old.remove === 'function') {
        old.remove();
    }
}

/** 把浮层画出来（挂在 body 上＝真浮层，⛔ 不塞进段里免得被重画冲掉） */
export function renderPersonCard() {
    const host = document.getElementById('wxg-person-card');
    if (host && typeof host.remove === 'function') {
        host.remove();
    }
    if (!personCardId) {
        return;
    }
    const roster = getRoster();
    const at = roster.findIndex((c) => c.id === personCardId);
    if (at < 0) {
        personCardId = null;
        return;
    }
    const c = roster[at];
    const one = findCharacter(personCardId) || c;

    const pop = el('div', 'wxg-pc wanxiangge');
    pop.id = 'wxg-person-card';
    pop.setAttribute('role', 'dialog');

    const head = el('div', 'wxg-pc-head');
    head.appendChild(el('span', 'wxg-pc-grip', '⠿'));
    const who = el('div', 'wxg-pc-who');
    who.appendChild(el('div', 'wxg-pc-name', c.name || '（没名字）'));
    who.appendChild(el('div', 'wxg-pc-alias', '别名 · ' + (one.aliases && one.aliases.length ? one.aliases.join('、') : '暂无')));
    head.appendChild(who);
    const badges = el('div', 'wxg-pc-badges');
    if (one.inScene) {
        badges.appendChild(el('span', 'wxg-badge is-ok', '在场'));
    }
    /* ★ [580] A7：在场原料一眼可见 */
    if (Number.isFinite(Number(one.presentFloor)) && Number(one.presentFloor) >= 0) {
        badges.appendChild(el('span', 'wxg-badge is-soft', '在场楼 #' + String(one.presentFloor)));
    }
    {
        const rel = Number.isFinite(Number(one.relevance)) ? Number(one.relevance) : 1;
        const relBadge = el('span', 'wxg-badge is-soft', '相关度 ' + String(rel) + '/3');
    relBadge.title = '相关度：当前正文提到他的强弱，从 0（没提到）到 3（正在跟他对戏）';   /* 六-4：1/3 是什么要能问到 */
    badges.appendChild(relBadge);
    }
    if (one.manual) {
        badges.appendChild(el('span', 'wxg-badge is-warn', '已手动修改'));
    }
    if (one.isPlayer) {
        badges.appendChild(el('span', 'wxg-badge is-info', '玩家棋子'));
    }
    head.appendChild(badges);
    const kebab = button('⋮', 'card-edit', 'wxg-pc-kebab');
    kebab.title = personCardEditing ? '正在编辑（点一下收起）' : '编辑这一位（点了才可改，不点只读）';
    head.appendChild(kebab);
    const x = button('×', 'card-close', 'wxg-pc-x');
    x.title = '关掉（Esc 也行）';
    head.appendChild(x);
    pop.appendChild(head);

    const sec1 = el('div', 'wxg-pc-sec');
    sec1.appendChild(el('div', 'wxg-pc-sech', '基础信息'));
    const kv = el('div', 'wxg-pc-kv');
    const row2 = (k1, f1, ph1, k2, f2, ph2) => {
        kv.appendChild(el('div', 'wxg-pc-k', k1));
        kv.appendChild(fieldBox(cid, f1, one[f1], ph1));
        kv.appendChild(el('div', 'wxg-pc-k', k2));
        const shown = f2 === 'identity'
            ? ((Array.isArray(one.identities) && one.identities.length) ? one.identities.join('；') : one[f2])
            : (f2 === 'affinity'
                ? (function () { const r = ((loadState().affinityTable) || []).filter((x) => x && x.name === one.name)[0]; return (r && trimText(r.affinity)) || one[f2]; })()
                : one[f2]);
        kv.appendChild(fieldBox(cid, f2, shown, ph2));
    };
    /*
     * ⚠️ 一律用 **state 那份**的 id（`one.id`）去挂 data-id：
     *   名册那份（`c.id`）跟 state 那份**类型可能不一样**（数字 vs 字符串），
     *   而外面点这些格子的人（用例、以后的代码）拿的是 state 那份 ⇒ 不一致就"找不到输入框"。
     */
    const cid = one.id !== undefined && one.id !== null ? one.id : c.id;

    row2('年龄', 'age', '—', '身份', 'identity', '—');
    row2('所在势力', 'faction', '—', '好感', 'affinity', '—');   /* 六-3：内部状态词不印给她 */
    /* ★ B1（六档名册）：档位可看可改，改了记手改锁 ✓ */
    {
        kv.appendChild(el('div', 'wxg-pc-k', '档位'));
        const roleNow = trimText(one.role);
        const roleSel = select('wxg-pc-role-' + cid, ROLES.map((r) => ({ value: r, label: r })), roleNow, 'set-role', cid);
        roleSel.setAttribute('data-id', cid);
        kv.appendChild(roleSel);
    }
    /* ★ 她 22:2x 点头加的两格（事实，不是表演层）✓ */
    row2('认知账（他会怎么做）', 'behaviorBounds', '（还没记）', '知识面（他不知道什么）', 'knowledgeBounds', '（还没记）');   /* 六-1：⛔ 拿字段名当内容 */
    /*
     * ⭐ 别名／玩家棋子也放进来。
     * ⚠️ 它们原来只在**行内展开**里（`set-alias` / `set-player`）——把行改成开浮层之后
     *    那两个开关就摸不到了（audit-3 当场红了 4 条）⇒ 补进浮层，动作名沿用同一套。
     */
    kv.appendChild(el('div', 'wxg-pc-k', '别名'));
    const aliasWrap = el('div', 'wxg-pc-v');
    aliasWrap.classList.add('wxg-pc-full');
    if (!personCardEditing) {
        const al = (one.aliases || []).join('、');
        aliasWrap.appendChild(el('div', 'wxg-pc-text' + (al ? '' : ' is-empty'), al || '暂无'));
    } else {
        const aliasInput = textInput('wxg-pc-alias-' + cid, (one.aliases || []).join('、'),
            '别名／昵称（顿号或逗号分开）', 'set-alias');
        aliasInput.setAttribute('data-id', cid);
        aliasWrap.appendChild(aliasInput);
    }
    kv.appendChild(aliasWrap);
    const pbox = el('label', 'wxg-pc-player');
    const pchk = el('input', null);
    pchk.type = 'checkbox';
    pchk.checked = one.isPlayer === true;
    pchk.setAttribute('data-action', 'set-player');
    pchk.setAttribute('data-id', cid);
    pbox.appendChild(pchk);
    pbox.appendChild(el('span', null, '这是玩家棋子（AI 不扮演、不推演）'));
    kv.appendChild(el('div', 'wxg-pc-k', ''));
    const pwrap = el('div', 'wxg-pc-v');
    pwrap.classList.add('wxg-pc-full');
    pwrap.appendChild(pbox);
    kv.appendChild(pwrap);

    /*
     * ⭐ 补①：「参与后台推演」开关（默认开）。
     *   说人话：**关掉＝后台不再推他**（不占轮转名额）；他仍在名册里，
     *   正文写到他的时候**照旧更新**（现场那套不变）。⛔ 关掉不删任何历史。
     *   ⚠️ 这里**用"关"来描述**（`noBench` 存的是"关"），因为默认是开——
     *     勾选框的措辞要是反的，她会勾错（"勾上＝不推"最容易看反）。
     */
    const bbox = el('label', 'wxg-pc-player');
    const bchk = el('input', null);
    bchk.type = 'checkbox';
    bchk.checked = one.noBench !== true;
    bchk.setAttribute('data-action', 'set-bench');
    bchk.setAttribute('data-id', cid);
    bbox.appendChild(bchk);
    bbox.appendChild(el('span', null, '参与后台推演（不勾＝只在正文写到他时才更新，不占轮转名额）'));
    kv.appendChild(el('div', 'wxg-pc-k', ''));
    const bwrap = el('div', 'wxg-pc-v');
    bwrap.classList.add('wxg-pc-full');
    bwrap.appendChild(bbox);
    kv.appendChild(bwrap);
    kv.appendChild(el('div', 'wxg-pc-k', '当前地点'));
    const tp = fieldBox(cid, 'timePlace', one.timePlace, '未知');
    tp.classList.add('wxg-pc-full');
    kv.appendChild(tp);
    kv.appendChild(el('div', 'wxg-pc-k', '正在经历'));
    const cur = fieldBox(cid, 'current', one.current, '本回合没写他');
    cur.classList.add('wxg-pc-full');
    kv.appendChild(cur);
    sec1.appendChild(kv);
    pop.appendChild(sec1);
    const sec2 = el('div', 'wxg-pc-sec');
    sec2.appendChild(el('div', 'wxg-pc-sech', '过去经历（由近到远，旧的自然淡化）'));
    const past = Array.isArray(one.past) ? one.past.slice(0, 6) : [];
    if (!past.length) {
        sec2.appendChild(el('div', 'wxg-empty', '还没有过去经历（更新几轮就有了）'));
    } else {
        const q = el('div', 'wxg-pc-quote');
        for (const p of past) {
            const line = el('div', null, trimText(p && p.text) || '暂无');
            /*
             * ⭐ 修复单 #36a：**字段名写错了**——
             *   `past[]` 里存的是 `fromFloor`（见 `core/state.js` 的规范），`p.floor` **永远是 undefined**
             *   ⇒ `Number(undefined)` 不是有限数 ⇒ 条件永远不成立 ⇒ **楼号从来没显示过**。
             */
            if (p && Number.isFinite(Number(p.fromFloor)) && Number(p.fromFloor) >= 0) {
                line.insertBefore(el('span', 'wxg-pc-when', floorLabel(p.fromFloor)), line.firstChild);
            }
            /*
             * ⭐ 新增件 1（材料 13）：**过去经历逐条就地改与删** ✓
             *   旧：浮层卡这块**只读** ✗（只有旧角色状态页那份有删与加 ✗）
             *   现在：编辑态下每条带一个就地输入框＋存＋删 ✓
             *   （用**真实下标**定位：`past` 是 slice，用 `one.past.indexOf(p)` 回去对 ✓）
             */
            if (personCardEditing) {
                const ridx = (one.past || []).indexOf(p);
                if (ridx >= 0) {
                    const ep = document.createElement('input');
                    ep.type = 'text';
                    ep.className = 'wxg-pc-input';
                    ep.id = 'wxg-past-edit-' + String(ridx);
                    ep.value = trimText(p && p.text);
                    const sbtn = button('保存', 'past-save', 'wxg-btn-xs', c.id);
                    sbtn.setAttribute('data-idx', String(ridx));
                    const dbtn = button('删', 'past-del', 'wxg-btn-xs', c.id);
                    dbtn.setAttribute('data-idx', String(ridx));
                    line.appendChild(ep);
                    line.appendChild(sbtn);
                    line.appendChild(dbtn);
                }
            }
            q.appendChild(line);
        }
        sec2.appendChild(q);
    }
    pop.appendChild(sec2);
    /*
     * ⭐「不可靠」提醒（原本**只在角色状态页**）——她点名的污染就是这个，得当场说出来。
     *   它本来就是"某个人的某一格不可靠" ⇒ 摆进**这个人的卡片**最合适。
     */
    if (one.currentSuspect) {
        const warnBox = el('div', 'wxg-pc-sec');
        const w = el('div', 'wxg-store', '⚠ 这条「正在经历」引擎判定**不可靠**：'
            + (trimText(one.currentSuspectWhy) || '疑似越界'));
        w.setAttribute('data-tone', 'bad');
        warnBox.appendChild(w);
        pop.appendChild(warnBox);
    }
    /*
     * ⭐ 补③ 认知账（最小形态・第一步）：他**该知道的**清单。
     *   她当初只能靠提示词纪律（"每个角色只知道他自己该知道的"），现在**落成账**。
     *   ⚠️ 本步只做「清单 ＋ 界面可见＋能手加能手删」；
     *     "推演时只喂清单里的"是**第二步**（她允许分两步）。
     */
    const kSec = el('div', 'wxg-pc-sec');
    kSec.appendChild(el('div', 'wxg-pc-sech', '他知道什么（只收发生过的、他碰得到的；**不许编**）'));
    const kList = Array.isArray(one.knows) ? one.knows : [];
    if (!kList.length) {
        kSec.appendChild(el('div', 'wxg-empty', '还没记他知道什么（下面可以手加一条）'));
    } else {
        kList.forEach((k, ki) => {
            const rowK = el('div', 'wxg-fact');
            rowK.appendChild(el('span', 'wxg-badge wxg-badge-soft', trimText(k.source) || '公开'));
            rowK.appendChild(el('span', null, ' ' + trimText(k.text)));
            if (Number(k.floor) >= 0) {
                rowK.appendChild(el('span', 'wxg-note', ' · ' + floorLabel(Number(k.floor))));
            }
            const delK = button('删', 'del-know', 'wxg-btn-xs', cid);
            delK.setAttribute('data-index', String(ki));
            rowK.appendChild(delK);
            kSec.appendChild(rowK);
        });
    }
    const kAdd = el('div', 'wxg-row');
    const kTxt = el('input', 'wxg-pc-input');
    kTxt.type = 'text';
    kTxt.id = 'wxg-know-text';
    kTxt.placeholder = '他知道了什么（一句话）';
    kAdd.appendChild(kTxt);
    const kSrc = select('wxg-know-source', [
        { value: '亲眼', label: '亲眼' },
        { value: '被告知', label: '被告知' },
        { value: '公开', label: '公开' },
    ], '亲眼', 'noop');
    kAdd.appendChild(kSrc);
    const kBtn = button('加一条', 'add-know', 'wxg-btn-sm', cid);
    kAdd.appendChild(kBtn);
    kSec.appendChild(kAdd);
    pop.appendChild(kSec);
    /*
     * ⭐⭐ 材料 06【4】#6：**「日程」整块在人物卡上消失了** ✗
     *   她的原话：把旧「角色状态」页并进浮层卡时，**只搬了八格、认知账和任务，漏搬了 c.schedule** ✗
     *   ⇒ 约好的事（出差几天后回来等）在卡上**看不到也改不了** ✗
     *   现在：把日程块搬回来 ✓（只读展示；改动走后台推演，⛔ 让她手改算账 ✗）
     */
    {
    const sSec = el('div', 'wxg-pc-sec');
    sSec.appendChild(el('div', 'wxg-pc-sech', '日程（约好的事）'));
        if (Array.isArray(one.schedule) && one.schedule.length) {
        for (const s of one.schedule) {
            const sr = el('div', 'wxg-rowitem');
            const sh = el('div', 'wxg-rowname');
            sh.appendChild(el('span', 'wxg-name', trimText(s && (s.what || s.text)) || '（没记名）'));
            if (trimText(s && s.due)) {
                sh.appendChild(el('span', 'wxg-badge wxg-badge-soft', trimText(s.due)));
                if (trimText(s && s.due) && !Number.isFinite(s && s.dueMinute)) {
                    sh.appendChild(el('span', 'wxg-badge is-soft', '没定时间'));
                }
            }
            if (s && s.done === true) {
                sh.appendChild(el('span', 'wxg-badge is-off', '已完成'));
            } else {
                /* 146：日程徽章跟注入同一颗判据（scheduleBadge） */
                const badge = trimText(scheduleBadge(s, Number((loadState().world || {}).clockMinute)));
                if (badge) {
                    sh.appendChild(el('span', 'wxg-badge is-warn', badge.replace(/^【/, '').replace(/】$/, '').replace(/^(?:⚠️|⛔)\s*/, '')));
                }
            }

            sr.appendChild(sh);
            /* ⭐ 新增件 1（材料 13）：**日程也能她自己了结或删掉** ✓（仅编辑态出现 ✓） */
            if (personCardEditing) {
                const acts2 = el('div', 'wxg-rowacts');
                const what2 = trimText(s && (s.what || s.text));
                if (s && s.done !== true) {
                    const doneBtn = button('了结', 'sched-done', 'wxg-btn-xs', c.id);
                    if (doneBtn && doneBtn.setAttribute) { doneBtn.setAttribute('data-what', what2); }
                    acts2.appendChild(doneBtn);
                }
                const delBtn2 = button('删', 'sched-del', 'wxg-btn-xs', c.id);
                if (delBtn2 && delBtn2.setAttribute) { delBtn2.setAttribute('data-what', what2); }
                acts2.appendChild(delBtn2);
                sr.appendChild(acts2);
            }
            sSec.appendChild(sr);
        }
        } else {
            sSec.appendChild(el('div', 'wxg-fact', '还没有约好的事'));
        }
        /* 130-7：添一条日程（仅编辑态） */
        if (personCardEditing) {
            const addRow = el('div', 'wxg-row');
            addRow.appendChild(textInput('wxg-new-sched-what-' + String(cid), '', '约好的事', 'noop', 'wxg-short'));
            addRow.appendChild(textInput('wxg-new-sched-due-' + String(cid), '', '什么时候到点', 'noop', 'wxg-short'));
            addRow.appendChild(button('加一条', 'add-sched', 'wxg-btn-xs', String(cid)));
            sSec.appendChild(addRow);
        }
        pop.appendChild(sSec);
    }

    /*
     * ⭐「任务」块（原本**只在角色状态页**）。
     *   任务是**挂在人身上**的（`c.quests`）⇒ 跟着人走才对。
     *   ⛔ 丢下它：她要能看到"他在追什么"、能改状态、能删。
     */
    if (Array.isArray(one.quests) && one.quests.length) {
        const qSec = el('div', 'wxg-pc-sec');
        const qOpen = one.quests.filter((q) => !['完成', '搁置'].includes(trimText(q.status)));
        const qOver = one.quests.filter((q) => ['完成', '搁置'].includes(trimText(q.status)));
        const qStat = questStats(one.quests);
        qSec.appendChild(el('div', 'wxg-pc-sech', '任务（在追的目标）　共 '
            + String(Number(qStat.main) + Number(qStat.side)) + ' 个'
            + (qOver.length ? '（已结束 ' + String(qOver.length) + '）' : '')));
        const mkQ = (q) => {
            const qr = el('div', 'wxg-rowitem');
            const qh = el('div', 'wxg-rowname');
            qh.appendChild(el('span', 'wxg-badge wxg-badge-soft', trimText(q.kind) === 'main' ? '主线' : '支线'));
            qh.appendChild(el('span', 'wxg-name', trimText(q.title)));
            const st = select('wxg-pcq-' + one.id + '-' + trimText(q.title), [
                { value: '活跃', label: '活跃' },
                { value: '完成', label: '完成' },
                { value: '搁置', label: '搁置' },
            ], trimText(q.status), 'set-quest-status', one.id);
            st.setAttribute('data-title', trimText(q.title));
            st.className = 'wxg-pole wxg-btn-sm';
            qh.appendChild(st);
            const qd = button('删', 'del-quest', 'wxg-btn-sm', one.id);
            qd.setAttribute('data-title', trimText(q.title));
            qh.appendChild(qd);
            qr.appendChild(qh);
            if (trimText(q.note)) {
                qr.appendChild(el('div', 'wxg-fact', trimText(q.note)));
            }
            /* ⭐ 材料 06【4】（对齐）：**浮层卡片里的任务子项也要能勾** ✓
             *   （v0.3.208 只改了名册行那一份 ✗ ⇒ 两处表现不一致 ✗ ⇒ 这里对齐 ✓） */
            if (Array.isArray(q.items) && q.items.length) {
                const qiRow2 = el('div', 'wxg-fact');
                q.items.forEach((it, ii) => {
                    const mark2 = it.done ? '☑ ' : '▶ ';
                    if (personCardEditing) {
                        const qib2 = button(mark2 + trimText(it.text), 'toggle-quest-item', 'wxg-btn-xs', one.id);
                        qib2.setAttribute('data-title', trimText(q.title));
                        qib2.setAttribute('data-index', String(ii));
                        qiRow2.appendChild(qib2);
                    } else {
                        qiRow2.appendChild(el('span', null, mark2 + trimText(it.text) + '　'));
                    }
                });
                qr.appendChild(qiRow2);
            }
            return qr;
        };
        if (!qOpen.length) {
            qSec.appendChild(el('div', 'wxg-empty', '没有在追的任务了（已结束的收在下面）'));
        }
        for (const q of qOpen) {
            qSec.appendChild(mkQ(q));
        }
        if (qOver.length) {
            const fold = foldable('已结束 ' + String(qOver.length) + ' 条（完成／搁置，点开看）', false);
            const inner = el('div', 'wxg-list');
            for (const q of qOver) {
                inner.appendChild(mkQ(q));
            }
            fold.appendChild(inner);
            qSec.appendChild(fold);
        }
        pop.appendChild(qSec);
    }
    /* 191/192：把已有内容按三页分装；字段生成逻辑一行没改，只搬家 */
    const kvBox = pop.querySelector('.wxg-pc-kv');
    const sec1Box = kvBox ? kvBox.closest('.wxg-pc-sec') : null;
    const whoAlias = pop.querySelector('.wxg-pc-alias');
    if (whoAlias) { whoAlias.remove(); }
    const pages = el('div', 'wxg-pc-pages');
    const pageEl = (key) => { const d = el('div', 'wxg-pc-page'); d.setAttribute('data-page', key); d.style.display = (personCardTab === key ? '' : 'none'); pages.appendChild(d); return d; };
    const pNow = pageEl('now');
    const pFile = pageEl('file');
    const pEdge = pageEl('edge');
    const hkv = el('div', 'wxg-pc-headkv');
    const addPair = (host, a, b) => { host.appendChild(a); if (b) { host.appendChild(b); } };
    if (kvBox) {
        /* ⚠️ 技术债：靠 label 文字匹配搬家，改标签名会让该项落进兜底（此刻页）并 warn。
         *    以后重构成"渲染时直接按页构造"，⛔ 再靠文字匹配。 */
        const kids = Array.from(kvBox.children);
        for (let i = 0; i < kids.length; i += 1) {
            const k = kids[i];
            if (!k || !k.classList || !k.classList.contains('wxg-pc-k')) { continue; }
            const v = kids[i + 1];
            const label = trimText(k.textContent);
            const isPlayerBox = v && v.querySelector && v.querySelector('[data-action="set-player"]');
            const isBenchBox = v && v.querySelector && v.querySelector('[data-action="set-bench"]');
            if (label === '\u59d3\u540d') { addPair(hkv, k, v); i += 1; continue; }
            if (label === '\u5f53\u524d\u5730\u70b9' || label === '\u522b\u540d') { addPair(hkv, k, v); i += 1; continue; }
            if (label === '\u5e74\u9f84' || label === '\u8eab\u4efd' || label === '\u6240\u5728\u52bf\u529b' || label === '\u597d\u611f') {
                addPair(label === '\u597d\u611f' ? pNow : pFile, k, v); i += 1; continue;
            }
            if (label.indexOf('\u6863\u4f4d') === 0) { k.textContent = '\u6863\u4f4d'; addPair(pFile, k, v); i += 1; continue; }
            if (label.indexOf('\u8ba4\u77e5\u8d26') === 0 || label.indexOf('\u77e5\u8bc6\u9762') === 0) { addPair(pEdge, k, v); i += 1; continue; }
            if (label === '\u6b63\u5728\u7ecf\u5386') { addPair(pNow, k, v); i += 1; continue; }
            if (label === '' && (isPlayerBox || isBenchBox)) { if (v) { pFile.appendChild(v); } i += 1; continue; }
            /* 兜底：没被任何分支接住的格子 ⇒ 此刻页，⛔ 静默丢 */
            pNow.appendChild(k);
            if (v) { pNow.appendChild(v); }
            i += 1;
            try { console.warn('[万象阁] 浮层分页未匹配项：' + (label || '（空标签）')); } catch (eW) { /* warn 不能拦着渲染 */ }
        }
    }
    if (sec1Box) { sec1Box.remove(); }
    const secs = Array.from(pop.querySelectorAll(':scope > .wxg-pc-sec'));
    let taskSec = null;
    for (const sec of secs) {
        const h = sec.querySelector('.wxg-pc-sech');
        const ht = trimText(h && h.textContent);
        if (ht.indexOf('\u4efb\u52a1') === 0) { taskSec = sec; continue; }
        if (ht.indexOf('\u8fc7\u53bb\u7ecf\u5386') === 0) { pNow.appendChild(el('div', 'wxg-pc-k', '\u8fc7\u53bb\u7ecf\u5386')); pNow.appendChild(sec); continue; }
        if (ht.indexOf('\u65e5\u7a0b') === 0) { pNow.appendChild(el('div', 'wxg-pc-k', '\u65e5\u7a0b')); pNow.appendChild(sec); continue; }
        if (ht.indexOf('\u4ed6\u77e5\u9053\u4ec0\u4e48') === 0) { pEdge.appendChild(sec); continue; }
        if (!h && String(sec.textContent).indexOf('\u4e0d\u53ef\u9760') >= 0) { pNow.appendChild(sec); continue; }
    }
    /* 卡头：姓名／当前地点／别名 三个字段标签 */
    const nameK = el('div', 'wxg-pc-k', '\u59d3\u540d');
    hkv.insertBefore(nameK, hkv.firstChild);
    hkv.insertBefore(el('span', 'wxg-pc-hv', String(c.name || '\uff08\u6ca1\u540d\u5b57\uff09')), nameK.nextSibling);
    head.appendChild(hkv);
    head.style.position = 'sticky';
    head.style.top = '0';
    head.style.zIndex = '6';
    const tabs = el('div', 'wxg-pc-tabs');
    for (const [key, label] of [['now', '\u6b64\u523b'], ['file', '\u6863\u6848'], ['edge', '\u8fb9\u754c']]) {
        const b = button(label, 'pc-tab', 'wxg-pc-tab' + (personCardTab === key ? ' is-on' : ''));
        b.setAttribute('data-page', key);
        tabs.appendChild(b);
    }
    head.parentNode.insertBefore(tabs, head.nextSibling);
    tabs.parentNode.insertBefore(pages, tabs.nextSibling);
    if (taskSec) { pop.appendChild(taskSec); }
    const foot = el('div', 'wxg-pc-foot');
    const prev = button('← 上一位', 'card-prev', 'wxg-pc-nav');
    prev.disabled = at <= 0;
    const next = button('下一位 →', 'card-next', 'wxg-pc-nav');
    next.disabled = at >= roster.length - 1;
    foot.appendChild(prev);
    foot.appendChild(el('span', 'wxg-pc-counter', '第 ' + String(at + 1) + ' / ' + String(roster.length) + ' 位'));
    foot.appendChild(next);
    foot.appendChild(button('按这条合并…', 'merge-into', 'wxg-btn-sm', c.id));
    /*
     * 底部那颗：只读态下叫「编辑这一位」；编辑态下叫「收起编辑」。
     * ⚠️ 不叫「保存」是诚实：改字是**改哪格存哪格**（立即落账），⛔ 做假的"取消"骗人。
     */
    const save = button(personCardEditing ? '收起编辑' : '编辑这一位',
        personCardEditing ? 'card-view' : 'card-edit', personCardEditing ? 'wxg-primary' : '');
    foot.appendChild(save);
    pop.appendChild(foot);

    (lastSectionsHost || document.body).appendChild(pop);

    /*
     * ⭐⭐ 材料 06【4】#6：**只读态下那几格不该裸露可点** ✓
     *   旧：没点 ⋮（只读态）时，「这是玩家棋子」「参与后台推演」两个勾选框、
     *     「他知道什么」的加／删、以及任务的状态下拉与删除按钮**全都裸露可点** ✗
     *     ⇒ 误触一下就直接改账 ✗
     *   现在：只读态 ⇒ 这几类控件**统一禁用** ✓（看得见、点不动 ✓）；点 ⋮ 进编辑态就能点 ✓
     *   （审计 audit-3-panel 也是先点 card-edit 才改 ✓ ⇒ 不冲突 ✓）
     */
    if (!personCardEditing) {
        try {
            /* 这五类控件在只读态下必须点不动；选择器用双引号写在单引号里 ✓ */
            const lockSel = '[data-action="set-player"],[data-action="add-know"],[data-action="del-know"],'
                + '[data-action="set-quest-status"],[data-action="del-quest"]';
            const lockables = pop.querySelectorAll(lockSel);
            for (const el2 of Array.from(lockables)) {
                if (el2 && el2.setAttribute) {
                    el2.setAttribute('disabled', 'disabled');
                    if (el2.style) { el2.style.opacity = '0.45'; }
                }
            }
        } catch (eLock) { /* 锁不上也不能把卡片搞挂 ✓ */ }
    }
    bindPersonCardDrag(pop);
}

/**
 * 一个格：**默认只读文本**，点 ⋮ 进了编辑态才变输入框。
 *
 * 为什么（她自己说过两回，目标包里也写着）：
 *   · 她：「为什么现在每个页面的内容比如这个都是直接就能按的，而不是旁边有一个编辑按钮，
 *     点了才能按，不点是只读改不了免得弄错」
 *   · 目标包说明：「浮层右上 ⋮（三个点，**点开＝编辑这一位**）」
 *   ⇒ 默认**只读**；⋮ 就是那个“编辑按钮”。
 *
 * ⚠️ 编辑态里改字是**改哪格存哪格**（沿用 `set-char-field` ⇒ 保存路径与手改锁都不变），
 *   ⛔ 做假“取消”骗人（改了就已经落账了）。底部那颗叫「收起编辑」。
 */
export function fieldBox(charId, field, value, placeholder) {
    const wrap = el('div', 'wxg-pc-v');
    const long = field === 'current' || field === 'timePlace';
    if (!personCardEditing) {
        const txt = trimText(value);
        wrap.appendChild(el('div', 'wxg-pc-text' + (txt ? '' : ' is-empty'), txt || (placeholder || '—')));
        return wrap;
    }
    const input = long ? el('textarea', 'wxg-pc-input') : el('input', 'wxg-pc-input');
    if (!long) {
        input.type = 'text';
    }
    input.value = trimText(value);
    input.placeholder = placeholder || '—';
    input.setAttribute('data-action', 'set-char-field');
    input.setAttribute('data-id', charId);
    input.setAttribute('data-key', field);
    if (long) {
        input.rows = 2;
    }
    wrap.appendChild(input);
    return wrap;
}

export function setPersonCardId(v) { personCardId = v; }
export function setPersonCardEditing(v) { personCardEditing = v; }
export function setPersonCardTab(v) { personCardTab = v; }

/* 名-4/名-5：人物卡字段/日程/过去/知识面/档位 事件。从 sections.js 抽出（206 后） */


export const PERSON_CARD_EDIT_ACTIONS = new Set(['set-char-field', 'set-alias', 'set-affinity', 'add-sched', 'sched-done', 'sched-del', 'past-save', 'past-del', 'del-past', 'add-past', 'add-know', 'del-know', 'set-bench', 'set-player']);

export function handlePersonCardEdit(action, target, id, key, isChange, rerender) {
    switch (action) {
                case 'set-char-field':
                    if (isChange) {
                        updateCharacter(id, { [key]: target.value, manual: true });
                        /*
                         * ⭐ 改完一格 ⇒ 重画段，但 `rerender()` 会**顺手把浮层也冲掉**
                         *   （浮层挂在段容器里）⇒ 真机上就是"改一格、整张卡没了"。
                         *   ⇒ **重画完再把卡片画回来**（跟 `card-save` 同一个道理）。
                         */
            scheduleCardRerender();   /* R5：推迟重画 ✓（⛔ 把她正按的按钮销毁掉 ✗） */
                    }
                    break;
                case 'set-alias':
                    if (isChange) {
                        updateCharacter(id, { aliases: toList(target.value), manual: true });
                        toast.ok('别名保存了');
                        rerender();
                        if (personCardId) {
                            renderPersonCard();   // 同上：别把卡片带走
                        }
                    }
                    break;
                case 'set-affinity':
                    if (isChange) {
                        updateCharacter(id, { affinity: trimText(target.value), manual: true });
                        rerender();
                    }
                    break;
                case 'add-sched': {
        const whatN = trimText((document.getElementById('wxg-new-sched-what-' + String(id)) || {}).value);
        const dueN = trimText((document.getElementById('wxg-new-sched-due-' + String(id)) || {}).value);
        if (!whatN) { toast.ok('先写约好的事'); break; }
        const cN = findCharacter(id);
        if (cN) {
            const dueAbsN = dueN ? dueToAbsoluteMinute(dueN, Number((loadState().world || {}).clockMinute)) : null;
            const nextN = (Array.isArray(cN.schedule) ? cN.schedule : []).concat([{ what: whatN, due: dueN, done: false, dueReached: false, dueMinute: dueAbsN, originDueMinute: dueAbsN, sinceMinutes: Number((loadState().world || {}).clockMinute), firedPoints: [] }]);
            updateCharacter(id, { schedule: nextN });
            toast.ok('加了一条日程');
            rerender();
        }
        break;
    }
    case 'sched-done': {
                    /* ⭐ 新增件 1：**把这条日程标成已了结** ✓ */
                    const whatA = trimText(target.getAttribute('data-what'));
                    const cA = findCharacter(id);
                    if (cA && Array.isArray(cA.schedule) && whatA) {
                        const nextA = cA.schedule.map((x) => (trimText(x && (x.what || x.text)) === whatA
                            ? Object.assign({}, x, { done: true })
                            : x));
                        updateCharacter(id, { schedule: nextA });
                        toast.ok('这条日程标成已了结了');
                        rerender();
                    }
                    break;
                }
                case 'sched-del': {
                    /* ⭐ 新增件 1：**删掉这条日程** ✓ */
                    const whatB = trimText(target.getAttribute('data-what'));
                    const cB = findCharacter(id);
                    if (cB && Array.isArray(cB.schedule) && whatB) {
                        const nextB = cB.schedule.filter((x) => trimText(x && (x.what || x.text)) !== whatB);
                        updateCharacter(id, { schedule: nextB });
                        toast.ok('这条日程删掉了');
                        rerender();
                    }
                    break;
                }
                case 'past-save': {
                    /* ⭐ 新增件 1：**就地改一条过去经历** ✓ */
                    const pi = Number(target.getAttribute('data-idx'));
                    const cPs = findCharacter(id);
                    const inpPs = document.getElementById('wxg-past-edit-' + String(pi));
                    if (cPs && Array.isArray(cPs.past) && Number.isFinite(pi) && cPs.past[pi] && inpPs) {
                        const nextPs = cPs.past.map((x, xi) => (xi === pi
                            ? Object.assign({}, x, { text: trimText(inpPs.value), manual: true })
                            : x));
                        updateCharacter(id, { past: nextPs });
                        toast.ok('这条过去经历改好了');
                        rerender();
                    }
                    break;
                }
                case 'past-del': {
                    /* ⭐ 新增件 1：**删一条过去经历** ✓ */
                    const pp = Number(target.getAttribute('data-idx'));
                    const cPd = findCharacter(id);
                    if (cPd && Array.isArray(cPd.past) && Number.isFinite(pp)) {
                        const nextPd = cPd.past.filter((x, xi) => xi !== pp);
                        updateCharacter(id, { past: nextPd });
                        toast.ok('这条过去经历删掉了');
                        rerender();
                    }
                    break;
                }
                case 'del-past': {
                    const pi2 = Number(target.getAttribute('data-index'));
                    const pc2 = findCharacter(id);
                    if (pc2 && Array.isArray(pc2.past) && Number.isFinite(pi2) && pc2.past[pi2]) {
                        takeSnapshot('删过去经历前');
                        const arr2 = pc2.past.slice();
                        arr2.splice(pi2, 1);
                        updateCharacter(id, { past: arr2 }, { manual: true });
                        toast.ok('删了一条过去经历');
                        rerender();
                    }
                    break;
                }
                case 'add-past': {
                    const inp2 = document.getElementById('wxg-past-text');
                    const txt2 = trimText(inp2 && inp2.value);
                    if (!txt2) {
                        toast.info('先写一句话再点加 ✓');
                        break;
                    }
                    takeSnapshot('手加过去经历前');
                    pushPast(id, txt2, Number(getSettings().capPast) || 5, -1);
                    toast.ok('加上了');
                    rerender();
                    break;
                }
                case 'add-know': {
                    /*
                     * ⭐ 补③：手加一条"他该知道的"。
                     *   来源必选（亲眼／被告知／公开）；来源楼层用**当前停在的楼**（她手加时就是在看那一楼）。
                     *   ⛔ 自己造来源类型；⛔ 改已有的（只增）。
                     */
                    const box = document.getElementById('wxg-know-text');
                    const txt = box && typeof box.value === 'string' ? box.value.trim() : '';
                    const srcEl = document.getElementById('wxg-know-source');
                    const src = srcEl && typeof srcEl.value === 'string' ? srcEl.value : '亲眼';
                    if (!txt) {
                        toast.fail('先写一句"他知道了什么"');
                        break;
                    }
                    const chatNow = getChat();
                    const floorNow = (Array.isArray(chatNow) ? chatNow.length : 1) - 1;
                    const got = addKnow(id, { text: txt, source: src, floor: floorNow, manual: true });
                    if (!got) {
                        toast.info('这条没收（要么已经有了，要么没填来源）');
                        break;
                    }
                    toast.ok('记下了（' + got.source + '）');
                    rerender();
                    if (personCardId) {
                        renderPersonCard();
                    }
                    break;
                }
                case 'del-know': {
                    /* ⭐材料 06第一波：**二次确认 ＋ 快照** ✓
                     *   旧：点一下当场物理删除 ✗ 不弹确认 ✗ 不留快照 ✗
                     *        （点「撤回上一次」都撤不回来 ✗ —— 她的账不能这么掉 ✗）
                     *   新：先问一句 ✓ 再留一份快照 ✓ （沿用代码里既有的 window.confirm 写法 ✓ ⛔ 不引入新弹窗 ✗） */
                    if (typeof window !== 'undefined' && typeof window.confirm === 'function' && !window.confirm('要把这条认知删掉吗？\n\n（会先留一份快照，点「撤回上一次」能撤回来）')) { break; }
                    takeSnapshot('删除前（这条认知）');
                    const ki = Math.round(Number(target.getAttribute('data-index')));
                    if (removeKnow(id, ki)) {
                        toast.ok('删了一条');
                    }
                    rerender();
                    if (personCardId) {
                        renderPersonCard();
                    }
                    break;
                }
                case 'set-bench':
                    /*
                     * ⭐ 补①：勾上＝**参与**后台推演；不勾＝不进轮转名单。
                     *   存的是**反的**（`noBench`）：老数据缺字段 ⇒ 默认"参与"，跟升级前一模一样。
                     */
                    if (isChange) {
                        updateCharacter(id, { noBench: target.checked !== true });
                        toast.ok(target.checked === true
                            ? '他会跟其他人一起轮转'
                            : '已关掉后台推演（不占名额；正文写到他时照常更新）');
                        rerender();
                        if (personCardId) {
                            renderPersonCard();
                        }
                    }
                    break;
                case 'set-player':
                    if (!isChange) { break; }   /* R6（材料 05）：⛔ 让 click 与 change 各跑一遍 ✗ */
                    /*
                     * ⚠️ 她**取消勾**的时候要记一笔 `playerOff`：
                     *    名字跟人设名一样就会被自动认成"你"，不记的话下次重画又被自动勾上，
                     *    跟她抢方向盘（⛔ 自动可以，但不能盖过她明确说过的话）。
                     */
                    updateCharacter(id, {
                        isPlayer: target.checked === true,
                        playerOff: target.checked !== true,
                        manual: true,
                    });
                    rerender();
                        if (personCardId) {
                            renderPersonCard();
                        }
                    break;
    }
}

