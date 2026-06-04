import { BrowserRouter, Routes, Route } from "react-router-dom";
import ProtectedRoute from "./components/ProtectedRoute";
import AppLayout from "./components/AppLayout";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
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
          <Route path="import" element={<Placeholder title="Import" phase={2} />} />
          <Route path="browse" element={<Placeholder title="Browse" phase={3} />} />
          <Route
            path="segments"
            element={<Placeholder title="Segments" phase={4} />}
          />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
