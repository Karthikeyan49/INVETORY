import {
  LayoutDashboard,
  Store,
  Users,
  UserPlus,
  ShoppingCart,
  FileText,
  UserCheck,
  MessageSquare,
  HelpCircle,
  Calculator,
  Wallet,
  LineChart,
  Receipt,
  FileBarChart2,
  Contact2,
  ClipboardCheck,
  BadgeIndianRupee,
  ListTodo,
  CalendarClock,
  BookOpen,
  GitBranch,
  Sparkles,
  Warehouse,
  FileStack,
  Network,
  DatabaseZap,
  ShieldCheck,
  Boxes,
  PackageCheck,
  ArrowLeftRight,
  ScanLine,
  Stamp,
  BellRing,
  Truck,
  Wrench,
} from "lucide-react";

export type MenuItem = { title: string; url: string; icon: typeof LayoutDashboard };
export type MenuSection = { label: string; items: MenuItem[] };

export const sections: MenuSection[] = [
  {
    label: "Overview",
    items: [{ title: "Dashboard", url: "/", icon: LayoutDashboard }],
  },
  {
    label: "Inventory",
    items: [
      { title: "Dashboard",      url: "/inventory",      icon: LayoutDashboard },
      { title: "Machines",       url: "/machines",       icon: Boxes },
      { title: "Machine Issues", url: "/machine-issues", icon: Wrench },
      { title: "Items",          url: "/inventory-items", icon: PackageCheck },
      { title: "Spares",         url: "/spares",         icon: Wrench },
      { title: "Stamping",       url: "/stamping",       icon: Stamp },
      { title: "Movements",      url: "/movements", icon: ArrowLeftRight },
    ],
  },
  {
    label: "Sales",
    items: [
      { title: "Orders", url: "/orders", icon: ShoppingCart },
      { title: "Invoices", url: "/invoices", icon: FileText },
      { title: "Delivery Challans", url: "/deliveries", icon: Truck },
      { title: "Quotation Builder", url: "/quotation-builder", icon: FileText },
    ],
  },
  {
    label: "Purchase",
    items: [
      { title: "Purchases", url: "/purchases", icon: Store },
      { title: "Purchase Orders", url: "/purchase-orders", icon: FileStack },
      { title: "Expenses", url: "/expenses", icon: Wallet },
    ],
  },
  {
    label: "Finance",
    items: [
      { title: "Financial Statements", url: "/financial-statements", icon: FileStack },
      { title: "Capital & Loans", url: "/capital-loans", icon: BadgeIndianRupee },
      { title: "GST Compliance", url: "/sales-billing", icon: Receipt },
      { title: "Profit & Loss", url: "/finance", icon: LineChart },
      { title: "Finance Planning", url: "/finance-planning", icon: FileBarChart2 },
      { title: "Reports", url: "/reports", icon: FileBarChart2 },
    ],
  },
  {
    label: "Human Resources",
    items: [
      { title: "Employees", url: "/employees", icon: Contact2 },
      { title: "Attendance", url: "/attendance", icon: ClipboardCheck },
      { title: "Payroll", url: "/payroll", icon: BadgeIndianRupee },
      { title: "Incentives", url: "/incentives", icon: BadgeIndianRupee },
      { title: "Advance Register", url: "/advance-register", icon: Wallet },
    ],
  },
  {
    label: "Customer Care",
    items: [
      { title: "Follow-ups", url: "/followups", icon: BellRing },
      { title: "Daily Call Report", url: "/dcr", icon: ClipboardCheck },
      { title: "Customer Complaints", url: "/queries", icon: MessageSquare },
    ],
  },
  {
    label: "Intelligence",
    items: [
      { title: "AI Insights", url: "/insights", icon: Sparkles },
    ],
  },
  {
    label: "Admin",
    items: [
      { title: "Data Interop", url: "/data-interop", icon: DatabaseZap },
    ],
  },
];

export function findSectionByPath(pathname: string): MenuSection | null {
  for (const section of sections) {
    for (const item of section.items) {
      if (item.url === pathname) {
        return section;
      }
    }
  }
  return null;
}

export function getDefaultSection(): MenuSection {
  return sections[1]; // Inventory
}

export const ACTIVE_MODULE_STORAGE_KEY = "eco_active_module_section";

// Maps legacy persisted section labels to their current label, so existing users
// whose stored value predates a rename still resolve to the correct section.
const LEGACY_SECTION_LABELS: Record<string, string> = {
  Warehouse: "Inventory",
  "Customer Engagement": "Customer Care",
};

export function resolveStoredSection(stored: string): MenuSection | undefined {
  const label = LEGACY_SECTION_LABELS[stored] ?? stored;
  return sections.find((s) => s.label === label);
}
