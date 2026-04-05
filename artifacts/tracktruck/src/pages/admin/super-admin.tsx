import { useState } from "react";
import { useLocation } from "wouter";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { 
  Users, 
  ShieldCheck, 
  UserPlus, 
  Trash2, 
  Search, 
  Loader2, 
  Mail, 
  Shield, 
  AlertCircle,
  Edit,
  User
} from "lucide-react";
import { 
  useListAllowedEmails, 
  useAddAllowedEmail, 
  useRemoveAllowedEmail,
  useUpdateAllowedEmail
} from "@workspace/api-client-react";
import { useAppStore } from "@/store/use-app-store";
import { useToast } from "@/hooks/use-toast";
import { Switch } from "@/components/ui/switch";
import { FriendlyErrorDialog } from "@/components/common/FriendlyErrorDialog";
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogTrigger,
  DialogFooter,
  DialogDescription
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export default function SuperAdmin() {
  const { user } = useAppStore();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  
  const [activeTab, setActiveTab] = useState<"admins" | "clients">("clients");
  const [searchTerm, setSearchTerm] = useState("");
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [newTier, setNewTier] = useState(25);
  const [newRole, setNewRole] = useState<"admin" | "super_admin" | "user">("admin");
  const [newIsPaid, setNewIsPaid] = useState(true);
  const [newRouteLimit, setNewRouteLimit] = useState(25);
  
  const [errorDialog, setErrorDialog] = useState<{ open: boolean; type: any; message: string }>({
    open: false,
    type: "generic",
    message: ""
  });

  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<any>(null);
  const [editName, setEditName] = useState("");
  const [editRouteLimit, setEditRouteLimit] = useState(25);
  const [editUsedRoutes, setEditUsedRoutes] = useState(0);

  // Redirect if not at least an admin/manager
  if (!user || (user.role !== 'super_admin' && user.role !== 'admin')) {
    setLocation("/admin");
    return null;
  }

  const { data: allowedEmails, isLoading, refetch } = useListAllowedEmails();
  
  const addMutation = useAddAllowedEmail({
    mutation: {
      onSuccess: () => {
        toast({ title: "Success", description: "Access granted successfully." });
        setIsAddModalOpen(false);
        setNewEmail("");
        setNewName("");
        refetch();
      },
      onError: (err: any) => {
        const errorData = err.response?.data;
        if (err.response?.status === 409) {
          setErrorDialog({ open: true, type: "conflict", message: errorData?.message });
        } else if (err.response?.status === 403) {
          setErrorDialog({ open: true, type: "unauthorized", message: errorData?.message });
        } else {
          toast({ 
            title: "Error", 
            description: errorData?.message || "Failed to grant access. Please check the email and try again.", 
            variant: "destructive" 
          });
        }
      }
    }
  });

  const removeMutation = useRemoveAllowedEmail({
    mutation: {
      onSuccess: () => {
        toast({ title: "Success", description: "Access revoked." });
        refetch();
      },
      onError: (err: any) => {
        toast({ 
          title: "Error", 
          description: err.response?.data?.message || "Failed to remove email.", 
          variant: "destructive" 
        });
      }
    }
  });

  const updateMutation = useUpdateAllowedEmail({
    mutation: {
      onSuccess: () => {
        toast({ title: "Updated", description: "Client settings updated." });
        refetch();
      },
      onError: (err: any) => {
        toast({ 
          title: "Error", 
          description: err.response?.data?.message || "Update failed.", 
          variant: "destructive" 
        });
      }
    }
  });

  const handleAddAccess = (role: "admin" | "super_admin" | "user") => {
    if (!newEmail) return;
    addMutation.mutate({ 
      data: { 
        email: newEmail, 
        name: newName,
        role: role as any,
        isPaid: role === 'user' ? newIsPaid : true,
        routeLimit: (role === 'user' ? newRouteLimit : 25) as any
      } as any
    });
  };

  const handleRemoveEmail = (email: string) => {
    if (window.confirm(`Are you sure you want to remove access for ${email}?`)) {
      removeMutation.mutate({ email });
    }
  };

  const clientEmails = allowedEmails?.filter(item => 
    item.role === 'user' && item.email.toLowerCase().includes(searchTerm.toLowerCase())
  ) || [];

  const adminEmails = allowedEmails?.filter(item => 
    (item.role === 'super_admin' || item.role === 'admin') && 
    item.email.toLowerCase().includes(searchTerm.toLowerCase())
  ) || [];

  return (
    <AdminLayout>
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-8">
          <div>
            <h1 className="text-3xl font-display font-bold text-foreground">Clients Management</h1>
            <p className="text-muted-foreground mt-1">Control platform access and user roles</p>
          </div>
          
          <div className="flex bg-muted/50 p-1 rounded-2xl border border-border/50 self-start md:self-auto">
            {user.role === 'super_admin' && (
              <button 
                onClick={() => setActiveTab("admins")}
                className={`px-6 py-2.5 rounded-xl text-sm font-bold transition-all ${activeTab === 'admins' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
              >
                Administrators
              </button>
            )}
            <button 
              onClick={() => setActiveTab("clients")}
              className={`px-6 py-2.5 rounded-xl text-sm font-bold transition-all ${activeTab === 'clients' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
            >
              Clients
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
          <div className="bg-card border border-border/50 rounded-3xl p-6 shadow-sm">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-primary/10 text-primary rounded-2xl flex items-center justify-center">
                <Users className="w-6 h-6" />
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground uppercase tracking-tight">Active Clients</p>
                <p className="text-2xl font-bold">{allowedEmails?.filter(e => e.role === 'user').length || 0}</p>
              </div>
            </div>
          </div>
          
          {user.role === 'super_admin' && (
            <div className="bg-card border border-border/50 rounded-3xl p-6 shadow-sm">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-purple-500/10 text-purple-500 rounded-2xl flex items-center justify-center">
                  <ShieldCheck className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground uppercase tracking-tight">Administrative Team</p>
                  <p className="text-2xl font-bold">{allowedEmails?.filter(e => e.role !== 'user').length || 0}</p>
                </div>
              </div>
            </div>
          )}

          <div className="lg:col-span-1 md:col-span-2 bg-gradient-to-br from-primary/5 to-blue-500/5 border border-primary/20 rounded-3xl p-6 flex flex-col justify-center">
            <Dialog open={isAddModalOpen} onOpenChange={setIsAddModalOpen}>
              <DialogTrigger asChild>
                <button className="flex items-center justify-center gap-2 bg-primary text-primary-foreground px-6 py-4 rounded-xl font-bold shadow-lg shadow-primary/20 hover:opacity-90 transition-all">
                  <UserPlus className="w-5 h-5" />
                  {activeTab === 'admins' ? 'Add Administrator' : 'Authorize New Client'}
                </button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-md bg-card border-border/50 rounded-3xl">
                <DialogHeader>
                  <DialogTitle className="text-2xl font-display font-bold">
                    {activeTab === 'admins' ? 'Invite Administrator' : 'Grant Client Access'}
                  </DialogTitle>
                  <DialogDescription>
                    {activeTab === 'admins' 
                      ? 'Invite someone to help manage clients and platform settings.'
                      : 'Authorize a customer to log in and manage their own fleet routes.'}
                  </DialogDescription>
                </DialogHeader>
                    <div className="space-y-4 py-4">
                      <div className="space-y-2">
                        <label className="text-sm font-semibold ml-1">Display Name</label>
                        <div className="relative">
                          <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                          <input 
                            type="text" 
                            value={newName}
                            onChange={(e) => setNewName(e.target.value)}
                            placeholder="John Doe / Company Ltd"
                            className="w-full pl-10 pr-4 py-3 bg-background border-2 border-border/50 rounded-xl focus:border-primary outline-none transition-all"
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-semibold ml-1">Email Address</label>
                        <div className="relative">
                          <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                          <input 
                            type="email" 
                            value={newEmail}
                            onChange={(e) => setNewEmail(e.target.value)}
                            placeholder="email@example.com"
                            className="w-full pl-10 pr-4 py-3 bg-background border-2 border-border/50 rounded-xl focus:border-primary outline-none transition-all"
                          />
                        </div>
                      </div>
                  {activeTab === 'admins' && (
                    <div className="space-y-2">
                      <label className="text-sm font-semibold ml-1">Administrative Level</label>
                      <div className="w-full py-3 px-4 bg-muted/50 border-2 border-border/50 rounded-xl text-muted-foreground font-medium flex items-center gap-2">
                        <Shield className="w-4 h-4" />
                        Platform Administrator
                      </div>
                      <p className="text-[10px] text-muted-foreground ml-1 italic">* All invited team members are granted standard admin access to manage clients.</p>
                    </div>
                  )}
                  {activeTab === 'clients' && (
                    <>
                      <div className="space-y-2">
                        <label className="text-sm font-semibold ml-1">Price Tier (Route Limit)</label>
                        <Select value={newRouteLimit.toString()} onValueChange={(v) => setNewRouteLimit(parseInt(v))}>
                          <SelectTrigger className="w-full py-6 rounded-xl border-2 border-border/50">
                            <SelectValue placeholder="Select tier" />
                          </SelectTrigger>
                          <SelectContent className="rounded-xl">
                            <SelectItem value="25">Starter (25 routes)</SelectItem>
                            <SelectItem value="50">Business (50 routes)</SelectItem>
                            <SelectItem value="100">Enterprise (100 routes)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex items-center justify-between p-4 bg-muted/30 rounded-2xl border border-border/50">
                        <div className="space-y-0.5">
                          <label className="text-sm font-bold">Paid Status</label>
                          <p className="text-xs text-muted-foreground">Is the client current on payments?</p>
                        </div>
                        <Switch checked={newIsPaid} onCheckedChange={setNewIsPaid} />
                      </div>
                    </>
                  )}
                </div>
                <DialogFooter className="sm:justify-between gap-4">
                  <button 
                    onClick={() => setIsAddModalOpen(false)}
                    className="flex-1 px-4 py-3.5 bg-muted text-muted-foreground rounded-xl font-bold"
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={() => handleAddAccess(activeTab === 'clients' ? 'user' : newRole as any)}
                    disabled={addMutation.isPending || !newEmail}
                    className="flex-1 px-4 py-3.5 bg-primary text-primary-foreground rounded-xl font-bold shadow-lg shadow-primary/20 disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {addMutation.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : "Confirm Access"}
                  </button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        <div className="bg-card border border-border/50 rounded-[2.5rem] overflow-hidden shadow-sm">
          <div className="p-8 border-b border-border/50 bg-muted/20">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
              <div>
                <h2 className="text-2xl font-display font-bold">
                  {activeTab === 'admins' ? 'Administrative Team' : 'Client Accounts'}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {activeTab === 'admins' ? 'Authorized managers for the platform' : 'Customers authorized to create truck routes'}
                </p>
              </div>
              
              <div className="relative w-full md:w-80">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input 
                  type="text" 
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder={`Search ${activeTab}...`}
                  className="w-full pl-11 pr-4 py-3 bg-background border border-border/50 rounded-2xl outline-none focus:ring-2 focus:ring-primary/10 focus:border-primary/50 transition-all text-sm"
                />
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-muted/10 text-left">
                  <th className="px-8 py-5 text-xs font-bold text-muted-foreground uppercase tracking-wider">Email Address</th>
                  {activeTab === 'admins' ? (
                    <th className="px-8 py-5 text-xs font-bold text-muted-foreground uppercase tracking-wider">Role</th>
                  ) : (
                    <>
                      <th className="px-8 py-5 text-xs font-bold text-muted-foreground uppercase tracking-wider">Plan / Usage</th>
                      <th className="px-8 py-5 text-xs font-bold text-muted-foreground uppercase tracking-wider">Paid</th>
                    </>
                  )}
                  <th className="px-8 py-5 text-xs font-bold text-muted-foreground uppercase tracking-wider">Date Added</th>
                  <th className="px-8 py-5 text-xs font-bold text-muted-foreground uppercase tracking-wider text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {isLoading ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <tr key={i} className="animate-pulse">
                      <td colSpan={4} className="px-8 py-6 h-20 bg-muted/5"></td>
                    </tr>
                  ))
                ) : (activeTab === 'admins' ? adminEmails : clientEmails).length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-8 py-20 text-center">
                      <div className="flex flex-col items-center gap-3">
                        <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center">
                          <Search className="w-8 h-8 text-muted-foreground/50" />
                        </div>
                        <p className="text-muted-foreground font-medium">No results found in this category</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  (activeTab === 'admins' ? adminEmails : clientEmails).map((item) => (
                    <tr key={item.id} className="hover:bg-muted/5 transition-colors group">
                      <td className="px-8 py-6">
                        <div className="flex items-center gap-4">
                          <div className={`w-10 h-10 rounded-xl flex items-center justify-center border font-bold ${
                            item.role === 'super_admin' ? 'bg-purple-100 border-purple-200 text-purple-600' : 
                            item.role === 'admin' ? 'bg-blue-100 border-blue-200 text-blue-600' :
                            'bg-slate-100 border-slate-200 text-slate-600'
                          }`}>
                            {((item as any).name || item.email).charAt(0).toUpperCase()}
                          </div>
                          <div className="flex flex-col">
                            <span className="font-semibold text-foreground leading-none">{(item as any).name || 'Set Name'}</span>
                            <span className="text-xs text-muted-foreground mt-1">{item.email}</span>
                          </div>
                        </div>
                      </td>
                      {activeTab === 'admins' && (
                        <td className="px-8 py-6">
                          <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold ${
                            item.role === 'super_admin' 
                              ? 'bg-purple-500/10 text-purple-600 border border-purple-200' 
                              : 'bg-blue-500/10 text-blue-600 border border-blue-200'
                          }`}>
                            {item.role === 'super_admin' ? <Shield className="w-3.5 h-3.5" /> : <ShieldCheck className="w-3.5 h-3.5" />}
                            {item.role.replace('_', ' ').toUpperCase()}
                          </div>
                        </td>
                      )}
                      {activeTab === 'clients' && (
                        <>
                          <td className="px-8 py-6">
                            <div className="flex flex-col gap-1.5 min-w-[120px]">
                              <div className="flex justify-between items-end">
                                <span className="text-[10px] font-bold uppercase text-muted-foreground">{item.routeLimit} Route Tier</span>
                                <span className={`text-xs font-bold ${((item as any).usedRoutes || 0) >= item.routeLimit ? 'text-destructive' : 'text-primary'}`}>
                                  {item.routeLimit - ((item as any).usedRoutes || 0)} left
                                </span>
                              </div>
                              <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                                <div 
                                  className={`h-full transition-all rounded-full ${((item as any).usedRoutes || 0) >= item.routeLimit ? 'bg-destructive' : 'bg-primary'}`}
                                  style={{ width: `${Math.min(100, (((item as any).usedRoutes || 0) / item.routeLimit) * 100)}%` }}
                                />
                              </div>
                            </div>
                          </td>
                          <td className="px-8 py-6">
                            <Switch 
                              checked={(item as any).isPaid} 
                              onCheckedChange={(checked) => 
                                updateMutation.mutate({ 
                                  email: item.email, 
                                  data: { isPaid: checked } 
                                })
                              } 
                            />
                          </td>
                        </>
                      )}
                      <td className="px-8 py-6 text-sm text-muted-foreground">
                        {new Date(item.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                      </td>
                      <td className="px-8 py-6 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {activeTab === 'clients' && (
                            <button 
                              onClick={() => {
                                setEditingItem(item);
                                setEditName((item as any).name || "");
                                setEditRouteLimit(item.routeLimit);
                                setEditUsedRoutes((item as any).usedRoutes || 0);
                                setIsEditModalOpen(true);
                              }}
                              className="p-2.5 text-muted-foreground hover:bg-muted rounded-xl transition-all"
                              title="Edit Tier / Usage"
                            >
                              <Edit className="w-5 h-5" />
                            </button>
                          )}
                          
                          {item.email !== 'artakpoghosyan1@gmail.com' ? (
                            <button 
                              onClick={() => handleRemoveEmail(item.email)}
                              disabled={removeMutation.isPending}
                              className="p-2.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive rounded-xl transition-all"
                              title="Revoke All Access"
                            >
                              <Trash2 className="w-5 h-5" />
                            </button>
                          ) : (
                            <div className="px-4 py-1.5 bg-muted rounded-lg text-[10px] font-bold text-muted-foreground uppercase inline-block">Root Account</div>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <Dialog open={isEditModalOpen} onOpenChange={setIsEditModalOpen}>
        <DialogContent className="sm:max-w-md bg-card border-border/50 rounded-3xl">
          <DialogHeader>
            <DialogTitle className="text-2xl font-display font-bold">Manage Client</DialogTitle>
            <DialogDescription>
              Update tier limits or manually adjust route usage for <strong>{editingItem?.email}</strong>.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-6 py-4">
            <div className="space-y-2">
              <label className="text-sm font-semibold ml-1">Display Name</label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input 
                  type="text" 
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder="Update account name"
                  className="w-full pl-10 pr-4 py-3 bg-background border-2 border-border/50 rounded-xl focus:border-primary outline-none transition-all"
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex justify-between items-center px-1">
                <label className="text-sm font-semibold">Route Capacity (Tier)</label>
                <span className="text-xs font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-full">{editRouteLimit} Routes</span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {[25, 50, 100].map(val => (
                  <button 
                    key={val}
                    onClick={() => setEditRouteLimit(val)}
                    className={`py-2 rounded-xl text-xs font-bold border-2 transition-all ${editRouteLimit === val ? 'bg-primary border-primary text-primary-foreground' : 'border-border/50 hover:border-primary/50'}`}
                  >
                    {val}
                  </button>
                ))}
              </div>
              <div className="relative pt-2">
                <input 
                  type="number" 
                  value={editRouteLimit}
                  onChange={(e) => setEditRouteLimit(parseInt(e.target.value) || 0)}
                  className="w-full px-4 py-3 bg-background border-2 border-border/50 rounded-xl focus:border-primary outline-none transition-all pr-20"
                />
                <span className="absolute right-4 top-[22px] text-xs font-bold text-muted-foreground uppercase">Manual</span>
              </div>
              <p className="text-[10px] text-muted-foreground italic ml-1">Increase the limit to "make the tier longer" or upgrade the client plan.</p>
            </div>

            <div className="space-y-2">
              <div className="flex justify-between items-center px-1">
                <label className="text-sm font-semibold">Routes Consumed</label>
                <button 
                  onClick={() => setEditUsedRoutes(0)}
                  className="text-[10px] font-bold text-primary hover:underline uppercase"
                >
                  Reset Usage
                </button>
              </div>
              <div className="relative">
                <input 
                  type="number" 
                  value={editUsedRoutes}
                  onChange={(e) => setEditUsedRoutes(parseInt(e.target.value) || 0)}
                  className="w-full px-4 py-3 bg-background border-2 border-border/50 rounded-xl focus:border-primary outline-none transition-all"
                />
              </div>
              <p className="text-[10px] text-muted-foreground italic ml-1">Decreasing this number is another way to extend their current tier's availability.</p>
            </div>
          </div>
          <DialogFooter>
            <button 
              onClick={() => setIsEditModalOpen(false)}
              className="px-6 py-3 rounded-xl font-bold text-sm hover:bg-muted transition-all"
            >
              Cancel
            </button>
            <button 
              onClick={() => {
                updateMutation.mutate({ 
                  email: editingItem.email, 
                  data: { 
                    name: editName,
                    routeLimit: editRouteLimit,
                    usedRoutes: editUsedRoutes 
                  } as any
                });
                setIsEditModalOpen(false);
              }}
              disabled={updateMutation.isPending}
              className="px-8 py-3 bg-primary text-primary-foreground rounded-xl font-bold text-sm shadow-lg shadow-primary/20 hover:opacity-90 transition-all disabled:opacity-50"
            >
              Update Settings
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <FriendlyErrorDialog 
        open={errorDialog.open} 
        onOpenChange={(open) => setErrorDialog(curr => ({ ...curr, open }))}
        errorType={errorDialog.type}
        message={errorDialog.message}
      />
    </AdminLayout>
  );
}
