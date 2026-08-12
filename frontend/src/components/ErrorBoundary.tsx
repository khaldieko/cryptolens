import { Component, ErrorInfo, ReactNode } from "react";

/**
 * Week 7 — Catches render-time crashes so a single broken component shows a
 * recoverable message instead of a blank white page.
 */
interface Props { children: ReactNode; }
interface State { hasError: boolean; message: string; }

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: "" };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Render error:", error, info.componentStack);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
        <div className="max-w-md text-center">
          <h1 className="text-lg font-bold text-slate-800 mb-2">Something went wrong</h1>
          <p className="text-sm text-slate-500 mb-4">
            This page hit an unexpected error. Reloading usually clears it.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 rounded-lg bg-[#0B1B33] text-white text-sm font-semibold"
          >
            Reload page
          </button>
        </div>
      </div>
    );
  }
}
