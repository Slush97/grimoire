import { NavLink } from 'react-router-dom'
import { User, Globe } from 'lucide-react'

const LINKS = [
    { to: '/stats/me', label: 'My Stats', icon: User },
    { to: '/stats/meta', label: 'Meta', icon: Globe },
] as const

/**
 * Top-level segmented nav for the Stats area. Lives at the top of both
 * StatsMe and StatsMeta so users can flip between player-scoped and
 * global views without going back through the main sidebar.
 */
export default function StatsNav() {
    return (
        <div className="flex items-center gap-1 p-1 bg-bg-tertiary/40 border border-white/5 rounded-lg w-fit">
            {LINKS.map((link) => (
                <NavLink
                    key={link.to}
                    to={link.to}
                    className={({ isActive }) =>
                        `flex items-center gap-2 px-3 py-1.5 rounded-md text-sm transition-colors ${
                            isActive
                                ? 'bg-accent/20 text-accent'
                                : 'text-text-secondary hover:text-text-primary hover:bg-white/5'
                        }`
                    }
                >
                    <link.icon className="w-3.5 h-3.5" />
                    {link.label}
                </NavLink>
            ))}
        </div>
    )
}
