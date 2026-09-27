import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, AlertTriangle, FolderOpen, Files, ChevronDown, ChevronRight, Folder, FileText } from 'lucide-react';
import { listUnknownModFiles } from '../../../lib/api';
import type { Mod } from '../../../types/mod';

export type GameBananaModFileChoice = { id: number; fileName: string };

interface FileTreeNode {
  name: string;
  path: string;
  isFile: boolean;
  fileCount: number;
  children: Map<string, FileTreeNode>;
}

// Turn a flat path list ("models/heroes/ghost/foo.vmdl_c") into a nested tree,
// stamping each folder with how many files sit under it.
function buildFileTree(paths: string[]): FileTreeNode {
  const root: FileTreeNode = { name: '', path: '', isFile: false, fileCount: 0, children: new Map() };
  for (const p of paths) {
    const parts = p.split('/').filter(Boolean);
    let node = root;
    parts.forEach((part, i) => {
      const isLast = i === parts.length - 1;
      let child = node.children.get(part);
      if (!child) {
        child = { name: part, path: parts.slice(0, i + 1).join('/'), isFile: isLast, fileCount: 0, children: new Map() };
        node.children.set(part, child);
      } else if (!isLast) {
        child.isFile = false;
      }
      node = child;
    });
  }
  const finalize = (n: FileTreeNode): number => {
    if (n.isFile && n.children.size === 0) {
      n.fileCount = 1;
      return 1;
    }
    let total = 0;
    for (const c of n.children.values()) total += finalize(c);
    n.fileCount = total;
    return total;
  };
  finalize(root);
  return root;
}

// Folders first, then files, each alphabetical.
function sortTreeNodes(nodes: Map<string, FileTreeNode>): FileTreeNode[] {
  return [...nodes.values()].sort((a, b) => {
    if (a.isFile !== b.isFile) return a.isFile ? 1 : -1;
    return a.name.localeCompare(b.name);
  });
}

function FileTreeBranch({
  nodes,
  depth,
  expanded,
  onToggle,
}: {
  nodes: Map<string, FileTreeNode>;
  depth: number;
  expanded: Set<string>;
  onToggle: (path: string) => void;
}) {
  return (
    <>
      {sortTreeNodes(nodes).map((node) => {
        const isOpen = expanded.has(node.path);
        const indent = { paddingLeft: `${depth * 14 + 8}px` };
        if (node.isFile) {
          return (
            <div
              key={node.path}
              style={indent}
              className="flex items-center gap-1.5 py-0.5 pr-2 text-text-secondary"
              title={node.path}
            >
              <FileText className="w-3.5 h-3.5 flex-shrink-0 text-text-tertiary" />
              <span className="truncate">{node.name}</span>
            </div>
          );
        }
        return (
          <div key={node.path}>
            <button
              type="button"
              onClick={() => onToggle(node.path)}
              style={indent}
              className="flex w-full items-center gap-1.5 py-0.5 pr-2 text-left text-text-primary hover:bg-hl/5 cursor-pointer"
            >
              {isOpen ? (
                <ChevronDown className="w-3.5 h-3.5 flex-shrink-0 text-text-tertiary" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5 flex-shrink-0 text-text-tertiary" />
              )}
              {isOpen ? (
                <FolderOpen className="w-3.5 h-3.5 flex-shrink-0 text-accent" />
              ) : (
                <Folder className="w-3.5 h-3.5 flex-shrink-0 text-accent" />
              )}
              <span className="truncate">{node.name}</span>
              <span className="text-[10px] text-text-tertiary">{node.fileCount}</span>
            </button>
            {isOpen && (
              <FileTreeBranch nodes={node.children} depth={depth + 1} expanded={expanded} onToggle={onToggle} />
            )}
          </div>
        );
      })}
    </>
  );
}

// Collapsible file TREE for the unknown VPK. Seeds from the detector's sample
// paths, then lazily loads the full list (a local VPK directory parse, no
// network) the first time it's expanded.
export function UnknownFileList({
  mod,
  initialPaths,
  initialCount,
}: {
  mod: Mod;
  initialPaths?: string[];
  initialCount?: number;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [paths, setPaths] = useState<string[] | null>(initialPaths && initialPaths.length ? initialPaths : null);
  const [count, setCount] = useState<number | undefined>(initialCount);
  const [full, setFull] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const tree = useMemo(() => (paths ? buildFileTree(paths) : null), [paths]);

  // Expand the top-level folders by default so the tree opens to something
  // useful (models/, sounds/, panorama/) without burying everything.
  useEffect(() => {
    if (!tree) return;
    setExpanded((prev) => {
      if (prev.size > 0) return prev;
      return new Set([...tree.children.values()].filter((n) => !n.isFile).map((n) => n.path));
    });
  }, [tree]);

  const loadFull = async () => {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await listUnknownModFiles(mod.id);
      setPaths(res.paths);
      setCount(res.fileCount);
      setFull(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const toggleOpen = () => {
    const next = !open;
    setOpen(next);
    if (next && !full) void loadFull();
  };

  const toggleNode = (path: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  return (
    <div className="rounded-md bg-bg-tertiary/40 border border-hl/5 overflow-hidden">
      <button
        type="button"
        onClick={toggleOpen}
        className="w-full flex items-center gap-2 px-4 py-3 text-sm text-text-secondary hover:text-text-primary cursor-pointer"
      >
        {open ? <ChevronDown className="w-4 h-4 flex-shrink-0" /> : <ChevronRight className="w-4 h-4 flex-shrink-0" />}
        <Files className="w-4 h-4 text-text-tertiary flex-shrink-0" />
        <span className="font-medium">{t('installed.unknown.viewFiles')}</span>
        {typeof count === 'number' && <span className="text-text-tertiary">({count})</span>}
      </button>

      {open && (
        <div className="border-t border-hl/5 px-4 py-3 space-y-3">
          {loading && (
            <div className="flex items-center gap-2 text-sm text-text-tertiary">
              <Loader2 className="w-4 h-4 animate-spin text-accent" /> {t('installed.unknown.readingVpk')}
            </div>
          )}
          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-md p-2.5 text-xs text-state-danger flex items-start gap-2">
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
          {tree && tree.children.size > 0 && (
            <>
              <div className="max-h-64 overflow-auto rounded-md border border-hl/5 bg-bg-primary/40 py-1.5 text-xs font-mono">
                <FileTreeBranch nodes={tree.children} depth={0} expanded={expanded} onToggle={toggleNode} />
              </div>
              {!full && (
                <p className="text-2xs text-text-tertiary">{t('installed.unknown.showingSample')}</p>
              )}
            </>
          )}
          {tree && tree.children.size === 0 && !loading && (
            <p className="text-sm text-text-tertiary">{t('installed.unknown.noFilePaths')}</p>
          )}
        </div>
      )}
    </div>
  );
}
