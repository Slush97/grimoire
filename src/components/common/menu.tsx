import { createContext, useContext, type ReactNode } from 'react';
import * as RadixContextMenu from '@radix-ui/react-context-menu';
import * as RadixDropdownMenu from '@radix-ui/react-dropdown-menu';
import { Check, ChevronRight, type LucideIcon } from 'lucide-react';

// Shared menu primitives (styled wrappers over Radix). One source for the menu
// surface and item styling that was previously copy-pasted between
// ImageContextMenu, Sidebar, and the Installed card menu. Menus sit at z-[80]
// (see the z-index scale in index.css).
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
//
// `kind` picks which Radix package backs the menu: 'context' (the default)
// opens on right-click at the pointer, 'dropdown' opens from a button trigger.
// Both packages wrap @radix-ui/react-menu and expose structurally identical
// sub-components, which is what lets one item tree render through either root.
// The Installed card relies on that: its three-dot button and its right-click
// menu are the same list of actions, mounted twice.

export type MenuKind = 'context' | 'dropdown';

// Typed against the dropdown namespace because its Content is the one that
// accepts positioning props (side/align/sideOffset). A context menu anchors at
// the pointer and has no use for them, so they are stripped for that kind.
type MenuNamespace = typeof RadixDropdownMenu;

const NAMESPACES: Record<MenuKind, MenuNamespace> = {
  context: RadixContextMenu as unknown as MenuNamespace,
  dropdown: RadixDropdownMenu,
};

interface MenuImpl {
  kind: MenuKind;
  ns: MenuNamespace;
}

const MenuImplContext = createContext<MenuImpl>({ kind: 'context', ns: NAMESPACES.context });

function useMenuImpl(): MenuImpl {
  return useContext(MenuImplContext);
}

interface MenuRootProps {
  children: ReactNode;
  kind?: MenuKind;
  /** Controlled open state. Dropdown menus only: context menus own their own. */
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  modal?: boolean;
}

export function MenuRoot({ children, kind = 'context', ...props }: MenuRootProps) {
  const ns = NAMESPACES[kind];
  const Root = ns.Root;
  return (
    <MenuImplContext.Provider value={{ kind, ns }}>
      <Root {...props}>{children}</Root>
    </MenuImplContext.Provider>
  );
}

interface MenuTriggerProps {
  children: ReactNode;
  asChild?: boolean;
  disabled?: boolean;
  className?: string;
}

export function MenuTrigger({ children, ...props }: MenuTriggerProps) {
  const { ns } = useMenuImpl();
  const Trigger = ns.Trigger;
  return <Trigger {...props}>{children}</Trigger>;
}

export const MENU_SURFACE_CLASS =
  'z-[80] min-w-52 rounded-lg border border-white/10 bg-bg-secondary/95 p-1.5 text-sm text-text-primary shadow-2xl shadow-black/50 backdrop-blur-md animate-fade-in';

type MenuContentProps = RadixDropdownMenu.DropdownMenuContentProps;

export function MenuContent({
  children,
  className = '',
  side = 'bottom',
  align = 'end',
  sideOffset = 6,
  ...props
}: MenuContentProps) {
  const { kind, ns } = useMenuImpl();
  const Portal = ns.Portal;
  const Content = ns.Content;
  // Context-menu Content positions itself at the pointer and would forward
  // these straight to the DOM as unknown attributes.
  const positioning = kind === 'dropdown' ? { side, align, sideOffset } : {};
  return (
    <Portal>
      <Content
        collisionPadding={12}
        className={`${MENU_SURFACE_CLASS} ${className}`}
        {...positioning}
        {...props}
      >
        {children}
      </Content>
    </Portal>
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

// Row geometry, shared by every item kind so a checkbox or submenu row lines up
// with a plain MenuItem. Tone is appended separately (MenuItem varies it).
const ITEM_GEOMETRY_CLASS =
  'flex h-8 select-none items-center gap-2 rounded-md px-2 outline-none transition-colors cursor-pointer data-[disabled]:cursor-default data-[disabled]:opacity-50';
const DEFAULT_TONE_CLASS = 'text-text-primary focus:bg-white/10 data-[highlighted]:bg-white/10';

export function MenuItem({ children, icon: Icon, spinning, tone = 'default', disabled, onSelect }: MenuItemProps) {
  const { ns } = useMenuImpl();
  const Item = ns.Item;
  const toneClass = tone === 'success'
    ? 'text-state-success focus:bg-state-success/10 data-[highlighted]:bg-state-success/10'
    : tone === 'danger'
      ? 'text-state-danger focus:bg-state-danger/10 data-[highlighted]:bg-state-danger/10'
      : DEFAULT_TONE_CLASS;

  return (
    <Item
      disabled={disabled}
      onSelect={(event) => {
        event.stopPropagation();
        onSelect(event);
      }}
      className={`${ITEM_GEOMETRY_CLASS} ${toneClass}`}
    >
      {Icon && <Icon className={`h-4 w-4 flex-shrink-0 text-current ${spinning ? 'animate-spin' : ''}`} />}
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </Item>
  );
}

export function MenuLabel({ children, className = '' }: { children: ReactNode; className?: string }) {
  const { ns } = useMenuImpl();
  const Label = ns.Label;
  return (
    <Label
      className={`max-w-64 truncate px-2 py-1 text-[11px] uppercase tracking-wide text-text-tertiary ${className}`}
    >
      {children}
    </Label>
  );
}

export function MenuSeparator() {
  const { ns } = useMenuImpl();
  const Separator = ns.Separator;
  return <Separator className="my-1 h-px bg-white/10" />;
}

export function MenuSub({ children }: { children: ReactNode }) {
  const { ns } = useMenuImpl();
  const Sub = ns.Sub;
  return <Sub>{children}</Sub>;
}

export function MenuSubTrigger({ children, icon: Icon }: { children: ReactNode; icon?: LucideIcon }) {
  const { ns } = useMenuImpl();
  const SubTrigger = ns.SubTrigger;
  return (
    <SubTrigger
      className={`${ITEM_GEOMETRY_CLASS} ${DEFAULT_TONE_CLASS} data-[state=open]:bg-white/10`}
    >
      {Icon && <Icon className="h-4 w-4 flex-shrink-0 text-current" />}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 opacity-60" />
    </SubTrigger>
  );
}

export function MenuSubContent({ children, className = '' }: { children: ReactNode; className?: string }) {
  const { ns } = useMenuImpl();
  const Portal = ns.Portal;
  const SubContent = ns.SubContent;
  return (
    <Portal>
      <SubContent
        collisionPadding={12}
        sideOffset={2}
        className={`${MENU_SURFACE_CLASS} ${className}`}
      >
        {children}
      </SubContent>
    </Portal>
  );
}

interface MenuCheckboxItemProps {
  children: ReactNode;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (checked: boolean) => void;
}

/**
 * Multi-select row. Radix closes the menu on select by default; ticking several
 * lists in a row is the normal case here, so we preventDefault to keep it open.
 */
export function MenuCheckboxItem({
  children,
  checked,
  disabled,
  onCheckedChange,
}: MenuCheckboxItemProps) {
  const { ns } = useMenuImpl();
  const CheckboxItem = ns.CheckboxItem;
  const ItemIndicator = ns.ItemIndicator;
  return (
    <CheckboxItem
      checked={checked}
      disabled={disabled}
      onSelect={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onCheckedChange={onCheckedChange}
      className={`${ITEM_GEOMETRY_CLASS} ${DEFAULT_TONE_CLASS}`}
    >
      <span
        className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border ${
          checked ? 'border-accent bg-accent text-accent-foreground' : 'border-border'
        }`}
      >
        <ItemIndicator>
          <Check className="h-3 w-3" />
        </ItemIndicator>
      </span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </CheckboxItem>
  );
}

interface MenuRadioGroupProps {
  children: ReactNode;
  value: string;
  onValueChange: (value: string) => void;
}

/**
 * Single-choice section (the card's locker tag, where a mod is either untagged,
 * a Global type, or one hero). Radix gives the rows role="menuitemradio" and
 * arrow-key navigation, which a list of hand-rolled buttons does not.
 */
export function MenuRadioGroup({ children, value, onValueChange }: MenuRadioGroupProps) {
  const { ns } = useMenuImpl();
  const RadioGroup = ns.RadioGroup;
  return (
    <RadioGroup value={value} onValueChange={onValueChange}>
      {children}
    </RadioGroup>
  );
}

interface MenuRadioItemProps {
  children: ReactNode;
  value: string;
  disabled?: boolean;
  /** Colour of the row while it is the selected value. */
  tone?: 'accent' | 'info';
}

export function MenuRadioItem({ children, value, disabled, tone = 'accent' }: MenuRadioItemProps) {
  const { ns } = useMenuImpl();
  const RadioItem = ns.RadioItem;
  const ItemIndicator = ns.ItemIndicator;
  const checkedToneClass = tone === 'info'
    ? 'data-[state=checked]:text-state-info'
    : 'data-[state=checked]:text-accent';
  return (
    <RadioItem
      value={value}
      disabled={disabled}
      className={`${ITEM_GEOMETRY_CLASS} ${DEFAULT_TONE_CLASS} ${checkedToneClass}`}
    >
      <span className="min-w-0 flex-1 truncate">{children}</span>
      <ItemIndicator className="flex-shrink-0">
        <Check className="h-3.5 w-3.5" />
      </ItemIndicator>
    </RadioItem>
  );
}
