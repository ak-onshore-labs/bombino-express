import { Component, type ErrorInfo, type ReactNode } from 'react';
import bombinoLogo from '@/assets/bombino-logo.png';

type Props = { children: ReactNode };
type State = { hasError: boolean };

/**
 * Last resort when a render throws: logo + reload instead of a blank WebView.
 */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('AppErrorBoundary', error, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children;

    return (
      <div
        className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-white px-6"
        data-testid="screen-app-error"
      >
        <img src={bombinoLogo} alt="Bombino" className="mb-6 h-10 w-auto" />
        <p className="mb-6 max-w-sm text-center text-base text-foreground">
          Something went wrong
        </p>
        <button
          type="button"
          className="h-12 min-w-[180px] rounded-xl bg-primary px-6 text-sm font-semibold text-white"
          onClick={() => {
            window.location.reload();
          }}
          data-testid="button-app-error-reload"
        >
          Reload
        </button>
      </div>
    );
  }
}
