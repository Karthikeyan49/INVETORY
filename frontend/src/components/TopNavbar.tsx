import { Bell, ShoppingCart, MessageSquare, AlertTriangle, LayoutGrid, Maximize2, Minimize2 } from "lucide-react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useAuth } from "@/contexts/AuthContext";
import { useState, useEffect } from "react";
import { apiFetch } from "@/lib/api/client";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { useDashboardLayout } from "@/hooks/useDashboardLayout";

interface Notification {
  id: number;
  icon: React.ElementType;
  iconColor: string;
  message: string;
  time: string;
  read: boolean;
}

interface ApiNotification {
  id: string;
  type: string;
  message: string;
  time: string;
  read: boolean;
}

function timeAgo(dateString: string) {
  const diff = Date.now() - new Date(dateString).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr${hrs > 1 ? 's' : ''} ago`;
  return `${Math.floor(hrs / 24)} days ago`;
}

export function TopNavbar() {
  const { adminEmail } = useAuth();
  const { setModulesDialogOpen } = useDashboardLayout();
  const [notifications, setNotifications] = useState<ApiNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Keep the icon in sync with the browser's fullscreen state — including when the
  // user presses Esc to exit (no click), which still fires `fullscreenchange`.
  useEffect(() => {
    const onFullscreenChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch((err) => {
        console.warn("Fullscreen request failed:", err);
      });
    } else {
      document.exitFullscreen();
    }
  };

  useEffect(() => {
    // Initial fetch
    apiFetch<{ data: ApiNotification[] }>('/admin/notifications')
      .then(res => {
        setNotifications(res.data ?? []);
        setUnreadCount((res.data ?? []).filter(n => !n.read).length);
      })
      .catch(() => {});
      
    // Polling every 60 seconds
    const interval = setInterval(() => {
      apiFetch<{ data: ApiNotification[] }>('/admin/notifications')
        .then(res => {
          setNotifications(res.data ?? []);
          setUnreadCount((res.data ?? []).filter(n => !n.read).length);
        })
        .catch(() => {});
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  const markAllRead = () => {
    setNotifications(notifications.map(n => ({ ...n, read: true })));
  };

  return (
    <header className="h-16 border-b bg-card flex items-center justify-between px-3 md:px-6 shrink-0 gap-2">
      <div className="flex items-center gap-2 md:gap-4 min-w-0">
        <SidebarTrigger className="lg:hidden shrink-0" />
        <button
          onClick={() => setModulesDialogOpen(true)}
          className="p-2 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
          title="Modules"
        >
          <LayoutGrid className="h-5 w-5" />
        </button>
      </div>
      <div className="flex items-center gap-2 md:gap-4 shrink-0">
        <Popover>
          <PopoverTrigger asChild>
            <button className="relative p-2 rounded-lg hover:bg-muted transition-colors">
              <Bell className="h-5 w-5 text-muted-foreground" />
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 h-4.5 w-4.5 min-w-[18px] flex items-center justify-center bg-destructive text-destructive-foreground text-[10px] font-bold rounded-full px-1">
                  {unreadCount}
                </span>
              )}
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-80 p-0" align="end">
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <h4 className="text-sm font-semibold text-card-foreground">Notifications</h4>
              {unreadCount > 0 && (
                <Button variant="ghost" size="sm" className="text-xs h-7" onClick={markAllRead}>Mark all as read</Button>
              )}
            </div>
            <div className="max-h-80 overflow-y-auto">
              {notifications.length === 0 && (
                <div className="text-center text-sm text-muted-foreground py-8">No notifications</div>
              )}
              {notifications.map(n => {
                const Icon = n.type === 'order' ? ShoppingCart : MessageSquare;
                const iconColor = n.type === 'order' ? "text-primary" : "text-blue-500";
                return (
                  <div key={n.id} className={`flex items-start gap-3 px-4 py-3 border-b last:border-0 transition-colors ${!n.read ? "bg-muted/30" : ""}`}>
                    <div className="pt-0.5"><Icon className={`h-4 w-4 ${iconColor}`} /></div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-card-foreground leading-snug">{n.message}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{timeAgo(n.time)}</p>
                    </div>
                    {!n.read && <span className="h-2 w-2 bg-primary rounded-full mt-1.5 shrink-0" />}
                  </div>
                );
              })}
            </div>

          </PopoverContent>
        </Popover>
        <button
          onClick={toggleFullscreen}
          title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
          aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
          className="p-2 rounded-lg hover:bg-muted transition-colors"
        >
          {isFullscreen
            ? <Minimize2 className="h-5 w-5 text-muted-foreground" />
            : <Maximize2 className="h-5 w-5 text-muted-foreground" />}
        </button>
        <span className="text-sm text-muted-foreground hidden md:inline">{adminEmail}</span>
      </div>
    </header>
  );
}
