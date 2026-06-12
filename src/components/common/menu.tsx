import { type ReactNode } from 'react';
import * as RadixContextMenu from '@radix-ui/react-context-menu';
import { type LucideIcon } from 'lucide-react';

// Shared right-click menu primitives (styled wrappers over Radix
// context-menu). One source for the menu surface and item styling that was
// previously copy-pasted between ImageContextMenu, Sidebar, and the
// Installed card menu. Menus sit at z-[80] (see the z-index scale in
// index.css).
//
// Usage:
//   <MenuRoot>
//     <MenuTrigger asChild>...</MenuTrigger>
//     <MenuContent>
//       <MenuLabel>...</MenuLabel>
//       <MenuItem icon={FolderOpen} onSelect={...}>Reveal in folder</MenuItem>
//       <MenuSeparator />
//     </MenuContent>
//   </MenuRoot>

export const MenuRoot = RadixContextMenu.Root;
export const MenuTrigger = RadixContextMenu.Trigger;

export const MENU_SURFACE_CLASS =
  'z-[80] min-w-52 rounded-lg border border-white/10 bg-bg-secondary/95 p-1.5 text-sm text-text-primary shadow-2xl shadow-black/50 backdrop-blur-md animate-fade-in';

type MenuContentProps = RadixContextMenu.ContextMenuContentProps;

export function MenuContent({ children, className = '', ...props }: MenuContentProps) {
  return (
    <RadixContextMenu.Portal>
      <RadixContextMenu.Content
        collisionPadding={12}
        className={`${MENU_SURFACE_CLASS} ${className}`}
        {...props}
      >
        {children}
      </RadixContextMenu.Content>
    </RadixContextMenu.Portal>
  );
}

interface MenuItemProps {
  children: ReactNode;
  icon?: LucideIcon;
  /** Renders the icon with animate-spin (in-flight clipboard ops etc.) */
  spinning?: boolean;
  tone?: 'default' | 'success' | 'danger';
  disabled?: boolean;
  onSelect: (event: Event) => void;
}

export function MenuItem({ children, icon: Icon, spinning, tone = 'default', disabled, onSelect }: MenuItemProps) {
  const toneClass = tone === 'success'
    ? 'text-state-success focus:bg-state-success/10 data-[highlighted]:bg-state-success/10'
    : tone === 'danger'
      ? 'text-state-danger focus:bg-state-danger/10 data-[highlighted]:bg-state-danger/10'
      : 'text-text-primary focus:bg-white/10 data-[highlighted]:bg-white/10';

  return (
    <RadixContextMenu.Item
      disabled={disabled}
      onSelect={(event) => {
        event.stopPropagation();
        onSelect(event);
      }}
      className={`flex h-8 select-none items-center gap-2 rounded-md px-2 outline-none transition-colors cursor-pointer data-[disabled]:cursor-default data-[disabled]:opacity-50 ${toneClass}`}
    >
      {Icon && <Icon className={`h-4 w-4 flex-shrink-0 text-current ${spinning ? 'animate-spin' : ''}`} />}
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </RadixContextMenu.Item>
  );
}

export function MenuLabel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <RadixContextMenu.Label
      className={`max-w-64 truncate px-2 py-1 text-[11px] uppercase tracking-wide text-text-tertiary ${className}`}
    >
      {children}
    </RadixContextMenu.Label>
  );
}

export function MenuSeparator() {
  return <RadixContextMenu.Separator className="my-1 h-px bg-white/10" />;
}
