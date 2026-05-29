/**
 * Co-Broking Analytics Page
 * Deep insights into co-broking success rates, patterns, and trends
 */

'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card,CardContent,CardDescription,CardHeader,CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select,SelectContent,SelectItem,SelectTrigger,SelectValue } from '@/components/ui/select';
import { useConversationSelectors } from '@/lib/stores/conversation-store';
import { useGlobalStore } from '@/lib/stores/global-store';
import {
BarChart3,
Calendar,
CheckCircle,
Clock,
Home,
RefreshCw,
Target,
TrendingUp,
Users,
XCircle
} from 'lucide-react';
import { useEffect,useState } from 'react';

interface CoBrokingAnalytics {
  overview: {
    totalConversations: number;
    willingAgents: number;
    notWillingAgents: number;
    needsDiscussion: number;
    unknown: number;
    successRate: number;
    dealbreakerRate: number;
  };
  trends: {
    daily: Array<{ date: string; willing: number; notWilling: number; total: number }>;
    weekly: Array<{ week: string; willing: number; notWilling: number; total: number }>;
    monthly: Array<{ month: string; willing: number; notWilling: number; total: number }>;
  };
  agentInsights: Array<{
    agentId: string;
    agentName: string;
    totalConversations: number;
    willingCount: number;
    notWillingCount: number;
    successRate: number;
    avgResponseTime: number;
    preferredTerms: string[];
  }>;
  propertyInsights: Array<{
    propertyType: string;
    district: string;
    willingCount: number;
    notWillingCount: number;
    successRate: number;
    avgPrice: number;
  }>;
  timeInsights: {
    bestDays: Array<{ day: string; successRate: number }>;
    bestHours: Array<{ hour: string; successRate: number }>;
    avgResponseTime: number;
    peakActivityHours: string[];
  };
}

export default function CoBrokingAnalyticsPage() {
  const [analytics, setAnalytics] = useState<CoBrokingAnalytics | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [timeRange, setTimeRange] = useState('7d');
  const [_selectedMetric, _setSelectedMetric] = useState('successRate');
  
  // Zustand selectors
  const conversations = useConversationSelectors.useFilteredConversations();
  const conversationStats = useConversationSelectors.useStats();
  const { addNotification } = useGlobalStore();

  // Fetch analytics data
  useEffect(() => {
    const fetchAnalytics = async () => {
      setIsLoading(true);
      try {
        // Simulate API call - in real app, this would fetch from your analytics API
        const mockAnalytics: CoBrokingAnalytics = {
          overview: {
            totalConversations: conversationStats.total,
            willingAgents: conversationStats.coBrokingWilling,
            notWillingAgents: conversationStats.coBrokingNotWilling,
            needsDiscussion: Math.floor(conversationStats.total * 0.1),
            unknown: conversationStats.total - conversationStats.coBrokingWilling - conversationStats.coBrokingNotWilling - Math.floor(conversationStats.total * 0.1),
            successRate: conversationStats.total > 0 ? conversationStats.coBrokingWilling / conversationStats.total : 0,
            dealbreakerRate: conversationStats.total > 0 ? conversationStats.coBrokingNotWilling / conversationStats.total : 0,
          },
          trends: {
            daily: generateMockDailyData(7),
            weekly: generateMockWeeklyData(4),
            monthly: generateMockMonthlyData(6),
          },
          agentInsights: generateMockAgentInsights(),
          propertyInsights: generateMockPropertyInsights(),
          timeInsights: {
            bestDays: [
              { day: 'Monday', successRate: 0.75 },
              { day: 'Tuesday', successRate: 0.72 },
              { day: 'Wednesday', successRate: 0.68 },
              { day: 'Thursday', successRate: 0.71 },
              { day: 'Friday', successRate: 0.69 },
              { day: 'Saturday', successRate: 0.45 },
              { day: 'Sunday', successRate: 0.38 },
            ],
            bestHours: [
              { hour: '9:00 AM', successRate: 0.78 },
              { hour: '10:00 AM', successRate: 0.82 },
              { hour: '11:00 AM', successRate: 0.75 },
              { hour: '2:00 PM', successRate: 0.71 },
              { hour: '3:00 PM', successRate: 0.69 },
              { hour: '4:00 PM', successRate: 0.65 },
            ],
            avgResponseTime: 2.5, // hours
            peakActivityHours: ['10:00 AM', '2:00 PM', '3:00 PM'],
          },
        };
        
        setAnalytics(mockAnalytics);
        
        addNotification({
          type: 'success',
          title: 'Analytics Updated',
          message: 'Co-broking analytics refreshed successfully',
        });
      } catch (error) {
        addNotification({
          type: 'error',
          title: 'Analytics Failed',
          message: 'Failed to load co-broking analytics',
        });
      } finally {
        setIsLoading(false);
      }
    };

    fetchAnalytics();
  }, [conversations, conversationStats, addNotification]);

  const generateMockDailyData = (count: number): Array<{ date: string; willing: number; notWilling: number; total: number }> => {
    const data = [];
    const baseDate = new Date();
    
    for (let i = count - 1; i >= 0; i--) {
      const date = new Date(baseDate);
      date.setDate(date.getDate() - i);
      data.push({
        date: date.toISOString().split('T')[0],
        willing: Math.floor(Math.random() * 10) + 5,
        notWilling: Math.floor(Math.random() * 5) + 2,
        total: Math.floor(Math.random() * 15) + 10,
      });
    }
    
    return data;
  };

  const generateMockWeeklyData = (count: number): Array<{ week: string; willing: number; notWilling: number; total: number }> => {
    const data = [];
    const baseDate = new Date();
    
    for (let i = count - 1; i >= 0; i--) {
      const date = new Date(baseDate);
      date.setDate(date.getDate() - (i * 7));
      data.push({
        week: `Week ${count - i}`,
        willing: Math.floor(Math.random() * 50) + 30,
        notWilling: Math.floor(Math.random() * 20) + 10,
        total: Math.floor(Math.random() * 70) + 50,
      });
    }
    
    return data;
  };

  const generateMockMonthlyData = (count: number): Array<{ month: string; willing: number; notWilling: number; total: number }> => {
    const data = [];
    const baseDate = new Date();
    
    for (let i = count - 1; i >= 0; i--) {
      const date = new Date(baseDate);
      date.setMonth(date.getMonth() - i);
      data.push({
        month: date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
        willing: Math.floor(Math.random() * 200) + 150,
        notWilling: Math.floor(Math.random() * 80) + 50,
        total: Math.floor(Math.random() * 280) + 200,
      });
    }
    
    return data;
  };

  const generateMockAgentInsights = () => {
    return [
      {
        agentId: '1',
        agentName: 'John Tan',
        totalConversations: 25,
        willingCount: 18,
        notWillingCount: 4,
        successRate: 0.72,
        avgResponseTime: 1.5,
        preferredTerms: ['50/50', 'Standard'],
      },
      {
        agentId: '2',
        agentName: 'Sarah Lee',
        totalConversations: 32,
        willingCount: 28,
        notWillingCount: 2,
        successRate: 0.875,
        avgResponseTime: 0.8,
        preferredTerms: ['60/40', 'Flexible'],
      },
      {
        agentId: '3',
        agentName: 'Mike Chen',
        totalConversations: 18,
        willingCount: 8,
        notWillingCount: 7,
        successRate: 0.44,
        avgResponseTime: 4.2,
        preferredTerms: ['70/30', 'Principal Only'],
      },
    ];
  };

  const generateMockPropertyInsights = () => {
    return [
      {
        propertyType: 'Condo',
        district: 'District 9',
        willingCount: 45,
        notWillingCount: 12,
        successRate: 0.789,
        avgPrice: 2500000,
      },
      {
        propertyType: 'HDB',
        district: 'District 12',
        willingCount: 32,
        notWillingCount: 8,
        successRate: 0.8,
        avgPrice: 650000,
      },
      {
        propertyType: 'Landed',
        district: 'District 10',
        willingCount: 15,
        notWillingCount: 10,
        successRate: 0.6,
        avgPrice: 4500000,
      },
    ];
  };

  if (isLoading || !analytics) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex items-center space-x-2">
          <RefreshCw className="h-6 w-6 animate-spin" />
          <span>Loading analytics...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Co-Broking Analytics</h1>
          <p className="text-gray-600 mt-2">
            Deep insights into co-broking success rates and patterns
          </p>
        </div>
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2">
            <Label htmlFor="timeRange">Time Range</Label>
            <Select value={timeRange} onValueChange={setTimeRange}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7d">7 Days</SelectItem>
                <SelectItem value="30d">30 Days</SelectItem>
                <SelectItem value="90d">90 Days</SelectItem>
                <SelectItem value="1y">1 Year</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button
            onClick={() => window.location.reload()}
            variant="outline"
            size="sm"
            disabled={isLoading}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Success Rate</p>
                <p className="text-2xl font-bold text-green-600">
                  {(analytics.overview.successRate * 100).toFixed(1)}%
                </p>
                <div className="flex items-center mt-1">
                  <TrendingUp className="h-4 w-4 text-green-500" />
                  <span className="text-sm text-green-600 ml-1">+5.2% vs last period</span>
                </div>
              </div>
              <Target className="h-8 w-8 text-green-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Willing Agents</p>
                <p className="text-2xl font-bold text-blue-600">
                  {analytics.overview.willingAgents}
                </p>
                <div className="flex items-center mt-1">
                  <CheckCircle className="h-4 w-4 text-blue-500" />
                  <span className="text-sm text-gray-600 ml-1">
                    {analytics.overview.totalConversations} total
                  </span>
                </div>
              </div>
              <CheckCircle className="h-8 w-8 text-blue-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Dealbreakers</p>
                <p className="text-2xl font-bold text-red-600">
                  {analytics.overview.notWillingAgents}
                </p>
                <div className="flex items-center mt-1">
                  <XCircle className="h-4 w-4 text-red-500" />
                  <span className="text-sm text-gray-600 ml-1">
                    {(analytics.overview.dealbreakerRate * 100).toFixed(1)}% rate
                  </span>
                </div>
              </div>
              <XCircle className="h-8 w-8 text-red-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Avg Response Time</p>
                <p className="text-2xl font-bold text-purple-600">
                  {analytics.timeInsights.avgResponseTime}h
                </p>
                <div className="flex items-center mt-1">
                  <Clock className="h-4 w-4 text-purple-500" />
                  <span className="text-sm text-gray-600 ml-1">
                    Peak: {analytics.timeInsights.peakActivityHours.join(', ')}
                  </span>
                </div>
              </div>
              <Clock className="h-8 w-8 text-purple-500" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Success Rate Trend */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <BarChart3 className="h-5 w-5 mr-2" />
              Success Rate Trend
            </CardTitle>
            <CardDescription>
              Co-broking success rate over time
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {analytics.trends.daily.map((day, index) => {
                const successRate = day.total > 0 ? day.willing / day.total : 0;
                return (
                  <div key={index} className="flex items-center justify-between">
                    <span className="text-sm font-medium">{day.date}</span>
                    <div className="flex items-center space-x-2">
                      <span className="text-sm text-gray-600">
                        {day.willing}/{day.total}
                      </span>
                      <div className="w-20 h-2 bg-gray-200 rounded-full">
                        <div 
                          className="h-2 bg-green-500 rounded-full"
                          style={{ width: `${successRate * 100}%` }}
                        />
                      </div>
                      <span className="text-sm font-bold w-12 text-right">
                        {(successRate * 100).toFixed(0)}%
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Best Times to Contact */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <Calendar className="h-5 w-5 mr-2" />
              Best Times to Contact
            </CardTitle>
            <CardDescription>
              Optimal timing for co-broking success
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div>
                <h4 className="text-sm font-medium mb-2">Best Days</h4>
                <div className="space-y-2">
                  {analytics.timeInsights.bestDays.map((day, index) => (
                    <div key={index} className="flex items-center justify-between">
                      <span className="text-sm">{day.day}</span>
                      <div className="flex items-center space-x-2">
                        <div className="w-16 h-2 bg-gray-200 rounded-full">
                          <div 
                            className="h-2 bg-blue-500 rounded-full"
                            style={{ width: `${day.successRate * 100}%` }}
                          />
                        </div>
                        <span className="text-sm font-bold w-12 text-right">
                          {(day.successRate * 100).toFixed(0)}%
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              
              <div>
                <h4 className="text-sm font-medium mb-2">Best Hours</h4>
                <div className="space-y-2">
                  {analytics.timeInsights.bestHours.map((hour, index) => (
                    <div key={index} className="flex items-center justify-between">
                      <span className="text-sm">{hour.hour}</span>
                      <div className="flex items-center space-x-2">
                        <div className="w-16 h-2 bg-gray-200 rounded-full">
                          <div 
                            className="h-2 bg-green-500 rounded-full"
                            style={{ width: `${hour.successRate * 100}%` }}
                          />
                        </div>
                        <span className="text-sm font-bold w-12 text-right">
                          {(hour.successRate * 100).toFixed(0)}%
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Agent Performance */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center">
            <Users className="h-5 w-5 mr-2" />
            Agent Performance
          </CardTitle>
          <CardDescription>
            Individual agent co-broking success rates
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {analytics.agentInsights.map((agent, index) => (
              <div key={index} className="border rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-2">
                    <span className="font-medium">{agent.agentName}</span>
                    <Badge variant="outline">
                      {agent.totalConversations} conversations
                    </Badge>
                  </div>
                  <div className="flex items-center space-x-2">
                    <span className="text-sm text-gray-600">
                      {agent.avgResponseTime}h avg response
                    </span>
                    <span className={`text-sm font-bold ${
                      agent.successRate >= 0.7 ? 'text-green-600' :
                      agent.successRate >= 0.4 ? 'text-yellow-600' : 'text-red-600'
                    }`}>
                      {(agent.successRate * 100).toFixed(1)}%
                    </span>
                  </div>
                </div>
                
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Willing: {agent.willingCount}</span>
                    <span>Not Willing: {agent.notWillingCount}</span>
                  </div>
                  <div className="w-full h-2 bg-gray-200 rounded-full">
                    <div 
                      className={`h-2 rounded-full ${
                        agent.successRate >= 0.7 ? 'bg-green-500' :
                        agent.successRate >= 0.4 ? 'bg-yellow-500' : 'bg-red-500'
                      }`}
                      style={{ width: `${agent.successRate * 100}%` }}
                    />
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {agent.preferredTerms.map((term, termIndex) => (
                      <Badge key={termIndex} variant="secondary" className="text-xs">
                        {term}
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Property Insights */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center">
            <Home className="h-5 w-5 mr-2" />
            Property Type Insights
          </CardTitle>
          <CardDescription>
            Co-broking success by property type and location
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {analytics.propertyInsights.map((property, index) => (
              <div key={index} className="border rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-2">
                    <span className="font-medium">{property.propertyType}</span>
                    <Badge variant="outline">{property.district}</Badge>
                    <span className="text-sm text-gray-600">
                      Avg: ${property.avgPrice.toLocaleString()}
                    </span>
                  </div>
                  <span className={`text-sm font-bold ${
                    property.successRate >= 0.7 ? 'text-green-600' :
                    property.successRate >= 0.4 ? 'text-yellow-600' : 'text-red-600'
                  }`}>
                    {(property.successRate * 100).toFixed(1)}%
                  </span>
                </div>
                
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Willing: {property.willingCount}</span>
                    <span>Not Willing: {property.notWillingCount}</span>
                  </div>
                  <div className="w-full h-2 bg-gray-200 rounded-full">
                    <div 
                      className={`h-2 rounded-full ${
                        property.successRate >= 0.7 ? 'bg-green-500' :
                        property.successRate >= 0.4 ? 'bg-yellow-500' : 'bg-red-500'
                      }`}
                      style={{ width: `${property.successRate * 100}%` }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
