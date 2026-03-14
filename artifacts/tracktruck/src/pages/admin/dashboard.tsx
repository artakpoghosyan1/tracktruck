import { useState } from "react";
import { Link } from "wouter";
import { format } from "date-fns";
import { 
  Plus, Search, MoreVertical, Play, Pause, SquareSquare, 
  RotateCcw, Trash2, Link as LinkIcon, ExternalLink, Edit
} from "lucide-react";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { 
  useListRoutes, 
  useStartRoute, 
  usePauseRoute, 
  useResumeRoute, 
  useResetRoute, 
  useDeleteRoute,
  ListRoutesStatus
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";

export default function Dashboard() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<ListRoutesStatus | undefined>();
  const { toast } = useToast();

  const { data, isLoading, refetch } = useListRoutes({
    page,
    page_size: 10,
    search: search || undefined,
    status: statusFilter,
  });

  const startMut = useStartRoute({ mutation: { onSuccess: () => refetch() }});
  const pauseMut = usePauseRoute({ mutation: { onSuccess: () => refetch() }});
  const resumeMut = useResumeRoute({ mutation: { onSuccess: () => refetch() }});
  const resetMut = useResetRoute({ mutation: { onSuccess: () => refetch() }});
  const deleteMut = useDeleteRoute({ mutation: { onSuccess: () => refetch() }});

  const handleAction = async (action: 'start'|'pause'|'resume'|'reset'|'delete', id: number) => {
    try {
      if (action === 'start') await startMut.mutateAsync({ id });
      if (action === 'pause') await pauseMut.mutateAsync({ id });
      if (action === 'resume') await resumeMut.mutateAsync({ id });
      if (action === 'reset') await resetMut.mutateAsync({ id });
      if (action === 'delete') {
        if (confirm("Are you sure you want to delete this route?")) {
          await deleteMut.mutateAsync({ id });
        }
      }
      toast({ title: "Success", description: `Action ${action} completed.` });
    } catch (e: any) {
      toast({ title: "Error", description: e.message || "Action failed", variant: "destructive" });
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
            <thead className="bg-muted/30 text-muted-foreground font-semibold border-b border-border/50">
              <tr>
                <th className="p-4">Route Name</th>
                <th className="p-4">Status</th>
                <th className="p-4">Created</th>
                <th className="p-4">Payment</th>
                <th className="p-4">Share Link</th>
                <th className="p-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-muted-foreground">
                    <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-primary" />
                    Loading routes...
                  </td>
                </tr>
              ) : data?.data.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-muted-foreground">
                    No routes found. Create your first one above!
                  </td>
                </tr>
              ) : (
                data?.data.map((route) => (
                  <tr key={route.id} className="hover:bg-muted/10 transition-colors group">
                    <td className="p-4 font-medium text-foreground">{route.name}</td>
                    <td className="p-4">
                      <span className={`px-2.5 py-1 text-xs font-semibold rounded-full border ${getStatusColor(route.status)} uppercase tracking-wider`}>
                        {route.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="p-4 text-muted-foreground">
                      {format(new Date(route.createdAt), "MMM d, yyyy")}
                    </td>
                    <td className="p-4">
                      {route.paymentStatus ? (
                        <span className="text-emerald-600 font-medium bg-emerald-50 px-2 py-0.5 rounded text-xs">{route.paymentStatus}</span>
                      ) : (
                        <span className="text-muted-foreground text-xs">Unpaid</span>
                      )}
                    </td>
                    <td className="p-4">
                      {route.shareToken && route.shareLinkActive ? (
                        <button onClick={() => copyLink(route.shareToken!)} className="flex items-center gap-1.5 text-primary hover:underline text-xs font-medium bg-primary/5 px-2 py-1 rounded-md">
                          <LinkIcon className="w-3 h-3" /> Copy Link
                        </button>
                      ) : (
                        <span className="text-muted-foreground text-xs">Inactive</span>
                      )}
                    </td>
                    <td className="p-4 text-right">
                      <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        {route.status === 'draft' && (
                          <Link href={`/admin/routes/${route.id}/edit`} className="p-1.5 text-slate-500 hover:text-primary hover:bg-primary/10 rounded-md transition-colors" title="Edit">
                            <Edit className="w-4 h-4" />
                          </Link>
                        )}
                        {route.status === 'ready' && (
                          <button onClick={() => handleAction('start', route.id)} className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-md transition-colors" title="Start Route">
                            <Play className="w-4 h-4" />
                          </button>
                        )}
                        {route.status === 'in_progress' && (
                          <button onClick={() => handleAction('pause', route.id)} className="p-1.5 text-amber-600 hover:bg-amber-50 rounded-md transition-colors" title="Pause Route">
                            <Pause className="w-4 h-4" />
                          </button>
                        )}
                        {route.status === 'paused' && (
                          <button onClick={() => handleAction('resume', route.id)} className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-md transition-colors" title="Resume Route">
                            <Play className="w-4 h-4" />
                          </button>
                        )}
                        {(route.status === 'in_progress' || route.status === 'paused' || route.status === 'completed') && (
                          <button onClick={() => handleAction('reset', route.id)} className="p-1.5 text-slate-500 hover:bg-slate-100 rounded-md transition-colors" title="Reset Route">
                            <RotateCcw className="w-4 h-4" />
                          </button>
                        )}
                        <button onClick={() => handleAction('delete', route.id)} className="p-1.5 text-destructive hover:bg-destructive/10 rounded-md transition-colors" title="Delete">
                          <Trash2 className="w-4 h-4" />
                        </button>
                        {route.shareToken && route.shareLinkActive && (
                          <a href={`/${route.shareToken}`} target="_blank" rel="noreferrer" className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-md transition-colors" title="Open Public Page">
                            <ExternalLink className="w-4 h-4" />
                          </a>
                        )}
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
    </AdminLayout>
  );
}
