import { useState } from "react";
import { Link } from "wouter";
import { format } from "date-fns";
import { 
  Plus, Search, Play, Pause,
  Trash2, Link as LinkIcon, ExternalLink, Edit, Loader2, Eye,
  BarChart3
} from "lucide-react";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { 
  useListRoutes, 
  useStartRoute, 
  usePauseRoute, 
  useResumeRoute, 
  useDeleteRoute,
  ListRoutesStatus
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { useAppStore } from "@/store/use-app-store";
import { FriendlyErrorDialog } from "@/components/common/FriendlyErrorDialog";

export default function Dashboard() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<ListRoutesStatus | undefined>();
  const { user } = useAppStore();
  const { toast } = useToast();
  
  const [errorDialog, setErrorDialog] = useState<{ open: boolean; type: any; message: string }>({
    open: false,
    type: "generic",
    message: ""
  });

  const { data, isLoading, refetch } = useListRoutes({
    page,
    page_size: 10,
    search: search || undefined,
    status: statusFilter,
  });

  const startMut = useStartRoute({ mutation: { onSuccess: () => refetch() }});
  const pauseMut = usePauseRoute({ mutation: { onSuccess: () => refetch() }});
  const resumeMut = useResumeRoute({ mutation: { onSuccess: () => refetch() }});
  const deleteMut = useDeleteRoute({ mutation: { onSuccess: () => refetch() }});

  const handleAction = async (action: 'start'|'pause'|'resume'|'delete', id: number) => {
    try {
      if (action === 'start') await startMut.mutateAsync({ id });
      if (action === 'pause') await pauseMut.mutateAsync({ id });
      if (action === 'resume') await resumeMut.mutateAsync({ id });
      if (action === 'delete') {
        if (confirm("Are you sure you want to delete this route?")) {
          await deleteMut.mutateAsync({ id });
        }
      }
      toast({ title: "Success", description: `Action ${action} completed.` });
    } catch (e: any) {
      const errorData = e.response?.data;
      if (e.response?.status === 403 && errorData?.error === 'quota_exceeded') {
        setErrorDialog({ open: true, type: "quota_exceeded", message: errorData?.message });
      } else {
        const message = errorData?.message || e.message || "Action failed";
        toast({ title: "Error", description: message, variant: "destructive" });
      }
    }
  };

  const copyLink = (token: string) => {
    const url = `${window.location.origin}/${token}`;
    navigator.clipboard.writeText(url);
    toast({ title: "Copied!", description: "Share link copied to clipboard." });
  };

  const getStatusColor = (status: string) => {
    switch(status) {
      case 'draft': return 'bg-slate-100 text-slate-700 border-slate-200';
      case 'ready': return 'bg-blue-100 text-blue-700 border-blue-200';
      case 'in_progress': return 'bg-emerald-100 text-emerald-700 border-emerald-200';
      case 'paused': return 'bg-amber-100 text-amber-700 border-amber-200';
      case 'completed': return 'bg-purple-100 text-purple-700 border-purple-200';
      default: return 'bg-gray-100 text-gray-700 border-gray-200';
    }
  };

  return (
    <AdminLayout>
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Routes</h1>
          <p className="text-muted-foreground mt-1">Manage and track your fleet deliveries.</p>
        </div>
        <Link href="/admin/routes/new" className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground rounded-xl font-semibold shadow-lg shadow-primary/20 hover:-translate-y-0.5 transition-all">
          <Plus className="w-5 h-5" />
          Create Route
        </Link>
      </div>
      
      {user?.role === 'user' && (
        <div className="bg-gradient-to-br from-primary/5 to-primary/10 border border-primary/20 rounded-3xl p-6 mb-8 flex flex-col md:flex-row items-center justify-between gap-6 relative overflow-hidden shadow-sm">
          <div className="absolute top-0 right-0 p-8 opacity-5">
            <BarChart3 className="w-48 h-48" />
          </div>
          <div className="flex items-center gap-6 relative z-10">
            <div className="w-16 h-16 bg-primary/10 text-primary rounded-2xl flex items-center justify-center">
              <BarChart3 className="w-8 h-8" />
            </div>
            <div>
              <h3 className="text-xl font-bold text-foreground">Route Usage Status</h3>
              <p className="text-sm text-muted-foreground">You have used {(user as any).usedRoutes} out of {(user as any).routeLimit} routes in your current plan.</p>
            </div>
          </div>
          <div className="w-full md:w-1/3 space-y-3 relative z-10">
            <div className="flex justify-between items-end">
              <span className="text-xs font-bold uppercase text-muted-foreground tracking-wider">{(user as any).routeLimit} Route Tier</span>
              <span className={`text-sm font-bold ${((user as any).usedRoutes || 0) >= (user as any).routeLimit ? 'text-destructive' : 'text-primary'}`}>
                {Math.max(0, (user as any).routeLimit - ((user as any).usedRoutes || 0))} left
              </span>
            </div>
            <div className="w-full h-3 bg-muted/50 rounded-full overflow-hidden border border-border/50">
              <div 
                className={`h-full transition-all rounded-full ${((user as any).usedRoutes || 0) >= (user as any).routeLimit ? 'bg-destructive' : 'bg-primary'}`}
                style={{ width: `${Math.min(100, (((user as any).usedRoutes || 0) / (user as any).routeLimit) * 100)}%` }}
              />
            </div>
          </div>
        </div>
      )}

      <div className="bg-card rounded-2xl shadow-sm border border-border/60 overflow-hidden">
        <div className="p-4 border-b border-border/50 bg-muted/10 flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input 
              type="text" 
              placeholder="Search routes..." 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
            />
          </div>
          <select 
            value={statusFilter || ""}
            onChange={(e) => setStatusFilter(e.target.value ? e.target.value as ListRoutesStatus : undefined)}
            className="px-4 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
          >
            <option value="">All Statuses</option>
            <option value="draft">Draft</option>
            <option value="ready">Ready</option>
            <option value="in_progress">In Progress</option>
            <option value="paused">Paused</option>
            <option value="completed">Completed</option>
          </select>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/30 text-muted-foreground font-semibold border-b border-border/50 text-xs uppercase tracking-wider">
              <tr>
                <th className="p-4 text-left">Route Name</th>
                <th className="p-4 text-left">Status</th>
                <th className="p-4 text-left">Created</th>
                <th className="p-4 text-left">Share Link</th>
                <th className="p-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {isLoading ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-muted-foreground">
                    <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-primary" />
                    Loading routes...
                  </td>
                </tr>
              ) : data?.data.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-muted-foreground">
                    No routes found. Create your first one above!
                  </td>
                </tr>
              ) : (
                data?.data.map((route) => (
                  <tr key={route.id} className="hover:bg-muted/10 transition-colors">
                    <td className="p-4 font-medium text-foreground">{route.name}</td>
                    <td className="p-4">
                      <span className={`px-2.5 py-1 text-xs font-semibold rounded-full border ${getStatusColor(route.status)} uppercase tracking-wider`}>
                        {route.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="p-4 text-muted-foreground text-sm">
                      {format(new Date(route.createdAt), "MMM d, yyyy")}
                    </td>
                    <td className="p-4">
                      {route.shareToken && route.shareLinkActive ? (
                        <div className="flex items-center gap-1">
                          <button onClick={() => copyLink(route.shareToken!)} className="flex items-center gap-1.5 text-primary hover:text-primary/80 text-xs font-semibold bg-primary/8 hover:bg-primary/15 px-2.5 py-1.5 rounded-lg transition-colors" title="Copy share link">
                            <LinkIcon className="w-3 h-3" /> Copy Link
                          </button>
                          <a href={`/${route.shareToken}`} target="_blank" rel="noreferrer" className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" title="Open live tracking page">
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        </div>
                      ) : (
                        <span className="text-muted-foreground text-xs">
                          {route.status === 'draft' ? 'Activate to get link' : 'No link'}
                        </span>
                      )}
                    </td>
                    <td className="p-4 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {route.status !== 'completed' && (
                          <Link
                            href={`/admin/routes/${route.id}/edit`}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
                            title="Edit route"
                          >
                            <Edit className="w-3.5 h-3.5" /> Edit
                          </Link>
                        )}
                        {route.status === 'completed' && (
                          <Link
                            href={`/admin/routes/${route.id}/edit`}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
                            title="View route details"
                          >
                            <Eye className="w-3.5 h-3.5" /> View
                          </Link>
                        )}
                        {route.status === 'ready' && (
                          <button
                            onClick={() => handleAction('start', route.id)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-emerald-500 hover:bg-emerald-600 rounded-lg transition-colors shadow-sm"
                            title="Start simulation"
                          >
                            <Play className="w-3.5 h-3.5 fill-current" /> Start
                          </button>
                        )}
                        {route.status === 'in_progress' && (
                          <button
                            onClick={() => handleAction('pause', route.id)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-amber-500 hover:bg-amber-600 rounded-lg transition-colors shadow-sm"
                            title="Pause"
                          >
                            <Pause className="w-3.5 h-3.5 fill-current" /> Pause
                          </button>
                        )}
                        {route.status === 'paused' && (
                          <button
                            onClick={() => handleAction('resume', route.id)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-emerald-500 hover:bg-emerald-600 rounded-lg transition-colors shadow-sm"
                            title="Resume"
                          >
                            <Play className="w-3.5 h-3.5 fill-current" /> Resume
                          </button>
                        )}
                        <button
                          onClick={() => handleAction('delete', route.id)}
                          className="p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg transition-colors"
                          title="Delete route"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        
        {/* Simple Pagination */}
        {data && data.total > data.pageSize && (
          <div className="p-4 border-t border-border/50 flex justify-between items-center bg-muted/5">
            <span className="text-sm text-muted-foreground">
              Showing {((page - 1) * data.pageSize) + 1} to {Math.min(page * data.pageSize, data.total)} of {data.total}
            </span>
            <div className="flex gap-2">
              <button 
                disabled={page === 1} 
                onClick={() => setPage(p => p - 1)}
                className="px-3 py-1.5 border border-border rounded-lg text-sm disabled:opacity-50 hover:bg-muted transition-colors"
              >
                Previous
              </button>
              <button 
                disabled={page * data.pageSize >= data.total} 
                onClick={() => setPage(p => p + 1)}
                className="px-3 py-1.5 border border-border rounded-lg text-sm disabled:opacity-50 hover:bg-muted transition-colors"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      <FriendlyErrorDialog 
        open={errorDialog.open} 
        onOpenChange={(open) => setErrorDialog(curr => ({ ...curr, open }))}
        errorType={errorDialog.type}
        message={errorDialog.message}
      />
    </AdminLayout>
  );
}
