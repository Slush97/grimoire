import { useState, useRef, useEffect } from 'react';
import { Play, Pause, Volume2, VolumeX } from 'lucide-react';

interface AudioPreviewPlayerProps {
    src: string;
    className?: string;
    compact?: boolean;
    volume?: number; // 0-1, externally controlled volume
    onPlay?: () => void; // Called when playback starts (to pause others)
}

// Global reference to currently playing audio for single-audio playback
let currentlyPlaying: HTMLAudioElement | null = null;

export default function AudioPreviewPlayer({
    src,
    className = '',
    compact = false,
    volume = 1,
    onPlay
}: AudioPreviewPlayerProps) {
    const audioRef = useRef<HTMLAudioElement>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [isMuted, setIsMuted] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(false);

    // Apply external volume to audio element
    useEffect(() => {
        if (audioRef.current) {
            audioRef.current.volume = volume;
        }
    }, [volume]);

    // Format time as m:ss
    const formatTime = (seconds: number): string => {
        if (!isFinite(seconds) || seconds < 0) return '0:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    // Progress percentage for the bar
    const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

    // Toggle play/pause
    const togglePlay = (e: React.MouseEvent) => {
        e.stopPropagation(); // Prevent card click
        const audio = audioRef.current;
        if (!audio) return;

        if (isPlaying) {
            audio.pause();
        } else {
            // Stop any other playing audio
            if (currentlyPlaying && currentlyPlaying !== audio) {
                currentlyPlaying.pause();
                currentlyPlaying.currentTime = 0;
            }
            currentlyPlaying = audio;
            onPlay?.();
            setIsLoading(true);
            audio.play().catch(() => {
                setError(true);
                setIsLoading(false);
            });
        }
    };

    // Toggle mute
    const toggleMute = (e: React.MouseEvent) => {
        e.stopPropagation();
        const audio = audioRef.current;
        if (!audio) return;
        audio.muted = !audio.muted;
        setIsMuted(audio.muted);
    };

    // Seek when clicking progress bar
    const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
        e.stopPropagation();
        const audio = audioRef.current;
        if (!audio || !duration) return;

        const rect = e.currentTarget.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const percentage = clickX / rect.width;
        audio.currentTime = percentage * duration;
    };

    // Audio event handlers
    useEffect(() => {
        const audio = audioRef.current;
        if (!audio) return;

        // Set initial volume
        audio.volume = volume;

        const handleTimeUpdate = () => setCurrentTime(audio.currentTime);
        const handleDurationChange = () => setDuration(audio.duration);
        const handlePlay = () => {
            setIsPlaying(true);
            setIsLoading(false);
        };
        const handlePause = () => setIsPlaying(false);
        const handleEnded = () => {
            setIsPlaying(false);
            setCurrentTime(0);
        };
        const handleError = () => {
            setError(true);
            setIsLoading(false);
        };
        const handleCanPlay = () => setIsLoading(false);

        audio.addEventListener('timeupdate', handleTimeUpdate);
        audio.addEventListener('durationchange', handleDurationChange);
        audio.addEventListener('play', handlePlay);
        audio.addEventListener('pause', handlePause);
        audio.addEventListener('ended', handleEnded);
        audio.addEventListener('error', handleError);
        audio.addEventListener('canplay', handleCanPlay);

        return () => {
            audio.removeEventListener('timeupdate', handleTimeUpdate);
            audio.removeEventListener('durationchange', handleDurationChange);
            audio.removeEventListener('play', handlePlay);
            audio.removeEventListener('pause', handlePause);
            audio.removeEventListener('ended', handleEnded);
            audio.removeEventListener('error', handleError);
            audio.removeEventListener('canplay', handleCanPlay);

            // Stop playback on unmount
            if (currentlyPlaying === audio) {
                audio.pause();
                currentlyPlaying = null;
            }
        };
    }, []);

    if (error) {
        return (
            <div className={`flex items-center justify-center text-text-secondary text-xs ${className}`}>
                Audio unavailable
            </div>
        );
    }

    return (
        <div
            className={`flex items-center gap-2 bg-bg-tertiary/50 rounded-lg ${compact ? 'px-2 py-1.5' : 'px-3 py-2'} ${className}`}
            onClick={(e) => e.stopPropagation()}
        >
            <audio ref={audioRef} src={src} preload="metadata" />

            {/* Play/Pause Button */}
            <button
                onClick={togglePlay}
                className={`flex-shrink-0 flex items-center justify-center rounded-full bg-accent hover:bg-accent-hover text-white transition-colors ${compact ? 'w-6 h-6' : 'w-8 h-8'
                    }`}
                title={isPlaying ? 'Pause' : 'Play'}
            >
                {isLoading ? (
                    <div className={`animate-spin rounded-full border-2 border-white border-t-transparent ${compact ? 'w-3 h-3' : 'w-4 h-4'}`} />
                ) : isPlaying ? (
                    <Pause className={compact ? 'w-3 h-3' : 'w-4 h-4'} />
                ) : (
                    <Play className={`${compact ? 'w-3 h-3' : 'w-4 h-4'} ml-0.5`} />
                )}
            </button>

            {/* Progress Bar */}
            <div
                className="flex-1 h-1.5 bg-bg-primary rounded-full cursor-pointer group"
                onClick={handleSeek}
            >
                <div
                    className="h-full bg-accent rounded-full relative transition-all"
                    style={{ width: `${progress}%` }}
                >
                    <div className="absolute right-0 top-1/2 -translate-y-1/2 w-2.5 h-2.5 bg-white rounded-full shadow opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
            </div>

            {/* Time Display */}
            <span className={`text-text-secondary flex-shrink-0 tabular-nums ${compact ? 'text-[10px]' : 'text-xs'}`}>
                {formatTime(currentTime)}{!compact && ` / ${formatTime(duration)}`}
            </span>

            {/* Mute Button (only in non-compact mode) */}
            {!compact && (
                <button
                    onClick={toggleMute}
                    className="flex-shrink-0 text-text-secondary hover:text-text-primary transition-colors"
                    title={isMuted ? 'Unmute' : 'Mute'}
                >
                    {isMuted ? (
                        <VolumeX className="w-4 h-4" />
                    ) : (
                        <Volume2 className="w-4 h-4" />
                    )}
                </button>
            )}
        </div>
    );
}
