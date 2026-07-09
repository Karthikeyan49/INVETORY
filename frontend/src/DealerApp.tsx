import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Leaf, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import DealerLogin from "@/pages/dealer/DealerLogin";
import DealerPortal from "@/pages/dealer/DealerPortal";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 60_000, gcTime: 10 * 60_000, refetchOnWindowFocus: false, retry: 1 },
  },
});

function Gate() {
  const { isAuthenticated, loading, role, logout } = useAuth();

  if (loading) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!isAuthenticated) return <DealerLogin />;

  // A non-dealer (e.g. admin) logged into the dealer site — send them away politely.
  if (role !== "dealer") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-muted/30 p-6 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10"><Leaf className="h-6 w-6 text-primary" /></div>
        <div>
          <p className="font-semibold text-foreground">This portal is for dealers only.</p>
          <p className="text-sm text-muted-foreground">Please use the staff admin site with this account.</p>
        </div>
        <Button variant="outline" onClick={logout} className="gap-1.5"><LogOut className="h-4 w-4" /> Sign out</Button>
      </div>
    );
  }

  return <DealerPortal />;
}

export default function DealerApp() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider>
          <Sonner />
          <Gate />
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
