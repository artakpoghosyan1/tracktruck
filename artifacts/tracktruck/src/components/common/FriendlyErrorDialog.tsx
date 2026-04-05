import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { AlertCircle, CreditCard, ShieldAlert, UserPlus } from "lucide-react";

interface FriendlyErrorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  errorType?: "payment_required" | "quota_exceeded" | "conflict" | "unauthorized" | "generic";
  message?: string;
  title?: string;
}

export function FriendlyErrorDialog({ 
  open, 
  onOpenChange, 
  errorType = "generic", 
  message, 
  title 
}: FriendlyErrorDialogProps) {
  
  const getErrorDetails = () => {
    switch (errorType) {
      case "payment_required":
        return {
          icon: <CreditCard className="w-10 h-10 text-amber-500" />,
          title: title || "Account Unpaid",
          description: message || "Your account is currently inactive due to an unpaid balance. Please contact the platform administrator to resolve your billing status and regain access.",
          buttonText: "Got it"
        };
      case "quota_exceeded":
        return {
          icon: <ShieldAlert className="w-10 h-10 text-destructive" />,
          title: title || "Route Limit Reached",
          description: message || "Your current plan's route limit has been exhausted. You cannot activate more routes until the next billing cycle or until you upgrade your tier.",
          buttonText: "Understood"
        };
      case "conflict":
        return {
          icon: <UserPlus className="w-10 h-10 text-primary" />,
          title: title || "Already Registered",
          description: message || "This email address is already authorized in our system. If you intended to update their settings, please find them in the list instead.",
          buttonText: "Return to List"
        };
      case "unauthorized":
        return {
          icon: <AlertCircle className="w-10 h-10 text-destructive" />,
          title: title || "Access Denied",
          description: message || "You do not have the necessary permissions to access this area or your invitation has expired.",
          buttonText: "Try Again"
        };
      default:
        return {
          icon: <AlertCircle className="w-10 h-10 text-muted-foreground" />,
          title: title || "Something Went Wrong",
          description: message || "An unexpected error occurred. Please try again later or contact support if the problem persists.",
          buttonText: "Close"
        };
    }
  };

  const details = getErrorDetails();

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="rounded-3xl border-border/50 bg-card overflow-hidden duration-500 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:slide-in-from-bottom-4 shadow-2xl">
        <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-transparent via-primary to-transparent opacity-50" />
        <AlertDialogHeader className="flex flex-col items-center text-center pt-4">
          <div className="mb-4 p-4 rounded-3xl bg-muted/50 border border-border/10 shadow-inner group-hover:scale-110 transition-transform duration-500">
            {details.icon}
          </div>
          <AlertDialogTitle className="text-2xl font-bold font-display tracking-tight">{details.title}</AlertDialogTitle>
          <AlertDialogDescription className="text-base text-muted-foreground mt-3 px-4 leading-relaxed font-medium italic">
            {details.description}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="sm:justify-center pt-6 pb-2">
          <AlertDialogAction 
            onClick={() => onOpenChange(false)}
            className="w-full sm:w-56 py-7 rounded-2xl font-bold text-lg shadow-xl shadow-primary/20 transition-all hover:scale-105 active:scale-95 bg-primary hover:bg-primary/90"
          >
            {details.buttonText}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
