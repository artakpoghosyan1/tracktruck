import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { Truck, Mail, Lock, ArrowRight, Loader2 } from "lucide-react";
import { useAuthLogin, useAuthGoogle } from "@workspace/api-client-react";
import { useAppStore } from "@/store/use-app-store";
import { useToast } from "@/hooks/use-toast";
import { FriendlyErrorDialog } from "@/components/common/FriendlyErrorDialog";

declare global {
  interface Window {
    google: any;
  }
}

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [, setLocation] = useLocation();
  const { setAuthenticated } = useAppStore();
  const { toast } = useToast();
  
  const [errorDialog, setErrorDialog] = useState<{ open: boolean; type: any; message: string }>({
    open: false,
    type: "generic",
    message: ""
  });

  const returnUrl = new URLSearchParams(window.location.search).get("returnUrl");

  const handleLoginSuccess = (data: any) => {
    localStorage.setItem('tracktruck_token', data.accessToken);
    setAuthenticated(true, data.user);
    toast({ title: "Welcome back!", description: `Successfully signed in as ${data.user.name}.` });
    
    if (returnUrl && returnUrl.startsWith('/admin')) {
      setLocation(returnUrl);
    } else if (data.user.role === 'super_admin') {
      setLocation("/admin/super");
    } else {
      setLocation("/admin");
    }
  };

  const handleLoginError = (err: any) => {
    const errorData = err.response?.data;
    const status = err.response?.status;

    if (status === 402 || errorData?.error === 'payment_required') {
      setErrorDialog({ open: true, type: "payment_required", message: errorData?.message });
      return;
    }
    
    if (status === 403 && (errorData?.error === 'quota_exceeded' || errorData?.error === 'forbidden')) {
      setErrorDialog({ 
        open: true, 
        type: errorData?.error === 'quota_exceeded' ? "quota_exceeded" : "unauthorized", 
        message: errorData?.message 
      });
      return;
    }

    toast({ 
      title: "Authentication failed", 
      description: errorData?.message || "Invalid credentials. Please double-check your email and password.",
      variant: "destructive"
    });
  };

  const loginMutation = useAuthLogin({
    mutation: {
      onSuccess: handleLoginSuccess,
      onError: handleLoginError
    }
  });

  const googleMutation = useAuthGoogle({
    mutation: {
      onSuccess: handleLoginSuccess,
      onError: handleLoginError
    }
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    loginMutation.mutate({ data: { email, password } });
  };

  useEffect(() => {
    const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
    if (!googleClientId || googleClientId === "your-google-client-id.apps.googleusercontent.com") return;

    const handleGoogleResponse = (response: any) => {
      googleMutation.mutate({ data: { idToken: response.credential } });
    };

    if (window.google) {
      window.google.accounts.id.initialize({
        client_id: googleClientId,
        callback: handleGoogleResponse,
      });
      window.google.accounts.id.renderButton(
        document.getElementById("google-signin-button"),
        { theme: "outline", size: "large", width: "100%", shape: "rectangular" }
      );
    }
  }, [googleMutation]);

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
              disabled={loginMutation.isPending || googleMutation.isPending}
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

          <div className="my-6 flex items-center gap-4">
            <div className="h-px flex-1 bg-border/50"></div>
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Or continue with</span>
            <div className="h-px flex-1 bg-border/50"></div>
          </div>

          <div id="google-signin-button" className="w-full h-[50px]"></div>

          <div className="mt-8 text-center text-sm text-muted-foreground">
            Don't have an account? <Link href="/signup" className="text-primary font-semibold hover:underline">Create one</Link>
          </div>
        </div>
      </div>
      
      <FriendlyErrorDialog 
        open={errorDialog.open} 
        onOpenChange={(open) => setErrorDialog(curr => ({ ...curr, open }))}
        errorType={errorDialog.type}
        message={errorDialog.message}
      />
    </div>
  );
}
