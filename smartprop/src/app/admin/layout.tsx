import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AdminLogoutButton } from '@/components/AdminLogoutButton';
import { ADMIN_SESSION_COOKIE, isValidAdminSession } from '@/lib/admin-auth';
import { 
  Home, 
  Users, 
  MessageSquare, 
  Zap, 
  BarChart3, 
  Target,
  Activity,
  CheckCircle,
  Star,
  ChevronDown
} from 'lucide-react';

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const token = cookieStore.get(ADMIN_SESSION_COOKIE)?.value;

  if (!await isValidAdminSession(token)) {
    redirect('/login?next=/admin');
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top Navbar */}
      <nav className="bg-white border-b border-gray-200 px-4 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center space-x-4 lg:space-x-6">
            <Link href="/admin" className="text-xl font-bold text-gray-900 flex items-center space-x-2 flex-shrink-0">
              <span>SmartProp Admin</span>
              <Badge variant="secondary" className="bg-green-100 text-green-800">
                <Activity className="h-3 w-3 mr-1" />
                Live
              </Badge>
            </Link>
            
            {/* Primary Pages Navigation */}
            <div className="hidden md:flex space-x-1 lg:space-x-2 flex-wrap">
              <Link href="/admin/listings">
                <Button variant="ghost" size="sm" className="flex items-center space-x-2 px-3 py-2 hover:bg-green-50">
                  <Home className="h-4 w-4" />
                  <span>Listings</span>
                  <CheckCircle className="h-3 w-3 text-green-500" />
                </Button>
              </Link>
              
              <Link href="/admin/agents">
                <Button variant="ghost" size="sm" className="flex items-center space-x-2 px-3 py-2 hover:bg-purple-50">
                  <Users className="h-4 w-4" />
                  <span>Agents</span>
                  <CheckCircle className="h-3 w-3 text-green-500" />
                </Button>
              </Link>
              
              <Link href="/admin/outreach">
                <Button variant="ghost" size="sm" className="flex items-center space-x-2 px-3 py-2 hover:bg-yellow-50">
                  <MessageSquare className="h-4 w-4" />
                  <span>Outreach</span>
                  <CheckCircle className="h-3 w-3 text-green-500" />
                </Button>
              </Link>
              
              <Link href="/admin/scraper">
                <Button variant="ghost" size="sm" className="flex items-center space-x-2 px-3 py-2 hover:bg-orange-50">
                  <Zap className="h-4 w-4" />
                  <span>Scraper</span>
                  <CheckCircle className="h-3 w-3 text-green-500" />
                </Button>
              </Link>
              
              <Link href="/admin/articles">
                <Button variant="ghost" size="sm" className="flex items-center space-x-2 px-3 py-2 hover:bg-indigo-50">
                  <BarChart3 className="h-4 w-4" />
                  <span>Articles</span>
                  <CheckCircle className="h-3 w-3 text-green-500" />
                </Button>
              </Link>
              
              <Link href="/admin/viewings">
                <Button variant="ghost" size="sm" className="flex items-center space-x-2 px-3 py-2 hover:bg-teal-50">
                  <Target className="h-4 w-4" />
                  <span>Viewings</span>
                  <CheckCircle className="h-3 w-3 text-green-500" />
                </Button>
              </Link>
              
              <Link href="/admin/linkedin">
                <Button variant="ghost" size="sm" className="flex items-center space-x-2 px-3 py-2 hover:bg-blue-50">
                  <MessageSquare className="h-4 w-4" />
                  <span>LinkedIn</span>
                  <CheckCircle className="h-3 w-3 text-green-500" />
                </Button>
              </Link>
            </div>
          </div>
          
          {/* Mobile Primary Pages Dropdown */}
          <div className="md:hidden">
            <div className="relative group">
              <Button variant="outline" size="sm" className="flex items-center space-x-1">
                <span>Primary Pages</span>
                <CheckCircle className="h-3 w-3 text-green-500" />
                <ChevronDown className="h-4 w-4" />
              </Button>
              <div className="absolute right-0 mt-2 w-48 bg-white rounded-md shadow-lg border border-gray-200 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50">
                <div className="py-1">
                  <Link href="/admin/listings" className="block px-4 py-2 text-sm text-gray-700 hover:bg-green-50 flex items-center space-x-2">
                    <Home className="h-4 w-4" />
                    <span>Listings</span>
                    <CheckCircle className="h-3 w-3 text-green-500" />
                  </Link>
                  <Link href="/admin/agents" className="block px-4 py-2 text-sm text-gray-700 hover:bg-purple-50 flex items-center space-x-2">
                    <Users className="h-4 w-4" />
                    <span>Agents</span>
                    <CheckCircle className="h-3 w-3 text-green-500" />
                  </Link>
                  <Link href="/admin/outreach" className="block px-4 py-2 text-sm text-gray-700 hover:bg-yellow-50 flex items-center space-x-2">
                    <MessageSquare className="h-4 w-4" />
                    <span>Outreach</span>
                    <CheckCircle className="h-3 w-3 text-green-500" />
                  </Link>
                  <Link href="/admin/scraper" className="block px-4 py-2 text-sm text-gray-700 hover:bg-orange-50 flex items-center space-x-2">
                    <Zap className="h-4 w-4" />
                    <span>Scraper</span>
                    <CheckCircle className="h-3 w-3 text-green-500" />
                  </Link>
                  <Link href="/admin/articles" className="block px-4 py-2 text-sm text-gray-700 hover:bg-indigo-50 flex items-center space-x-2">
                    <BarChart3 className="h-4 w-4" />
                    <span>Articles</span>
                    <CheckCircle className="h-3 w-3 text-green-500" />
                  </Link>
                  <Link href="/admin/viewings" className="block px-4 py-2 text-sm text-gray-700 hover:bg-teal-50 flex items-center space-x-2">
                    <Target className="h-4 w-4" />
                    <span>Viewings</span>
                    <CheckCircle className="h-3 w-3 text-green-500" />
                  </Link>
                </div>
              </div>
            </div>
          </div>

          {/* Enhanced Pages Dropdown */}
          <div className="flex items-center space-x-4">
            <div className="relative group">
              <Button variant="outline" size="sm" className="flex items-center space-x-1">
                <span>Enhanced Pages</span>
                <Star className="h-3 w-3 text-yellow-500" />
                <ChevronDown className="h-4 w-4" />
              </Button>
              <div className="absolute right-0 mt-2 w-56 bg-white rounded-md shadow-lg border border-gray-200 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50">
                <div className="py-1">
                  <Link href="/admin/dashboard-enhanced" className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 flex items-center space-x-2">
                    <BarChart3 className="h-4 w-4" />
                    <span>Enhanced Dashboard</span>
                    <Star className="h-3 w-3 text-yellow-500" />
                  </Link>
                  <Link href="/admin/listings-enhanced" className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 flex items-center space-x-2">
                    <Home className="h-4 w-4" />
                    <span>Enhanced Listings</span>
                    <Star className="h-3 w-3 text-yellow-500" />
                  </Link>
                  <Link href="/admin/agents-enhanced" className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 flex items-center space-x-2">
                    <Users className="h-4 w-4" />
                    <span>Enhanced Agents</span>
                    <Star className="h-3 w-3 text-yellow-500" />
                  </Link>
                  <Link href="/admin/outreach-enhanced" className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 flex items-center space-x-2">
                    <MessageSquare className="h-4 w-4" />
                    <span>Enhanced Conversations</span>
                    <Activity className="h-3 w-3 text-green-500 animate-pulse" />
                  </Link>
                  <Link href="/admin/scraper-enhanced" className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 flex items-center space-x-2">
                    <Zap className="h-4 w-4" />
                    <span>Enhanced Scraper</span>
                    <Activity className="h-3 w-3 text-orange-500 animate-pulse" />
                  </Link>
                  <Link href="/admin/cobroking-analytics" className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 flex items-center space-x-2">
                    <Target className="h-4 w-4" />
                    <span>Co-Broking Analytics</span>
                    <BarChart3 className="h-3 w-3 text-red-500" />
                  </Link>
                  <div className="border-t border-gray-200 my-1"></div>
                  <Link href="/admin/swipe" className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100">
                    Swipe Interface
                  </Link>
                  <Link href="/admin/ai-prompts" className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100">
                    AI Prompts
                  </Link>
                </div>
              </div>
            </div>
            <AdminLogoutButton />
          </div>
        </div>
      </nav>

      {/* Status Bar */}
      <div className="bg-green-50 border-b border-green-200 px-4 py-2">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center space-x-4 text-sm">
            <div className="flex items-center space-x-1">
              <CheckCircle className="h-4 w-4 text-green-500" />
              <span className="text-green-700">Primary Pages Active</span>
            </div>
            <div className="flex items-center space-x-1">
              <CheckCircle className="h-4 w-4 text-blue-500" />
              <span className="text-blue-700">Co-Broking Status Tracking</span>
            </div>
            <div className="flex items-center space-x-1">
              <Star className="h-4 w-4 text-yellow-500" />
              <span className="text-yellow-700">Enhanced Pages Available</span>
            </div>
          </div>
          <div className="text-sm text-gray-600">
            Reliable co-broking management system with experimental features
          </div>
        </div>
      </div>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 py-6">
        {children}
      </main>
    </div>
  );
}
