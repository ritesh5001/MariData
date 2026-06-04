import { Navigate, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { useAuth } from "../auth/useAuth";

// Gate for protected routes: while resolving show nothing; if unauthenticated redirect to
// /login (remembering where we came from); otherwise render children.
export default function ProtectedRoute({ children }: { children: ReactNode }) {
  const { data, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-400">
        Loading...
      </div>
    );
  }

  if (!data?.authenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <>{children}</>;
}
