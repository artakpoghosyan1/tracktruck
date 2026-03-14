import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Truck, Mail, Lock, User, ArrowRight, Loader2 } from "lucide-react";
import { useAuthSignup } from "@workspace/api-client-react";
import { useAppStore } from "@/store/use-app-store";
import { useToast } from "@/hooks/use-toast";

export default function Signup() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [, setLocation] = useLocation();
  const { setAuthenticated } = useAppStore();
  const { toast } = useToast();

  const signupMutation = useAuthSignup({
    mutation: {
      onSuccess: (data) => {
        localStorage.setItem('tracktruck_token', data.accessToken);
        setAuthenticated(true);
        toast({ title: "Account created!", description: "Welcome to TrackTruck." });
        setLocation("/admin");
      },
      onError: (err: any) => {
        toast({ 
          title: "Signup failed", 
          description: err?.response?.data?.message || "An error occurred",
          variant: "destructive"
        });
      }
    }
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    signupMutation.mutate({ data: { name, email, password } });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background relative overflow-hidden">
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
          
          <div className="flex justify-center mb-6">
            <div className="w-12 h-12 bg-primary/10 text-primary rounded-xl flex items-center justify-center">
              <Truck className="w-6 h-6" />
            </div>
          </div>
          
          <div className="text-center mb-8">
            <h1 className="text-2xl font-display font-bold text-foreground">Create Account</h1>
            <p className="text-muted-foreground mt-1">Get started with TrackTruck Live</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <div className="relative">
                <User className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                <input 
                  type="text" 
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full pl-11 pr-4 py-3 bg-background/50 border-2 border-border/80 focus:border-primary focus:ring-4 focus:ring-primary/10 rounded-xl transition-all outline-none"
                  placeholder="Full Name"
                  required
                />
              </div>
            </div>

            <div>
              <div className="relative">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                <input 
                  type="email" 
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-11 pr-4 py-3 bg-background/50 border-2 border-border/80 focus:border-primary focus:ring-4 focus:ring-primary/10 rounded-xl transition-all outline-none"
                  placeholder="Email Address"
                  required
                />
              </div>
            </div>

            <div>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                <input 
                  type="password" 
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-11 pr-4 py-3 bg-background/50 border-2 border-border/80 focus:border-primary focus:ring-4 focus:ring-primary/10 rounded-xl transition-all outline-none"
                  placeholder="Password (min 8 chars)"
                  required
                  minLength={8}
                />
              </div>
            </div>

            <button 
              type="submit"
              disabled={signupMutation.isPending}
              className="w-full py-3.5 px-4 mt-2 bg-primary hover:bg-primary/90 text-primary-foreground font-bold rounded-xl shadow-lg shadow-primary/25 transition-all hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-50 disabled:transform-none flex items-center justify-center gap-2 group"
            >
              {signupMutation.isPending ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <>
                  Sign Up
                  <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                </>
              )}
            </button>
          </form>

          <div className="mt-6 text-center text-sm text-muted-foreground">
            Already have an account? <Link href="/login" className="text-primary font-semibold hover:underline">Sign in</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
