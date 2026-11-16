import { Navigate } from "react-router-dom";

export function IntegrationSetupPage() {
  return <Navigate to="/app?settings=connections" replace />;
}
