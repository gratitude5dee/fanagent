import { CalendarDays, Film, Images, LayoutDashboard, Music, Settings } from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

const items = [
  { title: "Autopilot", url: "/", icon: LayoutDashboard },
  { title: "Clips", url: "/clips", icon: Film },
  { title: "Library", url: "/library", icon: Images },
  { title: "Lyrics", url: "/lyrics", icon: Music },
  { title: "Calendar", url: "/?mode=studio&view=calendar", icon: CalendarDays },
  { title: "Accounts", url: "/settings/accounts", icon: Settings },
];

export function AppSidebar() {
  const { pathname } = useLocation();
  const isActive = (url: string) => {
    const path = url.split("?")[0];
    if (path === "/") return pathname === "/";
    return pathname === path || pathname.startsWith(`${path}/`);
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>FanAgent</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild isActive={isActive(item.url)}>
                    <NavLink to={item.url} className="flex items-center gap-2">
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
