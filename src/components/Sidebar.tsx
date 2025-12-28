import { NavLink } from 'react-router-dom';
import {
  Package,
  Search,
  Shield,
  AlertTriangle,
  Layers,
  Settings,
} from 'lucide-react';

const navItems = [
  { to: '/', icon: Package, label: 'Installed' },
  { to: '/browse', icon: Search, label: 'Browse' },
  { to: '/locker', icon: Shield, label: 'Locker' },
  { to: '/conflicts', icon: AlertTriangle, label: 'Conflicts' },
  { to: '/profiles', icon: Layers, label: 'Profiles' },
  { to: '/settings', icon: Settings, label: 'Settings' },
];

export default function Sidebar() {
  return (
    <aside className="w-56 bg-bg-secondary border-r border-border flex flex-col">
      {/* Logo */}
      <div className="px-4 py-3 border-b border-border">
        <div className="flex items-center gap-3">
          <img
            src="/branding/classic-mark.svg"
            alt="Deadlock"
            className="w-8 h-8 flex-shrink-0"
          />
          <div className="flex flex-col min-w-0">
            <img
              src="/branding/classic-wordmark.svg"
              alt="Deadlock"
              className="h-3.5 w-auto opacity-90"
            />
            <span className="font-reaver text-[10px] tracking-widest text-text-secondary uppercase">
              Mod Manager
            </span>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-2">
        <ul className="space-y-1">
          {navItems.map(({ to, icon: Icon, label }) => (
            <li key={to}>
              <NavLink
                to={to}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
                    isActive
                      ? 'bg-accent text-white'
                      : 'text-text-secondary hover:bg-bg-tertiary hover:text-text-primary'
                  }`
                }
              >
                <Icon className="w-5 h-5" />
                <span>{label}</span>
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      {/* Footer */}
      <div className="p-4 border-t border-border text-xs text-text-secondary">
        <p>v0.1.0</p>
      </div>
    </aside>
  );
}
