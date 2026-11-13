/* 设-1：总控开关事件。从 sections.js 抽出（206 后） */
import { patchSettings } from '../../core/settings.js';


export const SETTINGS_ACTION_SET = new Set(['set-enabled', 'set-card', 'set-show-empty', 'set-panel-on-start', 'set-protected', 'set-strict', 'set-auto-update']);


export function handleSettingsAction(action, target, id, host, isChange, rerender) {
    switch (action) {
                case 'set-enabled': patchSettings({ enabled: target.checked }); rerender(); break;
                case 'set-card': patchSettings({ cardEnabled: target.checked }); rerender(); break;
                case 'set-show-empty': patchSettings({ showEmptyCard: target.checked }); rerender(); break;
                case 'set-panel-on-start': patchSettings({ showPanelOnStart: target.checked }); break;
                case 'set-protected': patchSettings({ protectedBypass: target.checked }); break;
                case 'set-strict': patchSettings({ strictMention: target.checked }); break;
                case 'set-auto-update': patchSettings({ autoUpdate: target.checked }); break;
    }
}

