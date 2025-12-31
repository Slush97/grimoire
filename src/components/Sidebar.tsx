import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  Package,
  Search,
  Shield,
  AlertTriangle,
  Layers,
  Settings,
} from 'lucide-react';
import { getConflicts } from '../lib/api';
import { getAssetPath } from '../lib/assetPath';

export default function Sidebar() {
  const [conflictCount, setConflictCount] = useState(0);

  useEffect(() => {
    const loadConflicts = async () => {
      try {
        const conflicts = await getConflicts();
        setConflictCount(conflicts.length);
      } catch {
        setConflictCount(0);
      }
    };

    loadConflicts();

    // Refresh conflict count every 10 seconds
    const interval = setInterval(loadConflicts, 10000);
    return () => clearInterval(interval);
  }, []);

  const navItems = [
    { to: '/', icon: Package, label: 'Installed' },
    { to: '/browse', icon: Search, label: 'Browse' },
    { to: '/locker', icon: Shield, label: 'Locker' },
    { to: '/conflicts', icon: AlertTriangle, label: 'Conflicts', badge: conflictCount },
    { to: '/profiles', icon: Layers, label: 'Profiles' },
    { to: '/settings', icon: Settings, label: 'Settings' },
  ];

  return (
    <aside className="w-56 bg-bg-secondary border-r border-border flex flex-col">
      {/* Logo */}
      <div className="px-4 py-3 border-b border-border">
        <div className="flex items-center gap-3">
          <img
            src={getAssetPath('/branding/classic-mark.svg')}
            alt="Deadlock"
            className="w-8 h-8 flex-shrink-0"
          />
          <div className="flex flex-col min-w-0">
            <img
              src={getAssetPath('/branding/classic-wordmark.svg')}
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
          {navItems.map(({ to, icon: Icon, label, badge }) => (
            <li key={to}>
              <NavLink
                to={to}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${isActive
                    ? 'bg-accent text-white'
                    : 'text-text-secondary hover:bg-bg-tertiary hover:text-text-primary'
                  }`
                }
              >
                <Icon className="w-5 h-5" />
                <span className="flex-1">{label}</span>
                {badge !== undefined && badge > 0 && (
                  <span className="px-1.5 py-0.5 text-xs font-medium bg-yellow-500 text-black rounded-full min-w-[20px] text-center">
                    {badge}
                  </span>
                )}
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
