import { Layers } from 'lucide-react';

export default function Profiles() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-text-secondary">
      <Layers className="w-16 h-16 mb-4 opacity-50" />
      <h2 className="text-xl font-semibold text-text-primary mb-2">
        Mod Profiles
      </h2>
      <p className="text-center max-w-md">
        Save and switch between different mod configurations. Create your first profile to get started.
      </p>
    </div>
  );
}
