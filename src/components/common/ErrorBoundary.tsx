import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import Tx from '../translation/Tx';

interface ErrorBoundaryProps {
    children: ReactNode;
    fallback?: ReactNode;
}

interface ErrorBoundaryState {
    hasError: boolean;
    error: Error | null;
    errorInfo: ErrorInfo | null;
}

/**
 * Error boundary component that catches JavaScript errors in child components.
 * Prevents the entire app from crashing when a single component fails.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
    constructor(props: ErrorBoundaryProps) {
        super(props);
        this.state = {
            hasError: false,
            error: null,
            errorInfo: null,
        };
    }

    static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
        this.setState({ errorInfo });
        // Log error to console for debugging
        console.error('[ErrorBoundary] Caught error:', error);
        console.error('[ErrorBoundary] Component stack:', errorInfo.componentStack);
    }

    handleReset = (): void => {
        this.setState({ hasError: false, error: null, errorInfo: null });
    };

    render(): ReactNode {
        if (this.state.hasError) {
            // Custom fallback if provided
            if (this.props.fallback) {
                return this.props.fallback;
            }

            // Default error UI
            return (
                <div className="flex flex-col items-center justify-center h-full p-8 text-center">
                    <div className="p-4 bg-red-500/10 rounded-full mb-4">
                        <AlertTriangle className="w-12 h-12 text-red-400" />
                    </div>
                    <h2 className="text-xl font-bold text-text-primary mb-2">
                        <Tx k="common.errorBoundary.title" fallback="Something went wrong" />
                    </h2>
                    <p className="text-text-secondary max-w-md mb-4">
                        <Tx
                            k="common.errorBoundary.description"
                            fallback="An error occurred while rendering this component. This won't affect other parts of the app."
                        />
                    </p>
                    {this.state.error && (
                        <pre className="text-xs text-red-400 bg-red-500/5 border border-red-500/20 rounded-lg p-3 mb-4 max-w-lg overflow-auto">
                            {this.state.error.message}
                        </pre>
                    )}
                    <button
                        onClick={this.handleReset}
                        className="flex items-center gap-2 px-4 py-2 border border-accent/40 bg-accent/10 hover:bg-accent/20 hover:border-accent/60 text-text-primary rounded-lg transition-colors cursor-pointer"
                    >
                        <RefreshCw className="w-4 h-4" />
                        <Tx k="common.errorBoundary.tryAgain" fallback="Try Again" />
                    </button>
                </div>
            );
        }

        return this.props.children;
    }
}
