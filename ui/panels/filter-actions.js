/* 公-4 片段：筛选/翻页/搜索/全展全收/排序。从 sections.js 抽出（206 后） */
import { setChronFilter, setReportFilter, setStepFilter, setStepPage, setRosterFilter, setRosterSortDir, setRosterPage, setChronPage, setChronSearch, setRosterSearch, charSearch } from './shared.js';
import { toast } from '../toast.js';
import { asArray, trimText } from '../../core/utils.js';


export const FILTER_ACTION_SET = new Set(['chron-filter', 'report-filter', 'step-filter', 'step-page', 'roster-filter', 'expand-all', 'collapse-all', 'chron-search', 'roster-search', 'roster-page', 'chron-page', 'char-sort']);


export function handleFilterAction(action, target, id, host, isChange, rerender) {
    switch (action) {
                case 'chron-filter': {
                    setChronFilter(trimText(id) || 'all');
                    setChronPage(1); // ⚠️ 换了筛选要回第一页（不然可能停在一个空页上）
                    rerender();
                    break;
                }
                case 'report-filter': {
                    setReportFilter(trimText(id) || 'all');
                    rerender();
                    break;
                }
                case 'step-filter': {
                    setStepFilter(trimText(id) || 'all');
                    setStepPage(1);
                    rerender();
                    break;
                }
                case 'step-page': {
                    setStepPage(Math.max(1, Math.round(Number(id) || 1)));
                    rerender();
                    break;
                }
                case 'roster-filter': {
                    /* ★ R62：点已选中的创建/修改时间 ⇒ 切正反序 ✓ */
                    const wantR = trimText(id) || 'all';
                    if (wantR === rosterFilter && (wantR === 'created' || wantR === 'changed' || wantR === 'name')) {
                        setRosterSortDir(rosterSortDir === 'desc' ? 'asc' : 'desc');
                    } else {
                        setRosterFilter(wantR);
                        setRosterSortDir(wantR === 'name' ? 'asc' : 'desc');
                    }
                    setRosterPage(1); // 同上
                    rerender();
                    break;
                }
                case 'expand-all':
            case 'collapse-all': {
                /*
                 * 六：本段里所有 <details> 一起开/收。
                 *   ⛔ 不改 foldable 自己的记忆逻辑（toggle 事件会照常把状态记进 foldOpenState）。
                 */
                const secOf = target.closest && target.closest('.wxg-sec');
                const open = action === 'expand-all';
                if (secOf) {
                    for (const d of asArray(secOf.querySelectorAll('details'))) {
                        d.open = open;
                    }
                }
                break;
            }
            case 'chron-search':
                /* A4：编年搜索（change 才重画） */
                if (isChange) {
                    setChronSearch(trimText(target.value));
                    setChronPage(1);
                    rerender();
                }
                break;
            case 'roster-search':
                    if (isChange) {
                        setRosterSearch(trimText(target.value));
                        setRosterPage(1);
                        rerender();
                    }
                    break;
                case 'roster-page': {
                    setRosterPage(Math.max(1, Math.round(Number(id) || 1)));
                    rerender();
                    break;
                }
                case 'chron-page': {
                    setChronPage(Math.max(1, Math.round(Number(id) || 1)));
                    rerender();
                    break;
                }
                /*
                 * ⭐ 名册点一行 ⇒ **开浮层**（她 2026-10-14 点名：⛔ 行内展开把表格推下去）。
                 *    旧的行内编辑器（case 'edit-char' 那段）**先留着**：
                 *    等浮层距离验收了再说，⛔ 一步到位地把能用的东西换掉。
                 */
                case 'char-sort':
                    if (isChange) {
                        charSearch.sort = trimText(target.value) || 'recent';
                        rerender();
                    }
                    break;
                /* ---- 世界状态 ---- */
    }
}

