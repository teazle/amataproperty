import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Home,
  Users,
  MessageSquare,
  Zap,
  BarChart3,
  Target,
  Activity,
  CheckCircle,
  ArrowRight,
  Star
} from 'lucide-react';
import { ServiceStatus } from '@/components/ServiceStatus';

export default function AdminDashboard() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="text-center">
        <h1 className="text-4xl font-bold text-gray-900 mb-2">
          SmartProp Admin Dashboard
        </h1>
        <p className="text-gray-600 text-lg">
          Real-time co-broking management with live updates
        </p>
        <div className="flex items-center justify-center mt-4 space-x-4">
          <div className="flex items-center space-x-2">
            <Activity className="h-4 w-4 text-green-500 animate-pulse" />
            <span className="text-sm text-gray-600">Live Updates</span>
          </div>
          <div className="flex items-center space-x-2">
            <CheckCircle className="h-4 w-4 text-blue-500" />
            <span className="text-sm text-gray-600">Co-Broking Status Tracking</span>
          </div>
        </div>
      </div>

      {/* Service Status */}
      <div className="max-w-4xl mx-auto">
        <ServiceStatus />
      </div>

      {/* Primary Pages (Old/Reliable) */}
      <div>
        <h2 className="text-2xl font-bold text-gray-900 mb-4">Primary Pages</h2>
        <p className="text-gray-600 mb-6">Reliable, tested pages for daily development work</p>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {/* Listings */}
        <Card className="border-2 border-green-200 bg-green-50">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="p-3 rounded-lg bg-green-100">
                <Home className="h-6 w-6 text-green-500" />
              </div>
              <Badge variant="secondary" className="bg-green-100 text-green-800">
                <CheckCircle className="h-3 w-3 mr-1" />
                Primary
              </Badge>
            </div>
            <CardTitle className="text-xl">Listings</CardTitle>
            <CardDescription>Property listings with full functionality</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="text-sm text-gray-600">
                All 209 listings with filtering, expandable rows, and agent details
              </div>
              <Link href="/admin/listings">
                <Button className="w-full" variant="default">
                  <span>Open Listings</span>
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>

        {/* LinkedIn */}
        <Card className="border-2 border-blue-200 bg-blue-50">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="p-3 rounded-lg bg-blue-100">
                <MessageSquare className="h-6 w-6 text-blue-500" />
              </div>
              <Badge variant="secondary" className="bg-blue-100 text-blue-800">
                <CheckCircle className="h-3 w-3 mr-1" />
                Primary
              </Badge>
            </div>
            <CardTitle className="text-xl">LinkedIn</CardTitle>
            <CardDescription>Automated catch-up messages</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="text-sm text-gray-600">
                Automate birthday, anniversary, and job change messages
              </div>
              <Link href="/admin/linkedin">
                <Button className="w-full" variant="default">
                  <span>Open LinkedIn</span>
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>

        {/* Agents */}
        <Card className="border-2 border-purple-200 bg-purple-50">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="p-3 rounded-lg bg-purple-100">
                <Users className="h-6 w-6 text-purple-500" />
              </div>
              <Badge variant="secondary" className="bg-purple-100 text-purple-800">
                <CheckCircle className="h-3 w-3 mr-1" />
                Primary
              </Badge>
            </div>
            <CardTitle className="text-xl">Agents</CardTitle>
            <CardDescription>Agent management and contact information</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="text-sm text-gray-600">
                Agent profiles, contact details, and co-broking status
              </div>
              <Link href="/admin/agents">
                <Button className="w-full" variant="default">
                  <span>Open Agents</span>
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>

        {/* Outreach */}
        <Card className="border-2 border-yellow-200 bg-yellow-50">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="p-3 rounded-lg bg-yellow-100">
                <MessageSquare className="h-6 w-6 text-yellow-500" />
              </div>
              <Badge variant="secondary" className="bg-yellow-100 text-yellow-800">
                <CheckCircle className="h-3 w-3 mr-1" />
                Primary
              </Badge>
            </div>
            <CardTitle className="text-xl">Outreach</CardTitle>
            <CardDescription>Conversation management and co-broking tracking</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="text-sm text-gray-600">
                Message history, conversation phases, and co-broking status
              </div>
              <Link href="/admin/outreach">
                <Button className="w-full" variant="default">
                  <span>Open Outreach</span>
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>

        {/* Scraper */}
        <Card className="border-2 border-orange-200 bg-orange-50">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="p-3 rounded-lg bg-orange-100">
                <Zap className="h-6 w-6 text-orange-500" />
              </div>
              <Badge variant="secondary" className="bg-orange-100 text-orange-800">
                <CheckCircle className="h-3 w-3 mr-1" />
                Primary
              </Badge>
            </div>
            <CardTitle className="text-xl">Scraper</CardTitle>
            <CardDescription>Property scraping and job management</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="text-sm text-gray-600">
                Control scrapers, monitor progress, and manage jobs
              </div>
              <Link href="/admin/scraper">
                <Button className="w-full" variant="default">
                  <span>Open Scraper</span>
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>

        {/* CRM */}
        <Card className="border-2 border-rose-200 bg-rose-50">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="p-3 rounded-lg bg-rose-100">
                <Target className="h-6 w-6 text-rose-500" />
              </div>
              <Badge variant="secondary" className="bg-rose-100 text-rose-800">
                <CheckCircle className="h-3 w-3 mr-1" />
                Primary
              </Badge>
            </div>
            <CardTitle className="text-xl">CRM</CardTitle>
            <CardDescription>Project leads and follow-up pipeline</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="text-sm text-gray-600">
                Manage public project inquiries from Luxe Realty pages
              </div>
              <Link href="/admin/crm">
                <Button className="w-full" variant="default">
                  <span>Open CRM</span>
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>

        {/* Articles */}
        <Card className="border-2 border-indigo-200 bg-indigo-50">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="p-3 rounded-lg bg-indigo-100">
                <BarChart3 className="h-6 w-6 text-indigo-500" />
              </div>
              <Badge variant="secondary" className="bg-indigo-100 text-indigo-800">
                <CheckCircle className="h-3 w-3 mr-1" />
                Primary
              </Badge>
            </div>
            <CardTitle className="text-xl">Articles</CardTitle>
            <CardDescription>Scraped articles and content management</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="text-sm text-gray-600">
                View and manage scraped articles from various sources
              </div>
              <Link href="/admin/articles">
                <Button className="w-full" variant="default">
                  <span>Open Articles</span>
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>

        {/* Viewings */}
        <Card className="border-2 border-teal-200 bg-teal-50">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="p-3 rounded-lg bg-teal-100">
                <Target className="h-6 w-6 text-teal-500" />
              </div>
              <Badge variant="secondary" className="bg-teal-100 text-teal-800">
                <CheckCircle className="h-3 w-3 mr-1" />
                Primary
              </Badge>
            </div>
            <CardTitle className="text-xl">Viewings</CardTitle>
            <CardDescription>Viewing requests and timeslot management</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="text-sm text-gray-600">
                Manage viewing requests and track timeslot availability
              </div>
              <Link href="/admin/viewings">
                <Button className="w-full" variant="default">
                  <span>Open Viewings</span>
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
        </div>
      </div>

      {/* Enhanced Pages (Experimental) */}
      <div>
        <h2 className="text-2xl font-bold text-gray-900 mb-4">Enhanced Pages (Experimental)</h2>
        <p className="text-gray-600 mb-6">Advanced features with real-time updates and optimized performance</p>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* Enhanced Dashboard */}
          <Card className="border-2 border-blue-200 bg-blue-50">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="p-3 rounded-lg bg-blue-100">
                  <BarChart3 className="h-6 w-6 text-blue-500" />
                </div>
                <Badge variant="secondary" className="bg-blue-100 text-blue-800">
                  <Star className="h-3 w-3 mr-1" />
                  Enhanced
                </Badge>
              </div>
              <CardTitle className="text-xl">Dashboard</CardTitle>
              <CardDescription>Real-time analytics and system overview</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="text-sm text-gray-600">
                  Live system metrics and co-broking insights
                </div>
                <Link href="/admin/dashboard-enhanced">
                  <Button className="w-full" variant="outline">
                    <span>Open Enhanced Dashboard</span>
                    <ArrowRight className="h-4 w-4 ml-2" />
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>

          {/* Enhanced Listings */}
          <Card className="border-2 border-green-200 bg-green-50">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="p-3 rounded-lg bg-green-100">
                  <Home className="h-6 w-6 text-green-500" />
                </div>
                <Badge variant="secondary" className="bg-green-100 text-green-800">
                  <Star className="h-3 w-3 mr-1" />
                  Enhanced
                </Badge>
              </div>
              <CardTitle className="text-xl">Listings</CardTitle>
              <CardDescription>Property listings with live updates</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="text-sm text-gray-600">
                  Real-time filtering and performance monitoring
                </div>
                <Link href="/admin/listings-enhanced">
                  <Button className="w-full" variant="outline">
                    <span>Open Enhanced Listings</span>
                    <ArrowRight className="h-4 w-4 ml-2" />
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>

          {/* Enhanced Agents */}
          <Card className="border-2 border-purple-200 bg-purple-50">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="p-3 rounded-lg bg-purple-100">
                  <Users className="h-6 w-6 text-purple-500" />
                </div>
                <Badge variant="secondary" className="bg-purple-100 text-purple-800">
                  <Star className="h-3 w-3 mr-1" />
                  Enhanced
                </Badge>
              </div>
              <CardTitle className="text-xl">Agents</CardTitle>
              <CardDescription>Agent management with co-broking analytics</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="text-sm text-gray-600">
                  Co-broking success rates and performance insights
                </div>
                <Link href="/admin/agents-enhanced">
                  <Button className="w-full" variant="outline">
                    <span>Open Enhanced Agents</span>
                    <ArrowRight className="h-4 w-4 ml-2" />
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>

          {/* Enhanced Outreach */}
          <Card className="border-2 border-yellow-200 bg-yellow-50">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="p-3 rounded-lg bg-yellow-100">
                  <MessageSquare className="h-6 w-6 text-yellow-500" />
                </div>
                <Badge variant="secondary" className="bg-yellow-100 text-yellow-800 animate-pulse">
                  <Activity className="h-3 w-3 mr-1" />
                  Live
                </Badge>
              </div>
              <CardTitle className="text-xl">Conversations</CardTitle>
              <CardDescription>Real-time co-broking conversations</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="text-sm text-gray-600">
                  Live message updates and co-broking status tracking
                </div>
                <Link href="/admin/outreach-enhanced">
                  <Button className="w-full" variant="outline">
                    <span>Open Enhanced Conversations</span>
                    <ArrowRight className="h-4 w-4 ml-2" />
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>

          {/* Enhanced Scraper */}
          <Card className="border-2 border-orange-200 bg-orange-50">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="p-3 rounded-lg bg-orange-100">
                  <Zap className="h-6 w-6 text-orange-500" />
                </div>
                <Badge variant="secondary" className="bg-orange-100 text-orange-800">
                  <Activity className="h-3 w-3 mr-1" />
                  Live
                </Badge>
              </div>
              <CardTitle className="text-xl">Scraper</CardTitle>
              <CardDescription>Live scraping progress and job management</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="text-sm text-gray-600">
                  Real-time progress tracking and performance monitoring
                </div>
                <Link href="/admin/scraper-enhanced">
                  <Button className="w-full" variant="outline">
                    <span>Open Enhanced Scraper</span>
                    <ArrowRight className="h-4 w-4 ml-2" />
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>

          {/* Co-Broking Analytics */}
          <Card className="border-2 border-red-200 bg-red-50">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="p-3 rounded-lg bg-red-100">
                  <Target className="h-6 w-6 text-red-500" />
                </div>
                <Badge variant="secondary" className="bg-red-100 text-red-800">
                  <BarChart3 className="h-3 w-3 mr-1" />
                  Analytics
                </Badge>
              </div>
              <CardTitle className="text-xl">Co-Broking Analytics</CardTitle>
              <CardDescription>Deep insights into co-broking success rates</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="text-sm text-gray-600">
                  Success rate analysis and trend insights
                </div>
                <Link href="/admin/cobroking-analytics">
                  <Button className="w-full" variant="outline">
                    <span>Open Analytics</span>
                    <ArrowRight className="h-4 w-4 ml-2" />
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
