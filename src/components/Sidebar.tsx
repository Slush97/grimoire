import { NavLink } from 'react-router-dom';
import {
  Package,
  Search,
  AlertTriangle,
  Layers,
  Settings,
  Gamepad2,
} from 'lucide-react';

const navItems = [
  { to: '/', icon: Package, label: 'Installed' },
  { to: '/browse', icon: Search, label: 'Browse' },
  { to: '/conflicts', icon: AlertTriangle, label: 'Conflicts' },
  { to: '/profiles', icon: Layers, label: 'Profiles' },
  { to: '/settings', icon: Settings, label: 'Settings' },
];

export default function Sidebar() {
  return (
    <aside className="w-56 bg-bg-secondary border-r border-border flex flex-col">
      {/* Logo */}
      <div className="p-4 border-b border-border">
        <div className="flex items-center gap-2">
          <Gamepad2 className="w-6 h-6 text-accent" />
          <span className="font-bold text-lg">Deadlock Mods</span>
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
