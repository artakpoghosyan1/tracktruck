import { useState } from "react";
import { AdminLayout } from "@/components/layout/AdminLayout";
import {
  Users,
  UserPlus,
  Trash2,
  Search,
  Loader2,
  Edit,
  AlertCircle,
} from "lucide-react";
import {
  useListOrgUsers,
  useAddOrgUser,
  useUpdateOrgUser,
  useRemoveOrgUser,
  getListOrgUsersQueryKey,
} from "@workspace/api-client-react";
import type { AllowedEmail, Organization } from "@workspace/api-client-react";
import { useAppStore } from "@/store/use-app-store";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { useQueryClient } from "@tanstack/react-query";

export default function OrgAdmin() {
  const { user } = useAppStore();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [searchTerm, setSearchTerm] = useState("");
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [addEmail, setAddEmail] = useState("");
  const [addName, setAddName] = useState("");
  const [addRouteLimit, setAddRouteLimit] = useState(0);

  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<AllowedEmail | null>(null);
  const [editRouteLimit, setEditRouteLimit] = useState(0);
  const [editName, setEditName] = useState("");

  const [isRemoveConfirmOpen, setIsRemoveConfirmOpen] = useState(false);
  const [removingEmail, setRemovingEmail] = useState("");

  const { data, isLoading } = useListOrgUsers();
  const org: Organization | null = data?.organization ?? null;
  const members: AllowedEmail[] = data?.members ?? [];

  const refetch = () => queryClient.invalidateQueries({ queryKey: getListOrgUsersQueryKey() });

  const remaining = org ? org.routeLimit - org.allocatedRoutes : 0;
  const totalUsedRoutes = members.reduce((sum, m) => sum + (m.usedRoutes ?? 0), 0);

  const addMutation = useAddOrgUser({
    mutation: {
      onSuccess: () => {
        toast({ title: "User added", description: `${addEmail} can now sign up.` });
        setIsAddModalOpen(false);
        setAddEmail(""); setAddName(""); setAddRouteLimit(0);
        refetch();
      },
      onError: (err: any) => {
        const msg = err.response?.data?.message || "Failed to add user.";
        toast({ title: "Error", description: msg, variant: "destructive" });
      },
    },
  });

  const updateMutation = useUpdateOrgUser({
    mutation: {
      onSuccess: () => {
        toast({ title: "Updated", description: "Quota updated." });
        setIsEditModalOpen(false);
        refetch();
      },
      onError: (err: any) => {
        const msg = err.response?.data?.message || "Failed to update.";
        toast({ title: "Error", description: msg, variant: "destructive" });
      },
    },
  });

  const removeMutation = useRemoveOrgUser({
    mutation: {
      onSuccess: () => {
        toast({ title: "Removed", description: "User removed from organization." });
        setIsRemoveConfirmOpen(false);
        refetch();
      },
      onError: (err: any) => {
        const msg = err.response?.data?.message || "Failed to remove user.";
        toast({ title: "Error", description: msg, variant: "destructive" });
      },
    },
  });

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    addMutation.mutate({ data: { email: addEmail, name: addName || undefined, routeLimit: addRouteLimit } });
  };

  const openEdit = (member: AllowedEmail) => {
    setEditingMember(member);
    setEditRouteLimit(member.routeLimit);
    setEditName(member.name ?? "");
    setIsEditModalOpen(true);
  };

  const handleUpdate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingMember) return;
    updateMutation.mutate({ email: editingMember.email, data: { routeLimit: editRouteLimit, name: editName || undefined } });
  };

  const openRemove = (email: string) => {
    setRemovingEmail(email);
    setIsRemoveConfirmOpen(true);
  };

  const filtered = members.filter(
    (m) =>
      m.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (m.name ?? "").toLowerCase().includes(searchTerm.toLowerCase()),
  );

  // Max that can be allocated to a new user = remaining + nothing deducted yet
  const addMax = remaining;
  // Max for editing = remaining + current member's allocation (since we're replacing it)
  const editMax = editingMember ? remaining + editingMember.routeLimit : remaining;

  return (
    <AdminLayout>
      <div className="max-w-5xl mx-auto space-y-8">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-display font-bold text-foreground">My Organization</h1>
          <p className="text-muted-foreground mt-1">Manage members and allocate route quotas.</p>
        </div>

        {/* Org quota card */}
        {org && (
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <div className="bg-card border border-border/60 rounded-2xl p-5">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Organization</p>
              <p className="text-lg font-bold text-foreground truncate">{org.name}</p>
              <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full mt-2 ${org.isPaid ? "bg-green-100 text-green-700" : "bg-red-100 text-red-600"}`}>
                {org.isPaid ? "Active" : "Inactive"}
              </span>
            </div>
            <div className="bg-card border border-border/60 rounded-2xl p-5">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Total Quota</p>
              <p className="text-3xl font-bold text-foreground">{org.routeLimit}</p>
              <p className="text-xs text-muted-foreground mt-1">routes</p>
            </div>
            <div className="bg-card border border-border/60 rounded-2xl p-5">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Remaining</p>
              <p className={`text-3xl font-bold ${remaining <= 0 ? "text-destructive" : "text-foreground"}`}>{remaining}</p>
              <p className="text-xs text-muted-foreground mt-1">{org.allocatedRoutes} allocated</p>
            </div>
            <div className="bg-card border border-border/60 rounded-2xl p-5">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Total Used</p>
              <p className="text-3xl font-bold text-foreground">{totalUsedRoutes}</p>
              <p className="text-xs text-muted-foreground mt-1">across all members</p>
            </div>
          </div>
        )}

        {!org && !isLoading && (
          <div className="flex items-center gap-3 text-muted-foreground bg-muted/30 rounded-2xl p-6">
            <AlertCircle className="w-5 h-5 shrink-0" />
            <p>You are not associated with an organization. Contact your administrator.</p>
          </div>
        )}

        {/* Member table */}
        {org && (
          <div className="bg-card border border-border/60 rounded-2xl overflow-hidden">
            <div className="p-5 border-b border-border/50 flex items-center justify-between gap-4 flex-wrap">
              <div className="relative flex-1 min-w-48">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search members..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 text-sm bg-background border border-border/60 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
              <button
                onClick={() => setIsAddModalOpen(true)}
                disabled={!org.isPaid}
                className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-xl text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <UserPlus className="w-4 h-4" />
                Add Member
              </button>
            </div>

            {isLoading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <Users className="w-12 h-12 mb-3 opacity-30" />
                <p className="font-medium">No members yet</p>
                <p className="text-sm mt-1">Add members to get started.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/40 bg-muted/20">
                      <th className="text-left font-semibold text-muted-foreground px-5 py-3">Member</th>
                      <th className="text-center font-semibold text-muted-foreground px-4 py-3">Allocated</th>
                      <th className="text-center font-semibold text-muted-foreground px-4 py-3">Used</th>
                      <th className="text-right font-semibold text-muted-foreground px-5 py-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((member) => (
                      <tr key={member.email} className="border-b border-border/30 last:border-0 hover:bg-muted/10 transition-colors">
                        <td className="px-5 py-3.5">
                          <p className="font-semibold text-foreground truncate">{member.name || member.email}</p>
                          {member.name && <p className="text-xs text-muted-foreground truncate">{member.email}</p>}
                        </td>
                        <td className="text-center px-4 py-3.5">
                          <span className="inline-flex items-center justify-center w-10 h-7 bg-primary/10 text-primary text-xs font-bold rounded-lg">
                            {member.routeLimit}
                          </span>
                        </td>
                        <td className="text-center px-4 py-3.5">
                          <span className={`inline-flex items-center justify-center w-10 h-7 text-xs font-bold rounded-lg ${member.usedRoutes >= member.routeLimit ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground"}`}>
                            {member.usedRoutes}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => openEdit(member)}
                              className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                              title="Edit quota"
                            >
                              <Edit className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => openRemove(member.email)}
                              className="p-2 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                              title="Remove member"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Add Member Modal */}
      <Dialog open={isAddModalOpen} onOpenChange={setIsAddModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Member</DialogTitle>
            <DialogDescription>
              Invite a new user to your organization. They'll be able to sign up once added.
              {org && <span className="block mt-1 text-primary font-medium">{remaining} routes available to allocate.</span>}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleAdd} className="space-y-4 mt-2">
            <div>
              <label className="text-sm font-semibold text-foreground mb-1.5 block">Email</label>
              <input
                type="email"
                value={addEmail}
                onChange={(e) => setAddEmail(e.target.value)}
                className="w-full px-3 py-2 bg-background border border-border/80 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                placeholder="member@example.com"
                required
              />
            </div>
            <div>
              <label className="text-sm font-semibold text-foreground mb-1.5 block">Name (optional)</label>
              <input
                type="text"
                value={addName}
                onChange={(e) => setAddName(e.target.value)}
                className="w-full px-3 py-2 bg-background border border-border/80 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                placeholder="Full name"
              />
            </div>
            <div>
              <label className="text-sm font-semibold text-foreground mb-1.5 block">
                Route Limit <span className="text-muted-foreground font-normal">(max {addMax})</span>
              </label>
              <input
                type="number"
                value={addRouteLimit}
                onChange={(e) => setAddRouteLimit(Math.max(0, parseInt(e.target.value) || 0))}
                min={0}
                max={addMax}
                className="w-full px-3 py-2 bg-background border border-border/80 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
            <DialogFooter>
              <button type="button" onClick={() => setIsAddModalOpen(false)} className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
                Cancel
              </button>
              <button
                type="submit"
                disabled={addMutation.isPending || addRouteLimit > addMax}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-xl text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {addMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Add Member"}
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit Quota Modal */}
      <Dialog open={isEditModalOpen} onOpenChange={setIsEditModalOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Edit Quota</DialogTitle>
            <DialogDescription>
              {editingMember?.email}
              {org && <span className="block mt-1 text-primary font-medium">{editMax} routes available to allocate.</span>}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleUpdate} className="space-y-4 mt-2">
            <div>
              <label className="text-sm font-semibold text-foreground mb-1.5 block">Name</label>
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="w-full px-3 py-2 bg-background border border-border/80 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                placeholder="Full name"
              />
            </div>
            <div>
              <label className="text-sm font-semibold text-foreground mb-1.5 block">
                Route Limit <span className="text-muted-foreground font-normal">(max {editMax})</span>
              </label>
              <input
                type="number"
                value={editRouteLimit}
                onChange={(e) => setEditRouteLimit(Math.max(0, parseInt(e.target.value) || 0))}
                min={0}
                max={editMax}
                className="w-full px-3 py-2 bg-background border border-border/80 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
            <DialogFooter>
              <button type="button" onClick={() => setIsEditModalOpen(false)} className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
                Cancel
              </button>
              <button
                type="submit"
                disabled={updateMutation.isPending || editRouteLimit > editMax}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-xl text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {updateMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save"}
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Remove Confirm Modal */}
      <Dialog open={isRemoveConfirmOpen} onOpenChange={setIsRemoveConfirmOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Remove Member</DialogTitle>
            <DialogDescription>
              Remove <strong>{removingEmail}</strong> from your organization? Their access will be revoked on next login.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button type="button" onClick={() => setIsRemoveConfirmOpen(false)} className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
              Cancel
            </button>
            <button
              onClick={() => removeMutation.mutate({ email: removingEmail })}
              disabled={removeMutation.isPending}
              className="px-4 py-2 bg-destructive text-destructive-foreground rounded-xl text-sm font-semibold hover:bg-destructive/90 transition-colors disabled:opacity-50"
            >
              {removeMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Remove"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
