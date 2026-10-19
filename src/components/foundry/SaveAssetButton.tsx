import { useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button, IconButton } from '../common/ui';
import { foundryExportAsset } from '../../lib/api';
import { showToast } from '../../stores/toastStore';
import type { FoundryAssetExportRequest } from '../../types/foundry';

export function SaveAssetButton({ request, compact = false }: {
    request: FoundryAssetExportRequest;
    compact?: boolean;
}) {
    const { t } = useTranslation();
    const [saving, setSaving] = useState(false);
    const label = request.kind === 'texture'
        ? t('foundry.save.texture') : t('foundry.save.sound');
    async function save() {
        if (saving) return;
        setSaving(true);
        try {
            const result = await foundryExportAsset(request);
            if (result.exported) showToast(t('foundry.save.saved'), { tone: 'success' });
        } catch (error) {
            const message = (error instanceof Error ? error.message : String(error))
                .replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, '');
            showToast(t('foundry.save.failed', {
                error: message,
            }), { tone: 'error' });
        } finally {
            setSaving(false);
        }
    }
    return compact ? (
        <IconButton icon={saving ? Loader2 : Download} label={label}
            disabled={saving} onClick={save} className={saving ? '[&>svg]:animate-spin' : ''} />
    ) : (
        <Button variant="secondary" icon={Download} isLoading={saving} onClick={save}>{label}</Button>
    );
}
