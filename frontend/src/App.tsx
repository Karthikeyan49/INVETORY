import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { useBrandTheme } from "@/hooks/useBrandTheme";
import { DashboardLayout } from "@/components/DashboardLayout";
import Dashboard from "./pages/Dashboard";
import Machines from "./pages/Machines";
import MachineIssues from "./pages/MachineIssues";
import MachineMovementsLog from "./pages/MachineMovementsLog";
import InventoryItems from "./pages/InventoryItems";
import Purchases from "./pages/Purchases";
import Vendors from "./pages/Vendors";
import PurchaseOrders from "./pages/PurchaseOrders";
import Stamping from "./pages/Stamping";
import Followups from "./pages/Followups";
import Deliveries from "./pages/Deliveries";
import CashBills from "./pages/CashBills";
import Orders from "./pages/Orders";
import Customers from "./pages/Customers";
import Invoices from "./pages/Invoices";
import Expenses from "./pages/Expenses";
import Finance from "./pages/Finance";
import FinancialStatements from "./pages/FinancialStatements";
import CapitalLoans from "./pages/CapitalLoans";
import Reports from "./pages/Reports";
import Employees from "./pages/Employees";
import Attendance from "./pages/Attendance";
import Payroll from "./pages/Payroll";
import Incentives from "./pages/Incentives";
import Dcr from "./pages/Dcr";
import AdvanceRegister from "./pages/AdvanceRegister";
import SettingsPage from "./pages/Settings";
import Queries from "./pages/Queries";
import Insights from "./pages/Insights";
import SalesBilling from "./pages/SalesBilling";
import QuotationBuilder from "./pages/QuotationBuilder";
import FinancePlanning from "./pages/FinancePlanning";
import DataInterop from "./pages/DataInterop";
import InventoryDashboard from "./pages/inventory/InventoryDashboard";
import InventoryIntelligence from "./pages/inventory/InventoryIntelligence";
import Spares from "./pages/inventory/Spares";
import Login from "./pages/Login";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,          // treat data as fresh for 1 min → no refetch storm on navigation
      gcTime: 10 * 60_000,        // keep cached data for 10 min after a page unmounts
      refetchOnWindowFocus: false,// don't refetch every time the tab regains focus
      retry: 1,
    },
  },
});

function ProtectedRoutes() {
  const { isAuthenticated, loading } = useAuth();

  // Apply the tenant's brand color to the runtime CSS theme once authenticated.
  useBrandTheme(isAuthenticated);

  if (loading) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">Loading…</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }


  return (
    <DashboardLayout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/machines" element={<Machines />} />
        <Route path="/machine-issues" element={<MachineIssues />} />
        <Route path="/movements" element={<MachineMovementsLog />} />
        <Route path="/inventory-items" element={<InventoryItems />} />
        <Route path="/spares" element={<Spares />} />
        <Route path="/purchases" element={<Purchases />} />
        <Route path="/vendors" element={<Vendors />} />
        <Route path="/purchase-orders" element={<PurchaseOrders />} />
        <Route path="/stamping" element={<Stamping />} />
        <Route path="/followups" element={<Followups />} />
        <Route path="/dcr" element={<Dcr />} />
        <Route path="/deliveries" element={<Deliveries />} />
        <Route path="/cash-bills" element={<CashBills />} />
        <Route path="/orders" element={<Orders />} />
        <Route path="/customers" element={<Customers />} />
        <Route path="/invoices" element={<Invoices />} />
        <Route path="/sales-billing" element={<SalesBilling />} />
        <Route path="/quotation-builder" element={<QuotationBuilder />} />
        <Route path="/expenses" element={<Expenses />} />
        <Route path="/finance" element={<Finance />} />
        <Route path="/financial-statements" element={<FinancialStatements />} />
        <Route path="/capital-loans" element={<CapitalLoans />} />
        <Route path="/finance-planning" element={<FinancePlanning />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/employees" element={<Employees />} />
        <Route path="/attendance" element={<Attendance />} />
        <Route path="/payroll" element={<Payroll />} />
        <Route path="/incentives" element={<Incentives />} />
        <Route path="/advance-register" element={<AdvanceRegister />} />
        <Route path="/queries" element={<Queries />} />
        <Route path="/insights" element={<Insights />} />
        <Route path="/data-interop" element={<DataInterop />} />
        <Route path="/inventory" element={<InventoryDashboard />} />
        <Route path="/inventory/intelligence" element={<InventoryIntelligence />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </DashboardLayout>
  );
}

function LoginRoute() {
  const { isAuthenticated, loading } = useAuth();
  if (loading) return null; // wait for session check before deciding
  if (isAuthenticated) return <Navigate to="/" replace />;
  return <Login />;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginRoute />} />
            <Route path="/*" element={<ProtectedRoutes />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
