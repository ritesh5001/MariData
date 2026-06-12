import { BrowserRouter, Routes, Route } from "react-router-dom";
import ProtectedRoute from "./components/ProtectedRoute";
import AppLayout from "./components/AppLayout";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import ImportPage from "./pages/Import";
import Browse from "./pages/Browse";
import Placeholder from "./pages/Placeholder";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          element={
            <ProtectedRoute>
              <AppLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<Dashboard />} />
          <Route path="import" element={<ImportPage />} />
          <Route path="browse" element={<Browse />} />
          <Route
            path="segments"
            element={<Placeholder title="Segments" phase={4} />}
          />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
