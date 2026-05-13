import { useNavigate } from 'react-router-dom';
import { Download } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';

interface DownloadableSkinsSectionProps {
  /** Hero category id used to preselect Browse's hero filter. */
  categoryId: number;
}

/**
 * Locker entry-point to the Browse tab. Pre-fills Browse's hero filter so the
 * user lands on a category-scoped view with the full search/sort/pagination
 * experience instead of a duplicate in-locker grid.
 */
export default function DownloadableSkinsSection({ categoryId }: DownloadableSkinsSectionProps) {
  const navigate = useNavigate();
  const setBrowseUi = useAppStore((s) => s.setBrowseUi);

  const handleClick = () => {
    setBrowseUi({
      section: 'Mod',
      heroCategoryId: categoryId,
      categoryId: 'all',
      search: '',
    });
    navigate('/browse');
  };

  return (
    <div className="border-t border-border/60 pt-3 mt-3">
      <button
        type="button"
        onClick={handleClick}
        className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-lg border border-accent/50 bg-bg-secondary/85 hover:bg-bg-tertiary hover:border-accent/70 text-text-primary text-sm font-semibold transition-colors cursor-pointer shadow-sm"
      >
        <Download className="w-4 h-4" />
        Browse more skins
      </button>
    </div>
  );
}
