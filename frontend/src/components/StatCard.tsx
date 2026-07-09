import { LucideIcon } from "lucide-react";

interface StatCardProps {
  title: string;
  value: string;
  subtitle: string;
  icon: LucideIcon;
  subtitleColor?: "primary" | "muted";
}

export function StatCard({ title, value, subtitle, icon: Icon, subtitleColor = "primary" }: StatCardProps) {
  return (
    <div className="bg-card rounded-xl border p-5 flex items-start justify-between shadow-sm">
      <div>
        <p className="text-sm text-muted-foreground">{title}</p>
        <p className="text-2xl font-bold mt-1 text-card-foreground">{value}</p>
        <p className={`text-xs mt-1 ${subtitleColor === "primary" ? "text-primary" : "text-muted-foreground"}`}>
          {subtitle}
        </p>
      </div>
      <div className="p-3 bg-secondary rounded-xl">
        <Icon className="h-6 w-6 text-primary" />
      </div>
    </div>
  );
}
