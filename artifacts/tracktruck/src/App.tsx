import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";

import Login from "@/pages/login";
import Signup from "@/pages/signup";
import Dashboard from "@/pages/admin/dashboard";
import RouteBuilder from "@/pages/admin/route-builder";
import PublicTracking from "@/pages/public/tracking";
import "@/lib/api-interceptor"; // Import the fetch interceptor globally

const queryClient = new QueryClient();

function Router() {
  return (
    <Switch>
      <Route path="/login" component={Login} />
      <Route path="/signup" component={Signup} />
      
      <Route path="/admin" component={Dashboard} />
      <Route path="/admin/routes/new" component={RouteBuilder} />
      <Route path="/admin/routes/:id/edit" component={RouteBuilder} />
      
      {/* Public Share Route MUST be last so it doesn't catch /admin */}
      <Route path="/:token" component={PublicTracking} />
      
      {/* Root redirect to login */}
      <Route path="/">
        {() => {
          window.location.href = "/login";
          return null;
        }}
      </Route>
      
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
