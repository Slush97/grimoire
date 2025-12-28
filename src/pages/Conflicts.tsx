import { AlertTriangle } from 'lucide-react';

export default function Conflicts() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-text-secondary">
      <AlertTriangle className="w-16 h-16 mb-4 opacity-50" />
      <h2 className="text-xl font-semibold text-text-primary mb-2">
        Mod Conflicts
      </h2>
      <p className="text-center max-w-md">
        View and resolve conflicts between your installed mods. Install some mods first to see conflicts.
      </p>
    </div>
  );
}
