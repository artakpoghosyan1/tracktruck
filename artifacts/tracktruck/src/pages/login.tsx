import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Truck, Mail, Lock, ArrowRight, Loader2 } from "lucide-react";
import { useAuthLogin } from "@workspace/api-client-react";
import { useAppStore } from "@/store/use-app-store";
import { useToast } from "@/hooks/use-toast";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [, setLocation] = useLocation();
  const { setAuthenticated } = useAppStore();
  const { toast } = useToast();

  const loginMutation = useAuthLogin({
    mutation: {
      onSuccess: (data) => {
        localStorage.setItem('tracktruck_token', data.accessToken);
        setAuthenticated(true);
        toast({ title: "Welcome back!", description: "Successfully signed in." });
        setLocation("/admin");
      },
      onError: (err: Error) => {
        toast({ 
          title: "Login failed", 
          description: err.message || "Invalid credentials",
          variant: "destructive"
        });
      }
    }
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    loginMutation.mutate({ data: { email, password } });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background relative overflow-hidden">
      {/* Background Graphic */}
      <div className="absolute inset-0 z-0">
        <img 
          src={`${import.meta.env.BASE_URL}images/auth-bg.png`} 
          alt="Abstract background" 
          className="w-full h-full object-cover opacity-60"
        />
        <div className="absolute inset-0 bg-background/40 backdrop-blur-3xl"></div>
      </div>

      <div className="w-full max-w-md z-10 px-4">
        <div className="bg-card/80 backdrop-blur-xl border border-border/50 shadow-2xl rounded-3xl p-8 relative overflow-hidden">
          <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-primary to-blue-400"></div>
          
          <div className="flex justify-center mb-8">
            <div className="w-14 h-14 bg-primary text-primary-foreground rounded-2xl flex items-center justify-center shadow-lg shadow-primary/30">
              <Truck className="w-8 h-8" />
            </div>
          </div>
          
          <div className="text-center mb-8">
            <h1 className="text-3xl font-display font-bold text-foreground">TrackTruck Live</h1>
            <p className="text-muted-foreground mt-2">Sign in to manage your fleet</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-semibold text-foreground mb-1.5 ml-1">Email</label>
              <div className="relative">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                <input 
                  type="email" 
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-11 pr-4 py-3 bg-background/50 border-2 border-border/80 focus:border-primary focus:ring-4 focus:ring-primary/10 rounded-xl transition-all outline-none"
                  placeholder="admin@example.com"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-foreground mb-1.5 ml-1">Password</label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                <input 
                  type="password" 
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-11 pr-4 py-3 bg-background/50 border-2 border-border/80 focus:border-primary focus:ring-4 focus:ring-primary/10 rounded-xl transition-all outline-none"
                  placeholder="••••••••"
                  required
                />
              </div>
            </div>

            <button 
              type="submit"
              disabled={loginMutation.isPending}
              className="w-full py-3.5 px-4 bg-primary hover:bg-primary/90 text-primary-foreground font-bold rounded-xl shadow-lg shadow-primary/25 transition-all hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-50 disabled:transform-none flex items-center justify-center gap-2 group"
            >
              {loginMutation.isPending ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <>
                  Sign In
                  <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                </>
              )}
            </button>
          </form>

          <div className="mt-8 text-center text-sm text-muted-foreground">
            Don't have an account? <Link href="/signup" className="text-primary font-semibold hover:underline">Create one</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
