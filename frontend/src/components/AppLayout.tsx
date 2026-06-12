import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useLogout } from "../auth/useAuth";

const nav = [
  { to: "/", label: "Dashboard", end: true },
  { to: "/import", label: "Import" },
  { to: "/browse", label: "Browse" },
  { to: "/dedup", label: "Dedup" },
];

export default function AppLayout() {
  const logout = useLogout();
  const navigate = useNavigate();

  async function onLogout() {
    await logout.mutateAsync();
    navigate("/login", { replace: true });
  }

  return (
    <div className="flex h-full">
      <aside className="flex w-60 flex-col border-r border-slate-200 bg-white">
        <div className="px-5 py-4 text-lg font-semibold">MariData</div>
        <nav className="flex-1 px-2">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `block rounded-md px-3 py-2 text-sm ${
                  isActive
                    ? "bg-accent/10 font-medium text-accent"
                    : "text-slate-600 hover:bg-slate-100"
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <button
          onClick={onLogout}
          className="m-3 rounded-md border border-slate-200 py-2 text-sm text-slate-600 hover:bg-slate-100"
        >
          Log out
        </button>
      </aside>
      <main className="flex-1 overflow-auto p-8">
        <Outlet />
      </main>
    </div>
  );
}
