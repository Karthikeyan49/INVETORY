import { useState } from "react";
import { Leaf, Loader2, LogIn } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";

export default function DealerLogin() {
  const { login } = useAuth();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!identifier.trim() || !password) return toast.error("Enter your phone/email and password");
    setBusy(true);
    try {
      const ok = await login(identifier.trim(), password);
      if (!ok) toast.error("Invalid credentials, or this is not a dealer account.");
    } catch {
      toast.error("Could not sign in. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-emerald-50 via-background to-emerald-50 p-4">
      <div className="w-full max-w-sm rounded-2xl border bg-card p-7 shadow-lg">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10"><Leaf className="h-6 w-6 text-primary" /></div>
          <h1 className="text-xl font-bold text-foreground">Inventory Management System Dealer Portal</h1>
          <p className="text-sm text-muted-foreground">Sign in to manage your customers and orders.</p>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <Label className="text-xs">Phone or Email</Label>
            <Input className="mt-1" value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder="9876543210 or you@example.com" autoFocus />
          </div>
          <div>
            <Label className="text-xs">Password</Label>
            <Input className="mt-1" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
          </div>
          <Button type="submit" className="w-full gap-2" disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />} Sign in
          </Button>
        </form>
        <p className="mt-5 text-center text-xs text-muted-foreground">
          Trouble signing in? Contact your Inventory Management System account manager.
        </p>
      </div>
    </div>
  );
}
