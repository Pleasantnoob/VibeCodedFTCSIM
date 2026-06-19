import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[FTC Sim]', error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div
          style={{
            minHeight: '100vh',
            padding: 24,
            background: '#0b0d0d',
            color: '#e8eef8',
            fontFamily: 'system-ui, sans-serif',
          }}
        >
          <h1 style={{ marginTop: 0 }}>FTC Sim failed to start</h1>
          <p style={{ color: '#fca5a5' }}>{this.state.error.message}</p>
          <p style={{ color: '#9fb0cc', fontSize: 14 }}>
            Close the window and try again. If this keeps happening, use Play Solo first to verify the install.
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}
