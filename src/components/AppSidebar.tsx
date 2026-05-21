import { CalendarDays, Film, Images, Music, Settings, Sparkles, Zap } from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

const primary = [
  { title: "Autopilot", url: "/", icon: Zap },
  { title: "Clips", url: "/clips", icon: Film },
  { title: "Library", url: "/library", icon: Images },
  { title: "Lyrics", url: "/lyrics", icon: Music },
  { title: "Calendar", url: "/?mode=studio&view=calendar", icon: CalendarDays },
];

const secondary = [{ title: "Accounts", url: "/settings/accounts", icon: Settings }];

export function AppSidebar() {
  const { pathname, search } = useLocation();
  const isActive = (url: string) => {
    const [path, query] = url.split("?");
    if (query) {
      const params = new URLSearchParams(query);
      const here = new URLSearchParams(search);
      return (
        pathname === path &&
        Array.from(params.entries()).every(([k, v]) => here.get(k) === v)
      );
    }
    if (path === "/") return pathname === "/" && !search.includes("mode=studio");
    return pathname === path || pathname.startsWith(`${path}/`);
  };

  const renderItems = (items: typeof primary) => (
    <SidebarMenu>
      {items.map((item) => (
        <SidebarMenuItem key={item.title}>
          <SidebarMenuButton asChild isActive={isActive(item.url)}>
            <NavLink to={item.url} className="flex items-center gap-2 hover:bg-muted/50">
              <item.icon className="h-4 w-4" />
              <span>{item.title}</span>
            </NavLink>
          </SidebarMenuButton>
        </SidebarMenuItem>
      ))}
    </SidebarMenu>
  );

  return (
    <Sidebar collapsible="icon">
      <SidebarContent>
        <div className="brand-block">
          <span className="brand-mark">
            <Sparkles size={14} />
          </span>
          <strong>FanAgent</strong>
        </div>
        <SidebarGroup>
          <SidebarGroupContent>{renderItems(primary)}</SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupContent>{renderItems(secondary)}</SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
