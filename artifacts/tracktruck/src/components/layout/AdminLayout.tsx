import { ReactNode, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { Map, LayoutDashboard, Truck, LogOut, Loader2, ShieldCheck } from "lucide-react";
import { useAuthMe, getAuthMeQueryKey } from "@workspace/api-client-react";
import { useAppStore } from "@/store/use-app-store";

interface AdminLayoutProps {
  children: ReactNode;
  fullscreen?: boolean;
}

export function AdminLayout({ children, fullscreen = false }: AdminLayoutProps) {
  const [location, setLocation] = useLocation();
  const { setAuthenticated } = useAppStore();
  
  const { data: user, isLoading, isError } = useAuthMe({
    query: {
      queryKey: getAuthMeQueryKey(),
      retry: false,
    },
  });

  useEffect(() => {
    if (!isLoading && !isError && user) {
      setAuthenticated(true, user as any);
    } else if (!isLoading && (isError || !user)) {
      localStorage.removeItem('tracktruck_token');
      setAuthenticated(false);
      setLocation("/login");
    }
  }, [isLoading, isError, user, setAuthenticated, setLocation]);

  if (isLoading) {
    return (
      <div className="h-screen flex flex-col items-center justify-center bg-background">
        <Loader2 className="w-10 h-10 animate-spin text-primary mb-4" />
        <p className="text-muted-foreground font-medium animate-pulse">Loading workspace...</p>
      </div>
    );
  }

  if (isError || !user) {
    return null;
  }

  const handleLogout = () => {
    localStorage.removeItem('tracktruck_token');
    setAuthenticated(false);
    setLocation("/login");
  };

  const navItems = [
    { label: "Dashboard", href: "/admin", icon: LayoutDashboard },
    { label: "Create Route", href: "/admin/routes/new", icon: Map },
  ];

  if (user.role === 'super_admin' || user.role === 'admin') {
    navItems.push({ label: "Clients", href: "/admin/super", icon: ShieldCheck });
  }

  return (
    <div className="h-screen overflow-hidden bg-background flex flex-col md:flex-row">
      {/* Sidebar */}
      <aside className="w-full md:w-72 bg-card border-r border-border/60 flex flex-col shadow-sm z-10 shrink-0">
        <div className="p-6 flex items-center gap-3 border-b border-border/50">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-primary to-blue-400 flex items-center justify-center shadow-lg shadow-primary/20">
            <Truck className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="font-display font-bold text-xl text-foreground leading-none">TrackTruck</h1>
            <span className="text-xs font-semibold text-primary uppercase tracking-wider">Live Admin</span>
          </div>
        </div>
        
        <div className="p-4 flex-1 overflow-y-auto">
          <nav className="space-y-2">
            {navItems.map((item) => {
              const active = location === item.href || (item.href !== '/admin' && location.startsWith(item.href));
              return (
                <Link 
                  key={item.href} 
                  href={item.href}
                  className={`
                    w-full flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-all duration-200
                    ${active 
                      ? 'bg-primary/10 text-primary shadow-sm shadow-primary/5' 
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'}
                  `}
                >
                  <item.icon className={`w-5 h-5 ${active ? 'text-primary' : ''}`} />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="p-4 border-t border-border/50 bg-muted/20 shrink-0">
          <div className="flex items-center gap-3 mb-4 px-2">
            <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold">
              {user.name.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-foreground truncate">{user.name}</p>
              <p className="text-xs text-muted-foreground truncate">{user.email}</p>
            </div>
          </div>
          <button 
            onClick={handleLogout}
            className="w-full flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium text-destructive hover:bg-destructive/10 transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 min-h-0 overflow-y-auto">
        {fullscreen ? (
          <div className="h-full flex flex-col">
            {children}
          </div>
        ) : (
          <div className="p-6 md:p-10 max-w-7xl mx-auto">
            {children}
          </div>
        )}
      </main>
    </div>
  );
}
