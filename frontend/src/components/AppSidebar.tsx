import { useEffect, useState } from "react";
import { LayoutGrid, Settings, LayoutDashboard, Scale } from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useLocation } from "react-router-dom";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { findSectionByPath, getDefaultSection, resolveStoredSection, ACTIVE_MODULE_STORAGE_KEY, MenuSection } from "@/lib/navigation";
import { useDashboardLayout } from "@/hooks/useDashboardLayout";

// Overrides the shadcn SidebarMenuButton's default active styling
// (data-[active=true]:bg-sidebar-accent — a faint tint) with the intended
// solid-green active highlight. Passed as `className` so tailwind-merge resolves
// the conflicting data-[active=true]:bg-*/text-* utilities in our favor, keeping
// solid #1F7A4D + white text/icon (icons inherit currentColor) on the active item.
const ACTIVE_ITEM_OVERRIDE =
  "data-[active=true]:bg-sidebar-primary data-[active=true]:text-sidebar-primary-foreground data-[active=true]:hover:bg-sidebar-primary data-[active=true]:hover:text-sidebar-primary-foreground";

// Collapsed/icon-only overrides for nav items, applied to the SidebarMenuButton's
// className so tailwind-merge (via the button's cn(...)) drops the shadcn variant's
// collapsed `!size-8`/`!p-2`, letting ours win deterministically — source order
// can't be relied on for two equal-specificity !important rules.
//
// The cell is HARD-CAPPED at 36x36 (!size-9 + !min-w-9 !max-w-9) so it can never
// flex-grow or otherwise exceed the 48px icon rail and bleed into the content area.
// Expanded px-3/py-2.5/gap-3 is neutralized in collapsed mode (!p-0, gap-0); the
// result is a clean, centered 36x36 rounded-lg square. Scoped entirely to
// `group-data-[collapsible=icon]:` so the expanded appearance is untouched.
const COLLAPSED_ICON_CELL = [
  "group-data-[collapsible=icon]:!size-9",
  "group-data-[collapsible=icon]:!min-w-9",
  "group-data-[collapsible=icon]:!max-w-9",
  "group-data-[collapsible=icon]:!p-0",
  "group-data-[collapsible=icon]:gap-0",
  "group-data-[collapsible=icon]:shrink-0",
  "group-data-[collapsible=icon]:justify-center",
  "group-data-[collapsible=icon]:mx-auto",
  "group-data-[collapsible=icon]:rounded-lg",
  // icon sized to 18px and prevented from shrinking inside the 36px cell
  "group-data-[collapsible=icon]:[&>svg]:!size-[18px]",
  "group-data-[collapsible=icon]:[&>svg]:shrink-0",
].join(" ");

// Trims the group/footer horizontal padding in collapsed mode (the shadcn default
// p-2 leaves only 32px inside the 48px icon rail). With px-1, a 36px cell sits
// centered with ~5px clear on each side. Collapsed-only.
const COLLAPSED_GROUP_PAD = "group-data-[collapsible=icon]:px-1";

export function AppSidebar() {
  const { state, toggleSidebar, isMobile, setOpenMobile } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const { setModulesDialogOpen } = useDashboardLayout();
  const [activeSection, setActiveSection] = useState<MenuSection | null>(null);

  // Determine active section based on route + localStorage
  useEffect(() => {
    // Priority 1: Deep-link match — but treat the dashboard home route ("/") as
    // section-neutral so it never resets the user's active module. We fall through
    // to the persisted value instead and keep showing whatever module they were in.
    if (location.pathname !== "/") {
      const pathSection = findSectionByPath(location.pathname);
      if (pathSection) {
        setActiveSection(pathSection);
        localStorage.setItem(ACTIVE_MODULE_STORAGE_KEY, pathSection.label);
        return;
      }
    }

    // Priority 2: Persisted value
    const stored = localStorage.getItem(ACTIVE_MODULE_STORAGE_KEY);
    if (stored) {
      const foundSection = resolveStoredSection(stored);
      if (foundSection) {
        setActiveSection(foundSection);
        return;
      }
    }

    // Priority 3: Default
    setActiveSection(getDefaultSection());
  }, [location.pathname]);

  const handleNavClick = () => {
    if (isMobile) setOpenMobile(false);
  };

  return (
    <Sidebar collapsible="icon" className="border-r-sidebar-border group-data-[collapsible=icon]:overflow-hidden">
      <button
        type="button"
        onClick={toggleSidebar}
        className="flex items-center gap-3 px-4 py-5 w-full text-left hover:bg-sidebar-accent transition-colors group-data-[collapsible=icon]:px-1 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:overflow-hidden"
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        <span className="flex items-center justify-center shrink-0 rounded-lg bg-primary text-primary-foreground shadow-sm h-9 w-9 group-data-[collapsible=icon]:h-8 group-data-[collapsible=icon]:w-8">
          <Scale className="h-5 w-5 group-data-[collapsible=icon]:h-[18px] group-data-[collapsible=icon]:w-[18px]" />
        </span>
        {!collapsed && (
          <div className="leading-tight">
            <h1 className="text-sm font-semibold text-sidebar-foreground tracking-tight">Sri Vari Scales</h1>
            <p className="text-xs text-muted-foreground">Inventory &amp; Stamping</p>
          </div>
        )}
      </button>

      <SidebarContent>
        {/* Part B: Pinned Shortcuts */}
        <SidebarGroup className={COLLAPSED_GROUP_PAD}>
          <SidebarGroupContent>
            <SidebarMenu>
              {/* Dashboard */}
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={location.pathname === "/"}
                  className={`${ACTIVE_ITEM_OVERRIDE} ${COLLAPSED_ICON_CELL}`}
                >
                  <NavLink
                    to="/"
                    end
                    onClick={handleNavClick}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sidebar-foreground/80 hover:bg-sidebar-accent transition-colors"
                    activeClassName="bg-sidebar-primary text-sidebar-primary-foreground font-medium hover:bg-sidebar-primary"
                  >
                    <LayoutDashboard className="h-5 w-5 shrink-0" />
                    {!collapsed && <span className="flex-1">Dashboard</span>}
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>

              {/* All Modules */}
              <SidebarMenuItem>
                <SidebarMenuButton
                  onClick={() => setModulesDialogOpen(true)}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sidebar-foreground/80 hover:bg-sidebar-accent transition-colors cursor-pointer ${COLLAPSED_ICON_CELL}`}
                >
                  <LayoutGrid className="h-5 w-5 shrink-0" />
                  {!collapsed && <span className="flex-1">All Modules</span>}
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Divider */}
        <div className="mx-3 my-2 h-px bg-sidebar-border" />

        {/* Part C: Active Section */}
        {activeSection && (
          <SidebarGroup className={COLLAPSED_GROUP_PAD}>
            {!collapsed && (
              <SidebarGroupLabel className="text-[10px] uppercase tracking-wider text-primary font-medium px-3">
                {activeSection.label}
              </SidebarGroupLabel>
            )}
            <SidebarGroupContent>
              <SidebarMenu>
                {activeSection.items.map((item) => {
                  const active = location.pathname === item.url;
                  return (
                    <SidebarMenuItem key={item.title}>
                      <SidebarMenuButton asChild isActive={active} className={`${ACTIVE_ITEM_OVERRIDE} ${COLLAPSED_ICON_CELL}`}>
                        <NavLink
                          to={item.url}
                          end
                          onClick={handleNavClick}
                          className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sidebar-foreground/80 hover:bg-sidebar-accent transition-colors"
                          activeClassName="bg-sidebar-primary text-sidebar-primary-foreground font-medium hover:bg-sidebar-primary"
                        >
                          <item.icon className="h-5 w-5 shrink-0" />
                          {!collapsed && <span className="flex-1">{item.title}</span>}
                        </NavLink>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      {/* Pinned Settings — fixed at the sidebar's bottom edge */}
      <SidebarFooter className={`border-t border-sidebar-border group-data-[collapsible=icon]:overflow-hidden ${COLLAPSED_GROUP_PAD}`}>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild isActive={location.pathname === "/settings"} className={`${ACTIVE_ITEM_OVERRIDE} ${COLLAPSED_ICON_CELL}`}>
              <NavLink
                to="/settings"
                end
                onClick={handleNavClick}
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sidebar-foreground/80 hover:bg-sidebar-accent transition-colors"
                activeClassName="bg-sidebar-primary text-sidebar-primary-foreground font-medium hover:bg-sidebar-primary"
              >
                <Settings className="h-5 w-5 shrink-0" />
                {!collapsed && <span className="flex-1">Settings</span>}
              </NavLink>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
