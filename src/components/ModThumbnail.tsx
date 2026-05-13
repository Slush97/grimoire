import { EyeOff } from 'lucide-react';

interface ModThumbnailProps {
  src?: string;
  alt: string;
  nsfw?: boolean;
  hideNsfw?: boolean;
  className?: string;
  imageClassName?: string;
  fallback?: React.ReactNode;
}

export default function ModThumbnail({
  src,
  alt,
  nsfw,
  hideNsfw,
  className = '',
  imageClassName = '',
  fallback,
}: ModThumbnailProps) {
  const shouldBlur = nsfw && hideNsfw;

  if (!src) {
    return (
      fallback ?? (
        <div className={`flex items-center justify-center text-text-secondary text-xs ${className}`}>
          No preview
        </div>
      )
    );
  }

  return (
    <div className={`relative overflow-hidden ${className}`}>
      <div className={`w-full h-full ${imageClassName}`}>
        <img
          src={src}
          alt={alt}
          className={`block w-full h-full object-cover transition-[filter] duration-200 ${
            shouldBlur ? 'blur-xl scale-110' : ''
          }`}
        />
      </div>
      {shouldBlur && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/30">
          <EyeOff className="w-4 h-4 text-white/70" />
          <span className="text-[9px] text-white/70 mt-0.5">NSFW</span>
        </div>
      )}
    </div>
  );
}
