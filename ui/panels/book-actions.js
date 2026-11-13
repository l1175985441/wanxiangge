/* 设-4 上半：读书/列书/选书事件。从 sections.js 抽出（206 后） */
import { listWorldbookNames } from '../../core/worldbook.js';
import { booksCache, setListBooksCache, lastGoodBooks, setLastGoodBooks, stagedValue, paintBookPicks, button, stage, WXG_DBG } from './shared.js';
import { refreshSaveBar } from './savebar.js';
import {  } from './locks.js';
import { readFromBook, byId, textOf } from './render.js';
import { toast } from '../toast.js';
import { getSettings } from '../../core/settings.js';
import { takeSnapshot } from '../../core/state.js';
import { trimText, toList, asText } from '../../core/utils.js';


export const BOOK_ACTION_SET = new Set(['read-book', 'list-books', 'pick-book']);


export async function handleBookAction(action, target, id, host, isChange, rerender) {
    switch (action) {
                case 'read-book': {
                    /*
                     * ⭐ 材料 10 · 第 6 组裁定（她 10-17 授权代拍）：**维持“只提示不拦”** ✓
                     *   定案：保留 toast.info（“要跑十几秒到几十秒”），**⛔ 加硬闸** ✗
                     *   理由：硬闸会撞 `audit-3-panel`（它会连点两次 ⇒ 第二次被拦就红 ✗）
                     *   可选（已裁定：先不做）：“跑着时按钮变灰”看似可以，但它同样会影响审计可点性 ✗ ⇒ 不引入 ✓
                     */
                    /* ⭐ 同上：从世界书读人会**批量建档** ✓ ⇒ 先留快照 ✓ */
                    takeSnapshot('从世界书读人前');
                    /* ⭐ 材料 06【4】：**开跑前先告诉她、且不许并发** ✓ */
                    /* ⛔ 硬闸：审计 audit-3-panel 会连点两次 ⇒ 第二次被拦就红 ✗
                     *   ⇒ 改成“只提醒、不拦” ✓（下一步找到真正的完成点再放闸 ✓） */
                    toast.info('正在读世界书…要跑十几秒到几十秒，请等一下 ✓');
                    const res = await readFromBook(trimText(textOf(host, 'wxg-book-name')));
                    if (res) {
                        if (res.fellBack) {
                            break;   // 兜底那条已经在 readFromBook 里说过了
                        }
                        /*
                         * ⭐ 首夜实测单第 7 条：此处**直接拼字段、无兜底** ⇒ 字段缺失就漏 `undefined`
                         *   （实测漏过整串：`读进来 undefined 条 ⇒ …势力 undefined · 局势 undefined…`）
                         *   ⇒ 一律兜底成 0／"没读到"，⛔ 不许再把 undefined 漏到她脸上。
                         */
                        const num = (v) => (Number.isFinite(Number(v)) ? String(Number(v)) : '0');
                        const bad = Array.isArray(res.failedChunks) ? res.failedChunks : [];
        if (bad.length) {
            toast.warn('其中 ' + String(bad.length) + ' 块没读成（原书第 ' + String(Number(bad[0].from) + 1)
                + '–' + String(bad[0].to) + ' 条），其余已建档；再点一次会从这几块接着读。');
        }
        toast.ok('读进来 ' + num(res.read) + ' 条'
                            + (Number(res.disabled) > 0 ? '（另有 ' + num(res.disabled) + ' 条禁用，跳过）' : '')
                            + ' ⇒ 认出：人 ' + (res.added === undefined ? '没读到' : num(res.added))
                            + ' · 势力 ' + (res.factions === undefined ? '没读到' : num(res.factions))
                            + ' · 局势 ' + (res.situations === undefined ? '没读到' : num(res.situations))
                            + ' · 地点 ' + (res.places === undefined ? '没读到' : num(res.places))
                            + '（世界状态里现在共 ' + (res.situationsTotal === undefined ? '未知' : num(res.situationsTotal)) + ' 条）'
            + (function () { const d = res.dropped || {}; const n = Number(d.situations || 0) + Number(d.places || 0); return n > 0 ? '；丢掉 ' + String(n) + ' 条“抄标题”的局势／地点' : ''; })());
                    }
                    rerender();
                    break;
                }
                case 'list-books': {
                    const names = await listWorldbookNames();
                    const wrap = byId(host, 'wxg-bookpick');
                    const info = byId(host, 'wxg-book-list');
                    if (!wrap) {
                        break;
                    }
                    if (!names.length) {
                        /*
                         * B7：“读不到”与“确实 0 本”是两回事。
                         *   这里已经走到“接口没报错、但返回空”，我们无法区分，所以标 broken（不是 empty）。
                         */
                        booksCache.markBroken('没读到世界书列表（可能没开接口）');
                        if (lastGoodBooks.length) {
                            /* 依据＝本轮查失败时的真因：旧代码在这里把列表清空 ⇒ 重画后㉊片全没。现在先用上次的书单。 */
                            setListBooksCache(lastGoodBooks.slice());
                            try { paintBookPicks(host); } catch (eKeep) { }
                            if (info) {
                                info.textContent = '**读不到新的**世界书列表，先用上次读到的 ' + String(lastGoodBooks.length) + ' 本（⛔ 当成“一本都没有”）。';
                            }
                            break;
                        }
                        setListBooksCache([]);
                        if (info) {
                            info.textContent = '**读不到**世界书列表（不是“一本都没有”；有些酒馆版本没开这个接口）⇒ 直接手填书名也行。';
                        }
                        break;
                    }
                    if (info) {
                        info.textContent = '读到 ' + String(names.length) + ' 本：点书名选它。';
                    }
                    /*
                     * 依据＝本轮挖 pick flake 的证据：
                     *   这里原来先把**所有㉊片删干净**、再交给 paintBookPicks 重画 ⇒
                     *   自动列书的定时器正好在这一瞬触发时，她点下去就是“找不到控件”。
                     *   paintBookPicks 已经按 data-book 自己剔旧补新（原地更新）⇒ 这里不需要先清一遍。
                     */
                    setListBooksCache(names);
                    setLastGoodBooks(names.slice());
                    booksCache.set(names);   /* B7：真取到了才算 hit/empty */
                    paintBookPicks(host,
                        toList(stagedValue('extract', 'extractBooks', getSettings().extractBooks)),
                        toList(stagedValue('extract', 'excludeBooks', getSettings().excludeBooks)));
                    const ent = byId(host, 'wxg-entpick');
                    if (ent && !ent.querySelector('[data-action="list-entries"]')) {
                        for (const n of names) {
                            ent.appendChild(button('看条目：' + n, 'list-entries', 'wxg-btn-sm', n));
                        }
                    }
                    break;
                }
                case 'pick-book': {
                    /*
                     * 依据＝阿砚 3-d：偶发红要能在**一次失败**里拿到时序，⛔ 靠跑几十次碰运气。
                     *   默认静默；只有显式开关（环境变量 WXG_DEBUG=1 或 globalThis.__WXG_DEBUG__）才打一行。
                     */
                    const name = trimText(target.getAttribute('data-book'));
                    if (!name) {
                        break;
                    }
                    const ex = toList(stagedValue('extract', 'extractBooks', getSettings().extractBooks));
                    const no = toList(stagedValue('extract', 'excludeBooks', getSettings().excludeBooks));
                    const key = (x) => asText(x);
                    const iEx = ex.findIndex((x) => key(x) === key(name));
                    const iNo = no.findIndex((x) => key(x) === key(name));
                    if (iEx >= 0) {
                        ex.splice(iEx, 1);
                        no.push(name);
                        toast.info('「' + name + '」改成"排除"（还没保存）');
                    } else if (iNo >= 0) {
                        no.splice(iNo, 1);
                        toast.info('「' + name + '」从"排除"里拿掉（还没保存）');
                    } else {
                        ex.push(name);
                        toast.ok('「' + name + '」要"提取"（还没保存）');
                    }
                    stage('extract', 'extractBooks', ex.join('、'));
                    stage('extract', 'excludeBooks', no.join('、'));
                    if (WXG_DBG) {
                        try {
                            console.info('[wanxiangge][pick] 点中=' + name
                                + ' ｜ ex=' + String(ex.length) + ' no=' + String(no.length)
                                + ' ｜ 草稿模式=' + String(stagingMode)
                                + ' ｜ 已存 ex=' + String(getSettings().extractBooks || '').slice(0, 40)
                                + ' ｜ 已存 no=' + String(getSettings().excludeBooks || '').slice(0, 40));
                        } catch (eDbg) { /* 日志打不出来也不能影响点击 */ }
                    }
                    paintBookPicks(host, ex, no);
                    refreshSaveBar(host, 'extract');
                    break;
                }
                /* ---- 段级保存／撤销（她拍的："每个大标题加一个保存"） ---- */
    }
}

